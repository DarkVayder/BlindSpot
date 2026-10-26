import type { BlindspotConfig } from "../config.js";
import type { MissingReason } from "../evidence.js";
import type { GroupResult, RiskBand, SignalResult } from "../result.js";
import { SIGNALS, type GroupId, type SignalId } from "./constants.js";
import type { FileContext } from "./score.js";

const HIGHLIGHT = 0.5;

const GROUP_LABEL: Record<GroupId, string> = {
  changePressure: "Change pressure",
  knowledge: "Knowledge distribution",
  complexity: "Structural complexity",
  review: "Review evidence",
  provenance: "AI provenance",
};

const REASON_TEXT: Record<MissingReason, string> = {
  git_unavailable: "Git history was unavailable",
  shallow_history: "the repository history is truncated (shallow clone)",
  no_line_changes: "no line changes are recorded",
  no_changes_in_window: "there were no changes in the analysis window",
  language_not_supported: "this language is not supported yet",
  parse_failed: "the file could not be parsed",
  limit_exceeded: "a configured analysis limit was reached",
  not_available_locally: "review data is not available in local mode",
  not_configured: "it is not configured",
};

export interface DescribeInput {
  ctx: FileContext;
  config: BlindspotConfig;
  band: RiskBand;
  groups: readonly GroupResult[];
  signals: readonly SignalResult[];
  impact: number;
  impactObserved: boolean;
}

export interface Description {
  explanations: string[];
  limitations: string[];
  actions: string[];
}

export function describeFile(input: DescribeInput): Description {
  return {
    explanations: explanations(input),
    limitations: limitations(input),
    actions: actions(input),
  };
}

function explanations({ ctx, config, groups, signals }: DescribeInput): string[] {
  const contribution = new Map(groups.map((g) => [g.id as GroupId | "impact", g.contribution ?? 0]));
  contribution.set("impact", 0);

  const highlighted = signals
    .filter((s): s is Extract<SignalResult, { status: "observed" }> => s.status === "observed")
    .filter((s) => s.normalized >= HIGHLIGHT)
    .sort((a, b) => {
      const ca = contribution.get(SIGNALS[a.id].group) ?? 0;
      const cb = contribution.get(SIGNALS[b.id].group) ?? 0;
      if (cb !== ca) return cb - ca;
      if (b.normalized !== a.normalized) return b.normalized - a.normalized;
      return a.id < b.id ? -1 : 1;
    });

  const lines = highlighted.map(
    (s) => `${signalSentence(s.id, s.raw, config, ctx.provenanceReviewKnown)}${rankPhrase(s.percentile)}.`,
  );

  const crit = ctx.evidence.criticality;
  if (crit.status === "observed" && crit.value.critical) {
    lines.push("Matches a path configured as critical.");
  }
  return lines;
}

function signalSentence(id: SignalId, raw: number, config: BlindspotConfig, reviewKnown: boolean): string {
  const { recentDays, analysisDays, inactiveAuthorDays } = config.windows;
  switch (id) {
    case "churn_recent":
      return `Lines changed in the last ${recentDays} days equal ${raw.toFixed(1)}× the file's current size`;
    case "commits_recent":
      return `Changed in ${raw} commit${raw === 1 ? "" : "s"} in the last ${recentDays} days`;
    case "ownership_concentration":
      return `${pct(raw)} of lines changed in the last ${analysisDays} days came from a single contributor`;
    case "inactive_knowledge":
      return `${pct(raw)} of this file's historical changes were made by contributors with no commits in the last ${inactiveAuthorDays} days`;
    case "time_since_change":
      return `Not modified for ${Math.floor(raw)} days despite above-average complexity`;
    case "cyclomatic_max":
      return `Its most complex function has a cyclomatic complexity of ${raw}`;
    case "cognitive_total":
      return `Total cognitive complexity is ${raw}`;
    case "size_loc":
      return `Contains ${raw} lines of code`;
    case "unreviewed_change_share":
      return `${pct(raw)} of recent changes have no approving review on record`;
    case "ai_attributed_unreviewed_share":
      return reviewKnown
        ? `${pct(raw)} of recently changed lines come from commits with explicit AI-assistant markers and no approving review`
        : `${pct(raw)} of recently changed lines come from commits with explicit AI-assistant markers; review status is unknown`;
    case "fan_in_transitive":
      return `${raw} file${raw === 1 ? "" : "s"} depend on this file directly or indirectly`;
  }
}

function limitations({ ctx, groups, signals, impactObserved }: DescribeInput): string[] {
  const lines: string[] = [];
  for (const g of groups) {
    if (g.status !== "missing" || g.weight === 0) continue;
    const reason = firstMissingReason(g.id, signals);
    if (reason) lines.push(`${GROUP_LABEL[g.id]} not assessed: ${REASON_TEXT[reason]}.`);
  }

  if (!impactObserved) {
    const fan = signals.find((s) => s.id === "fan_in_transitive");
    const why = fan?.status === "missing" ? REASON_TEXT[fan.reason] : "it could not be determined";
    lines.push(`Dependency impact unknown (${why}); a neutral value was used.`);
  }

  const history = ctx.evidence.history;
  if (history.status === "observed" && ctx.historyFactor < 1) {
    const commits = history.value.totalCommits;
    lines.push(
      `Limited history (${commits} commit${commits === 1 ? "" : "s"}); this estimate may change as history accumulates.`,
    );
  }
  return lines;
}

function firstMissingReason(group: GroupId, signals: readonly SignalResult[]): MissingReason | undefined {
  for (const s of signals) {
    if (SIGNALS[s.id].group === group && s.status === "missing") return s.reason;
  }
  return undefined;
}

function actions({ band, groups, impact }: DescribeInput): string[] {
  if (band === "insufficient_evidence") {
    return ["Gather more history or enable the missing analyzers before acting on this estimate."];
  }
  const high = (id: GroupId) => (groups.find((g) => g.id === id)?.value ?? 0) >= HIGHLIGHT;
  const list: string[] = [];
  if (high("complexity"))
    list.push("Add or review tests around the most complex functions before changing them.");
  if (high("knowledge"))
    list.push("Involve a second contributor in the next change to spread familiarity with this file.");
  if (high("changePressure"))
    list.push("Check whether recent changes to this file have settled before building on it.");
  if (high("review")) list.push("Review the recent changes that have no approving review on record.");
  if (high("provenance")) list.push("Review the recent AI-assisted changes that have no recorded review.");
  if (impact >= HIGHLIGHT) list.push("Check dependents before changing this file's exported interfaces.");
  return list;
}

function pct(share: number): string {
  return `${Math.round(share * 100)}%`;
}

// A mid-rank percentile at or below 0.5 means the file is not above this repository's
// median (for example when every file ties), so a "top N%" rank would mislead.
function rankPhrase(percentile: number): string {
  if (percentile <= 0.5) return "";
  const top = Math.max(1, Math.round((1 - percentile) * 100));
  return ` (top ${top}% in this repository)`;
}
