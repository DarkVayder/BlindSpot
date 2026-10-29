import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { tempDir, testEnv, TestRepo } from "../../git/src/test/repo.js";
import { Dataset, loadDataset, serializeDataset, type DatasetRepository } from "./dataset.js";
import { fetchRepository, type FetchOptions } from "./fetch.js";
import { pinSnapshot } from "./pin.js";
import { run } from "./run.js";
import { cachedClone, DEMO_URL } from "./test/clone.js";

const T = 20_000;
const URL = DEMO_URL;
const repos: TestRepo[] = [];
afterAll(() => {
  for (const r of repos) r.cleanup();
});

function dataset(overrides: Partial<Dataset> = {}): Dataset {
  return Dataset.parse({
    id: "test",
    windowDays: 180,
    snapshotDates: { T1: "2024-01-01T00:00:00Z", T2: "2024-07-01T00:00:00Z" },
    repositories: [{ id: "demo", url: URL, language: "typescript", license: "MIT" }],
    ...overrides,
  });
}

function demo(): DatasetRepository {
  const repo = dataset().repositories[0];
  if (!repo) throw new Error("the test dataset has one repository");
  return repo;
}

function nth(list: readonly string[], index: number): string {
  const value = list[index];
  if (value === undefined) throw new Error(`no item at ${index}`);
  return value;
}

// T1 resolves to c2 and its window ends 2024-06-17 (E = c4). T2 resolves to c5 and its
// window ends 2024-12-22 (E = c7).
function sourceRepo(): { repo: TestRepo; commits: string[] } {
  const repo = TestRepo.create("bs-research-");
  repos.push(repo);
  const dates = [
    "2023-12-01T00:00:00Z",
    "2023-12-20T00:00:00Z",
    "2024-02-01T00:00:00Z",
    "2024-05-01T00:00:00Z",
    "2024-06-25T00:00:00Z",
    "2024-07-10T00:00:00Z",
    "2024-12-01T00:00:00Z",
    "2025-02-01T00:00:00Z",
  ];
  const commits = dates.map((date, i) =>
    repo.write(`src/f${i}.ts`, `export const v = ${i};`).commit(`c${i}`, date),
  );
  return { repo, commits };
}

function fetchOptions(cacheRoot: string, log: string[]): FetchOptions {
  return { cacheRoot, timeoutMs: T, attempts: 2, retryDelayMs: 0, update: false, log: (m) => log.push(m) };
}

