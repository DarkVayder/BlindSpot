import type { BlindspotConfig, FileEvidence, HistoryEvidence, MissingReason } from "@blindspot/core";
import type { CommitRecord } from "./log.js";

const DAY_SECONDS = 86_400;
const PROVENANCE_TRAILERS = new Set(["co-authored-by", "generated-by"]);

interface Accumulator {
  first: number;
  last: number;
  total: number;
  commitsRecent: number;
  linesRecent: number;
  markedLinesRecent: number;
  windowByAuthor: Map<string, number>;
  historicalByAuthor: Map<string, number>;
}

export interface HistoryOptions {
  asOf: number;
  windows: BlindspotConfig["windows"];
  markers: readonly string[];
}

export type FileHistoryEvidence = Pick<FileEvidence, "history" | "provenance">;

// Commits must arrive children-first (git log --topo-order). Each tracked path at HEAD is
// an identity; a rename maps the older path onto that identity, and an add ends the chain
// so an earlier, unrelated file with the same name is not merged into it.
export class HistoryCollector {
  private readonly alias = new Map<string, string>();
  private readonly files = new Map<string, Accumulator>();
  private readonly authorLastActive = new Map<string, number>();
  private readonly recentStart: number;
  private readonly windowStart: number;

  constructor(
    trackedPaths: Iterable<string>,
    private readonly options: HistoryOptions,
  ) {
    for (const p of trackedPaths) this.alias.set(p, p);
    this.recentStart = options.asOf - options.windows.recentDays * DAY_SECONDS;
    this.windowStart = options.asOf - options.windows.analysisDays * DAY_SECONDS;
  }

  add(commit: CommitRecord): void {
    const author = authorKey(commit);
    const t = commit.committedAt;
    this.authorLastActive.set(author, Math.max(this.authorLastActive.get(author) ?? t, t));
    const marked = this.isMarked(commit);

    for (const change of commit.changes) {
      const id = this.alias.get(change.path);
      if (id === undefined) continue;
      const lines = (change.added ?? 0) + (change.deleted ?? 0);
      const acc = this.accumulator(id, t);
      acc.first = Math.min(acc.first, t);
      acc.last = Math.max(acc.last, t);
      acc.total++;
      if (t >= this.recentStart) {
        acc.commitsRecent++;
        acc.linesRecent += lines;
        if (marked) acc.markedLinesRecent += lines;
      }
      if (t >= this.windowStart) increment(acc.windowByAuthor, author, lines);
      increment(acc.historicalByAuthor, author, lines);
    }

    for (const change of commit.changes) {
      if (change.status === "A" || change.status === "C") {
        this.alias.delete(change.path);
      } else if (change.status === "R" && change.oldPath !== undefined) {
        const id = this.alias.get(change.path);
        this.alias.delete(change.path);
        if (id !== undefined) this.alias.set(change.oldPath, id);
      }
    }
  }

  evidence(trackedPaths: Iterable<string>, emptyReason: MissingReason): Map<string, FileHistoryEvidence> {
    const inactiveBefore = this.options.asOf - this.options.windows.inactiveAuthorDays * DAY_SECONDS;
    const result = new Map<string, FileHistoryEvidence>();
    for (const p of trackedPaths) {
      const acc = this.files.get(p);
      if (!acc) {
        result.set(p, missingHistory(emptyReason));
        continue;
      }
      let historical = 0;
      let inactive = 0;
      for (const [author, lines] of acc.historicalByAuthor) {
        historical += lines;
        if ((this.authorLastActive.get(author) ?? 0) < inactiveBefore) inactive += lines;
      }
      const history: HistoryEvidence = {
        firstCommitAt: iso(acc.first),
        lastCommitAt: iso(acc.last),
        totalCommits: acc.total,
        commitsRecent: acc.commitsRecent,
        linesChangedRecent: acc.linesRecent,
        churnByAuthorInWindow: [...acc.windowByAuthor.values()].sort((a, b) => b - a),
        historicalChurn: historical,
        inactiveAuthorHistoricalChurn: inactive,
      };
      result.set(p, {
        history: { status: "observed", value: history },
        provenance: { status: "observed", value: { markedLinesRecent: acc.markedLinesRecent } },
      });
    }
    return result;
  }

  private accumulator(id: string, t: number): Accumulator {
    let acc = this.files.get(id);
    if (!acc) {
      acc = {
        first: t,
        last: t,
        total: 0,
        commitsRecent: 0,
        linesRecent: 0,
        markedLinesRecent: 0,
        windowByAuthor: new Map(),
        historicalByAuthor: new Map(),
      };
      this.files.set(id, acc);
    }
    return acc;
  }

  private isMarked(commit: CommitRecord): boolean {
    const haystacks = identityHaystacks(commit);
    return this.options.markers.some((m) => haystacks.some((h) => h.includes(m)));
  }
}

const IDENTITY = /^(.*?)\s*<([^<>]*)>\s*$/;

// Markers match identities, never free-form names: a human called "Claude" or "Devin" must
// not be reported as AI-assisted. Names count only for "[bot]" accounts, and Generated-by
// values count as written because the trailer itself is an explicit declaration.
export function identityHaystacks(commit: CommitRecord): string[] {
  const haystacks: string[] = [];
  const addIdentity = (name: string, email: string) => {
    if (email) haystacks.push(email.toLowerCase());
    if (name.toLowerCase().endsWith("[bot]")) haystacks.push(name.toLowerCase());
  };
  addIdentity(commit.authorName, commit.authorEmail);
  for (const { key, value } of commit.trailers) {
    if (!PROVENANCE_TRAILERS.has(key)) continue;
    if (key === "generated-by") {
      haystacks.push(value.toLowerCase());
      continue;
    }
    const match = IDENTITY.exec(value);
    if (match) addIdentity(match[1] ?? "", match[2] ?? "");
  }
  return haystacks;
}

export function missingHistory(reason: MissingReason): FileHistoryEvidence {
  return {
    history: { status: "missing", reason },
    provenance: { status: "missing", reason },
  };
}

function authorKey(commit: CommitRecord): string {
  const email = commit.authorEmail.trim().toLowerCase();
  return email === "" ? `name:${commit.authorName.trim().toLowerCase()}` : email;
}

function increment(map: Map<string, number>, key: string, by: number): void {
  map.set(key, (map.get(key) ?? 0) + by);
}

function iso(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}
