// Assembles the dashboard's data payload (written as /output/data.js) from the
// fitted radar. The page is a static reader of this one object; every figure
// it shows comes from here, and everything here was computed by lib/model.ts.

import {
  FIT_EXCLUDED_CATS,
  GAS_CENTS,
  GAS_DEFAULT_CENTS,
  QUALIFYING_SHARE,
  SESSIONS,
  TBILL_RATE,
  WEEKS,
  mechanismFor,
  type Radar,
} from './model.ts';

const TERM_LABELS: Record<number, string> = {
  0: 'intercept',
  1: 'log10 TVL (size curve)',
  2: 'momentum',
  3: 'tenure',
  4: 'breadth',
  5: 'family size',
};

export function dataScript(radar: Radar): string {
  const fit = radar.report.fit;
  const payload = {
    meta: {
      asOf: radar.asOf,
      source: radar.source,
      floor: radar.floor,
      total: radar.totalProtocols,
      boardRows: radar.board.length,
      watchlistOnBoard: radar.board.filter((r) => r.watchlist).length,
    },
    model: {
      spec: radar.report.spec,
      terms: fit.cols.map((c, i) => ({ label: TERM_LABELS[c]!, coef: fit.beta[i]! })),
      catOffsets: [...fit.catOffset.entries()].map(([category, offset]) => ({ category, offset })),
      loo: radar.report.loo,
      wf: radar.report.wf,
      flatLoo: radar.report.flatLoo,
      flatWf: radar.report.flatWf,
      olsBase: radar.report.olsBase,
      tsBase: radar.report.tsBase,
      huberBase: radar.report.huberBase,
      ladder: radar.report.ladder,
      comps: {
        n: radar.comps.rows.length,
        tradedRows: radar.comps.tradedRows,
        recordedTokens: radar.comps.recordedTokens,
        droppedSymbolOnly: radar.comps.droppedSymbolOnly,
        droppedDeployments: radar.comps.droppedDeployments,
        droppedCategory: radar.comps.droppedCategory,
        excludedCats: [...FIT_EXCLUDED_CATS],
      },
      haircutRows: radar.haircutRows,
    },
    odds: {
      adopted: radar.odds.adopted,
      bands: radar.odds.bands.map((b) => ({ label: b.label, n: b.n, k: b.k, rate: b.rate })),
      baseRate: radar.odds.baseRate,
      population: radar.odds.population,
      undated: radar.odds.undated,
      splitAt: radar.odds.splitAt,
      trainN: radar.odds.trainN,
      testN: radar.odds.testN,
      brierModel: radar.odds.brierModel,
      brierBase: radar.odds.brierBase,
      catRates: radar.odds.catRates,
    },
    holds: radar.holds,
    accounting: radar.accounting,
    setAside: radar.setAside,
    groups: radar.groupMembers,
    assumptions: {
      weeks: WEEKS,
      sessions: SESSIONS,
      tbillRate: TBILL_RATE,
      qualifyingShare: QUALIFYING_SHARE,
      gasDefault: GAS_DEFAULT_CENTS,
      gas: GAS_CENTS,
    },
    board: radar.board.map((r) => {
      const mech = mechanismFor(r.category);
      return {
        slug: r.slug,
        name: r.name,
        category: r.category,
        chains: r.chains,
        tvl: r.tvl,
        ageDays: r.ageDays,
        watchlist: r.watchlist,
        gross: r.gross,
        odds: r.odds,
        oddsBand: r.oddsBand,
        oddsDated: r.oddsDated,
        ev: r.ev,
        rankValue: r.rankValue,
        rank: r.rank,
        implied: r.implied,
        haircut: r.haircut,
        parts: r.parts,
        bands: r.bands,
        gasChain: r.gasChain,
        gasCents: r.gasCentsPerAction,
        mech: {
          key: mech.key,
          label: mech.label,
          open: mech.open,
          weekly: mech.weekly,
          risk: mech.risk,
          openActions: mech.openActions,
          sessionActions: mech.sessionActions,
          closeActions: mech.closeActions,
          minutes: mech.minutes,
          feeBp: mech.feeBp,
          feeWhy: mech.feeWhy,
        },
      };
    }),
    scatter: radar.scatter,
  };
  return `window.RADAR_DATA = ${JSON.stringify(payload)};\n`;
}
