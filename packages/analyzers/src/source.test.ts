import { describe, expect, it } from "vitest";
import { analyzeSource } from "./source.js";

const metrics = (text: string, file = "x.ts") => analyzeSource(file, text).complexity;

describe("cyclomatic and cognitive complexity", () => {
  it("is minimal for an empty file", () => {
    expect(metrics("")).toEqual({ cyclomaticMax: 1, cognitiveTotal: 0, codeLines: 0 });
  });

  it("counts branches, loops, nesting and logical operator sequences", () => {
    const code = `
export function f(a: number, b: boolean, c: boolean) {
  if (a > 1) {
    return 1;
  } else if (a < 0) {
    return 2;
  } else {
    for (const x of [1]) {
      if ((b && c) || a) {
        console.log(x);
      }
    }
  }
  return 0;
}`;
    // cyclomatic: 1 + if + else-if + for + if + && + || = 7
    // cognitive: if 1, else-if 1, else 1, for (nesting 1) 2, if (nesting 2) 3, && then || 2 = 10
    expect(metrics(code)).toMatchObject({ cyclomaticMax: 7, cognitiveTotal: 10 });
  });

  it("measures nested functions separately and deepens their nesting", () => {
    const code = `
function outer(x: boolean, y: boolean) {
  const g = () => {
    if (x) {}
  };
  while (y) {}
  return g;
}`;
    expect(metrics(code)).toMatchObject({ cyclomaticMax: 2, cognitiveTotal: 3 });
  });

  it("counts ternaries and switch cases, but not the default case", () => {
    const code = `
const v = flag ? 1 : 2;
switch (v) {
  case 1: break;
  case 2: break;
  default: break;
}`;
    expect(metrics(code)).toMatchObject({ cyclomaticMax: 4, cognitiveTotal: 2 });
  });

  it("treats a run of the same logical operator as one increment", () => {
    expect(metrics("const ok = a && b && c && d;").cognitiveTotal).toBe(1);
    expect(metrics("const ok = a && b || c && d;").cognitiveTotal).toBe(3);
  });
});

describe("code lines", () => {
  it("excludes comments and blank lines but counts every line of a multi-line token", () => {
    const code = [
      "// comment",
      "/* block",
      "   comment */",
      "const a = 1; // trailing",
      "",
      "const s = `x",
      "y`;",
    ].join("\n");
    expect(metrics(code).codeLines).toBe(3);
  });

  it("handles JSX and ignores whitespace-only JSX text", () => {
    const code = "export const C = () => (\n  <div>\n\n    {a && <span />}\n  </div>\n);\n";
    expect(metrics(code, "c.tsx")).toEqual({ cyclomaticMax: 2, cognitiveTotal: 1, codeLines: 5 });
  });
});

describe("module specifiers", () => {
  it("collects static, dynamic, require, type-only and import-type references", () => {
    const code = `
import x from "./a";
export * from "../b";
import type T from "./e";
import fs = require("fs");
const c = import("./c");
const d = require("./d");
const g = import(\`./g\`);
const dynamic = require(name);
type X = import("./f").Y;
`;
    expect(analyzeSource("src/m.ts", code).imports).toEqual([
      "./a",
      "../b",
      "./e",
      "fs",
      "./c",
      "./d",
      "./g",
      "./f",
    ]);
  });
});
