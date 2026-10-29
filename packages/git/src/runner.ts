import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export type GitErrorCode =
  | "git_not_found"
  | "git_too_old"
  | "path_not_found"
  | "not_a_repository"
  | "bare_repository"
  | "bad_revision"
  | "dubious_ownership"
  | "timeout"
  | "output_limit"
  | "failed";

export class GitError extends Error {
  constructor(
    readonly code: GitErrorCode,
    message: string,
    readonly stderr = "",
  ) {
    super(message);
    this.name = "GitError";
  }
}

export const MIN_GIT_VERSION = [2, 31, 0] as const;

export interface RunOptions {
  cwd: string;
  timeoutMs: number;
  maxOutputBytes?: number;
  input?: string;
  allowHttps?: boolean;
}

const STDERR_LIMIT = 64 * 1024;
const DEFAULT_OUTPUT_LIMIT = 64 * 1024 * 1024;

// A directory that never exists, so no hook can be resolved from it even if a command
// would otherwise run one.
const NO_HOOKS_DIR = path.join(tmpdir(), `blindspot-no-hooks-${randomBytes(8).toString("hex")}`);

const HARDENING_ARGS = [
  "--no-pager",
  "-c",
  "core.fsmonitor=false",
  "-c",
  `core.hooksPath=${NO_HOOKS_DIR}`,
  "-c",
  "core.quotepath=false",
  "-c",
  "diff.external=",
  "-c",
  "log.showSignature=false",
  "-c",
  "color.ui=false",
  "-c",
  "protocol.allow=never",
  "-c",
  "safe.bareRepository=explicit",
];

let cachedExecutable: string | undefined;

// Resolve git from absolute PATH entries only. On Windows, spawning a bare "git" can
// pick up git.exe from the current directory, which is the analyzed repository.
export function resolveGitExecutable(env: NodeJS.ProcessEnv = process.env): string {
  if (cachedExecutable && env === process.env) return cachedExecutable;

  const override = env.BLINDSPOT_GIT;
  if (override) {
    if (!path.isAbsolute(override) || !isFile(override)) {
      throw new GitError(
        "git_not_found",
        `BLINDSPOT_GIT must be an absolute path to git; got "${override}".`,
      );
    }
    return remember(override, env);
  }

  const names = process.platform === "win32" ? ["git.exe"] : ["git"];
  const pathVar = env.PATH ?? env.Path ?? "";
  for (const dir of pathVar.split(path.delimiter)) {
    const clean = dir.replace(/^"(.*)"$/, "$1");
    if (!clean || !path.isAbsolute(clean)) continue;
    for (const name of names) {
      const candidate = path.join(clean, name);
      if (isFile(candidate)) return remember(candidate, env);
    }
  }
  throw new GitError(
    "git_not_found",
    `git was not found on PATH. Install git ${MIN_GIT_VERSION.join(".")} or newer and try again.`,
  );
}

function remember(executable: string, env: NodeJS.ProcessEnv): string {
  if (env === process.env) cachedExecutable = executable;
  return executable;
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

export function gitEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(base)) {
    if (!key.toUpperCase().startsWith("GIT_")) env[key] = value;
  }
  env.GIT_CONFIG_NOSYSTEM = "1";
  env.GIT_TERMINAL_PROMPT = "0";
  env.GIT_OPTIONAL_LOCKS = "0";
  env.GIT_NO_REPLACE_OBJECTS = "1";
  env.LC_ALL = "C";
  env.LANGUAGE = "C";
  return env;
}

