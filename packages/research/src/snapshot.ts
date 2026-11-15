import { defaultConfig, GROUP_IDS, MODEL_VERSION, type BlindspotConfig } from "@blindspot/core";
import { analyzeWithEvidence } from "@blindspot/engine";
import { checkGitVersion } from "@blindspot/git";
import { z } from "zod";
import type { Dataset, DatasetRepository, SnapshotId } from "./dataset.js";
import { labelOutcomes } from "./label.js";
import { BUGFIX_RULE, REVERT_RULE } from "./rules.js";

const DAY_SECONDS = 86_400;
const MAX_GIT_TIMEOUT_MS = 3_600_000;
const nullableCount = z.number().int().nonnegative().nullable();

export const SnapshotFileRow = z.strictObject({
  path: z.string(),
  language: z.string(),
  lineCount: z.number().int().nonnegative(),
  score: z.number().nullable(),
  band: z.string(),
  confidence: z.number(),
  ranked: z.boolean(),
  priorChurn: nullableCount,
  ageDays: z.number().nonnegative().nullable(),
  groups: z.record(z.enum(GROUP_IDS), z.number().nullable()),
  impact: z.number(),
  bugfixCount: z.number().int().nonnegative(),
  revertCount: z.number().int().nonnegative(),
});
export type SnapshotFileRow = z.infer<typeof SnapshotFileRow>;

export const SnapshotFile = z.strictObject({
  schemaVersion: z.literal(1),
  dataset: z.strictObject({ id: z.string(), sha256: z.string() }),
  repository: z.strictObject({ id: z.string(), language: z.string() }),
  snapshot: z.strictObject({
    id: z.string(),
    commit: z.string(),
    committedAt: z.string(),
    end: z.string(),
    endCommittedAt: z.string(),
    windowDays: z.number(),
  }),
  provenance: z.strictObject({
    toolVersion: z.string(),
    modelVersion: z.string(),
    gitVersion: z.string(),
    rules: z.strictObject({ bugfix: z.string(), revert: z.string() }),
  }),
  coverage: z.strictObject({
    trackedFiles: z.number(),
    analyzedFiles: z.number(),
    commitsRead: z.number(),
    incomplete: z.boolean(),
  }),
  warnings: z.array(z.string()),
  window: z.strictObject({
    commits: z.number().int().nonnegative(),
    bugfixCommits: z.number().int().nonnegative(),
    revertCommits: z.number().int().nonnegative(),
    bugfixVerdicts: z.record(z.string(), z.number().int().nonnegative()),
  }),
  files: z.array(SnapshotFileRow),
});
export type SnapshotFile = z.infer<typeof SnapshotFile>;

export interface SnapshotOptions {
  dataset: Dataset;
  datasetSha256: string;
  toolVersion: string;
  timeoutMs: number;
}

// The default configuration, as the protocol requires, except that git's time limit follows
// --timeout-minutes. It cannot change a score, only whether a slow machine finishes.
export function snapshotConfig(timeoutMs: number): BlindspotConfig {
  const config = defaultConfig();
  return {
    ...config,
    limits: { ...config.limits, gitTimeoutMs: Math.min(timeoutMs, MAX_GIT_TIMEOUT_MS) },
  };
}

export async function takeSnapshot(
  dir: string,
  repo: DatasetRepository,
  id: SnapshotId,
  options: SnapshotOptions,
): Promise<SnapshotFile> {
  const pinned = repo.snapshots[id];
  if (!pinned) throw new Error(`${repo.id} has no pinned ${id} snapshot. Run pin first.`);

  const gitVersion = await checkGitVersion(options.timeoutMs);
  const { result, evidence } = await analyzeWithEvidence(dir, {
    config: snapshotConfig(options.timeoutMs),
    toolVersion: options.toolVersion,
    revision: pinned.commit,
    mailmapRevision: pinned.end,
  });
  const asOf = Date.parse(pinned.committedAt) / 1000;
  const labels = await labelOutcomes(dir, {
    snapshot: pinned.commit,
    snapshotCommittedAt: asOf,
    end: pinned.end,
    windowDays: options.dataset.windowDays,
    trackedPaths: result.files.map((f) => f.path),
    timeoutMs: options.timeoutMs,
  });

  const evidenceByPath = new Map(evidence.map((e) => [e.path, e]));
  const files = result.files.map((file): SnapshotFileRow => {
    const e = evidenceByPath.get(file.path);
    const history = e?.history.status === "observed" ? e.history.value : undefined;
    const outcome = labels.outcomes.get(file.path) ?? { bugfixCount: 0, revertCount: 0 };
    return {
      path: file.path,
      language: file.language,
      lineCount: e?.lineCount ?? 0,
      score: file.score,
      band: file.band,
      confidence: file.confidence,
      ranked: file.band !== "insufficient_evidence",
      priorChurn: history ? history.churnByAuthorInWindow.reduce((a, b) => a + b, 0) : null,
      ageDays: history ? round((asOf - Date.parse(history.firstCommitAt) / 1000) / DAY_SECONDS, 3) : null,
      groups: Object.fromEntries(file.groups.map((g) => [g.id, g.value])) as SnapshotFileRow["groups"],
      impact: file.impact.value,
      bugfixCount: outcome.bugfixCount,
      revertCount: outcome.revertCount,
    };
  });

  const verdicts: Record<string, number> = {};
  for (const c of labels.commits) verdicts[c.bugfix] = (verdicts[c.bugfix] ?? 0) + 1;

  return SnapshotFile.parse({
    schemaVersion: 1,
    dataset: { id: options.dataset.id, sha256: options.datasetSha256 },
    repository: { id: repo.id, language: repo.language },
    snapshot: {
      id,
      commit: pinned.commit,
      committedAt: pinned.committedAt,
      end: pinned.end,
      endCommittedAt: pinned.endCommittedAt,
      windowDays: options.dataset.windowDays,
    },
    provenance: {
      toolVersion: options.toolVersion,
      modelVersion: MODEL_VERSION,
      gitVersion,
      rules: { bugfix: BUGFIX_RULE, revert: REVERT_RULE },
    },
    coverage: {
      trackedFiles: result.coverage.trackedFiles,
      analyzedFiles: result.coverage.analyzedFiles,
      commitsRead: result.coverage.commitsRead,
      incomplete: result.coverage.incomplete,
    },
    warnings: result.warnings,
    window: {
      commits: labels.commits.length,
      bugfixCommits: labels.commits.filter((c) => c.bugfix === "bugfix").length,
      revertCommits: labels.commits.filter((c) => c.revert).length,
      bugfixVerdicts: Object.fromEntries(Object.entries(verdicts).sort(([a], [b]) => (a < b ? -1 : 1))),
    },
    files,
  });
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function serializeSnapshot(snapshot: SnapshotFile): string {
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}
