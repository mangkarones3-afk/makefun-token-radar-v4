// The token launch radar model. Everything the page prints is computed here
// from the frozen snapshot: a robust size curve fitted on standalone traded
// tokens, extra terms admitted one at a time by a leave-one-out +
// walk-forward gate, an empirical launch-odds table validated on a
// listing-date split, bootstrap uncertainty bands, and farm plans priced in
// integer cents. No statistic is typed by hand.

import { clamp, dot, factorMiss, huber, median, ols, quantile, rng, theilSen } from './stats.ts';

export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (!Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) throw new Error('snapshot: bad shape');
  return raw;
}

const DAY = 86_400_000;

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY);
}

/** Family stem of a display name: lowercased, punctuation folded, version tail stripped. */
export function stemOf(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s+(v\d+(\.\d+)?|\d+\.\d+)$/, '');
}

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const BRIDGE_CATS = new Set(['Bridge', 'Canonical Bridge', 'Cross Chain Bridge']);
const LIQSTAKE_CATS = new Set(['Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);
const EXCHANGE_STARTS = ['binance', 'coinbase', 'bybit', 'kraken', 'bitget', 'okx', 'bitfinex', 'gemini'];

export type GroupKey = 'ranked' | 'trades' | 'nocap' | 'bridges' | 'liqstake' | 'cex' | 'versioned' | 'kin';

export const GROUP_LABELS: Record<GroupKey, string> = {
  ranked: 'Ranked on the board',
  trades: 'Token already trades',
  nocap: 'Token recorded, no market cap',
  bridges: 'Bridges (set aside)',
  liqstake: 'Liquid staking / restaking (set aside)',
  cex: 'Exchange custody (set aside)',
  versioned: 'Versioned products (set aside)',
  kin: 'Kin of a trading token (set aside)',
};

/** Total TVL per family stem across the whole snapshot (the kin feature's raw material). */
export function familyTvl(protocols: Protocol[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of protocols) m.set(stemOf(p.name), (m.get(stemOf(p.name)) ?? 0) + p.tvl_usd);
  return m;
}

/** Stems that own at least one protocol whose token trades at a positive recorded cap. */
function tradedStems(protocols: Protocol[]): Set<string> {
  const s = new Set<string>();
  for (const p of protocols) if (p.mcap_usd !== null && p.mcap_usd > 0) s.add(stemOf(p.name));
  return s;
}

/**
 * Assign every protocol to exactly one accounting group. Order matters: a
 * protocol is counted by the first rule that claims it, so the eight counts
 * always sum to the snapshot size.
 */
export function classify(p: Protocol, watch: Set<string>, traded: Set<string>): GroupKey {
  if (p.mcap_usd !== null && p.mcap_usd > 0) return 'trades';
  if (p.gecko_id !== null || p.symbol !== null) return 'nocap';
  if (p.category !== null && BRIDGE_CATS.has(p.category)) return 'bridges';
  if (p.category !== null && LIQSTAKE_CATS.has(p.category)) return 'liqstake';
  const lower = p.name.toLowerCase();
  if (p.category === 'CEX' || EXCHANGE_STARTS.some((e) => lower.startsWith(e))) return 'cex';
  if (VERSIONED.test(p.name)) return 'versioned';
  if (/\b(wrapped|staked|staking)\b/i.test(p.name)) return 'kin';
  // The watchlist is the floor: the house already vetted these as standalone.
  if (!watch.has(p.slug) && traded.has(stemOf(p.name))) return 'kin';
  return 'ranked';
}

// ---------------------------------------------------------------------------
// The comparable set: standalone traded tokens the size curve is fitted on.

export interface CompRow {
  p: Protocol;
  logTvl: number;
  logCap: number;
}

export interface CompSet {
  rows: CompRow[];
  tradedRows: number; // protocols whose token carries a positive recorded cap
  recordedTokens: number; // protocols recording a token at all
  droppedSymbolOnly: number;
  droppedDeployments: number;
  droppedCategory: number; // deduped traded tokens set aside by the fit-pool category filter
}

/**
 * Categories the size curve is not fitted on. A bridge, liquid-staking,
 * restaking or exchange token's cap is carried by another asset or venue
 * rather than priced as a standalone product, so those rows would teach
 * the curve the wrong price for the protocols the board actually ranks.
 */
export const FIT_EXCLUDED_CATS: ReadonlySet<string> = new Set([
  'Bridge',
  'Bridges',
  'Liquid Staking',
  'Liquid Staking Tokens',
  'Restaking',
  'Exchange',
  'CEX',
  'Cross Chain Bridge',
]);

export function comparableSet(protocols: Protocol[]): CompSet {
  // A cap of 0 or -1 in the snapshot is a sentinel for "no price recorded",
  // not a price: those tokens are recorded but cannot anchor a size curve.
  const traded = protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0);
  const identified = traded.filter((p) => p.gecko_id !== null);
  const byToken = new Map<string, Protocol>();
  for (const p of identified) {
    const cur = byToken.get(p.gecko_id!);
    if (cur === undefined || p.tvl_usd > cur.tvl_usd || (p.tvl_usd === cur.tvl_usd && p.slug < cur.slug)) {
      byToken.set(p.gecko_id!, p);
    }
  }
  const deduped = [...byToken.values()]
    .sort((a, b) => (a.slug < b.slug ? -1 : 1))
    .map((p) => ({ p, logTvl: Math.log10(p.tvl_usd), logCap: Math.log10(p.mcap_usd!) }));
  const rows = deduped.filter((r) => !FIT_EXCLUDED_CATS.has(r.p.category ?? ''));
  return {
    rows,
    tradedRows: traded.length,
    recordedTokens: protocols.filter((p) => p.gecko_id !== null || p.symbol !== null).length,
    droppedSymbolOnly: traded.length - identified.length,
    droppedDeployments: identified.length - deduped.length,
    droppedCategory: deduped.length - rows.length,
  };
}

// ---------------------------------------------------------------------------
// Features and the gated fit.

export interface Spec {
  cat: boolean;
  mom: boolean;
  ten: boolean;
  br: boolean;
  kin: boolean;
}

const BASE_SPEC: Spec = { cat: false, mom: false, ten: false, br: false, kin: false };

export interface FitCtx {
  medianDays: number;
  famTvl: Map<string, number>;
  asOf: string;
}

function ageDays(p: Protocol, asOf: string): number | null {
  return p.listed_at === null ? null : daysBetween(p.listed_at, asOf);
}

/** Feature vector in fixed order: [1, logTVL, momentum, tenure, breadth, kin]. */
export function features(p: Protocol, ctx: FitCtx): number[] {
  const days = ageDays(p, ctx.asOf) ?? ctx.medianDays;
  const fam = ctx.famTvl.get(stemOf(p.name)) ?? p.tvl_usd;
  return [
    1,
    Math.log10(p.tvl_usd),
    clamp(p.change_7d ?? 0, -40, 60) / 100,
    Math.exp(-days / 540),
    Math.log10(Math.max(1, p.chains.length)),
    Math.log10(Math.max(1, fam / p.tvl_usd)),
  ];
}

const FEATURE_INDEX: Record<'mom' | 'ten' | 'br' | 'kin', number> = { mom: 2, ten: 3, br: 4, kin: 5 };

export interface Fitted {
  spec: Spec;
  beta: number[]; // aligned to the columns actually used, intercept first
  cols: number[]; // feature indexes used, in order
  catOffset: Map<string, number>;
  ctx: FitCtx;
}

const CAT_SHRINK = 8; // category offsets shrink toward 0 by n/(n+8)

export function fitModel(train: CompRow[], spec: Spec, famTvl: Map<string, number>, asOf: string): Fitted {
  const dated = train.map((r) => ageDays(r.p, asOf)).filter((d): d is number => d !== null);
  const ctx: FitCtx = { medianDays: dated.length ? median(dated) : 0, famTvl, asOf };
  const cols = [0, 1];
  if (spec.mom) cols.push(FEATURE_INDEX.mom);
  if (spec.ten) cols.push(FEATURE_INDEX.ten);
  if (spec.br) cols.push(FEATURE_INDEX.br);
  if (spec.kin) cols.push(FEATURE_INDEX.kin);
  const X = train.map((r) => {
    const f = features(r.p, ctx);
    return cols.map((c) => f[c]!);
  });
  const y = train.map((r) => r.logCap);
  const beta = huber(X, y);
  const catOffset = new Map<string, number>();
  if (spec.cat) {
    const byCat = new Map<string, number[]>();
    train.forEach((r, i) => {
      const key = r.p.category ?? '(none)';
      const resid = r.logCap - dot(beta, X[i]!);
      byCat.set(key, [...(byCat.get(key) ?? []), resid]);
    });
    for (const [cat, res] of byCat) catOffset.set(cat, median(res) * (res.length / (res.length + CAT_SHRINK)));
  }
  return { spec, beta, cols, catOffset, ctx };
}

export function predictLog(fit: Fitted, p: Protocol): number {
  const f = features(p, fit.ctx);
  let v = dot(fit.beta, fit.cols.map((c) => f[c]!));
  if (fit.spec.cat) v += fit.catOffset.get(p.category ?? '(none)') ?? 0;
  return v;
}

/** The additive pieces of one prediction, for the detail view's arithmetic. */
export function decompose(fit: Fitted, p: Protocol): { label: string; log: number }[] {
  const f = features(p, fit.ctx);
  const names: Record<number, string> = { 2: 'momentum', 3: 'tenure', 4: 'breadth', 5: 'family size' };
  const parts: { label: string; log: number }[] = [
    { label: 'intercept', log: fit.beta[0]! },
    { label: 'size curve × log TVL', log: fit.beta[1]! * f[1]! },
  ];
  fit.cols.slice(2).forEach((c, i) => parts.push({ label: names[c] ?? `term ${c}`, log: fit.beta[i + 2]! * f[c]! }));
  if (fit.spec.cat) parts.push({ label: 'category offset', log: fit.catOffset.get(p.category ?? '(none)') ?? 0 });
  return parts;
}

// ---------------------------------------------------------------------------
// Validation: leave-one-out and walk-forward median factor misses.

function looMiss(rows: CompRow[], spec: Spec, famTvl: Map<string, number>, asOf: string): number {
  const misses: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const train = rows.filter((_, j) => j !== i);
    const fit = fitModel(train, spec, famTvl, asOf);
    misses.push(factorMiss(predictLog(fit, rows[i]!.p), rows[i]!.logCap));
  }
  return median(misses);
}

