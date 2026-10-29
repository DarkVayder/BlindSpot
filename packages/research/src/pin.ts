import { listTrackedFiles, openRepository, runGit } from "@blindspot/git";
import type { Dataset, DatasetRepository, PinnedSnapshot, SnapshotId } from "./dataset.js";

const DEFAULT_BRANCH = "refs/remotes/origin/HEAD";

// T is the last first-parent commit on the default branch at or before the snapshot date.
// E is the last one at or before T's commit time plus the window. Commit times, not author
// times, so that the window matches the engine's asOf.
export async function pinSnapshot(
  dir: string,
  dataset: Dataset,
  id: SnapshotId,
  timeoutMs: number,
): Promise<PinnedSnapshot> {
  const options = { cwd: dir, timeoutMs };
  const atOrBefore = async (seconds: number) => {
    const hash = (
      await runGit(
        ["rev-list", "-1", "--first-parent", `--min-age=${seconds}`, DEFAULT_BRANCH, "--"],
        options,
      )
    ).trim();
    return hash === "" ? null : hash;
  };
  const commitTime = async (hash: string) =>
    Number((await runGit(["show", "-s", "--format=%ct", hash, "--"], options)).trim());

  const dateSeconds = Math.floor(Date.parse(dataset.snapshotDates[id]) / 1000);
  const commit = await atOrBefore(dateSeconds);
  if (!commit) throw new Error(`No commit on the default branch at or before ${dataset.snapshotDates[id]}.`);
  const committedAt = await commitTime(commit);
  const windowEnd = committedAt + dataset.windowDays * 86_400;
  const end = (await atOrBefore(windowEnd)) ?? commit;
  const endCommittedAt = await commitTime(end);

  const commitsInWindow = Number(
    (
      await runGit(
        [
          "rev-list",
          "--count",
          "--no-merges",
          `--max-age=${committedAt + 1}`,
          `--min-age=${windowEnd}`,
          end,
          `^${commit}`,
          "--",
        ],
        options,
      )
    ).trim(),
  );
  const repo = await openRepository(dir, timeoutMs, { revision: commit });
  const trackedFiles = (await listTrackedFiles(repo, timeoutMs)).filter((e) => e.kind === "file").length;

  return {
    commit,
    committedAt: new Date(committedAt * 1000).toISOString(),
    end,
    endCommittedAt: new Date(endCommittedAt * 1000).toISOString(),
    commitsInWindow,
    trackedFiles,
  };
}

export async function pinRepository(
  dir: string,
  dataset: Dataset,
  repo: DatasetRepository,
  timeoutMs: number,
): Promise<DatasetRepository> {
  return {
    ...repo,
    snapshots: {
      T1: await pinSnapshot(dir, dataset, "T1", timeoutMs),
      T2: await pinSnapshot(dir, dataset, "T2", timeoutMs),
    },
  };
}
