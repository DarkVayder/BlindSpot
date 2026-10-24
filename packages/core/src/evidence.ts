import { z } from "zod";

export const MissingReason = z.enum([
  "git_unavailable",
  "shallow_history",
  "no_line_changes",
  "no_changes_in_window",
  "language_not_supported",
  "parse_failed",
  "limit_exceeded",
  "not_available_locally",
  "not_configured",
]);
export type MissingReason = z.infer<typeof MissingReason>;

export const Missing = z.object({
  status: z.literal("missing"),
  reason: MissingReason,
  detail: z.string().optional(),
});
export type Missing = z.infer<typeof Missing>;

export function evidence<T extends z.ZodType>(value: T) {
  return z.discriminatedUnion("status", [z.object({ status: z.literal("observed"), value }), Missing]);
}

const count = z.number().int().nonnegative();
const isoTimestamp = z.iso.datetime({ offset: true });

export const HistoryEvidence = z
  .object({
    firstCommitAt: isoTimestamp,
    lastCommitAt: isoTimestamp,
    totalCommits: count.min(1),
    commitsRecent: count,
    linesChangedRecent: count,
    churnByAuthorInWindow: z.array(count),
    historicalChurn: count,
    inactiveAuthorHistoricalChurn: count,
  })
  .refine((h) => h.inactiveAuthorHistoricalChurn <= h.historicalChurn, {
    message: "inactiveAuthorHistoricalChurn cannot exceed historicalChurn",
    path: ["inactiveAuthorHistoricalChurn"],
  })
  .refine((h) => Date.parse(h.firstCommitAt) <= Date.parse(h.lastCommitAt), {
    message: "firstCommitAt must not be after lastCommitAt",
    path: ["firstCommitAt"],
  });
export type HistoryEvidence = z.infer<typeof HistoryEvidence>;

export const ComplexityEvidence = z.object({
  cyclomaticMax: count,
  cognitiveTotal: count,
  codeLines: count,
});
export type ComplexityEvidence = z.infer<typeof ComplexityEvidence>;

export const ReviewEvidence = z.object({
  unreviewedChurnShare: z.number().min(0).max(1),
});
export type ReviewEvidence = z.infer<typeof ReviewEvidence>;

export const ProvenanceEvidence = z.object({
  markedLinesRecent: count,
  markedUnreviewedLinesRecent: count.optional(),
});
export type ProvenanceEvidence = z.infer<typeof ProvenanceEvidence>;

export const DependencyEvidence = z.object({
  transitiveFanIn: count,
});
export type DependencyEvidence = z.infer<typeof DependencyEvidence>;

export const CriticalityEvidence = z.object({
  critical: z.boolean(),
});
export type CriticalityEvidence = z.infer<typeof CriticalityEvidence>;

export const FileEvidence = z.object({
  path: z.string().min(1),
  language: z.string().min(1),
  lineCount: count,
  history: evidence(HistoryEvidence),
  complexity: evidence(ComplexityEvidence),
  review: evidence(ReviewEvidence),
  provenance: evidence(ProvenanceEvidence),
  dependencies: evidence(DependencyEvidence),
  criticality: evidence(CriticalityEvidence),
});
export type FileEvidence = z.infer<typeof FileEvidence>;
