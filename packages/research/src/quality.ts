import type { JudgedRow, SampleKey } from "./sample.js";

export const MIN_PRECISION = 0.7;
const Z_95 = 1.959_963_984_540_054;

export interface Interval {
  estimate: number;
  lower: number;
  upper: number;
}

export function wilson(successes: number, trials: number): Interval {
  if (trials === 0) return { estimate: 0, lower: 0, upper: 1 };
  const p = successes / trials;
  const z2 = Z_95 * Z_95;
  const centre = (p + z2 / (2 * trials)) / (1 + z2 / trials);
  const half = (Z_95 * Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials))) / (1 + z2 / trials);
  return { estimate: p, lower: Math.max(0, centre - half), upper: Math.min(1, centre + half) };
}

export interface LabelQuality {
  rule: string;
  seed: number;
  dataset: SampleKey["dataset"];
  labelledBy: string;
  sample: { positives: number; negatives: number; unsurePositives: number; unsureNegatives: number };
  population: { positives: number; negatives: number };
  precision: Interval;
  missRate: Interval;
  recall: Interval;
  threshold: number;
  meetsThreshold: boolean;
  byRepository: Record<string, { judgedPositives: number; truePositives: number }>;
}

// Precision is the share of rule-positive commits the person judged to be fixes. The miss
// rate is the share of rule-negative commits that were fixes. Both samples are allocated in
// proportion to each repository's population, so they are self-weighting. Recall combines
// them with the population sizes; its interval plugs in the Wilson bounds of both rates,
// which is conservative. "Unsure" judgements are left out and counted.
export function labelQuality(key: SampleKey, judged: readonly JudgedRow[], labelledBy: string): LabelQuality {
  const decided = judged.filter((r) => r.judgement !== "unsure");
  const positives = decided.filter((r) => r.ruleSaysFix);
  const negatives = decided.filter((r) => !r.ruleSaysFix);
  const precision = wilson(positives.filter((r) => r.judgement === "yes").length, positives.length);
  const missRate = wilson(negatives.filter((r) => r.judgement === "yes").length, negatives.length);

  const totals = Object.values(key.population).reduce(
    (acc, p) => ({ positives: acc.positives + p.positives, negatives: acc.negatives + p.negatives }),
    { positives: 0, negatives: 0 },
  );
  const recallAt = (p: number, q: number) => {
    const found = p * totals.positives;
    const missed = q * totals.negatives;
    return found + missed === 0 ? 0 : found / (found + missed);
  };

  const byRepository: LabelQuality["byRepository"] = {};
  for (const id of Object.keys(key.population).sort()) {
    const mine = positives.filter((r) => r.repository === id);
    byRepository[id] = {
      judgedPositives: mine.length,
      truePositives: mine.filter((r) => r.judgement === "yes").length,
    };
  }

  return {
    rule: key.rule,
    seed: key.seed,
    dataset: key.dataset,
    labelledBy,
    sample: {
      positives: positives.length,
      negatives: negatives.length,
      unsurePositives: judged.filter((r) => r.ruleSaysFix && r.judgement === "unsure").length,
      unsureNegatives: judged.filter((r) => !r.ruleSaysFix && r.judgement === "unsure").length,
    },
    population: totals,
    precision: rounded(precision),
    missRate: rounded(missRate),
    recall: rounded({
      estimate: recallAt(precision.estimate, missRate.estimate),
      lower: recallAt(precision.lower, missRate.upper),
      upper: recallAt(precision.upper, missRate.lower),
    }),
    threshold: MIN_PRECISION,
    meetsThreshold: precision.estimate >= MIN_PRECISION,
    byRepository,
  };
}

function rounded(interval: Interval): Interval {
  const r = (v: number) => Math.round(v * 10_000) / 10_000;
  return { estimate: r(interval.estimate), lower: r(interval.lower), upper: r(interval.upper) };
}
