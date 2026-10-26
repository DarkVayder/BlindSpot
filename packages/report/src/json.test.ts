import { describe, expect, it } from "vitest";
import { parseReportJson, renderJson, reportJsonSchema } from "./json.js";
import { goldenResult, goldenText } from "./test/fixture.js";

describe("renderJson / parseReportJson", () => {
  it("round-trips an analysis result byte for byte", () => {
    const result = goldenResult();
    const text = renderJson(result);
    expect(text).toBe(goldenText());
    expect(parseReportJson(text)).toEqual({ ok: true, result });
  });

  it("rejects text that is not JSON without echoing it", () => {
    const parsed = parseReportJson("SECRET_TOKEN not json");
    expect(parsed).toEqual({ ok: false, message: "The report is not valid JSON." });
  });

  it("rejects reports from another schema version with a clear next step", () => {
    const parsed = parseReportJson(JSON.stringify({ ...goldenResult(), schemaVersion: 99 }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok)
      expect(parsed.message).toMatch(/schema version 99.*reads version 1.*Re-run the analysis/s);
    expect(parseReportJson("null").ok).toBe(false);
  });

  it("rejects reports whose content does not match the schema", () => {
    const broken = { ...goldenResult(), files: [{ path: 1 }] };
    const parsed = parseReportJson(JSON.stringify(broken));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toContain("does not match the expected format");
  });
});

describe("reportJsonSchema", () => {
  it("describes the versioned report format", () => {
    const schema = reportJsonSchema();
    expect(schema.$id).toBe("urn:blindspot:analysis-result:v1");
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(Object.keys(schema.properties ?? {})).toEqual(
      expect.arrayContaining(["schemaVersion", "modelVersion", "coverage", "files"]),
    );
  });
});
