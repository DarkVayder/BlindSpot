import type { AnalysisResult, RiskBand } from "@blindspot/core";
import { sanitizeTerminal } from "./escape.js";
import { BAND_LABEL, BAND_ORDER, bandCounts, isRanked, rankFiles } from "./order.js";

export interface TerminalOptions {
  color: boolean;
  width: number;
  limit?: number;
}

const ANSI: Record<RiskBand | "bold" | "dim" | "warn", string> = {
  high: "31",
  elevated: "33",
  moderate: "36",
  low: "32",
  insufficient_evidence: "90",
  bold: "1",
  dim: "2",
  warn: "33",
};

const MIN_WIDTH = 60;
const MAX_WIDTH = 160;

export function renderTerminal(result: AnalysisResult, options: TerminalOptions): string {
  const width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.floor(options.width)));
  const limit = options.limit ?? 15;
  const paint = (code: keyof typeof ANSI, text: string) =>
    options.color ? `\u001b[${ANSI[code]}m${text}\u001b[0m` : text;
  const out: string[] = [];
  const line = (text: string, indent = "") => out.push(...wrap(text, width, indent, `${indent}  `));

  const head = result.repository.headCommit?.slice(0, 12) ?? "no commits";
  const asOf = result.asOf ? result.asOf.slice(0, 10) : "n/a";
  line(`${paint("bold", "Blindspot")} · ${result.modelVersion} · commit ${head} · as of ${asOf}`);

  const c = result.coverage;
  const reasons = Object.entries(c.excludedByReason)
    .map(([reason, n]) => `${n} ${reason.replaceAll("_", " ")}`)
    .join(", ");
  line(
    `Analyzed ${c.analyzedFiles} of ${c.trackedFiles} tracked files` +
      (c.excludedFiles > 0 ? ` (${c.excludedFiles} excluded: ${reasons})` : "") +
      ` · ${c.commitsRead} commits read`,
  );
  if (c.incomplete) line(paint("warn", "Analysis is incomplete; see warnings."));

  const counts = bandCounts(result.files);
  line("Bands: " + BAND_ORDER.map((b) => `${paint(b, BAND_LABEL[b])} ${counts[b]}`).join(" · "));

  if (result.warnings.length > 0) {
    out.push("", paint("bold", "Warnings"));
    for (const w of result.warnings)
      out.push(...wrap(sanitizeTerminal(w), width, paint("warn", "  ! "), "    "));
  }

  const ranked = rankFiles(result.files).filter(isRanked);
  out.push("", paint("bold", "Highest estimated risk"));
  if (ranked.length === 0) {
    out.push("  No file has enough evidence to be ranked yet.");
  } else {
    out.push(paint("dim", "  SCORE  BAND        CONF  FILE"));
    const pathWidth = width - 28;
    for (const f of ranked.slice(0, limit)) {
      const score = (f.score ?? 0).toFixed(1).padStart(5);
      const band = BAND_LABEL[f.band].padEnd(10);
      const conf = f.confidence.toFixed(2).padEnd(4);
      const marker = f.limitedEvidence ? "*" : " ";
      out.push(
        `  ${score}  ${paint(f.band, band)}  ${conf}${marker} ${truncateMiddle(sanitizeTerminal(f.path), pathWidth)}`,
      );
      const reason = f.explanations[0];
      if (reason) out.push(paint("dim", `         ${truncateEnd(sanitizeTerminal(reason), width - 9)}`));
    }
    if (ranked.length > limit)
      line(`… ${ranked.length - limit} more ranked file(s) in the JSON and HTML reports.`, "  ");
    if (ranked.some((f) => f.limitedEvidence))
      line(paint("dim", "* limited evidence: treat this estimate with extra caution."), "  ");
  }

  const unranked = result.files.length - ranked.length;
  if (unranked > 0) line(`${unranked} file(s) have insufficient evidence and are not ranked.`, "  ");

  out.push("");
  for (const note of result.notes) {
    out.push(...wrap(sanitizeTerminal(note), width, "Note: ", "      ").map((l) => paint("dim", l)));
  }
  return `${out.join("\n")}\n`;
}

export function truncateMiddle(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max <= 1) return "…";
  const keep = max - 1;
  const head = Math.ceil(keep / 3);
  return `${text.slice(0, head)}…${text.slice(text.length - (keep - head))}`;
}

function truncateEnd(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

// eslint-disable-next-line no-control-regex -- stripping our own ANSI codes to measure width
const ANSI_CODE = /\u001b\[[0-9;]*m/g;
const visible = (text: string) => text.replace(ANSI_CODE, "").length;

function wrap(text: string, width: number, firstPrefix: string, restPrefix: string): string[] {
  const lines: string[] = [];
  let line = "";
  const available = width - Math.max(visible(firstPrefix), visible(restPrefix));
  for (const word of text.split(/ +/).filter(Boolean)) {
    if (line && visible(line) + 1 + visible(word) > available) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.map((l, i) => (i === 0 ? firstPrefix : restPrefix) + l);
}
