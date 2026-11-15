// Builds the publishable CLI package from the workspace: one bundled ESM file plus
// `typescript`, which the complexity analyzer loads at runtime. Run `pnpm release:pack`;
// it builds the workspace first. The output tarball is meant to be identical for the same
// commit on any platform, so its SHA-256 is printed for comparison.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("..", import.meta.url));
const out = path.join(root, "release");
const pkgDir = path.join(out, "package");
const readJson = (file) => JSON.parse(readFileSync(path.join(root, file), "utf8"));

const PLACEHOLDER = "@your-npm-scope/blindspot";
const { name } = readJson("release.json");
const cli = readJson("packages/cli/package.json");
const typescriptRange = readJson("packages/analyzers/package.json").dependencies.typescript;
if (!typescriptRange) throw new Error("packages/analyzers no longer depends on typescript.");

const entry = path.join(root, "packages/cli/dist/bin.js");
if (!existsSync(entry)) throw new Error("Build the workspace first (pnpm build).");

rmSync(out, { recursive: true, force: true });
mkdirSync(path.join(pkgDir, "dist"), { recursive: true });

const result = await build({
  entryPoints: [entry],
  outfile: path.join(pkgDir, "dist/bin.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  external: ["typescript"],
  // Bundled CommonJS dependencies call require(); ESM output needs one in scope.
  banner: {
    js: 'import { createRequire as __createRequire } from "node:module";\nconst require = __createRequire(import.meta.url);',
  },
  legalComments: "none",
  metafile: true,
  logLevel: "warning",
});

writeFileSync(path.join(pkgDir, "THIRD_PARTY_NOTICES.md"), notices(result.metafile));

const manifest = {
  name,
  version: cli.version,
  description:
    "Map the complexity, change pressure and knowledge concentration of every file in a git repository. Runs locally.",
  keywords: ["git", "code-health", "complexity", "hotspots", "bus-factor", "cli"],
  license: "MIT",
  type: "module",
  bin: { blindspot: "dist/bin.js" },
  files: ["dist", "THIRD_PARTY_NOTICES.md", "CHANGELOG.md"],
  engines: { node: ">=24" },
  dependencies: { typescript: typescriptRange },
};
writeFileSync(path.join(pkgDir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(
  path.join(pkgDir, "README.md"),
  readFileSync(path.join(root, "packages/cli/README.md"), "utf8").replaceAll(PLACEHOLDER, name),
);
copyFileSync(path.join(root, "LICENSE"), path.join(pkgDir, "LICENSE"));
copyFileSync(path.join(root, "CHANGELOG.md"), path.join(pkgDir, "CHANGELOG.md"));

// npm keeps file modes, and Windows has no executable bit, so modes are fixed here to make
// the tarball identical on every platform. npm marks the bin file executable on install.
for (const entry of readdirSync(pkgDir, { recursive: true, withFileTypes: true })) {
  if (entry.isFile()) chmodSync(path.join(entry.parentPath, entry.name), 0o644);
}

const packed = JSON.parse(
  execFileSync(process.execPath, [npmCli(), "pack", "--json", "--pack-destination", out], {
    cwd: pkgDir,
    encoding: "utf8",
  }),
)[0];
const tarball = path.join(out, packed.filename);
const sha256 = createHash("sha256").update(readFileSync(tarball)).digest("hex");

console.log(`${packed.name}@${packed.version}`);
for (const file of packed.files) console.log(`  ${file.path} (${file.size} bytes)`);
console.log(
  `tarball: ${path.relative(root, tarball)} (${packed.size} bytes packed, ${packed.unpackedSize} unpacked)`,
);
console.log(`sha256: ${sha256}`);
if (name === PLACEHOLDER)
  console.log("note: release.json still has the placeholder name; set the npm scope before publishing.");

// Every third-party package bundled into dist/bin.js, with its license text. TypeScript is
// a dependency installed alongside, not bundled, so it ships its own license.
function notices(metafile) {
  const packages = new Map();
  for (const input of Object.keys(metafile.inputs)) {
    const file = input.replaceAll("\\", "/");
    const at = file.lastIndexOf("node_modules/");
    if (at < 0) continue;
    const [scope = "", rest = ""] = file.slice(at + "node_modules/".length).split("/");
    const pkgName = scope.startsWith("@") ? `${scope}/${rest}` : scope;
    packages.set(pkgName, path.resolve(root, file.slice(0, at + "node_modules/".length + pkgName.length)));
  }
  const sections = [...packages.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([pkgName, dir]) => {
      const meta = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
      const licenseFile = ["LICENSE", "LICENSE.md", "LICENSE.txt", "license"].find((f) =>
        existsSync(path.join(dir, f)),
      );
      if (!licenseFile) throw new Error(`${pkgName} has no license file to include.`);
      const text = readFileSync(path.join(dir, licenseFile), "utf8").replaceAll("\r\n", "\n").trim();
      return `## ${pkgName} ${meta.version} (${meta.license})\n\n\`\`\`\n${text}\n\`\`\`\n`;
    });
  return `# Third-party notices\n\nThis package bundles the following software into \`dist/bin.js\`.\n\n${sections.join("\n")}`;
}

// npm's own script, run with this Node, so no shell is involved and paths with spaces are
// passed intact. Node installers place it next to the binary (Windows) or under ../lib.
function npmCli() {
  const dir = path.dirname(process.execPath);
  const candidates = [
    path.join(dir, "node_modules/npm/bin/npm-cli.js"),
    path.join(dir, "../lib/node_modules/npm/bin/npm-cli.js"),
  ];
  const found = candidates.find((c) => existsSync(c));
  if (!found) throw new Error(`Could not find npm next to ${process.execPath}.`);
  return found;
}
