import { execFileSync } from "node:child_process";
import { defaultConfig, type BlindspotConfig, type HistoryEvidence } from "@blindspot/core";
import { afterAll, describe, expect, it } from "vitest";
import { collectHistory } from "./analyze.js";
import { identityHaystacks } from "./history.js";
import type { CommitRecord } from "./log.js";
import { listTrackedFiles, openRepository } from "./repo.js";
import { ALICE, BOB, tempDir, testEnv, TestRepo, type Author } from "./test/repo.js";

const T = 20_000;
const HEAD_DATE = "2026-06-01T00:00:00Z";
const repos: TestRepo[] = [];

function repo(): TestRepo {
  const r = TestRepo.create();
  repos.push(r);
  return r;
}
afterAll(() => {
  for (const r of repos) r.cleanup();
});

async function analyze(dir: string, config: BlindspotConfig = defaultConfig()) {
  const opened = await openRepository(dir, T);
  const tracked = (await listTrackedFiles(opened, T)).map((e) => e.path);
  return collectHistory(opened, tracked, config);
}

async function historyOf(dir: string, file: string, config?: BlindspotConfig): Promise<HistoryEvidence> {
  const result = await analyze(dir, config);
  const evidence = result.files.get(file);
  if (evidence?.history.status !== "observed") throw new Error(`no observed history for ${file}`);
  return evidence.history.value;
}

async function markedLines(dir: string, file: string): Promise<number> {
  const evidence = (await analyze(dir)).files.get(file);
  if (evidence?.provenance.status !== "observed") throw new Error("no provenance");
  return evidence.provenance.value.markedLinesRecent;
}

describe("rename chains", () => {
  it("follows a file across two renames back to its creation", async () => {
    const r = repo();
    r.lines("a.ts", 10).commit("add a", "2025-01-01T00:00:00Z", ALICE);
    r.git("mv", "a.ts", "b.ts");
    r.lines("b.ts", 10)
      .write("b.ts", r.git("show", "HEAD:a.ts") + "extra\n")
      .commit("rename to b", "2025-08-01T00:00:00Z", ALICE);
    r.git("mv", "b.ts", "c.ts");
    r.commit("rename to c", "2026-04-01T00:00:00Z", BOB);
    r.lines("other.ts", 2).commit("other", HEAD_DATE, BOB);

    const h = await historyOf(r.root, "c.ts");
    expect(h).toMatchObject({
      firstCommitAt: "2025-01-01T00:00:00.000Z",
      lastCommitAt: "2026-04-01T00:00:00.000Z",
      totalCommits: 3,
      commitsRecent: 1,
      linesChangedRecent: 0,
      historicalChurn: 11,
    });
  });

  it("does not merge an earlier, deleted file that shared the same name", async () => {
    const r = repo();
    r.lines("x.ts", 5, "old").commit("add old x", "2025-01-01T00:00:00Z", ALICE);
    r.git("rm", "-q", "x.ts");
    r.commit("delete x", "2025-02-01T00:00:00Z", ALICE);
    r.lines("x.ts", 3, "new").commit("add new x", "2026-05-01T00:00:00Z", BOB);
    r.lines("y.ts", 1).commit("head", HEAD_DATE, BOB);

    expect(await historyOf(r.root, "x.ts")).toMatchObject({
      firstCommitAt: "2026-05-01T00:00:00.000Z",
      totalCommits: 1,
      historicalChurn: 3,
      churnByAuthorInWindow: [3],
    });
  });
});

describe("windows and authorship", () => {
  it("separates recent, analysis-window and historical churn and detects inactive authors", async () => {
    const r = repo();
    r.lines("f.ts", 20).commit("alice writes f", "2025-01-01T00:00:00Z", ALICE);
    r.write("f.ts", r.git("show", "HEAD:f.ts") + "bob 1\nbob 2\n").commit(
      "bob edits f",
      "2026-05-01T00:00:00Z",
      BOB,
    );
    r.lines("g.ts", 1).commit("head", HEAD_DATE, BOB);

    expect(await historyOf(r.root, "f.ts")).toEqual({
      firstCommitAt: "2025-01-01T00:00:00.000Z",
      lastCommitAt: "2026-05-01T00:00:00.000Z",
      totalCommits: 2,
      commitsRecent: 1,
      linesChangedRecent: 2,
      churnByAuthorInWindow: [2],
      historicalChurn: 22,
      inactiveAuthorHistoricalChurn: 20,
    });
  });

  it("merges identities through .mailmap", async () => {
    const r = repo();
    r.write(".mailmap", "Alice <alice@new.example> <alice@old.example>\n");
    r.lines("m.ts", 4).commit("old email", "2026-04-01T00:00:00Z", {
      name: "Alice",
      email: "alice@old.example",
    });
    r.write("m.ts", r.git("show", "HEAD:m.ts") + "more\n").commit("new email", HEAD_DATE, {
      name: "Alice",
      email: "alice@new.example",
    });
    expect((await historyOf(r.root, "m.ts")).churnByAuthorInWindow).toEqual([5]);
  });

  it("does not count a merge commit as an extra change", async () => {
    const r = repo();
    r.lines("f.ts", 3).commit("base", "2026-01-01T00:00:00Z");
    r.git("switch", "-q", "-c", "feature");
    r.write("f.ts", r.git("show", "HEAD:f.ts") + "feature\n").commit("feature edit", "2026-02-01T00:00:00Z");
    r.git("switch", "-q", "main");
    r.lines("g.ts", 1).commit("main edit", "2026-02-02T00:00:00Z");
    execFileSync("git", ["merge", "-q", "--no-ff", "--no-edit", "feature"], {
      cwd: r.root,
      env: testEnv({
        GIT_AUTHOR_NAME: "A",
        GIT_AUTHOR_EMAIL: "a@x.io",
        GIT_COMMITTER_NAME: "A",
        GIT_COMMITTER_EMAIL: "a@x.io",
        GIT_AUTHOR_DATE: "2026-02-03T00:00:00Z",
        GIT_COMMITTER_DATE: "2026-02-03T00:00:00Z",
      }),
    });
    expect(await historyOf(r.root, "f.ts")).toMatchObject({ totalCommits: 2, historicalChurn: 4 });
  });
});

