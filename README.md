# makefun-token-radar-v4

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/mangkarones3-afk/makefun-token-radar-v4/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/mangkarones3-afk/makefun-token-radar-v4/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

An entry for make.fun's **token-radar-01** bounty ("Build the best token launch
radar"), built from the kit's frozen DefiLlama snapshot alone — no network, no
hand-set multiples, no hand-typed statistics. Every figure on the page is
computed by the shipped program from the snapshot's own numbers.

## What it does

The snapshot holds 758 protocols at ≥ $5M TVL. The radar accounts for every
one of them exactly once (ranked / token already trades / token recorded with
no priced cap / bridges / liquid staking / exchange custody / versioned / kin
of a trading token — the counts sum to 758), and ranks the 197 pre-token
protocols that remain, including all 40 on the house watchlist.

**The value model.** A Huber-robust size curve, `log10 value = a + b·log10 TVL`,
is fitted on the standalone traded tokens the snapshot itself supplies. The
comparable set is built by a printed rule: of 416 protocols recording a token,
128 carry a positive market cap (a cap of 0 or −1 is the snapshot's no-price
sentinel); symbol-only rows and repeat deployments of one token are dropped by
rule (in this snapshot, 0 of each), and a further 30 are set aside by the
fit-pool rule — the curve is not fitted on bridge, liquid-staking, restaking
or exchange tokens, whose caps are carried by another asset or venue rather
than priced as standalone products — leaving **98 standalone traded tokens**.
Candidate extra terms — category offsets, momentum (clamped 7-day TVL
change), tenure (a decaying function of days tracked), breadth (chain count),
family size (family TVL over own TVL) — are admitted **only** if each improves
both the leave-one-out median factor miss and a walk-forward miss (fit on the
oldest, predict the newest 40%). Two passes are run and every trial is printed
on the Method page, kept or rejected. The shipped model keeps the size curve
plus the breadth term: **LOO ×3.35, walk-forward ×2.86** (the flat 0.25× TVL
rule scores ×4.34 / ×4.07 on the same pool and is rejected by the same gate).
Least-squares and Theil–Sen fits are printed as cross-checks.

**Launch odds.** From the snapshot's own record: the share of protocols whose
token already trades, by tracked-age band, category-adjusted and smoothed.
Validated on a listing-date split (fit before 2025, test since), it beat the
constant base rate held out (Brier 0.2833 vs 0.3201), so the board ranks by
expected value = implied value × odds, printing both figures per row. Had it
failed, the board would rank by implied value and the failure would stay
printed.

**Uncertainty.** 200 bootstrap refits, each draw widened by the model's own
out-of-fold residuals, give every row a P25–P75 and P10–P90 value band and a
P10–P90 rank range. Measured out-of-fold, the bands held 48% (P25–P75) and 81%
(P10–P90) of held-out caps — near their nominal marks, and printed on the page.

**Farm plans.** Each row carries a mechanism-specific plan (what a lending
loop, an LP position, a vault deposit actually does), priced in integer cents
from two stated schedules — gas per action by chain, protocol fees in basis
points by mechanism — plus a T-bill opportunity-cost line at 4%/yr. Scenario S
(plan size, drop share, farmers' qualifying capital ≈ 12% of TVL, pro-rata
split) is an assumption set for comparing plans, not a forecast. Every verdict
(farm / thin / skip) prints its binding constraint. The page's scenario
controls ($500 / $1,000 / $10,000 × 3.5% / 7% / 14%) reprice every plan live,
with arithmetic that matches the program's cent for cent.

**Layout.** `main.ts` is the entry point (snapshot in, outputs out, gate
self-check); `lib/model.ts` holds classification, the comparable set, the
gated fit, launch odds, bootstrap bands, farm economics and plan text;
`lib/stats.ts` is the deterministic numeric toolkit (seeded RNG, Huber IRLS,
Theil–Sen, quantiles); `lib/render.ts` assembles the dashboard's data payload.
`dashboard/` is the static page, `screenshots/` the four judged views rendered
from it, `data/snapshot.json` the frozen snapshot (byte-identical to the
kit's), and `vendor/makefun-board.ts` the kit's dossier library, copied
unchanged. The program writes `board.json`, `data.js`, `dashboard/` and
`screenshots/` into the output directory, then `dossier.json` via the vendored
`buildDossier('/output', { text_max_bytes: 65536 })`; two runs write identical
bytes. Open `dashboard/index.html` from the output directory (it reads
`../data.js`) — board, per-protocol detail with the full pricing arithmetic,
method & gate page with the traded-token scatter, a compare view, the
set-aside accounting, and a CSV export, all offline.

## Run it

```sh
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts            # reads data/snapshot.json
node main.ts --input /input --output /output   # the grader's layout
```

---
<sub>Entered on [make.fun](https://make.fun/?ref=ram1fzcx&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
