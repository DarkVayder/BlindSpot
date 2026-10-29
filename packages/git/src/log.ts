import { randomBytes } from "node:crypto";
import type { Repository } from "./repo.js";
import { GitError, streamGit } from "./runner.js";
import { NulSplitter } from "./tokens.js";

export type ChangeStatus = "A" | "C" | "D" | "M" | "R" | "T" | "U" | "X";

export interface FileChange {
  status: ChangeStatus;
  path: string;
  oldPath?: string;
  added: number | null;
  deleted: number | null;
}

export interface Trailer {
  key: string;
  value: string;
}

export interface CommitRecord {
  hash: string;
  committedAt: number;
  authorEmail: string;
  authorName: string;
  trailers: Trailer[];
  message?: string;
  changes: FileChange[];
}

export interface Sentinel {
  start: string;
  end: string;
  message?: string;
  format: string;
}

const GROUP_SEPARATOR = String.fromCharCode(0x1d);

// Commit messages are read only when asked for (the research pipeline labels outcomes from
// them) and never reach a report.
export function createSentinel(id = randomBytes(12).toString("hex"), withMessage = false): Sentinel {
  if (withMessage) {
    const base = createSentinel(id);
    return {
      ...base,
      message: `${GROUP_SEPARATOR}${id}${GROUP_SEPARATOR}`,
      format: base.format.replace(`%x1f${id}%x1e`, `%x1d${id}%x1d%B%x1f${id}%x1e`),
    };
  }
  return {
    start: `\u001e${id}\u001f`,
    end: `\u001f${id}\u001e`,
    format: `%x1e${id}%x1f%H%n%ct%n%aE%n%aN%n%(trailers:only=true,unfold=true)%x1f${id}%x1e`,
  };
}

const RAW_ENTRY = /^:\d{6} \d{6} [0-9a-f]+ [0-9a-f]+ ([ACDMRTUX])\d*$/;
const NUMSTAT_ENTRY = /^(-|\d+)\t(-|\d+)\t([\s\S]*)$/;
const HASH = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

interface RawEntry {
  status: ChangeStatus;
  paths: string[];
}

interface NumstatEntry {
  added: number | null;
  deleted: number | null;
  paths: string[];
}

type Pending =
  | { kind: "entry" }
  | { kind: "raw"; entry: RawEntry; remaining: number }
  | { kind: "numstat"; entry: NumstatEntry; remaining: number };

interface OpenCommit {
  header: Omit<CommitRecord, "changes">;
  raw: RawEntry[];
  numstat: NumstatEntry[];
}

export class LogParser {
  private pending: Pending = { kind: "entry" };
  private current: OpenCommit | undefined;

  constructor(
    private readonly sentinel: Sentinel,
    private readonly onCommit: (commit: CommitRecord) => void,
  ) {}

  token(token: string): void {
    if (this.pending.kind !== "entry") {
      this.pending.entry.paths.push(token);
      this.pending.remaining--;
      if (this.pending.remaining === 0) this.pending = { kind: "entry" };
      return;
    }

    const t = token.startsWith("\n") ? token.slice(1) : token;
    if (t === "") return;

    if (t.startsWith(this.sentinel.start)) {
      this.flush();
      this.current = { header: this.parseHeader(t), raw: [], numstat: [] };
      return;
    }

    const commit = this.current;
    if (!commit) throw parseError("file entry before any commit header");

    const raw = RAW_ENTRY.exec(t);
    if (raw) {
      const status = raw[1] as ChangeStatus;
      const entry: RawEntry = { status, paths: [] };
      commit.raw.push(entry);
      this.pending = { kind: "raw", entry, remaining: status === "R" || status === "C" ? 2 : 1 };
      return;
    }

    const num = NUMSTAT_ENTRY.exec(t);
    if (num) {
      const [, added, deleted, filePath] = num as unknown as [string, string, string, string];
      const entry: NumstatEntry = {
        added: added === "-" ? null : Number(added),
        deleted: deleted === "-" ? null : Number(deleted),
        paths: filePath === "" ? [] : [filePath],
      };
      commit.numstat.push(entry);
      if (filePath === "") this.pending = { kind: "numstat", entry, remaining: 2 };
      return;
    }

    throw parseError("unrecognized log entry");
  }

