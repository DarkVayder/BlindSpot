import type { BlindspotConfig, FileEvidence } from "@blindspot/core";
import { readBlobs, type Repository, type TrackedEntry } from "@blindspot/git";
import { countNonBlankLines, isBinary, isGenerated } from "./content.js";
import { compare, matchesAny, selectFiles, type Candidate, type Exclusion } from "./discovery.js";
import { resolveSpecifier, transitiveFanIn } from "./graph.js";
import { isJsLike } from "./languages.js";
import { analyzeSource } from "./source.js";

export type AnalyzedFile = Pick<
  FileEvidence,
  "path" | "language" | "lineCount" | "complexity" | "dependencies" | "criticality"
> & { declaredProvenance: boolean };

export interface AnalysisOutput {
  files: AnalyzedFile[];
  excluded: Exclusion[];
  importEdges: number;
  graphComplete: boolean;
  warnings: string[];
}

interface Parsed {
  candidate: Candidate;
  lineCount: number;
  complexity: FileEvidence["complexity"];
  imports: string[] | null;
}

export async function analyzeFiles(
  repo: Repository,
  entries: readonly TrackedEntry[],
  config: BlindspotConfig,
  graphBudget?: number,
): Promise<AnalysisOutput> {
  const { candidates, excluded } = selectFiles(entries, config);
  const byOid = new Map<string, Candidate[]>();
  for (const c of candidates) byOid.set(c.oid, [...(byOid.get(c.oid) ?? []), c]);

  const parsed: Parsed[] = [];
  const seen = new Set<string>();
  await readBlobs(repo, [...byOid.keys()].sort(compare), config.limits.gitTimeoutMs, (oid, content) => {
    for (const candidate of byOid.get(oid) ?? []) {
      seen.add(candidate.path);
      if (content === null) {
        excluded.push({ path: candidate.path, reason: "unreadable" });
        continue;
      }
      if (isBinary(content)) {
        excluded.push({ path: candidate.path, reason: "binary" });
        continue;
      }
      const text = content.toString("utf8");
      if (isGenerated(text)) {
        excluded.push({ path: candidate.path, reason: "generated" });
        continue;
      }
      parsed.push(inspect(candidate, text));
    }
  });
  for (const c of candidates) {
    if (!seen.has(c.path)) excluded.push({ path: c.path, reason: "unreadable" });
  }

  const jsFiles = new Set(parsed.filter((p) => p.imports !== null).map((p) => p.candidate.path));
  const resolved = new Map<string, string[]>();
  for (const p of parsed) {
    if (p.imports === null) continue;
    const targets = p.imports
      .map((spec) => resolveSpecifier(p.candidate.path, spec, jsFiles))
      .filter((t): t is string => t !== null);
    resolved.set(p.candidate.path, targets);
  }
  const graph = transitiveFanIn(resolved, graphBudget);

  const warnings: string[] = [];
  if (graph.budgetExceeded) {
    warnings.push(
      "The import graph was too large to analyze completely; some files have no dependency impact.",
    );
  }

  const files = parsed
    .map((p): AnalyzedFile => {
      const path = p.candidate.path;
      return {
        path,
        language: p.candidate.language,
        lineCount: p.lineCount,
        complexity: p.complexity,
        dependencies: dependencyEvidence(p, graph.fanIn.get(path)),
        criticality:
          config.critical.length === 0
            ? { status: "missing", reason: "not_configured" }
            : { status: "observed", value: { critical: matchesAny(path, config.critical) } },
        declaredProvenance: matchesAny(path, config.provenance.declaredPaths),
      };
    })
    .sort((a, b) => compare(a.path, b.path));

  return {
    files,
    excluded: excluded.sort((a, b) => compare(a.path, b.path)),
    importEdges: graph.edges,
    graphComplete: !graph.budgetExceeded,
    warnings,
  };
}

function dependencyEvidence(p: Parsed, fan: number | null | undefined): FileEvidence["dependencies"] {
  if (p.imports === null) {
    return {
      status: "missing",
      reason: isJsLike(p.candidate.path) ? "parse_failed" : "language_not_supported",
    };
  }
  if (fan === null || fan === undefined) return { status: "missing", reason: "limit_exceeded" };
  return { status: "observed", value: { transitiveFanIn: fan } };
}

function inspect(candidate: Candidate, text: string): Parsed {
  const lineCount = countNonBlankLines(text);
  if (!isJsLike(candidate.path)) {
    return {
      candidate,
      lineCount,
      complexity: { status: "missing", reason: "language_not_supported" },
      imports: null,
    };
  }
  try {
    const { complexity, imports } = analyzeSource(candidate.path, text);
    return { candidate, lineCount, complexity: { status: "observed", value: complexity }, imports };
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return { candidate, lineCount, complexity: { status: "missing", reason: "parse_failed" }, imports: null };
  }
}
