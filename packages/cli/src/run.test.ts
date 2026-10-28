import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AnalysisResult } from "@blindspot/core";
import { describe, expect, it } from "vitest";
import { buildGoldenRepo } from "../../engine/src/test/fixture.js";
import { tempDir, testEnv, TestRepo } from "../../git/src/test/repo.js";
import { EXIT, type CliIO } from "./io.js";
import { run, toolVersion } from "./run.js";

interface Captured {
  code: number;
  stdout: string;
  stderr: string;
}

async function cli(
  args: string[],
  options: { cwd?: string; env?: Record<string, string>; stdoutThrows?: boolean } = {},
): Promise<Captured> {
  let stdout = "";
  let stderr = "";
  const io: CliIO = {
    stdout: {
      write: (s: string) => {
        if (options.stdoutThrows) throw new Error("boom");
        stdout += s;
      },
    },
    stderr: { write: (s: string) => (stderr += s) },
    cwd: options.cwd ?? tempDir(),
    env: options.env ?? {},
  };
  const code = await run(args, io);
  return { code, stdout, stderr };
}

let golden: TestRepo | undefined;
function goldenRepo(): TestRepo {
  golden ??= buildGoldenRepo();
  return golden;
}

describe("global behavior", () => {
  it("documents exit codes in help and exits 0", async () => {
    const r = await cli(["--help"]);
    expect(r.code).toBe(EXIT.ok);
    expect(r.stdout).toContain("Exit codes:");
    expect(r.stdout).toMatch(/analyze \[options\] \[path\]/);
  });

  it("prints the package version", async () => {
    const r = await cli(["--version"]);
    expect(r).toMatchObject({ code: 0, stdout: `${toolVersion()}\n` });
  });

  it("rejects unknown options and invalid choices with exit code 2", async () => {
    expect((await cli(["analyze", "--nope"])).code).toBe(EXIT.usage);
    const bad = await cli(["analyze", "--fail-on", "bogus"]);
    expect(bad.code).toBe(EXIT.usage);
    expect(bad.stderr).toContain("Allowed choices are high, elevated, moderate");
    expect((await cli(["analyze", "--top", "0"])).code).toBe(EXIT.usage);
  });

  it("maps unexpected failures to exit code 4 without a stack trace unless verbose", async () => {
    const r = await cli(["analyze", goldenRepo().root], { stdoutThrows: true });
    expect(r.code).toBe(EXIT.internal);
    expect(r.stderr).toContain("Internal error: boom");
    expect(r.stderr).toContain("Re-run with --verbose");
    const verbose = await cli(["analyze", goldenRepo().root, "--verbose"], { stdoutThrows: true });
    expect(verbose.stderr).toMatch(/at .*commands/);
  });
});

