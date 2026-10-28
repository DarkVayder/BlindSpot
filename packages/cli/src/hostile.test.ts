import { execFileSync } from "node:child_process";
import { defaultConfig } from "@blindspot/core";
import { analyzeRepository } from "@blindspot/engine";
import { renderHtml, renderJson, renderTerminal } from "@blindspot/report";
import { describe, expect, it } from "vitest";
import { testEnv, TestRepo } from "../../git/src/test/repo.js";

const ch = (code: number) => String.fromCharCode(code);
const ESC = ch(0x1b);
const RLO = ch(0x202e);

// Names Windows cannot create on disk but git happily stores. Blindspot reads from git
// objects, so these reach the engine on every platform.
const HOSTILE = [
  `src/new${ch(0x0a)}line.ts`,
  `src/tab${ch(0x09)}name.ts`,
  `src/esc${ESC}[31mred${ESC}[0m.ts`,
  `src/osc${ESC}]8;;evil.example${ch(0x07)}link.ts`,
  "src/:100644 100644 aaa bbb D.ts",
  `src/1${ch(0x09)}2${ch(0x09)}fake.ts`,
  'src/quote"<script>alert(1)</script>.ts',
  `src/invoice${RLO}txt.exe.ts`,
];

function addBlob(repo: TestRepo, content: string, file: string): void {
  const oid = execFileSync("git", ["hash-object", "-w", "--stdin"], {
    cwd: repo.root,
    env: testEnv(),
    input: content,
    encoding: "utf8",
  }).trim();
  repo.git("update-index", "--add", "--cacheinfo", `100644,${oid},${file}`);
}

describe("hostile file names end to end", () => {
  it("analyzes names with control characters and fake log syntax, and renders them safely", async () => {
    const repo = TestRepo.create();
    repo.git("config", "core.protectNTFS", "false");
    repo.write("src/ok.ts", "export const ok = 1;\n").commit("base", "2026-01-01T00:00:00Z");
    HOSTILE.forEach((name, i) => {
      addBlob(repo, `export const v${i} = ${i};\n`, name);
    });
    repo.commit("hostile names", "2026-02-01T00:00:00Z", undefined, false);

    const result = await analyzeRepository(repo.root, { config: defaultConfig(), toolVersion: "test" });
    const paths = result.files.map((f) => f.path);
    expect([...paths].sort()).toEqual([...HOSTILE, "src/ok.ts"].sort());
    for (const f of result.files) {
      expect(f.signals.find((s) => s.id === "commits_recent")?.status, f.path).toBe("observed");
    }

    const terminal = renderTerminal(result, { color: false, width: 160, limit: 50 });
    // eslint-disable-next-line no-control-regex -- asserting no control characters reach the terminal
    expect(terminal).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/);
    expect(terminal).not.toContain(RLO);

    const html = renderHtml(result);
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain(ESC);
    expect(html).not.toContain(RLO);

    const roundTrip = JSON.parse(renderJson(result)) as { files: { path: string }[] };
    expect(roundTrip.files.map((f) => f.path).sort()).toEqual([...paths].sort());
  });
});