  end(): void {
    if (this.pending.kind !== "entry") throw parseError("log output ended in the middle of an entry");
    this.flush();
  }

  private parseHeader(token: string): Omit<CommitRecord, "changes"> {
    if (!token.endsWith(this.sentinel.end)) throw parseError("unterminated commit header");
    let body = token.slice(this.sentinel.start.length, token.length - this.sentinel.end.length);
    let message: string | undefined;
    if (this.sentinel.message) {
      const at = body.indexOf(this.sentinel.message);
      if (at < 0) throw parseError("commit header without a message");
      message = body.slice(at + this.sentinel.message.length).trimEnd();
      body = body.slice(0, at);
    }
    const lines = body.split("\n");
    const [hash = "", committed = "", authorEmail = "", authorName = "", ...rest] = lines;
    if (!HASH.test(hash)) throw parseError("invalid commit hash");
    const committedAt = Number(committed);
    if (!Number.isInteger(committedAt)) throw parseError("invalid commit time");
    const header = { hash, committedAt, authorEmail, authorName, trailers: parseTrailers(rest) };
    return message === undefined ? header : { ...header, message };
  }

  private flush(): void {
    const commit = this.current;
    if (!commit) return;
    this.current = undefined;

    const stats = new Map<string, NumstatEntry>();
    for (const n of commit.numstat) {
      const target = n.paths[n.paths.length - 1];
      if (target !== undefined) stats.set(target, n);
    }

    const changes: FileChange[] = commit.raw.map((r) => {
      const target = r.paths[r.paths.length - 1] ?? "";
      const stat = stats.get(target);
      const change: FileChange = {
        status: r.status,
        path: target,
        added: stat ? stat.added : 0,
        deleted: stat ? stat.deleted : 0,
      };
      if ((r.status === "R" || r.status === "C") && r.paths[0] !== undefined) change.oldPath = r.paths[0];
      return change;
    });

    this.onCommit({ ...commit.header, changes });
  }
}

function parseTrailers(lines: readonly string[]): Trailer[] {
  const trailers: Trailer[] = [];
  for (const line of lines) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key && value) trailers.push({ key, value });
  }
  return trailers;
}

function parseError(detail: string): GitError {
  return new GitError("failed", `Could not parse git log output (${detail}).`);
}

export interface ReadLogOptions {
  maxCommits: number;
  timeoutMs: number;
  exclude?: string;
  withMessage?: boolean;
  noMerges?: boolean;
  mailmapRevision?: string;
}

export interface ReadLogResult {
  commitsRead: number;
  truncated: boolean;
}

export async function readLog(
  repo: Repository,
  options: ReadLogOptions,
  onCommit: (commit: CommitRecord) => void,
): Promise<ReadLogResult> {
  if (!repo.head) return { commitsRead: 0, truncated: false };

  for (const hash of [options.exclude, options.mailmapRevision]) {
    if (hash !== undefined && !HASH.test(hash))
      throw new GitError("bad_revision", "Expected a full commit hash.");
  }
  const sentinel = createSentinel(undefined, options.withMessage === true);
  let commitsRead = 0;
  let truncated = false;
  const parser = new LogParser(sentinel, (commit) => {
    if (commitsRead >= options.maxCommits) {
      truncated = true;
      return;
    }
    commitsRead++;
    onCommit(commit);
  });
  const splitter = new NulSplitter((t) => {
    parser.token(t);
  });

  await streamGit(
    [
      "log",
      "-z",
      "--raw",
      "--numstat",
      "-M",
      "--topo-order",
      "--diff-merges=off",
      ...(options.noMerges ? ["--no-merges"] : []),
      "--no-ext-diff",
      "--no-textconv",
      "--use-mailmap",
      "--encoding=UTF-8",
      `--max-count=${options.maxCommits + 1}`,
      `--format=${sentinel.format}`,
      repo.head,
      ...(options.exclude === undefined ? [] : [`^${options.exclude}`]),
      "--",
    ],
    {
      cwd: repo.root,
      timeoutMs: options.timeoutMs,
      ...(options.mailmapRevision === undefined ? {} : { mailmapRevision: options.mailmapRevision }),
    },
    (chunk) => {
      splitter.push(chunk);
    },
  );
  splitter.end();
  parser.end();

  return { commitsRead, truncated };
}
