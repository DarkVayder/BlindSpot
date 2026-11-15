# Blindspot

**Know the code.**

Blindspot maps every file in a repository by the things that make code hard to understand and change: complexity, change pressure, how concentrated or stale the knowledge of it is, explicit AI provenance and how much depends on it. It combines them into an _attention index_ for sorting files to review. Every value comes with the evidence behind it, a confidence level, and a list of what it could not observe. It measures files, never developers.

> **What the index is not.** It is not a prediction of defects. In a registered validation study on 10 open-source repositories, the index ranked files that later received bug fixes below file size alone (AUC 0.62 against 0.82). See the [research report](docs/research-report.md) and [ADR 0008](docs/decisions/0008-descriptive-not-predictive.md).

> **Status:** local CLI (Stages 1–2). It is not yet published to npm, so run it from a clone as shown below. Treat the index as a way to choose where to look, not as a verdict.

## Quick start

You need Node.js 24 or newer, git 2.31 or newer, and pnpm 10.

```bash
git clone <this repository> blindspot
cd blindspot
pnpm install --frozen-lockfile
pnpm build
```

Then analyze any git repository. It runs entirely on your machine, and source code is never uploaded.

```bash
node packages/cli/dist/bin.js analyze /path/to/your/repo
```

Write the full reports as well:

```bash
node packages/cli/dist/bin.js analyze /path/to/your/repo --json blindspot.json --html blindspot.html
```

Open `blindspot.html` in a browser. It is a single self-contained file that makes no network requests.

### In CI

Run the analysis on full history (`fetch-depth: 0` with `actions/checkout`). On a shallow clone, every file reports insufficient evidence. To fail only when a change introduces new risk, keep a baseline report from your main branch:

```bash
node packages/cli/dist/bin.js analyze . --baseline main-blindspot.json --fail-on new-elevated
```

Blindspot never blocks on files it lacks evidence for.

## What a score means

- **Score (0–100):** estimated difficulty to understand and change the file safely, relative to the other files in the same repository. Scores are not comparable across repositories.
- **Band:** Low, Moderate, Elevated or High. Files without enough evidence are shown as **Insufficient evidence** and are never ranked.
- **Confidence (0–1):** how much of the evidence the model needs was actually available.
- **Explanations, limitations and suggested actions:** generated only from observed evidence.

See the [scoring model](docs/scoring-model.md) for exactly how scores are computed.

## Documentation

- [CLI reference](docs/cli.md)
- [Configuration reference](docs/configuration.md)
- [Scoring model](docs/scoring-model.md)
- [Architecture](docs/architecture.md)
- [Threat model](docs/threat-model.md)
- [Stage plan and acceptance criteria](docs/stage-plan.md)
- [Decision records](docs/decisions/)
- [Blockers and open decisions](docs/blockers.md)

## Development

```bash
pnpm check
```

This runs formatting, lint, type checking, the build and all tests. Tests create real temporary git repositories, so git must be on your `PATH`.
