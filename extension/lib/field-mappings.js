/*
 * Flip Tracker — FIELD MAPPINGS (the ONE file to edit when Stake's payloads differ).
 *
 * Stake does not publish a schema for its Originals. Everything below is a
 * best-effort mapping built from public information about how Stake Originals
 * respond (GraphQL `CasinoBet` objects with `id, active, amount, payout,
 * payoutMultiplier, currency, updatedAt, state { ...on CasinoGame<Name> }`, and
 * the REST-style `/_api/casino/<game>/<action>` endpoints used by newer
 * Originals). Each list is an ordered set of ALIASES; the first one present wins.
 *
 * If capture doesn't work on the real site:
 *   1. Dashboard → Settings → enable "Debug mode".
 *   2. Play a couple of flips (and one cash-out) on stake.us/casino/games/flip.
 *   3. Dashboard → "Export debug shapes" and send the JSON file to us.
 *      (Values are redacted except game fields; no headers/cookies/tokens are
 *      ever read.) We then only need to change this file.
 *
 * This file is plain data + tiny helpers so it can run in the page-free
 * content-script world, the background worker, extension pages and Node tests.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FlipMappings = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const M = {
    VERSION: 1,

    /* ---- Which network traffic is even considered ---------------------- */
    // URL must match one of these to be inspected at all (page-world filter).
    API_URL_PATTERNS: [/\/_api\/graphql/i, /\/_api\/casino\/flip/i, /\/_api\/casino\//i],
    // Fast pre-filter on the raw text before JSON parsing.
    TEXT_HINT: /flip/i,

    /* ---- How a bet object for Flip is recognised ----------------------- */
    // GraphQL mutation/query result keys that hold a Flip CasinoBet.
    // (Pattern mirrors minesBet/minesNext/minesCashout, hiloBet/hiloNext/hiloCashout.)
    OPERATION_KEYS: [
      'flipBet', 'flipNext', 'flipCashout', 'flipAutoBet', 'flipAutobet',
      'flipActiveBet', 'flipPlay', 'flipFlip', 'flip'
    ],
    // `state.__typename` values identifying Flip game state.
    STATE_TYPENAMES: [/^CasinoGameFlip$/i, /flip/i],
    // `game` field values identifying Flip.
    GAME_NAMES: [/^flip$/i],
    // REST endpoints (newer Originals) — action is the last path segment.
    REST_URL: /\/_api\/casino\/flip\/([a-z-]+)/i,

    /* ---- CasinoBet-level fields ---------------------------------------- */
    BET: {
      id: ['id', 'betId', 'iid'],
      amount: ['amount', 'betAmount'],
      payout: ['payout', 'winAmount'],
      payoutMultiplier: ['payoutMultiplier', 'multiplier', 'currentMultiplier'],
      currency: ['currency'],
      active: ['active', 'isActive'],
      time: ['updatedAt', 'createdAt', 'timestamp'],
      state: ['state', 'gameState']
    },

    /* ---- Flip game state ----------------------------------------------- */
    STATE: {
      // Array of per-flip rounds. Elements may be objects or plain strings.
      rounds: ['rounds', 'flips', 'results', 'playedRounds', 'coins'],
      // Optional parallel array of the player's guesses (if rounds are strings).
      guesses: ['guesses', 'picks', 'choices'],
      // Single-flip fallbacks if there is no array.
      singleGuess: ['guess', 'pick', 'choice'],
      singleResult: ['result', 'outcome', 'flip', 'coin']
    },
    ROUND: {
      guess: ['guess', 'pick', 'choice', 'selected', 'prediction'],
      result: ['result', 'outcome', 'flip', 'coin', 'side', 'value'],
      payoutMultiplier: ['payoutMultiplier', 'multiplier'],
      win: ['win', 'isWin', 'won']
    },

    /* ---- Request variables (pick / amount / currency fallbacks) -------- */
    REQUEST_VARS: {
      guess: ['guess', 'pick', 'side', 'choice', 'coin'],
      amount: ['amount', 'betAmount'],
      currency: ['currency']
    },

    /* ---- Value normalisation ------------------------------------------- */
    SIDE_VALUES: {
      heads: ['heads', 'head', 'h', 'HEADS', 'Heads'],
      tails: ['tails', 'tail', 't', 'TAILS', 'Tails']
    },
    // Unknown whether Stake ever encodes sides numerically. Leave null unless
    // debug shapes prove it, e.g. { 0: 'heads', 1: 'tails' }.
    NUMERIC_SIDES: null,
    // Stake.us sweepstakes currencies.
    CURRENCY_VALUES: {
      GC: ['gold', 'gc', 'xgc', 'goldcoins', 'gold_coins'],
      SC: ['sweeps', 'sc', 'xsc', 'sweepscoins', 'sweeps_coins', 'stakecash']
    },

    /* ---- Debug-shape whitelist (values kept, everything else redacted) -- */
    DEBUG_KEEP_VALUE_KEYS: [
      '__typename', 'operationName', 'game', 'active', 'currency',
      'amount', 'payout', 'payoutMultiplier', 'amountMultiplier', 'multiplier',
      'guess', 'pick', 'choice', 'result', 'outcome', 'flip', 'coin', 'side',
      'value', 'win', 'isWin', 'won', 'type', 'kind', 'updatedAt', 'createdAt'
    ],

    /* ---- DOM fallback (experimental, OFF by default) -------------------- */
    // Selectors for the Flip result history strip. Unknown on the real site —
    // update from a DOM inspection. Each matching element's text/aria-label/
    // class is scanned for heads/tails.
    DOM: {
      pathMatch: /\/casino\/games\/flip/i,
      historySelectors: [
        '[data-testid*="history" i]', '[data-test*="history" i]',
        '[class*="past-bets" i]', '[class*="history" i]'
      ],
      settleDelayMs: 2500 // wait this long for a network capture before using DOM
    }
  };

  /* ---- helpers ---- */
  M.pick = function (obj, aliases) {
    if (!obj || typeof obj !== 'object') return undefined;
    for (const k of aliases) if (obj[k] !== undefined && obj[k] !== null) return obj[k];
    return undefined;
  };
  M.normSide = function (v) {
    if (v === undefined || v === null) return null;
    if (typeof v === 'number' && M.NUMERIC_SIDES) return M.NUMERIC_SIDES[v] || null;
    if (typeof v === 'object') return M.normSide(M.pick(v, ['side', 'value', 'result', 'name']));
    const s = String(v).trim();
    for (const side of Object.keys(M.SIDE_VALUES)) {
      if (M.SIDE_VALUES[side].some((a) => a.toLowerCase() === s.toLowerCase())) return side;
    }
    return null;
  };
  M.normCurrency = function (v) {
    if (v === undefined || v === null || v === '') return null;
    const s = String(v).trim().toLowerCase();
    for (const c of Object.keys(M.CURRENCY_VALUES)) if (M.CURRENCY_VALUES[c].includes(s)) return c;
    return s.toUpperCase().slice(0, 12);
  };
  M.num = function (v) {
    if (v === undefined || v === null || v === '') return null;
    const n = typeof v === 'number' ? v : parseFloat(v);
    return Number.isFinite(n) ? n : null;
  };
  return M;
});
