/* Flip Tracker — statistics (descriptive only; no forecasting of any kind). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FlipStats = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function filterFlips(flips, opts) {
    opts = opts || {};
    return flips.filter((f) =>
      (!opts.from || f.ts >= opts.from) && (!opts.to || f.ts <= opts.to) &&
      (!opts.currency || opts.currency === 'ALL' || (f.currency || '?') === opts.currency));
  }

  /** Group flips into bets (a Flip round = one wager, 1..n flips, maybe a cash-out). */
  function groupBets(flips) {
    const map = new Map();
    for (const f of flips) {
      const k = f.betId || f.id;
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(f);
    }
    const bets = [];
    for (const [key, fs] of map) {
      fs.sort((a, b) => a.flipIndex - b.flipIndex || a.ts - b.ts);
      const last = fs[fs.length - 1];
      const amount = fs.reduce((m, f) => (f.amount !== null && f.amount > m ? f.amount : m), 0);
      const settled = last.betActive === false || (last.betActive === null && last.source === 'manual') ||
        (last.betActive === null && last.payout !== null);
      let payout = null;
      if (settled) {
        payout = last.payout;
        if (payout === null) payout = last.win && last.multiplier ? amount * last.multiplier : 0;
      }
      bets.push({ key, flips: fs, ts: fs[0].ts, endTs: last.ts, amount, currency: last.currency || '?',
        settled, payout, net: settled ? payout - amount : null });
    }
    bets.sort((a, b) => a.ts - b.ts);
    return bets;
  }

  function computeStats(allFlips, opts) {
    opts = opts || {};
    const gapMs = (opts.sessionGapMin || 30) * 60000;
    const flips = filterFlips(allFlips, opts).slice().sort((a, b) => a.ts - b.ts || a.flipIndex - b.flipIndex);
    const s = {
      flips: flips.length, wins: 0, losses: 0, unknown: 0, winRate: null,
      picks: { heads: 0, tails: 0 }, results: { heads: 0, tails: 0 },
      streaks: { current: { type: null, length: 0 }, longestWin: 0, longestLoss: 0 },
      currencies: {}, series: {}, sessions: [], rows: [], openBets: 0, bets: 0
    };
    let run = 0, runType = null;
    for (const f of flips) {
      if (f.pick) s.picks[f.pick]++;
      if (f.result) s.results[f.result]++;
      if (f.win === true) s.wins++; else if (f.win === false) s.losses++; else { s.unknown++; continue; }
      const t = f.win ? 'win' : 'loss';
      if (t === runType) run++; else { runType = t; run = 1; }
      if (t === 'win') s.streaks.longestWin = Math.max(s.streaks.longestWin, run);
      else s.streaks.longestLoss = Math.max(s.streaks.longestLoss, run);
    }
    s.streaks.current = { type: runType, length: run };
    if (s.wins + s.losses) s.winRate = s.wins / (s.wins + s.losses);

    const bets = groupBets(flips);
    s.bets = bets.length;
    const betOf = new Map();
    for (const b of bets) {
      for (const f of b.flips) betOf.set(f.id, b);
      if (b.flips[0].source === 'dom' && !b.amount) continue; // DOM-only flips carry no money data
      const c = s.currencies[b.currency] || (s.currencies[b.currency] = { bets: 0, settled: 0, wagered: 0, settledWagered: 0, payout: 0, net: 0, won: 0, lost: 0, roi: null });
      c.bets++; c.wagered += b.amount;
      if (b.settled) { c.settled++; c.settledWagered += b.amount; c.payout += b.payout; c.net += b.net; if (b.net > 0) c.won += b.net; else if (b.net < 0) c.lost += b.net; }
      else s.openBets++;
    }
    for (const cur of Object.keys(s.currencies)) {
      const c = s.currencies[cur];
      c.roi = c.settledWagered > 0 ? c.net / c.settledWagered : null;
      let cum = 0;
      s.series[cur] = bets.filter((b) => b.settled && b.currency === cur)
        .sort((a, b) => a.endTs - b.endTs).map((b) => ({ ts: b.endTs, value: (cum += b.net) }));
    }

    // Sessions: consecutive flips separated by less than the gap.
    let sess = null, lastTs = -Infinity;
    const roundNo = new Map();
    for (const f of flips) {
      if (!sess || f.ts - lastTs > gapMs) {
        sess = { no: s.sessions.length + 1, start: f.ts, end: f.ts, flips: 0, wins: 0, losses: 0, bets: 0, net: {} };
        s.sessions.push(sess);
      }
      lastTs = f.ts; sess.end = f.ts; sess.flips++;
      if (f.win === true) sess.wins++; else if (f.win === false) sess.losses++;
      const b = betOf.get(f.id);
      const key = sess.no + '|' + b.key;
      if (!roundNo.has(key)) {
        roundNo.set(key, ++sess.bets);
        if (b.settled) sess.net[b.currency] = (sess.net[b.currency] || 0) + b.net;
      }
      s.rows.push(Object.assign({}, f, {
        session: sess.no, round: roundNo.get(key),
        wagerCounted: f === b.flips[0] ? b.amount : 0,
        betNet: f === b.flips[b.flips.length - 1] && b.settled ? b.net : null
      }));
    }
    return s;
  }

  const CSV_COLS = ['timestamp_iso', 'session', 'round_in_session', 'flip_in_round', 'bet_id', 'pick', 'result',
    'outcome', 'bet_amount', 'currency', 'multiplier', 'payout', 'wager_counted', 'round_net', 'source'];
  function csvCell(v) {
    if (v === null || v === undefined) return '';
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s)) s = "'" + s; // spreadsheet formula injection guard
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCSV(rows) {
    const lines = [CSV_COLS.join(',')];
    for (const r of rows) {
      lines.push([new Date(r.ts).toISOString(), r.session, r.round, r.flipIndex, r.betId, r.pick, r.result,
        r.win === true ? 'win' : r.win === false ? 'loss' : '', r.amount, r.currency, r.multiplier, r.payout,
        r.wagerCounted, r.betNet, r.source].map(csvCell).join(','));
    }
    return lines.join('\r\n') + '\r\n';
  }

  return { computeStats, groupBets, filterFlips, toCSV, CSV_COLS };
});
