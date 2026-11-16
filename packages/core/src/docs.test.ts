import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { configJsonSchema } from "./config.js";

// docs/configuration.md must describe every setting the schema accepts, and only those.
const DOC = readFileSync(new URL("../../../docs/configuration.md", import.meta.url), "utf8");

interface SchemaNode {
  type?: string;
  properties?: Record<string, SchemaNode>;
}

function leafPaths(node: SchemaNode, prefix = ""): string[] {
  return Object.entries(node.properties ?? {}).flatMap(([key, child]) => {
    const name = prefix ? `${prefix}.${key}` : key;
    return child.type === "object" && child.properties ? leafPaths(child, name) : [name];
  });
}

describe("docs/configuration.md", () => {
  const paths = leafPaths(configJsonSchema());

  it("documents every setting in the schema", () => {
    expect(paths.length).toBeGreaterThan(10);
    for (const name of paths) expect(DOC, name).toContain(`\`${name}\``);
  });

  it("documents no setting the schema does not accept", () => {
    const documented = DOC.split("\n")
      .filter((line) => /^\| `[^`]+` +\|/.test(line))
      .map((line) => /^\| `([^`]+)`/.exec(line)?.[1] ?? "");
    expect(documented.length).toBeGreaterThan(10);
    for (const name of documented) expect(paths, name).toContain(name);
  });
});
