import { statSync } from "node:fs";
import path from "node:path";
import { GitError, runGit, streamGit } from "./runner.js";
import { NulSplitter } from "./tokens.js";

export interface Repository {
  root: string;
  head: string | null;
  headCommittedAt: number | null;
  shallow: boolean;
}

const COMMIT_HASH = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

export interface OpenOptions {
  revision?: string;
}

export async function openRepository(
  directory: string,
  timeoutMs: number,
  open: OpenOptions = {},
): Promise<Repository> {
  if (open.revision !== undefined && !COMMIT_HASH.test(open.revision)) {
    throw new GitError("bad_revision", "A revision must be a full lowercase commit hash.");
  }

  const absolute = path.resolve(directory);
  if (!statSync(absolute, { throwIfNoEntry: false })?.isDirectory())
    throw new GitError("path_not_found", `Directory not found: ${absolute}`);

  const options = { cwd: absolute, timeoutMs };
  const [bare, shallow] = (
    await runGit(["rev-parse", "--is-bare-repository", "--is-shallow-repository"], options)
  )
    .trim()
    .split(/\r?\n/);
  if (bare === "true") {
    throw new GitError(
      "bare_repository",
      "Bare repositories are not supported. Run Blindspot in a working tree.",
    );
  }

  const root = path.resolve((await runGit(["rev-parse", "--show-toplevel"], options)).trim());
  const rootOptions = { cwd: root, timeoutMs };

  let head: string | null = null;
  try {
    head = (
      await runGit(
        ["rev-parse", "--verify", "--quiet", "--end-of-options", `${open.revision ?? "HEAD"}^{commit}`],
        rootOptions,
      )
    ).trim();
  } catch (error) {
    if (!(error instanceof GitError) || error.code !== "failed") throw error;
    if (open.revision === undefined && error.stderr !== "") throw error;
  }
  if (head === "") head = null;
  if (open.revision !== undefined && head !== open.revision) {
    throw new GitError("bad_revision", `Commit ${open.revision} was not found in this repository.`);
  }
  if (head !== null && !COMMIT_HASH.test(head)) {
    throw new GitError("failed", `Unexpected HEAD value from git: ${head.slice(0, 80)}`);
  }

  let headCommittedAt: number | null = null;
  if (head) {
    const seconds = Number((await runGit(["show", "-s", "--format=%ct", head, "--"], rootOptions)).trim());
    if (!Number.isInteger(seconds)) throw new GitError("failed", "Could not read the HEAD commit time.");
    headCommittedAt = seconds;
  }

  return { root, head, headCommittedAt, shallow: shallow === "true" };
}

export type TrackedKind = "file" | "symlink" | "submodule";

export interface TrackedEntry {
  path: string;
  kind: TrackedKind;
  oid: string;
  size: number | null;
}

const LS_TREE_ENTRY = /^(\d{6}) (blob|tree|commit) ([0-9a-f]{40,64}) +(-|\d+)\t([\s\S]+)$/;

export async function listTrackedFiles(repo: Repository, timeoutMs: number): Promise<TrackedEntry[]> {
  if (!repo.head) return [];
  const entries: TrackedEntry[] = [];
  const splitter = new NulSplitter((token) => {
    const match = LS_TREE_ENTRY.exec(token);
    if (!match) throw new GitError("failed", "Unexpected output from git ls-tree.");
    const [, mode, , oid, size, filePath] = match as unknown as [
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    const kind: TrackedKind = mode === "160000" ? "submodule" : mode === "120000" ? "symlink" : "file";
    entries.push({ path: filePath, kind, oid, size: size === "-" ? null : Number(size) });
  });
  await streamGit(
    ["ls-tree", "-r", "-z", "--long", "--full-tree", repo.head],
    { cwd: repo.root, timeoutMs },
    (c) => {
      splitter.push(c);
    },
  );
  splitter.end();
  return entries;
}
