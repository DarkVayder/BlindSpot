# Attention Index Model — v0.1.0

Status: implemented in Stage 1 and validated in Stage 2, which found no signal beyond file
size and churn ([research report](research-report.md), [ADR 0008](decisions/0008-descriptive-not-predictive.md)).
Model id: `bs-risk@0.1.0`

> **What the score means.** The score is the _attention index_: a descriptive summary of
> complexity, change pressure, knowledge concentration and impact, relative to other files
> in the same repository, for choosing where to look. It is **not** a measure of code
> quality, a claim that anyone misunderstands the code, a judgement about any developer, or
> a prediction of defects. Stage 2 found that it ranked files that later received bug fixes
> below file size alone.

## 1. Design rules

1. **Evidence is kept separate from inference.** Collectors produce `FileEvidence` (observed facts or explicit `missing` markers). The model turns evidence into signals. Signals never read the repo directly.
2. **Missing is not negative.** A signal without evidence is excluded from the score and lowers confidence. It is never treated as 0 or 1.
3. **Signals are grouped, and groups are weighted.** Correlated measures (for example commit count and line churn) live in the same group, so each underlying phenomenon is counted once.
4. **The model is deterministic.** "Now" is the timestamp of the analyzed commit (`HEAD`), not the wall clock. Inputs are sorted by path, and output is rounded to fixed precision. The same repo, commit, config and model version always produce byte-identical JSON.
5. **The model is versioned.** Any change that can alter an output value bumps the model version. Every result records it.
6. **Weights are configurable and documented.** The defaults below are an uninformed prior until Stage 2 calibration. This document says so rather than presenting them as tuned.

## 2. Signal groups

The analysis window `W` defaults to 365 days and the recent window `R` to 90 days. Both are configurable.

### G1 · Change pressure (default weight 0.25)

How much and how often the file has been changing recently. Rationale: frequently changing code has more opportunities for the team's understanding to go out of date.

| Signal           | Evidence                        | Raw value                                                         |
| ---------------- | ------------------------------- | ----------------------------------------------------------------- |
| `churn_recent`   | numstat across the rename chain | (lines added + deleted in `R`) ÷ max(current non-blank lines, 20) |
| `commits_recent` | git log                         | number of commits touching the file in `R`                        |

The group value is the mean of the two normalized signals.

### G2 · Knowledge distribution (default weight 0.25)

How concentrated or stale the history of changes to the file is. This is a property of the file's history and is never reported per person.

| Signal                    | Evidence                                                                                    | Raw value                                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `ownership_concentration` | per-author churn in `W` (authors identified by normalized email, with `.mailmap` respected) | Share of changed lines contributed by the single largest contributor (0–1).                                      |
| `inactive_knowledge`      | per-author churn over the full history, plus each author's last commit anywhere in the repo | Share of the file's historical churn by authors with no repo commits in the last 180 days.                       |
| `time_since_change`       | last commit date                                                                            | Days since the file was last modified. A high value raises this signal only together with complexity (see §3.3). |

The group value is the mean of the signals that apply. `time_since_change` applies only
under the interaction rule in §3.3. If G3 is missing, it is left out.

`time_since_change` measures staleness. A recent commit is **not** treated as evidence that anyone understands the file. It only means the history-based signals are current.

### G3 · Structural complexity (default weight 0.25)

How hard the code itself is to follow. In v1 this is computed for TS/JS using the TypeScript compiler API. For other languages it is reported as `missing (language not supported)`.

| Signal            | Raw value                                                       |
| ----------------- | --------------------------------------------------------------- |
| `cyclomatic_max`  | Highest cyclomatic complexity of any function in the file.      |
| `cognitive_total` | Total cognitive-complexity-style nesting score across the file. |
| `size_loc`        | Non-blank, non-comment lines.                                   |

The group value is a weighted mean (0.4 / 0.4 / 0.2). Size gets a lower weight because it partly drives the other two.

How each signal is computed:

- **Cyclomatic:** 1 plus one per decision point, measured per function. Decision points are `if`, `?:`, `for`/`for-in`/`for-of`, `while`, `do`, `catch`, each non-default `case`, and each `&&`, `||`, `??` (including their assignment forms). Nested functions are measured on their own and do not add to the enclosing function. Module-level code counts as one more unit.
- **Cognitive:** follows G. Ann Campbell's _Cognitive Complexity_ (SonarSource, 2017), without the recursion increment.
  - Each `if`, loop, `switch`, `catch` and `?:` adds 1 plus the current nesting depth.
  - `else` and `else if` add 1.
  - Each run of the same logical operator adds 1.
  - Nesting deepens inside those structures, and inside functions nested in other functions.
