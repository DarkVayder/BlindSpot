import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import fc from "fast-check";
import { afterAll, describe, expect, it } from "vitest";
import { tempDir, TestRepo } from "../../git/src/test/repo.js";
import { parseCsv, writeCsv } from "./csv.js";
import { Dataset, serializeDataset } from "./dataset.js";
import { labelQuality, wilson } from "./quality.js";
import { createRng, sampleWithoutReplacement } from "./random.js";
import { run } from "./run.js";
import { allocate, readJudgements, SampleKey, SHEET_HEADER } from "./sample.js";
import { cachedClone, DEMO_URL } from "./test/clone.js";

const repos: TestRepo[] = [];
afterAll(() => {
  for (const r of repos) r.cleanup();
});

describe("createRng", () => {
  it("is deterministic for a seed and stays in [0, 1)", () => {
    const a = createRng(42);
    const b = createRng(42);
    const draws = Array.from({ length: 1000 }, () => a());
    expect(draws).toEqual(Array.from({ length: 1000 }, () => b()));
    expect(draws.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(createRng(43)()).not.toBe(createRng(42)());
  });

  it("produces the same first draws on every platform", () => {
    const rng = createRng(20_261_028);
    expect([rng(), rng(), rng()].map((x) => x.toFixed(10))).toMatchInlineSnapshot(`
      [
        "0.0647623336",
        "0.8213904281",
        "0.4212553445",
      ]
    `);
  });

  it("samples without replacement", () => {
    fc.assert(
      fc.property(fc.array(fc.integer(), { maxLength: 50 }), fc.nat(60), fc.nat(), (items, count, seed) => {
        const picked = sampleWithoutReplacement(
          createRng(seed % 2 ** 32),
          items.map((_, i) => i),
          count,
        );
        expect(picked).toHaveLength(Math.min(count, items.length));
        expect(new Set(picked).size).toBe(picked.length);
      }),
    );
  });
});

describe("csv", () => {
  it("round-trips quotes, commas, newlines and a byte-order mark", () => {
    const rows = [
      ["n", "subject"],
      ["1", 'Fix "quoted", comma\nand newline'],
      ["2", ""],
    ];
    const text = writeCsv(rows);
    expect(parseCsv(text)).toEqual(rows);
    expect(parseCsv(String.fromCharCode(0xfeff) + text)).toEqual(rows);
    expect(parseCsv(text.replaceAll("\r\n", "\n"))).toEqual(rows);
  });

  it("neutralizes cells a spreadsheet would run as formulas", () => {
    const [row] = parseCsv(writeCsv([["=HYPERLINK(1)", "+1", "-1", "@SUM(A1)", "plain"]]));
    expect(row).toEqual(["'=HYPERLINK(1)", "'+1", "'-1", "'@SUM(A1)", "plain"]);
  });

  it("rejects a file that ends inside a quoted cell", () => {
    expect(() => parseCsv('a,"open')).toThrow(/inside a quoted cell/);
  });
});

describe("allocate", () => {
  it("allocates in proportion, sums to the total and never exceeds a stratum", () => {
    expect(allocate(10, [50, 30, 20])).toEqual([5, 3, 2]);
    expect(allocate(10, [1, 1, 1])).toEqual([1, 1, 1]);
    fc.assert(
      fc.property(fc.array(fc.nat(500), { minLength: 1, maxLength: 12 }), fc.nat(300), (counts, total) => {
        const quotas = allocate(total, counts);
        const sum = counts.reduce((a, b) => a + b, 0);
        expect(quotas.reduce((a, b) => a + b, 0)).toBe(Math.min(total, sum));
        quotas.forEach((q, i) => {
          expect(q).toBeLessThanOrEqual(counts[i] ?? 0);
        });
      }),
    );
  });
});

describe("wilson", () => {
  it("matches published 95% intervals", () => {
    const r = (v: number) => Number(v.toFixed(4));
    const eight = wilson(8, 10);
    expect([r(eight.lower), r(eight.upper)]).toEqual([0.4902, 0.9433]);
    const zero = wilson(0, 10);
    expect([zero.lower, r(zero.upper)]).toEqual([0, 0.2775]);
  });
});

function key(rows: { ruleSaysFix: boolean }[]): SampleKey {
  return {
    dataset: { id: "test", sha256: "x" },
    rule: "bugfix@1",
    seed: 1,
    population: { demo: { positives: 800, negatives: 1200 } },
    rows: rows.map((r, i) => ({
      n: i + 1,
      repository: "demo",
      snapshot: "T1",
      commit: `${String(i + 1).padStart(2, "0")}${"a".repeat(38)}`,
      ruleSaysFix: r.ruleSaysFix,
    })),
  };
}

function sheet(k: SampleKey, judgements: string[]): string {
  return writeCsv([
    [...SHEET_HEADER],
    ...k.rows.map((r, i) => [
      String(r.n),
      r.repository,
      r.commit.slice(0, 12),
      `${DEMO_URL.replace(/\.git$/, "")}/commit/${r.commit}`,
      "",
      "",
      "",
      judgements[i] ?? "",
      "",
    ]),
  ]);
}

describe("readJudgements and labelQuality", () => {
  it("computes precision, miss rate and population-weighted recall", () => {
    const k = key([
      ...Array.from({ length: 10 }, () => ({ ruleSaysFix: true })),
      ...Array.from({ length: 5 }, () => ({ ruleSaysFix: false })),
    ]);
    const judgements = [...Array<string>(8).fill("yes"), "no", "unsure", "yes", "no", "no", "no", "no"];
    const q = labelQuality(k, readJudgements(sheet(k, judgements), k), "Tester");
    expect(q.sample).toEqual({ positives: 9, negatives: 5, unsurePositives: 1, unsureNegatives: 0 });
    expect(q.precision.estimate).toBe(0.8889);
    expect(q.missRate.estimate).toBe(0.2);
    expect(q.recall.estimate).toBe(Number(((0.8889 * 800) / (0.8889 * 800 + 0.2 * 1200)).toFixed(4)));
    expect(q.recall.lower).toBeLessThan(q.recall.estimate);
    expect(q.meetsThreshold).toBe(true);
    expect(q.labelledBy).toBe("Tester");
  });

  it("refuses a sheet with missing, invalid, duplicated or re-sorted rows", () => {
    const k = key([{ ruleSaysFix: true }, { ruleSaysFix: false }]);
    expect(() => readJudgements(sheet(k, ["yes", ""]), k)).toThrow(/no judgement yet/);
    expect(() => readJudgements(sheet(k, ["yes", "maybe"]), k)).toThrow(/yes, no or unsure/);
    const rows = parseCsv(sheet(k, ["yes", "no"]));
    const duplicated = writeCsv([rows[0] ?? [], rows[1] ?? [], rows[1] ?? []]);
    expect(() => readJudgements(duplicated, k)).toThrow(/more than once/);
    const otherUrl = (rows[2] ?? [])[3] ?? "";
    const swapped = writeCsv([rows[0] ?? [], [...(rows[1] ?? [])].map((c, i) => (i === 3 ? otherUrl : c))]);
    expect(() => readJudgements(swapped, k)).toThrow(/does not match commit/);
  });

  it("accepts a sheet whose short hashes a spreadsheet turned into numbers", () => {
    const k = key([{ ruleSaysFix: true }, { ruleSaysFix: false }]);
    const rows = parseCsv(sheet(k, ["yes", "no"]));
    const mangled = writeCsv(
      rows.map((row, i) => (i === 0 ? row : row.map((c, j) => (j === 2 ? "1.23E+11" : c)))),
    );
    expect(readJudgements(mangled, k)).toHaveLength(2);
  });
});

describe("sample command", () => {
  it("draws a blinded, reproducible sample and refuses to overwrite judgements", async () => {
    const r = TestRepo.create("bs-sample-");
    repos.push(r);
    r.write("a.ts", "export const a = 0;\n").commit("initial", "2024-01-01T00:00:00Z");
    for (let i = 1; i <= 12; i++) {
      const message = i % 3 === 0 ? `Fix bug ${i}` : `Add feature ${i}`;
      r.write("a.ts", `export const a = ${i};\n`).commit(
        message,
        `2024-02-${String(i).padStart(2, "0")}T00:00:00Z`,
      );
    }
    r.write("a.ts", "export const a = 99;\n").commit("later", "2024-09-01T00:00:00Z");

    const cacheRoot = tempDir();
    cachedClone(r, cacheRoot);
    const work = tempDir();
    const datasetFile = path.join(work, "v1.json");
    writeFileSync(
      datasetFile,
      serializeDataset(
        Dataset.parse({
          id: "test",
          windowDays: 180,
          snapshotDates: { T1: "2024-01-01T12:00:00Z", T2: "2024-07-01T00:00:00Z" },
          repositories: [{ id: "demo", url: DEMO_URL, language: "typescript", license: "MIT" }],
        }),
      ),
    );
    const err: string[] = [];
    const io = { stdout: { write: () => true }, stderr: { write: (s: string) => err.push(s) }, cwd: work };
    const common = ["--dataset", datasetFile, "--cache", cacheRoot];
    const out = ["--out", path.join(work, "out")];
    const labels = ["--labels", path.join(work, "labels")];
    expect(await run(["pin", ...common], io)).toBe(0);
    expect(await run(["snapshot", ...common, ...out], io)).toBe(0);
    expect(await run(["sample", ...common, ...out, ...labels], io)).toBe(0);

    const sheetFile = path.join(work, "labels", "test-sample.csv");
    const first = readFileSync(sheetFile, "utf8");
    const parsed = parseCsv(first);
    expect(parsed[0]).toEqual([...SHEET_HEADER]);
    expect(parsed).toHaveLength(13);
    expect(first).not.toMatch(/ruleSaysFix|bugfix@1/);
    const sampleKey = SampleKey.parse(
      JSON.parse(readFileSync(path.join(work, "labels", "test-sample.key.json"), "utf8")),
    );
    expect(sampleKey.rows.filter((row) => row.ruleSaysFix)).toHaveLength(4);
    expect(parsed[1]?.[3]).toMatch(/^https:\/\/github\.com\/example\/demo\/commit\/[0-9a-f]{40}$/);

    expect(await run(["sample", ...common, ...out, ...labels], io)).toBe(2);
    expect(err.join("")).toContain("may hold judgements");
    expect(await run(["sample", ...common, ...out, ...labels, "--force"], io)).toBe(0);
    expect(readFileSync(sheetFile, "utf8")).toBe(first);
  }, 120_000);
});
