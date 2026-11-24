# Blindspot

**Know the code.**

Blindspot maps every file in a git repository by the things that make code hard to understand and change: complexity, recent change pressure, how concentrated or stale the knowledge of it is, explicit AI provenance and how much of the codebase depends on it. It combines them into an _attention index_ for sorting files to review. Every value comes with the evidence behind it, a confidence level, and a list of what it could not observe. It describes files, never developers.

> **What the index is not.** It is not a prediction of defects. In a registered validation study on 10 open-source repositories, the index ranked files that later received bug fixes below file size alone (mean AUC 0.62 against 0.82). See the [research report](docs/research-report.md) and [ADR 0008](docs/decisions/0008-descriptive-not-predictive.md).

> **Status:** version 0.1.0 of the local CLI. The npm package is built and tested but not yet published, so run it from a clone as shown below. The hosted product is paused.

## Quick start

You need Node.js 24 or newer, git 2.31 or newer, and pnpm 10.

```bash
git clone https://github.com/DarkVayder/BlindSpot.git blindspot
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

Once the package is published, `npx <package-name> analyze .` will do the same without cloning.

### In CI

Use the [GitHub Action](docs/github-action.md): it writes a job summary on every pull request and compares it with the commit it branched from. To run the CLI yourself instead:

Run the analysis on full history (`fetch-depth: 0` with `actions/checkout`). On a shallow clone, every file reports insufficient evidence. To fail only when a change moves files into a higher band, keep a JSON report from your main branch as a baseline:

```bash
node packages/cli/dist/bin.js analyze . --baseline main-blindspot.json --fail-on new-elevated
```

Files with insufficient evidence never fail a build.

## What it measures

| Signal                  | Evidence                                                                                                       | Languages     |
| ----------------------- | -------------------------------------------------------------------------------------------------------------- | ------------- |
| Complexity              | Cyclomatic and cognitive complexity, and lines of code                                                         | TS/JS only    |
| Change pressure         | Lines changed and commits in the last 90 days                                                                  | All           |
| Knowledge concentration | Share of changes by the top contributor, share by contributors inactive for 180 days, time since change        | All           |
| Explicit AI provenance  | Recent changes from known agent identities (for example `Co-authored-by` an AI tool), never guessed from style | All           |
| Impact                  | How many files import this one, directly or transitively, or paths you mark as critical                        | TS/JS imports |

For other languages, complexity and imports are reported as missing, and the index uses the history-based signals. Review evidence is not available from local git, so it is always reported as missing.

## Reading a report

- **Attention index (0–100):** the weighted average of the signal groups that have evidence, scaled down by up to 40% for files that little depends on. It is relative to the other files in the same repository, so it is not comparable across repositories.
- **Band:** Low (0–24), Moderate (25–49), Elevated (50–74) or High (75–100).
- **Confidence (0–1):** how much of the evidence was available, and how much history the file has. Below 0.4 a file is shown as **Insufficient evidence** and is never ranked. Between 0.4 and 0.7 it is marked as limited evidence.
- **Explanations, limitations and suggested actions:** generated only from observed evidence, such as "Total cognitive complexity is 86 (top 2% in this repository)."

See the [scoring model](docs/scoring-model.md) for exactly how the index is computed.

## Privacy

Blindspot runs entirely on your machine. It makes no network requests, collects no telemetry, and never uploads code, paths or history. It reads file contents and history from your current commit with git, never from uncommitted changes. The configuration file is read from the working tree, so you can try changes before committing them. It never runs hooks, filters or any other code from the repository it analyzes, and its configuration is JSON only.

## Documentation

- [CLI reference](docs/cli.md), [configuration reference](docs/configuration.md) and [GitHub Action](docs/github-action.md)
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
