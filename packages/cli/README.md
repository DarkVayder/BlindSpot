# Blindspot

**Know the code.**

Blindspot maps every file in a git repository by the things that make code hard to
understand and change:

- **Complexity:** cyclomatic and cognitive complexity and size, for TypeScript and JavaScript.
- **Change pressure:** how much and how often the file changed recently.
- **Knowledge concentration:** how much of the file's history comes from one person, or from
  people who are no longer active.
- **Explicit AI provenance:** commits marked as AI-assisted by known agent identities.
- **Impact:** how many files import it, directly or transitively.

It sorts files by an **attention index** that combines these signals, to help you choose
where to look first. Every value comes with the evidence behind it, a confidence level, and
what Blindspot could not observe. It measures files, never developers.

> **What the index is not.** It is not a prediction of defects. In a registered study on 10
> open-source repositories, the index ranked files that later received bug fixes below file
> size alone (mean AUC 0.62 against 0.82). Treat it as a way to choose where to look, not as
> a verdict.

## Requirements

Node.js 24 or newer, and git 2.31 or newer on your `PATH`.

## Usage

```bash
npx @your-npm-scope/blindspot analyze .
npx @your-npm-scope/blindspot analyze . --html blindspot-report.html --json blindspot-report.json
```

Run it on full history. On a shallow clone, such as the default `actions/checkout`, every file
reports insufficient evidence. Use `fetch-depth: 0` in CI.

| Command                                  | What it does                                                                       |
| ---------------------------------------- | ---------------------------------------------------------------------------------- |
| `blindspot analyze [path]`               | Analyze the repository containing `path` and print a summary. This is the default. |
| `blindspot compare <baseline> <current>` | Compare two JSON reports.                                                          |
| `blindspot init [path]`                  | Write a starter `blindspot.config.json` at the repository root.                    |
| `blindspot schema <config\|report>`      | Print the JSON Schema for the configuration file or the JSON report.               |

Useful `analyze` options:

- `--json <file>` writes the full JSON report, and `-` writes it to standard output.
- `--html <file>` writes a standalone HTML report.
- `--baseline <file>` compares with an earlier JSON report.
- `--fail-on <threshold>` exits with code 1 when a threshold is reached, for CI.
- `-v, --verbose` prints diagnostics.

Run `blindspot --help` or `blindspot analyze --help` for every option.

### Exit codes

| Code | Meaning                                                                   |
| ---- | ------------------------------------------------------------------------- |
| 0    | Success, and no `--fail-on` threshold was reached.                        |
| 1    | A `--fail-on` threshold was reached.                                      |
| 2    | Usage or configuration error.                                             |
| 3    | The repository could not be analyzed (not a git repository, git missing). |
| 4    | Internal error. Re-run with `--verbose` and report the output.            |

## Privacy

Blindspot runs entirely on your machine. It makes no network requests, collects no
telemetry, and never uploads code, paths or history. It reads committed files with git, not
your working tree, and never runs code from the repository it analyzes. Configuration is
plain JSON.

## License

MIT. Bundled third-party code is listed in `THIRD_PARTY_NOTICES.md`.
