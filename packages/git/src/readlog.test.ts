import { afterAll, describe, expect, it } from "vitest";
import { readLog, type CommitRecord, type ReadLogOptions } from "./log.js";
import { openRepository } from "./repo.js";
import { BOB, TestRepo } from "./test/repo.js";

const T = 20_000;
const repos: TestRepo[] = [];
afterAll(() => {
  for (const r of repos) r.cleanup();
});

async function read(root: string, options: Partial<ReadLogOptions> = {}): Promise<CommitRecord[]> {
  const commits: CommitRecord[] = [];
  await readLog(await openRepository(root, T), { maxCommits: 100, timeoutMs: T, ...options }, (c) =>
    commits.push(c),
  );
  return commits;
}

describe("readLog options", () => {
  it("reads full messages only when asked, including text that looks like log syntax", async () => {
    const r = TestRepo.create();
    repos.push(r);
    const message = ["Fix the parser", "", ":100644 100644 aaa bbb D\tfake.ts", "Body line"].join("\n");
    r.lines("a.ts", 2).commit(message, "2026-01-01T00:00:00Z");

    const [withMessage] = await read(r.root, { withMessage: true });
    expect(withMessage?.message).toBe(message);
    expect(withMessage?.changes.map((c) => c.path)).toEqual(["a.ts"]);
    const [plain] = await read(r.root);
    expect(plain?.message).toBeUndefined();
  });

  it("leaves out history reachable from an excluded commit", async () => {
    const r = TestRepo.create();
    repos.push(r);
    r.lines("a.ts", 1).commit("one", "2026-01-01T00:00:00Z");
    const base = r.lines("a.ts", 2).commit("two", "2026-01-02T00:00:00Z");
    r.lines("a.ts", 3).commit("three", "2026-01-03T00:00:00Z");
    const commits = await read(r.root, { exclude: base, withMessage: true });
    expect(commits.map((c) => c.message)).toEqual(["three"]);
  });

  it("merges identities with the .mailmap from a pinned commit, not the working tree", async () => {
    const r = TestRepo.create();
    repos.push(r);
    r.lines("a.ts", 1).commit("old", "2026-01-01T00:00:00Z", { name: "Bob", email: "bob@old.example" });
    const mailmap = r
      .write(".mailmap", `Bob <${BOB.email}> <bob@old.example>\n`)
      .commit("add mailmap", "2026-01-02T00:00:00Z", BOB);
    r.git("rm", "-q", ".mailmap");
    r.commit("remove mailmap", "2026-01-03T00:00:00Z", BOB);

    const emails = async (options: Partial<ReadLogOptions>) =>
      (await read(r.root, options)).map((c) => c.authorEmail).sort();
    expect(await emails({})).toContain("bob@old.example");
    expect(await emails({ mailmapRevision: mailmap })).toEqual([BOB.email, BOB.email, BOB.email]);
  });

  it("rejects an excluded or mailmap revision that is not a full commit hash", async () => {
    const r = TestRepo.create();
    repos.push(r);
    r.lines("a.ts", 1).commit("one", "2026-01-01T00:00:00Z");
    await expect(read(r.root, { exclude: "HEAD~1" })).rejects.toMatchObject({ code: "bad_revision" });
    await expect(read(r.root, { mailmapRevision: "--output=x" })).rejects.toMatchObject({
      code: "bad_revision",
    });
  });
});
