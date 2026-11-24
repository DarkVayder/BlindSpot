import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { evaluateGate, FAIL_ON_CHOICES, type FailOn, type GateResult } from "@blindspot/cli";
import {
  atOrAbove,
  compareResults,
  newlyAtOrAbove,
  type AnalysisResult,
  type Comparison,
} from "@blindspot/core";
import { analyzeRepository, loadConfig, resolveRepositoryRoot } from "@blindspot/engine";
import { GitError, runGit } from "@blindspot/git";
import { renderHtml, renderJson } from "@blindspot/report";
import {
  appendSummary,
  errorCommand,
  input,
  pullRequestBase,
  setOutputs,
  warningCommand,
  type Env,
} from "./github.js";
import { renderSummary } from "./summary.js";

export interface ActionIO {
  stdout: { write(chunk: string): unknown };
}

const COMMIT = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
const GIT_TIMEOUT_MS = 60_000;

export function toolVersion(): string {
  const pkg = JSON.parse(readFileSync(new URL("../../cli/package.json", import.meta.url), "utf8")) as {
    version?: unknown;
  };
  return typeof pkg.version === "string" ? pkg.version : "0.0.0";
}

class InputError extends Error {}

function readInputs(env: Env) {
  const failOnText = input(env, "fail-on");
  if (failOnText !== "" && !(FAIL_ON_CHOICES as readonly string[]).includes(failOnText)) {
    throw new InputError(
      `fail-on must be empty or one of: ${FAIL_ON_CHOICES.join(", ")}. Got "${failOnText}".`,
    );
  }
  const topText = input(env, "top") || "10";
  const top = Number(topText);
  if (!Number.isInteger(top) || top < 1 || top > 100) {
    throw new InputError(`top must be a whole number from 1 to 100. Got "${topText}".`);
  }
  const workspace = env.GITHUB_WORKSPACE ?? process.cwd();
  return {
    target: path.resolve(workspace, input(env, "path") || "."),
    config: input(env, "config"),
    failOn: failOnText === "" ? null : (failOnText as FailOn),
    top,
    reportDir: path.resolve(workspace, input(env, "report-dir") || "blindspot-report"),
    reportDirLabel: input(env, "report-dir") || "blindspot-report",
    workspace,
  };
}

// The comparison point for a pull request is where it branched from its base, so changes
// that landed on the base branch meanwhile are not attributed to the pull request.
async function comparisonBase(
  root: string,
  env: Env,
): Promise<{ commit: string | null; skipped: string | null }> {
  const pr = pullRequestBase(env);
  if (!pr) return { commit: null, skipped: null };
  try {
    const mergeBase = (
      await runGit(["merge-base", "--end-of-options", pr.baseSha, "HEAD"], {
        cwd: root,
        timeoutMs: GIT_TIMEOUT_MS,
      })
    ).trim();
    if (!COMMIT.test(mergeBase)) throw new GitError("failed", "Unexpected merge-base output.");
    return { commit: mergeBase, skipped: null };
  } catch (error) {
    if (!(error instanceof GitError)) throw error;
    return {
      commit: null,
      skipped:
        "Could not find the pull request's base commit in this checkout, so nothing was compared. Check out full history with fetch-depth: 0.",
    };
  }
}

export async function runAction(env: Env, io: ActionIO): Promise<number> {
  try {
    const inputs = readInputs(env);
    const root = await resolveRepositoryRoot(inputs.target);
    const { config, warnings: configWarnings } = loadConfig(
      root,
      inputs.config === "" ? undefined : inputs.config,
    );
    const version = toolVersion();
    const result = await analyzeRepository(root, {
      config,
      toolVersion: version,
      extraWarnings: configWarnings,
    });

    const base = await comparisonBase(root, env);
    let comparison: Comparison | null = null;
    let skipped = base.skipped;
    if (base.commit && result.repository.shallow) {
      skipped = "This is a shallow clone, so the pull request's base was not analyzed. Use fetch-depth: 0.";
    } else if (base.commit) {
      const before: AnalysisResult = await analyzeRepository(root, {
        config,
        toolVersion: version,
        revision: base.commit,
        mailmapRevision: base.commit,
      });
      comparison = compareResults(before, result);
    }

    let gate: { failOn: string; result: GateResult } | null = null;
    if (inputs.failOn) {
      if (inputs.failOn.startsWith("new-") && !comparison) {
        const why = "the run has no pull request base to compare with";
        io.stdout.write(warningCommand(`fail-on ${inputs.failOn} was not checked because ${why}.`));
        skipped ??= `fail-on ${inputs.failOn} was not checked because ${why}.`;
      } else {
        gate = { failOn: inputs.failOn, result: evaluateGate(inputs.failOn, result, comparison) };
      }
    }

    mkdirSync(inputs.reportDir, { recursive: true });
    const jsonPath = path.join(inputs.reportDir, "blindspot.json");
    const htmlPath = path.join(inputs.reportDir, "blindspot.html");
    writeFileSync(jsonPath, renderJson(result));
    writeFileSync(htmlPath, renderHtml(result));

    appendSummary(
      env,
      renderSummary({
        result,
        comparison,
        baseCommit: base.commit,
        comparisonSkipped: skipped,
        highlight: "elevated",
        gate,
        top: inputs.top,
        reportDir: inputs.reportDirLabel,
      }),
    );
    setOutputs(env, {
      "report-json": jsonPath,
      "report-html": htmlPath,
      "ranked-files": String(result.files.filter((f) => f.band !== "insufficient_evidence").length),
      "elevated-files": String(atOrAbove(result.files, "elevated").length),
      "newly-elevated-files": comparison ? String(newlyAtOrAbove(comparison, "elevated").length) : "",
      gate: gate ? (gate.result.failed ? "failed" : "passed") : "off",
    });

    if (gate?.result.failed) {
      io.stdout.write(
        errorCommand(
          `Blindspot: ${gate.result.offenders.length} file(s) ${gate.result.description} (fail-on ${gate.failOn}). See the job summary.`,
        ),
      );
      return 1;
    }
    return 0;
  } catch (error) {
    const message =
      error instanceof InputError ||
      error instanceof GitError ||
      (error instanceof Error && error.name === "ConfigError")
        ? error.message
        : `Internal error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`;
    io.stdout.write(errorCommand(`Blindspot: ${message}`));
    return 1;
  }
}
