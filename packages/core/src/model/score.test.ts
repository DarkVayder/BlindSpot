import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { defaultConfig, type BlindspotConfig } from "../config.js";
import type { FileEvidence } from "../evidence.js";
import { FileRisk } from "../result.js";
import { AS_OF, file, history, repo } from "../test/fixtures.js";
import { GROUP_IDS, MODEL_VERSION, type GroupId } from "./constants.js";
import { scoreRepository } from "./score.js";

const config = defaultConfig();

function scoreOne(target: FileEvidence, others: FileEvidence[] = repo(20), cfg: BlindspotConfig = config) {
  const result = scoreRepository([...others, target], cfg, AS_OF).find((f) => f.path === target.path);
  if (!result) throw new Error("target not scored");
  return result;
}

function signal(risk: FileRisk, id: string) {
  const s = risk.signals.find((x) => x.id === id);
  if (!s) throw new Error(`missing signal ${id}`);
  return s;
}

function group(risk: FileRisk, id: GroupId) {
  const g = risk.groups.find((x) => x.id === id);
  if (!g) throw new Error(`missing group ${id}`);
  return g;
}

describe("scoreRepository output contract", () => {
  it("produces schema-valid results sorted by path with the model version", () => {
    const results = scoreRepository(repo(30).reverse(), config, AS_OF);
    expect(results).toHaveLength(30);
    for (const r of results) {
      expect(() => FileRisk.parse(r)).not.toThrow();
      expect(r.modelVersion).toBe(MODEL_VERSION);
    }
    const paths = results.map((r) => r.path);
    expect(paths).toEqual([...paths].sort());
  });

  it("returns an empty list for an empty repository", () => {
    expect(scoreRepository([], config, AS_OF)).toEqual([]);
  });

  it("rejects duplicate paths", () => {
    expect(() => scoreRepository([file("a.ts"), file("a.ts")], config, AS_OF)).toThrow(/Duplicate/);
  });

  it("rejects an invalid asOf timestamp", () => {
    expect(() => scoreRepository([file("a.ts")], config, "yesterday")).toThrow(/asOf/);
  });

  it("group contributions sum to the difficulty implied by the score", () => {
    const r = scoreOne(file("target.ts"));
    const difficulty = r.groups.reduce((acc, g) => acc + (g.contribution ?? 0), 0);
    const expected = 100 * difficulty * (config.impactFloor + (1 - config.impactFloor) * r.impact.value);
    expect(r.score).toBeCloseTo(expected, 0);
  });
});

describe("missing evidence is not negative evidence", () => {
  it("marks review as missing in local mode and excludes it from the score", () => {
    const r = scoreOne(file("target.ts"));
    expect(signal(r, "unreviewed_change_share")).toMatchObject({
      status: "missing",
      reason: "not_available_locally",
    });
    expect(group(r, "review")).toMatchObject({ status: "missing", value: null, contribution: null });
    expect(r.limitations).toContain(
      "Review evidence not assessed: review data is not available in local mode.",
    );
  });

  it("lowers confidence when complexity is unsupported", () => {
    const supported = scoreOne(file("target.ts"));
    const unsupported = scoreOne(
      file("target.ts", { complexity: { status: "missing", reason: "language_not_supported" } }),
    );
    expect(unsupported.confidence).toBeLessThan(supported.confidence);
    expect(group(unsupported, "complexity").status).toBe("missing");
    expect(unsupported.limitations.join(" ")).toContain("this language is not supported yet");
  });

  it("returns no score when there is no core evidence at all", () => {
    const r = scoreOne(
      file("target.ts", {
        history: { status: "missing", reason: "git_unavailable" },
        complexity: { status: "missing", reason: "language_not_supported" },
        provenance: { status: "missing", reason: "git_unavailable" },
      }),
    );
    expect(r.score).toBeNull();
    expect(r.band).toBe("insufficient_evidence");
    expect(r.confidence).toBe(0);
    expect(r.actions).toEqual([
      "Gather more history or enable the missing analyzers before acting on this estimate.",
    ]);
  });

  it("uses a neutral impact and reduces confidence when dependencies are unknown", () => {
    const known = scoreOne(file("target.ts"));
    const unknown = scoreOne(
      file("target.ts", { dependencies: { status: "missing", reason: "language_not_supported" } }),
    );
    expect(unknown.impact).toEqual({ value: 0.5, status: "neutral_fallback" });
    expect(unknown.confidence).toBeLessThan(known.confidence);
    expect(unknown.limitations.join(" ")).toContain("Dependency impact unknown");
  });
});

