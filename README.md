# Blindspot

**Know the code. Own the risk.**

Blindspot estimates file-level _comprehension risk_: which files in a repository are likely to be hard to understand, modify safely and maintain. Every score comes with the evidence behind it, a confidence level, and a list of what it could not observe. It measures files, never developers.

> **Status:** Stage 1 (local CLI). It is not yet published to npm, so run it from a clone as shown below. The scoring model's weights are uncalibrated priors until Stage 2. Treat scores as prompts for investigation, not verdicts.

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