describe("dataset", () => {
  it("accepts a valid dataset and defaults snapshots to unpinned", () => {
    expect(dataset().repositories[0]?.snapshots).toEqual({});
  });

  it.each([
    ["an id that could escape the cache directory", { id: "../escape" }],
    ["a non-GitHub host", { url: "https://evil.example/a/b.git" }],
    ["plain HTTP", { url: "http://github.com/a/b.git" }],
    ["an SSH URL", { url: "git@github.com:a/b.git" }],
    ["an extra option smuggled into the URL", { url: "https://github.com/a/--upload-pack=x.git" }],
  ])("rejects %s", (_name, override) => {
    const repo = { id: "demo", url: URL, language: "typescript", license: "MIT", ...override };
    expect(() => dataset({ repositories: [repo as DatasetRepository] })).toThrow();
  });

  it("rejects overlapping outcome windows and duplicate ids", () => {
    expect(() =>
      dataset({ snapshotDates: { T1: "2024-01-01T00:00:00Z", T2: "2024-03-01T00:00:00Z" } }),
    ).toThrow(/do not overlap/);
    const repo = { id: "demo", url: URL, language: "typescript", license: "MIT" } as DatasetRepository;
    expect(() => dataset({ repositories: [repo, repo] })).toThrow(/unique/);
  });

  it("loads with a content hash and round-trips through serialization", () => {
    const file = path.join(tempDir(), "v1.json");
    writeFileSync(file, serializeDataset(dataset()));
    const first = loadDataset(file);
    expect(first.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(serializeDataset(first.dataset)).toBe(readFileSync(file, "utf8"));
  });
});

describe("pinSnapshot", () => {
  it("pins T and the window end on the default branch by commit time", async () => {
    const { repo, commits } = sourceRepo();
    const dir = cachedClone(repo, tempDir());
    const t1 = await pinSnapshot(dir, dataset(), "T1", T);
    expect(t1).toEqual({
      commit: commits[1],
      committedAt: "2023-12-20T00:00:00.000Z",
      end: commits[3],
      endCommittedAt: "2024-05-01T00:00:00.000Z",
      commitsInWindow: 2,
      trackedFiles: 2,
    });
    const t2 = await pinSnapshot(dir, dataset(), "T2", T);
    expect(t2).toMatchObject({ commit: commits[4], end: commits[6], commitsInWindow: 2, trackedFiles: 5 });
  });
});

// Clone attempts against a refused port start several git processes each; under the full
// suite's parallel load they need more than the default timeout.
describe("fetchRepository", () => {
  it("reuses a clone that already has every pinned commit without touching the network", async () => {
    const { repo, commits } = sourceRepo();
    const cacheRoot = tempDir();
    const dir = cachedClone(repo, cacheRoot);
    const pinned: DatasetRepository = {
      ...demo(),
      snapshots: {
        T1: {
          commit: nth(commits, 1),
          committedAt: "2023-12-20T00:00:00.000Z",
          end: nth(commits, 3),
          endCommittedAt: "2024-05-01T00:00:00.000Z",
          commitsInWindow: 2,
          trackedFiles: 2,
        },
      },
    };
    const log: string[] = [];
    await expect(fetchRepository(pinned, fetchOptions(cacheRoot, log))).resolves.toBe(dir);
    expect(log).toEqual([]);
  });

  it("refuses a cache directory that is a clone of another repository", async () => {
    const { repo } = sourceRepo();
    const cacheRoot = tempDir();
    cachedClone(repo, cacheRoot, "demo", "https://github.com/someone/else.git");
    await expect(fetchRepository(demo(), fetchOptions(cacheRoot, []))).rejects.toThrow(
      /is a clone of https:\/\/github.com\/someone\/else.git/,
    );
  });

  it("refuses a cache directory that is not a clone", async () => {
    const cacheRoot = tempDir();
    mkdirSync(path.join(cacheRoot, "demo"));
    await expect(fetchRepository(demo(), fetchOptions(cacheRoot, []))).rejects.toMatchObject({
      code: "not_a_repository",
    });
  });

  it("discards an interrupted clone instead of trusting it", async () => {
    const { repo } = sourceRepo();
    const cacheRoot = tempDir();
    const unreachable = "https://127.0.0.1:9/none.git";
    const dir = cachedClone(repo, cacheRoot, "demo", unreachable);
    execFileSync("git", ["update-ref", "-d", "refs/remotes/origin/HEAD"], { cwd: dir, env: testEnv() });
    const log: string[] = [];
    await expect(
      fetchRepository({ ...demo(), url: unreachable }, fetchOptions(cacheRoot, log)),
    ).rejects.toMatchObject({
      code: "failed",
    });
    expect(log[0]).toBe("demo: removing an interrupted clone");
    expect(existsSync(dir)).toBe(false);
  }, 120_000);

  it("retries a failed clone and leaves no partial directory behind", async () => {
    const cacheRoot = tempDir();
    const unreachable = { ...demo(), url: "https://127.0.0.1:9/none.git" };
    const log: string[] = [];
    await expect(fetchRepository(unreachable, fetchOptions(cacheRoot, log))).rejects.toMatchObject({
      code: "failed",
    });
    expect(log.filter((m) => m.includes("attempt 1 failed"))).toHaveLength(1);
    expect(existsSync(path.join(cacheRoot, "demo"))).toBe(false);
  }, 120_000);
});

describe("run pin", () => {
  it("records pinned snapshots and will not re-pin without --force", async () => {
    const { repo, commits } = sourceRepo();
    const cacheRoot = tempDir();
    cachedClone(repo, cacheRoot);
    const file = path.join(tempDir(), "v1.json");
    writeFileSync(file, serializeDataset(dataset()));
    const err: string[] = [];
    const io = {
      stdout: { write: () => true },
      stderr: { write: (s: string) => err.push(s) },
      cwd: process.cwd(),
    };

    expect(await run(["pin", "--dataset", file, "--cache", cacheRoot], io)).toBe(0);
    const pinned = loadDataset(file).dataset.repositories[0]?.snapshots;
    expect(pinned?.T1?.commit).toBe(commits[1]);
    expect(pinned?.T2?.commit).toBe(commits[4]);

    const before = readFileSync(file, "utf8");
    expect(await run(["pin", "--dataset", file, "--cache", cacheRoot], io)).toBe(0);
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(err.join("")).toContain("demo: already pinned");
  });

  it("reports an invalid dataset as a usage error", async () => {
    const file = path.join(tempDir(), "bad.json");
    writeFileSync(file, "{}");
    const err: string[] = [];
    const io = {
      stdout: { write: () => true },
      stderr: { write: (s: string) => err.push(s) },
      cwd: process.cwd(),
    };
    expect(await run(["pin", "--dataset", file], io)).toBe(2);
    expect(err.join("")).toContain("is not a valid dataset");
  });
});
