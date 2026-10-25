import { z } from "zod";
import { validateGlob } from "./glob.js";

export const DEFAULT_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".java",
  ".kt",
  ".cs",
  ".rb",
  ".php",
  ".rs",
  ".swift",
  ".c",
  ".h",
  ".cpp",
  ".hpp",
  ".scala",
];

export const DEFAULT_AI_MARKERS = [
  "noreply@anthropic.com",
  "copilot@users.noreply.github.com",
  "copilot-swe-agent[bot]",
  "cursoragent@cursor.com",
  "noreply@aider.chat",
  "devin-ai-integration[bot]",
];

const weight = z.number().min(0).max(1);
const days = z.number().int().min(1).max(3650);
const glob = z
  .string()
  .min(1)
  .max(500)
  .superRefine((pattern, ctx) => {
    const problem = validateGlob(pattern);
    if (problem) ctx.addIssue({ code: "custom", message: problem });
  });
const globs = z.array(glob).max(200);
const marker = z
  .string()
  .min(2)
  .max(100)
  .transform((s) => s.toLowerCase());

export const Weights = z
  .strictObject({
    changePressure: weight.default(0.25),
    knowledge: weight.default(0.25),
    complexity: weight.default(0.25),
    review: weight.default(0.2),
    provenance: weight.default(0.05),
  })
  .refine((w) => w.changePressure + w.knowledge + w.complexity + w.review > 0, {
    message: "At least one of changePressure, knowledge, complexity or review must have a weight above 0",
  });
export type Weights = z.infer<typeof Weights>;

export const BlindspotConfig = z.strictObject({
  $schema: z.string().optional(),
  include: globs.default(() => []),
  exclude: globs.default(() => []),
  useDefaultExcludes: z.boolean().default(true),
  extensions: z
    .array(z.string().regex(/^\.[A-Za-z0-9]+$/, "Extensions must look like '.ts'"))
    .min(1)
    .default(() => [...DEFAULT_EXTENSIONS]),
  critical: globs.default(() => []),
  windows: z
    .strictObject({
      analysisDays: days.default(365),
      recentDays: days.default(90),
      inactiveAuthorDays: days.default(180),
    })
    .refine((w) => w.recentDays <= w.analysisDays, {
      message: "recentDays must not exceed analysisDays",
      path: ["recentDays"],
    })
    .default(() => ({ analysisDays: 365, recentDays: 90, inactiveAuthorDays: 180 })),
  weights: Weights.default(() => ({
    changePressure: 0.25,
    knowledge: 0.25,
    complexity: 0.25,
    review: 0.2,
    provenance: 0.05,
  })),
  impactFloor: z.number().min(0).max(1).default(0.6),
  provenance: z
    .strictObject({
      markers: z.array(marker).default(() => [...DEFAULT_AI_MARKERS]),
      declaredPaths: globs.default(() => []),
    })
    .default(() => ({ markers: [...DEFAULT_AI_MARKERS], declaredPaths: [] })),
  limits: z
    .strictObject({
      maxFileBytes: z.number().int().min(1024).max(50_000_000).default(1_000_000),
      maxCommits: z.number().int().min(1).max(10_000_000).default(100_000),
      gitTimeoutMs: z.number().int().min(1000).max(3_600_000).default(300_000),
    })
    .default(() => ({ maxFileBytes: 1_000_000, maxCommits: 100_000, gitTimeoutMs: 300_000 })),
});
export type BlindspotConfig = z.infer<typeof BlindspotConfig>;
export type BlindspotConfigInput = z.input<typeof BlindspotConfig>;

export type ConfigResult = { ok: true; config: BlindspotConfig } | { ok: false; message: string };

export function parseConfig(input: unknown): ConfigResult {
  const parsed = BlindspotConfig.safeParse(input ?? {});
  if (parsed.success) return { ok: true, config: parsed.data };
  return { ok: false, message: z.prettifyError(parsed.error) };
}

export function defaultConfig(): BlindspotConfig {
  return BlindspotConfig.parse({});
}
