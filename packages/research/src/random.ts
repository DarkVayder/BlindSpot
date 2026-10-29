// Every random step in the pipeline (sampling, bootstrap) uses this generator with a
// recorded seed, so a re-run reproduces the same draws on any platform. Mulberry32: a
// 32-bit generator that is fast and good enough for sampling; it is not cryptographic.
export type Rng = () => number;

export function createRng(seed: number): Rng {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new Error("The seed must be an integer between 0 and 2^32 - 1.");
  }
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function randomInt(rng: Rng, exclusiveMax: number): number {
  return Math.floor(rng() * exclusiveMax);
}

export function sampleWithoutReplacement<T>(rng: Rng, items: readonly T[], count: number): T[] {
  const pool = [...items];
  const n = Math.min(count, pool.length);
  for (let i = 0; i < n; i++) {
    const j = i + randomInt(rng, pool.length - i);
    [pool[i], pool[j]] = [pool[j] as T, pool[i] as T];
  }
  return pool.slice(0, n);
}