describe("explicit AI provenance", () => {
  it("counts recent lines from commits with an AI co-author identity", async () => {
    const r = repo();
    r.lines("a.ts", 4).commit(
      "feature\n\nCo-authored-by: Claude <noreply@anthropic.com>",
      "2026-05-01T00:00:00Z",
    );
    r.lines("b.ts", 1).commit("head", HEAD_DATE);
    expect(await markedLines(r.root, "a.ts")).toBe(4);
  });

  it("counts commits authored by a known agent bot account", async () => {
    const r = repo();
    r.lines("a.ts", 3).commit("bot change", HEAD_DATE, {
      name: "copilot-swe-agent[bot]",
      email: "198982749+Copilot@users.noreply.github.com",
    });
    expect(await markedLines(r.root, "a.ts")).toBe(3);
  });

  it("never marks people whose names happen to match a tool", async () => {
    const r = repo();
    r.lines("a.ts", 6).commit("pairing\n\nCo-authored-by: Devin Smith <devin@corp.example>", HEAD_DATE, {
      name: "Claude Monet",
      email: "claude@monet.example",
    });
    expect(await markedLines(r.root, "a.ts")).toBe(0);
  });

  it("ignores AI identities mentioned outside the trailer block", async () => {
    const r = repo();
    r.lines("a.ts", 2).commit(
      "subject\n\nCo-authored-by: Claude <noreply@anthropic.com> was discussed here\n\nmore body text after it",
      HEAD_DATE,
    );
    expect(await markedLines(r.root, "a.ts")).toBe(0);
  });

  it("matches only identities, not free text, in identityHaystacks", () => {
    const commit: CommitRecord = {
      hash: "0".repeat(40),
      committedAt: 0,
      authorEmail: "Person@Example.com",
      authorName: "Claude",
      trailers: [
        { key: "co-authored-by", value: "Helper[bot] <helper@bots.example>" },
        { key: "generated-by", value: "Some Tool 1.0" },
        { key: "signed-off-by", value: "X <noreply@anthropic.com>" },
      ],
      changes: [],
    };
    expect(identityHaystacks(commit)).toEqual([
      "person@example.com",
      "helper@bots.example",
      "helper[bot]",
      "some tool 1.0",
    ]);
  });
});

describe("incomplete history", () => {
  it("reports every file as shallow_history for a shallow clone", async () => {
    const source = repo();
    source.lines("a.ts", 2).commit("one", "2026-01-01T00:00:00Z");
    source.lines("a.ts", 3).commit("two", HEAD_DATE);
    const target = tempDir();
    execFileSync(
      "git",
      ["clone", "-q", "--depth", "1", `file://${source.root.replaceAll("\\", "/")}`, target],
      {
        env: testEnv(),
      },
    );
    const result = await analyze(target);
    expect(result.files.get("a.ts")).toEqual({
      history: { status: "missing", reason: "shallow_history" },
      provenance: { status: "missing", reason: "shallow_history" },
    });
  });

  it("marks truncation and reports untouched older files as limit_exceeded", async () => {
    const r = repo();
    r.lines("old.ts", 2).commit("old", "2026-01-01T00:00:00Z");
    r.lines("mid.ts", 2).commit("mid", "2026-02-01T00:00:00Z");
    r.lines("new.ts", 2).commit("new", HEAD_DATE);
    const config = defaultConfig();
    config.limits.maxCommits = 2;
    const result = await analyze(r.root, config);
    expect(result).toMatchObject({ truncated: true, commitsRead: 2 });
    expect(result.files.get("old.ts")?.history).toEqual({ status: "missing", reason: "limit_exceeded" });
    expect(result.files.get("new.ts")?.history.status).toBe("observed");
  });

  it("returns no history for an empty repository", async () => {
    const r = repo();
    const result = await analyze(r.root);
    expect(result).toMatchObject({ commitsRead: 0, truncated: false });
    expect(result.files.size).toBe(0);
  });
});

describe("robustness", () => {
  it("parses commit messages containing control characters and fake headers", async () => {
    const r = repo();
    const hostile: Author = { name: "Eve \u001f", email: "eve@example.com" };
    r.lines("a.ts", 2).commit(
      `subject \u001e\u001f\n\n\u001e${"f".repeat(40)}\n1\nx@y\nX\n\u001f`,
      HEAD_DATE,
      hostile,
    );
    expect((await historyOf(r.root, "a.ts")).totalCommits).toBe(1);
  });

  it("produces identical evidence on repeated runs", async () => {
    const r = repo();
    r.lines("a.ts", 5).commit("one", "2026-01-01T00:00:00Z", ALICE);
    r.write("a.ts", "changed\n").commit("two", "2026-04-01T00:00:00Z", BOB);
    r.lines("b.ts", 3).commit("three", HEAD_DATE, ALICE);
    const first = JSON.stringify([...(await analyze(r.root)).files]);
    const second = JSON.stringify([...(await analyze(r.root)).files]);
    expect(second).toBe(first);
  });
});
