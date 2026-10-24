import type { Transform } from "./constants.js";

export function midRankPercentiles(values: readonly number[]): number[] {
  const n = values.length;
  if (n === 0) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const rankOf = new Map<number, number>();
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && sorted[j + 1] === sorted[i]) j++;
    const below = i;
    const equal = j - i + 1;
    rankOf.set(sorted[i] as number, (below + equal / 2) / n);
    i = j + 1;
  }
  return values.map((v) => rankOf.get(v) as number);
}

export function absoluteScale(raw: number, transform: Transform): number {
  if (transform.kind === "share") return clamp01(raw);
  return raw <= 0 ? 0 : raw / (raw + transform.k);
}

// Geometric mean: a file must be both high relative to its repository and high on the
// absolute scale to score high, so a repository of uniformly simple files stays low.
export function combine(percentile: number, absolute: number): number {
  return Math.sqrt(clamp01(percentile) * clamp01(absolute));
}

export function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  return Math.min(1, Math.max(0, x));
}

export function round(x: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(x * f) / f;
}
