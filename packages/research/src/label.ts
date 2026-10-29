import { openRepository, readLog, type CommitRecord } from "@blindspot/git";
import { classifyBugfix, isRevert, type BugfixVerdict } from "./rules.js";

export interface FileOutcome {
  bugfixCount: number;
  revertCount: number;
}

export interface LabelledCommit {
  hash: string;
  committedAt: number;
  message: string;
  changedFiles: number;
  bugfix: BugfixVerdict;
  revert: boolean;
  touchesAnalyzedFile: boolean;
}

export interface LabelResult {
  outcomes: Map<string, FileOutcome>;
  commits: LabelledCommit[];
}

export interface LabelOptions {
  snapshot: string;
  snapshotCommittedAt: number;
  end: string;
  windowDays: number;
  trackedPaths: readonly string[];
  timeoutMs: number;
}

const MAX_WINDOW_COMMITS = 1_000_000;

// Commits reachable from the window end but not from the snapshot, with a commit time in
// (T, T + window]. They are replayed oldest first so a file renamed after T keeps its
// outcomes, and a path deleted after T stops collecting them. Merge commits are skipped;
// the commits on their branches are counted individually.
export async function labelOutcomes(dir: string, options: LabelOptions): Promise<LabelResult> {
  const repo = await openRepository(dir, options.timeoutMs, { revision: options.end });
  const windowEnd = options.snapshotCommittedAt + options.windowDays * 86_400;
  const raw: CommitRecord[] = [];
  const { truncated } = await readLog(
    repo,
    {
      maxCommits: MAX_WINDOW_COMMITS,
      timeoutMs: options.timeoutMs,
      exclude: options.snapshot,
      withMessage: true,
      noMerges: true,
    },
    (commit) => {
      if (commit.committedAt > options.snapshotCommittedAt && commit.committedAt <= windowEnd)
        raw.push(commit);
    },
  );
  if (truncated) throw new Error(`More than ${MAX_WINDOW_COMMITS} commits in one outcome window.`);

  const outcomes = new Map<string, FileOutcome>(
    options.trackedPaths.map((p) => [p, { bugfixCount: 0, revertCount: 0 }]),
  );
  const current = new Map<string, string>(options.trackedPaths.map((p) => [p, p]));
  const commits: LabelledCommit[] = [];

  for (const commit of raw.reverse()) {
    const message = commit.message ?? "";
    const changedFiles = commit.changes.length;
    const labelled: LabelledCommit = {
      hash: commit.hash,
      committedAt: commit.committedAt,
      message,
      changedFiles,
      bugfix: classifyBugfix({ message, changedFiles }),
      revert: isRevert(message),
      touchesAnalyzedFile: false,
    };
    commits.push(labelled);

    for (const change of commit.changes) {
      const source = change.oldPath ?? change.path;
      const original = change.status === "C" ? undefined : current.get(source);
      if (original === undefined) continue;
      labelled.touchesAnalyzedFile = true;
      const outcome = outcomes.get(original);
      if (outcome) {
        if (labelled.bugfix === "bugfix") outcome.bugfixCount++;
        if (labelled.revert) outcome.revertCount++;
      }
      if (change.status === "R") {
        current.delete(source);
        current.set(change.path, original);
      } else if (change.status === "D") {
        current.delete(source);
      }
    }
  }
  return { outcomes, commits };
}
