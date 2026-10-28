import { lstatSync, writeFileSync } from "node:fs";
import path from "node:path";
import { compareResults, configJsonSchema, type Comparison } from "@blindspot/core";
import { analyzeRepository, CONFIG_FILE, loadConfig, resolveRepositoryRoot } from "@blindspot/engine";
import {
  DEFAULT_HTML_MAX_FILES,
  renderComparison,
  renderHtml,
  renderJson,
  renderTerminal,
  reportJsonSchema,
} from "@blindspot/report";
import { readReport, writeOutput } from "./files.js";
import { evaluateGate, parseFailOn, type FailOn, type GateResult } from "./gate.js";
import { CliError, EXIT, terminalWidth, useColor, writeLine, type CliIO, type ExitCode } from "./io.js";

export interface AnalyzeFlags {
  config?: string;
  json?: string;
  html?: string;
  baseline?: string;
  failOn?: FailOn;
  top: number;
  maxHtmlFiles: number;
  color: boolean;
  quiet: boolean;
  verbose: boolean;
}

export async function analyzeCommand(
  io: CliIO,
  toolVersion: string,
  target: string,
  flags: AnalyzeFlags,
): Promise<ExitCode> {
  const verbose = (message: string) => {
    if (flags.verbose) writeLine(io.stderr, `[blindspot] ${message}`);
  };
  const started = performance.now();
  if (flags.failOn && parseFailOn(flags.failOn).onlyNew && !flags.baseline) {
    throw new CliError(
      EXIT.usage,
      `--fail-on ${flags.failOn} needs a baseline. Pass --baseline <report.json>.`,
    );
  }
  const baseline = flags.baseline ? readReport(io, flags.baseline, "Baseline report") : null;

  const root = await resolveRepositoryRoot(path.resolve(io.cwd, target));
  const configPath = flags.config === undefined ? undefined : path.resolve(io.cwd, flags.config);
  const loaded = loadConfig(root, configPath);
  verbose(`repository: ${root}`);
  verbose(`configuration: ${loaded.source ?? "defaults"}`);

  const result = await analyzeRepository(root, {
    config: loaded.config,
    toolVersion,
    extraWarnings: loaded.warnings,
  });
  verbose(
    `analyzed ${result.coverage.analyzedFiles} of ${result.coverage.trackedFiles} files and ${result.coverage.commitsRead} commits in ${Math.round(performance.now() - started)} ms`,
  );

  const jsonToStdout = flags.json === "-";
  if (flags.json !== undefined) verbose(`JSON report: ${writeOutput(io, flags.json, renderJson(result))}`);
  if (flags.html !== undefined) {
    if (flags.html === "-")
      throw new CliError(EXIT.usage, "--html needs a file path; it cannot write to standard output.");
    verbose(
      `HTML report: ${writeOutput(io, flags.html, renderHtml(result, { maxFiles: flags.maxHtmlFiles }))}`,
    );
  }

  const comparison = baseline ? compareResults(baseline, result) : null;
  const summaryStream = jsonToStdout ? io.stderr : io.stdout;
  const color = useColor(io, summaryStream, !flags.color);
  const width = terminalWidth(summaryStream);
  if (!flags.quiet) {
    summaryStream.write(renderTerminal(result, { color, width, limit: flags.top }));
    if (comparison) {
      const highlight = flags.failOn ? parseFailOn(flags.failOn).band : "elevated";
      summaryStream.write(`\n${renderComparison(comparison, { color, width, highlight, limit: flags.top })}`);
    }
  }

  if (!flags.failOn) return EXIT.ok;
  return reportGate(io, flags.failOn, evaluateGate(flags.failOn, result, comparison));
}

export interface CompareFlags {
  json: boolean;
  failOn?: FailOn;
  color: boolean;
}

export function compareCommand(
  io: CliIO,
  baselinePath: string,
  currentPath: string,
  flags: CompareFlags,
): ExitCode {
  const baseline = readReport(io, baselinePath, "Baseline report");
  const current = readReport(io, currentPath, "Current report");
  const comparison: Comparison = compareResults(baseline, current);
  if (flags.json) {
    io.stdout.write(`${JSON.stringify(comparison, null, 2)}\n`);
  } else {
    const highlight = flags.failOn ? parseFailOn(flags.failOn).band : "elevated";
    io.stdout.write(
      renderComparison(comparison, {
        color: useColor(io, io.stdout, !flags.color),
        width: terminalWidth(io.stdout),
        highlight,
      }),
    );
  }
  if (!flags.failOn) return EXIT.ok;
  if (!parseFailOn(flags.failOn).onlyNew) {
    throw new CliError(
      EXIT.usage,
      `compare only supports new-* thresholds; use --fail-on new-${flags.failOn}.`,
    );
  }
  return reportGate(io, flags.failOn, evaluateGate(flags.failOn, current, comparison));
}

function reportGate(io: CliIO, failOn: FailOn, gate: GateResult): ExitCode {
  if (!gate.failed) return EXIT.ok;
  writeLine(
    io.stderr,
    `Blindspot: ${gate.offenders.length} file(s) ${gate.description} (--fail-on ${failOn}):`,
  );
  for (const o of gate.offenders.slice(0, 20)) {
    writeLine(io.stderr, `  ${o.score === null ? "  n/a" : o.score.toFixed(1).padStart(5)}  ${o.path}`);
  }
  if (gate.offenders.length > 20) writeLine(io.stderr, `  … ${gate.offenders.length - 20} more.`);
  return EXIT.riskThreshold;
}

export const STARTER_CONFIG = {
  exclude: [] as string[],
  critical: [] as string[],
};

export async function initCommand(io: CliIO, target: string, force: boolean): Promise<ExitCode> {
  const root = await resolveRepositoryRoot(path.resolve(io.cwd, target));
  const file = path.join(root, CONFIG_FILE);
  const existing = lstatSync(file, { throwIfNoEntry: false });
  if (existing?.isSymbolicLink()) {
    throw new CliError(EXIT.usage, `${CONFIG_FILE} is a symbolic link; refusing to write through it.`);
  }
  if (existing && !force) {
    throw new CliError(EXIT.usage, `${CONFIG_FILE} already exists. Use --force to replace it.`);
  }
  try {
    writeFileSync(file, `${JSON.stringify(STARTER_CONFIG, null, 2)}\n`, { flag: force ? "w" : "wx" });
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String(error.code) : "unknown error";
    throw new CliError(EXIT.usage, `Could not create ${CONFIG_FILE}: ${code}.`);
  }
  writeLine(io.stdout, `Created ${file}`);
  writeLine(
    io.stdout,
    'Next: list paths where mistakes are costly under "critical" (for example "src/auth/**"), and code you do not maintain under "exclude". Run `blindspot schema config` for every option.',
  );
  return EXIT.ok;
}

export function schemaCommand(io: CliIO, kind: string): ExitCode {
  if (kind !== "config" && kind !== "report") {
    throw new CliError(EXIT.usage, `Unknown schema "${kind}". Use "config" or "report".`);
  }
  const schema = kind === "config" ? configJsonSchema() : reportJsonSchema();
  io.stdout.write(`${JSON.stringify(schema, null, 2)}\n`);
  return EXIT.ok;
}

export const DEFAULT_TOP = 15;
export { DEFAULT_HTML_MAX_FILES };
