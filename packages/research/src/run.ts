import { writeFileSync } from "node:fs";
import path from "node:path";
import { Command, CommanderError, InvalidArgumentError } from "commander";
import { GitError } from "@blindspot/git";
import { DatasetError, loadDataset, serializeDataset, type DatasetRepository } from "./dataset.js";
import { fetchRepository, repositoryDir } from "./fetch.js";
import { pinRepository } from "./pin.js";

export interface ResearchIO {
  stdout: { write(chunk: string): unknown };
  stderr: { write(chunk: string): unknown };
  cwd: string;
}

export const EXIT = { ok: 0, usage: 2, git: 3, internal: 4 } as const;
type ExitCode = (typeof EXIT)[keyof typeof EXIT];

const DEFAULT_DATASET = "research/datasets/v1.json";
const DEFAULT_CACHE = "research/cache";

interface CommonFlags {
  dataset: string;
  cache: string;
  only?: string[];
  timeoutMinutes: number;
}

function positiveInt(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new InvalidArgumentError("Expected a positive whole number.");
  return n;
}

function selected(repositories: DatasetRepository[], only: string[] | undefined): DatasetRepository[] {
  if (!only) return repositories;
  const unknown = only.filter((id) => !repositories.some((r) => r.id === id));
  if (unknown.length > 0) throw new DatasetError(`Unknown repository id(s): ${unknown.join(", ")}.`);
  return repositories.filter((r) => only.includes(r.id));
}

export async function run(argv: readonly string[], io: ResearchIO): Promise<ExitCode> {
  const log = (message: string) => io.stderr.write(`${message}\n`);
  const resolve = (p: string) => path.resolve(io.cwd, p);

  const program = new Command()
    .name("blindspot-research")
    .description("Reproducible validation of the Blindspot score. See docs/research-protocol.md.")
    .configureOutput({ writeOut: (s) => io.stdout.write(s), writeErr: (s) => io.stderr.write(s) })
    .exitOverride()
    .showHelpAfterError("(run with --help for usage)");

  const common = (command: Command) =>
    command
      .option("--dataset <file>", "dataset file", DEFAULT_DATASET)
      .option("--cache <dir>", "directory for repository clones", DEFAULT_CACHE)
      .option("--only <ids...>", "limit to these repository ids")
      .option("--timeout-minutes <n>", "time limit for each git command", positiveInt, 30);

  common(
    program
      .command("fetch")
      .description("clone every dataset repository over HTTPS, without a checkout")
      .option("--update", "also fetch new commits into existing clones", false),
  ).action(async (flags: CommonFlags & { update: boolean }) => {
    const { dataset } = loadDataset(resolve(flags.dataset));
    for (const repo of selected(dataset.repositories, flags.only)) {
      await fetchRepository(repo, {
        cacheRoot: resolve(flags.cache),
        timeoutMs: flags.timeoutMinutes * 60_000,
        attempts: 3,
        retryDelayMs: 5_000,
        update: flags.update,
        log,
      });
    }
    log("Fetch complete.");
  });

  common(
    program
      .command("pin")
      .description("resolve the snapshot dates to commits and record them in the dataset")
      .option("--force", "re-pin repositories that already have pinned snapshots", false),
  ).action(async (flags: CommonFlags & { force: boolean }) => {
    const file = resolve(flags.dataset);
    const { dataset } = loadDataset(file);
    const targets = new Set(selected(dataset.repositories, flags.only).map((r) => r.id));
    const repositories: DatasetRepository[] = [];
    for (const repo of dataset.repositories) {
      const pinned = Object.keys(repo.snapshots).length > 0;
      if (!targets.has(repo.id) || (pinned && !flags.force)) {
        if (targets.has(repo.id)) log(`${repo.id}: already pinned (use --force to re-pin)`);
        repositories.push(repo);
        continue;
      }
      const dir = repositoryDir(resolve(flags.cache), repo);
      const next = await pinRepository(dir, dataset, repo, flags.timeoutMinutes * 60_000);
      for (const [id, s] of Object.entries(next.snapshots)) {
        log(
          `${repo.id} ${id}: ${s.commit.slice(0, 12)} (${s.committedAt.slice(0, 10)}) -> ${s.end.slice(0, 12)} ` +
            `(${s.endCommittedAt.slice(0, 10)}) · ${s.commitsInWindow} commits in window · ${s.trackedFiles} files`,
        );
      }
      repositories.push(next);
    }
    writeFileSync(file, serializeDataset({ ...dataset, repositories }));
    log(`Updated ${flags.dataset}.`);
  });

  try {
    await program.parseAsync(argv, { from: "user" });
    return EXIT.ok;
  } catch (error) {
    if (error instanceof CommanderError) return error.exitCode === 0 ? EXIT.ok : EXIT.usage;
    if (error instanceof DatasetError) {
      log(`Dataset error: ${error.message}`);
      return EXIT.usage;
    }
    if (error instanceof GitError) {
      log(`Error: ${error.message}`);
      return EXIT.git;
    }
    log(`Internal error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    return EXIT.internal;
  }
}
