import { createHash } from "node:crypto";
import { lstatSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { defaultConfig, parseConfig, type BlindspotConfig } from "@blindspot/core";

export const CONFIG_FILE = "blindspot.config.json";
const MAX_CONFIG_BYTES = 1_000_000;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export interface LoadedConfig {
  config: BlindspotConfig;
  source: string | null;
  warnings: string[];
}

export function loadConfig(root: string, explicitPath?: string): LoadedConfig {
  if (explicitPath !== undefined) {
    const file = path.resolve(explicitPath);
    const stat = statSync(file, { throwIfNoEntry: false });
    if (!stat?.isFile()) throw new ConfigError(`Config file not found: ${explicitPath}`);
    return {
      config: validate(readJson(file, explicitPath, stat.size), explicitPath),
      source: explicitPath,
      warnings: [],
    };
  }

  const configFile = repoFile(root, CONFIG_FILE);
  if (configFile) {
    return {
      config: validate(readJson(configFile.file, CONFIG_FILE, configFile.size), CONFIG_FILE),
      source: CONFIG_FILE,
      warnings: [],
    };
  }

  const packageFile = repoFile(root, "package.json");
  if (packageFile) {
    let manifest: unknown;
    try {
      manifest = readJson(packageFile.file, "package.json", packageFile.size);
    } catch (error) {
      if (!(error instanceof ConfigError)) throw error;
      return {
        config: defaultConfig(),
        source: null,
        warnings: ['package.json could not be read as JSON, so any "blindspot" settings in it were ignored.'],
      };
    }
    if (isRecord(manifest) && Object.hasOwn(manifest, "blindspot")) {
      const source = 'package.json ("blindspot" key)';
      return { config: validate(manifest.blindspot, source), source, warnings: [] };
    }
  }

  return { config: defaultConfig(), source: null, warnings: [] };
}

// Repository-provided files are untrusted: a symlinked config could point at secrets on
// the machine, and JSON.parse error messages quote the input, so neither is allowed.
function repoFile(root: string, name: string): { file: string; size: number } | undefined {
  const file = path.join(root, name);
  const stat = lstatSync(file, { throwIfNoEntry: false });
  if (!stat) return undefined;
  if (stat.isSymbolicLink()) {
    throw new ConfigError(
      `${name} is a symbolic link. Blindspot does not follow links for repository configuration.`,
    );
  }
  if (!stat.isFile()) throw new ConfigError(`${name} is not a regular file.`);
  return { file, size: stat.size };
}

function readJson(file: string, label: string, size: number): unknown {
  if (size > MAX_CONFIG_BYTES) throw new ConfigError(`${label} is larger than ${MAX_CONFIG_BYTES} bytes.`);
  const raw = readFileSync(file, "utf8");
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ConfigError(`${label} is not valid JSON.`);
  }
}

function validate(input: unknown, label: string): BlindspotConfig {
  const result = parseConfig(input);
  if (!result.ok) throw new ConfigError(`${label} is invalid:\n${result.message}`);
  return result.config;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function hashConfig(config: BlindspotConfig): string {
  return `sha256:${createHash("sha256").update(canonicalJson(config)).digest("hex")}`;
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
  }
  return value === undefined ? "null" : JSON.stringify(value);
}
