# Configuration reference

Blindspot reads configuration from, in order:

1. the file passed with `--config`
2. `blindspot.config.json` at the repository root
3. the `"blindspot"` key in the root `package.json`

If none exists, the defaults below apply.

Configuration is **JSON only**. A `.js` or `.ts` config would run code from the repository being analyzed (see [ADR 0003](decisions/0003-json-only-config.md)). Unknown keys are rejected so typos are caught. A repository config that is a symbolic link is refused. Run `blindspot schema config` for the JSON Schema.

```json
{
  "critical": ["src/auth/**", "src/billing/**"],
  "exclude": ["legacy/**", "**/*.stories.tsx"]
}
```

## File selection

| Key                  | Type     | Default                  | Description                                                                                                                                                                                                               |
| -------------------- | -------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `include`            | globs    | `[]` (every file)        | Only analyze files that match one of these.                                                                                                                                                                               |
| `exclude`            | globs    | `[]`                     | Skip files that match.                                                                                                                                                                                                    |
| `useDefaultExcludes` | boolean  | `true`                   | Skip dependency, build and generated locations such as `node_modules`, `dist`, `build`, `vendor`, `*.min.js` and `*.generated.*`. The full list is in the [scoring model](scoring-model.md#5-eligibility-and-exclusions). |
| `extensions`         | string[] | common source extensions | File extensions to analyze, each like `".ts"`. Complexity and dependency signals currently cover TS/JS only. Other languages get history-based signals.                                                                   |
| `critical`           | globs    | `[]`                     | Paths where mistakes are costly. Matching files get full dependency impact. When empty, criticality is reported as "not configured" and never guessed from names.                                                         |

Glob syntax:

- `*` and `?` match within a path segment, and `**` matches any depth. A trailing `/**` needs at least one more segment.
- `[a-z]` and `[!x]` classes and `{a,b}` alternatives (at most 64 per pattern) are supported, and `\` escapes the next character.
- Wildcards also match dotfiles.
- Each list may hold up to 200 patterns of at most 500 characters. Invalid patterns are rejected when the config loads.

## Time windows

| Key                          | Default | Description                                                                               |
| ---------------------------- | ------- | ----------------------------------------------------------------------------------------- |
| `windows.analysisDays`       | `365`   | Window for ownership concentration.                                                       |
| `windows.recentDays`         | `90`    | Window for recent churn, commit counts and AI provenance. Must not exceed `analysisDays`. |
| `windows.inactiveAuthorDays` | `180`   | A contributor with no commits in this many days counts as inactive.                       |

All windows are measured back from the analyzed commit's timestamp, not from today, so results are reproducible.

## Scoring

| Key                      | Default | Description                                                                                  |
| ------------------------ | ------- | -------------------------------------------------------------------------------------------- |
| `weights.changePressure` | `0.25`  | Weight of recent churn and commit frequency.                                                 |
| `weights.knowledge`      | `0.25`  | Weight of ownership concentration, inactive-author share and staleness.                      |
| `weights.complexity`     | `0.25`  | Weight of structural complexity.                                                             |
| `weights.review`         | `0.20`  | Weight of review evidence. Always missing in local mode, so it does not affect local scores. |
| `weights.provenance`     | `0.05`  | Weight of explicit AI provenance without review.                                             |
| `impactFloor`            | `0.6`   | The share of a file's difficulty kept when it has no dependency impact (0–1).                |

Each weight is 0–1, and at least one of the first four must be above 0. Weights are relative, so they do not need to sum to 1. The defaults are uncalibrated priors; see the [scoring model](scoring-model.md).

## AI provenance

| Key                        | Default          | Description                                                                                                                                               |
| -------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `provenance.markers`       | agent identities | Case-insensitive substrings matched against author and `Co-authored-by` emails, `[bot]` account names and `Generated-by` values. Plain names never match. |
| `provenance.declaredPaths` | `[]`             | Globs for files you know are AI-generated. All recent changes to them count as AI-attributed.                                                             |

The default markers are:

- `noreply@anthropic.com`
- `copilot@users.noreply.github.com` and `copilot-swe-agent[bot]`
- `cursoragent@cursor.com`
- `noreply@aider.chat`
- `devin-ai-integration[bot]`

If you set `markers`, your list replaces the defaults.

## Limits

| Key                   | Default   | Description                                                                                                                 |
| --------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------- |
| `limits.maxFileBytes` | `1000000` | Larger files are excluded as `too_large`.                                                                                   |
| `limits.maxCommits`   | `100000`  | At most this many commits are read. Beyond it, the report is marked incomplete and older-only files report missing history. |
| `limits.gitTimeoutMs` | `300000`  | Time limit for each git command.                                                                                            |
