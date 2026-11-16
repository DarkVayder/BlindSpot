# Contributing to Blindspot

## Setup

You need Node.js 24 or newer (see `.nvmrc`), pnpm 10 and git 2.31 or newer.

```bash
pnpm install --frozen-lockfile
pnpm check
```

`pnpm check` runs everything CI runs: format check, lint, typecheck, build and tests. Run it
before every pull request. On Windows, one test that needs symbolic links is skipped unless
Developer Mode is on.

## Layout

| Path                 | What it is                                                                                     |
| -------------------- | ---------------------------------------------------------------------------------------------- |
| `packages/core`      | Schemas (config, evidence, results), the scoring model, glob matching and report comparison.   |
| `packages/git`       | The hardened git runner, the streaming log parser, file listing and blob reading.              |
| `packages/analyzers` | File selection, binary and generated detection, TS/JS complexity and the import graph.         |
| `packages/engine`    | Composes git, analyzers and core into one `AnalysisResult`, and loads configuration.           |
| `packages/report`    | Terminal, JSON and standalone HTML output, with escaping for hostile names.                    |
| `packages/cli`       | The `blindspot` command. This is what gets published, bundled with everything above.           |
| `packages/research`  | The Stage 2 validation pipeline. Development only, never published.                            |
| `scripts/`           | `release.js` builds the npm package; `smoke-test.js` checks it after installation.             |
| `docs/`              | Architecture, threat model, scoring model, research protocol and report, and decision records. |

[docs/architecture.md](docs/architecture.md) explains how the pieces fit together.

## Rules the code depends on

- **Repositories are untrusted.** Run git only through `packages/git` (`runGit` or
  `streamGit`), which uses an argument array, never a shell, and disables hooks, filters
  and repository-controlled configuration. Never execute or import anything from an
  analyzed repository. Configuration is JSON only.
- **No network in the CLI.** A test fails if analysis opens a socket. Only the research
  `fetch` command may use the network.
- **Evidence and inference stay apart.** Collectors produce evidence with explicit
  `missing` markers. Only `packages/core/src/model` turns evidence into scores. Missing
  evidence is never treated as zero.
- **Output is deterministic.** The same commit, configuration and model version give
  byte-identical JSON. "Now" is the analyzed commit's time, never the clock.
- **Any change that can alter an output value bumps the model version**
  (`MODEL_VERSION` in `packages/core`) and is explained in
  [docs/scoring-model.md](docs/scoring-model.md).
- **No predictive claims.** The score is a descriptive attention index
  ([ADR 0008](docs/decisions/0008-descriptive-not-predictive.md)). A test fails on wording
  such as "predicts" or "bug-prone" in product copy.
- **Files and people.** Reports describe files. Never rank or name individual developers.

## Tests

- Tests sit next to the code as `*.test.ts` and run with Vitest. Git behaviour is tested
  against real temporary repositories built with `TestRepo`.
- The engine has a golden report (`packages/engine/src/__golden__/basic.json`). If you
  change output on purpose, regenerate it with `BLINDSPOT_UPDATE_GOLDEN=1 pnpm test`, then
  review the diff.
- `docs/cli.md`, `docs/configuration.md` and the package README are checked against the
  CLI's real options, exit codes and configuration schema. Update them in the same change.
- Repository hygiene tests reject invisible control, bidi and BOM characters anywhere in
  the source and docs.

## Commits and decisions

- Commit subjects follow Conventional Commits, for example `feat(engine): …` or
  `fix(report): …`.
- Decisions that are costly to reverse get a short record in
  [docs/decisions](docs/decisions/README.md).
- Update the relevant doc in the same change as the code.

## Releasing

1. Update `CHANGELOG.md` and the version in `packages/cli/package.json`.
2. Run `pnpm release:pack`. It builds the workspace, bundles the CLI into
   `release/package`, packs it, and prints the tarball's SHA-256. The same commit gives the
   same hash on Windows and Linux.
3. Run `pnpm release:smoke release/<tarball>.tgz`. It installs the tarball into an empty
   project and checks every command.
4. Publish with the **Release** workflow in GitHub Actions. It repeats steps 2 and 3, then
   publishes with npm provenance. The npm name comes from `release.json`.
