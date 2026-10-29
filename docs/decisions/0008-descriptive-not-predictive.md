# 0008 — Present the score as a descriptive attention index, not a risk prediction

**Context.** Stage 2 tested `bs-risk@0.1.0` against later bug-fix outcomes, following a
protocol registered before any outcome was computed ([research-protocol.md](../research-protocol.md),
[research-report.md](../research-report.md)).

- On the primary snapshot, the score ranked files that later received a bug fix with a mean
  AUC of 0.62 [0.51, 0.72].
- File size alone reached 0.82 and prior churn 0.80. The score was worse than both, by
  −0.21 [−0.31, −0.11] and −0.18 [−0.30, −0.07].
- The held-out snapshot and the run without django pointed the same way.
- Among the score's parts, knowledge distribution ran backwards (0.33): files with
  concentrated or stale ownership received fewer fixes. Complexity (0.80) and change
  pressure (0.70) carried signal, but they largely track size and churn.

The protocol's decision rule allowed keeping, recalibrating or rethinking the model.
Recalibrating could at best rebuild file size and churn under another name.

**Decision.** Rethink.

- Blindspot describes each file with complexity, change pressure, knowledge concentration,
  impact and explicit AI provenance. Each is presented as an observed fact about the code.
- The composite score is kept unchanged as an **attention index**: a way to sort files for
  review. It is never described as a risk estimate or a predictor of defects.
- Product copy states the Stage 2 result, and a test fails the build if any of it claims
  predictive accuracy.
- Scores and every other output value are unchanged, so the model id stays `bs-risk@0.1.0`.
  The id is an identifier, not a claim.
- The hosted stages (3–8) are paused until a product direction is chosen. ADR 0006 made them
  depend on Stage 2 finding a real signal, and it did not.

**Consequences.**

- The CLI remains a useful, honest code-health explorer. The knowledge-concentration view
  still supports bus-factor and onboarding conversations, but not defect claims.
- The brand line "Know the code. Own the risk." stays for now. It is a slogan, not a claim
  about the score, and it can be revisited with the product direction.
- If the comprehension-risk thesis is to be tested again, it needs a new registered study
  with fresh snapshots and an outcome adjusted for exposure (fixes per change, not fixes per
  file). Re-analysing this dataset with a new outcome would not be valid evidence.
