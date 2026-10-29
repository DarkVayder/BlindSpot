# Research Protocol — validating `bs-risk@0.1.0`

Status: registered 2026-10-28, before any outcome data was collected. Changes after that
date are listed in §9 with their reason, and they must not be driven by results.

This protocol answers one question: **do files that Blindspot ranks higher go on to need
more bug fixes than files it ranks lower, and does the score do better than trivial
baselines?** If it does not, that is a valid result and is reported as such.

## 1. Units and snapshots

- The unit of analysis is a **file at a snapshot commit `T`**: every file that Blindspot
  analyzes at `T`, scored by the engine at that commit with the default configuration.
  Scoring reads only the tree and the history reachable from `T`. Nothing is checked out.
- Each repository has two pinned snapshots, `T1` and `T2`, with `T2 ≥ T1 + 180 days`, so
  their outcome windows do not overlap. `T1` is used for the primary analysis and for any
  recalibration. `T2` is held out for confirming it.
- Each snapshot has a pinned end commit `E`: the last commit on the default branch with a
  committer time at or before `T + 180 days`.
- Snapshot commits, end commits and repository URLs are pinned in
  `research/datasets/*.json`, and the file's SHA-256 is recorded in every output.

## 2. Repository selection

At least 6 repositories, covering:

- at least 3 languages: TS/JS (complexity and imports measured), plus Python and Go
  (history signals only, see [ADR 0004](decisions/0004-ts-js-complexity-first.md))
- small (< 200 analyzed files), medium (200–1,000) and large (> 1,000) sizes at `T1`
- both active projects (≥ 50 commits in the window) and dormant ones (< 50)
- permissive licenses (MIT, BSD, Apache-2.0, ISC)
- at least 2 years of history before `T1` and no history rewrite after it

Repositories are chosen on these criteria alone, before any outcome is computed. A
repository is not swapped out because of its result.

## 3. Outcome labels

Outcomes are computed from commits reachable from `E` but not from `T`, with a committer
time in `(T, T + 180 days]`. Merge commits are skipped (their branch commits are counted
individually). Renames after `T` are followed forward, so a renamed file keeps its
outcomes. Labels are never used by the model.

### 3.1 Bug-fix commit (rule `bugfix@1`)

A commit is a bug fix when its subject or body matches, case-insensitively and on word
boundaries, any of:

- `fix`, `fixes`, `fixed`, `fixing`, `bugfix`, `hotfix`
- `bug`, `regression`, `crash`, `broken`
- a conventional-commit `fix:` or `fix(<scope>):` prefix

and it is **not** excluded by any of:

- a conventional-commit prefix of `docs`, `test`, `style`, `ci`, `build`, `chore` or `release`
- `typo` or `lint` anywhere in the subject
- more than 20 changed files (mass edits, formatting, dependency bumps)

### 3.2 Revert commit (rule `revert@1`)

A commit whose subject starts with `Revert "` or whose body contains
`This reverts commit <hash>`.

### 3.3 Per-file labels

- `bugfix_any`: at least one bug-fix commit changed the file in the window. **Primary outcome.**
- `bugfix_count`: the number of such commits.
- `reverted_any`: at least one revert commit changed the file in the window.

### 3.4 Label precision

Before the analysis is run, 200 commits that `bugfix@1` labels as bug fixes and 100 that
it does not are sampled with a fixed seed, stratified by repository. A person reads each
one and records whether it fixes a defect. Claude may pre-fill suggestions, but the
recorded judgement is the person's. The report states:

- precision with a 95% Wilson interval, and recall estimated from the negative sample
- who labelled the sample

If precision is below 0.70, the rule is revised as `bugfix@2`, checked on a **fresh**
sample, and the revision is listed in §9.

## 4. Scores and baselines

- **Score**: the Blindspot score at `T`. The primary analysis uses ranked files only
  (confidence ≥ 0.4). Insufficient-evidence files are reported separately.
- **Baseline A, size**: the file's line count at `T`.
- **Baseline B, churn**: lines added plus deleted in the 365 days before `T`.

## 5. Analysis

### 5.1 Primary

For each repository, compute the AUC (the probability that a file with `bugfix_any`
ranks above a file without it, ties counted half) for the score and for each baseline.
Repositories with fewer than 10 positive or 10 negative files are reported but left out
of the pooled figure.

The pooled figure is the mean AUC across repositories. Its 95% interval comes from a
two-stage bootstrap (resample repositories, then files within each), with 2,000
replicates and a fixed seed.

**Success criterion.** On `T1`, the lower bound of the 95% interval of
`AUC(score) − AUC(baseline)` is above 0 for **both** baselines.

### 5.2 Secondary

- Logistic regression of `bugfix_any` on the standardized score, `log1p(lines)`,
  `log1p(prior churn)`, `log1p(file age in days)` and repository fixed effects. Report
  the odds ratio per standard deviation of the score with a bootstrap interval.
- Spearman correlation between the score and `bugfix_count`, per repository.
- The primary analysis repeated for `reverted_any`.

### 5.3 Exploratory (labelled as such in every output)

- The AUC of each signal group (G1–G3) and of impact on their own.
- Results split by language support (TS/JS against the rest) and by confidence band.

## 6. Decision rule

- **Keep** `bs-risk@0.1.0`: the success criterion holds on `T1`, and the direction holds on `T2`.
- **Recalibrate**: the criterion fails, but exploratory results suggest specific changes.
  Weights or constants are tuned on `T1` only, the model version is bumped, and the
  success criterion must then hold on `T2`.
- **Rethink**: neither of the above. The product copy must then say plainly that the score
  is a descriptive summary with no demonstrated relationship to defects.

The decision is recorded as an ADR.

## 7. Reproducibility

- Every random step uses a seeded generator, and outputs are sorted and rounded to fixed
  precision. Re-running the pipeline on the pinned dataset must reproduce byte-identical
  aggregate files (a Stage 2 gate item).
- Each output records the tool version, model version, git version, dataset hash, rule
  versions, seed and the time it was generated. The generation time is kept out of the
  files compared for reproducibility.

## 8. Known limitations

- Commit messages are an imperfect proxy for defects. Their measured precision bounds how
  far the result can be trusted.
- A file that changes often has more chances to be touched by a bug fix, so the churn
  baseline is hard to beat by construction. Beating it is the point of the test.
- Identity merging uses the `.mailmap` at `E`, which can be newer than `T`. This affects
  only which emails count as the same person.
- Review evidence (G4) is missing in local mode, so this study does not evaluate it.
- With 6–10 repositories, between-repository uncertainty is large, and the intervals will
  be wide.
- Public open-source projects may not resemble private team codebases.

## 9. Amendments

- **2026-10-29, selection (before any outcome was computed).** Measured by analyzed files
  at `T1`, the first eight candidates were all small except vite (935, medium), and none was
  large. django (large) and vuejs/core (medium) were added to meet §2. No repository was
  removed. express's default branch had no commits between March 2022 and January 2024, so
  its `T1` snapshot is dated 2022-02-17 and is dormant with an empty outcome window. It is
  kept and reported as such.
