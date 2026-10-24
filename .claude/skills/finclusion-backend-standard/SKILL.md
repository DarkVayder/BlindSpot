---
name: finclusion-backend-standard
description: >-
  Scaffold a new backend, or audit/refactor an existing one, to the Finclusion
  engineering standard and industry best practice — security-first, layered,
  observable, and production-ready. Framework-aware: it adapts to whatever stack
  is specified or detected (NestJS/Node, ASP.NET Core/C#, or any other via the
  universal pillars). Use this skill whenever someone wants to "build a backend",
  "set up the API structure", "scaffold a service", "make this backend solid /
  secure / production-ready", "follow our backend standards", "review the
  architecture", or asks how to structure modules, config, auth, error handling,
  logging, or deployment for a server-side app — even if they don't name a
  framework. For wiring auth to the central SSO, defer to the
  finclusion-sso-integration skill.
---

# Finclusion Backend Standard

Build backends that are **solid, secure, and consistent** across every
Finclusion project, regardless of framework. This skill encodes the conventions
proven in Finclusion's own backends (the NestJS reference is grounded in real
code) plus industry best practice, and adapts them to the target stack.

## How to use this skill

1. **Establish the framework and mode.** Determine two things first:
   - **Framework/stack** — is it specified or detectable (a `package.json` with
     `@nestjs/*`, a `.csproj`/`.sln`, `go.mod`, `pom.xml`, `requirements.txt`)?
     If you can't tell and it isn't stated, **ask** — don't assume.
   - **Mode** — *scaffold new* (greenfield) or *audit/refactor existing* (bring
     a codebase up to standard). For audit mode, read the existing layout first
     and propose changes incrementally; don't rewrite wholesale.
2. **Apply the universal pillars** (below). These are framework-independent and
   are what "solid + secure" actually means. Every backend must satisfy them.
3. **Open the framework reference** for concrete structure and code:
   - **NestJS / Node** → `references/nestjs.md` (the canonical Finclusion stack)
   - **ASP.NET Core / C#** → `references/dotnet.md`
   - **Any other framework** (Express, Fastify, Spring, FastAPI, Go, …) →
     `references/architecture.md` maps the pillars to a generic layered design;
     translate idiomatically into that stack.
4. **Always read** `references/security.md` — the security baseline is
   non-negotiable and applies to every stack.
5. **Finish against the Definition of Done** at the bottom of this file.

## The universal pillars (every backend, every framework)

These are the standard. The reference files show *how* per framework; this is
*what* and *why*.

1. **Layered, feature-organized architecture.** Organize by **feature/module**,
   not by technical layer at the top level. Within a feature, separate
   **transport (controller/route/handler) → service (business logic) → data
   access (repository/ORM)**. Controllers stay thin: validate, delegate, shape
   the response. Business rules live in services. *Why: features stay
   self-contained and the dependency direction is always inward, so you can
   change the DB or the transport without touching business logic.*

2. **Config validated on boot, fail fast.** All configuration comes from the
   environment, is **validated against a schema at startup**, and the process
   **refuses to start** if anything required is missing or weak. Access config
   through a **typed** accessor, never raw `process.env`/`Environment` reads
   scattered in code. *Why: a missing secret should crash on deploy, not page
   you at 2am when the first request hits the unset value.*

3. **Validate all input at the boundary.** Every request body/query/param is
   validated and coerced by a **schema** before it reaches business logic.
   Reject unknown fields. Treat all external input as hostile. *Why: validation
   at the edge means services can trust their inputs and you get one consistent
   place for 400s.*

4. **One consistent error contract.** A single global exception handler produces
   a uniform error body (`statusCode`, `message`, `error`, and a
   **correlationId**). **Never leak stack traces, SQL, or internal messages on
   5xx** — log the detail server-side, return a generic message to the client.
   *Why: clients code against one shape; attackers learn nothing from errors.*

5. **Identity is delegated, authZ is explicit.** Don't build your own user store
   — authenticate against the **Finclusion SSO** and verify its JWTs (see the
   `finclusion-sso-integration` skill). Default every route to **authenticated**
   and opt specific routes out explicitly (a `@Public`-style marker).
   Authorization (roles/ownership/tenant) is checked explicitly per resource,
   never assumed from authentication. *Why: one identity source across all apps;
   "secure by default" beats "forgot to add the guard."*

6. **Security baseline, always on.** Argon2id password hashing (only if you
   store credentials at all), HTTPS-only, security headers (Helmet/HSTS), strict
   CORS allow-list, rate limiting/throttling, httpOnly+Secure cookies, secrets in
   a vault. Full checklist in `references/security.md`. *Why: these are cheap to
   turn on and catastrophic to omit.*

7. **Safe persistence.** Use an ORM/query layer with **parameterized queries**
   (no string-concatenated SQL). Schema changes go through **versioned
   migrations** run on deploy — **never** auto-sync/`synchronize: true` in
   production. Manage the connection lifecycle (graceful connect/disconnect).
   *Why: migrations are auditable and reversible; auto-sync silently drops data.*

8. **Observability built in.** **Structured (JSON) logging** with a request
   **correlationId** and **redaction of secrets** (authorization headers,
   cookies, passwords, tokens). Expose **liveness and readiness** health
   endpoints. *Why: you can't operate what you can't see, and you must never log
   a password.*

9. **Async work is durable.** Long/external work goes to a **queue** with
   retries, exponential backoff, and a dead-letter path; jobs are **idempotent**.
   Provide a graceful fallback when the queue backend is unavailable. *Why: a
   webhook or email failing shouldn't fail the user's request or get lost.*

10. **Tested and shippable.** Unit tests for services (mock the data layer),
    e2e/integration tests for critical flows. Ship as a **multi-stage container**
    running as a **non-root** user, with a healthcheck, that **runs migrations on
    startup**. *Why: confidence to deploy, and a small, hardened runtime image.*

## Don't reinvent these — reuse the Finclusion patterns

- **Auth/identity** → `finclusion-sso-integration` skill. Backends verify SSO
  JWTs and key their data on `finclusionId`; they don't store passwords.
- **The NestJS reference stack is already proven** — prefer it as-is for new
  Node services rather than re-litigating library choices (see `nestjs.md`).

## Definition of Done (check before declaring a backend "solid")

- [ ] Features are modular; controllers thin; logic in services; data access isolated.
- [ ] Env is schema-validated on boot; process won't start misconfigured; config access is typed.
- [ ] Every endpoint validates input via schema and rejects unknown fields.
- [ ] One global error handler; uniform error body with correlationId; no internals leaked on 5xx.
- [ ] Auth on by default; public routes explicitly marked; authZ checked per resource; identity via SSO.
- [ ] `references/security.md` checklist satisfied (headers, CORS, rate limit, secrets, crypto).
- [ ] Migrations versioned and run on deploy; no auto-sync; queries parameterized.
- [ ] Structured logging with correlationId + secret redaction; liveness/readiness endpoints.
- [ ] Durable async for external/slow work with retries + idempotency (if applicable).
- [ ] Tests for critical paths; multi-stage non-root container with healthcheck.

## Reference files

- `references/architecture.md` — framework-agnostic layered design, naming,
  folder layout, error contract, config strategy. Start here for any stack
  without a dedicated reference.
- `references/security.md` — the mandatory security baseline (OWASP-aligned).
  Read for every backend.
- `references/nestjs.md` — the canonical Finclusion NestJS stack and scaffold,
  grounded in the real `vidverify-backend` reference implementation.
- `references/dotnet.md` — the same pillars mapped to ASP.NET Core / C#.
