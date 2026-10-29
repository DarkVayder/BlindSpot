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

// ADR 0008: the score is a descriptive attention index. Stage 2 found no predictive signal
// beyond file size and churn, so no product copy may claim one. Research docs are exempt
// because they report the study itself.
const PRODUCT_DOCS = [
  "README.md",
  "docs/cli.md",
  "docs/configuration.md",
  "docs/scoring-model.md",
  "docs/architecture.md",
];
const PRODUCT_PACKAGES = ["core", "engine", "report", "cli"];
const CLAIMS = [
  /\bpredict(s|ive|ively)\b/i,
  /\bpredicted to\b/i,
  /\b(accurately|accuracy)\b/i,
  /\bproven\b/i,
  /\bguarantee[sd]?\b/i,
  /\b(bug|defect|error)-prone\b/i,
  /\blikely to (contain|have|introduce|cause) (bugs|defects|errors)\b/i,
  /\brisk of (bugs|defects)\b/i,
];

// Markdown link targets are file names, not prose a reader sees.
export function claimsIn(text: string): string[] {
  const prose = text.replace(/\]\([^)]*\)/g, "]");
  return CLAIMS.filter((claim) => claim.test(prose)).map(String);
}

function productCopyFiles(): string[] {
  const sources = PRODUCT_PACKAGES.flatMap((name) =>
    files(path.join(ROOT, "packages", name, "src")).filter(
      (file) =>
        file.endsWith(".ts") && !file.endsWith(".test.ts") && !file.includes(`${path.sep}test${path.sep}`),
    ),
  );
  return [...PRODUCT_DOCS.map((doc) => path.join(ROOT, doc)), ...sources];
}

describe("product copy", () => {
  it("makes no claim of predictive accuracy", () => {
    const findings: string[] = [];
    for (const file of productCopyFiles()) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          for (const claim of claimsIn(line)) findings.push(`${path.relative(ROOT, file)}:${i + 1} ${claim}`);
        });
    }
    expect(findings).toEqual([]);
  });

  it("recognizes the claims it is meant to block", () => {
    expect(claimsIn("Blindspot predicts which files will break.")).toHaveLength(1);
    expect(claimsIn("A proven, accurate way to find bug-prone files")).toHaveLength(2);
    expect(claimsIn("These files are likely to contain bugs.")).toHaveLength(1);
    expect(claimsIn("It is not a prediction of defects.")).toEqual([]);
    expect(claimsIn("See [ADR 0008](decisions/0008-descriptive-not-predictive.md).")).toEqual([]);
    expect(claimsIn("[It predicts bugs](x.md)")).toHaveLength(1);
  });
});
