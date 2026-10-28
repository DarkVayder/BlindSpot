import { describe, expect, it } from "vitest";
import { atOrAbove, compareResults, newlyAtOrAbove, RELATIVE_SCORE_CAVEAT } from "./compare.js";
import { defaultConfig } from "./config.js";
import { scoreRepository } from "./model/score.js";
import type { AnalysisResult, FileRisk, RiskBand } from "./result.js";
import { AS_OF, file } from "./test/fixtures.js";

const template: FileRisk = scoreRepository([file("x.ts")], defaultConfig(), AS_OF)[0] as FileRisk;

function f(path: string, band: RiskBand, score: number | null): FileRisk {
  return { ...template, path, band, score };
}

function snapshot(files: FileRisk[], overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    schemaVersion: 1,
    toolVersion: "test",
    modelVersion: "bs-risk@0.1.0",
    asOf: AS_OF,
    repository: { headCommit: "a".repeat(40), shallow: false },
    configHash: `sha256:${"0".repeat(64)}`,
    coverage: {
      trackedFiles: files.length,
      analyzedFiles: files.length,
      excludedFiles: 0,
      excludedByReason: {},
      commitsRead: 1,
      historyTruncated: false,
      incomplete: false,
    },
    notes: [],
    warnings: [],
    files,
    ...overrides,
  };
}

describe("compareResults", () => {
  const baseline = snapshot([
    f("same.ts", "low", 10),
    f("worse.ts", "moderate", 40),
    f("better.ts", "high", 80),
    f("gone.ts", "low", 5),
    f("unknown-then-high.ts", "insufficient_evidence", 70),
  ]);
  const current = snapshot([
    f("same.ts", "low", 10),
    f("worse.ts", "elevated", 55.25),
    f("better.ts", "moderate", 30),
    f("added.ts", "high", 90),
    f("unknown-then-high.ts", "high", 76),
  ]);
  const comparison = compareResults(baseline, current);

  it("classifies every file and computes score deltas", () => {
    expect(comparison.files.map((d) => [d.path, d.change, d.scoreDelta])).toEqual([
      ["added.ts", "new", null],
      ["better.ts", "changed", -50],
      ["gone.ts", "removed", null],
      ["same.ts", "unchanged", 0],
      ["unknown-then-high.ts", "changed", 6],
      ["worse.ts", "changed", 15.3],
    ]);
    expect(comparison.summary).toEqual({ new: 1, removed: 1, changed: 3, worsened: 1, improved: 1 });
    expect(comparison).toMatchObject({ comparable: true, caveats: [RELATIVE_SCORE_CAVEAT] });
  });

  it("finds files newly at or above a band, including ones that were previously unranked", () => {
    expect(newlyAtOrAbove(comparison, "elevated").map((d) => d.path)).toEqual([
      "added.ts",
      "unknown-then-high.ts",
      "worse.ts",
    ]);
    expect(newlyAtOrAbove(comparison, "high").map((d) => d.path)).toEqual([
      "added.ts",
      "unknown-then-high.ts",
    ]);
  });

  it("never treats insufficient evidence as being at or above a band", () => {
    const unranked = snapshot([f("a.ts", "insufficient_evidence", 99)]);
    expect(newlyAtOrAbove(compareResults(snapshot([]), unranked), "low")).toEqual([]);
    expect(atOrAbove(unranked.files, "low")).toEqual([]);
  });

  it("flags snapshots from different models as not comparable and notes config changes", () => {
    const other = compareResults(
      baseline,
      snapshot(current.files, { modelVersion: "bs-risk@0.2.0", configHash: `sha256:${"1".repeat(64)}` }),
    );
    expect(other.comparable).toBe(false);
    expect(other.caveats.join(" ")).toMatch(/different models.*configuration changed/s);
  });
});

describe("atOrAbove", () => {
  it("selects ranked files at or above the threshold", () => {
    const files = [f("a", "low", 1), f("b", "moderate", 30), f("c", "elevated", 60), f("d", "high", 90)];
    expect(atOrAbove(files, "elevated").map((x) => x.path)).toEqual(["c", "d"]);
  });
});
