# 0006 — Ship the local CLI (Stages 1–2) as v0.1 before hosted work

**Context.** Stages 3–7 make up most of the build effort. Their value depends on whether the risk score carries a real signal, and that is not known until Stage 2.

**Decision.** Stages 1 and 2 form a self-contained release: a local CLI with JSON and HTML reports, plus the research report. Hosted stages begin once the Stage 2 result is reviewed. The stage order from the brief does not change.

**Consequences.** Real users get a usable product early, and the model can be recalibrated cheaply before scores are stored in a database and shown in a dashboard.

**Update (2026-10-29).** Stage 2 found no signal beyond file size and churn, so the hosted stages are paused. See [ADR 0008](0008-descriptive-not-predictive.md).
