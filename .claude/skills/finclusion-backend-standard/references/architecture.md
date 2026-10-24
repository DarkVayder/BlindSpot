# Backend Architecture (framework-agnostic)

How to structure any backend to the Finclusion standard. The NestJS and .NET
references make this concrete; this file is the portable blueprint for stacks
without a dedicated reference (Express, Fastify, Spring Boot, FastAPI, Go, etc.).

## Layering & dependency direction

Three responsibilities, always separated, dependencies pointing **inward**:

```
Transport     (controller / route / handler)   ── HTTP concerns only
   │ calls
Service       (use-cases / business logic)      ── framework-agnostic rules
   │ calls
Data access   (repository / ORM / gateway)      ── persistence & external I/O
```

- **Transport** parses + validates input, calls a service, maps the result/error
  to a response. **No business logic, no SQL here.**
- **Service** holds the actual rules. It depends on **interfaces/abstractions**
  for data access and external calls, not concrete clients — so it's unit-test-
  able by mocking those, and the DB/transport can change without touching it.
- **Data access** is the only layer that knows about the database, the SSO HTTP
  client, the queue, S3, etc. It exposes intention-revealing methods
  (`findUserByFinclusionId`), not raw queries, to callers.

Keep transport thin enough that almost all logic worth testing lives in services.

## Organize by feature, not by layer

At the top level, group by **feature/domain**, and put the layers *inside* each
feature. This keeps a feature's code together and makes deletion/extraction easy.

```
src/
├── modules/ (or features/)
│   ├── auth/            # one folder per feature
│   │   ├── *.controller        # transport
│   │   ├── *.service           # logic
│   │   ├── *.repository        # data access (optional if ORM-direct)
│   │   └── dto/ (or schemas/)  # input/output shapes + validation
│   ├── users/
│   └── payments/
├── common/ (or shared/)   # cross-cutting: guards, filters, pipes, decorators, config
│   ├── config/            # env schema + typed accessor
│   ├── errors/            # exception filter + error types
│   ├── auth/              # token verification guard (delegates to SSO)
│   └── logging/
├── database/ (or prisma/) # schema + migrations + connection
└── main / bootstrap       # composition root: wire everything, start server
```

Avoid a top-level `controllers/`, `services/`, `models/` split — that scatters
each feature across the tree and couples unrelated code.

## Naming & consistency

- One consistent case convention per language (kebab-case files in TS, PascalCase
  in C#); match the existing repo — don't introduce a second style.
- Intention-revealing names: `RefreshTokenService`, `findActiveByEmail`. Avoid
  `util`, `helper`, `manager`, `data` grab-bags.
- One feature = one module folder. If a file exceeds a few hundred lines or mixes
  concerns, split it.

## The error contract

A single global exception handler converts everything into one shape. Use this
contract across all Finclusion backends:

```jsonc
{
  "statusCode": 400,
  "message": "Validation failed",       // string, or array of field messages
  "error": "Bad Request",
  "correlationId": "req_01H...",          // ties the response to server logs
  "errors": [                             // optional: per-field validation detail
    { "path": "email", "message": "Invalid email" }
  ]
}
```

Rules:
- **Domain/expected failures** throw typed HTTP errors (`BadRequest`,
  `NotFound`, `Unauthorized`, `Conflict`, …) with a safe client message.
- **Unexpected errors (5xx)**: log full detail + stack server-side with the
  correlationId; return a **generic** message (`"Something went wrong. Please
  try again later."`). Never expose stack traces, SQL, or internal identifiers.
- Generate/propagate a **correlationId** per request (from an `x-request-id`
  header if present, else generated) and include it in every log line and error.

## Configuration strategy

- All config from the **environment**. No secrets or environment-specific values
  hardcoded.
- **Validate against a schema at startup** (zod/Joi/FluentValidation/struct tags)
  and **fail to boot** on missing/weak values. Coerce types and apply defaults in
  the schema, not at call sites.
- Expose config through a **typed accessor** so a typo is a compile/load error,
  not an `undefined` at runtime.
- Distinguish required-everywhere vs optional/dev-only. Secrets must have minimum
  length checks (e.g. signing keys ≥ 32 bytes).

## Request lifecycle (the standard middleware order)

1. Security headers (Helmet/HSTS equivalent)
2. CORS (strict allow-list, credentials as needed)
3. Body parsing + size limits
4. Correlation-id assignment + structured request logging
5. Rate limiting / throttling
6. Authentication (verify SSO JWT) → authorization guards
7. Input validation (schema) → controller → service → data access
8. Global exception filter wraps the whole thing

## Composition root

One place (`main`/`bootstrap`/`Program`) wires modules, registers the global
filter/guards/logging, applies the middleware order above, and starts the server.
Keep startup logic out of feature code. If you also run a worker process, share
the same bootstrap/factory so HTTP and worker get identical config and wiring.

## Persistence principles (any ORM)

- **Parameterized queries only** — never string-concatenate user input into SQL.
- **Versioned migrations**, applied on deploy. **Never** auto-sync schema in
  prod.
- Repository/data layer owns transactions; services express *what* must be
  atomic, the data layer expresses *how*.
- Manage the connection pool lifecycle; disconnect gracefully on shutdown.

## When translating to a specific framework

Map the pillars to the framework's idioms rather than forcing NestJS shapes onto
it. Examples:
- **Express/Fastify**: routers = transport; plain service modules; a
  `jsonwebtoken` verify middleware = the auth guard; `zod` for validation; an
  error-handling middleware = the exception filter; `pino` for logging.
- **Spring Boot**: `@RestController` → `@Service` → `@Repository`;
  `@ControllerAdvice` = global error handler; Bean Validation = input validation;
  Spring Security filter = auth guard.
- **FastAPI**: routers → service functions → repository; Pydantic models =
  validation; dependency-injected auth dependency = guard; exception handlers =
  error contract.

Whatever the stack, the Definition of Done in `SKILL.md` still applies verbatim.
