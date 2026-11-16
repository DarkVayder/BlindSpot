# Blindspot

**Know the code.**

Blindspot maps every file in a repository by the things that make code hard to understand and change: complexity, change pressure, how concentrated or stale the knowledge of it is, explicit AI provenance and how much depends on it. It combines them into an _attention index_ for sorting files to review. Every value comes with the evidence behind it, a confidence level, and a list of what it could not observe. It measures files, never developers.

> **What the index is not.** It is not a prediction of defects. In a registered validation study on 10 open-source repositories, the index ranked files that later received bug fixes below file size alone (AUC 0.62 against 0.82). See the [research report](docs/research-report.md) and [ADR 0008](docs/decisions/0008-descriptive-not-predictive.md).

> **Status:** version 0.1.0 of the local CLI, ready to publish to npm ([ADR 0009](docs/decisions/0009-release-the-cli-alone.md)). Until it is published, run it from a clone as shown below. The hosted product is paused.

## Quick start

Once published, run it with npx. You need Node.js 24 or newer and git 2.31 or newer.

```bash
npx <package-name> analyze /path/to/your/repo
```

From a clone, you also need pnpm 10:

```bash
git clone <this repository> blindspot
cd blindspot
pnpm install --frozen-lockfile
pnpm build
node packages/cli/dist/bin.js analyze /path/to/your/repo
```

Write the full reports as well:

```bash
node packages/cli/dist/bin.js analyze /path/to/your/repo --json blindspot.json --html blindspot.html
```

Open `blindspot.html` in a browser. It is a single self-contained file that makes no network requests. For an example, see the [sample report for sindresorhus/ky](docs/samples/README.md).

### In CI

Run the analysis on full history (`fetch-depth: 0` with `actions/checkout`). On a shallow clone, every file reports insufficient evidence. To fail only when a change moves files into a higher band, keep a baseline report from your main branch:

```bash
node packages/cli/dist/bin.js analyze . --baseline main-blindspot.json --fail-on new-elevated
```

Blindspot never fails a build because of files it lacks evidence for.

## Reading a report

- **Attention index (0–100):** a weighted summary of complexity, change pressure, knowledge concentration and impact, relative to the other files in the same repository. It sorts files; it is not comparable across repositories.
- **Band:** Low, Moderate, Elevated or High, by index. Files without enough evidence are shown as **Insufficient evidence** and are never ranked.
- **Confidence (0–1):** how much of the evidence the index uses was actually available.
- **Explanations, limitations and suggested actions:** generated only from observed evidence, such as "Total cognitive complexity is 86 (top 2% in this repository)."

See the [scoring model](docs/scoring-model.md) for exactly how the index is computed.

## Privacy

Blindspot runs entirely on your machine. It makes no network requests, collects no telemetry, and never uploads code, paths or history. It reads committed files with git rather than your working tree, and never runs code from the repository it analyzes.

## Documentation

- [CLI reference](docs/cli.md) and [configuration reference](docs/configuration.md)
- [Scoring model](docs/scoring-model.md), [research report](docs/research-report.md) and [research protocol](docs/research-protocol.md)
- [Architecture](docs/architecture.md) and [threat model](docs/threat-model.md)
- [Decision records](docs/decisions/README.md), [stage plan](docs/stage-plan.md) and [blockers](docs/blockers.md)
- [Changelog](CHANGELOG.md), [contributing](CONTRIBUTING.md) and [security policy](SECURITY.md)

## Development

```bash
pnpm check
```

This runs formatting, lint, type checking, the build and all tests. Tests create real temporary git repositories, so git must be on your `PATH`. See [CONTRIBUTING.md](CONTRIBUTING.md) for the layout, rules and release steps.

## License

[MIT](LICENSE).
