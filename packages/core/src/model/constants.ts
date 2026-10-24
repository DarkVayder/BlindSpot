export const MODEL_VERSION = "bs-risk@0.1.0";

export const GROUP_IDS = ["changePressure", "knowledge", "complexity", "review", "provenance"] as const;
export type GroupId = (typeof GROUP_IDS)[number];

export const SIGNAL_IDS = [
  "churn_recent",
  "commits_recent",
  "ownership_concentration",
  "inactive_knowledge",
  "time_since_change",
  "cyclomatic_max",
  "cognitive_total",
  "size_loc",
  "unreviewed_change_share",
  "ai_attributed_unreviewed_share",
  "fan_in_transitive",
] as const;
export type SignalId = (typeof SIGNAL_IDS)[number];

export type Transform = { kind: "share" } | { kind: "saturating"; k: number };

export interface SignalSpec {
  group: GroupId | "impact";
  weightInGroup: number;
  transform: Transform;
}

// Each k is the raw value that maps to 0.5 on the absolute scale. These are priors
// pending Stage 2 calibration; changing any of them requires a MODEL_VERSION bump.
export const SIGNALS: Record<SignalId, SignalSpec> = {
  // Rewriting the equivalent of the whole file once in the recent window.
  churn_recent: { group: "changePressure", weightInGroup: 1, transform: { kind: "saturating", k: 1 } },
  // Roughly one change every 2.5 weeks over a 90-day window.
  commits_recent: { group: "changePressure", weightInGroup: 1, transform: { kind: "saturating", k: 5 } },
  ownership_concentration: { group: "knowledge", weightInGroup: 1, transform: { kind: "share" } },
  inactive_knowledge: { group: "knowledge", weightInGroup: 1, transform: { kind: "share" } },
  time_since_change: { group: "knowledge", weightInGroup: 1, transform: { kind: "saturating", k: 365 } },
  // McCabe's original "reconsider this function" threshold.
  cyclomatic_max: { group: "complexity", weightInGroup: 0.4, transform: { kind: "saturating", k: 10 } },
  cognitive_total: { group: "complexity", weightInGroup: 0.4, transform: { kind: "saturating", k: 25 } },
  // Lower in-group weight because size partly drives both complexity measures.
  size_loc: { group: "complexity", weightInGroup: 0.2, transform: { kind: "saturating", k: 300 } },
  unreviewed_change_share: { group: "review", weightInGroup: 1, transform: { kind: "share" } },
  ai_attributed_unreviewed_share: { group: "provenance", weightInGroup: 1, transform: { kind: "share" } },
  fan_in_transitive: { group: "impact", weightInGroup: 1, transform: { kind: "saturating", k: 10 } },
};

export const MIN_CHURN_DENOMINATOR = 20;
export const STALENESS_COMPLEXITY_THRESHOLD = 0.5;
export const NEUTRAL_IMPACT = 0.5;
export const NEUTRAL_IMPACT_CONFIDENCE_FACTOR = 0.8;
export const FULL_HISTORY_COMMITS = 5;
export const FULL_HISTORY_AGE_DAYS = 30;
export const CONFIDENCE_SCORED = 0.4;
export const CONFIDENCE_FULL = 0.7;

export const BANDS = [
  { band: "high", min: 75 },
  { band: "elevated", min: 50 },
  { band: "moderate", min: 25 },
  { band: "low", min: 0 },
] as const;
