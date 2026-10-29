"""Reference values for packages/research/src/stats.ts, from the standard Python libraries.

Run from the repository root with numpy, scipy, scikit-learn and statsmodels installed:

    python packages/research/reference/compute.py

It reads stats-input.csv and writes stats-expected.json next to this file.
"""

import csv
import json
import math
import pathlib

import numpy as np
import statsmodels.api as sm
from scipy.stats import spearmanr
from sklearn.metrics import roc_auc_score

here = pathlib.Path(__file__).parent
with open(here / "stats-input.csv", newline="") as f:
    rows = list(csv.DictReader(f))

groups = [r["group"] for r in rows]
score = np.array([float(r["score"]) for r in rows])
lines = np.array([float(r["lines"]) for r in rows])
churn = np.array([float(r["churn"]) for r in rows])
age = np.array([float(r["age"]) for r in rows])
y = np.array([int(r["y"]) for r in rows])
count = np.array([int(r["count"]) for r in rows])

z = (score - score.mean()) / score.std(ddof=1)
levels = sorted(set(groups))
dummies = [[1.0 if g == level else 0.0 for g in groups] for level in levels[1:]]
design = np.column_stack([np.ones(len(rows)), z, np.log1p(lines), np.log1p(churn), np.log1p(age), *dummies])
fit = sm.Logit(y, design).fit(disp=0, tol=1e-12, maxiter=200)

expected = {
    "aucScore": roc_auc_score(y, score),
    "aucLines": roc_auc_score(y, lines),
    "aucScoreByGroup": {level: roc_auc_score(y[[g == level for g in groups]], score[[g == level for g in groups]]) for level in levels},
    "spearmanScoreCount": spearmanr(score, count).statistic,
    "percentiles": {str(p): np.percentile(score, p * 100) for p in (0.025, 0.5, 0.975)},
    "logisticCoefficients": list(fit.params),
    "oddsRatioPerSd": math.exp(fit.params[1]),
}
(here / "stats-expected.json").write_text(json.dumps(expected, indent=2) + "\n")
print(json.dumps(expected, indent=2))
