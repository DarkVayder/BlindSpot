import type { SnapshotFile, SnapshotFileRow } from "./snapshot.js";
import { createRng, randomInt, type Rng } from "./random.js";
import { auc, logistic, mean, percentile, spearman, standardDeviation } from "./stats.js";

// Implements docs/research-protocol.md §5 with the details fixed in the §9 amendments.
export const MIN_CLASS_SIZE = 10;
export const BOOTSTRAP_SEED = 20_261_028;
export const BOOTSTRAP_REPLICATES = 2_000;
export const SENSITIVITY_EXCLUDED = ["django"] as const;
const TS_JS = new Set(["typescript", "javascript"]);

export type Outcome = "bugfix" | "revert";

export interface Estimate {
  estimate: number;
  lower: number;
  upper: number;
}

interface Row {
  score: number;
  lines: number;
  churn: number;
  age: number;
  positive: boolean;
  count: number;
  confidence: number;
  groups: SnapshotFileRow["groups"];
  impact: number;
}

interface RepoData {
  id: string;
  language: string;
  rows: Row[];
  positives: Row[];
  negatives: Row[];
}

export interface RepositoryResult {
  id: string;
  language: string;
  rankedFiles: number;
  droppedWithoutChurn: number;
  positives: number;
  negatives: number;
  eligible: boolean;
  auc: { score: number | null; lines: number | null; churn: number | null };
  spearmanScoreCount: number | null;
}

export interface PooledResult {
  repositories: string[];
  meanAuc: { score: Estimate; lines: Estimate; churn: Estimate };
  difference: { versusLines: Estimate; versusChurn: Estimate };
  successCriterion: boolean;
}

export interface RegressionResult {
  repositories: string[];
  files: number;
  oddsRatioPerSd: Estimate | null;
  failedReplicates: number;
  error?: string;
}

export interface SnapshotAnalysis {
  snapshot: string;
  outcome: Outcome;
  repositories: RepositoryResult[];
  pooled: PooledResult | null;
  regression: RegressionResult | null;
}

export interface Exploratory {
  note: string;
  groupAuc: Record<string, number | null>;
  scoreAucByLanguage: { tsJs: number | null; other: number | null };
  scoreAucByConfidence: { atLeast07: number | null; below07: number | null };
}

function repoData(file: SnapshotFile, outcome: Outcome): { data: RepoData; dropped: number; ranked: number } {
  const ranked = file.files.filter((f) => f.ranked && f.score !== null);
  const rows: Row[] = ranked
    .filter((f) => f.priorChurn !== null)
    .map((f) => ({
      score: f.score ?? 0,
      lines: f.lineCount,
      churn: f.priorChurn ?? 0,
      age: f.ageDays ?? 0,
      positive: (outcome === "bugfix" ? f.bugfixCount : f.revertCount) > 0,
      count: outcome === "bugfix" ? f.bugfixCount : f.revertCount,
      confidence: f.confidence,
      groups: f.groups,
      impact: f.impact,
    }));
  return {
    data: {
      id: file.repository.id,
      language: file.repository.language,
      rows,
      positives: rows.filter((r) => r.positive),
      negatives: rows.filter((r) => !r.positive),
    },
    dropped: ranked.length - rows.length,
    ranked: ranked.length,
  };
}

const isEligible = (d: RepoData) =>
  d.positives.length >= MIN_CLASS_SIZE && d.negatives.length >= MIN_CLASS_SIZE;

function aucOf(rows: readonly Row[], pick: (r: Row) => number): number {
  return auc(
    rows.map(pick),
    rows.map((r) => r.positive),
  );
}

const PREDICTORS = {
  score: (r: Row) => r.score,
  lines: (r: Row) => r.lines,
  churn: (r: Row) => r.churn,
};

function pooledAucs(repos: readonly RepoData[]): { score: number; lines: number; churn: number } {
  return {
    score: mean(repos.map((d) => aucOf(d.rows, PREDICTORS.score))),
    lines: mean(repos.map((d) => aucOf(d.rows, PREDICTORS.lines))),
    churn: mean(repos.map((d) => aucOf(d.rows, PREDICTORS.churn))),
  };
}

