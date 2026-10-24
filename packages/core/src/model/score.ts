import type { BlindspotConfig } from "../config.js";
import type { FileEvidence, MissingReason } from "../evidence.js";
import type { FileRisk, GroupResult, RiskBand, SignalResult } from "../result.js";
import {
  BANDS,
  CONFIDENCE_FULL,
  CONFIDENCE_SCORED,
  FULL_HISTORY_AGE_DAYS,
  FULL_HISTORY_COMMITS,
  GROUP_IDS,
  MIN_CHURN_DENOMINATOR,
  MODEL_VERSION,
  NEUTRAL_IMPACT,
  NEUTRAL_IMPACT_CONFIDENCE_FACTOR,
  SIGNAL_IDS,
  SIGNALS,
  STALENESS_COMPLEXITY_THRESHOLD,
  type GroupId,
  type SignalId,
} from "./constants.js";
import { describeFile } from "./explain.js";
import { absoluteScale, combine, midRankPercentiles, round } from "./normalize.js";

const DAY_MS = 86_400_000;
const CORE_GROUPS: readonly GroupId[] = ["changePressure", "knowledge", "complexity", "review"];

export type RawSignal =
  | { status: "observed"; raw: number }
  | { status: "missing"; reason: MissingReason }
  | { status: "not_applicable"; note: string };

export interface FileContext {
  evidence: FileEvidence;
  raw: Record<SignalId, RawSignal>;
  historyFactor: number;
  provenanceReviewKnown: boolean;
}

export function scoreRepository(
  files: readonly FileEvidence[],
  config: BlindspotConfig,
  asOf: string,
): FileRisk[] {
  const asOfMs = Date.parse(asOf);
  if (Number.isNaN(asOfMs)) throw new Error(`Invalid asOf timestamp: ${asOf}`);

  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]?.path === sorted[i - 1]?.path) throw new Error(`Duplicate file path: ${sorted[i]?.path}`);
  }

  const contexts = sorted.map((evidence) => buildContext(evidence, asOfMs));
  const percentiles = percentilesBySignal(contexts);

  return contexts.map((ctx, index) => scoreFile(ctx, index, percentiles, config));
}

function buildContext(evidence: FileEvidence, asOfMs: number): FileContext {
  const raw = {} as Record<SignalId, RawSignal>;
  const { history, complexity, review, provenance, dependencies } = evidence;

  if (history.status === "observed") {
    const h = history.value;
    raw.churn_recent = observed(h.linesChangedRecent / Math.max(evidence.lineCount, MIN_CHURN_DENOMINATOR));
    raw.commits_recent = observed(h.commitsRecent);
    const windowChurn = sum(h.churnByAuthorInWindow);
    raw.ownership_concentration =
      windowChurn === 0
        ? missing("no_changes_in_window")
        : observed(Math.max(...h.churnByAuthorInWindow) / windowChurn);
    raw.inactive_knowledge =
      h.historicalChurn === 0
        ? missing("no_line_changes")
        : observed(h.inactiveAuthorHistoricalChurn / h.historicalChurn);
    raw.time_since_change = observed(daysBetween(Date.parse(h.lastCommitAt), asOfMs));
  } else {
    for (const id of [
      "churn_recent",
      "commits_recent",
      "ownership_concentration",
      "inactive_knowledge",
      "time_since_change",
    ] as const) {
      raw[id] = missing(history.reason);
    }
  }

  if (complexity.status === "observed") {
    raw.cyclomatic_max = observed(complexity.value.cyclomaticMax);
    raw.cognitive_total = observed(complexity.value.cognitiveTotal);
    raw.size_loc = observed(complexity.value.codeLines);
  } else {
    raw.cyclomatic_max = missing(complexity.reason);
    raw.cognitive_total = missing(complexity.reason);
    raw.size_loc = missing(complexity.reason);
  }

  raw.unreviewed_change_share =
    review.status === "observed" ? observed(review.value.unreviewedChurnShare) : missing(review.reason);

  let provenanceReviewKnown = false;
  if (provenance.status === "missing") {
    raw.ai_attributed_unreviewed_share = missing(provenance.reason);
  } else if (provenance.value.markedLinesRecent === 0) {
    raw.ai_attributed_unreviewed_share = {
      status: "not_applicable",
      note: "No explicit AI provenance markers in recent changes. This does not mean the code was written without AI assistance.",
    };
  } else {
    const p = provenance.value;
    provenanceReviewKnown = p.markedUnreviewedLinesRecent !== undefined;
    const recentLines = history.status === "observed" ? history.value.linesChangedRecent : 0;
    const numerator = p.markedUnreviewedLinesRecent ?? p.markedLinesRecent;
    raw.ai_attributed_unreviewed_share = observed(Math.min(1, numerator / Math.max(1, recentLines)));
  }

  raw.fan_in_transitive =
    dependencies.status === "observed"
      ? observed(dependencies.value.transitiveFanIn)
      : missing(dependencies.reason);

  const historyFactor =
    history.status === "observed"
      ? Math.min(1, history.value.totalCommits / FULL_HISTORY_COMMITS) *
        Math.min(1, daysBetween(Date.parse(history.value.firstCommitAt), asOfMs) / FULL_HISTORY_AGE_DAYS)
      : 0;

  return { evidence, raw, historyFactor, provenanceReviewKnown };
}

