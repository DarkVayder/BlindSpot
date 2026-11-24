import { newlyAtOrAbove, type AnalysisResult, type Comparison, type RankedBand } from "@blindspot/core";
import type { GateResult } from "@blindspot/cli";
import { BAND_LABEL, BAND_ORDER, bandCounts, isRanked, rankFiles } from "@blindspot/report";
import { markdownText } from "./github.js";

export interface SummaryInput {
  result: AnalysisResult;
  comparison: Comparison | null;
  baseCommit: string | null;
  comparisonSkipped: string | null;
  highlight: RankedBand;
  gate: { failOn: string; result: GateResult } | null;
  top: number;
  reportDir: string;
}

const short = (sha: string | null) => (sha ? sha.slice(0, 12) : "none");
const index = (score: number | null) => (score === null ? "–" : score.toFixed(1));

export function renderSummary(input: SummaryInput): string {
  const { result, comparison } = input;
  const c = result.coverage;
  const counts = bandCounts(result.files);
  const out: string[] = [];

  out.push("## Blindspot", "");
  out.push(
    `Analyzed ${c.analyzedFiles} of ${c.trackedFiles} tracked files at \`${short(result.repository.headCommit)}\` · ${c.commitsRead} commits read.`,
    "",
    `**Bands:** ${BAND_ORDER.map((b) => `${BAND_LABEL[b]} ${counts[b]}`).join(" · ")}`,
    "",
  );
  for (const w of result.warnings) out.push(`> [!WARNING]`, `> ${markdownText(w)}`, "");

  if (input.gate) {
    const g = input.gate.result;
    out.push(
      g.failed
        ? `**Gate \`${input.gate.failOn}\` failed:** ${g.offenders.length} file(s) ${markdownText(g.description)}.`
        : `**Gate \`${input.gate.failOn}\` passed:** no file is ${markdownText(g.description)}.`,
      "",
    );
  }

  if (comparison) {
    const risen = newlyAtOrAbove(comparison, input.highlight);
    const label = BAND_LABEL[input.highlight].toLowerCase();
    out.push(`### Compared with the pull request's base (\`${short(input.baseCommit)}\`)`, "");
    out.push(
      `${comparison.summary.worsened} file(s) moved to a higher band, ${comparison.summary.improved} to a lower band, ${comparison.summary.new} new.`,
      "",
    );
    if (risen.length === 0) {
      out.push(`No file is newly at or above ${label}.`, "");
    } else {
      out.push(
        `Newly at or above ${label}:`,
        "",
        "| Index | Band | Before | File |",
        "| ---: | --- | --- | --- |",
      );
      for (const d of risen.slice(0, input.top)) {
        if (!d.after) continue;
        const before = d.before ? BAND_LABEL[d.before.band] : "new file";
        out.push(
          `| ${index(d.after.score)} | ${BAND_LABEL[d.after.band]} | ${before} | <code>${markdownText(d.path)}</code> |`,
        );
      }
      if (risen.length > input.top)
        out.push("", `… and ${risen.length - input.top} more in the JSON report.`);
      out.push("");
    }
  } else if (input.comparisonSkipped) {
    out.push(`> [!NOTE]`, `> ${markdownText(input.comparisonSkipped)}`, "");
  }

  const ranked = rankFiles(result.files).filter(isRanked);
  out.push(`### Highest attention index`, "");
  if (ranked.length === 0) {
    out.push("No file has enough evidence to be ranked yet.", "");
  } else {
    out.push("| Index | Band | Confidence | File | Main reason |", "| ---: | --- | ---: | --- | --- |");
    for (const f of ranked.slice(0, input.top)) {
      const reason = f.explanations[0] ?? "";
      out.push(
        `| ${index(f.score)} | ${BAND_LABEL[f.band]} | ${f.confidence.toFixed(2)}${f.limitedEvidence ? "*" : ""} | <code>${markdownText(f.path)}</code> | ${markdownText(reason)} |`,
      );
    }
    if (ranked.some((f, i) => i < input.top && f.limitedEvidence)) out.push("", "\\* limited evidence");
    out.push("");
  }

  out.push(
    `The attention index sorts files for review. It is not a prediction of defects. Full reports: <code>${markdownText(input.reportDir)}</code> (JSON and HTML).`,
    "",
  );
  return `${out.join("\n")}\n`;
}
