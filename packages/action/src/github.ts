import { randomBytes } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { sanitizeTerminal } from "@blindspot/report";

export type Env = Record<string, string | undefined>;

// Inputs arrive as INPUT_<NAME> with the name upper-cased and spaces replaced, hyphens
// kept, the same convention as @actions/core.
export function input(env: Env, name: string): string {
  return (env[`INPUT_${name.replaceAll(" ", "_").toUpperCase()}`] ?? "").trim();
}

// Workflow commands are read line by line, so a value with a newline (a file name, say)
// could start a new command unless %, CR and LF are encoded.
export function escapeCommandData(value: string): string {
  return value.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}

export function errorCommand(message: string): string {
  return `::error::${escapeCommandData(message)}\n`;
}

export function warningCommand(message: string): string {
  return `::warning::${escapeCommandData(message)}\n`;
}

// Multi-line output syntax with a random delimiter, so no value can end the block early
// and inject another output.
export function outputBlock(name: string, value: string): string {
  let delimiter = `ghadelimiter_${randomBytes(16).toString("hex")}`;
  while (value.includes(delimiter)) delimiter = `ghadelimiter_${randomBytes(16).toString("hex")}`;
  return `${name}<<${delimiter}\n${value}\n${delimiter}\n`;
}

export function setOutputs(env: Env, outputs: Record<string, string>): void {
  const file = env.GITHUB_OUTPUT;
  if (!file) return;
  appendFileSync(
    file,
    Object.entries(outputs)
      .map(([k, v]) => outputBlock(k, v))
      .join(""),
  );
}

export function appendSummary(env: Env, markdown: string): void {
  const file = env.GITHUB_STEP_SUMMARY;
  if (file) appendFileSync(file, markdown);
}

// Text from the repository (paths, explanations) rendered in the job summary, which
// GitHub treats as Markdown with inline HTML. Control and bidi characters are made
// visible first, then every character Markdown or HTML gives meaning to is encoded in a
// single pass, so one encoding never re-escapes another.
export function markdownText(value: string): string {
  return sanitizeTerminal(value).replace(/[&<>"'\\`*_{}[\]()#+\-.!|~]/g, (c) => `&#${c.charCodeAt(0)};`);
}

export interface PullRequestBase {
  number: number;
  baseSha: string;
}

const COMMIT = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

export function pullRequestBase(env: Env): PullRequestBase | null {
  if (env.GITHUB_EVENT_NAME !== "pull_request" && env.GITHUB_EVENT_NAME !== "pull_request_target")
    return null;
  if (!env.GITHUB_EVENT_PATH) return null;
  const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, "utf8")) as {
    pull_request?: { number?: unknown; base?: { sha?: unknown } };
  };
  const sha = event.pull_request?.base?.sha;
  const number = event.pull_request?.number;
  if (typeof sha !== "string" || !COMMIT.test(sha) || typeof number !== "number") return null;
  return { number, baseSha: sha };
}
