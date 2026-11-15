# Running the research pipeline

The pipeline validates the score as described in [research-protocol.md](research-protocol.md).
It lives in `packages/research` and is a development tool. It is not shipped with the CLI.

```bash
pnpm build
node packages/research/dist/bin.js fetch
node packages/research/dist/bin.js pin
node packages/research/dist/bin.js snapshot
node packages/research/dist/bin.js sample
node packages/research/dist/bin.js quality --labelled-by "<your name>"
node packages/research/dist/bin.js analyze
```

| Command    | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fetch`    | Clones every dataset repository into `research/cache/<id>` over HTTPS, without a checkout. An existing clone that already has every pinned commit is reused without any network access. `--update` also fetches new commits. Missing pinned commits are fetched by hash.                                                                                                                                                                                                                                                                                                                                                              |
| `pin`      | Resolves each snapshot date to a commit on the default branch, then the end of its outcome window, and writes them to the dataset with the commit count in the window and the number of tracked files. Pinned repositories are never re-pinned unless `--force` is given.                                                                                                                                                                                                                                                                                                                                                             |
| `snapshot` | Scores every file at each pinned snapshot with the default configuration, merging author identities with the `.mailmap` at the window end. It then labels each file's outcome window with the rules in the protocol, following renames forward. One file per repository and snapshot is written to `research/output/<dataset>/snapshots/`. These files contain paths, so they are gitignored. They contain no commit messages, and the same inputs always produce the same bytes.                                                                                                                                                     |
| `sample`   | Draws the hand-labelling sample from protocol §3.4 with a fixed seed: 200 window commits that `bugfix@1` labels as fixes and 100 that it does not, allocated across repositories in proportion to their populations, then shuffled together. It writes `research/labels/<dataset>-sample.csv` for labelling and a separate `.key.json` with the rule's verdicts. It refuses to replace an existing sheet unless `--force` is given.                                                                                                                                                                                                   |
| `quality`  | Reads the judged sheet, checks every row against the key, and writes the rule's precision, miss rate and recall with 95% intervals to `research/results/<dataset>/label-quality.json`. `--labelled-by` is required and recorded.                                                                                                                                                                                                                                                                                                                                                                                                      |
| `analyze`  | Runs the registered analysis (protocol §5 and its amendments) on the snapshot outputs. It computes per-repository AUCs and Spearman correlations, the pooled mean AUC of the score and both baselines with a two-stage bootstrap, the regression with repository fixed effects, the django sensitivity run, the revert outcome and the exploratory splits. It writes `research/results/<dataset>/analysis.json` and `repositories.csv`, which hold aggregates only, with no paths. A re-run produces identical bytes. The statistics are checked against scikit-learn, SciPy, NumPy and statsmodels (`packages/research/reference/`). |

Common options: `--dataset <file>` (default `research/datasets/v1.json`), `--cache <dir>`
(default `research/cache`), `--only <ids...>` and `--timeout-minutes <n>` (default 30, up to
60 while scoring). The time limit applies to each git command and cannot change a result.

Exit codes: 0 success, 2 usage or dataset error, 3 git or network failure, 4 internal error.

## Labelling the sample

Open `research/labels/v1-sample.csv` in a spreadsheet and fill in the `judgement` column for
every row with `yes`, `no` or `unsure`. Use the `url` to read the full commit when the
message is not enough. The `suggested` column holds Claude's reading of the message alone.
It is a starting point, and the recorded judgement must be yours.

Answer `yes` when the commit corrects wrong behaviour of the shipped software: a crash, a
wrong result, a regression, a security flaw, wrong or missing public types, or a spurious
warning. Answer `no` for features, refactors, performance work, deprecations, documentation,
changes only to tests or build tooling, and dependency bumps. Use `unsure` sparingly.
`unsure` rows are left out of the figures and counted.

The sheet does not show which rows the rule labelled as fixes, so that knowledge cannot
steer the judgement. Save the file as CSV, keeping the columns and row order, then run
`quality`.

## The dataset file

`research/datasets/v1.json` lists the repositories with their language and license, the two
snapshot dates and the window length. After `pin`, each repository records its pinned
commits. The file's SHA-256 is recorded in every output, so a changed dataset is always
visible. Once results exist, the file is only changed through an amendment in §9 of the
protocol.
