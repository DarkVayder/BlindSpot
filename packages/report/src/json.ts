import { ANALYSIS_SCHEMA_VERSION, AnalysisResult } from "@blindspot/core";
import { z } from "zod";

export function renderJson(result: AnalysisResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

export type ParsedReport = { ok: true; result: AnalysisResult } | { ok: false; message: string };

export function parseReportJson(text: string): ParsedReport {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, message: "The report is not valid JSON." };
  }
  const version = (data as { schemaVersion?: unknown } | null)?.schemaVersion;
  if (version !== ANALYSIS_SCHEMA_VERSION) {
    return {
      ok: false,
      message: `The report uses schema version ${JSON.stringify(version ?? null)}, but this version of Blindspot reads version ${ANALYSIS_SCHEMA_VERSION}. Re-run the analysis to produce a compatible report.`,
    };
  }
  const parsed = AnalysisResult.safeParse(data);
  if (!parsed.success)
    return {
      ok: false,
      message: `The report does not match the expected format:\n${z.prettifyError(parsed.error)}`,
    };
  return { ok: true, result: parsed.data };
}

export function reportJsonSchema(): Record<string, unknown> {
  return {
    $id: `urn:blindspot:analysis-result:v${ANALYSIS_SCHEMA_VERSION}`,
    ...z.toJSONSchema(AnalysisResult, { target: "draft-2020-12" }),
  };
}
