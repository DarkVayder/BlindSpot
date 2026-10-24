import { describe, expect, it } from "vitest";
import { absoluteScale, combine, midRankPercentiles, round } from "./normalize.js";

describe("midRankPercentiles", () => {
  it("returns an empty array for no values", () => {
    expect(midRankPercentiles([])).toEqual([]);
  });

  it("places a single value at the midpoint", () => {
    expect(midRankPercentiles([42])).toEqual([0.5]);
  });

  it("ranks distinct values by mid-rank", () => {
    expect(midRankPercentiles([30, 10, 20, 40])).toEqual([0.625, 0.125, 0.375, 0.875]);
  });

  it("gives ties the same mid-rank", () => {
    expect(midRankPercentiles([5, 5, 5, 5])).toEqual([0.5, 0.5, 0.5, 0.5]);
    expect(midRankPercentiles([1, 2, 2, 3])).toEqual([0.125, 0.5, 0.5, 0.875]);
  });
});

describe("absoluteScale", () => {
  it("maps k to one half on the saturating scale", () => {
    expect(absoluteScale(10, { kind: "saturating", k: 10 })).toBe(0.5);
  });

  it("maps zero and negatives to zero", () => {
    expect(absoluteScale(0, { kind: "saturating", k: 10 })).toBe(0);
    expect(absoluteScale(-3, { kind: "saturating", k: 10 })).toBe(0);
  });

  it("clamps shares to the unit interval", () => {
    expect(absoluteScale(0.3, { kind: "share" })).toBe(0.3);
    expect(absoluteScale(1.7, { kind: "share" })).toBe(1);
  });
});

describe("combine", () => {
  it("is low when either side is low", () => {
    expect(combine(1, 0)).toBe(0);
    expect(combine(0, 1)).toBe(0);
  });

  it("is the geometric mean", () => {
    expect(combine(0.25, 1)).toBe(0.5);
  });

  it("treats NaN as zero", () => {
    expect(combine(Number.NaN, 1)).toBe(0);
  });
});

describe("round", () => {
  it("rounds to fixed decimals", () => {
    expect(round(12.345, 1)).toBe(12.3);
    expect(round(0.125, 2)).toBe(0.13);
  });
});
