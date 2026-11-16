import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EXIT, type CliIO } from "./io.js";
import { run } from "./run.js";

// The CLI reference and the package README are written for people who never see the
// source, so they must match what the CLI actually accepts and returns.
const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");
const CLI_DOC = read("../../../docs/cli.md");
const PACKAGE_README = read("../README.md");
const COMMANDS = ["analyze", "compare", "init", "schema"] as const;

async function help(command: string): Promise<string> {
  let out = "";
  const io: CliIO = {
    stdout: { write: (s: string) => (out += s) },
    stderr: { write: () => true },
    cwd: process.cwd(),
    env: {},
  };
  await run([command, "--help"], io);
  return out;
}

function section(command: string): string {
  const start = CLI_DOC.indexOf(`## \`blindspot ${command}`);
  if (start < 0) throw new Error(`docs/cli.md has no section for ${command}`);
  const next = CLI_DOC.indexOf("\n## ", start + 1);
  return CLI_DOC.slice(start, next < 0 ? undefined : next);
}

// Only the Options block: the footer mentions flags (such as --verbose) in prose.
function optionsBlock(text: string): string {
  const start = text.indexOf("Options:");
  const end = text.indexOf("\n\n", start);
  return text.slice(start, end < 0 ? undefined : end);
}

const longOptions = (text: string) => new Set([...text.matchAll(/--[a-z][a-z-]*/g)].map((m) => m[0]));

describe("docs/cli.md", () => {
  it.each(COMMANDS)("documents every option of %s, and nothing it does not accept", async (command) => {
    const helpOptions = [...longOptions(optionsBlock(await help(command)))].filter((o) => o !== "--help");
    const doc = section(command);
    for (const option of helpOptions) expect(doc, `${command} ${option}`).toContain(option);

    const tableOptions = doc
      .split("\n")
      .filter((line) => line.startsWith("| `-"))
      .flatMap((line) => [...longOptions(line.split("|")[1] ?? "")]);
    for (const option of tableOptions) expect(helpOptions, `${command} ${option}`).toContain(option);
  });

  it("lists exactly the exit codes the CLI uses, in both the reference and the package README", () => {
    const codes = Object.values(EXIT).sort();
    for (const doc of [CLI_DOC, PACKAGE_README]) {
      const exitTable = doc.slice(doc.indexOf("Exit codes"));
      const documented = [...exitTable.matchAll(/^\| (\d) +\|/gm)].map((m) => Number(m[1]));
      expect(documented).toEqual(codes);
    }
  });
});
