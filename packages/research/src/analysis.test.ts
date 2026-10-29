import { describe, expect, it } from "vitest";
import { analyzeSnapshot, exploratory } from "./analysis.js";
import { createRng } from "./random.js";
import type { SnapshotFile, SnapshotFileRow } from "./snapshot.js";

function file(id: string, rows: Partial<SnapshotFileRow>[], language = "typescript"): SnapshotFile {
  return {
    schemaVersion: 1,
    dataset: { id: "test", sha256: "x" },
    repository: { id, language },
    snapshot: { id: "T1", commit: "a", committedAt: "", end: "b", endCommittedAt: "", windowDays: 180 },
    provenance: { toolVersion: "t", modelVersion: "m", gitVersion: "g", rules: { bugfix: "b", revert: "r" } },
    coverage: { trackedFiles: 0, analyzedFiles: rows.length, commitsRead: 0, incomplete: false },
    warnings: [],
    window: { commits: 0, bugfixCommits: 0, revertCommits: 0, bugfixVerdicts: {} },
    files: rows.map((r, i) => ({
      path: `f${i}.ts`,
      language,
      lineCount: 100,
      score: 50,
      band: "moderate",
      confidence: 0.8,
      ranked: true,
      priorChurn: 10,
      ageDays: 100,
      groups: { changePressure: 0.5, knowledge: 0.5, complexity: 0.5, review: null, provenance: null },
      impact: 0.5,
      bugfixCount: 0,
      revertCount: 0,
      ...r,
    })),
  };
}

// The score ranks outcomes well but not perfectly (every seventh file crosses over, so the
// regression has a finite maximum); size, churn and age carry no information.
function separating(id: string, n = 30): SnapshotFile {
  const half = n / 2;
  return file(
    id,
    Array.from({ length: n }, (_, i) => ({
      score: i,
      lineCount: 100 + ((i * 7) % 13),
      priorChurn: (i * 5) % 11,
      ageDays: 50 + ((i * 3) % 17),
      bugfixCount: i >= half !== (i % 7 === 3) ? 1 : 0,
    })),
  );
}

describe("analyzeSnapshot", () => {
  it("pools eligible repositories and meets the criterion when the score separates outcomes", () => {
    const result = analyzeSnapshot([separating("a"), separating("b"), separating("c")], {
      outcome: "bugfix",
      replicates: 200,
    });
    expect(result.pooled?.meanAuc.score.estimate).toBeGreaterThan(0.75);
    expect(result.pooled?.difference.versusLines.lower).toBeGreaterThan(0);
    expect(result.pooled?.successCriterion).toBe(true);
    expect(result.regression?.files).toBe(90);
    expect(result.regression?.oddsRatioPerSd?.estimate).toBeGreaterThan(1);
  });

  it("fits every bootstrap replicate, including ones that leave a repository out", () => {
    const noisy = (id: string, seed: number) => {
      const rng = createRng(seed);
      return file(
        id,
        Array.from({ length: 120 }, () => {
          const score = Math.round(rng() * 100);
          return {
            score,
            lineCount: 20 + Math.floor(rng() * 500),
            priorChurn: Math.floor(rng() * 50),
            ageDays: 30 + Math.floor(rng() * 900),
            bugfixCount: rng() < 0.15 + score / 250 ? 1 : 0,
          };
        }),
      );
    };
    const result = analyzeSnapshot([noisy("a", 1), noisy("b", 2), noisy("c", 3), noisy("d", 4)], {
      outcome: "bugfix",
      replicates: 200,
    });
    expect(result.regression?.failedReplicates).toBe(0);
  });

  it("reports a regression that cannot be fitted instead of failing the analysis", () => {
    const constantAge = separating("a");
    for (const row of constantAge.files) row.ageDays = 100;
    const result = analyzeSnapshot([constantAge], { outcome: "bugfix", replicates: 20 });
    expect(result.pooled).not.toBeNull();
    expect(result.regression?.oddsRatioPerSd).toBeNull();
    expect(result.regression?.error).toMatch(/singular/);
  });

  it("reports but does not pool repositories with fewer than 10 of either class", () => {
    const small = file("small", [
      ...Array.from({ length: 5 }, () => ({ bugfixCount: 1 })),
      ...Array.from({ length: 30 }, () => ({})),
    ]);
    const result = analyzeSnapshot([separating("a"), small], { outcome: "bugfix", replicates: 50 });
    expect(result.repositories.find((r) => r.id === "small")).toMatchObject({
      eligible: false,
      positives: 5,
    });
    expect(result.pooled?.repositories).toEqual(["a"]);
  });

  it("returns no pooled result when no repository is eligible", () => {
    const result = analyzeSnapshot([file("x", [{ bugfixCount: 1 }, {}])], {
      outcome: "bugfix",
      replicates: 10,
    });
    expect(result.pooled).toBeNull();
    expect(result.regression).toBeNull();
  });

  it("uses only ranked files with a known prior churn, and counts the ones dropped", () => {
    const base = separating("a");
    base.files.push(
      {
        ...base.files[0],
        path: "unranked.ts",
        ranked: false,
        band: "insufficient_evidence",
      } as SnapshotFileRow,
      { ...base.files[0], path: "nochurn.ts", priorChurn: null } as SnapshotFileRow,
    );
    const [repo] = analyzeSnapshot([base], { outcome: "bugfix", replicates: 10 }).repositories;
    expect(repo).toMatchObject({ rankedFiles: 31, droppedWithoutChurn: 1, positives: 15, negatives: 15 });
  });

  it("excludes repositories by id and is deterministic for a seed", () => {
    const files = [separating("a"), separating("b"), separating("django")];
    const without = analyzeSnapshot(files, { outcome: "bugfix", exclude: ["django"], replicates: 100 });
    expect(without.pooled?.repositories).toEqual(["a", "b"]);
    const again = analyzeSnapshot(files, { outcome: "bugfix", exclude: ["django"], replicates: 100 });
    expect(JSON.stringify(again)).toBe(JSON.stringify(without));
  });

  it("uses the revert outcome when asked", () => {
    const f = separating("a");
    const result = analyzeSnapshot([f], { outcome: "revert", replicates: 10 });
    expect(result.repositories[0]?.positives).toBe(0);
    expect(result.pooled).toBeNull();
  });
});

describe("exploratory", () => {
  it("is labelled exploratory and skips groups with no values", () => {
    const files = [separating("a"), separating("b", 40)];
    for (const row of files.flatMap((f) => f.files)) row.groups.complexity = null;
    const result = exploratory(files);
    expect(result.note).toMatch(/Exploratory/);
    expect(result.groupAuc.complexity).toBeNull();
    expect(result.scoreAucByLanguage.other).toBeNull();
    expect(result.scoreAucByLanguage.tsJs).toBeGreaterThan(0.75);
  });
});
