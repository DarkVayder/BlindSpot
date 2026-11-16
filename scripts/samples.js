// Regenerates docs/samples: real reports for a public repository at a pinned commit, made
// with the default configuration. Needs the research clone (blindspot-research fetch
// --only ky) and a built workspace (pnpm build). Output is byte-identical on every run.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const load = (pkg) => import(pathToFileURL(path.join(root, "packages", pkg, "dist/index.js")).href);
const { defaultConfig } = await load("core");
const { analyzeRepository } = await load("engine");
const { renderHtml, renderJson } = await load("report");

const SAMPLE = {
  id: "ky",
  name: "sindresorhus/ky",
  url: "https://github.com/sindresorhus/ky",
  license: "MIT",
  commit: "4a427011ad7b4ab98bb5f02ecaa5375fba5addca",
};

const clone = path.join(root, "research/cache", SAMPLE.id);
if (!existsSync(clone)) {
  throw new Error(`${clone} is missing. Run: node packages/research/dist/bin.js fetch --only ${SAMPLE.id}`);
}
const toolVersion = JSON.parse(readFileSync(path.join(root, "packages/cli/package.json"), "utf8")).version;
const result = await analyzeRepository(clone, {
  config: defaultConfig(),
  toolVersion,
  revision: SAMPLE.commit,
  mailmapRevision: SAMPLE.commit,
});

const out = path.join(root, "docs/samples");
mkdirSync(out, { recursive: true });
writeFileSync(path.join(out, `${SAMPLE.id}.json`), renderJson(result));
writeFileSync(path.join(out, `${SAMPLE.id}.html`), renderHtml(result));
writeFileSync(
  path.join(out, "README.md"),
  `# Sample reports

These are **real** reports, not synthetic ones. They were produced by Blindspot ${toolVersion}
(model \`${result.modelVersion}\`) with the default configuration, on the public repository
[${SAMPLE.name}](${SAMPLE.url}) (${SAMPLE.license} license) at commit
[\`${SAMPLE.commit.slice(0, 12)}\`](${SAMPLE.url}/commit/${SAMPLE.commit}), dated ${result.asOf?.slice(0, 10) ?? "unknown"}.

- [${SAMPLE.id}.html](${SAMPLE.id}.html): the standalone HTML report. Download it and open it in a browser.
- [${SAMPLE.id}.json](${SAMPLE.id}.json): the full JSON report.

The attention index sorts files for review. It is not a prediction of defects
([ADR 0008](../decisions/0008-descriptive-not-predictive.md)). Regenerate these files with
\`node scripts/samples.js\`.
`,
);
console.log(
  `Wrote docs/samples for ${SAMPLE.name} at ${SAMPLE.commit.slice(0, 12)}: ${result.files.length} files.`,
);
