import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buildGoldenRepo } from "../../engine/src/test/fixture.js";
import { tempDir, TestRepo } from "../../git/src/test/repo.js";
import { goldenResult, HOSTILE_PATHS, withPaths } from "../../report/src/test/fixture.js";
import { escapeCommandData, input, markdownText, outputBlock } from "./github.js";
import { runAction } from "./main.js";
import { renderSummary } from "./summary.js";

const repos: TestRepo[] = [];
afterAll(() => {
  for (const r of repos) r.cleanup();
});

describe("workflow command safety", () => {
  it("encodes characters that would start a new workflow command", () => {
    expect(escapeCommandData("a%b\r\n::error::x")).toBe("a%25b%0D%0A::error::x");
  });

  it("never lets an output value close its own block", () => {
    const block = outputBlock("report", "line1\nghadelimiter_x\nreport2<<EOF");
    const [header, ...rest] = block.split("\n");
    const delimiter = header?.split("<<")[1] ?? "";
    expect(delimiter).toMatch(/^ghadelimiter_[0-9a-f]{32}$/);
    expect(rest.filter((line) => line === delimiter)).toHaveLength(1);
  });

  it("reads inputs the way GitHub passes them", () => {
    expect(input({ "INPUT_FAIL-ON": "  new-elevated " }, "fail-on")).toBe("new-elevated");
    expect(input({}, "top")).toBe("");
  });
});

describe("job summary", () => {
  it("renders hostile file names as inert text that cannot break the table", () => {
    const summary = renderSummary({
      result: withPaths(goldenResult(), [...HOSTILE_PATHS, "src/a|b`c*d_[x](y).ts"]),
      comparison: null,
      baseCommit: null,
      comparisonSkipped: null,
      highlight: "elevated",
      gate: null,
      top: 20,
      reportDir: "blindspot-report",
    });
    // eslint-disable-next-line no-control-regex -- asserting no control characters reach the summary
    expect(summary).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u202e]/);
    expect(summary).not.toMatch(/<script|<style|onmouseover="/);
    const rows = summary.split("\n").filter((line) => line.startsWith("| ") && line.includes("<code>"));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.split("|")).toHaveLength(7);
    expect(markdownText("it's")).toBe("it&#39;s");
  });
});

function env(repo: string, extra: Record<string, string> = {}) {
  const dir = tempDir("bs-action-");
  const summary = path.join(dir, "summary.md");
  const outputs = path.join(dir, "outputs.txt");
  writeFileSync(summary, "");
  writeFileSync(outputs, "");
  return {
    vars: { GITHUB_WORKSPACE: repo, GITHUB_STEP_SUMMARY: summary, GITHUB_OUTPUT: outputs, ...extra },
    summary: () => readFileSync(summary, "utf8"),
    outputs: () => {
      const text = readFileSync(outputs, "utf8");
      const result: Record<string, string> = {};
      for (const match of text.matchAll(/^([\w-]+)<<(\S+)\n([\s\S]*?)\n\2$/gm))
        result[match[1] ?? ""] = match[3] ?? "";
      return result;
    },
  };
}

function capture() {
  let out = "";
  return { io: { stdout: { write: (s: string) => (out += s) } }, out: () => out };
}

