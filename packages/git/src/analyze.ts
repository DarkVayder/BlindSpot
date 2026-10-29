import type { BlindspotConfig } from "@blindspot/core";
import { HistoryCollector, missingHistory, type FileHistoryEvidence } from "./history.js";
import { readLog } from "./log.js";
import type { Repository } from "./repo.js";

export interface HistoryResult {
  files: Map<string, FileHistoryEvidence>;
  commitsRead: number;
  truncated: boolean;
}

export async function collectHistory(
  repo: Repository,
  trackedPaths: readonly string[],
  config: BlindspotConfig,
  mailmapRevision?: string,
): Promise<HistoryResult> {
  if (repo.shallow || !repo.head || repo.headCommittedAt === null) {
    const reason = repo.shallow ? "shallow_history" : "git_unavailable";
    return {
      files: new Map(trackedPaths.map((p) => [p, missingHistory(reason)])),
      commitsRead: 0,
      truncated: false,
    };
  }

  const collector = new HistoryCollector(trackedPaths, {
    asOf: repo.headCommittedAt,
    windows: config.windows,
    markers: config.provenance.markers,
  });
  const { commitsRead, truncated } = await readLog(
    repo,
    {
      maxCommits: config.limits.maxCommits,
      timeoutMs: config.limits.gitTimeoutMs,
      ...(mailmapRevision === undefined ? {} : { mailmapRevision }),
    },
    (commit) => {
      collector.add(commit);
    },
  );

  return {
    files: collector.evidence(trackedPaths, truncated ? "limit_exceeded" : "no_line_changes"),
    commitsRead,
    truncated,
  };
}
