import { describe, expect, it } from "vitest";
import { expandBraces, matchesGlob, validateGlob } from "./glob.js";

describe("matchesGlob", () => {
  it.each([
    ["**/*", "a.ts", true],
    ["**/*", "a/b/.hidden.ts", true],
    ["*.ts", "a.ts", true],
    ["*.ts", "a/b.ts", false],
    ["src/**", "src/a/b.ts", true],
    ["src/**", "srcx/a.ts", false],
    ["**/node_modules/**", "node_modules/x.js", true],
    ["**/node_modules/**", "a/node_modules/b/x.js", true],
    ["**/dist/**", "dist", false],
    ["**/*.min.js", "x.min.js", true],
    ["**/*.min.js", "x.min.jsx", false],
    ["src/{a,b}/*.ts", "src/b/x.ts", true],
    ["src/{a,b}/*.ts", "src/c/x.ts", false],
    ["file?.ts", "file1.ts", true],
    ["file?.ts", "file10.ts", false],
    ["[abc].ts", "b.ts", true],
    ["[!abc].ts", "b.ts", false],
    ["[a-c]x", "cx", true],
    ["\\*.ts", "*.ts", true],
    ["\\*.ts", "a.ts", false],
    ["./src/*.ts", "src/a.ts", true],
    ["a/**/b", "a/b", true],
    ["a/**/b", "a/x/y/b", true],
    ["a/**/**/b", "a/x/b", true],
  ])("%s matches %s → %s", (pattern, file, expected) => {
    expect(matchesGlob(file, pattern)).toBe(expected);
  });

  it("runs in polynomial time on patterns that make backtracking matchers hang", () => {
    const cases: [string, string][] = [
      ["*a".repeat(20) + "*b", "a".repeat(40)],
      ["**/".repeat(30) + "x", "a/".repeat(60) + "y"],
      ["*".repeat(400) + "x", "a".repeat(200)],
      ["*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*b", "a".repeat(4000)],
    ];
    const started = performance.now();
    for (const [pattern, file] of cases) expect(matchesGlob(file, pattern)).toBe(false);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

describe("expandBraces", () => {
  it("expands nested alternatives", () => {
    expect(expandBraces("a{b,c{d,e}}f")).toEqual(["abf", "acdf", "acef"]);
    expect(expandBraces("\\{a,b}")).toEqual(["\\{a,b}"]);
  });

  it("caps the number of alternatives", () => {
    expect(() => expandBraces("{a,b}".repeat(12))).toThrow(/more than 64/);
  });
});

describe("validateGlob", () => {
  it("accepts valid patterns and explains invalid ones", () => {
    expect(validateGlob("src/**/*.{ts,tsx}")).toBeUndefined();
    expect(validateGlob("src/{a,b")).toMatch(/Unclosed "\{"/);
    expect(validateGlob("src/[ab")).toMatch(/Unclosed "\["/);
    expect(validateGlob("trailing\\")).toMatch(/escape/);
  });
});