- **Code lines:** lines that contain at least one syntax token, excluding comments, blank lines and whitespace-only JSX text. A multi-line template literal counts every line it spans.
- **Parse failures:** if a file is nested too deeply to parse (stack exhaustion), complexity and dependencies are reported as `missing: parse_failed`.

### G4 · Review evidence (default weight 0.20)

Whether changes to the file went through review.

| Signal                    | Raw value                                                                                                   |
| ------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `unreviewed_change_share` | Share of the file's recent churn (`R`) from commits not covered by a PR with at least one approving review. |

**In local CLI mode this signal is always `missing`.** Local git does not record reviews, and merge commits or `Reviewed-by:` conventions are too inconsistent to use as evidence. In hosted mode the evidence comes from the GitHub API.

### G5 · Explicit AI provenance (default weight 0.05)

**Verified markers only:**

- An author or `Co-authored-by:` **email** that contains a configured marker.
- A `[bot]` account name that contains a configured marker.
- A `Generated-by:` trailer value that contains a configured marker.
- Paths the user declares in config.

The defaults are specific agent identities, not first names:

- `noreply@anthropic.com`
- `copilot@users.noreply.github.com` and `copilot-swe-agent[bot]`
- `cursoragent@cursor.com`
- `noreply@aider.chat`
- `devin-ai-integration[bot]`

Plain names are never matched, so a person named Claude or Devin is not reported as AI-assisted. Add identities for other tools in config. A missing default does not mean a tool wasn't used.

The tool never infers AI authorship from coding style.

| Signal                           | Raw value                                                                                                                                                                                                      |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ai_attributed_unreviewed_share` | Share of recent churn from commits carrying a marker **and** lacking review evidence. If review evidence is missing, the share of marked churn is used and the explanation says that review status is unknown. |

The weight is low on purpose. This is a hypothesis to test in Stage 2, not an established risk factor. AI authorship alone is not treated as a defect. The absence of markers is reported as "no explicit provenance markers found" and never as "human-written".

When a file has no markers in recent changes, G5 is **not applicable**. It is left out of both the score and the confidence denominator. Treating "no markers" as low risk would reward missing evidence, and treating it as missing evidence would lower confidence for every repository that doesn't use trailers.

Markers are matched as case-insensitive substrings, not regular expressions, because a regex taken from repository config could be used for ReDoS.

### Impact modifier · Dependency and criticality

| Signal              | Raw value                                                                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fan_in_transitive` | Number of files that transitively import this one (TS/JS v1). Otherwise `missing`.                                                                                                    |
| `criticality`       | 1 if the path matches the configured `critical` globs (for example `src/auth/**` or `migrations/**`), otherwise 0. With no config, this is `missing` and is never guessed from names. |

`impact` is 1 for a file matching the `critical` globs. Otherwise it is `norm(fan_in_transitive)`. When fan-in is missing and the file is not critical, `impact` is set to 0.5 (neutral) and confidence is reduced. "Not critical" alone is not treated as evidence of low impact.

## 3. Computation

### 3.1 Normalization

Each raw value `x` is converted to `[0, 1]` as the **geometric mean of two transforms**:

- `p` = the file's mid-rank percentile among eligible files in the same repository. This makes the score relative to the repo.
- `a` = a saturating absolute transform `x / (x + k)`, with a documented constant `k` per signal. This keeps a repository of uniformly simple files from producing high scores just because some file has to rank last.

`norm(x) = sqrt(p · a)`. The constants `k` are listed in `core/src/model/constants.ts` with their rationale and are covered by tests.

### 3.2 Score

```
difficulty = Σ wᵍ · Gᵍ / Σ wᵍ        (over groups G1–G5 that have evidence)
score      = round(100 · difficulty · (f + (1 − f) · impact), 1)    f = impactFloor, default 0.6
```

If none of G1–G4 has evidence, the score is `null` and the file is reported as insufficient evidence. G5 alone never produces a score.

Impact scales the score between 60% and 100% of difficulty. A low-impact file can still be hard to understand, but high-impact files rank above it. The 0.6/0.4 split is a prior that Stage 2 will test.

### 3.3 Interaction rule

`time_since_change` is added to G2 only when the file's G3 value is at least 0.5. This captures "complex code that no one has touched in a long time" without penalizing simple files that are stable.

### 3.4 Confidence (0–1)