function percentilesBySignal(contexts: readonly FileContext[]): Record<SignalId, (number | undefined)[]> {
  const result = {} as Record<SignalId, (number | undefined)[]>;
  for (const id of SIGNAL_IDS) {
    const indices: number[] = [];
    const values: number[] = [];
    contexts.forEach((ctx, i) => {
      const s = ctx.raw[id];
      if (s.status === "observed") {
        indices.push(i);
        values.push(s.raw);
      }
    });
    const ranks = midRankPercentiles(values);
    const column = new Array<number | undefined>(contexts.length).fill(undefined);
    indices.forEach((fileIndex, k) => {
      column[fileIndex] = ranks[k];
    });
    result[id] = column;
  }
  return result;
}

interface SignalValue {
  result: SignalResult;
  normalized: number | undefined;
}

function scoreFile(
  ctx: FileContext,
  index: number,
  percentiles: Record<SignalId, (number | undefined)[]>,
  config: BlindspotConfig,
): FileRisk {
  const values = {} as Record<SignalId, SignalValue>;
  for (const id of SIGNAL_IDS) {
    const s = ctx.raw[id];
    if (s.status === "observed") {
      const percentile = percentiles[id][index] as number;
      const normalized = combine(percentile, absoluteScale(s.raw, SIGNALS[id].transform));
      values[id] = {
        normalized,
        result: {
          id,
          status: "observed",
          raw: round(s.raw, 4),
          percentile: round(percentile, 4),
          normalized: round(normalized, 4),
        },
      };
    } else if (s.status === "missing") {
      values[id] = { normalized: undefined, result: { id, status: "missing", reason: s.reason } };
    } else {
      values[id] = { normalized: undefined, result: { id, status: "not_applicable", note: s.note } };
    }
  }

  const complexityValue = groupValue("complexity", values);
  const staleness = values.time_since_change;
  if (
    staleness.result.status === "observed" &&
    (complexityValue === null || complexityValue < STALENESS_COMPLEXITY_THRESHOLD)
  ) {
    values.time_since_change = {
      normalized: undefined,
      result: {
        id: "time_since_change",
        status: "not_applicable",
        note: "Time since last change only counts toward risk for files with above-average complexity.",
      },
    };
  }

  const groupValues = Object.fromEntries(GROUP_IDS.map((g) => [g, groupValue(g, values)])) as Record<
    GroupId,
    number | null
  >;
  const groupStatus = Object.fromEntries(GROUP_IDS.map((g) => [g, statusOf(g, values)])) as Record<
    GroupId,
    GroupResult["status"]
  >;

  let weightObserved = 0;
  let weightedSum = 0;
  let weightApplicable = 0;
  for (const g of GROUP_IDS) {
    const w = config.weights[g];
    if (w === 0 || groupStatus[g] === "not_applicable") continue;
    weightApplicable += w;
    const v = groupValues[g];
    if (v !== null) {
      weightObserved += w;
      weightedSum += w * v;
    }
  }

  const hasCoreEvidence = CORE_GROUPS.some((g) => config.weights[g] > 0 && groupValues[g] !== null);
  const difficulty = hasCoreEvidence && weightObserved > 0 ? weightedSum / weightObserved : null;

  const fan = values.fan_in_transitive.normalized;
  const critical = ctx.evidence.criticality.status === "observed" && ctx.evidence.criticality.value.critical;
  const impactObserved = fan !== undefined || critical;
  const impact = critical ? 1 : (fan ?? NEUTRAL_IMPACT);

  const score =
    difficulty === null
      ? null
      : round(100 * difficulty * (config.impactFloor + (1 - config.impactFloor) * impact), 1);

  const coverage = weightApplicable === 0 ? 0 : weightObserved / weightApplicable;
  const confidence = round(
    coverage * (0.5 + 0.5 * ctx.historyFactor) * (impactObserved ? 1 : NEUTRAL_IMPACT_CONFIDENCE_FACTOR),
    2,
  );

  const band = bandFor(score, confidence);

  const groups: GroupResult[] = GROUP_IDS.map((g) => {
    const v = groupValues[g];
    const w = config.weights[g];
    return {
      id: g,
      weight: w,
      status: groupStatus[g],
      value: v === null ? null : round(v, 4),
      contribution: v === null || weightObserved === 0 ? null : round((w * v) / weightObserved, 4),
    };
  });

  const signals = SIGNAL_IDS.map((id) => values[id].result);
  const description = describeFile({
    ctx,
    config,
    band,
    groups,
    signals,
    impact,
    impactObserved,
  });

  return {
    path: ctx.evidence.path,
    language: ctx.evidence.language,
    modelVersion: MODEL_VERSION,
    score,
    band,
    confidence,
    limitedEvidence: band !== "insufficient_evidence" && confidence < CONFIDENCE_FULL,
    impact: { value: round(impact, 4), status: impactObserved ? "observed" : "neutral_fallback" },
    groups,
    signals,
    ...description,
  };
}

