# CLI reference

```
blindspot [command] [options]
```

`analyze` is the default command, so `blindspot .` is the same as `blindspot analyze .`. Blindspot runs locally: it reads your repository's git history and committed files and makes no network requests.

## `blindspot analyze [path]`

Analyzes the repository that contains `path` (default: the current directory) at its current `HEAD` commit, and prints a summary.

| Option                  | Description                                                                                                                                                                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-c, --config <file>`   | Use this configuration file instead of `blindspot.config.json` (or the `"blindspot"` key in `package.json`) at the repository root.                                                                                                                                 |
| `--json <file>`         | Write the full JSON report. Use `-` for standard output; the summary then goes to standard error so the JSON stays clean.                                                                                                                                           |
| `--html <file>`         | Write a standalone HTML report. It is one file with no external requests.                                                                                                                                                                                           |
| `--baseline <file>`     | Compare with an earlier JSON report and print what changed.                                                                                                                                                                                                         |
| `--fail-on <threshold>` | Exit with code 1 when the threshold is reached. `high`, `elevated` or `moderate` apply to any ranked file at or above that band. `new-high`, `new-elevated` or `new-moderate` need `--baseline` and apply only to files that were not at or above that band before. |
| `--top <n>`             | Number of files to list in the summary (default 15).                                                                                                                                                                                                                |
| `--max-html-files <n>`  | Number of files to include in the HTML report (default 2000). The JSON report always contains every file.                                                                                                                                                           |
| `--no-color`            | Disable color. Color is also off when `NO_COLOR` is set, when `TERM=dumb`, or when output is not a terminal. `FORCE_COLOR=1` turns it on.                                                                                                                           |
| `-q, --quiet`           | Do not print the summary.                                                                                                                                                                                                                                           |
| `-v, --verbose`         | Print diagnostics (repository, configuration source, timing) to standard error, and stack traces for internal errors.                                                                                                                                               |

Relative paths for `--config`, `--json`, `--html` and `--baseline` are resolved against the current directory. Parent directories for output files are created as needed.

How thresholds behave:

- **Insufficient evidence never trips a threshold.** A file Blindspot cannot assess is not treated as a failure.
- **`new-*` thresholds need comparable reports.** They refuse to compare reports produced by different model versions (exit code 2), because score differences could then come from the model rather than the code.

## `blindspot compare <baseline> <current>`

Compares two JSON reports.

| Option                  | Description                                                       |
| ----------------------- | ----------------------------------------------------------------- |
| `--json`                | Print the comparison as JSON.                                     |
| `--fail-on <threshold>` | Only `new-*` thresholds are accepted. Exit 1 when one is reached. |
| `--no-color`            | Disable color.                                                    |

## `blindspot init [path]`

Writes a starter `blindspot.config.json` at the root of the repository containing `path`. It refuses to overwrite an existing file unless you pass `-f, --force`, and it never writes through a symbolic link.

## `blindspot schema <config|report>`

Prints the JSON Schema for the configuration file or for the JSON report. Point your editor at the configuration schema for autocompletion.

## Exit codes

| Code | Meaning                                                                                                                                    |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 0    | Success, and no `--fail-on` threshold was reached.                                                                                         |
| 1    | A `--fail-on` threshold was reached. The files involved are listed on standard error, highest score first.                                 |
| 2    | Usage or configuration error: an unknown option, an invalid config, an unreadable or incompatible baseline, or a path that does not exist. |
| 3    | The repository could not be analyzed: not a git repository, a bare repository, git missing or older than 2.31, or a git failure.           |
| 4    | Internal error. Re-run with `--verbose` and report the output.                                                                             |

## JSON report

The report format is versioned by `schemaVersion` (currently `1`) and described by `blindspot schema report`. Reports never contain file contents, commit messages, author names or emails, or absolute paths.
