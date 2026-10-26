import type { FileRisk, RiskBand } from "@blindspot/core";

export const BAND_LABEL: Record<RiskBand, string> = {
  high: "High",
  elevated: "Elevated",
  moderate: "Moderate",
  low: "Low",
  insufficient_evidence: "Insufficient evidence",
};

export const BAND_ORDER: readonly RiskBand[] = [
  "high",
  "elevated",
  "moderate",
  "low",
  "insufficient_evidence",
];

export function isRanked(file: FileRisk): boolean {
  return file.band !== "insufficient_evidence" && file.score !== null;
}

export function rankFiles(files: readonly FileRisk[]): FileRisk[] {
  return [...files].sort((a, b) => {
    const ra = isRanked(a);
    const rb = isRanked(b);
    if (ra !== rb) return ra ? -1 : 1;
    if (ra && rb && a.score !== b.score) return (b.score ?? 0) - (a.score ?? 0);
    if (ra && rb && a.confidence !== b.confidence) return b.confidence - a.confidence;
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  });
}

export function bandCounts(files: readonly FileRisk[]): Record<RiskBand, number> {
  const counts: Record<RiskBand, number> = {
    high: 0,
    elevated: 0,
    moderate: 0,
    low: 0,
    insufficient_evidence: 0,
  };
  for (const f of files) counts[f.band]++;
  return counts;
}