describe("new and thin-history files", () => {
  it("treats a brand-new file as insufficient evidence instead of extreme risk", () => {
    const r = scoreOne(
      file("new.ts", {
        history: history({
          firstCommitAt: "2026-05-30T00:00:00Z",
          lastCommitAt: "2026-05-30T00:00:00Z",
          totalCommits: 1,
          commitsRecent: 1,
          linesChangedRecent: 200,
          churnByAuthorInWindow: [200],
          historicalChurn: 200,
          inactiveAuthorHistoricalChurn: 0,
        }),
        complexity: { status: "missing", reason: "language_not_supported" },
        dependencies: { status: "missing", reason: "language_not_supported" },
      }),
    );
    expect(r.band).toBe("insufficient_evidence");
    expect(r.limitations.join(" ")).toContain("Limited history (1 commit)");
  });

  it("flags limited evidence between the scored and full-confidence thresholds", () => {
    const r = scoreOne(file("target.ts", { complexity: { status: "missing", reason: "parse_failed" } }));
    expect(r.confidence).toBeGreaterThanOrEqual(0.4);
    expect(r.confidence).toBeLessThan(0.7);
    expect(r.limitedEvidence).toBe(true);
    expect(r.band).not.toBe("insufficient_evidence");
  });
});

describe("individual signals", () => {
  it("computes ownership concentration from the largest contributor share", () => {
    const r = scoreOne(file("target.ts", { history: history({ churnByAuthorInWindow: [30, 90, 30] }) }));
    expect(signal(r, "ownership_concentration")).toMatchObject({ status: "observed", raw: 0.6 });
  });

  it("marks ownership missing when nothing changed in the window", () => {
    const r = scoreOne(file("target.ts", { history: history({ churnByAuthorInWindow: [] }) }));
    expect(signal(r, "ownership_concentration")).toMatchObject({
      status: "missing",
      reason: "no_changes_in_window",
    });
    expect(group(r, "knowledge").status).toBe("observed");
  });

  it("uses a minimum denominator for churn on tiny files", () => {
    const r = scoreOne(file("tiny.ts", { lineCount: 2, history: history({ linesChangedRecent: 10 }) }));
    expect(signal(r, "churn_recent")).toMatchObject({ status: "observed", raw: 0.5 });
  });

  it("only counts staleness for complex files", () => {
    const old = history({ lastCommitAt: "2023-01-01T00:00:00Z" });
    const simple = scoreOne(
      file("simple.ts", {
        history: old,
        complexity: { status: "observed", value: { cyclomaticMax: 1, cognitiveTotal: 0, codeLines: 10 } },
      }),
    );
    expect(signal(simple, "time_since_change").status).toBe("not_applicable");

    const complex = scoreOne(
      file("complex.ts", {
        history: old,
        complexity: {
          status: "observed",
          value: { cyclomaticMax: 60, cognitiveTotal: 200, codeLines: 2000 },
        },
      }),
    );
    expect(signal(complex, "time_since_change")).toMatchObject({ status: "observed" });
    expect(complex.explanations.join(" ")).toMatch(/Not modified for \d+ days/);
  });
});

