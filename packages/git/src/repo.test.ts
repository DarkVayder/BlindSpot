import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { readLog } from "./log.js";
import { listTrackedFiles, openRepository } from "./repo.js";
import { tempDir, testEnv, TestRepo } from "./test/repo.js";

const T = 20_000;
const repos: TestRepo[] = [];
function repo(): TestRepo {
  const r = TestRepo.create();
  repos.push(r);
  return r;
}
afterAll(() => {
  for (const r of repos) r.cleanup();
});

describe("openRepository", () => {
  it("rejects a path that does not exist", async () => {
    await expect(openRepository(path.join(tempDir(), "missing"), T)).rejects.toMatchObject({
      code: "path_not_found",
    });
  });

  it("rejects a directory that is not a repository", async () => {
    await expect(openRepository(tempDir(), T)).rejects.toMatchObject({ code: "not_a_repository" });
  });

  it("opens an empty repository with no HEAD", async () => {
    const r = repo();
    await expect(openRepository(r.root, T)).resolves.toMatchObject({
      head: null,
      headCommittedAt: null,
      shallow: false,
    });
  });

  it("resolves the root from a subdirectory and reads HEAD and its commit time", async () => {
    const r = repo();
    r.write("src/a.ts", "export const a = 1;\n");
    const head = r.commit("first", "2026-03-01T12:00:00Z");
    const opened = await openRepository(r.path("src"), T);
    expect(opened.root).toBe(path.resolve(r.root));
    expect(opened.head).toBe(head);
    expect(opened.headCommittedAt).toBe(Date.parse("2026-03-01T12:00:00Z") / 1000);
  });

  it("rejects a bare repository", async () => {
    const dir = tempDir();
    execFileSync("git", ["init", "-q", "--bare", dir], { env: testEnv() });
    await expect(openRepository(dir, T)).rejects.toMatchObject({ code: "bare_repository" });
  });

  it("detects a shallow clone", async () => {
    const source = repo();
    source.write("a.txt", "1\n").commit("one", "2026-01-01T00:00:00Z");
    source.write("a.txt", "2\n").commit("two", "2026-01-02T00:00:00Z");
    const target = tempDir();
    execFileSync(
      "git",
      ["clone", "-q", "--depth", "1", `file://${source.root.replaceAll("\\", "/")}`, target],
      {
        env: testEnv(),
      },
    );
    await expect(openRepository(target, T)).resolves.toMatchObject({ shallow: true });
  });
});

describe("openRepository at a pinned revision", () => {
  it("uses the given commit and its commit time instead of HEAD", async () => {
    const r = repo();
    r.write("a.ts", "export const a = 1;");
    const first = r.commit("first", "2026-01-01T00:00:00Z");
    r.write("b.ts", "export const b = 2;").commit("second", "2026-02-01T00:00:00Z");
    const opened = await openRepository(r.root, T, { revision: first });
    expect(opened).toMatchObject({ head: first, headCommittedAt: Date.parse("2026-01-01T00:00:00Z") / 1000 });
    expect((await listTrackedFiles(opened, T)).map((e) => e.path)).toEqual(["a.ts"]);
  });

  it("accepts only a full commit hash that exists and names a commit", async () => {
    const r = repo();
    r.write("a.ts", "export const a = 1;").commit("first", "2026-01-01T00:00:00Z");
    const tree = r.git("rev-parse", "HEAD^{tree}").trim();
    for (const revision of [
      "HEAD",
      "HEAD~1",
      "--output=x",
      "A".repeat(40),
      "a".repeat(39),
      "a".repeat(40),
      tree,
    ]) {
      await expect(openRepository(r.root, T, { revision })).rejects.toMatchObject({ code: "bad_revision" });
    }
  });
});

describe("listTrackedFiles", () => {
  it("lists files at HEAD with sizes, including awkward names, and flags submodules", async () => {
    const r = repo();
    r.write("plain.ts", "x\n");
    r.write("dir with space/naïve 文件.ts", "hello\n");
    r.write("-dash.ts", "y\n");
    r.commit("files", "2026-01-01T00:00:00Z");
    r.git("update-index", "--add", "--cacheinfo", `160000,${"a".repeat(40)},vendor/sub`);
    r.commit("submodule", "2026-01-02T00:00:00Z", undefined, false);
    r.write("untracked.ts", "not committed\n");

    const entries = await listTrackedFiles(await openRepository(r.root, T), T);
    expect(entries.every((e) => /^[0-9a-f]{40}$/.test(e.oid))).toBe(true);
    expect(entries.map(({ path, kind, size }) => ({ path, kind, size }))).toEqual([
      { path: "-dash.ts", kind: "file", size: 2 },
      { path: "dir with space/naïve 文件.ts", kind: "file", size: 6 },
      { path: "plain.ts", kind: "file", size: 2 },
      { path: "vendor/sub", kind: "submodule", size: null },
    ]);
  });

  it("returns nothing for an empty repository", async () => {
    const r = repo();
    await expect(listTrackedFiles(await openRepository(r.root, T), T)).resolves.toEqual([]);
  });
});

describe("hardening against repository-controlled configuration", () => {
  it("does not run a core.fsmonitor command configured by the repository", async () => {
    const r = repo();
    r.write("a.txt", "1\n").commit("one", "2026-01-01T00:00:00Z");
    const marker = path.join(tempDir(), "pwned");
    const script = `echo pwned > "${marker.replaceAll("\\", "/")}"`;
    r.git("config", "core.fsmonitor", script);

    execFileSync("git", ["status", "--porcelain"], { cwd: r.root, env: testEnv(), stdio: "ignore" });
    expect(existsSync(marker), "positive control: plain git should run the fsmonitor hook").toBe(true);
    rmSync(marker);

    const opened = await openRepository(r.root, T);
    await listTrackedFiles(opened, T);
    await readLog(opened, { maxCommits: 10, timeoutMs: T }, () => undefined);
    expect(existsSync(marker)).toBe(false);
  });

  it("ignores GIT_DIR from the caller's environment", async () => {
    const r = repo();
    r.write("a.txt", "1\n").commit("one", "2026-01-01T00:00:00Z");
    const decoy = repo();
    decoy.write("decoy.txt", "1\n").commit("decoy", "2026-01-01T00:00:00Z");
    const previous = process.env.GIT_DIR;
    process.env.GIT_DIR = path.join(decoy.root, ".git");
    try {
      const entries = await listTrackedFiles(await openRepository(r.root, T), T);
      expect(entries.map((e) => e.path)).toEqual(["a.txt"]);
    } finally {
      if (previous === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = previous;
    }
  });
});