describe("runAction", () => {
  it("compares a pull request with the commit it branched from", async () => {
    const r = TestRepo.create("bs-action-pr-");
    repos.push(r);
    for (let i = 0; i < 6; i++) {
      r.write("src/a.ts", `export const a = ${i};\n`).write("src/b.ts", `export const b = ${i};\n`);
      r.commit(`base ${i}`, `2026-0${i + 1}-01T00:00:00Z`);
    }
    const base = r.git("rev-parse", "HEAD").trim();
    r.git("switch", "-q", "-c", "feature");
    const branchy = Array.from(
      { length: 12 },
      (_, i) => `  if (x === ${i}) { if (y) { n += ${i}; } else { n -= 1; } }`,
    ).join("\n");
    r.write(
      "src/a.ts",
      `export function a(x: number, y: boolean): number {\n  let n = 0;\n${branchy}\n  return n;\n}\n`,
    );
    r.commit("make a complex", "2026-07-01T00:00:00Z");

    const event = path.join(tempDir(), "event.json");
    writeFileSync(event, JSON.stringify({ pull_request: { number: 7, base: { sha: base } } }));
    const e = env(r.root, { GITHUB_EVENT_NAME: "pull_request", GITHUB_EVENT_PATH: event, INPUT_TOP: "5" });
    const c = capture();

    expect(await runAction(e.vars, c.io)).toBe(0);
    expect(e.summary()).toContain(`Compared with the pull request's base (\`${base.slice(0, 12)}\`)`);
    expect(e.summary()).toContain("It is not a prediction of defects.");
    const outputs = e.outputs();
    expect(outputs.gate).toBe("off");
    expect(outputs["newly-elevated-files"]).toMatch(/^\d+$/);
    expect(readFileSync(outputs["report-html"] ?? "", "utf8")).toContain("<!doctype html>");
    expect(JSON.parse(readFileSync(outputs["report-json"] ?? "", "utf8"))).toMatchObject({
      schemaVersion: 1,
    });
  });

  it("fails the step and names the gate when fail-on is reached", async () => {
    const r = buildGoldenRepo();
    repos.push(r);
    const e = env(r.root, { "INPUT_FAIL-ON": "moderate" });
    const c = capture();
    expect(await runAction(e.vars, c.io)).toBe(1);
    expect(c.out()).toMatch(/^::error::Blindspot: \d+ file\(s\) at or above moderate/);
    expect(e.outputs().gate).toBe("failed");
    expect(e.summary()).toContain("**Gate `moderate` failed:**");
  });

  it("skips a new-* gate with a warning when there is no pull request to compare", async () => {
    const r = buildGoldenRepo();
    repos.push(r);
    const e = env(r.root, { "INPUT_FAIL-ON": "new-elevated", GITHUB_EVENT_NAME: "push" });
    const c = capture();
    expect(await runAction(e.vars, c.io)).toBe(0);
    expect(c.out()).toMatch(/^::warning::fail-on new-elevated was not checked/);
    expect(e.outputs()).toMatchObject({ gate: "off", "newly-elevated-files": "" });
    expect(e.summary()).not.toContain("Compared with the pull request's base");
  });

  it("reports bad inputs and non-repositories as errors, not crashes", async () => {
    const r = buildGoldenRepo();
    repos.push(r);
    const bad = capture();
    expect(await runAction(env(r.root, { "INPUT_FAIL-ON": "everything" }).vars, bad.io)).toBe(1);
    expect(bad.out()).toMatch(/^::error::Blindspot: fail-on must be empty or one of/);

    const notRepo = capture();
    expect(await runAction(env(tempDir()).vars, notRepo.io)).toBe(1);
    expect(notRepo.out()).toMatch(/^::error::Blindspot: This directory is not inside a git repository/);
    expect(notRepo.out()).not.toContain("Internal error");
  });
});

describe("action.yml", () => {
  const manifest = readFileSync(new URL("../../../action.yml", import.meta.url), "utf8");
  const keysOf = (section: string) => {
    const block = manifest.split(`\n${section}:\n`)[1]?.split(/\n(?=\S)/)[0] ?? "";
    return [...block.matchAll(/^ {2}([a-z-]+):/gm)].map((m) => m[1]).sort();
  };

  it("declares exactly the inputs the action reads", () => {
    const source = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
    const read = [...new Set([...source.matchAll(/input\(env, "([a-z-]+)"\)/g)].map((m) => m[1]))].sort();
    expect(keysOf("inputs")).toEqual(read);
  });

  it("declares exactly the outputs the action writes", async () => {
    const r = buildGoldenRepo();
    repos.push(r);
    const e = env(r.root);
    expect(await runAction(e.vars, capture().io)).toBe(0);
    expect(keysOf("outputs")).toEqual(Object.keys(e.outputs()).sort());
  });

  it("runs the committed bundle on Node 24", () => {
    expect(manifest).toMatch(/\nruns:\n {2}using: node24\n {2}main: packages\/action\/bundle\/index\.mjs\n/);
  });
});
