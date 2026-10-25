import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkGitVersion,
  gitEnv,
  isSupportedVersion,
  parseGitVersion,
  resolveGitExecutable,
  runGit,
} from "./runner.js";
import { tempDir } from "./test/repo.js";

const exe = process.platform === "win32" ? "git.exe" : "git";

function fakeGit(dir: string): string {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, exe);
  writeFileSync(file, "");
  chmodSync(file, 0o755);
  return file;
}

describe("parseGitVersion", () => {
  it("reads common version strings", () => {
    expect(parseGitVersion("git version 2.51.0.windows.2")).toEqual([2, 51, 0]);
    expect(parseGitVersion("git version 2.39.5 (Apple Git-154)")).toEqual([2, 39, 5]);
    expect(parseGitVersion("git version 3.0")).toEqual([3, 0, 0]);
    expect(parseGitVersion("nonsense")).toBeUndefined();
  });

  it("enforces the minimum version", () => {
    expect(isSupportedVersion([2, 31, 0])).toBe(true);
    expect(isSupportedVersion([2, 30, 9])).toBe(false);
    expect(isSupportedVersion([3, 0, 0])).toBe(true);
    expect(isSupportedVersion([1, 99, 99])).toBe(false);
  });
});

describe("gitEnv", () => {
  it("drops inherited GIT_* variables and applies hardening", () => {
    const env = gitEnv({ PATH: "/bin", GIT_DIR: "/evil", git_work_tree: "/evil", HOME: "/home/u" });
    expect(env.GIT_DIR).toBeUndefined();
    expect(env.git_work_tree).toBeUndefined();
    expect(env).toMatchObject({
      PATH: "/bin",
      HOME: "/home/u",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
      GIT_OPTIONAL_LOCKS: "0",
      GIT_NO_REPLACE_OBJECTS: "1",
    });
  });
});

describe("resolveGitExecutable", () => {
  it("skips relative PATH entries so a git binary in the analyzed repository is never used", () => {
    const base = tempDir();
    const absoluteDir = path.join(base, "bin");
    const expected = fakeGit(absoluteDir);
    const env = { PATH: [".", "relative/bin", absoluteDir].join(path.delimiter) };
    expect(resolveGitExecutable(env)).toBe(expected);
  });

  it("fails clearly when only relative entries contain git", () => {
    expect(() => resolveGitExecutable({ PATH: ["."].join(path.delimiter) })).toThrow(/git was not found/);
  });

  it("requires BLINDSPOT_GIT to be an absolute path to an existing file", () => {
    expect(() => resolveGitExecutable({ BLINDSPOT_GIT: "git" })).toThrow(/absolute path/);
    const file = fakeGit(path.join(tempDir(), "custom"));
    expect(resolveGitExecutable({ BLINDSPOT_GIT: file })).toBe(file);
  });
});

describe("runGit", () => {
  it("runs the installed git, which meets the minimum version", async () => {
    await expect(checkGitVersion(10_000)).resolves.toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("enforces the output limit", async () => {
    await expect(
      runGit(["--version"], { cwd: tempDir(), timeoutMs: 10_000, maxOutputBytes: 4 }),
    ).rejects.toMatchObject({
      code: "output_limit",
    });
  });

  it("reports a non-repository directory with an actionable code", async () => {
    await expect(runGit(["rev-parse", "HEAD"], { cwd: tempDir(), timeoutMs: 10_000 })).rejects.toMatchObject({
      code: "not_a_repository",
    });
  });
});
