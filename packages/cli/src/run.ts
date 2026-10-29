import { readFileSync } from "node:fs";
import { Command, CommanderError, InvalidArgumentError, Option } from "commander";
import { ConfigError, GitError } from "@blindspot/engine";
import {
  analyzeCommand,
  compareCommand,
  DEFAULT_HTML_MAX_FILES,
  DEFAULT_TOP,
  initCommand,
  schemaCommand,
  type AnalyzeFlags,
} from "./commands.js";
import { FAIL_ON_CHOICES, type FailOn } from "./gate.js";
import { CliError, EXIT, writeLine, type CliIO, type ExitCode } from "./io.js";

export const EXIT_CODE_HELP = `
Exit codes:
  0  Analysis completed and no --fail-on threshold was reached
  1  A --fail-on threshold was reached
  2  Usage or configuration error (bad option, invalid config, unreadable baseline)
  3  The repository could not be analyzed (not a git repository, git missing or too old)
  4  Internal error (please report it; re-run with --verbose for details)`;

export function toolVersion(): string {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    version?: unknown;
  };
  return typeof pkg.version === "string" ? pkg.version : "0.0.0";
}

function positiveInt(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new InvalidArgumentError("Expected a positive whole number.");
  return n;
}

function failOnOption(): Option {
  return new Option("--fail-on <threshold>", "exit with code 1 when ranked files reach this band").choices(
    FAIL_ON_CHOICES,
  );
}

export async function run(argv: readonly string[], io: CliIO): Promise<ExitCode> {
  const version = toolVersion();
  let exitCode: ExitCode = EXIT.ok;

  const program = new Command()
    .name("blindspot")
    .description(
      "Map the complexity, change pressure and knowledge concentration of every file in a git repository. Runs locally; source code never leaves your machine.",
    )
    .version(version, "-V, --version")
    .configureOutput({ writeOut: (s) => io.stdout.write(s), writeErr: (s) => io.stderr.write(s) })
    .exitOverride()
    .showHelpAfterError("(run with --help for usage)")
    .addHelpText("after", EXIT_CODE_HELP);

  program
    .command("analyze", { isDefault: true })
    .description("analyze a repository and print a summary")
    .argument("[path]", "repository or any directory inside it", ".")
    .option(
      "-c, --config <file>",
      "configuration file (default: blindspot.config.json at the repository root)",
    )
    .option("--json <file>", 'write the full JSON report ("-" for standard output)')
    .option("--html <file>", "write a standalone HTML report")
    .option("--baseline <file>", "compare with an earlier JSON report")
    .addOption(failOnOption())
    .option("--top <n>", "files to list in the summary", positiveInt, DEFAULT_TOP)
    .option(
      "--max-html-files <n>",
      "files to include in the HTML report",
      positiveInt,
      DEFAULT_HTML_MAX_FILES,
    )
    .option("--no-color", "disable colored output")
    .option("-q, --quiet", "do not print the summary", false)
    .option("-v, --verbose", "print diagnostics to standard error", false)
    .addHelpText("after", EXIT_CODE_HELP)
    .action(async (target: string, flags: AnalyzeFlags) => {
      exitCode = await analyzeCommand(io, version, target, flags);
    });

  program
    .command("compare")
    .description("compare two JSON reports")
    .argument("<baseline>", "earlier JSON report")
    .argument("<current>", "later JSON report")
    .option("--json", "print the comparison as JSON", false)
    .addOption(failOnOption())
    .option("--no-color", "disable colored output")
    .addHelpText("after", EXIT_CODE_HELP)
    .action(
      (baseline: string, current: string, flags: { json: boolean; failOn?: FailOn; color: boolean }) => {
        exitCode = compareCommand(io, baseline, current, flags);
      },
    );

  program
    .command("init")
    .description("create a starter blindspot.config.json at the repository root")
    .argument("[path]", "repository or any directory inside it", ".")
    .option("-f, --force", "replace an existing configuration file", false)
    .action(async (target: string, flags: { force: boolean }) => {
      exitCode = await initCommand(io, target, flags.force);
    });

  program
    .command("schema")
    .description("print the JSON Schema for the configuration file or the JSON report")
    .argument("<kind>", '"config" or "report"')
    .action((kind: string) => {
      exitCode = schemaCommand(io, kind);
    });

  try {
    await program.parseAsync(argv, { from: "user" });
    return exitCode;
  } catch (error) {
    return handleError(io, error, argv.includes("--verbose") || argv.includes("-v"));
  }
}

function handleError(io: CliIO, error: unknown, verbose: boolean): ExitCode {
  if (error instanceof CommanderError) {
    if (
      error.code === "commander.helpDisplayed" ||
      error.code === "commander.version" ||
      error.exitCode === 0
    ) {
      return EXIT.ok;
    }
    return EXIT.usage;
  }
  if (error instanceof CliError) {
    writeLine(io.stderr, `Error: ${error.message}`);
    return error.exitCode;
  }
  if (error instanceof ConfigError) {
    writeLine(io.stderr, `Configuration error: ${error.message}`);
    return EXIT.usage;
  }
  if (error instanceof GitError) {
    writeLine(io.stderr, `Error: ${error.message}`);
    if (verbose && error.stderr) writeLine(io.stderr, error.stderr);
    return error.code === "path_not_found" ? EXIT.usage : EXIT.analysis;
  }
  const message = error instanceof Error ? error.message : String(error);
  writeLine(io.stderr, `Internal error: ${message}`);
  if (verbose && error instanceof Error && error.stack) writeLine(io.stderr, error.stack);
  else writeLine(io.stderr, "Re-run with --verbose for details.");
  return EXIT.internal;
}