function wfOrder(rows: CompRow[]): CompRow[] {
  // Oldest first; a protocol with no listed date is treated as the oldest cohort.
  return [...rows].sort((a, b) => {
    const ka = a.p.listed_at ?? '0000-00-00';
    const kb = b.p.listed_at ?? '0000-00-00';
    return ka < kb ? -1 : ka > kb ? 1 : a.p.slug < b.p.slug ? -1 : 1;
  });
}

function wfMiss(rows: CompRow[], spec: Spec, famTvl: Map<string, number>, asOf: string): number {
  const ordered = wfOrder(rows);
  const n = ordered.length;
  const firstTest = Math.floor(n * 0.6);
  const block = Math.max(1, Math.floor((n - firstTest) / 4));
  const misses: number[] = [];
  for (let b = 0; b < 4; b++) {
    const start = firstTest + b * block;
    const end = b === 3 ? n : start + block;
    if (start >= n) break;
    const fit = fitModel(ordered.slice(0, start), spec, famTvl, asOf);
    for (let i = start; i < end; i++) misses.push(factorMiss(predictLog(fit, ordered[i]!.p), ordered[i]!.logCap));
  }
  return median(misses);
}

export interface LadderStep {
  term: string;
  detail: string;
  round: number;
  looBefore: number;
  wfBefore: number;
  looAfter: number;
  wfAfter: number;
  kept: boolean;
}

export interface FitReport {
  spec: Spec;
  fit: Fitted;
  loo: number;
  wf: number;
  ladder: LadderStep[];
  flatLoo: number;
  flatWf: number;
  olsBase: { a: number; b: number };
  tsBase: { a: number; b: number };
  huberBase: { a: number; b: number };
}

const CANDIDATES: { key: keyof Spec; term: string; detail: string }[] = [
  { key: 'cat', term: 'Category offsets', detail: 'median residual per category, shrunk toward zero by n/(n+8)' },
  { key: 'mom', term: 'Momentum', detail: 'clamp(7-day TVL change, -40%, +60%) / 100' },
  { key: 'ten', term: 'Tenure', detail: 'exp(-days tracked / 540), a decaying no-token age term' },
  { key: 'br', term: 'Breadth', detail: 'log10 of the number of chains the protocol runs on' },
  { key: 'kin', term: 'Family size', detail: 'log10 of family TVL over own TVL, for names that share a stem' },
];

