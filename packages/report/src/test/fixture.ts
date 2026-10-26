import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AnalysisResult } from "@blindspot/core";
import { parseReportJson } from "../json.js";

const GOLDEN = fileURLToPath(new URL("../../../engine/src/__golden__/basic.json", import.meta.url));

export function goldenText(): string {
  return readFileSync(GOLDEN, "utf8");
}

export function goldenResult(): AnalysisResult {
  const parsed = parseReportJson(goldenText());
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.result;
}

export function withPaths(result: AnalysisResult, paths: readonly string[]): AnalysisResult {
  const template = result.files.find((f) => f.band !== "insufficient_evidence");
  if (!template) throw new Error("golden result has no ranked files");
  return { ...result, files: paths.map((p) => ({ ...template, path: p })) };
}

export function emptyResult(): AnalysisResult {
  const r = goldenResult();
  return {
    ...r,
    asOf: null,
    repository: { headCommit: null, shallow: false },
    coverage: {
      ...r.coverage,
      trackedFiles: 0,
      analyzedFiles: 0,
      excludedFiles: 0,
      excludedByReason: {},
      commitsRead: 0,
    },
    warnings: ["The repository has no commits yet, so there is nothing to analyze."],
    files: [],
  };
}

export const HOSTILE_PATHS = [
  `src/<script>alert(1)</script>.ts`,
  `src/" onmouseover="alert(1)" x=".ts`,
  `src/'single'&amp;.ts`,
  "src/\u001b]8;;https://evil.example\u0007click\u001b]8;;\u0007.ts",
  "src/\u001b[2J\u001b[31mred.ts",
  "src/invoice\u202etxt.exe.ts",
  "src/</style><style>body{display:none}</style>.ts",
];
