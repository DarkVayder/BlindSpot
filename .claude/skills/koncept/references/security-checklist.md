# Security checklist

Organized roughly by OWASP Top 10 categories plus the ones that come up disproportionately
often in real reviews. Not every category applies to every change — scan for the ones relevant
to what's being reviewed (a UI-only change doesn't need injection analysis; an endpoint that
touches money or auth needs almost all of them).

Every finding here gets a severity (Critical / High / Medium / Low) and a concrete exploit
scenario — not just the category name.

## Secrets and configuration

- API keys, tokens, private keys, DB credentials, or webhook secrets committed to source,
  hardcoded in code, or logged (including in error messages/stack traces sent to a client or a
  log aggregator).
- Secrets read from environment/config the same way the rest of the codebase does — a new
  ad-hoc parsing path is a red flag (it's an easy place to introduce a bug like mishandling
  special characters in a password, or accidentally defaulting to an insecure fallback).
- Default credentials, debug/admin backdoors, or bypass flags that could ship enabled in
  production.

## Authentication & authorization

- Every new endpoint/route: is it actually behind the auth middleware/decorator the rest of
  the app uses, or does it silently skip it (missing annotation, wrong middleware order, route
  registered outside the protected group)?
- **Broken object-level authorization (IDOR):** does the endpoint check that the authenticated
  user actually owns/may access the specific resource ID they passed, or does it just check
  "are you logged in" and then trust the ID? This is the single most common real-world API
  vulnerability — check it explicitly on every endpoint that takes an ID.
- Role/permission checks: are they enforced server-side, not just hidden in the UI? A
  frontend that hides a button is not access control.
- Session/token handling: expiry, revocation on logout/password change, secure storage
  (not localStorage for anything highly sensitive if the app has an alternative; if it does use
  localStorage, that's an existing pattern to note, not necessarily reinvent).
- Password/credential handling: hashed with a modern algorithm (bcrypt/argon2/scrypt), never
  logged or returned in API responses.

## Input validation & injection

- SQL/NoSQL injection: raw string concatenation into a query instead of parameterization/ORM.
- Command injection: user input passed to a shell command, subprocess call, or `eval`.
- Path traversal: user-controlled input used to build a file path without normalization/allow-
  listing.
- XSS: user-controlled data rendered without escaping/sanitization, `dangerouslySetInnerHTML`
  or equivalent used with untrusted input.
- SSRF: server makes an outbound request to a URL that's wholly or partially user-controlled,
  without restricting scheme/host.
- Deserialization of untrusted data with an unsafe deserializer.
- **Numeric/financial input:** bounds checking on amounts (no negative values where they'd
  invert a transaction's direction, no unbounded upper values, correct decimal/currency
  precision — not raw floats). This is worth checking even when "input validation" in general
  looks fine, because financial amount bugs are high-severity and easy to miss in a generic
  scan.

## External integrations & webhooks

- Any inbound webhook: is the signature/HMAC verified before the payload is trusted and acted
  on? A webhook handler that processes the body before verifying the signature (or that
  verifies but still proceeds on failure) is a critical finding.
- Outbound calls to third-party APIs: are their credentials scoped appropriately, is the
  response validated before being trusted (don't assume a 200 means the business operation
  actually succeeded — check the response body's own status/error fields), and are timeouts/
  retries sane (no unbounded retry loop, no missing timeout that can hang a request thread)?
- **Idempotency on mutating financial/critical operations** (charge, transfer, settle, create-
  order): can the same request replay (client retry, webhook redelivery, double-click) cause a
  duplicate effect? Look for an idempotency key, a unique constraint, or an existing-state
  check before the mutation.

## Data handling & privacy

- PII/KYC data (names, IDs, government ID numbers, biometric data, financial account numbers):
  encrypted at rest if the codebase has a pattern for that, not logged in plaintext, not
  returned in API responses beyond what the specific caller needs.
- Data minimization: does a response include more fields than the consumer actually needs
  (e.g. returning a full user record including sensitive fields to a public-facing list view)?

## Rate limiting & abuse

- Sensitive/expensive endpoints (login, OTP/code send, password reset, anything hitting a
  paid third-party API) — is there rate limiting, or can they be hit in a tight loop?
- Enumeration: does an error message (e.g. "user not found" vs "wrong password") leak whether
  an account/resource exists?

## Dependencies

- New dependency added: does it come from a legitimate, actively maintained source? Flag
  anything pulled from an unusual registry/URL or with a suspicious name close to a popular
  package (typosquatting risk) — don't just accept it because it's in a manifest file already.
- Known-vulnerable version pinned (only worth flagging if you can actually check — don't guess
  CVEs from memory).

## Logging & error handling

- Stack traces or internal error details returned to the client in production paths (info
  disclosure).
- Sensitive data (tokens, passwords, full card/account numbers, KYC documents) appearing in
  logs.