export function runLadder(rows: CompRow[], famTvl: Map<string, number>, asOf: string): FitReport {
  // The flat rule of thumb, priced as a candidate so it can be rejected in numbers.
  const flatPred = (p: Protocol) => Math.log10(0.25 * p.tvl_usd);
  const flatLoo = median(rows.map((r) => factorMiss(flatPred(r.p), r.logCap)));
  const ordered = wfOrder(rows);
  const firstTest = Math.floor(ordered.length * 0.6);
  const flatWf = median(ordered.slice(firstTest).map((r) => factorMiss(flatPred(r.p), r.logCap)));

  const xs = rows.map((r) => r.logTvl);
  const ys = rows.map((r) => r.logCap);
  const olsBeta = ols(rows.map((r) => [1, r.logTvl]), ys);
  const olsBase = { a: olsBeta[0]!, b: olsBeta[1]! };
  const tsBase = theilSen(xs, ys);
  const hubBeta = huber(rows.map((r) => [1, r.logTvl]), ys);
  const huberBase = { a: hubBeta[0]!, b: hubBeta[1]! };

  let spec: Spec = { ...BASE_SPEC };
  let loo = looMiss(rows, spec, famTvl, asOf);
  let wf = wfMiss(rows, spec, famTvl, asOf);
  const ladder: LadderStep[] = [];
  // Two passes over the candidates in a fixed order: a term rejected against
  // the bare size curve gets one more gated trial against the kept set,
  // because terms can interact. The gate itself never changes: both misses
  // must improve, and every trial is printed, kept or not.
  for (let round = 1; round <= 2; round++) {
    for (const cand of CANDIDATES) {
      if (spec[cand.key]) continue;
      const trial: Spec = { ...spec, [cand.key]: true };
      const tLoo = looMiss(rows, trial, famTvl, asOf);
      const tWf = wfMiss(rows, trial, famTvl, asOf);
      const kept = tLoo < loo - 1e-9 && tWf < wf - 1e-9;
      ladder.push({ term: cand.term, detail: cand.detail, round, looBefore: loo, wfBefore: wf, looAfter: tLoo, wfAfter: tWf, kept });
      if (kept) {
        spec = trial;
        loo = tLoo;
        wf = tWf;
      }
    }
  }
  return { spec, fit: fitModel(rows, spec, famTvl, asOf), loo, wf, ladder, flatLoo, flatWf, olsBase, tsBase, huberBase };
}

/** Out-of-fold residuals of a spec over the comparables: actual minus LOO prediction, in log10. */
export function looResiduals(rows: CompRow[], spec: Spec, famTvl: Map<string, number>, asOf: string): number[] {
  return rows.map((r, i) => {
    const train = rows.filter((_, j) => j !== i);
    const fit = fitModel(train, spec, famTvl, asOf);
    return r.logCap - predictLog(fit, r.p);
  });
}

// ---------------------------------------------------------------------------
// Launch odds: the snapshot's own record of who already has a token.

export interface BandStat {
  label: string;
  lo: number;
  hi: number; // days, Infinity for the last band
  n: number;
  k: number;
  rate: number; // Laplace-smoothed share
}

const BANDS: { label: string; lo: number; hi: number }[] = [
  { label: 'under 6 months', lo: 0, hi: 180 },
  { label: '6-12 months', lo: 180, hi: 365 },
  { label: '1-2 years', lo: 365, hi: 730 },
  { label: '2-4 years', lo: 730, hi: 1460 },
  { label: 'over 4 years', lo: 1460, hi: Infinity },
];

const launched = (p: Protocol): boolean => p.gecko_id !== null || p.symbol !== null;

function bandIndex(days: number): number {
  return BANDS.findIndex((b) => days >= b.lo && days < b.hi);
}

function bandStats(set: Protocol[], asOf: string): BandStat[] {
  return BANDS.map((b) => {
    const inBand = set.filter((p) => {
      const d = ageDays(p, asOf);
      return d !== null && d >= b.lo && d < b.hi;
    });
    const k = inBand.filter(launched).length;
    return { ...b, n: inBand.length, k, rate: (k + 1) / (inBand.length + 2) };
  });
}

export interface OddsReport {
  adopted: boolean;
  bands: BandStat[];
  baseRate: number;
  population: number;
  undated: number;
  splitAt: string;
  trainN: number;
  testN: number;
  brierModel: number;
  brierBase: number;
  catRates: { category: string; n: number; k: number; rate: number }[];
  oddsFor: (p: Protocol) => { odds: number; band: string; dated: boolean };
}

const CAT_MIN_N = 25;
const CAT_ODDS_SHRINK = 24;

export function launchOdds(protocols: Protocol[], asOf: string): OddsReport {
  const dated = protocols.filter((p) => p.listed_at !== null);
  const undated = protocols.length - dated.length;
  const splitAt = '2025-01-01';
  const train = dated.filter((p) => p.listed_at! < splitAt);
  const test = dated.filter((p) => p.listed_at! >= splitAt);
  const trainBands = bandStats(train, asOf);
  const trainBase = (train.filter(launched).length + 1) / (train.length + 2);
  let seModel = 0;
  let seBase = 0;
  for (const p of test) {
    const d = ageDays(p, asOf)!;
    const stat = trainBands[bandIndex(d)]!;
    const pm = stat.n >= 8 ? stat.rate : trainBase;
    const y = launched(p) ? 1 : 0;
    seModel += (pm - y) ** 2;
    seBase += (trainBase - y) ** 2;
  }
  const brierModel = test.length ? seModel / test.length : NaN;
  const brierBase = test.length ? seBase / test.length : NaN;
  const adopted = Number.isFinite(brierModel) && brierModel < brierBase;

  const bands = bandStats(dated, asOf);
  const baseRate = (dated.filter(launched).length + 1) / (dated.length + 2);
  const catCounts = new Map<string, { n: number; k: number }>();
  for (const p of dated) {
    const key = p.category ?? '(none)';
    const c = catCounts.get(key) ?? { n: 0, k: 0 };
    c.n += 1;
    if (launched(p)) c.k += 1;
    catCounts.set(key, c);
  }
  const catRates = [...catCounts.entries()]
    .filter(([, c]) => c.n >= CAT_MIN_N)
    .map(([category, c]) => ({ category, n: c.n, k: c.k, rate: (c.k + 1) / (c.n + 2) }))
    .sort((a, b) => b.n - a.n);
  const catRateOf = new Map(catRates.map((c) => [c.category, c.rate]));

  const oddsFor = (p: Protocol): { odds: number; band: string; dated: boolean } => {
    const d = ageDays(p, asOf);
    if (d === null) return { odds: baseRate, band: 'no listed date', dated: false };
    const stat = bands[bandIndex(d)]!;
    const catRate = catRateOf.get(p.category ?? '(none)');
    const odds = catRate === undefined ? stat.rate : (stat.k + CAT_ODDS_SHRINK * catRate) / (stat.n + CAT_ODDS_SHRINK);
    return { odds, band: stat.label, dated: true };
  };

  return {
    adopted,
    bands,
    baseRate,
    population: dated.length,
    undated,
    splitAt,
    trainN: train.length,
    testN: test.length,
    brierModel,
    brierBase,
    catRates,
    oddsFor,
  };
}

