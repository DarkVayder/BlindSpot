import { createHash } from "node:crypto";
import type { AnalysisResult, FileRisk, SignalResult } from "@blindspot/core";
import { escapeHtml as e } from "./escape.js";
import { BAND_LABEL, BAND_ORDER, bandCounts, isRanked, rankFiles } from "./order.js";

export interface HtmlOptions {
  maxFiles?: number;
}

export const DEFAULT_HTML_MAX_FILES = 2000;

export const THEME = {
  light: {
    bg: "#ffffff",
    surface: "#f6f7f9",
    text: "#1a1c1e",
    muted: "#4e5560",
    border: "#d3d7dd",
    focus: "#0b57d0",
    "high-bg": "#fde2e1",
    "high-fg": "#8a1c13",
    "elevated-bg": "#fdebd3",
    "elevated-fg": "#7a3e00",
    "moderate-bg": "#fff2bf",
    "moderate-fg": "#5c4a00",
    "low-bg": "#dcf2e3",
    "low-fg": "#1d5a32",
    "insufficient_evidence-bg": "#e9ebee",
    "insufficient_evidence-fg": "#3f454d",
  },
  dark: {
    bg: "#121417",
    surface: "#1b1e23",
    text: "#e8eaed",
    muted: "#a9b0b9",
    border: "#373c44",
    focus: "#8ab4f8",
    "high-bg": "#4a1712",
    "high-fg": "#ffb4ab",
    "elevated-bg": "#4a2c05",
    "elevated-fg": "#ffc98a",
    "moderate-bg": "#3d3300",
    "moderate-fg": "#f2dc7a",
    "low-bg": "#0f3a21",
    "low-fg": "#9fdcb3",
    "insufficient_evidence-bg": "#2a2e34",
    "insufficient_evidence-fg": "#c4c9d0",
  },
} as const;

const vars = (tokens: Record<string, string>) =>
  Object.entries(tokens)
    .map(([k, v]) => `--${k}:${v}`)
    .join(";");

const STYLE = `
:root{color-scheme:light dark;${vars(THEME.light)}}
@media (prefers-color-scheme:dark){:root{${vars(THEME.dark)}}}
*{box-sizing:border-box}
[hidden]{display:none!important}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
header,main,footer{max-width:1200px;margin:0 auto;padding:0 16px}
header{padding-top:24px}
h1{font-size:1.6rem;margin:0}
h2{font-size:1.2rem;margin:32px 0 12px}
.tagline{color:var(--muted);margin:4px 0 16px}
.meta{display:grid;grid-template-columns:max-content 1fr;gap:4px 16px;margin:0}
.meta dt{color:var(--muted)}
.meta dd{margin:0;overflow-wrap:anywhere}
.skip{position:absolute;left:-9999px}
.skip:focus{left:16px;top:8px;background:var(--bg);padding:8px;z-index:1}
:focus-visible{outline:3px solid var(--focus);outline-offset:2px}
.chip{display:inline-block;padding:1px 8px;border-radius:999px;font-size:.85rem;font-weight:600;white-space:nowrap}
${BAND_ORDER.map((b) => `.chip.${b}{background:var(--${b}-bg);color:var(--${b}-fg)}`).join("\n")}
.bands{list-style:none;padding:0;display:flex;flex-wrap:wrap;gap:8px}
.notice{border-left:4px solid var(--elevated-fg);background:var(--surface);padding:8px 12px}
.controls{display:flex;flex-wrap:wrap;gap:12px;align-items:end;margin-bottom:8px}
.controls label{display:flex;flex-direction:column;font-size:.85rem;color:var(--muted)}
input,select,button{font:inherit;color:inherit;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:4px 8px}
.table-wrap{overflow-x:auto}
table{border-collapse:collapse;width:100%}
caption{text-align:left;color:var(--muted);padding-bottom:4px}
th,td{border-bottom:1px solid var(--border);padding:6px 8px;text-align:left;vertical-align:top}
th button{border:0;padding:0;background:none;font-weight:700;cursor:pointer}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
summary{cursor:pointer}
code{font-family:ui-monospace,"Cascadia Code",Consolas,monospace;overflow-wrap:anywhere}
.detail{background:var(--surface);padding:8px 12px;margin-top:8px;border-radius:6px}
.detail h3{font-size:.95rem;margin:8px 0 4px}
.signals td,.signals th{padding:2px 6px;font-size:.85rem}
.muted{color:var(--muted)}
footer{color:var(--muted);padding-top:24px;padding-bottom:32px}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
`;