function groupValue(group: GroupId, values: Record<SignalId, SignalValue>): number | null {
  let total = 0;
  let weight = 0;
  for (const id of SIGNAL_IDS) {
    const spec = SIGNALS[id];
    const n = values[id].normalized;
    if (spec.group !== group || n === undefined) continue;
    total += spec.weightInGroup * n;
    weight += spec.weightInGroup;
  }
  return weight === 0 ? null : total / weight;
}

function statusOf(group: GroupId, values: Record<SignalId, SignalValue>): GroupResult["status"] {
  const members = SIGNAL_IDS.filter((id) => SIGNALS[id].group === group).map(
    (id) => values[id].result.status,
  );
  if (members.includes("observed")) return "observed";
  if (members.every((s) => s === "not_applicable")) return "not_applicable";
  return "missing";
}

function bandFor(score: number | null, confidence: number): RiskBand {
  if (score === null || confidence < CONFIDENCE_SCORED) return "insufficient_evidence";
  for (const b of BANDS) if (score >= b.min) return b.band;
  return "low";
}

function observed(raw: number): RawSignal {
  return { status: "observed", raw };
}

function missing(reason: MissingReason): RawSignal {
  return { status: "missing", reason };
}

function sum(xs: readonly number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

function daysBetween(fromMs: number, toMs: number): number {
  return Math.max(0, (toMs - fromMs) / DAY_MS);
}
