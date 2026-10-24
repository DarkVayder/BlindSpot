# Stage Plan and Acceptance Criteria

Each stage ends with a report: the features built, important files and decisions, the exact commands run with their results, known limitations, and the next stage's criteria. A stage is complete only when every gate item below has actually been run and passed.

**Release checkpoint:** Stages 1–2 together make **v0.1 — local CLI**. Hosted work (Stages 3+) starts only after the Stage 2 research report says whether the score carries any signal.

---

## Stage 0 — Audit and architecture ✅ (this branch)

Deliverables: [architecture](architecture.md), [threat model](threat-model.md), [scoring model](scoring-model.md), this plan, [decisions](decisions/), [blockers](blockers.md).

Gate:
- [x] The plan matches the actual repository (empty, greenfield).
- [x] No unresolved *critical* design decisions for Stages 1–2. Open hosted-side items are listed in `blockers.md` and none of them block Stages 1–2.

## Stage 1 — CLI and core engine

Scope: packages `core`, `git`, `analyzers`, `engine`, `report` and `cli`. Workspace tooling: tsconfig, ESLint, Prettier, Vitest and a GitHub Actions CI file.

Work order:
1. Workspace scaffold, CI script, lint/format/typecheck passing on an empty package.
2. `core`: schemas, config schema, model constants, scoring functions and their unit and property tests.
3. `git`: safe runner (see threat model §3.1), log/numstat parser with rename chains, shallow-clone detection. Integration tests use real temporary repos with scripted histories (fixed author dates, renames, deletions, binaries, merges).
4. `analyzers`: file discovery and exclusion, binary and generated detection, TS/JS complexity, import graph.
5. `engine`: composes the above into an `AnalysisResult` and reports coverage.
6. `report`: terminal, JSON (with a versioned schema) and standalone HTML (no external requests, strict CSP).
7. `cli`: the `analyze`, `compare` and `init` commands, plus `--json`, `--html`, `--baseline`, `--fail-on`, `--verbose` and `--config`, with documented exit codes.
8. Docs: README quick start, CLI reference, config reference.

Gate:
- [ ] `pnpm install --frozen-lockfile && pnpm build && pnpm test` passes on a fresh clone (Windows locally and Linux in CI).
- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm format:check` are clean.
- [ ] Integration tests cover: renamed, deleted, binary and new files; a shallow clone (reported as incomplete); an empty repo; a non-repo directory (actionable error); and malicious file names.
- [ ] Golden test: a fixture repo produces byte-identical JSON across two runs and across operating systems.
- [ ] Network-isolation test: the CLI completes with outbound network blocked.
- [ ] HTML report escaping test with hostile paths.
- [ ] Smoke test: the CLI analyzes this repository and one real public repository, and the output is checked by hand for plausibility.

## Stage 2 — Scoring validation and research pipeline

Scope: package `research`, with reproducible snapshots and outcome labels.

- Repository selection: documented inclusion criteria (language mix, size bands, activity, license). The list and commit SHAs are pinned in `research/datasets/*.json`.
- Snapshots: score files as of commit `T`, then label outcomes in `(T, T+180d]`.
- Outcome labels (not used by the model):
  - bug-fix commits, identified by message heuristics plus linked-issue labels where available
  - reverts
  - each label heuristic is documented, with a measured precision on a hand-labelled sample
- Analysis:
  - rank correlation and logistic regression with controls (file size, prior churn, file age, repo fixed effects)
  - bootstrap confidence intervals
  - a comparison against trivial baselines (LOC alone, churn alone)
  - **the score has to beat the baselines to be worth anything**
- Output: aggregate CSV/JSON exports with provenance (tool version, dataset hash, timestamps) and a limitations section.

Gate:
- [ ] Re-running the pipeline on the pinned dataset reproduces identical aggregates.
- [ ] At least 6 repositories covering at least 3 languages, small/medium/large sizes, and both active and dormant projects.
- [ ] Missing-data handling verified (shallow history, unsupported languages).
- [ ] Product copy contains no claim of predictive accuracy unless the report supports it. A grep-based CI check flags forbidden phrases.
- [ ] Decision recorded: keep, recalibrate or rethink the model, with a model version bump if anything changed.

## Stage 3 — Backend and data model

Scope: `db` (Prisma), `apps/web` API layer, GitHub sign-in, tenant-scoped repositories, the job table and queue (pg-boss), and `apps/worker` skeleton running `engine` on local paths.

Gate:
- [ ] Migrations apply from an empty database. A down/rollback procedure is documented and tested.
- [ ] Integration tests run against real Postgres (Docker) and pass.
- [ ] A cross-tenant access test runs for every route and every request is rejected.
- [ ] Job idempotency: enqueueing the same key twice produces one result.
- [ ] Pagination is tested on large result sets.

## Stage 4 — GitHub App and webhooks

Gate:
- [ ] A valid signed delivery is processed. An invalid signature is rejected with 401 before the body is parsed.
- [ ] A duplicate delivery ID causes no duplicate job and no duplicate comment.
- [ ] After revocation or uninstall, no further API calls are made and data deletion is scheduled and verified.
- [ ] Rate-limit (403/429 with reset) handling and retries are tested.
- [ ] PR comments are off by default. When enabled, a single comment is updated in place.
- [ ] End to end on a real test GitHub App installed on a sandbox repo (needs credentials, see blockers).

## Stage 5 — Dashboard and visualization

Gate:
- [ ] Every screen reads the real API. A grep check confirms no fixture or mock imports in production builds.
- [ ] The empty, loading, error and insufficient-data states render and are tested.
- [ ] Keyboard navigation works across the explorer and treemap, which has a table fallback. Automated axe checks find no serious or critical issues.
- [ ] The file explorer stays responsive with 50k files (virtualized).
- [ ] No per-developer rankings exist anywhere in the UI.

## Stage 6 — End-to-end hardening

Gate:
- [ ] A Playwright E2E test covers install → webhook → analysis → dashboard → uninstall → deletion.
- [ ] Malicious-repo test suite (threat model §3.1) passes on the worker.
- [ ] `pnpm audit`, container scan (Trivy) and `next build` pass. Performance budget recorded.
- [ ] No open critical or high defects, or each one is documented with an approved mitigation.

## Stage 7 — Deployment and release

Gate:
- [ ] A staging deploy from clean documented steps succeeds and health checks pass.
- [ ] Migration on staging is verified. Rollback is rehearsed.
- [ ] A backup restore is rehearsed.
- [ ] Monitoring, alerting and error tracking are receiving events.

## Stage 8 — Release readiness

Gate:
- [ ] Docs are complete for someone who has never seen the source: CLI help, config reference, security policy, privacy requirements, contributing guide, changelog and license review.
- [ ] Sample reports are labelled as real (with the repo named) or synthetic.
- [ ] The research report is published only if Stage 2 results support it.
- [ ] A release reproduced from a clean checkout matches the published artifacts.
