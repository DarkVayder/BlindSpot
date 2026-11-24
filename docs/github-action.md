# GitHub Action

The Blindspot action runs the analysis in your workflow and writes a summary to the job
page. On a pull request it also analyzes the commit the pull request branched from, and
shows which files moved into a higher band. Everything runs on the runner: no service, no
token, and no code leaves the job.

## Quick start

```yaml
name: Blindspot

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  blindspot:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0
      - id: blindspot
        uses: DarkVayder/BlindSpot@v0.1.0
        with:
          fail-on: new-elevated
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: blindspot-report
          path: blindspot-report
```

`fetch-depth: 0` is required. History signals and the pull request comparison need the full
history; on a shallow clone every file reports insufficient evidence and nothing is
compared. For supply-chain safety, pin the action to a full commit SHA instead of a tag
once you have chosen a version.

## What it does

1. Analyzes the checked-out commit with your `blindspot.config.json`, if there is one.
2. On `pull_request`, finds the commit the pull request branched from and analyzes it with
   the same configuration, so the comparison reflects only the pull request's changes.
3. Writes a job summary: coverage, band counts, files newly at or above Elevated, and the
   files with the highest attention index, each with its main reason.
4. Writes `blindspot.json` and `blindspot.html` to `report-dir` for you to upload.
5. Fails the step only if `fail-on` is set and reached.

## Inputs

| Input        | Default            | Description                                                                                                                                                                                                        |
| ------------ | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `path`       | `.`                | Repository, or any directory inside it, to analyze.                                                                                                                                                                |
| `config`     | (none)             | Configuration file. Defaults to `blindspot.config.json` at the repository root.                                                                                                                                    |
| `fail-on`    | (none)             | `high`, `elevated` or `moderate` fail on any ranked file at or above that band. `new-high`, `new-elevated` or `new-moderate` fail only on files that moved there since the pull request's base. Empty never fails. |
| `top`        | `10`               | Files listed in each summary table, from 1 to 100.                                                                                                                                                                 |
| `report-dir` | `blindspot-report` | Directory, relative to the workspace, for the JSON and HTML reports.                                                                                                                                               |

`new-*` thresholds only apply to pull requests. On other events they are skipped with a
warning, never failed. Files with insufficient evidence never fail a gate.

## Outputs

| Output                 | Description                                                                                                             |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `report-json`          | Path of the JSON report.                                                                                                |
| `report-html`          | Path of the standalone HTML report.                                                                                     |
| `ranked-files`         | Number of files with enough evidence to be ranked.                                                                      |
| `elevated-files`       | Number of ranked files at or above Elevated.                                                                            |
| `newly-elevated-files` | Number of files that moved to Elevated or above since the pull request's base. Empty when there was nothing to compare. |
| `gate`                 | `passed`, `failed` or `off`.                                                                                            |

## Security and privacy

- **Permissions:** the action only reads the checkout. It needs `contents: read` and no token.
- **No pull request comments:** it writes only to the job summary, which notifies no one.
  File names from the repository are encoded before they reach the summary, outputs or
  workflow commands, so a hostile name cannot inject Markdown, HTML or commands.
- **No network:** the action makes no network requests and never runs code from the
  repository: hooks, filters and repository git configuration are disabled, as in the CLI.
- **Self-contained:** it runs from a bundled file committed to the repository on GitHub's
  Node.js 24 runtime. It installs nothing, and does not change the Node.js version of your
  job.

The attention index sorts files for review. It is not a prediction of defects
([ADR 0008](decisions/0008-descriptive-not-predictive.md)).
