import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll } from "vitest";

export interface Author {
  name: string;
  email: string;
}

export const ALICE: Author = { name: "Alice", email: "alice@example.com" };
export const BOB: Author = { name: "Bob", email: "bob@example.com" };

const created: string[] = [];
afterAll(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
});

export function tempDir(prefix = "bs-tmp-"): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  created.push(dir);
  return dir;
}

const emptyConfig = path.join(tempDir("bs-gitcfg-"), "gitconfig");
writeFileSync(emptyConfig, "");

export function testEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.toUpperCase().startsWith("GIT_")) env[k] = v;
  return { ...env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: emptyConfig, ...extra };
}

export class TestRepo {
  private constructor(readonly root: string) {}

  static create(prefix = "bs-repo-"): TestRepo {
    const root = tempDir(prefix);
    const repo = new TestRepo(root);
    repo.git("init", "-q", "-b", "main");
    repo.git("config", "core.autocrlf", "false");
    return repo;
  }

  git(...args: string[]): string {
    return execFileSync("git", args, { cwd: this.root, env: testEnv(), encoding: "utf8" });
  }

  write(file: string, content: string): this {
    const full = path.join(this.root, file);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
    return this;
  }

  lines(file: string, count: number, prefix = "line"): this {
    return this.write(file, Array.from({ length: count }, (_, i) => `${prefix} ${i}`).join("\n") + "\n");
  }

  commit(message: string, date: string, author: Author = ALICE, stage = true): string {
    if (stage) this.git("add", "-A");
    execFileSync("git", ["commit", "-q", "--allow-empty", "-m", message], {
      cwd: this.root,
      env: testEnv({
        GIT_AUTHOR_NAME: author.name,
        GIT_AUTHOR_EMAIL: author.email,
        GIT_COMMITTER_NAME: author.name,
        GIT_COMMITTER_EMAIL: author.email,
        GIT_AUTHOR_DATE: date,
        GIT_COMMITTER_DATE: date,
      }),
    });
    return this.git("rev-parse", "HEAD").trim();
  }

  path(...parts: string[]): string {
    return path.join(this.root, ...parts);
  }

  cleanup(): void {
    rmSync(this.root, { recursive: true, force: true, maxRetries: 3 });
  }
}
