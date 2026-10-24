# Blockers and Open Decisions

Last updated: 2026-10-24. None of these block Stages 1–2.

| # | Item | Needed by | Impact if unresolved | Owner |
| --- | --- | --- | --- | --- |
| B1 | **npm package name.** `blindspot`, `@blindspot/cli` and `blindspot-cli` are already taken on npm. A scope is needed (for example `@<your-scope>/blindspot`) and must be confirmed available before publishing. The command can still be named `blindspot`. | Stage 8 publish | `npx blindspot` cannot work as written in the brief. Development uses a placeholder workspace name. | User |
| B2 | Test GitHub App registration: app ID, private key, webhook secret, and a sandbox org or repo. | Stage 4 gate | The webhook end-to-end test cannot run against real GitHub. Signature and dedupe logic can still be unit and integration tested. | User |
| B3 | Hosting provider for web, worker and managed Postgres. | Stage 7 | No staging environment. Docker Compose provides the local equivalent. | User (decision) |
| B4 | Error-tracking vendor (for example Sentry or a self-hosted alternative). | Stage 6/7 | Structured logs only. | User (decision) |
| B5 | Domain name and TLS for the hosted app and the webhook URL. | Stage 4 (tunnel ok) / 7 | A dev tunnel can be used for Stage 4. | User |
| B6 | License choice for the CLI if it is open-sourced later. | Stage 8 | The repo stays private and unlicensed. Dependencies are restricted to permissive licenses so any choice remains open. | User |
| B7 | Privacy policy and terms (legal text). | Stage 8 (hosted) | Engineering documents the data flows. The legal text must come from the user or counsel. | User |
| B8 | Research dataset: whether to include Python, Go or Java repos when complexity is TS/JS-only in v1. | Stage 2 | Those repos would evaluate the history-only signals. This is acceptable and will be documented. | Resolved: include, stratify by language |
