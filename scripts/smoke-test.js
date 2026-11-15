// Checks the packed CLI the way a user gets it: installed from the tarball into an empty
// project, then run against a fresh git repository.
//
//   node scripts/smoke-test.js install <tarball> <dir>   install (needs the npm registry)
//   node scripts/smoke-test.js run <dir>                 run every check (no network needed)
//   node scripts/smoke-test.js <tarball>                 both, in a temporary directory
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const [mode, ...args] = process.argv.slice(2);
if (mode === "install") install(args[0], args[1]);
else if (mode === "run") run(args[0]);
else if (mode) {
  const dir = mkdtempSync(path.join(tmpdir(), "bs-smoke-"));
  install(mode, dir);
  run(dir);
} else {
  console.error("Usage: node scripts/smoke-test.js <tarball> | install <tarball> <dir> | run <dir>");
  process.exit(2);
}

function npmCli() {
  const dir = path.dirname(process.execPath);
  const found = [
    path.join(dir, "node_modules/npm/bin/npm-cli.js"),
    path.join(dir, "../lib/node_modules/npm/bin/npm-cli.js"),
  ].find((c) => existsSync(c));
  if (!found) throw new Error(`Could not find npm next to ${process.execPath}.`);
  return found;
}

function install(tarball, dir) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "package.json"), '{ "name": "smoke", "private": true }\n');
  execFileSync(process.execPath, [npmCli(), "install", "--no-audit", "--no-fund", path.resolve(tarball)], {
    cwd: dir,
    stdio: "inherit",
  });
  console.log(`installed ${path.basename(tarball)} into ${dir}`);
}

function run(dir) {
  const scopes = readdirSync(path.join(dir, "node_modules")).filter(
    (n) => n.startsWith("@") && n !== "@types",
  );
  const pkgDir = scopes
    .flatMap((scope) =>
      readdirSync(path.join(dir, "node_modules", scope)).map((n) => path.join(dir, "node_modules", scope, n)),
    )
    .find((p) => existsSync(path.join(p, "dist/bin.js")));
  if (!pkgDir) throw new Error("The installed CLI package was not found.");
  const manifest = JSON.parse(readFileSync(path.join(pkgDir, "package.json"), "utf8"));
  const bin = path.join(pkgDir, manifest.bin.blindspot);

  const repo = path.join(dir, "repo");
  mkdirSync(path.join(repo, "src"), { recursive: true });
  const git = (...a) => execFileSync("git", a, { cwd: repo, env: gitEnv(), stdio: "pipe", encoding: "utf8" });
  git("init", "-q", "-b", "main");
  for (let i = 1; i <= 6; i++) {
    writeFileSync(
      path.join(repo, "src/parse.ts"),
      `export function parse(s: string, strict: boolean): number {\n  let n = ${i};\n  for (const c of s) {\n    if (c === "+" && strict) n++;\n    else if (c === "-") n--;\n  }\n  return n;\n}\n`,
    );
    writeFileSync(
      path.join(repo, "src/index.ts"),
      `import { parse } from "./parse";\nexport const v = parse("${"+".repeat(i)}", true);\n`,
    );
    writeFileSync(path.join(repo, "tool.py"), `VALUE = ${i}\n`);
    git("add", "-A");
    git("commit", "-q", "-m", `change ${i}`, `--date=2026-0${i}-01T00:00:00Z`);
  }

  const checks = [];
  const cli = (argv, cwd = repo) =>
    spawnSync(process.execPath, [bin, ...argv], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1" },
    });
  const check = (label, ok, detail = "") => {
    checks.push(ok);
    console.log(`${ok ? "ok  " : "FAIL"} ${label}${ok || !detail ? "" : `\n     ${detail.slice(0, 400)}`}`);
  };

  const version = cli(["--version"]);
  check(
    `--version prints ${manifest.version}`,
    version.status === 0 && version.stdout.trim() === manifest.version,
    version.stderr,
  );

  const shim = path.join(
    dir,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "blindspot.cmd" : "blindspot",
  );
  if (process.platform === "win32") {
    check("npm created the blindspot command", existsSync(shim));
  } else {
    const viaShim = spawnSync(shim, ["--version"], { encoding: "utf8" });
    check(
      "the installed blindspot command runs",
      viaShim.status === 0 && viaShim.stdout.trim() === manifest.version,
      viaShim.stderr,
    );
  }

  const analyze = cli(["analyze", ".", "--json", "report.json", "--html", "report.html"]);
  check("analyze exits 0", analyze.status === 0, analyze.stderr);
  check(
    "summary uses the attention index wording",
    analyze.stdout.includes("Highest attention index"),
    analyze.stdout,
  );
  const report = existsSync(path.join(repo, "report.json"))
    ? JSON.parse(readFileSync(path.join(repo, "report.json"), "utf8"))
    : null;
  check(
    "JSON report has every committed file",
    report?.files?.length === 3,
    JSON.stringify(report?.coverage),
  );
  const parse = report?.files?.find((f) => f.path === "src/parse.ts");
  check(
    "TypeScript complexity is measured",
    parse?.groups?.find((g) => g.id === "complexity")?.status === "observed",
  );
  const html = existsSync(path.join(repo, "report.html"))
    ? readFileSync(path.join(repo, "report.html"), "utf8")
    : "";
  check(
    "HTML report is standalone with a CSP",
    html.includes("Content-Security-Policy") && !/\s(src|href)="https?:/.test(html),
  );

  const toStdout = cli(["analyze", ".", "--json", "-"]);
  check(
    "--json - writes clean JSON to stdout",
    toStdout.status === 0 && JSON.parse(toStdout.stdout).schemaVersion === 1,
  );

  const compare = cli(["compare", "report.json", "report.json"]);
  check("compare exits 0 on identical reports", compare.status === 0, compare.stderr);

  const init = cli(["init", "."]);
  check(
    "init writes blindspot.config.json",
    init.status === 0 && existsSync(path.join(repo, "blindspot.config.json")),
    init.stderr,
  );
  const again = cli(["init", "."]);
  check("init refuses to overwrite (exit 2)", again.status === 2);

  const schema = cli(["schema", "config"]);
  check(
    "schema config prints a JSON Schema",
    schema.status === 0 && typeof JSON.parse(schema.stdout).properties === "object",
  );

  const outside = mkdtempSync(path.join(tmpdir(), "bs-smoke-norepo-"));
  const notRepo = cli(["analyze", "."], outside);
  check("a directory that is not a repository exits 3", notRepo.status === 3, notRepo.stderr);

  const failed = checks.filter((ok) => !ok).length;
  console.log(`${checks.length - failed} of ${checks.length} smoke checks passed`);
  process.exit(failed === 0 ? 0 : 1);
}

function gitEnv() {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith("GIT_")),
  );
  return {
    ...env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: path.join(tmpdir(), "bs-smoke-no-global-gitconfig"),
    GIT_AUTHOR_NAME: "Smoke",
    GIT_AUTHOR_EMAIL: "smoke@example.com",
    GIT_COMMITTER_NAME: "Smoke",
    GIT_COMMITTER_EMAIL: "smoke@example.com",
  };
}
