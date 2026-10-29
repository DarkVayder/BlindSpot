import { readFileSync } from "node:fs";
import path from "node:path";
import {
  analyzeSnapshot,
  BOOTSTRAP_REPLICATES,
  BOOTSTRAP_SEED,
  exploratory,
  MIN_CLASS_SIZE,
  SENSITIVITY_EXCLUDED,
  type Exploratory,
  type SnapshotAnalysis,
} from "./analysis.js";
import { writeCsv } from "./csv.js";
import type { Dataset } from "./dataset.js";
import { SnapshotFile } from "./snapshot.js";

export interface AnalysisReport {
  protocol: string;
  dataset: { id: string; sha256: string };
  provenance: {
    toolVersion: string;
    modelVersion: string;
    gitVersion: string;
    rules: { bugfix: string; revert: string };
    bootstrap: { seed: number; replicates: number };
    minClassSize: number;
  };
  snapshots: Record<
    string,
    { primary: SnapshotAnalysis; withoutDjango: SnapshotAnalysis; revert: SnapshotAnalysis }
  >;
  exploratory: Record<string, Exploratory>;
  decisionInputs: {
    successCriterionOnT1: boolean;
    directionHoldsOnT2: boolean;
    sensitivityAgreesOnT1: boolean;
  };
}

export function loadSnapshots(dataset: Dataset, snapshotsDir: string, id: "T1" | "T2"): SnapshotFile[] {
  return dataset.repositories.map((r) =>
    SnapshotFile.parse(JSON.parse(readFileSync(path.join(snapshotsDir, `${r.id}.${id}.json`), "utf8"))),
  );
}

export function buildReport(
  dataset: Dataset,
  datasetSha256: string,
  snapshots: Record<"T1" | "T2", SnapshotFile[]>,
  replicates = BOOTSTRAP_REPLICATES,
): AnalysisReport {
  const all = [...snapshots.T1, ...snapshots.T2];
  const first = all[0];
  if (!first) throw new Error("No snapshot files to analyze.");
  for (const s of all) {
    if (s.dataset.sha256 !== datasetSha256) {
      throw new Error(`${s.repository.id} ${s.snapshot.id} was produced from a different dataset file.`);
    }
    if (JSON.stringify(s.provenance) !== JSON.stringify(first.provenance)) {
      throw new Error(
        `${s.repository.id} ${s.snapshot.id} was produced with a different tool, model or rule version.`,
      );
    }
  }

  const per = (files: SnapshotFile[]) => ({
    primary: analyzeSnapshot(files, { outcome: "bugfix", replicates }),
    withoutDjango: analyzeSnapshot(files, { outcome: "bugfix", exclude: SENSITIVITY_EXCLUDED, replicates }),
    revert: analyzeSnapshot(files, { outcome: "revert", replicates }),
  });
  const t1 = per(snapshots.T1);
  const t2 = per(snapshots.T2);
  const positive = (a: SnapshotAnalysis) =>
    a.pooled !== null &&
    a.pooled.difference.versusLines.estimate > 0 &&
    a.pooled.difference.versusChurn.estimate > 0;

  return {
    protocol: "docs/research-protocol.md",
    dataset: { id: dataset.id, sha256: datasetSha256 },
    provenance: {
      toolVersion: first.provenance.toolVersion,
      modelVersion: first.provenance.modelVersion,
      gitVersion: first.provenance.gitVersion,
      rules: first.provenance.rules,
      bootstrap: { seed: BOOTSTRAP_SEED, replicates },
      minClassSize: MIN_CLASS_SIZE,
    },
    snapshots: { T1: t1, T2: t2 },
    exploratory: { T1: exploratory(snapshots.T1), T2: exploratory(snapshots.T2) },
    decisionInputs: {
      successCriterionOnT1: t1.primary.pooled?.successCriterion ?? false,
      directionHoldsOnT2: positive(t2.primary),
      sensitivityAgreesOnT1:
        (t1.primary.pooled?.successCriterion ?? false) ===
        (t1.withoutDjango.pooled?.successCriterion ?? false),
    },
  };
}

export function repositoriesCsv(report: AnalysisReport): string {
  const rows: string[][] = [
    [
      "snapshot",
      "repository",
      "language",
      "ranked_files",
      "dropped_without_churn",
      "positives",
      "negatives",
      "eligible",
      "auc_score",
      "auc_lines",
      "auc_churn",
      "spearman_score_count",
    ],
  ];
  const text = (v: number | null) => (v === null ? "" : String(v));
  for (const [id, s] of Object.entries(report.snapshots)) {
    for (const r of s.primary.repositories) {
      rows.push([
        id,
        r.id,
        r.language,
        String(r.rankedFiles),
        String(r.droppedWithoutChurn),
        String(r.positives),
        String(r.negatives),
        String(r.eligible),
        text(r.auc.score),
        text(r.auc.lines),
        text(r.auc.churn),
        text(r.spearmanScoreCount),
      ]);
    }
  }
  return writeCsv(rows);
}
