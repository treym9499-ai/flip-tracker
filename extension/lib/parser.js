/*
 * Flip Tracker — network payload parser.
 * Pure functions, no side effects, no network, no access to headers/cookies.
 * Every field name it relies on lives in field-mappings.js.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./field-mappings.js'));
  else root.FlipParser = factory(root.FlipMappings);
})(typeof self !== 'undefined' ? self : this, function (M) {
  'use strict';

  function safeJSON(text) {
    if (text === null || text === undefined) return null;
    if (typeof text === 'object') return text;
    try { return JSON.parse(text); } catch (_) { return null; }
  }

  function urlPath(url) {
    try { const u = new URL(url, 'https://stake.us'); return u.origin + u.pathname; } catch (_) { return String(url || '').split('?')[0]; }
  }

  function isApiUrl(url) {
    return M.API_URL_PATTERNS.some((re) => re.test(String(url || '')));
  }

  /* Extract ONLY whitelisted request variables (pick / amount / currency). */
  function requestInfo(requestBody) {
    const body = safeJSON(requestBody);
    const list = Array.isArray(body) ? body : body ? [body] : [];
    const out = [];
    for (const b of list) {
      if (!b || typeof b !== 'object') continue;
      const vars = b.variables && typeof b.variables === 'object' ? b.variables : b; // REST bodies are flat
      out.push({
        operationName: typeof b.operationName === 'string' ? b.operationName : null,
        guess: M.normSide(M.pick(vars, M.REQUEST_VARS.guess)),
        amount: M.num(M.pick(vars, M.REQUEST_VARS.amount)),
        currency: M.normCurrency(M.pick(vars, M.REQUEST_VARS.currency))
      });
    }
    return out;
  }

  function matchesAny(v, regexes) {
    return typeof v === 'string' && regexes.some((re) => re.test(v));
  }

  function looksLikeBet(o) {
    return o && typeof o === 'object' && !Array.isArray(o) &&
      (M.pick(o, M.BET.state) !== undefined || M.pick(o, M.BET.payoutMultiplier) !== undefined ||
       M.pick(o, M.BET.active) !== undefined);
  }

  /* Walk the JSON and collect objects that are Flip bets. */
  function findBets(data, restAction) {
    const found = [];
    const seen = new Set();
    function add(obj, opKey) { if (!seen.has(obj)) { seen.add(obj); found.push({ bet: obj, opKey }); } }
    function walk(node, key, depth) {
      if (!node || typeof node !== 'object' || depth > 12) return;
      if (Array.isArray(node)) { node.forEach((n) => walk(n, key, depth + 1)); return; }
      if (key && M.OPERATION_KEYS.includes(key) && looksLikeBet(node)) { add(node, key); return; }
      const st = M.pick(node, M.BET.state);
      if (st && typeof st === 'object' && matchesAny(st.__typename, M.STATE_TYPENAMES)) { add(node, key); return; }
      if (matchesAny(node.game, M.GAME_NAMES) && looksLikeBet(node)) { add(node, key); return; }
      for (const k of Object.keys(node)) walk(node[k], k, depth + 1);
    }
    walk(data, null, 0);
    if (!found.length && restAction && looksLikeBet(data)) add(data, 'rest:' + restAction);
    return found;
  }

  function toTs(v, fallback) {
    if (v === undefined || v === null) return fallback;
    if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : fallback;
  }

  /* Turn one bet object into per-flip records + a bet-level update. */
  function parseBet(bet, opKey, req, ctx) {
    const betId = M.pick(bet, M.BET.id);
    const amount = M.num(M.pick(bet, M.BET.amount)) ?? (req && req.amount) ?? null;
    const currency = M.normCurrency(M.pick(bet, M.BET.currency)) || (req && req.currency) || null;
    const activeRaw = M.pick(bet, M.BET.active);
    const active = typeof activeRaw === 'boolean' ? activeRaw : null;
    const betPayout = M.num(M.pick(bet, M.BET.payout));
    const betMult = M.num(M.pick(bet, M.BET.payoutMultiplier));
    const ts = toTs(M.pick(bet, M.BET.time), ctx.now);
    const state = M.pick(bet, M.BET.state) || {};

    let rounds = M.pick(state, M.STATE.rounds);
    if (!Array.isArray(rounds)) rounds = M.pick(bet, M.STATE.rounds);
    const guesses = M.pick(state, M.STATE.guesses);
    if (!Array.isArray(rounds)) {
      const g = M.pick(state, M.STATE.singleGuess), r = M.pick(state, M.STATE.singleResult);
      rounds = g !== undefined || r !== undefined ? [{ guess: g, result: r }] : [];
    }

    const flips = [];
    rounds.forEach((round, i) => {
      const isObj = round && typeof round === 'object';
      let guess = isObj ? M.normSide(M.pick(round, M.ROUND.guess)) : null;
      if (!guess && Array.isArray(guesses)) guess = M.normSide(guesses[i]);
      const result = isObj ? M.normSide(M.pick(round, M.ROUND.result)) : M.normSide(round);
      const last = i === rounds.length - 1;
      if (!guess && last && req && req.guess) guess = req.guess;
      const roundMult = isObj ? M.num(M.pick(round, M.ROUND.payoutMultiplier)) : null;
      const winRaw = isObj ? M.pick(round, M.ROUND.win) : undefined;

      let win = null;
      if (typeof winRaw === 'boolean') win = winRaw;
      else if (guess && result) win = guess === result;
      else if (roundMult !== null) win = roundMult > 0;
      else if (!last) win = true; // you can only flip again after a correct call
      else if (active === true) win = true;
      else if (active === false) win = (betMult || 0) > 0 || (betPayout || 0) > 0;

      // Infer missing side from the other one when the outcome is known.
      let res = result, pk = guess;
      if (!res && pk && win !== null) res = win ? pk : (pk === 'heads' ? 'tails' : 'heads');
      if (!pk && res && win !== null) pk = win ? res : (res === 'heads' ? 'tails' : 'heads');

      const settledHere = last && active === false;
      flips.push({
        id: betId ? String(betId) + ':' + (i + 1) : 'nb:' + ts + ':' + (i + 1),
        ts,
        pick: pk, result: res, win,
        amount, currency,
        multiplier: roundMult !== null ? roundMult : (last ? betMult : null),
        payout: settledHere ? (betPayout ?? 0) : null,
        betId: betId ? String(betId) : null,
        flipIndex: i + 1,
        betActive: last ? active : false,
        source: ctx.source
      });
    });

    const update = betId ? {
      betId: String(betId), active, payout: betPayout, multiplier: betMult,
      amount, currency, ts, roundCount: rounds.length, opKey: opKey || null
    } : null;
    return { flips, update };
  }

  /**
   * parseTraffic({ transport, url, requestBody, responseText, now })
   *  -> { flips: FlipRecord[], betUpdates: BetUpdate[], related: boolean }
   */
  function parseTraffic(input) {
    const now = input.now || Date.now();
    const empty = { flips: [], betUpdates: [], related: false };
    const text = typeof input.responseText === 'string' ? input.responseText : JSON.stringify(input.responseText || null);
    if (!M.TEXT_HINT.test(text) && !M.TEXT_HINT.test(String(input.url || '')) &&
        !M.TEXT_HINT.test(String(input.requestBody || ''))) return empty;
    let data = safeJSON(input.responseText);
    if (!data || typeof data !== 'object') return empty;
    if (input.transport === 'ws' && data.payload && (data.type === 'next' || data.type === 'data')) data = data.payload;

    const restM = M.REST_URL.exec(String(input.url || ''));
    const reqs = requestInfo(input.requestBody);
    const responses = Array.isArray(data) ? data : [data];
    const source = input.transport === 'ws' ? 'ws' : restM ? 'rest' : 'graphql';
    const out = { flips: [], betUpdates: [], related: false };
    responses.forEach((resp, idx) => {
      const req = reqs[idx] || reqs[0] || null;
      for (const { bet, opKey } of findBets(resp, restM && restM[1])) {
        const r = parseBet(bet, opKey, req, { now, source });
        out.flips.push(...r.flips);
        if (r.update) out.betUpdates.push(r.update);
        out.related = true;
      }
    });
    return out;
  }

  /* ---------------- Debug shapes (keys only, values redacted) ---------------- */
  const KEEP = new Set(M.DEBUG_KEEP_VALUE_KEYS);
  const TOKENISH = /^(ey[A-Za-z0-9_-]{10,}|[A-Fa-f0-9]{32,}|[A-Za-z0-9+/=_-]{40,})$/;
  function shapeOf(v, key, depth) {
    depth = depth || 0;
    if (depth > 10) return '<max-depth>';
    if (v === null) return null;
    if (Array.isArray(v)) return { __array: v.length, items: v.slice(0, 3).map((x) => shapeOf(x, key, depth + 1)) };
    if (typeof v === 'object') {
      const o = {};
      for (const k of Object.keys(v).slice(0, 60)) o[k] = shapeOf(v[k], k, depth + 1);
      return o;
    }
    if (key && KEEP.has(key) && (typeof v === 'number' || typeof v === 'boolean' ||
        (typeof v === 'string' && v.length <= 40 && !TOKENISH.test(v)))) return v;
    return '<' + typeof v + '>';
  }
  function stripGqlLiterals(q) {
    return String(q || '').replace(/"(?:[^"\\]|\\.)*"/g, '"<str>"').slice(0, 4000);
  }
  function debugShape(input) {
    const body = safeJSON(input.requestBody);
    const list = Array.isArray(body) ? body : body ? [body] : [];
    return {
      at: new Date(input.now || Date.now()).toISOString(),
      transport: input.transport,
      url: urlPath(input.url),
      request: list.map((b) => ({
        operationName: b && typeof b.operationName === 'string' ? b.operationName : null,
        query: b && typeof b.query === 'string' ? stripGqlLiterals(b.query) : null,
        variables: shapeOf(b && b.variables !== undefined ? b.variables : b, null)
      })),
      response: shapeOf(safeJSON(input.responseText), null)
    };
  }

  return { parseTraffic, debugShape, shapeOf, requestInfo, findBets, isApiUrl, urlPath, safeJSON };
});
