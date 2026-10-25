import { describe, expect, it } from "vitest";
import { resolveSpecifier, transitiveFanIn } from "./graph.js";

const files = new Set([
  "src/a.ts",
  "src/b.tsx",
  "src/util/index.ts",
  "src/legacy.js",
  "src/esm.mts",
  "lib/c.d.ts",
]);

describe("resolveSpecifier", () => {
  it.each([
    ["src/a.ts", "./b", "src/b.tsx"],
    ["src/a.ts", "./b.js", "src/b.tsx"],
    ["src/a.ts", "./util", "src/util/index.ts"],
    ["src/a.ts", "./util/", "src/util/index.ts"],
    ["src/a.ts", "./legacy.js", "src/legacy.js"],
    ["src/a.ts", "./esm.mjs", "src/esm.mts"],
    ["src/a.ts", "../lib/c", "lib/c.d.ts"],
    ["src/util/index.ts", "../a?raw", "src/a.ts"],
  ])("resolves %s + %s", (from, spec, expected) => {
    expect(resolveSpecifier(from, spec, files)).toBe(expected);
  });

  it("ignores bare specifiers, missing files, self-imports and paths outside the repository", () => {
    expect(resolveSpecifier("src/a.ts", "react", files)).toBeNull();
    expect(resolveSpecifier("src/a.ts", "@scope/pkg", files)).toBeNull();
    expect(resolveSpecifier("src/a.ts", "./missing", files)).toBeNull();
    expect(resolveSpecifier("src/a.ts", "./a", files)).toBeNull();
    expect(resolveSpecifier("src/a.ts", "../../etc/passwd", files)).toBeNull();
    expect(resolveSpecifier("a.ts", "..", files)).toBeNull();
  });
});

describe("transitiveFanIn", () => {
  it("counts every file that reaches a module directly or indirectly", () => {
    const result = transitiveFanIn(
      new Map([
        ["a", ["b"]],
        ["b", ["c"]],
        ["c", []],
        ["d", ["c", "c"]],
      ]),
    );
    expect(Object.fromEntries(result.fanIn)).toEqual({ a: 0, b: 1, c: 3, d: 0 });
    expect(result).toMatchObject({ edges: 3, budgetExceeded: false });
  });

  it("terminates on cycles and does not count a file as its own dependent", () => {
    const result = transitiveFanIn(
      new Map([
        ["a", ["b", "a"]],
        ["b", ["a"]],
      ]),
    );
    expect(Object.fromEntries(result.fanIn)).toEqual({ a: 1, b: 1 });
  });

  it("marks remaining files unknown, deterministically, once the work budget is spent", () => {
    const graph = new Map<string, string[]>();
    for (let i = 0; i < 50; i++)
      graph.set(`f${String(i).padStart(2, "0")}`, i > 0 ? [`f${String(i - 1).padStart(2, "0")}`] : []);
    const first = transitiveFanIn(graph, 100);
    const second = transitiveFanIn(graph, 100);
    expect(first.budgetExceeded).toBe(true);
    expect([...first.fanIn]).toEqual([...second.fanIn]);
    expect([...first.fanIn.values()].filter((v) => v === null).length).toBeGreaterThan(0);
    expect(first.fanIn.get("f00")).toBe(49);
  });
});
