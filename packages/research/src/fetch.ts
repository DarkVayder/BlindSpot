import { existsSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import path from "node:path";
import { GitError, runGit } from "@blindspot/git";
import type { DatasetRepository } from "./dataset.js";

export interface FetchOptions {
  cacheRoot: string;
  timeoutMs: number;
  attempts: number;
  retryDelayMs: number;
  update: boolean;
  log: (message: string) => void;
}

export function repositoryDir(cacheRoot: string, repo: DatasetRepository): string {
  return path.join(cacheRoot, repo.id);
}

// Clone with no checkout, so nothing from the repository is written to the working tree
// and no filter, LFS smudge or submodule runs. Only HTTPS is allowed, and only here.
export async function fetchRepository(repo: DatasetRepository, options: FetchOptions): Promise<string> {
  mkdirSync(options.cacheRoot, { recursive: true });
  const dir = repositoryDir(options.cacheRoot, repo);
  const network = { timeoutMs: options.timeoutMs, allowHttps: true };

  if (existsSync(dir)) {
    const top = await runGit(["rev-parse", "--show-toplevel"], {
      cwd: dir,
      timeoutMs: options.timeoutMs,
    }).catch(() => "");
    if (!samePath(top.trim(), dir)) {
      throw new GitError("not_a_repository", `${dir} exists but is not a clone. Remove it and fetch again.`);
    }
    const origin = (
      await runGit(["config", "--get", "remote.origin.url"], { cwd: dir, timeoutMs: options.timeoutMs })
    ).trim();
    if (origin !== repo.url) {
      throw new GitError(
        "failed",
        `${dir} is a clone of ${origin}, not ${repo.url}. Remove it or choose another cache directory.`,
      );
    }
    // A clone records origin/HEAD only once it has finished, so its absence means an
    // interrupted clone whose history may be incomplete.
    if (!(await hasRef(dir, "refs/remotes/origin/HEAD", options.timeoutMs))) {
      options.log(`${repo.id}: removing an interrupted clone`);
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    } else if (options.update) {
      options.log(`${repo.id}: updating existing clone`);
      await withRetry(options, () =>
        runGit(["fetch", "--quiet", "--no-tags", "origin"], { cwd: dir, ...network }),
      );
    }
  }
  if (!existsSync(dir)) {
    options.log(`${repo.id}: cloning ${repo.url}`);
    await withRetry(
      options,
      () =>
        runGit(["clone", "--quiet", "--no-checkout", "--no-tags", "--end-of-options", repo.url, dir], {
          cwd: options.cacheRoot,
          ...network,
        }),
      () => {
        rmSync(dir, { recursive: true, force: true });
      },
    );
  }

  for (const hash of pinnedCommits(repo)) {
    if (await hasCommit(dir, hash, options.timeoutMs)) continue;
    options.log(`${repo.id}: fetching pinned commit ${hash.slice(0, 12)}`);
    await withRetry(options, () =>
      runGit(["fetch", "--quiet", "--no-tags", "origin", "--end-of-options", hash], { cwd: dir, ...network }),
    );
    if (!(await hasCommit(dir, hash, options.timeoutMs))) {
      throw new GitError(
        "bad_revision",
        `${repo.id}: pinned commit ${hash} is not available from ${repo.url}.`,
      );
    }
  }
  return dir;
}

export function pinnedCommits(repo: DatasetRepository): string[] {
  return [...new Set(Object.values(repo.snapshots).flatMap((s) => [s.commit, s.end]))].sort();
}

async function hasRef(dir: string, ref: string, timeoutMs: number): Promise<boolean> {
  try {
    await runGit(["rev-parse", "--verify", "--quiet", "--end-of-options", ref], { cwd: dir, timeoutMs });
    return true;
  } catch (error) {
    if (error instanceof GitError && error.code === "failed") return false;
    throw error;
  }
}

async function hasCommit(dir: string, hash: string, timeoutMs: number): Promise<boolean> {
  try {
    await runGit(["cat-file", "-e", "--end-of-options", `${hash}^{commit}`], { cwd: dir, timeoutMs });
    return true;
  } catch (error) {
    if (error instanceof GitError && error.code === "failed") return false;
    throw error;
  }
}

async function withRetry<T>(
  options: FetchOptions,
  action: () => Promise<T>,
  cleanup?: () => void,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await action();
    } catch (error) {
      cleanup?.();
      const retryable = error instanceof GitError && (error.code === "failed" || error.code === "timeout");
      if (!retryable || attempt >= options.attempts) throw error;
      options.log(`  attempt ${attempt} failed (${error.message}); retrying`);
      await new Promise((resolve) => setTimeout(resolve, options.retryDelayMs * attempt));
    }
  }
}

// git reports long paths, but a path can arrive in another form, such as a Windows 8.3
// short name (C:\Users\RUNNER~1). Compare canonical paths, not strings.
function samePath(a: string, b: string): boolean {
  if (a === "" || !existsSync(a) || !existsSync(b)) return false;
  return realpathSync.native(path.resolve(a)) === realpathSync.native(path.resolve(b));
}
