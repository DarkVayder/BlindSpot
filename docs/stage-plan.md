# Stage Plan and Acceptance Criteria

Each stage ends with a report: the features built, important files and decisions, the exact commands run with their results, known limitations, and the next stage's criteria. A stage is complete only when every gate item below has actually been run and passed.

**Release checkpoint:** Stages 1–2 together make **v0.1 — local CLI**. Hosted work (Stages 3+) starts only after the Stage 2 research report says whether the score carries any signal.

---

## Stage 0 — Audit and architecture ✅ (this branch)

Deliverables: [architecture](architecture.md), [threat model](threat-model.md), [scoring model](scoring-model.md), this plan, [decisions](decisions/), [blockers](blockers.md).

Gate:

- [x] The plan matches the actual repository (empty, greenfield).
- [x] No unresolved _critical_ design decisions for Stages 1–2. Open hosted-side items are listed in `blockers.md` and none of them block Stages 1–2.

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

- [x] `pnpm install --frozen-lockfile && pnpm build && pnpm test` passes on a fresh clone (Windows locally and Linux in CI).
      Windows 11, Node 24: 244 passed, 1 skipped (symlink test needs developer mode). Linux (`node:24-bookworm` container, standing in for CI until the repository has a remote): 245 passed.
- [x] `pnpm lint`, `pnpm typecheck` and `pnpm format:check` are clean on both operating systems.
- [x] Integration tests cover: renamed, deleted, binary and new files; a shallow clone (reported as incomplete); an empty repo; a non-repo directory (actionable error); and malicious file names.
- [x] Golden test: a fixture repo produces byte-identical JSON across two runs and across operating systems.
      The committed golden file passes on Windows and Linux. A real repository (sindresorhus/ky, 592 commits) also gives byte-identical JSON on both.
- [x] Network-isolation test: the CLI completes with outbound network blocked.
      An in-process test fails on any socket. The built CLI also analyzed ky and this repository in a `docker run --network none` container (loopback only).
- [x] HTML report escaping test with hostile paths, plus an end-to-end test that commits hostile names to git and checks every output.
- [x] Smoke test: the CLI analyzes this repository and one real public repository, and the output is checked by hand for plausibility.
      For sindresorhus/ky (115 files, 8.7 s), the top-ranked files are the request core and body/merge helpers. There are no AI markers, which the trailers confirm. The baseline from 60 commits earlier gives exit 1 under `--fail-on new-elevated`, and the 43 new files match git.

## Stage 2 — Scoring validation and research pipeline

Scope: package `research`, with reproducible snapshots and outcome labels. The analysis is fixed in advance by [research-protocol.md](research-protocol.md).

Work order:

1. Research protocol, written before any outcome data.
2. Engine: score a repository at a pinned commit without checking it out.
3. `research fetch` and the pinned dataset.
4. `snapshot` and `label`.
5. `sample` and label precision.
6. Statistics, checked against reference values from statsmodels.
7. Export, the forbidden-phrases check and a reproducibility re-run.
8. Keep, recalibrate or rethink decision.

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

- [x] Re-running the pipeline on the pinned dataset reproduces identical aggregates.
      A full re-run of `snapshot`, `quality` and `analyze` on Windows reproduced all 20 snapshot files and 3 result files byte for byte. A run on Linux, with a different git version (2.39.5 against 2.51.0), matched all 23 files once the recorded git version is set aside. Both re-runs used the existing clones, so `fetch` itself was not repeated.
- [x] At least 6 repositories covering at least 3 languages, small/medium/large sizes, and both active and dormant projects.
      10 repositories in TypeScript, JavaScript, Python and Go: 7 small, 2 medium and 1 large, with both active and dormant projects.
- [x] Missing-data handling verified (shallow history, unsupported languages).
      An end-to-end test covers both: a shallow clone reports every file as unranked with a warning, and the analysis leaves it out of pooling without failing. Unsupported languages report complexity as missing and are scored from history. In the real `T1` data, all 3,015 Python and Go files report complexity as missing, and all but one still have a score.
- [x] Product copy contains no claim of predictive accuracy unless the report supports it. A grep-based CI check flags forbidden phrases.
      The report does not support any such claim. `packages/core/src/hygiene.test.ts` fails the build on predictive wording in the README, user docs and the core, engine, report and CLI sources.
- [x] Decision recorded: keep, recalibrate or rethink the model, with a model version bump if anything changed.
      Rethink ([ADR 0008](decisions/0008-descriptive-not-predictive.md)). The score is kept unchanged as a descriptive attention index, so no output value changed and the model version stays `bs-risk@0.1.0`. Results are in [research-report.md](research-report.md).

> **Stages 3–8 are paused** ([ADR 0008](decisions/0008-descriptive-not-predictive.md)). Stage 2 found no signal beyond file size and churn, and ADR 0006 made the hosted work depend on one. They resume only after a product direction is chosen.

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

While Stages 3–7 are paused, this gate covers the CLI alone ([ADR 0009](decisions/0009-release-the-cli-alone.md)).

Gate:

- [x] Docs are complete for someone who has never seen the source: CLI help, config reference, security policy, privacy requirements, contributing guide, changelog and license review.
      README, the npm README, [CLI](cli.md) and [configuration](configuration.md) references, `SECURITY.md`, `CONTRIBUTING.md`, `CHANGELOG.md` and `LICENSE` (MIT). Tests keep the CLI reference and package README in step with `--help` and the exit codes, and the configuration reference with the schema. Bundled licenses (commander, zod: MIT) are reproduced in `THIRD_PARTY_NOTICES.md`, and the runtime dependency `typescript` is Apache-2.0. Privacy for the CLI is a statement (no network, no telemetry), which a test enforces. A legal privacy policy (B7) is needed only for the hosted product.
- [x] Sample reports are labelled as real (with the repo named) or synthetic.
      [docs/samples](samples/README.md) holds real HTML and JSON reports for sindresorhus/ky at a pinned commit, named in the README and regenerated byte for byte by `scripts/samples.js`.
- [x] The research report is published only if Stage 2 results support it.
      The [research report](research-report.md) is a negative result, stated as one, and no product copy claims more than it shows.
- [ ] A release reproduced from a clean checkout matches the published artifacts.
      Ready but not yet possible: clean builds on Windows and Linux give the same tarball SHA-256, and the release workflow publishes only that tarball. It can be checked once the package is published (needs B1 and a GitHub remote).
