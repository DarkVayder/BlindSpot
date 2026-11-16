# Blindspot Architecture

Status: Stages 1–2 built, CLI release prepared, hosted stages paused · Last updated: 2026-11-16

Blindspot describes each file by the signals that make code hard to understand and change,
and sorts files by a descriptive **attention index**. The index is not a prediction of
defects ([ADR 0008](decisions/0008-descriptive-not-predictive.md)). It never measures
individual developers.

## 1. Starting point (Stage 0 audit)

The repository was created empty on 2026-10-24. There is no existing code, test suite,
deployment or environment configuration to preserve. Every decision below is therefore
greenfield and recorded in [`docs/decisions/`](decisions/).

Local toolchain at audit time: Node 24.18 (LTS line), pnpm 10.30, git 2.51, Docker 29.6.
Not installed: `psql`, `gh` (neither is required; Postgres runs in Docker for tests).

## 2. Monorepo layout

pnpm workspaces, strict TypeScript, ESM only. Packages are added in the stage that first
needs them; nothing is scaffolded ahead of use.

```
blindspot/
├─ packages/
│  ├─ core/         Domain types, Zod schemas, config schema, scoring model     (Stage 1)
│  ├─ git/          Safe git process runner + history/blame/numstat parsers     (Stage 1)
│  ├─ analyzers/    File discovery, exclusion, complexity, dependency graph     (Stage 1)
│  ├─ engine/       Orchestrates git + analyzers + core scoring → AnalysisResult(Stage 1)
│  ├─ report/       Terminal, JSON and standalone HTML renderers                (Stage 1)
│  ├─ cli/          Commander entry point (`blindspot analyze`, `compare`, …)  (Stage 1)
│  ├─ research/     Snapshotting, outcome labelling, statistics, exports        (Stage 2)
│  ├─ db/           Prisma schema, migrations, tenant-scoped repositories       (Stage 3, paused)
│  └─ github/       GitHub App auth, webhook verification, PR comment builder   (Stage 4, paused)
├─ apps/
│  ├─ web/          Next.js dashboard + API route handlers                      (Stage 3/5, paused)
│  └─ worker/       pg-boss consumer that runs `engine` on cloned repos         (Stage 3/4, paused)
├─ scripts/         release.js (npm package), smoke-test.js, samples.js
├─ research/        Pinned dataset, labelling sample and aggregate results     (Stage 2)
└─ docs/
```

### Dependency rules

```
core  ←  git, analyzers  ←  engine  ←  report, cli, research, worker
core  ←  db  ←  web, worker
core  ←  github  ←  web, worker
```

- `core` has no I/O and no runtime dependencies except Zod. **All scoring logic lives
  here and only here**, so the CLI, worker and research pipeline cannot diverge.
- UI code (`report`, `web`) renders `AnalysisResult` objects; it never computes scores.
- `engine` is the only package that composes collectors; it is pure orchestration.

## 3. Core domain model

All types are defined as Zod schemas in `core` and inferred into TypeScript.

| Type                 | Purpose                                                                                                                                                                                                                                                  |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BlindspotConfig`    | Validated user config (`blindspot.config.json`): include/exclude globs, extensions, weights, criticality paths, provenance rules, thresholds.                                                                                                            |
| `FileEvidence`       | **Observed facts only** for one file: commits, authors count, churn, last-modified dates, rename chain, complexity metrics, fan-in/fan-out, explicit provenance markers. Each field is `{ status: "observed", value } \| { status: "missing", reason }`. |
| `SignalScore`        | One derived signal (0–1) with the inputs used, normalization method and explanation text.                                                                                                                                                                |
| `FileRisk`           | Score 0–100, confidence 0–1, signals, explanations, limitations, recommended actions, `modelVersion`.                                                                                                                                                    |
| `AnalysisResult`     | Run metadata (tool version, model version, repo HEAD, timestamps, config hash), coverage stats, `FileRisk[]`, warnings. Serialized as the JSON report; versioned schema.                                                                                 |
| `BaselineComparison` | Diff of two `AnalysisResult`s: new/removed files, score deltas, newly elevated files.                                                                                                                                                                    |

The separation between `FileEvidence` (observed) and `SignalScore`/`FileRisk` (inferred) is
the main structural defence against fabricated or over-claimed results.

## 4. Data flow

### 4.1 CLI (Stages 1–2) — fully local

```
blindspot analyze <path>
   │
   ├─ load + validate config (Zod)              → actionable error on failure
   ├─ git: verify repo, HEAD, shallow-clone check
   ├─ git: list files at HEAD (git ls-tree -r -z --long) → analyzers: apply exclusions
   ├─ git: read contents at HEAD (git cat-file --batch, never the working tree)
   │      → analyzers: classify (binary / generated / source)
   ├─ git: one streamed `git log --numstat -M -z` pass → per-file history with renames
   ├─ analyzers: complexity (TS/JS AST; others: none, marked missing)
   ├─ analyzers: dependency graph (TS/JS import resolution) → fan-in, transitive impact
   ├─ core: evidence → signals → score + confidence (deterministic, versioned model)
   └─ report: terminal summary | JSON | standalone HTML
              optional: --baseline <json> → comparison + CI exit code