// ---------------------------------------------------------------------------
// Farm plans: mechanism-specific steps, priced in integer cents.

export const WEEKS = 12;
export const SESSIONS = 12;
export const TBILL_RATE = 0.04; // stated assumption: cash parked in T-bills yields 4%/yr
export const QUALIFYING_SHARE = 0.12; // stated assumption: farmers' qualifying capital ≈ 12% of TVL
export const DEFAULT_SIZE_USD = 1000;
export const DEFAULT_DROP_SHARE = 0.07;

/** Cents charged per on-chain action, by chain (a stated schedule, printed on the method page). */
export const GAS_CENTS: Record<string, number> = {
  Ethereum: 620,
  Binance: 45,
  Solana: 4,
  Base: 9,
  Arbitrum: 14,
  Optimism: 12,
  Polygon: 3,
  Avalanche: 28,
  Fantom: 6,
  Cronos: 8,
  Linea: 11,
  Mantle: 10,
  Scroll: 13,
  'zkSync Era': 12,
  Blast: 10,
  Bitcoin: 95,
};
export const GAS_DEFAULT_CENTS = 60;

export interface Mechanism {
  key: string;
  label: string;
  open: string; // what opening the position actually does
  weekly: string; // what a weekly session does
  risk: string; // the mechanism's own failure mode
  openActions: number;
  sessionActions: number;
  closeActions: number;
  minutes: number; // minutes per weekly session
  feeBp: number; // protocol fees and drag over the whole window, in bp of plan size
  feeWhy: string;
}