function resampleRepo(rng: Rng, d: RepoData): RepoData {
  const draw = (rows: readonly Row[]) =>
    Array.from({ length: rows.length }, () => rows[randomInt(rng, rows.length)] as Row);
  const positives = draw(d.positives);
  const negatives = draw(d.negatives);
  return { ...d, rows: [...positives, ...negatives], positives, negatives };
}

interface Design {
  x: number[][];
  y: boolean[];
}

// Each entry of `repos` gets its own fixed effect, by position. In a bootstrap replicate a
// repository drawn twice is two clusters, and one not drawn has no column, so the design is
// never singular because of the resampling.
function regressionDesign(repos: readonly RepoData[], scoreMean: number, scoreSd: number): Design {
  const x: number[][] = [];
  const y: boolean[] = [];
  for (const [index, d] of repos.entries()) {
    const dummies = repos.slice(1).map((_, k) => (k + 1 === index ? 1 : 0));
    for (const r of d.rows) {
      x.push([
        1,
        (r.score - scoreMean) / scoreSd,
        Math.log1p(r.lines),
        Math.log1p(r.churn),
        Math.log1p(r.age),
        ...dummies,
      ]);
      y.push(r.positive);
    }
  }
  return { x, y };
}

function estimate(point: number, replicates: readonly number[]): Estimate {
  return round({
    estimate: point,
    lower: percentile(replicates, 0.025),
    upper: percentile(replicates, 0.975),
  });
}

function round(e: Estimate): Estimate {
  const r = (v: number) => Math.round(v * 10_000) / 10_000;
  return { estimate: r(e.estimate), lower: r(e.lower), upper: r(e.upper) };
}

function roundOrNull(v: number | null): number | null {
  return v === null || Number.isNaN(v) ? null : Math.round(v * 10_000) / 10_000;
}

export interface AnalyzeOptions {
  outcome: Outcome;
  exclude?: readonly string[];
  replicates?: number;
  seed?: number;
}

export function analyzeSnapshot(files: readonly SnapshotFile[], options: AnalyzeOptions): SnapshotAnalysis {
  const replicates = options.replicates ?? BOOTSTRAP_REPLICATES;
  const sorted = [...files]
    .filter((f) => !(options.exclude ?? []).includes(f.repository.id))
    .sort((a, b) => (a.repository.id < b.repository.id ? -1 : 1));
  const snapshotIds = new Set(sorted.map((f) => f.snapshot.id));
  if (snapshotIds.size > 1) throw new Error("All snapshot files in one analysis must share a snapshot id.");

  const prepared = sorted.map((f) => repoData(f, options.outcome));
  const repositories: RepositoryResult[] = prepared.map(({ data, dropped, ranked }) => {
    const both = data.positives.length > 0 && data.negatives.length > 0;
    return {
      id: data.id,
      language: data.language,
      rankedFiles: ranked,
      droppedWithoutChurn: dropped,
      positives: data.positives.length,
      negatives: data.negatives.length,
      eligible: isEligible(data),
      auc: {
        score: both ? roundOrNull(aucOf(data.rows, PREDICTORS.score)) : null,
        lines: both ? roundOrNull(aucOf(data.rows, PREDICTORS.lines)) : null,
        churn: both ? roundOrNull(aucOf(data.rows, PREDICTORS.churn)) : null,
      },
      spearmanScoreCount: both
        ? roundOrNull(
            spearman(
              data.rows.map((r) => r.score),
              data.rows.map((r) => r.count),
            ),
          )
        : null,
    };
  });

  const eligible = prepared.map((p) => p.data).filter(isEligible);
  const base = {
    snapshot: sorted[0]?.snapshot.id ?? "",
    outcome: options.outcome,
    repositories,
  };
  if (eligible.length === 0) return { ...base, pooled: null, regression: null };

  const ids = eligible.map((d) => d.id);
  const point = pooledAucs(eligible);
  const allScores = eligible.flatMap((d) => d.rows.map((r) => r.score));
  const scoreMean = mean(allScores);
  const scoreSd = standardDeviation(allScores);
  const pointDesign = regressionDesign(eligible, scoreMean, scoreSd);
  let pointOddsRatio: number | null = null;
  let regressionError: string | undefined;
  try {
    pointOddsRatio = Math.exp(logistic(pointDesign.x, pointDesign.y).coefficients[1] ?? Number.NaN);
  } catch (error) {
    regressionError = error instanceof Error ? error.message : String(error);
  }

  const rng = createRng(options.seed ?? BOOTSTRAP_SEED);
  const boot = {
    score: [] as number[],
    lines: [] as number[],
    churn: [] as number[],
    vsLines: [] as number[],
    vsChurn: [] as number[],
    or: [] as number[],
  };
  let failed = 0;
  for (let b = 0; b < replicates; b++) {
    const sample = Array.from({ length: eligible.length }, () =>
      resampleRepo(rng, eligible[randomInt(rng, eligible.length)] as RepoData),
    );
    const a = pooledAucs(sample);
    boot.score.push(a.score);
    boot.lines.push(a.lines);
    boot.churn.push(a.churn);
    boot.vsLines.push(a.score - a.lines);
    boot.vsChurn.push(a.score - a.churn);
    if (pointOddsRatio !== null) {
      try {
        const design = regressionDesign(sample, scoreMean, scoreSd);
        boot.or.push(Math.exp(logistic(design.x, design.y).coefficients[1] ?? Number.NaN));
      } catch {
        failed++;
      }
    }
  }

  const vsLines = estimate(point.score - point.lines, boot.vsLines);
  const vsChurn = estimate(point.score - point.churn, boot.vsChurn);
  return {
    ...base,
    pooled: {
      repositories: ids,
      meanAuc: {
        score: estimate(point.score, boot.score),
        lines: estimate(point.lines, boot.lines),
        churn: estimate(point.churn, boot.churn),
      },
      difference: { versusLines: vsLines, versusChurn: vsChurn },
      successCriterion: vsLines.lower > 0 && vsChurn.lower > 0,
    },
    regression: {
      repositories: ids,
      files: eligible.reduce((n, d) => n + d.rows.length, 0),
      oddsRatioPerSd: pointOddsRatio === null ? null : estimate(pointOddsRatio, boot.or),
      failedReplicates: failed,
      ...(regressionError === undefined ? {} : { error: regressionError }),
    },
  };
}