describe("AI provenance", () => {
  it("is not applicable and excluded from confidence when no markers exist", () => {
    const r = scoreOne(file("target.ts"));
    expect(group(r, "provenance").status).toBe("not_applicable");
    const s = signal(r, "ai_attributed_unreviewed_share");
    expect(s.status).toBe("not_applicable");
    if (s.status === "not_applicable")
      expect(s.note).toContain("does not mean the code was written without AI");
  });

  it("never claims human authorship anywhere in the output", () => {
    const text = JSON.stringify(scoreRepository(repo(25), config, AS_OF));
    expect(text).not.toMatch(/human-written|written by a human|not AI-generated/i);
  });

  it("says review status is unknown when only markers are available", () => {
    const r = scoreOne(
      file("target.ts", {
        history: history({ linesChangedRecent: 100 }),
        provenance: { status: "observed", value: { markedLinesRecent: 100 } },
      }),
    );
    expect(signal(r, "ai_attributed_unreviewed_share")).toMatchObject({ status: "observed", raw: 1 });
    expect(r.explanations.join(" ")).toContain("review status is unknown");
  });

  it("uses the unreviewed share when review status is known", () => {
    const r = scoreOne(
      file("target.ts", {
        history: history({ linesChangedRecent: 100 }),
        provenance: { status: "observed", value: { markedLinesRecent: 80, markedUnreviewedLinesRecent: 20 } },
      }),
    );
    expect(signal(r, "ai_attributed_unreviewed_share")).toMatchObject({ status: "observed", raw: 0.2 });
  });
});

describe("impact", () => {
  it("raises the score for files configured as critical", () => {
    const plain = scoreOne(
      file("target.ts", { criticality: { status: "observed", value: { critical: false } } }),
    );
    const critical = scoreOne(
      file("target.ts", { criticality: { status: "observed", value: { critical: true } } }),
    );
    expect(critical.impact.value).toBe(1);
    expect(critical.score ?? 0).toBeGreaterThan(plain.score ?? 0);
    expect(critical.explanations).toContain("Matches a path configured as critical.");
  });

  it("keeps a neutral impact when a file is not critical but its dependencies are unknown", () => {
    const r = scoreOne(
      file("script.py", {
        language: "python",
        dependencies: { status: "missing", reason: "language_not_supported" },
        criticality: { status: "observed", value: { critical: false } },
      }),
    );
    expect(r.impact).toEqual({ value: 0.5, status: "neutral_fallback" });
    expect(r.limitations.join(" ")).toContain("Dependency impact unknown");
  });

  it("treats a critical file as full impact even when dependencies are unknown", () => {
    const r = scoreOne(
      file("auth.py", {
        language: "python",
        dependencies: { status: "missing", reason: "language_not_supported" },
        criticality: { status: "observed", value: { critical: true } },
      }),
    );
    expect(r.impact).toEqual({ value: 1, status: "observed" });
  });
});

describe("a uniformly simple repository", () => {
  it("does not produce high scores just because some file ranks last", () => {
    const simple = Array.from({ length: 30 }, (_, i) =>
      file(`s${String(i).padStart(2, "0")}.ts`, {
        lineCount: 20 + i,
        history: history({
          commitsRecent: i % 2,
          linesChangedRecent: i % 3,
          churnByAuthorInWindow: [5, 5 + (i % 4)],
          inactiveAuthorHistoricalChurn: 0,
        }),
        complexity: {
          status: "observed",
          value: { cyclomaticMax: 1 + (i % 2), cognitiveTotal: i % 3, codeLines: 15 },
        },
        dependencies: { status: "observed", value: { transitiveFanIn: i % 2 } },
      }),
    );
    const results = scoreRepository(simple, config, AS_OF);
    for (const r of results) expect(r.score ?? 0).toBeLessThan(50);
  });
});

const arbitraryRepo = fc
  .integer({ min: 1, max: 40 })
  .chain((n) => fc.constant(repo(n)))
  .chain((files) => fc.shuffledSubarray(files, { minLength: 1, maxLength: files.length }));

