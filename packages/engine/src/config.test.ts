import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { defaultConfig } from "@blindspot/core";
import { describe, expect, it } from "vitest";
import { tempDir } from "../../git/src/test/repo.js";
import { canonicalJson, ConfigError, hashConfig, loadConfig } from "./config.js";

function dirWith(files: Record<string, string>): string {
  const dir = tempDir();
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

function canSymlink(): boolean {
  const dir = tempDir();
  try {
    symlinkSync(path.join(dir, "missing"), path.join(dir, "probe"));
    return true;
  } catch {
    return false;
  }
}

describe("loadConfig", () => {
  it("uses defaults when no configuration exists", () => {
    expect(loadConfig(dirWith({}))).toEqual({ config: defaultConfig(), source: null, warnings: [] });
  });

  it("reads blindspot.config.json, including a UTF-8 BOM", () => {
    const dir = dirWith({
      "blindspot.config.json": String.fromCharCode(0xfeff) + '{ "critical": ["src/auth/**"] }',
    });
    const loaded = loadConfig(dir);
    expect(loaded.source).toBe("blindspot.config.json");
    expect(loaded.config.critical).toEqual(["src/auth/**"]);
  });

  it("falls back to the blindspot key in package.json", () => {
    const dir = dirWith({
      "package.json": JSON.stringify({ name: "x", blindspot: { exclude: ["legacy/**"] } }),
    });
    const loaded = loadConfig(dir);
    expect(loaded.source).toBe('package.json ("blindspot" key)');
    expect(loaded.config.exclude).toEqual(["legacy/**"]);
  });

  it("ignores a package.json without a blindspot key", () => {
    expect(loadConfig(dirWith({ "package.json": '{"name":"x"}' })).source).toBeNull();
  });

  it("warns instead of failing when package.json is not valid JSON", () => {
    const loaded = loadConfig(dirWith({ "package.json": "{ not json" }));
    expect(loaded.config).toEqual(defaultConfig());
    expect(loaded.warnings[0]).toContain("package.json could not be read as JSON");
  });

  it("never echoes file contents when JSON is invalid", () => {
    const dir = dirWith({ "blindspot.config.json": "SECRET_TOKEN_abc123 is not json" });
    expect(() => loadConfig(dir)).toThrow(new ConfigError("blindspot.config.json is not valid JSON."));
  });

  it("explains schema violations", () => {
    const dir = dirWith({ "blindspot.config.json": '{ "weigths": {} }' });
    expect(() => loadConfig(dir)).toThrow(/blindspot\.config\.json is invalid/);
  });

  it("rejects oversized configuration files", () => {
    const dir = dirWith({ "blindspot.config.json": `{"exclude":[${'"a",'.repeat(300_000)}"a"]}` });
    expect(() => loadConfig(dir)).toThrow(/larger than/);
  });

  it.skipIf(!canSymlink())("refuses a symlinked repository config", () => {
    const secrets = dirWith({ "secret.json": '{"critical":["x"]}' });
    const dir = tempDir();
    symlinkSync(path.join(secrets, "secret.json"), path.join(dir, "blindspot.config.json"));
    expect(() => loadConfig(dir)).toThrow(/symbolic link/);
  });

  it("reads an explicit config path chosen by the user", () => {
    const elsewhere = dirWith({ "custom.json": '{ "exclude": ["x/**"] }' });
    const loaded = loadConfig(tempDir(), path.join(elsewhere, "custom.json"));
    expect(loaded.config.exclude).toEqual(["x/**"]);
    expect(() => loadConfig(tempDir(), path.join(elsewhere, "missing.json"))).toThrow(/not found/);
  });
});

describe("hashConfig", () => {
  it("is stable regardless of key order and changes with content", () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe('{"a":[2,{"c":4,"d":3}],"b":1}');
    const a = defaultConfig();
    const b = defaultConfig();
    expect(hashConfig(a)).toBe(hashConfig(b));
    b.critical = ["src/**"];
    expect(hashConfig(b)).not.toBe(hashConfig(a));
    expect(hashConfig(a)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});
