# Finclusion NestJS Standard

The canonical Node backend stack, grounded in the `vidverify-backend` reference
implementation. For a new Node service, adopt this as-is. For an audit, compare
against it and close gaps. (SSOAuth-V2 is an older variant using TypeORM +
class-validator + Joi — acceptable but **prefer the choices below** for new work.)

## The stack (defaults — don't re-litigate)

| Concern | Choice |
|---|---|
| Framework | **NestJS 11** (`@nestjs/*`) |
| Language/runtime | TypeScript, Node 20+ |
| Package manager | **pnpm** |
| ORM / DB | **Prisma** + PostgreSQL |
| Env validation | **zod** schema + `TypedConfigService` |
| Request validation | **zod** schemas + a `ZodValidationPipe` (per route) |
| Password hashing | **argon2** (argon2id) |
| AuthN | Passport JWT (verify **SSO** tokens — see SSO skill) |
| Rate limiting | `@nestjs/throttler` |
| Headers | `helmet` |
| Logging | `nestjs-pino` / `pino` (+ `pino-pretty` in dev) |
| Async jobs | **BullMQ** + `ioredis` (with inline fallback) |
| Email | `resend` or `nodemailer` |

## Directory layout

```
src/
├── main.ts                     # entry — calls bootstrap()
├── bootstrap.ts                # createApp() factory: helmet, CORS, cookieParser,
│                               #   global pipes/filters; shared by HTTP + worker
├── worker.ts                   # optional: BullMQ worker entrypoint (reuses bootstrap)
├── app.module.ts               # composition root: imports modules, global providers
├── common/
│   ├── config/                 # env.schema.ts (zod), typed-config.service.ts, typed-config.module.ts
│   ├── decorators/             # public.decorator.ts, current-user.decorator.ts, ...
│   ├── filters/                # all-exceptions.filter.ts
│   ├── guards/                 # jwt-auth.guard.ts, (workspace/role guards)
│   └── pipes/                  # zod-validation.pipe.ts
├── modules/                    # one folder per feature
│   └── <feature>/
│       ├── <feature>.module.ts
│       ├── <feature>.controller.ts     # thin: validate → service → respond
│       ├── <feature>.service.ts        # business logic
│       ├── services/                   # focused sub-services (e.g. token.service.ts)
│       ├── strategies/                 # passport strategies (auth features)
│       └── dto/<feature>.dto.ts        # zod schemas + inferred types
├── prisma/  (or modules/prisma/)       # prisma.service.ts (connect lifecycle)
└── prisma/schema.prisma + prisma/migrations/
```

Factor startup into `bootstrap.ts` so `main.ts` (HTTP) and `worker.ts` (jobs)
share identical wiring. Use the `@/*` → `src/*` path alias (tsconfig + `tsc-alias`).

## Config: zod env schema + typed accessor

```ts
// common/config/env.schema.ts
import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  CORS_ORIGINS: z.string().transform((s) => s.split(',').map((o) => o.trim())),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  // ...every var the app reads, with types + defaults
});
export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
```

```ts
// common/config/typed-config.service.ts
@Injectable()
export class TypedConfigService {
  constructor(private readonly config: ConfigService<Env, true>) {}
  get<K extends keyof Env>(key: K): Env[K] {
    return this.config.get(key, { infer: true }) as Env[K];
  }
}
```

```ts
// app.module.ts
ConfigModule.forRoot({ isGlobal: true, validate: validateEnv, cache: true });
// + TypedConfigModule (provides + exports TypedConfigService)
```

Inject `TypedConfigService` everywhere; **never read `process.env` directly** in
feature code.

## Request validation: zod + ZodValidationPipe

```ts
// common/pipes/zod-validation.pipe.ts
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}
  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: result.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    }
    return result.data;
  }
}
```

```ts
// modules/<feature>/dto/<feature>.dto.ts
export const createThingSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email().max(254),
}).strict();                       // .strict() rejects unknown fields
export type CreateThingDto = z.infer<typeof createThingSchema>;

// controller
@Post()
create(@Body(new ZodValidationPipe(createThingSchema)) dto: CreateThingDto) {
  return this.things.create(dto);
}
```

Schemas carry transforms (`trim`, `toLowerCase`) so services get clean data.

## Global error filter

```ts
// common/filters/all-exceptions.filter.ts
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const correlationId = (req as any).id;

    let status = 500;
    let body: Record<string, unknown> = { error: 'Internal Server Error' };

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const r = exception.getResponse();
      body = typeof r === 'object' ? { ...(r as object) } : { message: r };
    }
    if (status >= 500) {
      this.logger.error(
        `[${correlationId ?? '-'}] ${req.method} ${req.url} -> ${status}`,
        (exception as Error)?.stack,
      );
      body = { error: 'Internal Server Error', message: 'Something went wrong. Please try again later.' };
    }
    res.status(status).json({ statusCode: status, ...body, ...(correlationId ? { correlationId } : {}) });
  }
}
```

