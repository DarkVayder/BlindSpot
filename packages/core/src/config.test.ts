import { describe, expect, it } from "vitest";
import { DEFAULT_EXTENSIONS, defaultConfig, parseConfig } from "./config.js";

describe("parseConfig", () => {
  it("fills every default from an empty object", () => {
    const result = parseConfig({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.weights).toEqual({
      changePressure: 0.25,
      knowledge: 0.25,
      complexity: 0.25,
      review: 0.2,
      provenance: 0.05,
    });
    expect(result.config.windows).toEqual({ analysisDays: 365, recentDays: 90, inactiveAuthorDays: 180 });
    expect(result.config.extensions).toEqual(DEFAULT_EXTENSIONS);
    expect(result.config.impactFloor).toBe(0.6);
  });

  it("treats undefined and null as an empty config", () => {
    expect(parseConfig(undefined).ok).toBe(true);
    expect(parseConfig(null).ok).toBe(true);
  });

  it("fills omitted fields inside a partially specified section", () => {
    const result = parseConfig({ windows: { recentDays: 30 } });
    expect(result.ok && result.config.windows).toEqual({
      analysisDays: 365,
      recentDays: 30,
      inactiveAuthorDays: 180,
    });
  });

  it("rejects unknown keys at any level", () => {
    expect(parseConfig({ weigths: {} }).ok).toBe(false);
    expect(parseConfig({ weights: { churn: 0.5 } }).ok).toBe(false);
  });

  it("rejects all-zero core weights", () => {
    const result = parseConfig({
      weights: { changePressure: 0, knowledge: 0, complexity: 0, review: 0, provenance: 1 },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("At least one of");
  });

  it("rejects a recent window longer than the analysis window", () => {
    expect(parseConfig({ windows: { analysisDays: 30, recentDays: 90 } }).ok).toBe(false);
  });

  it("rejects malformed extensions", () => {
    expect(parseConfig({ extensions: ["ts"] }).ok).toBe(false);
    expect(parseConfig({ extensions: [".t/s"] }).ok).toBe(false);
  });

  it("lower-cases provenance markers", () => {
    const result = parseConfig({ provenance: { markers: ["Copilot"] } });
    expect(result.ok && result.config.provenance.markers).toEqual(["copilot"]);
  });

  it("returns a readable message on failure", () => {
    const result = parseConfig({ impactFloor: 2 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/impactFloor/);
  });
});

describe("defaultConfig", () => {
  it("returns independent copies", () => {
    const a = defaultConfig();
    const b = defaultConfig();
    a.extensions.push(".zz");
    a.windows.recentDays = 7;
    expect(b.extensions).not.toContain(".zz");
    expect(b.windows.recentDays).toBe(90);
  });
});
