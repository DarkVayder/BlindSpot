# Research Report — does `bs-risk@0.1.0` find files that later need bug fixes?

Dataset `v1` · protocol [research-protocol.md](research-protocol.md) · decision
[ADR 0008](decisions/0008-descriptive-not-predictive.md) · results
[`research/results/v1/`](../research/results/v1/)

## Answer

**No, not beyond what file size and churn already show.** Within each repository, files that
later received a bug fix ranked only somewhat higher on Blindspot's score than files that did
not (mean AUC 0.616). File size alone ranked them much better (0.821), and so did recent churn
(0.799). The registered success criterion required the score to beat both, and it was worse
than both. The held-out snapshot and a run without the noisiest repository agree.

As a result the score is presented as a descriptive **attention index** and makes no claim
about defects (ADR 0008).

## What was tested

- **Repositories.** 10 open-source repositories in TypeScript, JavaScript, Python and Go: ky,
  express, zod, vite, vue-core, flask, requests, django, cobra and gin. They cover small,
  medium and large codebases, and active and dormant projects, all with permissive licenses.
  The commits are pinned in [`research/datasets/v1.json`](../research/datasets/v1.json).
- **Snapshots.** Every file was scored as of a pinned commit near 2024-01-01 (`T1`, primary)
  and near 2024-07-01 (`T2`, held out), using only history up to that commit.
- **Outcome.** Whether a bug-fix commit (rule `bugfix@1`) changed the file in the following
  180 days, following renames forward.
- **Measure.** AUC within each repository: the chance that a file which later got a fix
  ranks above one that did not, where 0.5 is chance. Repositories with at least 10 files in
  each class were pooled by their mean, with a two-stage bootstrap for 95% intervals.

## Results

Pooled mean AUC, with the score's difference from each baseline:

| Snapshot          | Repos | Score                | File size            | Prior churn          | Score − size            | Score − churn           | Odds ratio per SD (adjusted) |
| ----------------- | ----- | -------------------- | -------------------- | -------------------- | ----------------------- | ----------------------- | ---------------------------- |
| T1 (primary)      | 6     | 0.616 [0.512, 0.721] | 0.821 [0.761, 0.876] | 0.799 [0.705, 0.873] | −0.205 [−0.313, −0.112] | −0.184 [−0.303, −0.071] | 1.27 [0.96, 2.16]            |
| T1 without django | 5     | 0.639 [0.516, 0.744] | 0.820 [0.746, 0.885] | 0.813 [0.713, 0.890] | −0.181 [−0.296, −0.097] | −0.174 [−0.313, −0.057] | 1.56 [1.01, 3.60]            |
| T2 (held out)     | 5     | 0.641 [0.523, 0.744] | 0.851 [0.796, 0.910] | 0.772 [0.639, 0.876] | −0.209 [−0.326, −0.110] | −0.131 [−0.274, 0.022]  | 1.18 [0.79, 1.80]            |
| T2 without django | 4     | 0.686 [0.574, 0.773] | 0.853 [0.782, 0.919] | 0.769 [0.593, 0.891] | −0.167 [−0.272, −0.083] | −0.083 [−0.231, 0.078]  | 1.55 [0.97, 2.09]            |

The odds ratio comes from a logistic regression that also includes file size, prior churn,
file age and repository fixed effects. It is the change in the odds of a later fix for one
standard deviation of score. On the primary snapshot its interval includes no effect (1.0).

Per repository on `T1`:

| Repository | Language   | With a fix / without | Pooled | Score AUC | Size AUC | Churn AUC |
| ---------- | ---------- | -------------------- | ------ | --------- | -------- | --------- |
| django     | python     | 270 / 1,495          | yes    | 0.501     | 0.824    | 0.731     |
| gin        | go         | 17 / 50              | yes    | 0.548     | 0.811    | 0.644     |
| ky         | typescript | 11 / 23              | yes    | 0.490     | 0.789    | 0.878     |
| vite       | typescript | 111 / 810            | yes    | 0.795     | 0.916    | 0.891     |
| vue-core   | typescript | 153 / 345            | yes    | 0.729     | 0.834    | 0.790     |
| zod        | typescript | 22 / 140             | yes    | 0.632     | 0.753    | 0.864     |
| cobra      | go         | 3 / 28               | no     | 0.893     | 0.964    | 0.941     |
| flask      | python     | 6 / 49               | no     | 0.536     | 0.847    | 0.813     |
| requests   | python     | 4 / 25               | no     | 0.480     | 0.820    | 0.810     |
| express    | javascript | 0 / 143              | no     | –         | –        | –         |

Full figures for both snapshots are in [`repositories.csv`](../research/results/v1/repositories.csv).

### Exploratory (not used for the decision)

On their own, on `T1`, the score's parts reached these mean AUCs:

| Part                   | AUC   |
| ---------------------- | ----- |
| Complexity             | 0.803 |
| Change pressure        | 0.703 |
| Impact                 | 0.535 |
| Knowledge distribution | 0.332 |

Knowledge distribution ran backwards: files with concentrated or stale ownership received
fewer fixes, most likely because they are rarely changed at all. Complexity and change
pressure carried signal, but they largely track file size and churn. The score also did
better on TypeScript and JavaScript (0.661), where complexity is measured, than on Python
and Go (0.525).

## Label quality

The bug-fix rule was checked on a sample of 300 window commits (protocol §3.4):

- **Precision:** 79.5% [73.3%, 84.6%], above the registered 70% threshold.
- **Recall:** an estimated 95.8% [89.5%, 98.4%].
- **django:** precision was lowest, at 29 of 59. django writes "Fixed #NNNN" for every
  closed ticket, including features. That is why the run without django was registered.
- **Who labelled:** the judgements are Claude's suggestions, reviewed and accepted by the
  maintainer. There is no measure of agreement between independent raters.

See [`label-quality.json`](../research/results/v1/label-quality.json).

## Limitations

- **The outcome measures exposure.** Large, busy files collect every kind of change, fixes
  included. That is why size and churn are hard to beat. The result shows the score does not
  find _where fixes land_, but it does not settle whether it captures how hard code is to
  understand.
- **Commit messages are an imperfect proxy for defects.** Measured precision was 79.5%, and
  lower for django.
- **Few repositories were pooled:** 4 to 6 per snapshot, so the intervals are wide.
- **Reverts were too rare to analyze.** No repository qualified on `T1`, and only one on `T2`.
- **Review evidence is missing in local mode,** so one of the score's groups was not tested.
- **Public open-source projects** may not resemble private team codebases.

## Reproducing

`node packages/research/dist/bin.js analyze` regenerates the result files from the snapshot
outputs, byte for byte. The full pipeline is described in [research.md](research.md). The
statistics are checked against scikit-learn, SciPy, NumPy and statsmodels.