```

The engine validates its own output against the `AnalysisResult` schema before returning it, so a malformed result is a crash, never a silently wrong report. In local mode, configuration is read from the working tree (`blindspot.config.json`, else the `"blindspot"` key in `package.json`) so it can be tried before it is committed. File contents always come from HEAD. The engine can also analyze a pinned commit instead of HEAD (`revision`, a full commit hash), reading its tree, contents and the history reachable from it without checking anything out. The research pipeline uses this to score past snapshots. The hosted worker (Stage 4) must read configuration from the HEAD commit instead, because it clones without a checkout.

No network access occurs during analysis. File contents are read only to compute
complexity and imports; they are never written to reports — reports contain paths,
metrics and explanations only.

### 4.2 Hosted product (Stages 3–7)

```
GitHub ──webhook──▶ apps/web /api/github/webhook
                       │ verify HMAC-SHA256 (raw body), check delivery-id dedupe table
                       │ persist WebhookDelivery, enqueue job (same transaction)
                       ▼
                    pg-boss queue (Postgres)
                       ▼
                    apps/worker
                       │ mint installation token (scoped to that repo, short-lived)
                       │ shallow-then-deepen clone into an ephemeral temp dir
                       │ run `engine` (same code as CLI)
                       │ store AnalysisResult snapshot (scores + evidence, no source)
                       │ delete clone
                       │ optional: post/update a single PR comment
                       ▼
                    PostgreSQL ◀── apps/web dashboard (tenant-scoped queries)
```

Source code exists on the worker only for the duration of a job and is never persisted
in the database or logs.

## 5. Key technology decisions

| Area            | Choice                                              | Why                                                                             |
| --------------- | --------------------------------------------------- | ------------------------------------------------------------------------------- |
| Package manager | pnpm workspaces                                     | Fast, strict, lockfile already the norm for monorepos.                          |
| Language        | TypeScript `strict`, ESM, Node 24 LTS               | Required by brief; one runtime everywhere.                                      |
| Git access      | System `git` via `execFile` (no shell), `-z` output | Fast on large histories, rename detection, no shell injection.                  |
| Validation      | Zod                                                 | Brief requirement; types inferred from schemas.                                 |
| Complexity (v1) | TypeScript compiler API for TS/JS                   | Accurate, already a dependency. Other languages: history-only signals, flagged. |
| Tests           | Vitest; real temp git repos built by fixtures       | Brief requirement; avoids mocked git.                                           |
| Queue           | pg-boss                                             | Uses existing Postgres; no Redis to operate.                                    |
| ORM / DB        | Prisma + PostgreSQL                                 | Brief requirement.                                                              |
| Web             | Next.js App Router, Tailwind, D3 for treemap        | Brief requirement.                                                              |
| Auth            | GitHub sign-in (GitHub App user-to-server OAuth)    | Users already need GitHub; enables repo-access checks.                          |

See [`decisions/`](decisions/) for full records.

## 6. Extension point: Explain-It-Back (future)

Reserved as a separate bounded context: its own tables, its own API namespace, explicit
per-user opt-in, and results that **never feed `FileRisk`**. The only coupling is that the
dashboard may show, to the developer who opted in, which files they have chosen to
check. No hooks for it are implemented before it is scoped.

## 7. Packaging and release

The workspace packages stay private. `scripts/release.js` bundles `cli` and everything it
imports into one ESM file with esbuild, keeps `typescript` as the package's only runtime
dependency (the complexity analyzer loads its compiler), and writes the license notices for
bundled code. File modes are normalized before `npm pack`, so the tarball is byte-identical
on Windows and Linux. `scripts/smoke-test.js` installs the tarball into an empty project and
checks every command. The release workflow builds on both platforms, requires matching
hashes, and publishes that tarball with npm provenance
([ADR 0009](decisions/0009-release-the-cli-alone.md)).

## 8. Open items

Tracked in [`blockers.md`](blockers.md). The npm scope (B1) blocks publishing the CLI. The
rest apply to the paused hosted stages.
