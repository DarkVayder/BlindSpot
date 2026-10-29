import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { parseCsv, writeCsv } from "./csv.js";
import type { Dataset, DatasetRepository, SnapshotId } from "./dataset.js";
import { labelOutcomes } from "./label.js";
import { createRng, sampleWithoutReplacement } from "./random.js";
import { BUGFIX_RULE } from "./rules.js";
import { SnapshotFile } from "./snapshot.js";

export const SAMPLE_SEED = 20_261_028;
export const POSITIVE_SAMPLE = 200;
export const NEGATIVE_SAMPLE = 100;
const BODY_EXCERPT = 600;

export const SHEET_HEADER = [
  "n",
  "repository",
  "commit",
  "url",
  "subject",
  "body",
  "suggested",
  "judgement",
  "notes",
] as const;

export const SampleKey = z.strictObject({
  dataset: z.strictObject({ id: z.string(), sha256: z.string() }),
  rule: z.string(),
  seed: z.number().int(),
  population: z.record(
    z.string(),
    z.strictObject({ positives: z.number().int(), negatives: z.number().int() }),
  ),
  rows: z.array(
    z.strictObject({
      n: z.number().int().positive(),
      repository: z.string(),
      snapshot: z.string(),
      commit: z.string(),
      ruleSaysFix: z.boolean(),
    }),
  ),
});
export type SampleKey = z.infer<typeof SampleKey>;

interface Candidate {
  repository: DatasetRepository;
  snapshot: SnapshotId;
  hash: string;
  message: string;
  ruleSaysFix: boolean;
}

export interface SampleOptions {
  dataset: Dataset;
  datasetSha256: string;
  cacheDir: (repo: DatasetRepository) => string;
  snapshotsDir: string;
  timeoutMs: number;
}

export interface Sample {
  sheet: string;
  key: SampleKey;
}

// The population is every window commit, from both snapshots, that changed at least one
// analyzed file: the commits whose labels reach the analysis.
export async function buildSample(options: SampleOptions): Promise<Sample> {
  const candidates: Candidate[] = [];
  for (const repository of options.dataset.repositories) {
    const seen = new Set<string>();
    for (const snapshot of ["T1", "T2"] as const) {
      const pinned = repository.snapshots[snapshot];
      if (!pinned) throw new Error(`${repository.id} has no pinned ${snapshot} snapshot.`);
      const file = SnapshotFile.parse(
        JSON.parse(
          readFileSync(path.join(options.snapshotsDir, `${repository.id}.${snapshot}.json`), "utf8"),
        ),
      );
      const labels = await labelOutcomes(options.cacheDir(repository), {
        snapshot: pinned.commit,
        snapshotCommittedAt: Date.parse(pinned.committedAt) / 1000,
        end: pinned.end,
        windowDays: options.dataset.windowDays,
        trackedPaths: file.files.map((f) => f.path),
        timeoutMs: options.timeoutMs,
      });
      for (const c of labels.commits) {
        if (!c.touchesAnalyzedFile || seen.has(c.hash)) continue;
        seen.add(c.hash);
        candidates.push({
          repository,
          snapshot,
          hash: c.hash,
          message: c.message,
          ruleSaysFix: c.bugfix === "bugfix",
        });
      }
    }
  }

  const ids = options.dataset.repositories.map((r) => r.id);
  const population: SampleKey["population"] = {};
  for (const id of ids) {
    const mine = candidates.filter((c) => c.repository.id === id);
    population[id] = {
      positives: mine.filter((c) => c.ruleSaysFix).length,
      negatives: mine.filter((c) => !c.ruleSaysFix).length,
    };
  }

  const rng = createRng(SAMPLE_SEED);
  const chosen: Candidate[] = [];
  for (const [ruleSaysFix, total] of [
    [true, POSITIVE_SAMPLE],
    [false, NEGATIVE_SAMPLE],
  ] as const) {
    const counts = ids.map(
      (id) => (ruleSaysFix ? population[id]?.positives : population[id]?.negatives) ?? 0,
    );
    const quotas = allocate(total, counts);
    ids.forEach((id, i) => {
      const stratum = candidates
        .filter((c) => c.repository.id === id && c.ruleSaysFix === ruleSaysFix)
        .sort((a, b) => (a.hash < b.hash ? -1 : 1));
      chosen.push(...sampleWithoutReplacement(rng, stratum, quotas[i] ?? 0));
    });
  }

  const ordered = sampleWithoutReplacement(rng, chosen, chosen.length);
  const rows: string[][] = [[...SHEET_HEADER]];
  const keyRows: SampleKey["rows"] = [];
  ordered.forEach((c, index) => {
    const n = index + 1;
    const newline = c.message.indexOf("\n");
    const subject = (newline < 0 ? c.message : c.message.slice(0, newline)).trim();
    const body = newline < 0 ? "" : c.message.slice(newline + 1).trim();
    const excerpt = body.length > BODY_EXCERPT ? `${body.slice(0, BODY_EXCERPT)}…` : body;
    const url = `${c.repository.url.replace(/\.git$/, "")}/commit/${c.hash}`;
    rows.push([String(n), c.repository.id, c.hash.slice(0, 12), url, subject, excerpt, "", "", ""]);
    keyRows.push({
      n,
      repository: c.repository.id,
      snapshot: c.snapshot,
      commit: c.hash,
      ruleSaysFix: c.ruleSaysFix,
    });
  });

  return {
    sheet: writeCsv(rows),
    key: {
      dataset: { id: options.dataset.id, sha256: options.datasetSha256 },
      rule: BUGFIX_RULE,
      seed: SAMPLE_SEED,
      population,
      rows: keyRows,
    },
  };
}