export function streamGit(
  args: readonly string[],
  options: RunOptions,
  onStdout: (chunk: Buffer) => void,
): Promise<void> {
  const executable = resolveGitExecutable();
  return new Promise((resolve, reject) => {
    const network = options.allowHttps ? ["-c", "protocol.https.allow=always"] : [];
    const child = spawn(executable, [...HARDENING_ARGS, ...network, ...args], {
      cwd: options.cwd,
      env: gitEnv(),
      shell: false,
      windowsHide: true,
      stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });

    const { stdin, stdout, stderr: stderrStream } = child;
    if (!stdout || !stderrStream) {
      child.kill();
      reject(new GitError("failed", "Could not open pipes to git."));
      return;
    }
    if (options.input !== undefined && stdin) {
      stdin.on("error", () => undefined);
      stdin.end(options.input);
    }

    let stderr = "";
    let settled = false;
    let failure: GitError | undefined;

    const fail = (error: GitError) => {
      if (failure) return;
      failure = error;
      child.kill();
    };

    const timer = setTimeout(() => {
      fail(new GitError("timeout", `git ${args[0] ?? ""} did not finish within ${options.timeoutMs} ms.`));
    }, options.timeoutMs);

    stdout.on("data", (chunk: Buffer) => {
      if (failure) return;
      try {
        onStdout(chunk);
      } catch (error) {
        fail(
          error instanceof GitError
            ? error
            : new GitError("failed", `Could not process git output: ${(error as Error).message}`),
        );
      }
    });
    stderrStream.on("data", (chunk: Buffer) => {
      if (stderr.length < STDERR_LIMIT) stderr += chunk.toString("utf8");
    });

    const finish = (error: GitError | undefined) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };

    child.on("error", (error: NodeJS.ErrnoException) => {
      finish(
        error.code === "ENOENT"
          ? new GitError("git_not_found", `Could not start git at ${executable}.`)
          : new GitError("failed", `Could not start git: ${error.message}`),
      );
    });
    child.on("close", (code) => {
      if (failure) finish(failure);
      else if (code === 0) finish(undefined);
      else finish(classifyFailure(args, code, stderr));
    });
  });
}

export async function runGit(args: readonly string[], options: RunOptions): Promise<string> {
  const limit = options.maxOutputBytes ?? DEFAULT_OUTPUT_LIMIT;
  const chunks: Buffer[] = [];
  let size = 0;
  await streamGit(args, options, (chunk) => {
    size += chunk.length;
    if (size > limit) {
      throw new GitError("output_limit", `git ${args[0] ?? ""} produced more than ${limit} bytes of output.`);
    }
    chunks.push(chunk);
  });
  return Buffer.concat(chunks).toString("utf8");
}

function classifyFailure(args: readonly string[], code: number | null, stderr: string): GitError {
  const trimmed = stderr.trim();
  if (/not a git repository/i.test(trimmed)) {
    return new GitError("not_a_repository", "This directory is not inside a git repository.", trimmed);
  }
  if (/cannot use bare repository/i.test(trimmed)) {
    return new GitError(
      "bare_repository",
      "Bare repositories are not supported. Run Blindspot in a working tree.",
      trimmed,
    );
  }
  if (/dubious ownership/i.test(trimmed)) {
    return new GitError(
      "dubious_ownership",
      "git refused to read this repository because it is owned by another user. " +
        "If you trust it, run: git config --global --add safe.directory <path>",
      trimmed,
    );
  }
  const firstLine = trimmed.split("\n")[0] ?? "";
  return new GitError(
    "failed",
    `git ${args[0] ?? ""} failed with exit code ${code ?? "unknown"}${firstLine ? `: ${firstLine}` : ""}`,
    trimmed,
  );
}

export function parseGitVersion(output: string): [number, number, number] | undefined {
  const match = /git version (\d+)\.(\d+)(?:\.(\d+))?/.exec(output);
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
}

export function isSupportedVersion(version: readonly [number, number, number]): boolean {
  for (let i = 0; i < 3; i++) {
    const have = version[i] ?? 0;
    const need = MIN_GIT_VERSION[i] ?? 0;
    if (have !== need) return have > need;
  }
  return true;
}

export async function checkGitVersion(timeoutMs: number): Promise<string> {
  const output = await runGit(["--version"], { cwd: tmpdir(), timeoutMs });
  const version = parseGitVersion(output);
  if (!version) throw new GitError("failed", `Could not read the git version from "${output.trim()}".`);
  if (!isSupportedVersion(version)) {
    throw new GitError(
      "git_too_old",
      `git ${version.join(".")} is too old. Blindspot needs git ${MIN_GIT_VERSION.join(".")} or newer.`,
    );
  }
  return version.join(".");
}