const SCRIPT = `
(() => {
  const table = document.getElementById("files-table");
  if (!table) return;
  const controls = document.getElementById("file-controls");
  const search = document.getElementById("file-search");
  const band = document.getElementById("band-filter");
  const status = document.getElementById("file-status");
  const body = table.tBodies[0];
  const rows = Array.from(body.rows);
  controls.hidden = false;
  const apply = () => {
    const query = search.value.trim().toLowerCase();
    let shown = 0;
    for (const row of rows) {
      const visible = (!query || row.dataset.path.toLowerCase().includes(query)) && (!band.value || row.dataset.band === band.value);
      row.hidden = !visible;
      if (visible) shown++;
    }
    status.textContent = shown + " of " + rows.length + " files shown";
  };
  search.addEventListener("input", apply);
  band.addEventListener("change", apply);
  for (const button of table.querySelectorAll("th button[data-sort]")) {
    button.addEventListener("click", () => {
      const key = button.dataset.sort;
      const header = button.closest("th");
      const ascending = header.getAttribute("aria-sort") === "descending";
      for (const th of table.querySelectorAll("th[aria-sort]")) th.setAttribute("aria-sort", "none");
      header.setAttribute("aria-sort", ascending ? "ascending" : "descending");
      const value = (row) => (key === "path" ? row.dataset.path : Number(row.dataset[key]));
      rows.sort((a, b) => {
        const x = value(a);
        const y = value(b);
        const order = x < y ? -1 : x > y ? 1 : Number(a.dataset.rank) - Number(b.dataset.rank);
        return ascending ? order : -order;
      });
      for (const row of rows) body.appendChild(row);
    });
  }
  apply();
})();
`;

const hash = (text: string) => `'sha256-${createHash("sha256").update(text).digest("base64")}'`;

