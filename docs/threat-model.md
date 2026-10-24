# Blindspot Threat Model

Status: Stage 0 draft · Method: STRIDE per trust boundary · Last updated: 2026-10-24

This document is updated at every stage gate. Each mitigation names the stage that must
implement and test it.

## 1. Assets

| Asset | Sensitivity |
| --- | --- |
| Customer source code (worker clones, local repos) | Critical — must never be persisted or transmitted beyond the job. |
| GitHub App private key, webhook secret, OAuth client secret | Critical. |
| Installation access tokens, user session tokens | High. |
| Analysis results (paths, metrics, author counts) | Medium–high: paths and commit metadata can reveal unreleased product details. |
| Audit logs | Medium; integrity matters more than confidentiality. |

## 2. Trust boundaries

1. **Repository content → analyzer** (CLI and worker). Repos are untrusted, including the user's own (supply-chain).
2. **GitHub → webhook endpoint.** Payloads are untrusted until signature-verified, and remain untrusted *data* afterwards.
3. **Browser → web app.** Authenticated users may attempt cross-tenant access.
4. **Worker → GitHub API.** Tokens must be scoped to one installation and repo.
5. **App → database.** Every query must be tenant-scoped.

## 3. Threats and mitigations

### 3.1 Malicious repository (boundary 1)

| Threat | Mitigation | Stage |
| --- | --- | --- |
| Command injection via file names, branch names, refs, or config values | Git is invoked only with `execFile` and an argv array, never a shell. Every path argument is passed after `--`. Ref names are validated against `git check-ref-format`. | 1 |
| Repo-controlled git config runs code (`core.fsmonitor`, `core.hooksPath`, `diff.external`, filters, `core.sshCommand`) | Git runs with `-c core.fsmonitor=false -c core.hooksPath=<empty temp dir> -c diff.external= --no-ext-diff --no-textconv` (an empty directory rather than `/dev/null`, so it also works on Windows), `GIT_CONFIG_NOSYSTEM=1`, and `GIT_TERMINAL_PROMPT=0`. On the worker, clones are done with `--no-checkout` where possible, and LFS smudge and submodule recursion are disabled. | 1 / 4 |
| `blindspot.config.*` executing code | Config is **JSON only**, validated by Zod. A `.ts`/`.js` config is not supported, because importing it would execute repo code. | 1 |
| Resource exhaustion (huge files, millions of commits, deep import chains, symlink loops, zip-bomb-like generated files) | Per-file size cap for parsing, plus a cap on commits read (configurable). Timeouts on each git process. Symlinks are not followed. The dependency graph uses iterative traversal with cycle detection. Limits that are hit are reported as `incomplete` coverage, never silently truncated. | 1 |
| Path traversal (`../`, absolute paths, case-folding collisions on Windows) | Only paths from `git ls-files -z` are used. They are resolved and must stay inside the repo root, and are normalized to POSIX form in output. | 1 |
| Script or HTML injection into the HTML report via file paths or commit messages | Every interpolated value is HTML-escaped. Data is embedded as JSON inside `<script type="application/json">` with `<` escaped. The report carries a strict CSP meta tag and contains no inline event handlers. Commit messages are not included in reports. | 1 |
| Prompt-injection text in repo content or PR descriptions | No LLM sees repo content in v1. Repo text is never treated as instructions or commands. | All |

### 3.2 Webhook ingestion (boundary 2)

| Threat | Mitigation | Stage |
| --- | --- | --- |
| Forged events | HMAC-SHA256 over the **raw** body with `X-Hub-Signature-256`, compared in constant time. The request is rejected before parsing. | 4 |
| Replay or duplicate delivery | `X-GitHub-Delivery` has a unique constraint. A duplicate returns 200 and causes no new work. Job keys are idempotent (`repo:headSha:modelVersion`). | 4 |
| Oversized or malformed payloads | Body size limit, Zod validation of the fields we use, and unknown events acknowledged and ignored. | 4 |
| Event for an uninstalled or suspended installation | Installation status is checked on every job. Revocation marks the installation `revoked`, cancels its jobs and schedules data deletion. | 4 |

### 3.3 Web application (boundary 3)

| Threat | Mitigation | Stage |
| --- | --- | --- |
| Cross-tenant data access (IDOR) | All data access goes through a repository layer that requires an `orgId` derived from the session, never from the request. Integration tests cover cross-tenant reads and writes for every route. | 3 |
| Stale permissions (a user loses GitHub repo access) | Repo access is re-verified against GitHub on session refresh and cached for a short time. | 3 / 4 |
| CSRF | SameSite=Lax `__Host-` cookies. State-changing routes require POST plus an origin check. | 3 |
| XSS | React escaping, no `dangerouslySetInnerHTML`, strict CSP with nonces, and security headers. | 5 |
| Abuse or brute force | Per-IP and per-user rate limits on auth, API and webhook routes. | 3 / 6 |

### 3.4 Secrets and tokens (boundary 4)

| Threat | Mitigation | Stage |
| --- | --- | --- |
| Private key leak | Provided via a secret manager or env var, never committed (`.gitignore` covers `*.pem`/`.env`), never logged, and rotation documented. | 4 / 7 |
| Over-privileged token | Installation tokens are minted per job, restricted to the single repository and the minimum permissions, and never stored. | 4 |
| Token in logs or errors | A structured logger with a redaction list (`authorization`, `token`, `key`, `secret`, `cookie`, URLs with credentials). Errors are mapped to safe messages at boundaries. | 3 |

### 3.5 Data at rest (boundary 5)

| Threat | Mitigation | Stage |
| --- | --- | --- |
| Source code persisted accidentally | The DB schema has no column for file contents. A test asserts that analysis snapshots contain no content fields. Worker temp dirs are deleted in `finally` blocks and by a startup sweep. | 3 / 4 |
| Data retained after uninstall | A deletion job removes all repo data within a documented window. Audit log entries are kept without repo metadata. | 4 |
| Backup exposure | Managed Postgres with encryption at rest. Backups are encrypted and the restore procedure is tested. | 7 |

## 4. Privacy commitments enforced in code

- The CLI makes **no network calls**. A Stage 1 test runs the CLI with network access blocked and must pass.
- There is no telemetry in v1. If telemetry is ever added, it must be opt-in and exclude paths, names and contents.
- Author identities are used only to compute *counts* and *concentration* per file. Reports and the dashboard never rank or name individual developers.
