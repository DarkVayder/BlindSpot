# Finclusion .NET Standard (ASP.NET Core / C#)

The same pillars as the NestJS reference, mapped to ASP.NET Core idioms. No
local C# Finclusion repo exists to ground this, so it follows current .NET best
practice while matching the Finclusion conventions (SSO identity, error
contract, security baseline). Keep parity with `nestjs.md` so services behave
the same regardless of stack.

## The stack (defaults)

| Concern | Choice |
|---|---|
| Framework | **ASP.NET Core** (.NET 8 LTS+), Web API |
| Project style | Minimal hosting (`Program.cs`) or controllers — controllers for non-trivial APIs |
| ORM / DB | **EF Core** + PostgreSQL (`Npgsql.EntityFrameworkCore.PostgreSQL`) |
| Config validation | Options pattern + **DataAnnotations / FluentValidation**, `ValidateOnStart()` |
| Request validation | **FluentValidation** (or DataAnnotations) at the boundary |
| Password hashing | **Argon2** (`Konscious.Security.Cryptography`) if storing creds; else none |
| AuthN | `Microsoft.AspNetCore.Authentication.JwtBearer` verifying **SSO** tokens |
| Rate limiting | Built-in **Rate Limiting middleware** (`AddRateLimiter`) |
| Headers | `UseHsts`, security-headers middleware (or `NetEscapades.AspNetCore.SecurityHeaders`) |
| Logging | **Serilog** (structured JSON) with destructuring/masking |
| Async jobs | **Hangfire** or a hosted `BackgroundService` + queue (Redis/Azure SB) |
| Validation/mapping | Explicit DTO→entity mapping (avoid blind AutoMapper of request bodies) |

## Solution / project layout

Organize by feature (vertical slices) rather than tech-layer projects. A pragmatic
single-API project:

```
src/Finclusion.<Service>.Api/
├── Program.cs                  # composition root: DI, middleware order, start
├── Common/
│   ├── Config/                 # strongly-typed Options + validators
│   ├── Errors/                 # exception-handling middleware, ProblemDetails
│   ├── Auth/                   # JWT bearer config, policies, [AllowAnonymous] usage
│   └── Logging/                # Serilog setup, correlation-id middleware
├── Features/                   # one folder per feature
│   └── <Feature>/
│       ├── <Feature>Controller.cs   # thin
│       ├── <Feature>Service.cs      # logic (behind I<Feature>Service)
│       ├── <Feature>Repository.cs   # data access (or EF DbContext directly)
│       ├── Dtos/                    # request/response records
│       └── <Feature>Validator.cs    # FluentValidation
├── Data/
│   ├── AppDbContext.cs
│   └── Migrations/             # EF Core migrations
└── appsettings.json / appsettings.{Environment}.json
```

For larger services, split into `.Api`, `.Application`, `.Domain`,
`.Infrastructure` projects — same layering, enforced by project references
pointing inward.

## Config: validated, typed, fail-on-start

```csharp
// Common/Config/JwtOptions.cs
public sealed class JwtOptions
{
    [Required, MinLength(32)] public string Secret { get; init; } = default!;
    [Required] public string SsoBaseUrl { get; init; } = default!;
}

// Program.cs
builder.Services
    .AddOptions<JwtOptions>()
    .Bind(builder.Configuration.GetSection("Jwt"))
    .ValidateDataAnnotations()
    .ValidateOnStart();           // app refuses to start if invalid
```

Inject `IOptions<JwtOptions>` — never read `Configuration["..."]` ad hoc in
features. Secrets come from environment / user-secrets / a vault, not
`appsettings.json` committed to source.

## Request validation at the boundary (FluentValidation)

```csharp
public sealed record CreateThingRequest(string Name, string Email);

public sealed class CreateThingValidator : AbstractValidator<CreateThingRequest>
{
    public CreateThingValidator()
    {
        RuleFor(x => x.Name).NotEmpty().MaximumLength(120);
        RuleFor(x => x.Email).NotEmpty().EmailAddress().MaximumLength(254);
    }
}
// Program.cs: builder.Services.AddValidatorsFromAssemblyContaining<CreateThingValidator>();
// + AddFluentValidationAutoValidation();  (or validate explicitly in the handler)
```

Bind to immutable `record` DTOs and **map explicitly** to entities — never
`db.Update(requestBody)`-style mass assignment.

## Error contract (ProblemDetails + correlationId)

Use a global exception handler that emits the same shape as the other Finclusion
backends (`statusCode`, `message`, `error`, `correlationId`):

```csharp
// Common/Errors/ExceptionHandlingMiddleware.cs
public sealed class ExceptionHandlingMiddleware(RequestDelegate next, ILogger<ExceptionHandlingMiddleware> log)
{
    public async Task Invoke(HttpContext ctx)
    {
        try { await next(ctx); }
        catch (Exception ex)
        {
            var correlationId = ctx.TraceIdentifier;
            var (status, message) = ex switch
            {
                ValidationException ve => (400, ve.Message),
                KeyNotFoundException  => (404, "Resource not found"),
                UnauthorizedAccessException => (401, "Unauthorized"),
                _ => (500, "Something went wrong. Please try again later."),
            };
            if (status >= 500)
                log.LogError(ex, "[{CorrelationId}] {Method} {Path} -> {Status}",
                    correlationId, ctx.Request.Method, ctx.Request.Path, status);

            ctx.Response.StatusCode = status;
            ctx.Response.ContentType = "application/json";
            await ctx.Response.WriteAsJsonAsync(new
            {
                statusCode = status,
                message,                         // never leak ex.Message on 5xx
                error = ReasonPhrases.GetReasonPhrase(status),
                correlationId,
            });
        }
    }
}
// Program.cs: app.UseMiddleware<ExceptionHandlingMiddleware>();  // early in the pipeline
```