describe("analyze", () => {
  it("prints the summary and exits 0, and is the default command", async () => {
    const explicit = await cli(["analyze", goldenRepo().root, "--no-color"]);
    expect(explicit.code).toBe(EXIT.ok);
    expect(explicit.stdout).toContain("Highest estimated risk");
    expect(explicit.stdout).toContain("src/core/parser.ts");
    const implicit = await cli([goldenRepo().root, "--no-color"]);
    expect(implicit.stdout).toBe(explicit.stdout);
  });

  it("analyzes from a subdirectory using the repository root's configuration", async () => {
    const r = await cli(["analyze", path.join(goldenRepo().root, "src", "core"), "--json", "-"]);
    const result = JSON.parse(r.stdout) as AnalysisResult;
    expect(result.files.find((f) => f.path === "src/core/parser.ts")?.explanations).toContain(
      "Matches a path configured as critical.",
    );
  });

  it("writes JSON to standard output and moves the summary to standard error", async () => {
    const r = await cli(["analyze", goldenRepo().root, "--json", "-"]);
    expect(r.code).toBe(EXIT.ok);
    const result = JSON.parse(r.stdout) as AnalysisResult;
    expect(result.schemaVersion).toBe(1);
    expect(result.toolVersion).toBe(toolVersion());
    expect(r.stderr).toContain("Highest estimated risk");
  });

  it("writes JSON and HTML files, creating parent directories", async () => {
    const out = tempDir();
    const json = path.join(out, "nested", "report.json");
    const html = path.join(out, "nested", "deeper", "report.html");
    const r = await cli(["analyze", goldenRepo().root, "--json", json, "--html", html, "--quiet"]);
    expect(r).toMatchObject({ code: 0, stdout: "" });
    expect((JSON.parse(readFileSync(json, "utf8")) as AnalysisResult).files.length).toBe(5);
    expect(readFileSync(html, "utf8")).toMatch(/^<!doctype html>/);
  });

  it("resolves relative output paths against the working directory", async () => {
    const cwd = tempDir();
    await cli(["analyze", goldenRepo().root, "--json", "out/r.json", "--quiet"], { cwd });
    expect(existsSync(path.join(cwd, "out", "r.json"))).toBe(true);
  });

  it("refuses to write HTML to standard output", async () => {
    const r = await cli(["analyze", goldenRepo().root, "--html", "-"]);
    expect(r.code).toBe(EXIT.usage);
    expect(r.stderr).toContain("--html needs a file path");
  });

  it("fails on an absolute threshold, listing the highest scores first", async () => {
    expect((await cli(["analyze", goldenRepo().root, "--fail-on", "elevated", "--quiet"])).code).toBe(
      EXIT.ok,
    );
    const r = await cli(["analyze", goldenRepo().root, "--fail-on", "moderate", "--quiet"]);
    expect(r.code).toBe(EXIT.riskThreshold);
    const lines = r.stderr.trim().split("\n");
    expect(lines[0]).toBe("Blindspot: 2 file(s) at or above moderate (--fail-on moderate):");
    expect(lines[1]).toMatch(/^\s+44\.6\s+src\/core\/parser\.ts$/);
    expect(lines[2]).toMatch(/^\s+37\.8\s+src\/core\/tokens\.ts$/);
  });

  it("requires a baseline for new-* thresholds before doing any work", async () => {
    const r = await cli(["analyze", tempDir(), "--fail-on", "new-moderate"]);
    expect(r.code).toBe(EXIT.usage);
    expect(r.stderr).toContain("needs a baseline");
  });

  it("compares with a baseline and fails only on newly risky files", async () => {
    const dir = tempDir();
    const current = await cli(["analyze", goldenRepo().root, "--json", "-"]);
    const result = JSON.parse(current.stdout) as AnalysisResult;

    const same = path.join(dir, "same.json");
    writeFileSync(same, current.stdout);
    const unchanged = await cli([
      "analyze",
      goldenRepo().root,
      "--baseline",
      same,
      "--fail-on",
      "new-moderate",
      "--no-color",
    ]);
    expect(unchanged.code).toBe(EXIT.ok);
    expect(unchanged.stdout).toContain("Compared with baseline");
    expect(unchanged.stdout).toContain("No file is newly at or above moderate.");

    const older = path.join(dir, "older.json");
    writeFileSync(
      older,
      JSON.stringify({ ...result, files: result.files.filter((f) => f.path !== "src/core/parser.ts") }),
    );
    const r = await cli([
      "analyze",
      goldenRepo().root,
      "--baseline",
      older,
      "--fail-on",
      "new-moderate",
      "--no-color",
    ]);
    expect(r.code).toBe(EXIT.riskThreshold);
    expect(r.stdout).toMatch(/44\.6\s+src\/core\/parser\.ts\s+Moderate \(new file\)/);
    expect(r.stderr).toContain("1 file(s) newly at or above moderate since the baseline");
  });

  it("refuses new-* gates against a baseline from another model version", async () => {
    const current = await cli(["analyze", goldenRepo().root, "--json", "-"]);
    const file = path.join(tempDir(), "old-model.json");
    writeFileSync(
      file,
      JSON.stringify({ ...(JSON.parse(current.stdout) as AnalysisResult), modelVersion: "bs-risk@0.0.1" }),
    );
    const r = await cli([
      "analyze",
      goldenRepo().root,
      "--baseline",
      file,
      "--fail-on",
      "new-high",
      "--quiet",
    ]);
    expect(r.code).toBe(EXIT.usage);
    expect(r.stderr).toContain("different models");
  });

  it("rejects an unusable baseline with exit code 2", async () => {
    const file = path.join(tempDir(), "bad.json");
    writeFileSync(file, "{ not json");
    const r = await cli(["analyze", goldenRepo().root, "--baseline", file]);
    expect(r.code).toBe(EXIT.usage);
    expect(r.stderr).toContain("is not valid JSON");
    expect((await cli(["analyze", goldenRepo().root, "--baseline", "missing.json"])).code).toBe(EXIT.usage);
  });

  it("reports configuration errors with exit code 2", async () => {
    const r = TestRepo.create();
    r.write("blindspot.config.json", '{ "weigths": {} }')
      .write("a.ts", "export const a = 1;\n")
      .commit("one", "2026-01-01T00:00:00Z");
    const out = await cli(["analyze", r.root]);
    expect(out.code).toBe(EXIT.usage);
    expect(out.stderr).toContain("Configuration error: blindspot.config.json is invalid");
  });

  it("uses an explicit --config path relative to the working directory", async () => {
    const cwd = tempDir();
    writeFileSync(path.join(cwd, "custom.json"), '{ "exclude": ["**"] }');
    const r = await cli(["analyze", goldenRepo().root, "--config", "custom.json", "--json", "-"], { cwd });
    expect((JSON.parse(r.stdout) as AnalysisResult).files).toEqual([]);
  });

  it("exits 3 outside a repository and 2 for a missing path", async () => {
    const notRepo = await cli(["analyze", tempDir()]);
    expect(notRepo.code).toBe(EXIT.analysis);
    expect(notRepo.stderr).toContain("not inside a git repository");
    expect((await cli(["analyze", path.join(tempDir(), "missing")])).code).toBe(EXIT.usage);
  });

  it("colors output only when forced or on a TTY, and honors NO_COLOR", async () => {
    const forced = await cli(["analyze", goldenRepo().root], { env: { FORCE_COLOR: "1" } });
    expect(forced.stdout).toContain("\u001b[");
    const disabled = await cli(["analyze", goldenRepo().root], { env: { FORCE_COLOR: "1", NO_COLOR: "" } });
    expect(disabled.stdout).not.toContain("\u001b[");
    const flag = await cli(["analyze", goldenRepo().root, "--no-color"], { env: { FORCE_COLOR: "1" } });
    expect(flag.stdout).not.toContain("\u001b[");
  });

  it("prints diagnostics to standard error with --verbose", async () => {
    const r = await cli(["analyze", goldenRepo().root, "--verbose", "--quiet"]);
    expect(r.stderr).toMatch(/\[blindspot\] configuration: blindspot\.config\.json/);
    expect(r.stderr).toMatch(/\[blindspot\] analyzed 5 of 8 files and 6 commits in \d+ ms/);
  });
});

