import type { AnalysisResult, FileRisk, RiskBand } from "./result.js";

export type RankedBand = Exclude<RiskBand, "insufficient_evidence">;

const BAND_RANK: Record<RiskBand, number> = {
  insufficient_evidence: -1,
  low: 0,
  moderate: 1,
  elevated: 2,
  high: 3,
};

export function bandRank(band: RiskBand): number {
  return BAND_RANK[band];
}

export interface FileState {
  band: RiskBand;
  score: number | null;
}

export interface FileDelta {
  path: string;
  change: "new" | "removed" | "changed" | "unchanged";
  before: FileState | null;
  after: FileState | null;
  scoreDelta: number | null;
}

export interface SnapshotInfo {
  headCommit: string | null;
  asOf: string | null;
  modelVersion: string;
  configHash: string;
}

export interface Comparison {
  baseline: SnapshotInfo;
  current: SnapshotInfo;
  comparable: boolean;
  caveats: string[];
  summary: { new: number; removed: number; changed: number; worsened: number; improved: number };
  files: FileDelta[];
}

export const RELATIVE_SCORE_CAVEAT =
  "Scores are relative to the other files in each snapshot, so changes elsewhere in the repository can move a file's score.";

export function compareResults(baseline: AnalysisResult, current: AnalysisResult): Comparison {
  const caveats = [RELATIVE_SCORE_CAVEAT];
  const comparable = baseline.modelVersion === current.modelVersion;
  if (!comparable) {
    caveats.push(
      `The snapshots were scored by different models (${baseline.modelVersion} and ${current.modelVersion}), so differences may come from the model rather than the code. Re-run the baseline with the current version.`,
    );
  }
  if (baseline.configHash !== current.configHash) {
    caveats.push(
      "The configuration changed between the snapshots, which can change which files are analyzed and how they score.",
    );
  }

  const before = new Map(baseline.files.map((f) => [f.path, f]));
  const after = new Map(current.files.map((f) => [f.path, f]));
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );

  const files = paths.map((path): FileDelta => {
    const b = before.get(path);
    const a = after.get(path);
    const delta = b?.score != null && a?.score != null ? Math.round((a.score - b.score) * 10) / 10 : null;
    let change: FileDelta["change"];
    if (!b) change = "new";
    else if (!a) change = "removed";
    else change = b.band !== a.band || b.score !== a.score ? "changed" : "unchanged";
    return { path, change, before: b ? state(b) : null, after: a ? state(a) : null, scoreDelta: delta };
  });

  const ranked = (f: FileState | null) => f !== null && f.band !== "insufficient_evidence";
  return {
    baseline: info(baseline),
    current: info(current),
    comparable,
    caveats,
    summary: {
      new: files.filter((f) => f.change === "new").length,
      removed: files.filter((f) => f.change === "removed").length,
      changed: files.filter((f) => f.change === "changed").length,
      worsened: files.filter(
        (f) =>
          ranked(f.before) &&
          ranked(f.after) &&
          bandRank(f.after?.band ?? "low") > bandRank(f.before?.band ?? "low"),
      ).length,
      improved: files.filter(
        (f) =>
          ranked(f.before) &&
          ranked(f.after) &&
          bandRank(f.after?.band ?? "low") < bandRank(f.before?.band ?? "low"),
      ).length,
    },
    files,
  };
}

export function atOrAbove(files: readonly FileRisk[], band: RankedBand): FileRisk[] {
  return files.filter((f) => bandRank(f.band) >= bandRank(band));
}

// A file counts as newly at or above a band only when it is ranked there now and was not
// before: either it is new, it was below the band, or it lacked evidence to be ranked.
export function newlyAtOrAbove(comparison: Comparison, band: RankedBand): FileDelta[] {
  const threshold = bandRank(band);
  return comparison.files.filter(
    (f) =>
      f.after !== null &&
      bandRank(f.after.band) >= threshold &&
      (f.before === null || bandRank(f.before.band) < threshold),
  );
}

function state(f: FileRisk): FileState {
  return { band: f.band, score: f.score };
}

function info(r: AnalysisResult): SnapshotInfo {
  return {
    headCommit: r.repository.headCommit,
    asOf: r.asOf,
    modelVersion: r.modelVersion,
    configHash: r.configHash,
  };
}
