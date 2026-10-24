# Backend Security Baseline (mandatory, every stack)

OWASP-aligned, security-first defaults for any Finclusion backend. This is not
optional polish — it's the floor. Translate each item to your framework's
idioms; the requirement is the same everywhere.

## Identity, authentication, authorization

- **Delegate identity to the Finclusion SSO.** Don't build a parallel user
  store or mint your own identity. Verify SSO-issued JWTs and key your data on
  `finclusionId`. See the `finclusion-sso-integration` skill for the verified
  contract (HS256 shared secret, no `iss`/`aud`, `/sg-auth/*`).
- **Secure by default.** Every route requires authentication unless **explicitly**
  marked public (a `@Public`-style decorator / attribute). A forgotten guard
  must fail *closed*, not open.
- **Authorization is explicit and per-resource.** Authentication ≠ authorization.
  Check role/ownership/tenant on every protected action (e.g. "does this user
  own this record / belong to this workspace"). Never infer access from the mere
  presence of a valid token. Prefer checking ownership in the data query itself
  (`where ownerId = currentUser`) so you can't forget it.
- **No IDOR.** Never trust an id from the client to belong to the caller — always
  scope reads/writes to the authenticated principal.

## Credentials & tokens (only if you handle them at all)

- **Password hashing: Argon2id** (the Finclusion standard; `argon2` lib), with
  cost parameters from config (memory, time, parallelism). bcrypt is acceptable
  legacy; **never** MD5/SHA-1/SHA-256-without-a-KDF, never plaintext.
- **JWT/session tokens:** short-lived access token + longer refresh token.
  Refresh tokens are **rotated on use**, stored **hashed** (SHA-256) server-side,
  and **reuse is detected** → revoke the whole session family. Support a
  **token-version / revoke-all** mechanism (bump a counter to invalidate all
  outstanding access tokens on password reset or forced logout).
- **Cookies:** auth cookies are `httpOnly`, `Secure`, `SameSite=Lax` (or
  `Strict`); use `SameSite=None` only with `Secure` and a real cross-site need.
  Scope the cookie `path`/`domain` tightly.
- Constant-time comparison for secret/API-key checks (`timingSafeEqual`); never
  `==` on secrets.

## Input handling & injection

- **Validate and coerce every input at the boundary** with a schema; reject
  unknown fields (whitelist). Enforce length/format/range — don't just check
  presence.
- **SQL/NoSQL injection:** parameterized queries / ORM bindings only. Never
  concatenate user input into a query string.
- **Output encoding:** if the service renders HTML or builds documents, encode
  output to prevent XSS/template injection. For pure JSON APIs, set
  `Content-Type: application/json` and don't reflect raw input into HTML.
- **SSRF:** if the backend fetches user-supplied URLs (webhooks, image imports),
  validate the host against an allow-list and block private/link-local ranges.
- **Mass assignment:** map validated DTO fields explicitly to entities; never
  spread raw request bodies into a DB model.
- **File uploads:** validate type/size, store outside the web root (e.g. S3),
  generate random names, never execute uploaded content.

## Transport & headers

- **HTTPS everywhere** in non-local environments; redirect HTTP→HTTPS at the
  edge. Bearer tokens and cookies over TLS only.
- **Security headers via Helmet (or equivalent):** HSTS, `X-Content-Type-Options:
  nosniff`, frame-deny / CSP as appropriate, disable `X-Powered-By`.
- **Strict CORS allow-list** from config — never `*` in production, and never
  reflect the `Origin` header unconditionally. Set `credentials: true` only with
  an explicit origin list.
- **Body size limits** to blunt memory-exhaustion payloads.

## Rate limiting & abuse

- **Global throttling** on by default (e.g. 60–120 req/min/client) plus **tighter
  per-route limits** on sensitive endpoints (login, signup, OTP, password reset,
  token refresh).
- **Account lockout / backoff** on repeated failed auth. Don't allow unlimited
  OTP/login attempts.
- Return `429` with `Retry-After`; make clients back off.

## Secrets management

- Secrets (signing keys, DB creds, API keys, the SSO `JWT_SECRET`/`x-api-key`)
  come from a **vault / platform secret store / env at runtime** — never
  committed, never in client-shippable config (`NEXT_PUBLIC_*`, `VITE_*`), never
  logged.
- Enforce **minimum entropy** for signing keys (≥ 32 bytes) in the env schema; a
  weak/missing secret should **fail boot**.
- Have a **rotation plan**. Rotating a JWT signing secret invalidates outstanding
  tokens and must be coordinated across all verifiers (see the SSO security
  notes). Encryption-at-rest keys generally must **not** change once data is
  encrypted.

## Data protection

- **Encrypt sensitive data at rest** (PII, secrets, MFA seeds) with AES-256-GCM
  or the platform KMS; store keys separately from data.
- **Minimize and redact PII** in logs and error payloads (see logging redaction
  below). Don't return more user data than the caller needs.
- Apply least-privilege DB credentials (the app role shouldn't be able to DROP).

## Logging & error hygiene (security side)

- **Redact secrets in logs**: authorization headers, cookies, `password`,
  `token`, `secretKey`, `*.passwordHash`, card/PII fields. Configure redaction in
  the logger, not by remembering to omit them.
- **No internal detail on 5xx** to clients — generic message + correlationId;
  full detail server-side only.
- **Audit-log security events**: logins, failed auth, permission changes,
  privileged/admin actions, with actor + correlationId.

## Dependencies & build

- Pin/lockfile dependencies; run vulnerability scanning (`npm/pnpm audit`,
  `dotnet list package --vulnerable`, Dependabot/Snyk) in CI.
- Don't ship dev dependencies or source maps to production images.
- Run the container as a **non-root** user; minimal base image; no secrets baked
  into layers.

## Security Definition of Done

- [ ] Identity via SSO; data keyed on `finclusionId`; no homegrown auth store.
- [ ] Auth required by default; public routes explicit; per-resource authZ; no IDOR.
- [ ] Argon2id for any stored passwords; refresh rotation + reuse detection + revoke-all.
- [ ] All input schema-validated, unknown fields rejected; queries parameterized.
- [ ] HTTPS; Helmet headers; strict CORS allow-list; body size limits.
- [ ] Global + per-route rate limiting; lockout on auth abuse.
- [ ] Secrets from vault/env, min-entropy enforced at boot, never logged.
- [ ] Sensitive data encrypted at rest; logs redact secrets/PII.
- [ ] Generic 5xx messages + correlationId; security events audited.
- [ ] Dependencies scanned; non-root minimal container.