```
coverage  = Σ wᵍ (groups with evidence) / Σ wᵍ (applicable groups with wᵍ > 0)
history   = min(1, total_commits / 5) · min(1, file_age_days / 30)
impactOk  = 1 if impact was observed, 0.8 if neutral fallback
confidence = round(coverage · (0.5 + 0.5 · history) · impactOk, 2)
```

Results are reported in these bands:

| Confidence | Shown as                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------- |
| ≥ 0.7      | the score with its risk band                                                                      |
| 0.4 – 0.7  | the score with a "limited evidence" marker                                                        |
| < 0.4      | **"Insufficient evidence"**: the score is still in the JSON but is not ranked or coloured as risk |

New files and files in shallow clones therefore show up as _unknown_, not as extreme risk.

### 3.5 Risk bands

0–24 Low · 25–49 Moderate · 50–74 Elevated · 75–100 High. The bands are descriptive labels, not thresholds that have been validated.

## 4. Per-file output

Each file result contains:

- `score`, `band`, `confidence`, `modelVersion`
- every signal with its raw value, its normalized value and its evidence status
- **Explanations** generated from templates using only observed values, for example: "Changed in 14 commits over the last 90 days (top 8% in this repository)."
- **Limitations**, for example: "Review evidence unavailable in local mode." or "Complexity not computed for `.go` files."
- **Recommended actions** chosen by the leading signals, for example:
  - High G3: "Consider adding tests around the most complex functions before changing them."
  - High G2: "Pair a second contributor on the next change."
  - High impact: "Check dependents before changing exported interfaces."

## 5. Eligibility and exclusions

File contents are read from the analyzed commit with `git cat-file --batch`, never from the working tree. Uncommitted edits cannot skew the result, and working-tree symlinks are never followed.

A file is analyzed only if all of the following hold. The checks run in this order, and each excluded file is reported with the first reason that applied.

1. It is a regular file at the analyzed commit. Symlinks and submodules are excluded.
2. Its path is a plain relative path that git could decode as UTF-8 and that is unique.
3. Its extension is in `extensions`.
4. It matches `include`. The default is an empty list, which means every file.
5. It does not match the default exclusions, unless `useDefaultExcludes` is `false`. The list is `DEFAULT_EXCLUDES` in `packages/analyzers/src/discovery.ts`. It covers dependency, build and output directories and minified, bundled and generated file name patterns.
6. It does not match `exclude`.
7. It is no larger than `limits.maxFileBytes`.
8. Its content is not binary. A file is binary if it contains a NUL byte in the first 8,000 bytes.
9. It is not generated. A file counts as generated if its leading comment lines contain `@generated`, Go's `Code generated … DO NOT EDIT`, or `<auto-generated`.

Glob syntax:

- `*` and `?` match within a path segment, and `**` as a whole segment matches any depth. A trailing `/**` needs at least one more segment.
- `[a-z]` and `[!x]` classes, `{a,b}` alternatives (at most 64 per pattern) and `\` escapes are supported.
- Wildcards also match names that start with `.`.
- Matching uses dynamic programming, because globs can come from an untrusted repository's config. See threat model §3.1.

Renames are followed with `git log -M` so a file's history survives moves. Deleted files are excluded from scoring but counted in coverage statistics.

## 6. Testing obligations (Stage 1)

- Each signal has a unit test covering normal, edge and missing evidence.
- Property tests check that the score stays within [0, 100], that more evidence never lowers confidence, and that permuting the input order leaves output unchanged.
- Weight-sensitivity tests check that changing one group's weight changes scores in the expected direction only.
- A golden test on a fixture repository with a scripted history pins the exact JSON output.

## 7. Known weaknesses (to investigate in Stage 2)

- Percentile normalization makes scores incomparable _across_ repositories. Cross-repo views must use raw metrics or say this clearly.
- Author-email identity misses contributors with multiple emails unless `.mailmap` exists.
- Squash-merge workflows merge authorship of many commits into one, which distorts G2.
- Complexity covers TS/JS only in v1.
- Dependency fan-in follows only relative imports between analyzed TS/JS files: `import`, `export … from`, `import()`, `require()`, `import x = require()` and `import("…")` types. Package names, tsconfig `paths` aliases and workspace package names are not resolved, so fan-in is undercounted in monorepos that rely on them. Test files that import a module count as its dependents.
- Fan-in is computed by a reverse breadth-first search per file under a fixed work budget (25 million edge visits). On graphs larger than that, the remaining files, in path order, report dependencies as `missing: limit_exceeded`.
- In single-contributor repositories, every file has `ownership_concentration = 1`. All
  files tie at the mid-rank percentile, so G2 stops telling files apart. It should be
  reported as low-information there, not as high risk.
- All default weights are priors. None are calibrated yet.