Register globally (`APP_FILTER` provider or `app.useGlobalFilters`).

## Auth: verify SSO tokens, secure by default

- **Verify SSO JWTs** — see the `finclusion-sso-integration` skill
  (`references/nodejs.md`) for the Passport strategy. Don't store passwords here.
- Make the JWT guard **global** and opt out with `@Public()`:

```ts
// common/decorators/public.decorator.ts
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

// common/guards/jwt-auth.guard.ts
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) { super(); }
  canActivate(ctx: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride(IS_PUBLIC_KEY, [
      ctx.getHandler(), ctx.getClass(),
    ]);
    return isPublic ? true : super.canActivate(ctx);
  }
}
// app.module.ts: { provide: APP_GUARD, useClass: JwtAuthGuard }
```

> If this service issues its own tokens (rare — most defer to SSO), follow the
> refresh-rotation + reuse-detection + `tokenVersion` pattern in
> `security.md`. The reference `token.service.ts` rotates inside a transaction,
> revokes the session family on reuse, and bumps `user.tokenVersion` to
> invalidate outstanding access tokens.

## Throttling, helmet, CORS, cookies (bootstrap.ts)

```ts
app.use(helmet());
app.use(cookieParser());
app.enableCors({
  origin: config.get('CORS_ORIGINS'),            // array from env, never '*'
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'x-request-id'],
});
```
```ts
// app.module.ts — global throttle, override per sensitive route
ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }]);
// controller
@Throttle({ default: { limit: 3, ttl: 60_000 } })
@Post('signup') signup() {/* ... */}
```
httpOnly refresh cookie (force `Secure` when `SameSite=None`; scope `path`):
```ts
res.cookie(name, raw, { httpOnly: true, secure, sameSite, path: '/api/auth', expires });
```

## Persistence: Prisma

```ts
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() { await this.$connect(); }
  async onModuleDestroy() { await this.$disconnect(); }
}
```
- Model in `prisma/schema.prisma`; migrations via `prisma migrate dev` (local) and
  **`prisma migrate deploy`** on release. **Never** `db push`/auto-sync in prod.
- Services call `this.prisma.<model>.<op>()`; scope every query by the
  authenticated principal (e.g. `where: { ownerId: user.finclusionId }`).

## Logging: pino with redaction

```ts
LoggerModule.forRootAsync({
  inject: [TypedConfigService],
  useFactory: (config: TypedConfigService) => ({
    pinoHttp: {
      level: config.get('LOG_LEVEL'),
      transport: config.get('NODE_ENV') === 'development'
        ? { target: 'pino-pretty', options: { singleLine: true } } : undefined,
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie',
                'req.body.password', 'req.body.token', '*.passwordHash', '*.secretKey'],
        censor: '[REDACTED]',
      },
    },
  }),
});
```
Add a `health` module exposing `/health/live` and `/health/ready`.

## Async jobs: BullMQ with inline fallback

A queue service enqueues with retries/backoff and only uses Redis when
configured, falling back to inline execution otherwise:
```ts
await this.queue.add('deliver', job, {
  attempts: 5,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: 100, removeOnFail: 500,
});
```
Run the worker from a dedicated `worker.ts` (reusing `bootstrap`), started via
`"worker": "node dist/worker.js"`. Make handlers idempotent.

## Tooling & delivery

- **Scripts:** `build` (`nest build && tsc-alias`), `start`, `worker`,
  `start:dev`, `lint`, `prisma:migrate:deploy`, `test`, `test:e2e`.
- **Prettier:** `singleQuote: true, trailingComma: "all", printWidth: 110`.
- **Tests:** Jest; unit-test services with the data layer mocked; `*.spec.ts`
  beside source; e2e under `test/`.
- **Docker:** multi-stage (builder → slim runtime), **non-root user**, healthcheck
  hitting `/health/live`, run `prisma migrate deploy` before `node dist/main.js`.

## New-service bootstrap order

1. `pnpm` init NestJS; add the stack deps; set `@/*` path alias.
2. `common/config` (env schema + TypedConfigService) — wire `validate` first.
3. Global filter, pino logger (with redaction), throttler, helmet/CORS in bootstrap.
4. Prisma service + initial schema + migration.
5. Global `JwtAuthGuard` + `@Public`; verify SSO tokens (SSO skill).
6. First feature module (controller/service/dto) end-to-end as the template.
7. Health module; Dockerfile (multi-stage, non-root, healthcheck, migrate-on-start).
8. Walk the Definition of Done in `SKILL.md`.
