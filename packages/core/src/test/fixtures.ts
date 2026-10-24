import type { FileEvidence, HistoryEvidence } from "../evidence.js";

export const AS_OF = "2026-06-01T00:00:00Z";

export function history(overrides: Partial<HistoryEvidence> = {}): FileEvidence["history"] {
  return {
    status: "observed",
    value: {
      firstCommitAt: "2024-01-01T00:00:00Z",
      lastCommitAt: "2026-05-01T00:00:00Z",
      totalCommits: 20,
      commitsRecent: 2,
      linesChangedRecent: 40,
      churnByAuthorInWindow: [60, 40],
      historicalChurn: 500,
      inactiveAuthorHistoricalChurn: 100,
      ...overrides,
    },
  };
}

export function file(path: string, overrides: Partial<FileEvidence> = {}): FileEvidence {
  return {
    path,
    language: "typescript",
    lineCount: 200,
    history: history(),
    complexity: { status: "observed", value: { cyclomaticMax: 6, cognitiveTotal: 12, codeLines: 160 } },
    review: { status: "missing", reason: "not_available_locally" },
    provenance: { status: "observed", value: { markedLinesRecent: 0 } },
    dependencies: { status: "observed", value: { transitiveFanIn: 3 } },
    criticality: { status: "missing", reason: "not_configured" },
    ...overrides,
  };
}

export function repo(count: number): FileEvidence[] {
  return Array.from({ length: count }, (_, i) =>
    file(`src/file-${String(i).padStart(3, "0")}.ts`, {
      lineCount: 50 + i * 15,
      history: history({
        totalCommits: 3 + i,
        commitsRecent: i % 7,
        linesChangedRecent: (i * 37) % 400,
        churnByAuthorInWindow: i % 3 === 0 ? [100] : [80, 20 + i],
        historicalChurn: 200 + i * 10,
        inactiveAuthorHistoricalChurn: (i * 13) % 200,
      }),
      complexity: {
        status: "observed",
        value: { cyclomaticMax: 1 + (i % 25), cognitiveTotal: (i * 7) % 60, codeLines: 40 + i * 12 },
      },
      dependencies: { status: "observed", value: { transitiveFanIn: (i * 5) % 40 } },
    }),
  );
}
