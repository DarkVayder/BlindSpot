import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SKIP = new Set(["node_modules", "dist", ".git", "coverage", "__golden__"]);
const SCANNED = /\.(ts|js|json|md|ya?ml)$/;

// Code points are listed numerically so this file cannot itself carry the characters it
// forbids: bidi controls (Trojan Source), BOMs and C0/C1 controls other than tab, LF, CR.
const FORBIDDEN = new Set<number>([
  ...range(0x00, 0x08),
  0x0b,
  0x0c,
  ...range(0x0e, 0x1f),
  ...range(0x7f, 0x9f),
  0x061c,
  0x200e,
  0x200f,
  ...range(0x202a, 0x202e),
  ...range(0x2066, 0x2069),
  0xfeff,
]);

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (SKIP.has(entry.name)) return [];
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return files(full);
    return SCANNED.test(entry.name) ? [full] : [];
  });
}

describe("repository hygiene", () => {
  it("contains no invisible control, bidi or BOM characters in source and docs", () => {
    const findings: string[] = [];
    for (const file of files(ROOT)) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          for (const char of line) {
            const code = char.codePointAt(0) ?? 0;
            if (FORBIDDEN.has(code)) {
              findings.push(`${path.relative(ROOT, file)}:${i + 1} U+${code.toString(16).padStart(4, "0")}`);
            }
          }
        });
    }
    expect(findings).toEqual([]);
  });
});
