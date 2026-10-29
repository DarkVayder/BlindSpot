import { analyzeFiles, type AnalyzedFile } from "@blindspot/analyzers";
import {
  ANALYSIS_SCHEMA_VERSION,
  AnalysisResult,
  MODEL_VERSION,
  scoreRepository,
  type BlindspotConfig,
  type FileEvidence,
} from "@blindspot/core";
import {
  checkGitVersion,
  collectHistory,
  listTrackedFiles,
  openRepository,
  type FileHistoryEvidence,
} from "@blindspot/git";
import { hashConfig } from "./config.js";

const VERSION_CHECK_TIMEOUT_MS = 30_000;

export interface AnalyzeOptions {
  config: BlindspotConfig;
  toolVersion: string;
  revision?: string;
  mailmapRevision?: string;
  graphBudget?: number;
  extraWarnings?: readonly string[];
}

export async function resolveRepositoryRoot(directory: string): Promise<string> {
  await checkGitVersion(VERSION_CHECK_TIMEOUT_MS);
  return (await openRepository(directory, VERSION_CHECK_TIMEOUT_MS)).root;
}

export const RUN_NOTES = [
  "Scores estimate comprehension risk relative to other files in this repository. They are not comparable across repositories and are not a measure of any developer.",
  "Review evidence is not available in local mode, so it is reported as missing rather than counted against any file.",
] as const;

export const NO_PROVENANCE_NOTE =
  "No explicit AI provenance markers were found. This does not mean the code was written without AI assistance.";

export async function analyzeRepository(directory: string, options: AnalyzeOptions): Promise<AnalysisResult> {
  return (await analyzeWithEvidence(directory, options)).result;
}

export interface AnalysisWithEvidence {
  result: AnalysisResult;
  evidence: FileEvidence[];
}

// The research pipeline needs the evidence behind each score (line counts, prior churn,
// file age) to compute its baselines. The evidence holds counts only, never contents or
// author identities.
export async function analyzeWithEvidence(
  directory: string,
  options: AnalyzeOptions,
): Promise<AnalysisWithEvidence> {
  const { config, toolVersion } = options;
  const timeoutMs = config.limits.gitTimeoutMs;
  await checkGitVersion(VERSION_CHECK_TIMEOUT_MS);
  const repo = await openRepository(
    directory,
    timeoutMs,
    options.revision === undefined ? {} : { revision: options.revision },
  );

  const warnings: string[] = [...(options.extraWarnings ?? [])];
  if (repo.shallow) {
    warnings.push(
      "This is a shallow clone, so history-based signals were not computed. Fetch the full history (for example `git fetch --unshallow`, or `fetch-depth: 0` with actions/checkout) and run again.",
    );
  }
  if (!repo.head || repo.headCommittedAt === null) {
    warnings.push("The repository has no commits yet, so there is nothing to analyze.");
    const result = finish({
      toolVersion,
      config,
      asOf: null,
      headCommit: null,
      shallow: repo.shallow,
      trackedFiles: 0,
      excludedByReason: {},
      commitsRead: 0,
      historyTruncated: false,
      graphComplete: true,
      warnings,
      notes: [...RUN_NOTES],
      files: [],
    });
    return { result, evidence: [] };
  }

  const entries = await listTrackedFiles(repo, timeoutMs);
  const analysis = await analyzeFiles(repo, entries, config, options.graphBudget);
  warnings.push(...analysis.warnings);

  const paths = analysis.files.map((f) => f.path);
  const history = await collectHistory(repo, paths, config, options.mailmapRevision);
  if (history.truncated) {
    warnings.push(
      `Only the ${history.commitsRead} most recent commits were read (limits.maxCommits). Older history, and files touched only by it, are reported as incomplete.`,
    );
  }

  const evidence = analysis.files.map((file) => mergeEvidence(file, history.files.get(file.path)));
  const parseFailures = evidence.filter(
    (e) => e.complexity.status === "missing" && e.complexity.reason === "parse_failed",
  );
  if (parseFailures.length > 0) {
    warnings.push(
      `${parseFailures.length} file(s) could not be parsed, so their complexity and dependencies are missing.`,
    );
  }

  const asOf = new Date(repo.headCommittedAt * 1000).toISOString();
  const files = scoreRepository(evidence, config, asOf);
  const anyProvenance = evidence.some(
    (e) => e.provenance.status === "observed" && e.provenance.value.markedLinesRecent > 0,
  );

  const excludedByReason: Record<string, number> = {};
  for (const e of analysis.excluded) excludedByReason[e.reason] = (excludedByReason[e.reason] ?? 0) + 1;

  const result = finish({
    toolVersion,
    config,
    asOf,
    headCommit: repo.head,
    shallow: repo.shallow,
    trackedFiles: entries.length,
    excludedByReason,
    commitsRead: history.commitsRead,
    historyTruncated: history.truncated,
    graphComplete: analysis.graphComplete,
    warnings,
    notes: anyProvenance ? [...RUN_NOTES] : [...RUN_NOTES, NO_PROVENANCE_NOTE],
    files,
  });
  return { result, evidence };
}

function mergeEvidence(file: AnalyzedFile, history: FileHistoryEvidence | undefined): FileEvidence {
  const h: FileHistoryEvidence = history ?? {
    history: { status: "missing", reason: "git_unavailable" },
    provenance: { status: "missing", reason: "git_unavailable" },
  };
  let provenance = h.provenance;
  if (file.declaredProvenance && h.history.status === "observed" && provenance.status === "observed") {
    provenance = { status: "observed", value: { markedLinesRecent: h.history.value.linesChangedRecent } };
  }
  return {
    path: file.path,
    language: file.language,
    lineCount: file.lineCount,
    history: h.history,
    complexity: file.complexity,
    review: { status: "missing", reason: "not_available_locally" },
    provenance,
    dependencies: file.dependencies,
    criticality: file.criticality,
  };
}

interface FinishInput {
  toolVersion: string;
  config: BlindspotConfig;
  asOf: string | null;
  headCommit: string | null;
  shallow: boolean;
  trackedFiles: number;
  excludedByReason: Record<string, number>;
  commitsRead: number;
  historyTruncated: boolean;
  graphComplete: boolean;
  warnings: string[];
  notes: string[];
  files: AnalysisResult["files"];
}

function finish(input: FinishInput): AnalysisResult {
  const excludedFiles = Object.values(input.excludedByReason).reduce((a, b) => a + b, 0);
  const excludedByReason = Object.fromEntries(
    Object.entries(input.excludedByReason).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  const result: AnalysisResult = {
    schemaVersion: ANALYSIS_SCHEMA_VERSION,
    toolVersion: input.toolVersion,
    modelVersion: MODEL_VERSION,
    asOf: input.asOf,
    repository: { headCommit: input.headCommit, shallow: input.shallow },
    configHash: hashConfig(input.config),
    coverage: {
      trackedFiles: input.trackedFiles,
      analyzedFiles: input.files.length,
      excludedFiles,
      excludedByReason,
      commitsRead: input.commitsRead,
      historyTruncated: input.historyTruncated,
      incomplete: input.shallow || input.historyTruncated || !input.graphComplete,
    },
    notes: input.notes,
    warnings: input.warnings,
    files: input.files,
  };
  return AnalysisResult.parse(result);
}