// Largest-remainder proportional allocation, ties broken by stratum order, never more
// than a stratum holds.
export function allocate(total: number, counts: readonly number[]): number[] {
  const sum = counts.reduce((a, b) => a + b, 0);
  if (sum <= total) return [...counts];
  const exact = counts.map((c) => (total * c) / sum);
  const quotas = exact.map(Math.floor);
  let remaining = total - quotas.reduce((a, b) => a + b, 0);
  const order = exact
    .map((e, i) => ({ i, remainder: e - Math.floor(e) }))
    .sort((a, b) => b.remainder - a.remainder || a.i - b.i);
  for (const { i } of order) {
    if (remaining === 0) break;
    if ((quotas[i] ?? 0) < (counts[i] ?? 0)) {
      quotas[i] = (quotas[i] ?? 0) + 1;
      remaining--;
    }
  }
  return quotas;
}

export type Judgement = "yes" | "no" | "unsure";

export interface JudgedRow {
  n: number;
  repository: string;
  ruleSaysFix: boolean;
  judgement: Judgement;
}

// Reads the person's judgements and joins them to the key by row number, checking the
// commit on each row so a re-sorted or edited sheet cannot be silently misread. The check
// uses the full hash in the URL, because a spreadsheet can turn a short hash such as
// 12345678e901 into a number when the sheet is saved.
export function readJudgements(sheetText: string, key: SampleKey): JudgedRow[] {
  const [header, ...body] = parseCsv(sheetText).filter((r) => r.some((c) => c.trim() !== ""));
  const columns = new Map((header ?? []).map((name, i) => [name.trim().toLowerCase(), i]));
  const column = (name: string) => {
    const i = columns.get(name);
    if (i === undefined) throw new Error(`The labelling sheet has no "${name}" column.`);
    return i;
  };
  const [nCol, urlCol, judgementCol] = [column("n"), column("url"), column("judgement")];
  const keyByN = new Map(key.rows.map((r) => [r.n, r]));
  const missing: number[] = [];
  const judged: JudgedRow[] = [];
  const seen = new Set<number>();
  for (const row of body) {
    const n = Number(row[nCol]);
    if (seen.has(n)) throw new Error(`Row ${n} appears more than once.`);
    seen.add(n);
    const k = keyByN.get(n);
    if (!k) throw new Error(`Row ${row[nCol] ?? "?"} is not in the sample key.`);
    if (!(row[urlCol] ?? "").trim().endsWith(`/commit/${k.commit}`)) {
      throw new Error(`Row ${n} does not match commit ${k.commit.slice(0, 12)} in the key.`);
    }
    const value = (row[judgementCol] ?? "").trim().toLowerCase();
    if (value === "") {
      missing.push(n);
      continue;
    }
    if (value !== "yes" && value !== "no" && value !== "unsure") {
      throw new Error(`Row ${n}: judgement must be yes, no or unsure, not "${value}".`);
    }
    judged.push({ n, repository: k.repository, ruleSaysFix: k.ruleSaysFix, judgement: value });
  }
  if (missing.length > 0) {
    throw new Error(`${missing.length} row(s) have no judgement yet, for example row ${missing[0] ?? "?"}.`);
  }
  if (judged.length !== key.rows.length) {
    throw new Error(`The sheet has ${judged.length} judged rows; the key has ${key.rows.length}.`);
  }
  return judged.sort((a, b) => a.n - b.n);
}
