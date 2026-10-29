import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { auc, averageRanks, logistic, mean, percentile, spearman, standardDeviation } from "./stats.js";

// Reference values come from scikit-learn, SciPy, NumPy and statsmodels on the same
// seeded dataset (see packages/research/reference/compute.py).
const input = readFileSync(new URL("../reference/stats-input.csv", import.meta.url), "utf8")
  .trim()
  .split("\n")
  .slice(1)
  .map((line) => line.split(","));
const expected = JSON.parse(
  readFileSync(new URL("../reference/stats-expected.json", import.meta.url), "utf8"),
) as {
  aucScore: number;
  aucLines: number;
  aucScoreByGroup: Record<string, number>;
  spearmanScoreCount: number;
  percentiles: Record<string, number>;
  logisticCoefficients: number[];
  oddsRatioPerSd: number;
};

const column = (i: number) => input.map((r) => Number(r[i]));
const groups = input.map((r) => r[0] ?? "");
const score = column(1);
const lines = column(2);
const churn = column(3);
const age = column(4);
const y = column(5).map((v) => v === 1);
const count = column(6);

describe("statistics match the reference libraries", () => {
  it("AUC matches scikit-learn roc_auc_score, including tied scores", () => {
    expect(auc(score, y)).toBeCloseTo(expected.aucScore, 12);
    expect(auc(lines, y)).toBeCloseTo(expected.aucLines, 12);
    for (const [group, value] of Object.entries(expected.aucScoreByGroup)) {
      const keep = groups.map((g) => g === group);
      expect(
        auc(
          score.filter((_, i) => keep[i]),
          y.filter((_, i) => keep[i]),
        ),
      ).toBeCloseTo(value, 12);
    }
  });

  it("Spearman matches SciPy spearmanr with ties", () => {
    expect(spearman(score, count)).toBeCloseTo(expected.spearmanScoreCount, 12);
  });

  it("percentile matches NumPy's default interpolation", () => {
    for (const [p, value] of Object.entries(expected.percentiles)) {
      expect(percentile(score, Number(p))).toBeCloseTo(value, 12);
    }
  });

  it("logistic regression matches statsmodels Logit with group fixed effects", () => {
    const m = mean(score);
    const sd = standardDeviation(score);
    const levels = [...new Set(groups)].sort();
    const x = input.map((_, i) => [
      1,
      ((score[i] ?? 0) - m) / sd,
      Math.log1p(lines[i] ?? 0),
      Math.log1p(churn[i] ?? 0),
      Math.log1p(age[i] ?? 0),
      ...levels.slice(1).map((level) => (groups[i] === level ? 1 : 0)),
    ]);
    const fit = logistic(x, y);
    fit.coefficients.forEach((c, i) => {
      expect(c).toBeCloseTo(expected.logisticCoefficients[i] ?? Number.NaN, 8);
    });
    expect(Math.exp(fit.coefficients[1] ?? 0)).toBeCloseTo(expected.oddsRatioPerSd, 8);
  });
});

describe("statistics properties", () => {
  it("AUC is 1 for perfect ranking, 0 for reversed, 0.5 for all ties", () => {
    expect(auc([1, 2, 3, 4], [false, false, true, true])).toBe(1);
    expect(auc([4, 3, 2, 1], [false, false, true, true])).toBe(0);
    expect(auc([1, 1, 1, 1], [false, true, false, true])).toBe(0.5);
    expect(() => auc([1, 2], [true, true])).toThrow(/at least one positive and one negative/);
  });

  it("AUC equals the share of positive-negative pairs ranked correctly", () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.integer({ min: 0, max: 5 }), fc.boolean()), { minLength: 2, maxLength: 40 }),
        (pairs) => {
          const pos = pairs.filter(([, l]) => l).map(([s]) => s);
          const neg = pairs.filter(([, l]) => !l).map(([s]) => s);
          fc.pre(pos.length > 0 && neg.length > 0);
          let wins = 0;
          for (const p of pos) for (const n of neg) wins += p > n ? 1 : p === n ? 0.5 : 0;
          expect(
            auc(
              pairs.map(([s]) => s),
              pairs.map(([, l]) => l),
            ),
          ).toBeCloseTo(wins / (pos.length * neg.length), 12);
        },
      ),
    );
  });

  it("average ranks share tied positions", () => {
    expect(averageRanks([10, 20, 20, 30])).toEqual([1, 2.5, 2.5, 4]);
  });

  it("refuses a singular design instead of returning nonsense", () => {
    expect(() =>
      logistic(
        [
          [1, 2],
          [1, 2],
          [1, 2],
        ],
        [true, false, true],
      ),
    ).toThrow(/singular/);
  });
});