const MECH: Record<string, Mechanism> = {
  lending: {
    key: 'lending', label: 'Lending market',
    open: 'Supply the plan size as collateral and draw a borrow at about 60% loan-to-value, then re-supply the borrow once: the loop is what lending markets meter for points.',
    weekly: 'Check the health factor, top up collateral if it drifts under 1.6, roll the borrow and harvest any supply incentives into the position.',
    risk: 'Liquidation is the failure mode: a fast collateral drop with a thin health factor closes the position at a penalty.',
    openActions: 4, sessionActions: 2, closeActions: 3, minutes: 30, feeBp: 62,
    feeWhy: 'borrow interest at 4.5%/yr on the 60% borrowed share for 12 weeks',
  },
  lp: {
    key: 'lp', label: 'Liquidity provision',
    open: 'Split the plan size across the protocol\'s two busiest pools in proportion to their depth and add liquidity in range: pools are metered on liquidity actually in range.',
    weekly: 'Rebalance any position that drifted out of range, compound the fees it earned and re-check the pool share it holds.',
    risk: 'Impermanent loss is the failure mode: a one-sided price move leaves the position holding the falling asset.',
    openActions: 4, sessionActions: 3, closeActions: 2, minutes: 25, feeBp: 90,
    feeWhy: 'swap-fee drag and rebalancing slippage at 0.30% of size per month',
  },
  trading: {
    key: 'trading', label: 'Derivatives trading',
    open: 'Post the plan size as margin and open a first hedged pair of trades: derivatives venues meter margin posted and volume actually traded, not deposits alone.',
    weekly: 'Trade both directions in small clips toward the session volume target, keep the book delta-neutral and watch the funding rate before holding overnight.',
    risk: 'Funding and liquidation are the failure modes: a crowded side pays funding every few hours and a spike can close a leg.',
    openActions: 3, sessionActions: 6, closeActions: 2, minutes: 45, feeBp: 180,
    feeWhy: 'taker fees at 0.05% on 24 round trips plus average funding over 12 weeks',
  },
  prediction: {
    key: 'prediction', label: 'Prediction market',
    open: 'Fund the account with the plan size and take small positions on the most liquid event contracts: prediction markets meter accounts on volume and positions held to settlement.',
    weekly: 'Roll expiring positions into the next liquid contracts, keep any single event under a fifth of the account and settle finished contracts promptly.',
    risk: 'Event risk is the failure mode: a contract settles to zero on the losing side, so position size, not direction, is the control.',
    openActions: 3, sessionActions: 4, closeActions: 2, minutes: 35, feeBp: 120,
    feeWhy: 'spread and settlement drag at about 1.2% of size over 12 weeks of rolling',
  },
  vault: {
    key: 'vault', label: 'Vault deposit',
    open: 'Deposit the plan size into the protocol\'s main vault or strategy: vaults meter the balance that stays deposited, so the deposit itself is the position.',
    weekly: 'Confirm the vault share price moved as the strategy reports, compound any distributions and keep the deposit untouched unless the strategy changes.',
    risk: 'Strategy risk is the failure mode: the vault\'s underlying positions can lose value even while the share count holds.',
    openActions: 2, sessionActions: 1, closeActions: 2, minutes: 15, feeBp: 25,
    feeWhy: 'vault performance and management drag at about 0.25% of size over the window',
  },
  basis: {
    key: 'basis', label: 'Basis trade',
    open: 'Split the plan size between the spot leg and the margin leg of the basis position: basis desks meter both legs, and the hedge is what makes the position count.',
    weekly: 'Re-hedge the delta as prices move, check the basis has not inverted and roll the hedge before any expiry.',
    risk: 'Basis inversion is the failure mode: when the spread flips, the hedge pays out on the wrong side until it is rolled.',
    openActions: 4, sessionActions: 3, closeActions: 3, minutes: 30, feeBp: 85,
    feeWhy: 'hedge taker fees and funding on the short leg over 12 weeks',
  },
  staking: {
    key: 'staking', label: 'Staking',
    open: 'Stake the plan size with the protocol and hold the staking receipt in the same wallet: staking products meter the balance staked and how long it stays.',
    weekly: 'Confirm the staked balance and rewards accrued, restake rewards once they pass the gas cost of claiming and note any unbonding queue change.',
    risk: 'Lockup is the failure mode: unbonding queues can hold the capital for days after the decision to exit.',
    openActions: 2, sessionActions: 1, closeActions: 2, minutes: 12, feeBp: 15,
    feeWhy: 'staking commission drag at about 0.15% of size over the window',
  },
  rwa: {
    key: 'rwa', label: 'Real-world assets',
    open: 'Complete the product\'s onboarding once, then buy the plan size of its tokenised asset or vault share: RWA products meter holdings of the asset itself.',
    weekly: 'Confirm the holding and its reported yield, reinvest distributions and keep the onboarding documents current.',
    risk: 'Redemption risk is the failure mode: exits run on the issuer\'s schedule, not the market\'s, and can queue.',
    openActions: 3, sessionActions: 1, closeActions: 2, minutes: 20, feeBp: 40,
    feeWhy: 'issuance and redemption spread at about 0.40% of size over the window',
  },
  launchpad: {
    key: 'launchpad', label: 'Launchpad',
    open: 'Register the wallet and stake or hold the plan size in the launchpad\'s allocation asset: launchpads meter the balance held when allocations are drawn.',
    weekly: 'Check the allocation calendar, enter every sale the tier qualifies for and claim and hold whatever is allocated.',
    risk: 'Allocation risk is the failure mode: a small tier can draw dust allocations while the capital sits idle.',
    openActions: 3, sessionActions: 2, closeActions: 2, minutes: 20, feeBp: 35,
    feeWhy: 'participation spreads and claim drag at about 0.35% of size over the window',
  },
  chain: {
    key: 'chain', label: 'Chain usage',
    open: 'Bridge the plan size onto the chain and hold its gas asset: a chain meters wallets that hold value and transact on it, so presence plus activity is the position.',
    weekly: 'Make the session\'s transfers and contract calls spread across the week, keep the gas balance topped up and use a different native application each session.',
    risk: 'Bridge risk is the failure mode: the bridge back is the weakest link, so keep only the working balance on the far side.',
    openActions: 3, sessionActions: 4, closeActions: 2, minutes: 25, feeBp: 30,
    feeWhy: 'bridge spread at about 0.30% of size over the window',
  },
  stable: {
    key: 'stable', label: 'Stablecoin',
    open: 'Mint or buy the plan size of the protocol\'s stablecoin and place half in its deepest liquidity pool: issuers meter supply held and liquidity provided.',
    weekly: 'Check the peg held through the week, rebalance the pool leg and compound any yield the holding earned.',
    risk: 'Depeg risk is the failure mode: the position is only as sound as the collateral behind the peg.',
    openActions: 4, sessionActions: 2, closeActions: 3, minutes: 20, feeBp: 45,
    feeWhy: 'mint/redeem spread and pool drag at about 0.45% of size over the window',
  },
  payments: {
    key: 'payments', label: 'Payments',
    open: 'Fund the account with the plan size and route the first real payment through it: payment products meter accounts on settled volume, not balances.',
    weekly: 'Route the week\'s genuine spend through the product, keep the settled volume steady rather than spiky and reconcile every settlement.',
    risk: 'Clawback risk is the failure mode: reversed or disputed payments can pull settled volume back.',
    openActions: 2, sessionActions: 3, closeActions: 1, minutes: 20, feeBp: 110,
    feeWhy: 'processing take at about 1.1% of routed volume over the window',
  },
  generic: {
    key: 'generic', label: 'Core product use',
    open: 'Deposit the plan size into the protocol\'s core product and complete one full use of it end to end: programs meter wallets that actually use the product, not parked deposits.',
    weekly: 'Repeat the core use once, keep the balance in place between sessions and record what the product reports for the wallet.',
    risk: 'Product risk is the failure mode: an unaudited or thin product can lose the deposit itself, so size is the control.',
    openActions: 3, sessionActions: 2, closeActions: 2, minutes: 20, feeBp: 50,
    feeWhy: 'product fees and drag at about 0.50% of size over the window',
  },
};

const CATEGORY_MECH: Record<string, string> = {
  Lending: 'lending', CDP: 'lending', 'CDP Manager': 'lending',
  'Uncollateralized Lending': 'lending', 'Collateral Markets': 'lending', 'Collateral Management': 'lending',
  Dexs: 'lp', 'Liquidity Manager': 'lp',
  Derivatives: 'trading', Options: 'trading', 'Options Vault': 'trading', 'Interest Rate Derivatives': 'trading',
  'Prediction Market': 'prediction',
  Yield: 'vault', 'Yield Aggregator': 'vault', Farm: 'vault', 'Leveraged Farming': 'vault',
  'Risk Curators': 'vault', 'Onchain Capital Allocator': 'vault', CeDeFi: 'vault',
  'Basis Trading': 'basis',
  'Staking Pool': 'staking', Restaking: 'staking', 'Decentralized BTC': 'staking', 'Anchor BTC': 'staking',
  RWA: 'rwa', Launchpad: 'launchpad', Chain: 'chain',
  'Stablecoin Issuer': 'stable', 'Algo-Stables': 'stable', 'Dual-Token Stablecoin': 'stable', 'Stablecoin Wrapper': 'stable',
  Payments: 'payments', 'Crypto Card Issuer': 'payments',
  Indexes: 'vault', Synthetics: 'basis', Insurance: 'vault', 'Token Locker': 'staking',
  'Governance Incentives': 'vault', 'NFT Marketplace': 'payments', 'OTC Marketplace': 'payments',
  'AI Agents': 'payments', 'Decentralized AI': 'payments', DOR: 'payments', 'Reserve Currency': 'staking',
};

export function mechanismFor(category: string | null): Mechanism {
  const key = (category !== null && CATEGORY_MECH[category]) || 'generic';
  return MECH[key]!;
}