describe("compare", () => {
  it("compares two reports as text or JSON and gates on new risk", async () => {
    const dir = tempDir();
    const current = await cli(["analyze", goldenRepo().root, "--json", "-"]);
    const result = JSON.parse(current.stdout) as AnalysisResult;
    const after = path.join(dir, "after.json");
    const before = path.join(dir, "before.json");
    writeFileSync(after, current.stdout);
    writeFileSync(
      before,
      JSON.stringify({ ...result, files: result.files.filter((f) => f.path !== "src/core/tokens.ts") }),
    );

    const text = await cli(["compare", before, after, "--no-color"]);
    expect(text.code).toBe(EXIT.ok);
    expect(text.stdout).toContain("1 new · 0 removed");

    const json = await cli(["compare", before, after, "--json"]);
    expect((JSON.parse(json.stdout) as { summary: { new: number } }).summary.new).toBe(1);

    expect((await cli(["compare", before, after, "--fail-on", "new-moderate"])).code).toBe(
      EXIT.riskThreshold,
    );
    expect((await cli(["compare", before, after, "--fail-on", "new-high"])).code).toBe(EXIT.ok);
    const absolute = await cli(["compare", before, after, "--fail-on", "moderate"]);
    expect(absolute.code).toBe(EXIT.usage);
    expect(absolute.stderr).toContain("only supports new-* thresholds");
  });
});

describe("init and schema", () => {
  it("creates a starter config at the repository root and will not overwrite it without --force", async () => {
    const r = TestRepo.create();
    r.write("src/a.ts", "export const a = 1;\n").commit("one", "2026-01-01T00:00:00Z");
    const created = await cli(["init", r.path("src")]);
    expect(created.code).toBe(EXIT.ok);
    const file = r.path("blindspot.config.json");
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ exclude: [], critical: [] });
    expect((await cli(["init", r.root])).code).toBe(EXIT.usage);
    expect((await cli(["init", r.root, "--force"])).code).toBe(EXIT.ok);
    expect((await cli(["analyze", r.root, "--quiet"])).code).toBe(EXIT.ok);
  });

  it("refuses to initialize outside a repository", async () => {
    expect((await cli(["init", tempDir()])).code).toBe(EXIT.analysis);
  });

  it("prints JSON Schemas for the configuration and the report", async () => {
    const config = JSON.parse((await cli(["schema", "config"])).stdout) as {
      $id: string;
      properties: object;
    };
    expect(config.$id).toBe("urn:blindspot:config:v1");
    expect(Object.keys(config.properties)).toEqual(
      expect.arrayContaining(["include", "exclude", "critical", "weights"]),
    );
    const report = JSON.parse((await cli(["schema", "report"])).stdout) as { $id: string };
    expect(report.$id).toBe("urn:blindspot:analysis-result:v1");
    expect((await cli(["schema", "other"])).code).toBe(EXIT.usage);
  });
});

describe("built executable", () => {
  const bin = fileURLToPath(new URL("../dist/bin.js", import.meta.url));

  it("runs as a real process with real exit codes", () => {
    expect(existsSync(bin), "run `pnpm build` before the tests").toBe(true);
    const ok = spawnSync(
      process.execPath,
      [bin, "analyze", goldenRepo().root, "--fail-on", "elevated", "--quiet"],
      {
        encoding: "utf8",
        env: testEnv(),
      },
    );
    expect(ok.status).toBe(0);
    const gated = spawnSync(process.execPath, [bin, goldenRepo().root, "--fail-on", "moderate", "--quiet"], {
      encoding: "utf8",
      env: testEnv(),
    });
    expect(gated.status).toBe(1);
    expect(gated.stderr).toContain("file(s) at or above moderate");
    const version = execFileSync(process.execPath, [bin, "--version"], { encoding: "utf8" });
    expect(version.trim()).toBe(toolVersion());
  });
});
