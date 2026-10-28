import {
  atOrAbove,
  newlyAtOrAbove,
  type AnalysisResult,
  type Comparison,
  type RankedBand,
} from "@blindspot/core";
import { CliError, EXIT } from "./io.js";

export const FAIL_ON_CHOICES = [
  "high",
  "elevated",
  "moderate",
  "new-high",
  "new-elevated",
  "new-moderate",
] as const;
export type FailOn = (typeof FAIL_ON_CHOICES)[number];

export interface GateOffender {
  path: string;
  score: number | null;
}

export interface GateResult {
  failed: boolean;
  description: string;
  offenders: GateOffender[];
}

export function parseFailOn(value: FailOn): { band: RankedBand; onlyNew: boolean } {
  const onlyNew = value.startsWith("new-");
  return { band: (onlyNew ? value.slice(4) : value) as RankedBand, onlyNew };
}

// Files with insufficient evidence never trip a gate: an unknown is not a failure, and
// failing builds on missing data would push teams to game the evidence.
export function evaluateGate(
  failOn: FailOn,
  result: AnalysisResult,
  comparison: Comparison | null,
): GateResult {
  const { band, onlyNew } = parseFailOn(failOn);
  if (!onlyNew) {
    const offenders = byScore(atOrAbove(result.files, band).map((f) => ({ path: f.path, score: f.score })));
    return { failed: offenders.length > 0, description: `at or above ${band}`, offenders };
  }
  if (!comparison) {
    throw new CliError(EXIT.usage, `--fail-on ${failOn} needs a baseline. Pass --baseline <report.json>.`);
  }
  if (!comparison.comparable) {
    throw new CliError(
      EXIT.usage,
      `--fail-on ${failOn} cannot compare reports from different models (${comparison.baseline.modelVersion} and ${comparison.current.modelVersion}). Regenerate the baseline with this version of Blindspot.`,
    );
  }
  const offenders = byScore(
    newlyAtOrAbove(comparison, band).map((d) => ({ path: d.path, score: d.after?.score ?? null })),
  );
  return {
    failed: offenders.length > 0,
    description: `newly at or above ${band} since the baseline`,
    offenders,
  };
}

function byScore(offenders: GateOffender[]): GateOffender[] {
  return offenders.sort(
    (a, b) => (b.score ?? -1) - (a.score ?? -1) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
  );
}
