import dns from "node:dns";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { AnalysisResult } from "@blindspot/core";
import { describe, expect, it, vi } from "vitest";
import { tempDir, testEnv, TestRepo } from "../../git/src/test/repo.js";
import { analyzeRepository, NO_PROVENANCE_NOTE } from "./analyze.js";
import { loadConfig } from "./config.js";
import { buildGoldenRepo } from "./test/fixture.js";

const GOLDEN = fileURLToPath(new URL("./__golden__/basic.json", import.meta.url));
const TOOL_VERSION = "0.0.0-test";

async function analyze(root: string) {
  const { config } = loadConfig(root);
  return analyzeRepository(root, { config, toolVersion: TOOL_VERSION });
}

describe("analyzeRepository", () => {
  it("matches the golden output for a scripted repository", async () => {
    const repo = buildGoldenRepo();
    const actual = JSON.stringify(await analyze(repo.root), null, 2) + "\n";
    if (process.env.BLINDSPOT_UPDATE_GOLDEN === "1") writeFileSync(GOLDEN, actual);
    expect(actual).toBe(readFileSync(GOLDEN, "utf8"));
  });

  it("produces byte-identical results on repeated runs", async () => {
    const repo = buildGoldenRepo();
    const first = JSON.stringify(await analyze(repo.root));
    const second = JSON.stringify(await analyze(repo.root));
    expect(second).toBe(first);
  });

  it("composes history, analyzers and scoring into a schema-valid result", async () => {
    const repo = buildGoldenRepo();
    const result = await analyze(repo.root);
    expect(() => AnalysisResult.parse(result)).not.toThrow();
    expect(result.coverage).toMatchObject({
      trackedFiles: 8,
      analyzedFiles: 5,
      excludedFiles: 3,
      excludedByReason: { default_excluded: 1, extension: 1, generated: 1 },
      historyTruncated: false,
      incomplete: false,
    });
    expect(result.asOf).toBe("2026-06-01T09:00:00.000Z");
    expect(result.notes).not.toContain(NO_PROVENANCE_NOTE);

    const parser = result.files.find((f) => f.path === "src/core/parser.ts");
    expect(parser?.explanations).toContain("Matches a path configured as critical.");
    const formatter = result.files.find((f) => f.path === "src/util/format.ts");
    expect(formatter?.signals.find((s) => s.id === "ai_attributed_unreviewed_share")?.status).toBe(
      "observed",
    );
    const python = result.files.find((f) => f.path === "scripts/release.py");
    expect(python?.limitations.join(" ")).toContain("this language is not supported yet");
  });

  it("never includes absolute paths or file contents in the output", async () => {
    const repo = buildGoldenRepo();
    const text = JSON.stringify(await analyze(repo.root));
    expect(text).not.toContain(repo.root);
    expect(text).not.toContain(repo.root.replaceAll("\\", "/"));
    expect(text).not.toContain("unsupported operator");
    expect(text).not.toContain("alice@example.com");
  });

  it("makes no network connections", async () => {
    const connect = vi.spyOn(net.Socket.prototype, "connect");
    const lookup = vi.spyOn(dns, "lookup");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      await analyze(buildGoldenRepo().root);
      expect(connect).not.toHaveBeenCalled();
      expect(lookup).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      connect.mockRestore();
      lookup.mockRestore();
      fetchSpy.mockRestore();
    }
  });

  it("reports an empty repository without failing", async () => {
    const repo = TestRepo.create();
    const result = await analyze(repo.root);
    expect(result).toMatchObject({ asOf: null, repository: { headCommit: null }, files: [] });
    expect(result.warnings).toContain("The repository has no commits yet, so there is nothing to analyze.");
  });

  it("marks a shallow clone incomplete and every file as insufficient evidence", async () => {
    const source = buildGoldenRepo();
    const target = tempDir();
    execFileSync(
      "git",
      ["clone", "-q", "--depth", "1", `file://${source.root.replaceAll("\\", "/")}`, target],
      {
        env: testEnv(),
      },
    );
    const result = await analyze(target);
    expect(result.coverage.incomplete).toBe(true);
    expect(result.warnings.join(" ")).toContain("shallow clone");
    expect(result.files.length).toBeGreaterThan(0);
    for (const f of result.files) expect(f.band).toBe("insufficient_evidence");
  });

  it("marks truncated history as incomplete", async () => {
    const repo = buildGoldenRepo();
    const { config } = loadConfig(repo.root);
    config.limits.maxCommits = 2;
    const result = await analyzeRepository(repo.root, { config, toolVersion: TOOL_VERSION });
    expect(result.coverage).toMatchObject({ commitsRead: 2, historyTruncated: true, incomplete: true });
    expect(result.warnings.join(" ")).toContain("limits.maxCommits");
  });

  it("marks an exhausted import-graph budget as incomplete", async () => {
    const repo = buildGoldenRepo();
    const { config } = loadConfig(repo.root);
    const result = await analyzeRepository(repo.root, { config, toolVersion: TOOL_VERSION, graphBudget: 0 });
    expect(result.coverage.incomplete).toBe(true);
    expect(result.warnings.join(" ")).toContain("import graph");
  });

  it("fails clearly outside a repository", async () => {
    await expect(analyze(tempDir())).rejects.toMatchObject({ code: "not_a_repository" });
  });
});