export const REPORT_CSP = [
  "default-src 'none'",
  `style-src ${hash(STYLE)}`,
  `script-src ${hash(SCRIPT)}`,
  "img-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

export function renderHtml(result: AnalysisResult, options: HtmlOptions = {}): string {
  const maxFiles = options.maxFiles ?? DEFAULT_HTML_MAX_FILES;
  const ranked = rankFiles(result.files);
  const shown = ranked.slice(0, maxFiles);
  const counts = bandCounts(result.files);
  const c = result.coverage;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${e(REPORT_CSP)}">
<meta name="referrer" content="no-referrer">
<title>Blindspot report</title>
<style>${STYLE}</style>
</head>
<body>
<a class="skip" href="#files">Skip to files</a>
<header>
<h1>Blindspot report</h1>
<p class="tagline">Know the code. Own the risk.</p>
<dl class="meta">
<dt>Commit</dt><dd><code>${e(result.repository.headCommit ?? "none (no commits)")}</code></dd>
<dt>As of</dt><dd>${e(result.asOf ?? "n/a")}</dd>
<dt>Model</dt><dd>${e(result.modelVersion)}</dd>
<dt>Tool</dt><dd>Blindspot ${e(result.toolVersion)}</dd>
<dt>Config</dt><dd><code>${e(result.configHash)}</code></dd>
</dl>
</header>
<main>
<section aria-labelledby="summary-heading">
<h2 id="summary-heading">Summary</h2>
${c.incomplete ? `<p class="notice" role="note"><strong>Incomplete analysis.</strong> Some evidence could not be collected; see the warnings below.</p>` : ""}
<dl class="meta">
<dt>Tracked files</dt><dd>${c.trackedFiles}</dd>
<dt>Analyzed files</dt><dd>${c.analyzedFiles}</dd>
<dt>Excluded files</dt><dd>${c.excludedFiles}${excludedDetail(c.excludedByReason)}</dd>
<dt>Commits read</dt><dd>${c.commitsRead}${c.historyTruncated ? " (history truncated)" : ""}</dd>
</dl>
<h3>Files by band</h3>
<ul class="bands">
${BAND_ORDER.map((b) => `<li><span class="chip ${b}">${e(BAND_LABEL[b])}</span> ${counts[b]}</li>`).join("\n")}
</ul>
</section>
${list("warnings-heading", "Warnings", result.warnings)}
${list("notes-heading", "About these scores", result.notes)}
<section id="files" aria-labelledby="files-heading">
<h2 id="files-heading">Files</h2>
${shown.length === 0 ? `<p class="muted">No files were analyzed. Check the excluded counts above, or adjust <code>include</code>, <code>exclude</code> and <code>extensions</code> in <code>blindspot.config.json</code>.</p>` : filesTable(shown)}
${ranked.length > shown.length ? `<p class="muted">Showing ${shown.length} of ${ranked.length} files. The JSON report contains every file.</p>` : ""}
</section>
</main>
<footer>
<p>The attention index sorts files by complexity, change pressure, knowledge concentration and impact, relative to other files in this repository. In Blindspot's validation study it ranked files that later received bug fixes below file size alone, so it is not a prediction of defects. It is not a measure of code quality or of any developer.</p>
</footer>
<script>${SCRIPT}</script>
</body>
</html>
`;
}

function excludedDetail(byReason: Record<string, number>): string {
  const parts = Object.entries(byReason).map(([reason, n]) => `${n} ${e(reason.replaceAll("_", " "))}`);
  return parts.length > 0 ? ` <span class="muted">(${parts.join(", ")})</span>` : "";
}

function list(id: string, title: string, items: readonly string[]): string {
  if (items.length === 0) return "";
  return `<section aria-labelledby="${id}">
<h2 id="${id}">${e(title)}</h2>
<ul>
${items.map((i) => `<li>${e(i)}</li>`).join("\n")}
</ul>
</section>`;
}

function filesTable(files: readonly FileRisk[]): string {
  return `<div id="file-controls" class="controls" hidden>
<label>Filter by path<input id="file-search" type="search" autocomplete="off"></label>
<label>Band<select id="band-filter">
<option value="">All bands</option>
${BAND_ORDER.map((b) => `<option value="${b}">${e(BAND_LABEL[b])}</option>`).join("\n")}
</select></label>
<p id="file-status" class="muted" aria-live="polite"></p>
</div>
<div class="table-wrap">
<table id="files-table">
<caption>Files ordered by attention index. Files with insufficient evidence are listed last and are not ranked.</caption>
<thead><tr>
<th scope="col" aria-sort="none"><button type="button" data-sort="path">File</button></th>
<th scope="col" class="num" aria-sort="none"><button type="button" data-sort="score">Index</button></th>
<th scope="col">Band</th>
<th scope="col" class="num" aria-sort="none"><button type="button" data-sort="confidence">Confidence</button></th>
</tr></thead>
<tbody>
${files.map((f, i) => fileRow(f, i)).join("\n")}
</tbody>
</table>
</div>`;
}

function fileRow(f: FileRisk, rank: number): string {
  const ranked = isRanked(f);
  const score =
    ranked && f.score !== null
      ? f.score.toFixed(1)
      : `<span aria-hidden="true">—</span><span class="sr">not ranked</span>`;
  const limited = f.limitedEvidence ? ` <span class="muted">(limited evidence)</span>` : "";
  return `<tr data-path="${e(f.path)}" data-band="${f.band}" data-score="${ranked ? (f.score ?? 0) : -1}" data-confidence="${f.confidence}" data-rank="${rank}">
<td><details><summary><code>${e(f.path)}</code></summary>${fileDetail(f)}</details></td>
<td class="num">${score}</td>
<td><span class="chip ${f.band}">${e(BAND_LABEL[f.band])}</span>${limited}</td>
<td class="num">${f.confidence.toFixed(2)}</td>
</tr>`;
}

function fileDetail(f: FileRisk): string {
  const section = (title: string, items: readonly string[], empty: string) =>
    `<h3>${title}</h3>${items.length === 0 ? `<p class="muted">${empty}</p>` : `<ul>${items.map((i) => `<li>${e(i)}</li>`).join("")}</ul>`}`;
  return `<div class="detail">
<p class="muted">${e(f.language)} · impact ${f.impact.value.toFixed(2)}${f.impact.status === "neutral_fallback" ? " (unknown, neutral value used)" : ""} · ${e(f.modelVersion)}</p>
${section("Why", f.explanations, "No individual signal stands out for this file.")}
${section("Limitations", f.limitations, "No known limitations for this file.")}
${section("Suggested actions", f.actions, "No specific action is suggested.")}
<h3>Signals</h3>
<table class="signals"><thead><tr><th scope="col">Signal</th><th scope="col" class="num">Raw</th><th scope="col" class="num">Percentile</th><th scope="col">Normalized or status</th></tr></thead>
<tbody>${f.signals.map(signalRow).join("")}</tbody></table>
</div>`;
}

function signalRow(s: SignalResult): string {
  if (s.status === "observed") {
    return `<tr><td><code>${s.id}</code></td><td class="num">${s.raw}</td><td class="num">${Math.round(s.percentile * 100)}</td><td>${s.normalized.toFixed(2)}</td></tr>`;
  }
  const status = s.status === "missing" ? `missing: ${s.reason.replaceAll("_", " ")}` : "not applicable";
  return `<tr><td><code>${s.id}</code></td><td class="num">—</td><td class="num">—</td><td class="muted">${e(status)}</td></tr>`;
}
