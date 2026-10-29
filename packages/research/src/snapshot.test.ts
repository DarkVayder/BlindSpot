import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { tempDir, TestRepo } from "../../git/src/test/repo.js";
import { Dataset, serializeDataset } from "./dataset.js";
import { run } from "./run.js";
import { SnapshotFile } from "./snapshot.js";
import { cachedClone, DEMO_URL } from "./test/clone.js";

const repos: TestRepo[] = [];
afterAll(() => {
  for (const r of repos) r.cleanup();
});

// T1 is c0 (2024-01-01) and its window ends 2024-06-29, so E1 is the 2024-05-01 commit.
function outcomeRepo(): TestRepo {
  const r = TestRepo.create("bs-outcomes-");
  repos.push(r);
  r.write("a.ts", "export const a = 1;\n");
  r.write("b.ts", "export const b = 1;\n");
  r.write("c.ts", "export const c = 1;\n");
  r.write("d.ts", "export const d = 1;\n");
  r.commit("initial", "2024-01-01T00:00:00Z");

  r.git("switch", "-q", "-c", "old-branch");
  r.write("d.ts", "export const d = 2;\n").commit("Fix d on a branch made before T", "2023-12-15T00:00:00Z");
  r.git("switch", "-q", "main");

  r.write("a.ts", "export const a = 2;\n").commit("Fix bug in a", "2024-01-10T00:00:00Z");
  r.git("mv", "b.ts", "lib-b.ts");
  r.commit("Move b", "2024-02-01T00:00:00Z");
  r.merge("old-branch", "Merge old branch", "2024-02-15T00:00:00Z");
  r.write("lib-b.ts", "export const b = 2;\n").commit("fix: b edge case", "2024-03-01T00:00:00Z");
  r.git("rm", "-q", "c.ts");
  r.commit("fix: remove broken c", "2024-03-15T00:00:00Z");
  r.write("c.ts", "export const c = 'new';\n").commit("Add a new c", "2024-04-01T00:00:00Z");
  r.write("c.ts", "export const c = 'newer';\n").commit("Fix the new c", "2024-04-02T00:00:00Z");
  r.write("a.ts", "export const a = 3;\n").commit('Revert "Move things"', "2024-05-01T00:00:00Z");
  r.write("a.ts", "export const a = 4;\n").commit("Fix a after the window", "2024-08-01T00:00:00Z");
  return r;
}

describe("snapshot", () => {
  // Runs pin and two snapshots twice, dozens of git processes, so it needs more than the
  // default timeout when the whole suite runs in parallel.
  it("scores T, labels (T, T+180d] with renames followed forward, and is deterministic", async () => {
    const source = outcomeRepo();
    const cacheRoot = tempDir();
    cachedClone(source, cacheRoot);
    const workDir = tempDir();
    const datasetFile = path.join(workDir, "v1.json");
    const dataset = Dataset.parse({
      id: "test",
      windowDays: 180,
      snapshotDates: { T1: "2024-01-01T12:00:00Z", T2: "2024-07-01T00:00:00Z" },
      repositories: [{ id: "demo", url: DEMO_URL, language: "typescript", license: "MIT" }],
    });
    writeFileSync(datasetFile, serializeDataset(dataset));
    const io = { stdout: { write: () => true }, stderr: { write: () => true }, cwd: workDir };
    const args = ["--dataset", datasetFile, "--cache", cacheRoot];
    expect(await run(["pin", ...args], io)).toBe(0);

    const out = path.join(workDir, "out");
    expect(await run(["snapshot", ...args, "--out", out], io)).toBe(0);
    const file = path.join(out, "test", "snapshots", "demo.T1.json");
    const first = readFileSync(file, "utf8");
    const snapshot = SnapshotFile.parse(JSON.parse(first));

    const byPath = Object.fromEntries(snapshot.files.map((f) => [f.path, f]));
    expect(Object.keys(byPath).sort()).toEqual(["a.ts", "b.ts", "c.ts", "d.ts"]);
    expect(byPath["a.ts"]).toMatchObject({ bugfixCount: 1, revertCount: 1 });
    expect(byPath["b.ts"]).toMatchObject({ bugfixCount: 1, revertCount: 0 });
    expect(byPath["c.ts"]).toMatchObject({ bugfixCount: 1, revertCount: 0 });
    expect(byPath["d.ts"]).toMatchObject({ bugfixCount: 0, revertCount: 0 });
    expect(snapshot.window).toMatchObject({ commits: 7, bugfixCommits: 4, revertCommits: 1 });
    expect(snapshot.provenance.rules).toEqual({ bugfix: "bugfix@1", revert: "revert@1" });
    expect(first).not.toContain("Fix bug in a");

    expect(await run(["snapshot", ...args, "--out", out], io)).toBe(0);
    expect(readFileSync(file, "utf8")).toBe(first);
  }, 120_000);
});