// Point estimates only, labelled exploratory: they inform a possible recalibration and
// are never used for the decision.
export function exploratory(files: readonly SnapshotFile[]): Exploratory {
  const repos = files.map((f) => repoData(f, "bugfix").data).filter(isEligible);
  const pooled = (subset: readonly RepoData[], pick: (r: Row) => number | null): number | null => {
    const values: number[] = [];
    for (const d of subset) {
      const rows = d.rows.filter((r) => pick(r) !== null);
      if (rows.some((r) => r.positive) && rows.some((r) => !r.positive)) {
        values.push(aucOf(rows, (r) => pick(r) ?? 0));
      }
    }
    return values.length === 0 ? null : roundOrNull(mean(values));
  };
  const withinRows = (keep: (r: Row) => boolean) =>
    repos.map((d) => {
      const rows = d.rows.filter(keep);
      return {
        ...d,
        rows,
        positives: rows.filter((r) => r.positive),
        negatives: rows.filter((r) => !r.positive),
      };
    });
  return {
    note: "Exploratory point estimates (protocol §5.3). Not used for the decision.",
    groupAuc: {
      changePressure: pooled(repos, (r) => r.groups.changePressure ?? null),
      knowledge: pooled(repos, (r) => r.groups.knowledge ?? null),
      complexity: pooled(repos, (r) => r.groups.complexity ?? null),
      impact: pooled(repos, (r) => r.impact),
    },
    scoreAucByLanguage: {
      tsJs: pooled(
        repos.filter((d) => TS_JS.has(d.language)),
        PREDICTORS.score,
      ),
      other: pooled(
        repos.filter((d) => !TS_JS.has(d.language)),
        PREDICTORS.score,
      ),
    },
    scoreAucByConfidence: {
      atLeast07: pooled(
        withinRows((r) => r.confidence >= 0.7),
        PREDICTORS.score,
      ),
      below07: pooled(
        withinRows((r) => r.confidence < 0.7),
        PREDICTORS.score,
      ),
    },
  };
}