describe("properties", () => {
  it("keeps every score within 0 to 100 and confidence within 0 to 1", () => {
    fc.assert(
      fc.property(arbitraryRepo, (files) => {
        for (const r of scoreRepository(files, config, AS_OF)) {
          if (r.score !== null) {
            expect(r.score).toBeGreaterThanOrEqual(0);
            expect(r.score).toBeLessThanOrEqual(100);
          }
          expect(r.confidence).toBeGreaterThanOrEqual(0);
          expect(r.confidence).toBeLessThanOrEqual(1);
        }
      }),
    );
  });

  it("produces byte-identical output regardless of input order", () => {
    fc.assert(
      fc.property(arbitraryRepo, fc.integer(), (files, seed) => {
        const shuffled = [...files].sort((a, b) => ((hash(a.path) ^ seed) - (hash(b.path) ^ seed)) | 0);
        expect(JSON.stringify(scoreRepository(shuffled, config, AS_OF))).toBe(
          JSON.stringify(scoreRepository(files, config, AS_OF)),
        );
      }),
    );
  });

  it("never lowers confidence when review evidence becomes available", () => {
    fc.assert(
      fc.property(arbitraryRepo, fc.double({ min: 0, max: 1, noNaN: true }), (files, share) => {
        const before = scoreRepository(files, config, AS_OF);
        const withReview = files.map((f) => ({
          ...f,
          review: { status: "observed" as const, value: { unreviewedChurnShare: share } },
        }));
        const after = scoreRepository(withReview, config, AS_OF);
        after.forEach((r, i) => {
          expect(r.confidence).toBeGreaterThanOrEqual(before[i]?.confidence ?? 0);
        });
      }),
    );
  });

  it("moves each score only in the direction implied by raising one group's weight", () => {
    fc.assert(
      fc.property(
        arbitraryRepo,
        fc.constantFrom<GroupId>("changePressure", "knowledge", "complexity"),
        (files, target) => {
          const raised: BlindspotConfig = {
            ...config,
            weights: { ...config.weights, [target]: Math.min(1, config.weights[target] + 0.3) },
          };
          const before = scoreRepository(files, config, AS_OF);
          const after = scoreRepository(files, raised, AS_OF);
          before.forEach((b, i) => {
            const a = after[i];
            const g = b.groups.find((x) => x.id === target);
            if (!a || b.score === null || a.score === null || !g || g.value === null) return;
            const difficulty = b.groups.reduce((acc, x) => acc + (x.contribution ?? 0), 0);
            if (g.value > difficulty + 1e-3) expect(a.score).toBeGreaterThanOrEqual(b.score);
            if (g.value < difficulty - 1e-3) expect(a.score).toBeLessThanOrEqual(b.score);
          });
        },
      ),
    );
  });
});

describe("explanations only reference observed evidence", () => {
  it("explains a signal on which every file ties without claiming a top rank", () => {
    const solo = Array.from({ length: 10 }, (_, i) =>
      file(`f${i}.ts`, { history: history({ churnByAuthorInWindow: [50 + i] }) }),
    );
    for (const r of scoreRepository(solo, config, AS_OF)) {
      const line = r.explanations.find((e) => e.includes("single contributor"));
      expect(line).toBe("100% of lines changed in the last 365 days came from a single contributor.");
    }
  });

  it("never explains a signal that was missing or not applicable", () => {
    const r = scoreOne(
      file("target.ts", {
        history: { status: "missing", reason: "shallow_history" },
        provenance: { status: "missing", reason: "shallow_history" },
      }),
    );
    expect(r.explanations.join(" ")).not.toMatch(/commit|contributor|Lines changed/);
    expect(r.limitations.join(" ")).toContain("history is truncated");
  });

  it("lists every group in a fixed order", () => {
    const r = scoreOne(file("target.ts"));
    expect(r.groups.map((g) => g.id)).toEqual([...GROUP_IDS]);
  });
});

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h;
}
