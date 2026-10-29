import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";

const commit = z.string().regex(/^[0-9a-f]{40}([0-9a-f]{24})?$/, "must be a full lowercase commit hash");
const isoTimestamp = z.iso.datetime({ offset: true });

export const SnapshotId = z.enum(["T1", "T2"]);
export type SnapshotId = z.infer<typeof SnapshotId>;

export const PinnedSnapshot = z.strictObject({
  commit,
  committedAt: isoTimestamp,
  end: commit,
  endCommittedAt: isoTimestamp,
  commitsInWindow: z.number().int().nonnegative(),
  trackedFiles: z.number().int().nonnegative(),
});
export type PinnedSnapshot = z.infer<typeof PinnedSnapshot>;

export const DatasetRepository = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "must be lowercase letters, digits and dashes"),
  url: z
    .string()
    .regex(
      /^https:\/\/github\.com\/[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}\.git$/,
      "must be an https://github.com/<owner>/<name>.git URL",
    ),
  language: z.enum(["typescript", "javascript", "python", "go"]),
  license: z.enum(["MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0"]),
  snapshots: z.partialRecord(SnapshotId, PinnedSnapshot).default({}),
});
export type DatasetRepository = z.infer<typeof DatasetRepository>;

export const Dataset = z
  .strictObject({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
    windowDays: z.number().int().min(1).max(3650),
    snapshotDates: z.strictObject({ T1: isoTimestamp, T2: isoTimestamp }),
    repositories: z.array(DatasetRepository).min(1),
  })
  .refine((d) => new Set(d.repositories.map((r) => r.id)).size === d.repositories.length, {
    message: "repository ids must be unique",
    path: ["repositories"],
  })
  .refine(
    (d) => Date.parse(d.snapshotDates.T2) - Date.parse(d.snapshotDates.T1) >= d.windowDays * 86_400_000,
    {
      message: "T2 must be at least windowDays after T1 so the outcome windows do not overlap",
      path: ["snapshotDates"],
    },
  );
export type Dataset = z.infer<typeof Dataset>;

export class DatasetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatasetError";
  }
}

export interface LoadedDataset {
  dataset: Dataset;
  sha256: string;
}

export function loadDataset(file: string): LoadedDataset {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    throw new DatasetError(`Could not read the dataset file ${file}.`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new DatasetError(`${file} is not valid JSON.`);
  }
  const parsed = Dataset.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`);
    throw new DatasetError(`${file} is not a valid dataset:\n${issues.join("\n")}`);
  }
  return { dataset: parsed.data, sha256: createHash("sha256").update(text).digest("hex") };
}

export function serializeDataset(dataset: Dataset): string {
  return `${JSON.stringify(dataset, null, 2)}\n`;
}
