import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { AnalysisResult } from "@blindspot/core";
import { parseReportJson } from "@blindspot/report";
import { CliError, EXIT, type CliIO } from "./io.js";

const MAX_REPORT_BYTES = 512 * 1024 * 1024;

export function writeOutput(io: CliIO, target: string, content: string): string {
  if (target === "-") {
    io.stdout.write(content);
    return "standard output";
  }
  const file = path.resolve(io.cwd, target);
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  } catch (error) {
    throw new CliError(EXIT.usage, `Could not write ${target}: ${errorCode(error)}.`);
  }
  return file;
}

export function readReport(io: CliIO, target: string, label: string): AnalysisResult {
  const file = path.resolve(io.cwd, target);
  const stat = statSync(file, { throwIfNoEntry: false });
  if (!stat?.isFile()) throw new CliError(EXIT.usage, `${label} not found: ${target}`);
  if (stat.size > MAX_REPORT_BYTES)
    throw new CliError(EXIT.usage, `${label} is too large to read: ${target}`);
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    throw new CliError(EXIT.usage, `Could not read ${target}: ${errorCode(error)}.`);
  }
  const parsed = parseReportJson(text);
  if (!parsed.ok) throw new CliError(EXIT.usage, `${label} ${target} is not usable. ${parsed.message}`);
  return parsed.result;
}

function errorCode(error: unknown): string {
  return error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : "unknown error";
}
