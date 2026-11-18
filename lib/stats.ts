// Small numeric toolkit for the radar model: order statistics, a seeded RNG,
// least-squares solvers (plain, weighted, Huber-robust) and a Theil-Sen fit.
// Everything here is deterministic: the bootstrap runs off a fixed seed so two
// runs of the program write the same bytes.

/** mulberry32: a tiny deterministic PRNG, good enough for bootstrap resampling. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Linear-interpolated quantile, q in [0,1], over a copy of xs. */
export function quantile(xs: number[], q: number): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 1) return s[0]!;
  const pos = q * (s.length - 1);
  const lo = Math.floor(pos);
  const frac = pos - lo;
  return s[lo]! + (s[Math.min(lo + 1, s.length - 1)]! - s[lo]!) * frac;
}

/** Solve A x = b for a small dense A by Gaussian elimination with partial pivoting. */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r]![col]!) > Math.abs(M[piv]![col]!)) piv = r;
    if (Math.abs(M[piv]![col]!) < 1e-12) continue; // singular direction: leave coefficient at 0
    [M[col], M[piv]] = [M[piv]!, M[col]!];
    const d = M[col]![col]!;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r]![col]! / d;
      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r]![c]! -= f * M[col]![c]!;
    }
  }
  return M.map((row, i) => (Math.abs(row[i]!) < 1e-12 ? 0 : row[n]! / row[i]!));
}

/** Weighted least squares for y ~ X beta (X rows carry their own intercept column). */
export function wls(X: number[][], y: number[], w: number[]): number[] {
  const p = X[0]!.length;
  const A: number[][] = Array.from({ length: p }, () => new Array(p).fill(0));
  const b: number[] = new Array(p).fill(0);
  for (let i = 0; i < X.length; i++) {
    const xi = X[i]!;
    const wi = w[i]!;
    for (let r = 0; r < p; r++) {
      b[r]! += wi * xi[r]! * y[i]!;
      for (let c = 0; c < p; c++) A[r]![c]! += wi * xi[r]! * xi[c]!;
    }
  }
  // A whisper of ridge keeps degenerate designs (an all-zero column) solvable.
  for (let r = 0; r < p; r++) A[r]![r]! += 1e-9;
  return solve(A, b);
}

export function ols(X: number[][], y: number[]): number[] {
  return wls(X, y, y.map(() => 1));
}

export function dot(beta: number[], x: number[]): number {
  let s = 0;
  for (let i = 0; i < beta.length; i++) s += beta[i]! * x[i]!;
  return s;
}

/**
 * Huber IRLS: fit y ~ X beta, down-weighting points whose residual exceeds
 * k * (robust scale). Returns the coefficients; residuals come from dot().
 */
export function huber(X: number[][], y: number[], k = 1.345, iters = 24): number[] {
  let beta = ols(X, y);
  for (let it = 0; it < iters; it++) {
    const res = y.map((yi, i) => yi - dot(beta, X[i]!));
    const scale = 1.4826 * median(res.map(Math.abs)) || 1e-6;
    const w = res.map((r) => {
      const u = Math.abs(r) / (k * scale);
      return u <= 1 ? 1 : 1 / u;
    });
    const next = wls(X, y, w);
    const shift = Math.max(...next.map((v, i) => Math.abs(v - beta[i]!)));
    beta = next;
    if (shift < 1e-10) break;
  }
  return beta;
}

/** Theil-Sen slope/intercept for a single regressor, the robust cross-check. */
export function theilSen(x: number[], y: number[]): { a: number; b: number } {
  const slopes: number[] = [];
  for (let i = 0; i < x.length; i++)
    for (let j = i + 1; j < x.length; j++) {
      const dx = x[j]! - x[i]!;
      if (Math.abs(dx) > 1e-9) slopes.push((y[j]! - y[i]!) / dx);
    }
  const b = median(slopes);
  const a = median(y.map((yi, i) => yi - b * x[i]!));
  return { a, b };
}

/** Factor miss of a prediction in log10 space: 10^|pred - actual|, always >= 1. */
export function factorMiss(predLog: number, actualLog: number): number {
  return Math.pow(10, Math.abs(predLog - actualLog));
}

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