export function cheapestChain(chains: string[]): { chain: string; gasCents: number } {
  let best = { chain: chains[0] ?? 'Ethereum', gasCents: Infinity };
  for (const c of chains) {
    const g = GAS_CENTS[c] ?? GAS_DEFAULT_CENTS;
    if (g < best.gasCents) best = { chain: c, gasCents: g };
  }
  return best;
}

// ---------------------------------------------------------------------------
// Plan economics. The same arithmetic runs in the page's script from the same
// components, so the printed board.json text and the live page agree.

export interface EconInputs {
  tvl: number;
  gross: number; // model value in dollars
  odds: number;
  mech: Mechanism;
  gasCentsPerAction: number;
}

export interface Econ {
  sizeUsd: number;
  dropShare: number;
  gasC: number;
  feeC: number;
  oppC: number;
  costC: number;
  sliceC: number;
  expectedC: number;
  netC: number;
  hours: number;
  netPerHour: number; // dollars
  breakEvenPct: number; // drop share (percent) at which net = 0
  verdict: 'farm' | 'thin' | 'skip';
  reason: string;
}

export const usd = (cents: number): string => {
  const v = cents / 100;
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export function economics(inp: EconInputs, sizeUsd: number, dropShare: number): Econ {
  const sizeC = Math.round(sizeUsd * 100);
  const actions = inp.mech.openActions + SESSIONS * inp.mech.sessionActions + inp.mech.closeActions;
  const gasC = actions * inp.gasCentsPerAction;
  const feeC = Math.round((sizeC * inp.mech.feeBp) / 10000);
  const oppC = Math.round(sizeC * TBILL_RATE * (WEEKS / 52));
  const costC = gasC + feeC + oppC;
  const qualifying = QUALIFYING_SHARE * inp.tvl;
  const shareOfDrop = sizeUsd / (qualifying + sizeUsd);
  const sliceC = dropShare * inp.gross * shareOfDrop * 100;
  const expectedC = inp.odds * sliceC;
  const netC = Math.round(expectedC - costC);
  const hours = (SESSIONS * inp.mech.minutes) / 60;
  const netPerHour = netC / 100 / hours;
  const breakEvenPct = sliceC > 0 && inp.odds > 0 ? ((costC * dropShare) / (inp.odds * sliceC)) * 100 : Infinity;
  let verdict: Econ['verdict'];
  let reason: string;
  if (netC <= 0) {
    verdict = 'skip';
    reason = `expected slice ${usd(Math.round(expectedC))} covers only ${Math.round((expectedC / costC) * 100)}% of the ${usd(costC)} all-in cost`;
  } else if (netC < 2500) {
    verdict = 'thin';
    reason = `net ${usd(netC)} is under the $25.00 line even though the plan pays for itself`;
  } else if (netPerHour < 2) {
    verdict = 'thin';
    reason = `net ${usd(netC)} works out to $${netPerHour.toFixed(2)}/hr, under the $2.00/hr line`;
  } else {
    verdict = 'farm';
    reason = `all-in cost is ${Math.round((costC / expectedC) * 100)}% of the expected slice, net ${usd(netC)} at $${netPerHour.toFixed(2)}/hr`;
  }
  return {
    sizeUsd, dropShare, gasC, feeC, oppC, costC,
    sliceC: Math.round(sliceC), expectedC: Math.round(expectedC), netC,
    hours, netPerHour, breakEvenPct, verdict, reason,
  };
}

/** The 6 farm steps written into board.json, priced at the default scenario. */
export function farmSteps(p: Protocol, inp: EconInputs, econ: Econ, oddsBand: string): string[] {
  const { chain } = cheapestChain(p.chains);
  const sizeTxt = `$${econ.sizeUsd.toLocaleString('en-US')}`;
  const steps = [
    `Open on ${chain}, the cheapest of its ${p.chains.length} chain${p.chains.length === 1 ? '' : 's'} at ${inp.gasCentsPerAction}¢ an action. ${inp.mech.open} Capital committed: ${sizeTxt}.`,
    `Work it weekly for ${WEEKS} weeks: ${inp.mech.weekly} That is ${SESSIONS} sessions of about ${inp.mech.minutes} minutes, ${econ.hours.toFixed(1)} hours in all.`,
    `Costs, in cents and added up: gas ${econ.gasC}¢ over ${inp.mech.openActions + SESSIONS * inp.mech.sessionActions + inp.mech.closeActions} actions, protocol fees ${econ.feeC}¢ (${inp.mech.feeWhy}), T-bill opportunity cost ${econ.oppC}¢ at ${(TBILL_RATE * 100).toFixed(0)}%/yr. All-in ${usd(econ.costC)}.`,
    `Reward side, scenario S (${sizeTxt} plan, ${(econ.dropShare * 100).toFixed(1)}% of supply to farmers): the slice is ${usd(econ.sliceC)} of the ${moneyShort(inp.gross)} implied value, weighted by its launch odds of ${(inp.odds * 100).toFixed(0)}% (age band: ${oddsBand}, category-adjusted) to an expected ${usd(econ.expectedC)}.`,
    `Verdict ${econ.verdict.toUpperCase()}: net ${usd(econ.netC)}, ${econ.netPerHour >= 0 ? '' : '−'}$${Math.abs(econ.netPerHour).toFixed(2)}/hr, break-even at a ${Number.isFinite(econ.breakEvenPct) ? econ.breakEvenPct.toFixed(1) : '100+'}% drop share. Binding constraint: ${econ.reason}.`,
    `Risk and exit: ${inp.mech.risk} Unwind over the final week if no launch is announced by then; a launch announcement with a snapshot date overrides this plan.`,
  ];
  return steps.map((s) => (s.length > 598 ? `${s.slice(0, 595)}...` : s));
}

/** Compact money for prose: $2.76B, $312M, $45.2K, $812. */
export function moneyShort(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${Math.round(v)}`;
}

// ---------------------------------------------------------------------------
// Uncertainty: bootstrap bands on the board, hold rates measured out-of-fold.

export interface RowBands {
  p10: number;
  p25: number;
  p75: number;
  p90: number;
  rankLo: number;
  rankHi: number;
}

function bootstrap(
  comps: CompRow[],
  spec: Spec,
  famTvl: Map<string, number>,
  asOf: string,
  targets: Protocol[],
  reps: number,
  seed: number,
): number[][] {
  const rand = rng(seed);
  const perTarget: number[][] = targets.map(() => []);
  for (let b = 0; b < reps; b++) {
    const sample: CompRow[] = [];
    for (let i = 0; i < comps.length; i++) sample.push(comps[Math.floor(rand() * comps.length)]!);
    const fit = fitModel(sample, spec, famTvl, asOf);
    targets.forEach((p, j) => perTarget[j]!.push(predictLog(fit, p)));
  }
  return perTarget;
}

export interface HoldRates {
  folds: number;
  repsPerFold: number;
  tested: number;
  hold2575: number; // share of held-out caps inside the P25-P75 band
  hold1090: number; // share inside the P10-P90 band
}

/**
 * Predictive draws for target protocols: each bootstrap refit's prediction
 * plus one draw from the training set's own out-of-fold residual pool. A
 * band over fit uncertainty alone would claim a precision the model's
 * factor-miss does not have; the residual draw is what makes the band a
 * prediction band, and the hold rates below measure it honestly.
 */
function predictiveDraws(
  train: CompRow[],
  spec: Spec,
  famTvl: Map<string, number>,
  asOf: string,
  targets: Protocol[],
  reps: number,
  seed: number,
): number[][] {
  const resid = looResiduals(train, spec, famTvl, asOf);
  const preds = bootstrap(train, spec, famTvl, asOf, targets, reps, seed);
  const rand = rng(seed + 1);
  return preds.map((logs) => logs.map((lg) => lg + resid[Math.floor(rand() * resid.length)]!));
}

function holdRates(comps: CompRow[], spec: Spec, famTvl: Map<string, number>, asOf: string): HoldRates {
  const ordered = [...comps].sort((a, b) => (a.p.slug < b.p.slug ? -1 : 1));
  const folds = 10;
  const reps = 60;
  let tested = 0;
  let in2575 = 0;
  let in1090 = 0;
  for (let f = 0; f < folds; f++) {
    const test = ordered.filter((_, i) => i % folds === f);
    const train = ordered.filter((_, i) => i % folds !== f);
    if (test.length === 0) continue;
    const draws = predictiveDraws(train, spec, famTvl, asOf, test.map((r) => r.p), reps, 777000 + f);
    test.forEach((r, j) => {
      const logs = draws[j]!;
      tested += 1;
      if (r.logCap >= quantile(logs, 0.25) && r.logCap <= quantile(logs, 0.75)) in2575 += 1;
      if (r.logCap >= quantile(logs, 0.1) && r.logCap <= quantile(logs, 0.9)) in1090 += 1;
    });
  }
  return { folds, repsPerFold: reps, tested, hold2575: in2575 / tested, hold1090: in1090 / tested };
}

// ---------------------------------------------------------------------------
// Assembly: the whole radar from the snapshot.

export interface BoardRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl: number;
  ageDays: number | null;
  watchlist: boolean;
  gross: number;
  grossLog: number;
  odds: number;
  oddsBand: string;
  oddsDated: boolean;
  ev: number;
  rankValue: number;
  rank: number;
  implied: number;
  haircut: number; // multiplicative family haircut actually applied (1 = none)
  parts: { label: string; log: number }[];
  bands: RowBands;
  mechKey: string;
  gasChain: string;
  gasCentsPerAction: number;
  econ: Econ;
  farm_steps: string[];
}

export interface SetAsideMember {
  slug: string;
  name: string;
  category: string | null;
  tvl: number;
  group: GroupKey;
}

export interface Radar {
  asOf: string;
  source: string;
  floor: number;
  totalProtocols: number;
  accounting: { key: GroupKey; label: string; count: number }[];
  setAside: SetAsideMember[];
  groupMembers: Record<string, SetAsideMember[]>;
  comps: CompSet;
  report: FitReport;
  odds: OddsReport;
  holds: HoldRates;
  board: BoardRow[];
  scatter: { slug: string; tvl: number; cap: number; fitted: number; category: string | null }[];
  haircutRows: number;
  flatNote: string;
}

export function buildRadar(snap: Snapshot): Radar {
  const asOf = snap.as_of;
  const watch = new Set(snap.watchlist);
  const traded = tradedStems(snap.protocols);
  const famTvl = familyTvl(snap.protocols);

  const groups = new Map<GroupKey, Protocol[]>();
  for (const p of snap.protocols) {
    const g = classify(p, watch, traded);
    groups.set(g, [...(groups.get(g) ?? []), p]);
  }
  const order: GroupKey[] = ['ranked', 'trades', 'nocap', 'bridges', 'liqstake', 'cex', 'versioned', 'kin'];
  const accounting = order.map((key) => ({ key, label: GROUP_LABELS[key], count: (groups.get(key) ?? []).length }));
  const setAside: SetAsideMember[] = [];
  for (const key of order.slice(1)) {
    for (const p of groups.get(key) ?? []) {
      if (key !== 'trades' && key !== 'nocap') setAside.push({ slug: p.slug, name: p.name, category: p.category, tvl: p.tvl_usd, group: key });
    }
  }
  setAside.sort((a, b) => b.tvl - a.tvl);
  const groupMembers: Record<string, SetAsideMember[]> = {};
  for (const key of order) {
    groupMembers[key] = (groups.get(key) ?? [])
      .map((p) => ({ slug: p.slug, name: p.name, category: p.category, tvl: p.tvl_usd, group: key }))
      .sort((a, b) => b.tvl - a.tvl);
  }

  const comps = comparableSet(snap.protocols);
  const report = runLadder(comps.rows, famTvl, asOf);
  const fit = report.fit;
  const odds = launchOdds(snap.protocols, asOf);

  // The kin haircut: when the family term is in the model with a positive
  // coefficient, a board row whose sibling token already trades is priced as
  // a standalone product instead — the sibling's token already carries the
  // family premium this row would otherwise be credited with.
  const kinCol = fit.cols.indexOf(FEATURE_INDEX.kin);
  const kinBeta = kinCol >= 0 ? fit.beta[kinCol]! : 0;
  const haircutApplies = report.spec.kin && kinBeta > 0;

  const rankedProtos = (groups.get('ranked') ?? []).map((p) => {
    const grossLog = predictLog(fit, p);
    let haircut = 1;
    let adjLog = grossLog;
    if (haircutApplies && traded.has(stemOf(p.name))) {
      const soloCtx: FitCtx = { ...fit.ctx, famTvl: new Map(famTvl).set(stemOf(p.name), p.tvl_usd) };
      const solo = fitModelShallow(fit, soloCtx, p);
      haircut = Math.pow(10, solo - grossLog);
      adjLog = solo;
    }
    const gross = Math.pow(10, adjLog);
    const o = odds.oddsFor(p);
    const ev = gross * o.odds;
    return { p, gross, grossLog: adjLog, haircut, odds: o, ev, rankValue: odds.adopted ? ev : gross };
  });
  const haircutRows = rankedProtos.filter((r) => r.haircut < 1).length;

  rankedProtos.sort((a, b) => b.rankValue - a.rankValue || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));

  // Predictive bands over the ranking value (200 bootstrap refits, each draw
  // widened by the model's own out-of-fold residuals), and each row's rank
  // range across the same draws.
  const bootLogs = predictiveDraws(comps.rows, report.spec, famTvl, asOf, rankedProtos.map((r) => r.p), 200, 20261114);
  const bootValues = rankedProtos.map((r, j) => {
    const logs = bootLogs[j]!;
    return logs.map((lg) => {
      let v = Math.pow(10, lg);
      if (haircutApplies && traded.has(stemOf(r.p.name))) {
        // The haircut ratio is a property of the shipped fit; the draws are
        // taken over the unhaircut curve and scaled by the same ratio.
        v *= r.haircut;
      }
      return odds.adopted ? v * r.odds.odds : v;
    });
  });
  // Each row's rank across the 200 replicates; the printed range is its P10-P90.
  const rankSamples: number[][] = rankedProtos.map(() => []);
  for (let b = 0; b < 200; b++) {
    const idx = rankedProtos.map((_, j) => j).sort((x, y) => bootValues[y]![b]! - bootValues[x]![b]!);
    idx.forEach((j, pos) => rankSamples[j]!.push(pos + 1));
  }

  const board: BoardRow[] = rankedProtos.map((r, i) => {
    const mech = mechanismFor(r.p.category);
    const cheap = cheapestChain(r.p.chains);
    const inp: EconInputs = { tvl: r.p.tvl_usd, gross: r.gross, odds: r.odds.odds, mech, gasCentsPerAction: cheap.gasCents };
    const econ = economics(inp, DEFAULT_SIZE_USD, DEFAULT_DROP_SHARE);
    const values = bootValues[i]!;
    return {
      slug: r.p.slug,
      name: r.p.name,
      category: r.p.category,
      chains: r.p.chains,
      tvl: r.p.tvl_usd,
      ageDays: ageDays(r.p, asOf),
      watchlist: watch.has(r.p.slug),
      gross: r.gross,
      grossLog: r.grossLog,
      odds: r.odds.odds,
      oddsBand: r.odds.band,
      oddsDated: r.odds.dated,
      ev: r.ev,
      rankValue: r.rankValue,
      rank: i + 1,
      implied: Math.max(1, Math.round(r.rankValue)),
      haircut: r.haircut,
      parts: decompose(fit, r.p),
      bands: {
        p10: quantile(values, 0.1),
        p25: quantile(values, 0.25),
        p75: quantile(values, 0.75),
        p90: quantile(values, 0.9),
        rankLo: Math.round(quantile(rankSamples[i]!, 0.1)),
        rankHi: Math.round(quantile(rankSamples[i]!, 0.9)),
      },
      mechKey: mech.key,
      gasChain: cheap.chain,
      gasCentsPerAction: cheap.gasCents,
      econ,
      farm_steps: farmSteps(r.p, inp, econ, r.odds.band),
    };
  });

  const holds = holdRates(comps.rows, report.spec, famTvl, asOf);
  const scatter = comps.rows.map((r) => ({
    slug: r.p.slug,
    tvl: r.p.tvl_usd,
    cap: r.p.mcap_usd!,
    fitted: Math.pow(10, predictLog(fit, r.p)),
    category: r.p.category,
  }));

  return {
    asOf,
    source: snap.source,
    floor: snap.floor_usd,
    totalProtocols: snap.protocols.length,
    accounting,
    setAside,
    groupMembers,
    comps,
    report,
    odds,
    holds,
    board,
    scatter,
    haircutRows,
    flatNote: 'the flat 0.25 x TVL rule of thumb, priced by the same gate and rejected',
  };
}

/** Re-predict one protocol under an existing fit but a swapped context (for the haircut). */
function fitModelShallow(fit: Fitted, ctx: FitCtx, p: Protocol): number {
  const swapped: Fitted = { ...fit, ctx };
  return predictLog(swapped, p);
}

/** The board.json rows, exactly the gate's shape. */
export function boardRows(radar: Radar): { slug: string; name: string; rank: number; implied_value_usd: number; farm_steps: string[] }[] {
  return radar.board.map((r) => ({
    slug: r.slug,
    name: r.name,
    rank: r.rank,
    implied_value_usd: r.implied,
    farm_steps: r.farm_steps,
  }));
}

/** Self-check against the sealed gate's board rules; returns the first problem or null. */
export function boardIssue(radar: Radar, snap: Snapshot): string | null {
  const rows = radar.board;
  if (rows.length < 100 || rows.length > 4000) return `board holds ${rows.length} rows, outside 100..4000`;
  const seen = new Set<string>();
  let prev = Infinity;
  const watch = new Set(snap.watchlist);
  for (const r of rows) {
    if (seen.has(r.slug)) return `duplicate slug ${r.slug}`;
    seen.add(r.slug);
    if (r.implied < 1 || r.implied > 1e14) return `${r.slug}: implied value out of range`;
    if (r.implied > prev) return `${r.slug}: implied value rises at rank ${r.rank}`;
    prev = r.implied;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug}: ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim().length;
      if (t < 20 || t > 600) return `${r.slug}: a farm step is ${t} chars`;
    }
  }
  for (const slug of watch) if (!seen.has(slug)) return `watchlist slug missing from the board: ${slug}`;
  const nonWatch = rows.filter((r) => !watch.has(r.slug)).length;
  if (nonWatch < 60) return `only ${nonWatch} non-watchlist rows`;
  const sum = radar.accounting.reduce((a, g) => a + g.count, 0);
  if (sum !== snap.protocols.length) return `accounting sums to ${sum}, snapshot holds ${snap.protocols.length}`;
  return null;
}
