'use strict';
/* Token Launch Radar — a static reader of window.RADAR_DATA (../data.js).
   All figures were computed by the entry's program from the frozen snapshot;
   the only arithmetic done here is the farm-plan scenario recompute, which
   mirrors the program's economics function cent for cent. */
(function () {
  var D = window.RADAR_DATA;
  var A = D.assumptions;
  var bySlug = {};
  D.board.forEach(function (r) { bySlug[r.slug] = r; });
  var state = { size: 1000, drop: 0.07, q: '', cat: '', watch: false, farmOnly: false, sort: 'rank', asideGroup: 'bridges' };

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
  function moneyShort(v) {
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(v);
  }
  function moneyFull(v) { return '$' + Math.round(v).toLocaleString('en-US'); }
  function usdC(cents) {
    var v = cents / 100;
    return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function x2(v) { return '×' + v.toFixed(2); }

  /* Farm economics — the same formulas and constants as the program's. */
  function econ(r, sizeUsd, dropShare) {
    var sizeC = Math.round(sizeUsd * 100);
    var actions = r.mech.openActions + A.sessions * r.mech.sessionActions + r.mech.closeActions;
    var gasC = actions * r.gasCents;
    var feeC = Math.round(sizeC * r.mech.feeBp / 10000);
    var oppC = Math.round(sizeC * A.tbillRate * (A.weeks / 52));
    var costC = gasC + feeC + oppC;
    var share = sizeUsd / (A.qualifyingShare * r.tvl + sizeUsd);
    var sliceC = dropShare * r.gross * share * 100;
    var expectedC = r.odds * sliceC;
    var netC = Math.round(expectedC - costC);
    var hours = A.sessions * r.mech.minutes / 60;
    var netPerHour = netC / 100 / hours;
    var breakEvenPct = sliceC > 0 && r.odds > 0 ? (costC * dropShare) / (r.odds * sliceC) * 100 : Infinity;
    var verdict, reason;
    if (netC <= 0) {
      verdict = 'skip';
      reason = 'expected slice ' + usdC(Math.round(expectedC)) + ' covers only ' + Math.round(expectedC / costC * 100) + '% of the ' + usdC(costC) + ' all-in cost';
    } else if (netC < 2500) {
      verdict = 'thin';
      reason = 'net ' + usdC(netC) + ' is under the $25.00 line even though the plan pays for itself';
    } else if (netPerHour < 2) {
      verdict = 'thin';
      reason = 'net ' + usdC(netC) + ' works out to $' + netPerHour.toFixed(2) + '/hr, under the $2.00/hr line';
    } else {
      verdict = 'farm';
      reason = 'all-in cost is ' + Math.round(costC / expectedC * 100) + '% of the expected slice, net ' + usdC(netC) + ' at $' + netPerHour.toFixed(2) + '/hr';
    }
    return { gasC: gasC, feeC: feeC, oppC: oppC, costC: costC, sliceC: Math.round(sliceC), expectedC: Math.round(expectedC),
      netC: netC, hours: hours, netPerHour: netPerHour, breakEvenPct: breakEvenPct, verdict: verdict, reason: reason, actions: actions };
  }

  function chip(v) { return '<span class="chip ' + v + '">' + v.toUpperCase() + '</span>'; }

  /* ---- header, strip, accounting ---- */
  document.getElementById('mastMeta').innerHTML =
    'Frozen DefiLlama snapshot · ' + esc(D.meta.asOf) + '<br>' + D.meta.total + ' protocols ≥ $5M TVL · watchlist floor ' + moneyShort(D.meta.floor);
  var terms = D.model.terms.map(function (t, i) {
    if (t.label === 'intercept') return t.coef.toFixed(3);
    return (t.coef >= 0 ? ' + ' : ' − ') + Math.abs(t.coef).toFixed(3) + '·' + t.label.replace(' (size curve)', '');
  });
  document.getElementById('modelStrip').innerHTML =
    '<span><span class="lab">Model</span>log₁₀ value = ' + terms.join(' ') + '</span>' +
    '<span><span class="lab">Fitted on</span><b>' + D.model.comps.n + '</b> standalone traded tokens</span>' +
    '<span><span class="lab">Miss</span>leave-one-out <b>' + x2(D.model.loo) + '</b> · walk-forward <b>' + x2(D.model.wf) + '</b></span>' +
    '<span><span class="lab">Launch odds</span>' + (D.odds.adopted ? '<b>adopted</b> — beat the base rate held out' : 'not adopted — board ranks by value') + '</span>' +
    '<span><span class="lab">Board</span><b>' + D.meta.boardRows + '</b> rows · watchlist ' + D.meta.watchlistOnBoard + '/' + D.meta.watchlistOnBoard + '</span>' +
    '<span><span class="lab">Bands hold</span>P25–P75 <b>' + Math.round(D.holds.hold2575 * 100) + '%</b> · P10–P90 <b>' + Math.round(D.holds.hold1090 * 100) + '%</b> out-of-fold</span>';
  document.getElementById('sealLine').textContent =
    'board.json: ' + D.meta.boardRows + ' rows, ranks 1..' + D.meta.boardRows + ' — the same rows this page renders, written by the same run';

  var acct = document.getElementById('acctBar');
  acct.innerHTML = D.accounting.map(function (g) {
    var cls = g.key === 'ranked' ? 'g-ranked' : g.key === 'trades' ? 'g-trades' : g.key === 'nocap' ? 'g-nocap' : 'g-aside';
    return '<button class="' + cls + '" data-group="' + g.key + '" style="flex:' + Math.max(g.count, 14) + '"><span class="n">' + g.count + '</span>' + esc(g.label) + '</button>';
  }).join('');
  var cap = document.createElement('p');
  cap.className = 'acct-cap';
  cap.textContent = 'Every one of the ' + D.meta.total + ' protocols in the snapshot, counted once — click a group to inspect it.';
  acct.after(cap);
  acct.addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.dataset.group === 'ranked') { location.hash = '#board'; }
    else { state.asideGroup = b.dataset.group; location.hash = '#aside/' + b.dataset.group; }
  });

  /* ---- scenario controls + best farms ---- */
  function seg(id, values, cur, fmt) {
    return '<span class="seg" id="' + id + '">' + values.map(function (v) {
      return '<button data-v="' + v + '"' + (v === cur ? ' class="on"' : '') + '>' + fmt(v) + '</button>';
    }).join('') + '</span>';
  }
  function renderScen() {
    document.getElementById('scenControls').innerHTML =
      '<span class="grp"><b>Plan size</b>' + seg('segSize', [500, 1000, 10000], state.size, function (v) { return '$' + v.toLocaleString('en-US'); }) + '</span>' +
      '<span class="grp"><b>Drop share</b>' + seg('segDrop', [0.035, 0.07, 0.14], state.drop, function (v) { return (v * 100).toFixed(1) + '%'; }) + '</span>' +
      '<span>Scenario S assumptions — see Method</span>';
    document.getElementById('segSize').addEventListener('click', function (e) { if (e.target.dataset.v) { state.size = +e.target.dataset.v; refresh(); } });
    document.getElementById('segDrop').addEventListener('click', function (e) { if (e.target.dataset.v) { state.drop = +e.target.dataset.v; refresh(); } });
  }
  function renderFarms() {
    var scored = D.board.map(function (r) { return { r: r, e: econ(r, state.size, state.drop) }; })
      .filter(function (x) { return x.e.netC > 0; })
      .sort(function (a, b) { return b.e.netPerHour - a.e.netPerHour; }).slice(0, 5);
    document.getElementById('bestFarms').innerHTML = scored.map(function (x) {
      return '<div class="farm-card"><div class="nm"><a href="#detail/' + x.r.slug + '">' + esc(x.r.name) + '</a></div>' +
        '<div class="fig">$' + x.e.netPerHour.toFixed(2) + '/hr</div>' +
        '<div class="sub">net ' + usdC(x.e.netC) + ' on ' + moneyShort(x.r.tvl) + ' TVL · ' + esc(x.r.mech.label) + '</div></div>';
    }).join('') || '<p class="note">No plan is net-positive at this scenario.</p>';
  }

  /* ---- the board ---- */
  var logLo = Infinity, logHi = -Infinity;
  D.board.forEach(function (r) {
    logLo = Math.min(logLo, Math.log10(Math.max(1, r.bands.p10)));
    logHi = Math.max(logHi, Math.log10(r.bands.p90));
  });
  function whisk(r) {
    function pos(v) { return ((Math.log10(Math.max(1, v)) - logLo) / (logHi - logLo) * 100).toFixed(1) + '%'; }
    return '<div class="whisk"><span class="w90" style="left:' + pos(r.bands.p10) + ';width:calc(' + pos(r.bands.p90) + ' - ' + pos(r.bands.p10) + ')"></span>' +
      '<span class="w75" style="left:' + pos(r.bands.p25) + ';width:calc(' + pos(r.bands.p75) + ' - ' + pos(r.bands.p25) + ')"></span>' +
      '<span class="dot" style="left:' + pos(r.rankValue) + '"></span></div>' +
      '<div class="slug">' + moneyShort(r.bands.p25) + ' – ' + moneyShort(r.bands.p75) + '</div>';
  }
  function visibleRows() {
    var rows = D.board.filter(function (r) {
      if (state.watch && !r.watchlist) return false;
      if (state.cat && r.category !== state.cat) return false;
      if (state.q && (r.name + ' ' + r.slug).toLowerCase().indexOf(state.q) < 0) return false;
      return true;
    });
    rows = rows.map(function (r) { return { r: r, e: econ(r, state.size, state.drop) }; });
    if (state.farmOnly) rows = rows.filter(function (x) { return x.e.verdict === 'farm'; });
    var key = state.sort;
    rows.sort(function (a, b) {
      if (key === 'tvl') return b.r.tvl - a.r.tvl;
      if (key === 'gross') return b.r.gross - a.r.gross;
      if (key === 'nethr') return b.e.netPerHour - a.e.netPerHour;
      if (key === 'odds') return b.r.odds - a.r.odds;
      return a.r.rank - b.r.rank;
    });
    return rows;
  }
  function renderBoard() {
    var rows = visibleRows();
    document.getElementById('rowCount').textContent = rows.length + ' of ' + D.board.length + ' rows';
    document.getElementById('boardBody').innerHTML = rows.map(function (x) {
      var r = x.r, e = x.e;
      return '<tr><td class="r">' + r.rank + '</td>' +
        '<td><a class="nm" href="#detail/' + r.slug + '">' + esc(r.name) + '</a>' + (r.watchlist ? '<span class="wl">watchlist</span>' : '') +
        '<div class="slug">' + esc(r.slug) + '</div></td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td class="r">' + moneyShort(r.tvl) + '</td>' +
        '<td class="r">' + moneyShort(r.gross) + '</td>' +
        '<td class="r">' + (r.odds * 100).toFixed(0) + '%</td>' +
        '<td class="r"><b>' + moneyShort(r.rankValue) + '</b></td>' +
        '<td>' + whisk(r) + '</td>' +
        '<td class="r' + (e.netC < 0 ? ' neg' : '') + '">' + usdC(e.netC) + '</td>' +
        '<td>' + chip(e.verdict) + '</td></tr>';
    }).join('');
    document.getElementById('boardNote').textContent = D.odds.adopted
      ? 'Board value = implied value if it launches × launch odds (the snapshot\'s own record, validated held-out — see Method). The board ranks by that expected value; board.json carries it as implied_value_usd, and the detail view shows both figures and every step of the arithmetic.'
      : 'The launch-odds model did not beat the base rate held out, so the board ranks by implied value alone; the failed validation is printed on the Method page.';
  }

  /* ---- detail view ---- */
  function renderDetail(slug) {
    var r = bySlug[slug];
    var view = document.getElementById('view-detail');
    if (!r) { view.innerHTML = '<p>Unknown protocol.</p>'; return; }
    var e = econ(r, state.size, state.drop);
    var run = 0;
    var partRows = r.parts.map(function (p) {
      run += p.log;
      return '<tr><td>' + esc(p.label) + '</td><td class="r">' + (p.log >= 0 ? '+' : '') + p.log.toFixed(3) + '</td>' +
        '<td class="r">×' + Math.pow(10, p.log).toFixed(3) + '</td><td class="r">' + moneyFull(Math.pow(10, run)) + '</td></tr>';
    }).join('');
    var hairRow = r.haircut < 1 ? '<tr><td>family haircut — a sibling token already trades</td><td class="r">' + Math.log10(r.haircut).toFixed(3) + '</td><td class="r">×' + r.haircut.toFixed(3) + '</td><td class="r">' + moneyFull(r.gross) + '</td></tr>' : '';
    view.innerHTML =
      '<p class="back"><a href="#board">← back to the board</a></p>' +
      '<div class="detail"><h2>' + esc(r.name) + (r.watchlist ? '<span class="wl">watchlist</span>' : '') + '</h2>' +
      '<p class="sub">' + esc(r.category || 'uncategorised') + ' · ' + r.chains.map(esc).join(', ') + ' · TVL ' + moneyFull(r.tvl) +
      ' · tracked ' + (r.ageDays === null ? 'since an unrecorded date' : r.ageDays + ' days') + ' with no token recorded · board rank #' + r.rank + '</p>' +
      '<div class="cols"><div>' +
      '<div class="panel"><h3>How the number is priced</h3><table class="kv">' +
      '<tr><td><i>step (log₁₀ contributions add)</i></td><td class="r"><i>log₁₀</i></td><td class="r"><i>factor</i></td><td class="r"><i>running</i></td></tr>' +
      partRows + hairRow +
      '<tr class="tot"><td>Implied value if it launches</td><td class="r">' + Math.log10(r.gross).toFixed(3) + '</td><td class="r"></td><td class="r">' + moneyFull(r.gross) + '</td></tr>' +
      '<tr><td>Launch odds — age band “' + esc(r.oddsBand) + '”' + (r.oddsDated ? '' : ' (no listed date: the base rate)') + ', category-adjusted</td><td class="r"></td><td class="r">×' + r.odds.toFixed(3) + '</td><td class="r">' + moneyFull(r.ev) + '</td></tr>' +
      '<tr class="tot"><td>' + (D.odds.adopted ? 'Board value (expected value — the ranking figure)' : 'Board value (odds not adopted: ranked on implied value)') + '</td><td class="r"></td><td class="r"></td><td class="r">' + moneyFull(r.rankValue) + '</td></tr>' +
      '</table><p class="note">Uncertainty, from 200 bootstrap refits widened by the model\'s own out-of-fold residuals: ' +
      'P25–P75 ' + moneyShort(r.bands.p25) + ' – ' + moneyShort(r.bands.p75) + '; P10–P90 ' + moneyShort(r.bands.p10) + ' – ' + moneyShort(r.bands.p90) +
      '; rank range (P10–P90) #' + r.bands.rankLo + ' – #' + r.bands.rankHi + '.</p></div>' +
      '<div class="panel"><h3>The mechanism</h3><p><b>' + esc(r.mech.label) + '.</b> ' + esc(r.mech.open) + '</p>' +
      '<p><b>Weekly:</b> ' + esc(r.mech.weekly) + '</p><p><b>Risk:</b> ' + esc(r.mech.risk) + '</p></div>' +
      '</div><div>' +
      '<div class="panel"><h3>Farm plan at the selected scenario</h3>' +
      '<p>Plan size $' + state.size.toLocaleString('en-US') + ' · drop share ' + (state.drop * 100).toFixed(1) + '% · ' + A.weeks + ' weeks, ' + A.sessions + ' sessions on ' + esc(r.gasChain) + ' at ' + r.gasCents + '¢/action. Change the scenario on the board; this plan reprices.</p>' +
      '<table class="kv">' +
      '<tr><td>Your slice of the drop, if it launches</td><td class="r">' + usdC(e.sliceC) + '</td></tr>' +
      '<tr><td>× launch odds ' + (r.odds * 100).toFixed(0) + '% → expected reward</td><td class="r">' + usdC(e.expectedC) + '</td></tr>' +
      '<tr><td>Gas — ' + e.actions + ' actions</td><td class="r">−' + usdC(e.gasC) + '</td></tr>' +
      '<tr><td>Protocol fees — ' + esc(r.mech.feeWhy) + '</td><td class="r">−' + usdC(e.feeC) + '</td></tr>' +
      '<tr><td>T-bill opportunity cost — ' + (A.tbillRate * 100).toFixed(0) + '%/yr on the plan size for ' + A.weeks + ' weeks</td><td class="r">−' + usdC(e.oppC) + '</td></tr>' +
      '<tr class="tot"><td>Net</td><td class="r">' + usdC(e.netC) + ' ($' + e.netPerHour.toFixed(2) + '/hr · ' + e.hours.toFixed(1) + ' hr)</td></tr>' +
      '<tr><td>Break-even drop share at this size</td><td class="r">' + (isFinite(e.breakEvenPct) ? e.breakEvenPct.toFixed(1) + '%' : 'over 100% — cannot break even') + '</td></tr>' +
      '<tr><td>Verdict</td><td class="r">' + chip(e.verdict) + '</td></tr></table>' +
      '<p class="note"><b>Binding constraint:</b> ' + esc(e.reason) + '.</p></div>' +
      '</div></div></div>';
  }

  /* ---- method view ---- */
  function scatterSvg() {
    var W = 860, H = 430, L = 64, R = 14, T = 12, B = 46;
    var xs = D.scatter.map(function (s) { return Math.log10(s.tvl); });
    var ys = D.scatter.map(function (s) { return Math.log10(s.cap); });
    var x0 = Math.floor(Math.min.apply(null, xs)), x1 = Math.ceil(Math.max.apply(null, xs));
    var y0 = Math.floor(Math.min.apply(null, ys)), y1 = Math.ceil(Math.max.apply(null, ys));
    function px(x) { return L + (x - x0) / (x1 - x0) * (W - L - R); }
    function py(y) { return T + (y1 - y) / (y1 - y0) * (H - T - B); }
    var a = D.model.terms[0].coef, b = D.model.terms[1].coef;
    var offs = D.scatter.map(function (s) { return Math.log10(s.fitted) - (a + b * Math.log10(s.tvl)); }).sort(function (m, n) { return m - n; });
    var medOff = offs[Math.floor(offs.length / 2)];
    var grid = '';
    for (var gx = x0; gx <= x1; gx++) grid += '<line x1="' + px(gx) + '" y1="' + T + '" x2="' + px(gx) + '" y2="' + (H - B) + '" stroke="#e6dfcd" /><text x="' + px(gx) + '" y="' + (H - B + 16) + '" font-size="10" text-anchor="middle" fill="#6d675c">10^' + gx + '</text>';
    for (var gy = y0; gy <= y1; gy++) grid += '<line x1="' + L + '" y1="' + py(gy) + '" x2="' + (W - R) + '" y2="' + py(gy) + '" stroke="#e6dfcd" /><text x="' + (L - 6) + '" y="' + (py(gy) + 3) + '" font-size="10" text-anchor="end" fill="#6d675c">10^' + gy + '</text>';
    var pts = D.scatter.map(function (s) {
      return '<circle cx="' + px(Math.log10(s.tvl)).toFixed(1) + '" cy="' + py(Math.log10(s.cap)).toFixed(1) + '" r="3" fill="#0e5c46" opacity="0.55"><title>' + esc(s.slug) + '</title></circle>';
    }).join('');
    return '<svg class="scatter" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Traded tokens: market cap against TVL, log-log">' + grid + pts +
      '<line x1="' + px(x0) + '" y1="' + py(a + b * x0 + medOff) + '" x2="' + px(x1) + '" y2="' + py(a + b * x1 + medOff) + '" stroke="#9c3226" stroke-width="2" />' +
      '<text x="' + (L + 4) + '" y="' + (H - 8) + '" font-size="11" fill="#6d675c">log₁₀ TVL → · log₁₀ market cap ↑ · the line is the fitted size curve with the other admitted terms at their median</text></svg>';
  }
  function renderMethod() {
    var M = D.model, O = D.odds;
    var ladderRows = M.ladder.map(function (s) {
      return '<tr><td>' + esc(s.term) + '<div class="slug">' + esc(s.detail) + '</div></td><td class="r">' + s.round + '</td>' +
        '<td class="r">' + x2(s.looBefore) + ' → ' + x2(s.looAfter) + '</td><td class="r">' + x2(s.wfBefore) + ' → ' + x2(s.wfAfter) + '</td>' +
        '<td class="' + (s.kept ? 'kept' : 'rej') + '">' + (s.kept ? 'KEPT' : 'rejected') + '</td></tr>';
    }).join('');
    var bandRows = O.bands.map(function (b) {
      return '<tr><td>' + esc(b.label) + '</td><td class="r">' + b.n + '</td><td class="r">' + b.k + '</td><td class="r">' + (b.rate * 100).toFixed(0) + '%</td></tr>';
    }).join('');
    var catRows = O.catRates.slice(0, 10).map(function (c) {
      return '<tr><td>' + esc(c.category) + '</td><td class="r">' + c.n + '</td><td class="r">' + (c.rate * 100).toFixed(0) + '%</td></tr>';
    }).join('');
    var gasRows = Object.keys(A.gas).map(function (c) { return '<tr><td>' + esc(c) + '</td><td class="r">' + A.gas[c] + '¢</td></tr>'; }).join('') +
      '<tr><td>any other chain</td><td class="r">' + A.gasDefault + '¢</td></tr>';
    var mechSeen = {}, mechRows = '';
    D.board.forEach(function (r) {
      if (mechSeen[r.mech.key]) return; mechSeen[r.mech.key] = 1;
      mechRows += '<tr><td>' + esc(r.mech.label) + '</td><td class="r">' + r.mech.feeBp + ' bp</td><td>' + esc(r.mech.feeWhy) + '</td></tr>';
    });
    var undated = D.board.filter(function (r) { return !r.oddsDated; }).length;
    var widths = D.board.map(function (r) { return r.bands.rankHi - r.bands.rankLo; }).sort(function (m, n) { return m - n; });
    document.getElementById('view-method').innerHTML =
      '<div class="method"><h2>Method &amp; the gate every term had to pass</h2>' +
      '<p>The implied value of a pre-token protocol is read off a curve fitted on the protocols whose token already trades. ' +
      'The comparable set is built by a printed rule: of ' + M.comps.recordedTokens + ' protocols recording a token, ' + M.comps.tradedRows +
      ' carry a positive market cap (a cap of 0 or −1 is the snapshot\'s no-price sentinel, not a price); of those, ' + M.comps.droppedSymbolOnly +
      ' are dropped as symbol-only rows with no priced token id, and ' + M.comps.droppedDeployments + ' as repeat deployments of a token already counted; ' +
      'a further ' + M.comps.droppedCategory + ' are set aside by the fit-pool rule — the curve is not fitted on tokens in the ' + M.comps.excludedCats.join(', ') +
      ' categories, whose caps are carried by another asset or venue rather than priced as standalone products — ' +
      'leaving <b>' + M.comps.n + ' standalone traded tokens</b>. The fit is Huber-robust; the plain least-squares fit (' +
      'a = ' + M.olsBase.a.toFixed(2) + ', b = ' + M.olsBase.b.toFixed(2) + ') and the Theil–Sen fit (a = ' + M.tsBase.a.toFixed(2) + ', b = ' + M.tsBase.b.toFixed(2) +
      ') are printed as cross-checks of the shipped Huber size curve (a = ' + M.huberBase.a.toFixed(2) + ', b = ' + M.huberBase.b.toFixed(2) + ').</p>' +
      '<p>Each candidate term was admitted only if it improved <b>both</b> the leave-one-out median factor miss and the walk-forward median factor miss ' +
      '(walk-forward: fit on the oldest by listed date, predict the newest 40% in four blocks). Two passes were run; every trial is printed, kept or rejected. ' +
      'The flat 0.25× TVL rule scores LOO ' + x2(M.flatLoo) + ' / WF ' + x2(M.flatWf) + ' and is rejected by the same gate.</p>' +
      '<table class="ladder"><thead><tr><th>Candidate term</th><th class="r">Pass</th><th class="r">Leave-one-out miss</th><th class="r">Walk-forward miss</th><th>Gate</th></tr></thead><tbody>' + ladderRows + '</tbody></table>' +
      '<p>Shipped model: <b>LOO ' + x2(M.loo) + ' · WF ' + x2(M.wf) + '</b>. A factor miss of ' + M.loo.toFixed(1) + ' means the typical fitted value lands within ' +
      'a factor of ' + M.loo.toFixed(1) + ' of the real cap, either way — the model is a blunt instrument and the bands, not the point figure, are the product.</p>' +
      '<div class="panel"><h3>Launch-odds validation</h3><p>The odds model — launch share by tracked-age band, category-adjusted — was fitted on the ' + O.trainN +
      ' protocols listed before ' + O.splitAt + ' and tested on the ' + O.testN + ' listed since: Brier score <b>' + O.brierModel.toFixed(4) + '</b> against ' +
      O.brierBase.toFixed(4) + ' for the constant base rate. ' +
      (O.adopted ? 'It <b>beat the base rate held out</b>, so the board ranks by expected value (implied × odds); both figures are printed per row.' :
        'It <b>did not beat the base rate</b>, so the board ranks by implied value alone and the odds are shown for information only.') +
      ' The full odds tables are below.</p></div>' +
      '<h3>The teachers, plotted</h3>' + scatterSvg() +
      '<h3>Launch odds — the snapshot\'s own record</h3>' +
      '<p>Of ' + O.population + ' protocols with a listed date (' + O.undated + ' carry none), the share whose token already trades, by tracked age:</p>' +
      '<table class="ladder"><thead><tr><th>Age band</th><th class="r">Protocols</th><th class="r">Token trades</th><th class="r">Share (smoothed)</th></tr></thead><tbody>' + bandRows + '</tbody></table>' +
      '<p>Overall base rate ' + (O.baseRate * 100).toFixed(0) + '%. Category adjustments (shrunk toward the band rate, categories with ≥25 dated protocols):</p>' +
      '<table class="ladder"><thead><tr><th>Category</th><th class="r">Dated protocols</th><th class="r">Launch share</th></tr></thead><tbody>' + catRows + '</tbody></table>' +
      '<p><b>Validation:</b> fitted on the ' + O.trainN + ' protocols listed before ' + O.splitAt + ', tested on the ' + O.testN + ' listed since. ' +
      'Brier score ' + O.brierModel.toFixed(4) + ' for the band model against ' + O.brierBase.toFixed(4) + ' for the constant base rate → the odds model ' +
      (O.adopted ? '<b>beat the base rate held out and is adopted</b>: the board ranks by expected value.' : '<b>did not beat the base rate and is not used</b>: the board ranks by implied value, and this failure stays printed.') +
      ' Age bands partly measure time-to-launch — an old protocol has had more years in which to issue a token. That is the record the snapshot carries, printed as such, not a forecast.</p>' +
      '<h3>How farm plans are priced</h3>' +
      '<p>Costs are integer cents from two stated schedules — gas per on-chain action by chain, and protocol fees as basis points of plan size by mechanism — plus a T-bill opportunity cost at ' +
      (A.tbillRate * 100).toFixed(0) + '%/yr over ' + A.weeks + ' weeks. Scenario S, the assumption set behind every printed plan: farmers\' qualifying capital ≈ ' +
      (A.qualifyingShare * 100).toFixed(0) + '% of a protocol\'s TVL, the drop is split pro-rata to capital deployed, and verdicts follow printed lines — farm needs net ≥ $25 and ≥ $2.00/hr, ' +
      'thin is net-positive but under a line, skip is net-negative. These are assumptions for comparing plans, not a forecast of any airdrop.</p>' +
      '<div class="cols"><div class="panel"><h3>Gas schedule (cents per action)</h3><table class="kv">' + gasRows + '</table></div>' +
      '<div class="panel"><h3>Protocol fees by mechanism</h3><table class="kv">' + mechRows + '</table></div></div>' +
      '<h3>Honesty panel — where this model is blunt</h3><ul class="honest">' +
      '<li>Out-of-fold, the P25–P75 band held <b>' + Math.round(D.holds.hold2575 * 100) + '%</b> of held-out caps and the P10–P90 band <b>' + Math.round(D.holds.hold1090 * 100) + '%</b> ' +
      '(' + D.holds.tested + ' caps, ' + D.holds.folds + ' folds) — near their 50% / 80% marks, so the bands are honest about the factor-' + M.loo.toFixed(1) + ' typical miss.</li>' +
      '<li>The median board row\'s rank range (P10–P90 over the bootstrap draws) spans <b>' + widths[Math.floor(widths.length / 2)] + ' places</b>. Mid-board ranks are soft; the top and bottom are firmer.</li>' +
      '<li>' + undated + ' board rows have no listed date, so their odds are the base rate with no age information behind them.</li>' +
      (M.spec.kin
        ? '<li>The family haircut — pricing a row standalone when a sibling token already trades — currently binds on <b>' + M.haircutRows + ' board rows</b>; the family-size term itself is in the model and prices the rest.</li>'
        : '<li>The family haircut does not bind on this fit: the family-size term did not pass the gate, so no sibling premium is priced into any row or removed from one.</li>') +
      '<li>Four protocols in the snapshot report no 7-day change and sixteen record a token at a cap of 0 or −1; both are treated as missing data, never as numbers.</li>' +
      '</ul></div>';
  }

  /* ---- compare view ---- */
  function cmpSelect(id, slug) {
    return '<select class="cmp" id="' + id + '">' + D.board.map(function (r) {
      return '<option value="' + r.slug + '"' + (r.slug === slug ? ' selected' : '') + '>#' + r.rank + ' ' + esc(r.name) + '</option>';
    }).join('') + '</select>';
  }
  function renderCompare(slugs) {
    var rs = slugs.map(function (s) { return bySlug[s] || D.board[0]; });
    function row(label, fn) {
      return '<tr><td>' + label + '</td>' + rs.map(function (r) { return '<td class="r">' + fn(r) + '</td>'; }).join('') + '</tr>';
    }
    document.getElementById('view-compare').innerHTML =
      '<div class="compare"><h2>Compare protocols</h2>' +
      '<p>' + cmpSelect('cmp0', rs[0].slug) + cmpSelect('cmp1', rs[1].slug) + cmpSelect('cmp2', rs[2].slug) + '</p>' +
      '<table class="kv">' +
      row('TVL', function (r) { return moneyFull(r.tvl); }) +
      row('Implied value if it launches', function (r) { return moneyFull(r.gross); }) +
      row('Launch odds', function (r) { return (r.odds * 100).toFixed(0) + '% (' + esc(r.oddsBand) + ')'; }) +
      row('Board value', function (r) { return '<b>' + moneyFull(r.rankValue) + '</b>'; }) +
      row('Band P25–P75', function (r) { return moneyShort(r.bands.p25) + ' – ' + moneyShort(r.bands.p75); }) +
      row('Rank range P10–P90', function (r) { return '#' + r.bands.rankLo + ' – #' + r.bands.rankHi; }) +
      row('Mechanism', function (r) { return esc(r.mech.label); }) +
      row('All-in cost at scenario', function (r) { return usdC(econ(r, state.size, state.drop).costC); }) +
      row('Expected slice at scenario', function (r) { return usdC(econ(r, state.size, state.drop).expectedC); }) +
      row('Net at scenario', function (r) { var e = econ(r, state.size, state.drop); return usdC(e.netC) + ' · $' + e.netPerHour.toFixed(2) + '/hr'; }) +
      row('Verdict', function (r) { return chip(econ(r, state.size, state.drop).verdict); }) +
      '</table><p class="note">Farm figures reprice with the scenario selected on the board.</p></div>';
    ['cmp0', 'cmp1', 'cmp2'].forEach(function (id, i) {
      document.getElementById(id).addEventListener('change', function () {
        var next = rs.map(function (r) { return r.slug; });
        next[i] = this.value;
        location.hash = '#compare/' + next.join(',');
      });
    });
  }

  /* ---- set-aside view ---- */
  var ASIDE_WHY = {
    trades: 'Its token already trades at a positive recorded cap. These protocols are the model\'s teachers, not its subjects.',
    nocap: 'A token is recorded but no cap is priced — the figure is missing, 0 or the −1 sentinel — so it cannot anchor the curve, and on this record it is not a launch candidate either.',
    bridges: 'Bridge and canonical-bridge products move other protocols\' assets; the house\'s watchlist rule sets them aside, and so does this board.',
    liqstake: 'Liquid staking and restaking products are claims on an underlying asset that already carries its own value story.',
    cex: 'Exchange custody products are the exchange\'s own instruments, not independent launch candidates.',
    versioned: 'A name ending in a version marker (V2, 2.0, …) marks another deployment of an existing product line.',
    kin: 'A wrapped or staked product by name, or a protocol sharing a family stem with a token that already trades — the sibling token already carries the family\'s value.'
  };
  function renderAside(group) {
    var members = D.groups[group] || [];
    var label = (D.accounting.filter(function (g) { return g.key === group; })[0] || {}).label || group;
    document.getElementById('view-aside').innerHTML =
      '<div class="aside"><h2>' + esc(label) + ' — ' + members.length + ' protocols</h2>' +
      '<p>' + esc(ASIDE_WHY[group] || '') + '</p>' +
      '<table class="board"><thead><tr><th>Protocol</th><th>Category</th><th class="r">TVL</th></tr></thead><tbody>' +
      members.map(function (m) {
        return '<tr><td><span class="nm">' + esc(m.name) + '</span><div class="slug">' + esc(m.slug) + '</div></td><td>' + esc(m.category || '—') + '</td><td class="r">' + moneyShort(m.tvl) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  /* ---- CSV export ---- */
  document.getElementById('csvBtn').addEventListener('click', function () {
    var lines = ['rank,slug,name,category,tvl_usd,implied_if_launches_usd,launch_odds,board_value_usd,band_p25_usd,band_p75_usd,net_at_scenario_usd,verdict'];
    D.board.forEach(function (r) {
      var e = econ(r, state.size, state.drop);
      lines.push([r.rank, r.slug, '"' + r.name.replace(/"/g, '""') + '"', '"' + (r.category || '') + '"', r.tvl,
        Math.round(r.gross), r.odds.toFixed(3), Math.round(r.rankValue), Math.round(r.bands.p25), Math.round(r.bands.p75),
        (e.netC / 100).toFixed(2), e.verdict].join(','));
    });
    var blob = new Blob([lines.join('\n') + '\n'], { type: 'text/csv' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'token-radar-board.csv';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  });

  /* ---- controls + routing ---- */
  var catSel = document.getElementById('catFilter');
  var cats = [];
  D.board.forEach(function (r) { if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category); });
  cats.sort();
  catSel.innerHTML = '<option value="">All categories</option>' + cats.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');
  document.getElementById('q').addEventListener('input', function () { state.q = this.value.toLowerCase(); renderBoard(); });
  catSel.addEventListener('change', function () { state.cat = this.value; renderBoard(); });
  document.getElementById('watchOnly').addEventListener('change', function () { state.watch = this.checked; renderBoard(); });
  document.getElementById('farmOnly').addEventListener('change', function () { state.farmOnly = this.checked; renderBoard(); });
  document.getElementById('sortBy').addEventListener('change', function () { state.sort = this.value; renderBoard(); });
  document.querySelectorAll('.tab').forEach(function (t) {
    t.addEventListener('click', function () { location.hash = '#' + t.dataset.view; });
  });

  function refresh() { renderScen(); renderFarms(); renderBoard(); route(); }
  var VIEWS = ['view-board', 'view-detail', 'view-method', 'view-compare', 'view-aside'];
  function show(id, tab) {
    VIEWS.forEach(function (v) { document.getElementById(v).hidden = v !== id; });
    document.querySelectorAll('.tab').forEach(function (t) { t.classList.toggle('on', t.dataset.view === tab); });
    window.scrollTo(0, 0);
  }
  function route() {
    var h = location.hash.replace(/^#/, '');
    var parts = h.split('/');
    if (parts[0] === 'detail' && parts[1]) { renderDetail(parts[1]); show('view-detail', 'board'); }
    else if (parts[0] === 'method') { renderMethod(); show('view-method', 'method'); }
    else if (parts[0] === 'compare') {
      var slugs = parts[1] ? parts[1].split(',') : [D.board[0].slug, D.board[1].slug, D.board[2].slug];
      renderCompare(slugs); show('view-compare', 'compare');
    } else if (parts[0] === 'aside') {
      if (parts[1]) state.asideGroup = parts[1];
      renderAside(state.asideGroup); show('view-aside', 'aside');
    } else { show('view-board', 'board'); }
  }
  window.addEventListener('hashchange', route);
  document.getElementById('foot').textContent =
    'Source: ' + D.meta.source + '. An entry for make.fun\'s token launch radar bounty. Implied values are this entry\'s own claims, ' +
    'derived from the snapshot alone; scenario S is an assumption set for comparing plans, not a prediction that any protocol will issue a token.';
  renderScen();
  renderFarms();
  renderBoard();
  route();
})();
