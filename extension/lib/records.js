/* Flip Tracker — record normalisation & merging (pure). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FlipRecords = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const SIDES = ['heads', 'tails'];
  const SOURCES = ['graphql', 'rest', 'ws', 'dom', 'manual', 'import'];

  function num(v) { const n = typeof v === 'number' ? v : parseFloat(v); return Number.isFinite(n) ? n : null; }
  function side(v) { const s = String(v || '').toLowerCase(); return SIDES.includes(s) ? s : null; }
  function str(v, max) { return v === undefined || v === null || v === '' ? null : String(v).slice(0, max || 80); }

  /** Whitelist + type-check a record. Unknown keys are dropped. */
  function normalizeRecord(r) {
    if (!r || typeof r !== 'object') return null;
    const ts = num(r.ts) ?? (Date.parse(r.ts || r.timestamp) || null);
    if (!ts) return null;
    const pick = side(r.pick), result = side(r.result);
    let win = typeof r.win === 'boolean' ? r.win : null;
    if (win === null && pick && result) win = pick === result;
    const amount = num(r.amount);
    const cur = str(r.currency, 12);
    const out = {
      id: str(r.id) || 'm-' + ts + '-' + Math.random().toString(36).slice(2, 8),
      ts,
      pick, result, win,
      amount: amount !== null && amount >= 0 ? amount : null,
      currency: cur ? cur.toUpperCase() : null,
      multiplier: num(r.multiplier),
      payout: num(r.payout),
      betId: str(r.betId),
      flipIndex: Math.max(1, parseInt(r.flipIndex, 10) || 1),
      betActive: typeof r.betActive === 'boolean' ? r.betActive : null,
      source: SOURCES.includes(r.source) ? r.source : 'import',
      trackerSession: str(r.trackerSession, 40)
    };
    return out;
  }

  function nonNull(o) { const x = {}; for (const k of Object.keys(o)) if (o[k] !== null && o[k] !== undefined) x[k] = o[k]; return x; }

  /**
   * Merge parsed flips + bet updates into the stored array.
   * WS-sourced data may only update bets already known from the user's own
   * HTTP responses (public bet feeds include other players' bets).
   */
  function merge(stored, incoming, betUpdates, source) {
    const byId = new Map(stored.map((f) => [f.id, f]));
    const knownBets = new Set(stored.filter((f) => f.betId).map((f) => f.betId));
    let added = 0, updated = 0;
    for (const raw of incoming || []) {
      const f = normalizeRecord(raw);
      if (!f) continue;
      if (source === 'ws' && (!f.betId || !knownBets.has(f.betId))) continue;
      const ex = byId.get(f.id);
      if (ex) { byId.set(f.id, Object.assign({}, ex, nonNull(f), { ts: ex.ts, source: ex.source })); updated++; }
      else { byId.set(f.id, f); added++; }
      if (f.betId) knownBets.add(f.betId);
    }
    for (const u of betUpdates || []) {
      if (!u || !u.betId || !knownBets.has(u.betId) || u.active !== false) continue;
      let last = null;
      for (const f of byId.values()) if (f.betId === u.betId && (!last || f.flipIndex > last.flipIndex)) last = f;
      if (!last) continue;
      const nf = Object.assign({}, last, { betActive: false });
      if (u.payout !== null && u.payout !== undefined) nf.payout = u.payout;
      else if (nf.payout === null) nf.payout = 0;
      if (u.multiplier !== null && u.multiplier !== undefined && u.multiplier > 0) nf.multiplier = u.multiplier;
      if (nf.win === null) nf.win = (nf.payout || 0) > 0;
      byId.set(nf.id, nf); updated++;
    }
    const out = Array.from(byId.values()).sort((a, b) => a.ts - b.ts || a.flipIndex - b.flipIndex);
    return { flips: out, added, updated };
  }

  return { normalizeRecord, merge };
});
