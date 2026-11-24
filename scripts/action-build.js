// Bundles the GitHub Action into packages/action/bundle/index.mjs, which is committed
// because GitHub runs an action straight from the repository with no install step.
// Everything is bundled, including the TypeScript compiler the complexity analyzer uses.
// CI rebuilds it and fails if the committed file differs, so it always matches the source.
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { thirdPartyNotices } from "./notices.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const entry = path.join(root, "packages/action/dist/index.js");
if (!existsSync(entry)) throw new Error("Build the workspace first (pnpm build).");

const outDir = path.join(root, "packages/action/bundle");
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const result = await build({
  entryPoints: [entry],
  outfile: path.join(outDir, "index.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  // Bundled CommonJS code (TypeScript, commander) uses require, __filename and __dirname,
  // which an ES module does not define.
  banner: {
    js: [
      'import { createRequire as __createRequire } from "node:module";',
      'import { fileURLToPath as __fileURLToPath } from "node:url";',
      'import { dirname as __pathDirname } from "node:path";',
      "const require = __createRequire(import.meta.url);",
      "const __filename = __fileURLToPath(import.meta.url);",
      "const __dirname = __pathDirname(__filename);",
    ].join("\n"),
  },
  minifyWhitespace: true,
  minifySyntax: true,
  legalComments: "eof",
  metafile: true,
  logLevel: "warning",
});

writeFileSync(
  path.join(outDir, "THIRD_PARTY_NOTICES.md"),
  thirdPartyNotices(result.metafile, root, "packages/action/bundle/index.mjs"),
);

const bytes = Object.values(result.metafile.outputs).reduce((n, o) => n + o.bytes, 0);
console.log(`packages/action/bundle/index.mjs: ${(bytes / 1024 / 1024).toFixed(1)} MB`);
