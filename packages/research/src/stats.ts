// Statistics for the research analysis, checked against scikit-learn, SciPy, NumPy and
// statsmodels in stats.test.ts.

export function averageRanks(values: readonly number[]): number[] {
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(values.length).fill(0);
  for (let start = 0; start < order.length;) {
    let end = start;
    while (end + 1 < order.length && order[end + 1]?.v === order[start]?.v) end++;
    const rank = (start + end) / 2 + 1;
    for (let k = start; k <= end; k++) ranks[order[k]?.i ?? 0] = rank;
    start = end + 1;
  }
  return ranks;
}

// The probability that a random positive scores above a random negative, ties counted
// half (Mann-Whitney U divided by the number of pairs).
export function auc(scores: readonly number[], labels: readonly boolean[]): number {
  const ranks = averageRanks(scores);
  let positives = 0;
  let rankSum = 0;
  labels.forEach((y, i) => {
    if (y) {
      positives++;
      rankSum += ranks[i] ?? 0;
    }
  });
  const negatives = labels.length - positives;
  if (positives === 0 || negatives === 0)
    throw new Error("AUC needs at least one positive and one negative.");
  return (rankSum - (positives * (positives + 1)) / 2) / (positives * negatives);
}

export function pearson(x: readonly number[], y: readonly number[]): number {
  const n = x.length;
  const mx = mean(x);
  const my = mean(y);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = (x[i] ?? 0) - mx;
    const dy = (y[i] ?? 0) - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  return sxx === 0 || syy === 0 ? Number.NaN : sxy / Math.sqrt(sxx * syy);
}

export function spearman(x: readonly number[], y: readonly number[]): number {
  return pearson(averageRanks(x), averageRanks(y));
}

export function mean(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function standardDeviation(values: readonly number[]): number {
  const m = mean(values);
  return Math.sqrt(values.reduce((a, v) => a + (v - m) ** 2, 0) / (values.length - 1));
}

// Linear interpolation between order statistics (NumPy's default, "type 7").
export function percentile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * p;
  const lower = Math.floor(position);
  const fraction = position - lower;
  const a = sorted[lower] ?? Number.NaN;
  const b = sorted[Math.min(lower + 1, sorted.length - 1)] ?? Number.NaN;
  return a + (b - a) * fraction;
}

export interface LogisticFit {
  coefficients: number[];
  iterations: number;
}

// Maximum-likelihood logistic regression by iteratively reweighted least squares. Each
// row of `x` must already include the intercept column.
export function logistic(
  x: readonly (readonly number[])[],
  y: readonly boolean[],
  maxIterations = 100,
): LogisticFit {
  const p = x[0]?.length ?? 0;
  let beta = new Array<number>(p).fill(0);
  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    const xtwx = Array.from({ length: p }, () => new Array<number>(p).fill(0));
    const xtwz = new Array<number>(p).fill(0);
    x.forEach((row, i) => {
      const eta = dot(row, beta);
      const mu = 1 / (1 + Math.exp(-eta));
      const w = Math.max(mu * (1 - mu), 1e-12);
      const z = eta + ((y[i] ? 1 : 0) - mu) / w;
      for (let a = 0; a < p; a++) {
        const wa = w * (row[a] ?? 0);
        xtwz[a] = (xtwz[a] ?? 0) + wa * z;
        const target = xtwx[a] ?? [];
        for (let b = 0; b <= a; b++) target[b] = (target[b] ?? 0) + wa * (row[b] ?? 0);
      }
    });
    for (let a = 0; a < p; a++) for (let b = a + 1; b < p; b++) (xtwx[a] ?? [])[b] = xtwx[b]?.[a] ?? 0;
    const next = choleskySolve(xtwx, xtwz);
    const change = Math.max(...next.map((v, i) => Math.abs(v - (beta[i] ?? 0))));
    beta = next;
    if (change < 1e-10) return { coefficients: beta, iterations: iteration };
  }
  throw new Error(`Logistic regression did not converge in ${maxIterations} iterations.`);
}

function dot(a: readonly number[], b: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] ?? 0) * (b[i] ?? 0);
  return sum;
}

function choleskySolve(matrix: readonly (readonly number[])[], rhs: readonly number[]): number[] {
  const n = rhs.length;
  const l = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = matrix[i]?.[j] ?? 0;
      for (let k = 0; k < j; k++) sum -= (l[i]?.[k] ?? 0) * (l[j]?.[k] ?? 0);
      if (i === j) {
        if (sum <= 0)
          throw new Error("The design matrix is singular (a predictor is constant or collinear).");
        (l[i] ?? [])[i] = Math.sqrt(sum);
      } else {
        (l[i] ?? [])[j] = sum / (l[j]?.[j] ?? 1);
      }
    }
  }
  const forward = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    let sum = rhs[i] ?? 0;
    for (let k = 0; k < i; k++) sum -= (l[i]?.[k] ?? 0) * (forward[k] ?? 0);
    forward[i] = sum / (l[i]?.[i] ?? 1);
  }
  const solution = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = forward[i] ?? 0;
    for (let k = i + 1; k < n; k++) sum -= (l[k]?.[i] ?? 0) * (solution[k] ?? 0);
    solution[i] = sum / (l[i]?.[i] ?? 1);
  }
  return solution;
}
