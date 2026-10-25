import path from "node:path";
import { compare } from "./discovery.js";

const TS_FOR_JS: Record<string, readonly string[]> = {
  ".js": [".ts", ".tsx"],
  ".jsx": [".tsx"],
  ".mjs": [".mts"],
  ".cjs": [".cts"],
};
const PROBE_EXTENSIONS = [".ts", ".tsx", ".d.ts", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

// Resolves only relative specifiers inside the repository. Bare specifiers (packages,
// tsconfig path aliases, workspace names) are not followed in v1.
export function resolveSpecifier(from: string, specifier: string, files: ReadonlySet<string>): string | null {
  if (
    !specifier.startsWith("./") &&
    !specifier.startsWith("../") &&
    specifier !== "." &&
    specifier !== ".."
  ) {
    return null;
  }
  const clean = specifier.split(/[?#]/, 1)[0] ?? "";
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), clean)).replace(/\/$/, "");
  if (base === ".." || base.startsWith("../") || base === ".") return null;

  const candidates: string[] = [base];
  const ext = path.posix.extname(base);
  for (const replacement of TS_FOR_JS[ext] ?? []) candidates.push(base.slice(0, -ext.length) + replacement);
  for (const probe of PROBE_EXTENSIONS) candidates.push(base + probe);
  for (const probe of PROBE_EXTENSIONS) candidates.push(`${base}/index${probe}`);

  for (const candidate of candidates) {
    if (candidate !== from && files.has(candidate)) return candidate;
  }
  return null;
}

export interface FanInResult {
  fanIn: Map<string, number | null>;
  edges: number;
  budgetExceeded: boolean;
}

export const DEFAULT_GRAPH_BUDGET = 25_000_000;

export function transitiveFanIn(
  imports: ReadonlyMap<string, readonly string[]>,
  budget = DEFAULT_GRAPH_BUDGET,
): FanInResult {
  const nodes = [...imports.keys()].sort(compare);
  const index = new Map(nodes.map((n, i) => [n, i]));
  const importers: number[][] = nodes.map(() => []);
  let edges = 0;
  nodes.forEach((importer, i) => {
    const targets = new Set(imports.get(importer));
    for (const target of [...targets].sort(compare)) {
      const j = index.get(target);
      if (j === undefined || j === i) continue;
      importers[j]?.push(i);
      edges++;
    }
  });

  const fanIn = new Map<string, number | null>();
  const visited = new Int32Array(nodes.length).fill(-1);
  let work = 0;
  let budgetExceeded = false;
  nodes.forEach((node, start) => {
    if (budgetExceeded) {
      fanIn.set(node, null);
      return;
    }
    const queue = [start];
    visited[start] = start;
    let reached = 0;
    for (let head = 0; head < queue.length; head++) {
      for (const parent of importers[queue[head] as number] ?? []) {
        work++;
        if (visited[parent] === start) continue;
        visited[parent] = start;
        reached++;
        queue.push(parent);
      }
      if (work > budget) {
        budgetExceeded = true;
        break;
      }
    }
    fanIn.set(node, budgetExceeded ? null : reached);
  });
  return { fanIn, edges, budgetExceeded };
}
