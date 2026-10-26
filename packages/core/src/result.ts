import { z } from "zod";
import { MissingReason } from "./evidence.js";
import { GROUP_IDS, SIGNAL_IDS } from "./model/constants.js";

export const RiskBand = z.enum(["low", "moderate", "elevated", "high", "insufficient_evidence"]);
export type RiskBand = z.infer<typeof RiskBand>;

const unit = z.number().min(0).max(1);

export const SignalResult = z.discriminatedUnion("status", [
  z.object({
    id: z.enum(SIGNAL_IDS),
    status: z.literal("observed"),
    raw: z.number().nonnegative(),
    percentile: unit,
    normalized: unit,
  }),
  z.object({
    id: z.enum(SIGNAL_IDS),
    status: z.literal("missing"),
    reason: MissingReason,
  }),
  z.object({
    id: z.enum(SIGNAL_IDS),
    status: z.literal("not_applicable"),
    note: z.string(),
  }),
]);
export type SignalResult = z.infer<typeof SignalResult>;

export const GroupResult = z.object({
  id: z.enum(GROUP_IDS),
  weight: unit,
  status: z.enum(["observed", "missing", "not_applicable"]),
  value: unit.nullable(),
  contribution: unit.nullable(),
});
export type GroupResult = z.infer<typeof GroupResult>;

export const FileRisk = z.object({
  path: z.string(),
  language: z.string(),
  modelVersion: z.string(),
  score: z.number().min(0).max(100).nullable(),
  band: RiskBand,
  confidence: unit,
  limitedEvidence: z.boolean(),
  impact: z.object({
    value: unit,
    status: z.enum(["observed", "neutral_fallback"]),
  }),
  groups: z.array(GroupResult),
  signals: z.array(SignalResult),
  explanations: z.array(z.string()),
  limitations: z.array(z.string()),
  actions: z.array(z.string()),
});
export type FileRisk = z.infer<typeof FileRisk>;

export const ANALYSIS_SCHEMA_VERSION = 1;

export const AnalysisResult = z.object({
  schemaVersion: z.literal(ANALYSIS_SCHEMA_VERSION),
  toolVersion: z.string(),
  modelVersion: z.string(),
  asOf: z.iso.datetime({ offset: true }).nullable(),
  repository: z.object({
    headCommit: z
      .string()
      .regex(/^[0-9a-f]{40}([0-9a-f]{24})?$/)
      .nullable(),
    shallow: z.boolean(),
  }),
  configHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  coverage: z.object({
    trackedFiles: z.number().int().nonnegative(),
    analyzedFiles: z.number().int().nonnegative(),
    excludedFiles: z.number().int().nonnegative(),
    excludedByReason: z.record(z.string(), z.number().int().positive()),
    commitsRead: z.number().int().nonnegative(),
    historyTruncated: z.boolean(),
    incomplete: z.boolean(),
  }),
  notes: z.array(z.string()),
  warnings: z.array(z.string()),
  files: z.array(FileRisk),
});
export type AnalysisResult = z.infer<typeof AnalysisResult>;
