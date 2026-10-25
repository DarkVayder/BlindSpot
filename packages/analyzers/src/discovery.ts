import { matchesGlob, type BlindspotConfig } from "@blindspot/core";
import type { TrackedEntry } from "@blindspot/git";
import { extensionOf, languageOf } from "./languages.js";

export const DEFAULT_EXCLUDES = [
  "**/node_modules/**",
  "**/bower_components/**",
  "**/vendor/**",
  "**/third_party/**",
  "**/dist/**",
  "**/build/**",
  "**/out/**",
  "**/coverage/**",
  "**/.next/**",
  "**/.nuxt/**",
  "**/target/**",
  "**/__generated__/**",
  "**/*.min.js",
  "**/*.min.mjs",
  "**/*.bundle.js",
  "**/*.generated.*",
  "**/*.pb.go",
  "**/*_pb2.py",
  "**/*.g.cs",
  "**/*.designer.cs",
] as const;

export type ExclusionReason =
  | "symlink"
  | "submodule"
  | "invalid_path"
  | "extension"
  | "not_included"
  | "default_excluded"
  | "user_excluded"
  | "too_large"
  | "unreadable"
  | "binary"
  | "generated";

export interface Exclusion {
  path: string;
  reason: ExclusionReason;
}

export interface Candidate {
  path: string;
  oid: string;
  language: string;
}

export interface Selection {
  candidates: Candidate[];
  excluded: Exclusion[];
}

export function matchesAny(file: string, globs: readonly string[]): boolean {
  return globs.some((g) => matchesGlob(file, g));
}

export function selectFiles(entries: readonly TrackedEntry[], config: BlindspotConfig): Selection {
  const extensions = new Set(config.extensions.map((e) => e.toLowerCase()));
  const seen = new Map<string, number>();
  for (const e of entries) seen.set(e.path, (seen.get(e.path) ?? 0) + 1);

  const candidates: Candidate[] = [];
  const excluded: Exclusion[] = [];
  for (const entry of [...entries].sort((a, b) => compare(a.path, b.path))) {
    const reason = exclusionFor(entry, config, extensions, (seen.get(entry.path) ?? 0) > 1);
    if (reason) excluded.push({ path: entry.path, reason });
    else candidates.push({ path: entry.path, oid: entry.oid, language: languageOf(entry.path) });
  }
  return { candidates, excluded };
}

function exclusionFor(
  entry: TrackedEntry,
  config: BlindspotConfig,
  extensions: ReadonlySet<string>,
  duplicate: boolean,
): ExclusionReason | undefined {
  if (entry.kind === "symlink") return "symlink";
  if (entry.kind === "submodule") return "submodule";
  if (duplicate || !isSafePath(entry.path)) return "invalid_path";
  if (!extensions.has(extensionOf(entry.path))) return "extension";
  if (config.include.length > 0 && !matchesAny(entry.path, config.include)) return "not_included";
  if (config.useDefaultExcludes && matchesAny(entry.path, DEFAULT_EXCLUDES)) return "default_excluded";
  if (matchesAny(entry.path, config.exclude)) return "user_excluded";
  if (entry.size === null || entry.size > config.limits.maxFileBytes) return "too_large";
  return undefined;
}

// Rejects names git could not decode as UTF-8 (they would collide after decoding) and
// anything that is not a plain relative path inside the repository.
function isSafePath(file: string): boolean {
  if (file.includes("�") || file.includes("\0")) return false;
  if (file.startsWith("/") || /^[A-Za-z]:/.test(file)) return false;
  return !file.split("/").some((segment) => segment === "" || segment === "." || segment === "..");
}

export function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