## Auth: verify SSO tokens, secure by default

Verify SSO-issued **HS256** JWTs with the shared secret. **The SSO sets no
`iss`/`aud`, so disable those validations** (full detail in the
`finclusion-sso-integration` skill, `references/dotnet.md`):

```csharp
builder.Services
  .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
  .AddJwtBearer(o => o.TokenValidationParameters = new()
  {
      IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSecret)),
      ValidAlgorithms = new[] { SecurityAlgorithms.HmacSha256 },
      ValidateIssuer = false, ValidateAudience = false,   // SSO sets neither
      ValidateLifetime = true, ClockSkew = TimeSpan.FromSeconds(30),
      NameClaimType = "finclusionId",
  });

builder.Services.AddAuthorization(o =>
    o.FallbackPolicy = new AuthorizationPolicyBuilder()  // secure by default
        .RequireAuthenticatedUser().Build());
```

Opt routes out with `[AllowAnonymous]`. Enforce **per-resource authorization**
(ownership/role/tenant) in handlers or policies — never infer access from a valid
token alone. Key domain data on `finclusionId` (`User.FindFirst("finclusionId")`).

## Security middleware order (Program.cs)

```csharp
app.UseMiddleware<ExceptionHandlingMiddleware>();
app.UseSerilogRequestLogging();          // structured request logs + correlation id
app.UseHsts();                           // (prod) + UseHttpsRedirection()
app.UseSecurityHeaders();                // nosniff, frame-deny, CSP as needed
app.UseCors("Finclusion");               // strict allow-list policy, never *
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();
```

```csharp
// CORS + rate limiting registration
builder.Services.AddCors(o => o.AddPolicy("Finclusion", p => p
    .WithOrigins(corsOrigins).AllowAnyHeader().AllowAnyMethod().AllowCredentials()));
builder.Services.AddRateLimiter(o => o.AddFixedWindowLimiter("global", w =>
    { w.Window = TimeSpan.FromSeconds(60); w.PermitLimit = 60; }));
// Tighter [EnableRateLimiting("auth")] policy on login/signup/otp endpoints.
```

## Persistence: EF Core

```csharp
builder.Services.AddDbContext<AppDbContext>(o =>
    o.UseNpgsql(builder.Configuration.GetConnectionString("Postgres")));
```
- **Migrations** via `dotnet ef migrations add` / `dotnet ef database update`;
  run on deploy. **Never** `EnsureCreated()`/auto-sync in production.
- EF parameterizes queries by default — keep it that way; never interpolate user
  input into raw SQL (`FromSqlInterpolated` is safe, string concatenation is not).
- Scope every query by the caller (`Where(x => x.OwnerId == finclusionId)`).

## Logging: Serilog (structured + masking)

```csharp
builder.Host.UseSerilog((ctx, lc) => lc
    .ReadFrom.Configuration(ctx.Configuration)
    .Enrich.FromLogContext()
    .Enrich.WithProperty("service", "<service>")
    .WriteTo.Console(new RenderedCompactJsonFormatter()));
```
Mask secrets (Authorization headers, passwords, tokens) via destructuring
policies / log filters; never log credentials or full PII. Add a correlation-id
enricher tied to `TraceIdentifier`. Expose health endpoints with
`AddHealthChecks()` → `MapHealthChecks("/health/live")` and `/health/ready`
(with a DB check).

## Async jobs

Use **Hangfire** (durable, with retries + dashboard) or a hosted
`BackgroundService` consuming a Redis/Azure Service Bus queue. Configure retries
with exponential backoff and a dead-letter path; make handlers **idempotent**.

## Delivery

- Multi-stage `Dockerfile` (`sdk` build → `aspnet` runtime), **non-root** user
  (`USER app`), `HEALTHCHECK` hitting `/health/live`, run `dotnet ef database
  update` (or a migration bundle) on startup.
- `dotnet list package --vulnerable` in CI; don't ship PDBs/source to prod images.

## New-service bootstrap order

1. `dotnet new webapi`; add EF Core (Npgsql), FluentValidation, Serilog, JWT bearer.
2. Options classes + `ValidateOnStart()` for all config; secrets from env/vault.
3. `ExceptionHandlingMiddleware` + the standard error contract.
4. AppDbContext + initial migration.
5. JWT bearer verifying SSO tokens + `FallbackPolicy` (secure by default); SSO skill.
6. Security middleware order; CORS allow-list; rate limiter.
7. First feature slice (controller/service/validator/repository) as the template.
8. Health checks; multi-stage non-root Dockerfile; walk the Definition of Done.
