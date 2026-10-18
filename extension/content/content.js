/* Flip Tracker — content script (isolated world). Read-only: never clicks, types or bets. */
/* global ext, FlipParser, FlipMappings */
(function () {
  'use strict';
  if (window.__flipTrackerContent) return;
  window.__flipTrackerContent = true;

  const TAG = '__flip_tracker_v1__';
  const GAME_HINT = /bet|game|casino|flip|payout|multiplier/i;
  let settings = { debug: false, domFallback: false };
  let lastNetworkCapture = 0;
  const frames = new Map();   // MAIN-world observers in THIS frame (normally 1)
  const debugSigs = new Set();

  function send(msg) {
    try { return ext.runtime.sendMessage(msg).catch(() => null); } catch (e) { return Promise.resolve(null); }
  }
  ext.storage.local.get('settings').then((r) => { settings = Object.assign(settings, r.settings || {}); maybeStartDom(); });
  ext.storage.onChanged.addListener((ch, area) => {
    if (area === 'local' && ch.settings) { settings = Object.assign(settings, ch.settings.newValue || {}); maybeStartDom(); }
  });

  // Keys-only signature so repeated messages of the same shape are stored once.
  function sigOf(shape) {
    return JSON.stringify([shape.transport, shape.url, (shape.request || []).map((r) => r.operationName),
      JSON.stringify(shape.response, (k, v) => (v !== null && typeof v === 'object' ? v : typeof v))]).slice(0, 2000);
  }

  let statusTimer = null;
  function reportStatus() {
    if (statusTimer) return;
    statusTimer = setTimeout(() => {
      statusTimer = null;
      for (const [id, f] of frames) send({ type: 'interceptorStatus', frame: Object.assign({ id }, f) });
    }, 2000);
  }

  // 1) The MAIN-world observer (content/main-world.js) is declared in the manifest, so
  //    nothing is injected here. 2) Receive its messages from the same window only.
  window.addEventListener('message', (ev) => {
    if (ev.source !== window) return;
    const m = ev.data;
    if (!m || typeof m !== 'object' || m.tag !== TAG || typeof m.frameId !== 'string') return;
    const f = frames.get(m.frameId) || { seen: 0, gameLike: 0, flipLike: 0, path: location.pathname, top: window === window.top };
    frames.set(m.frameId, f);
    if (m.kind === 'status') {
      f.seen = Number(m.seen) || 0; f.gameLike = Number(m.gameLike) || 0; f.path = String(m.path || '').slice(0, 120);
      reportStatus(); return;
    }
    if (m.kind !== 'traffic' || typeof m.responseText !== 'string') return;
    const input = { transport: String(m.transport), url: String(m.url || ''), requestBody: typeof m.requestBody === 'string' ? m.requestBody : null, responseText: m.responseText, now: Date.now() };
    let parsed;
    try { parsed = FlipParser.parseTraffic(input); } catch (e) { parsed = { flips: [], betUpdates: [], related: false }; }
    if (parsed.related) f.flipLike++;
    reportStatus();
    // Debug: independent of Begin Tracker and of the word "flip" — any game/bet-looking JSON.
    if (settings.debug && (GAME_HINT.test(input.responseText) || GAME_HINT.test(input.requestBody || ''))) {
      try {
        const shape = FlipParser.debugShape(input);
        if (shape.response !== null && typeof shape.response === 'object') {
          shape.parsed = { flips: parsed.flips.length, betUpdates: parsed.betUpdates.length, flipLike: parsed.related };
          shape.frame = { top: window === window.top, path: location.pathname.slice(0, 120) };
          shape.sig = sigOf(shape);
          if (!debugSigs.has(shape.sig) || parsed.related) { debugSigs.add(shape.sig); send({ type: 'debugShape', shape }); }
        }
      } catch (e) {}
    }
    if (parsed.flips.length || parsed.betUpdates.length) {
      if (input.transport !== 'ws') lastNetworkCapture = Date.now();
      send({ type: 'capture', flips: parsed.flips, betUpdates: parsed.betUpdates, source: parsed.flips[0] ? parsed.flips[0].source : input.transport });
    }
  });

  // 3) Experimental DOM fallback (off by default): watch the result-history strip.
  let domObserver = null, lastSig = null;
  function sideFromEl(el) {
    const txt = [el.getAttribute && el.getAttribute('aria-label'), el.getAttribute && el.getAttribute('title'),
      el.className && String(el.className), el.textContent].filter(Boolean).join(' ').toLowerCase();
    if (/\bheads?\b/.test(txt)) return 'heads';
    if (/\btails?\b/.test(txt)) return 'tails';
    return null;
  }
  // Only counts entries NEWLY PREPENDED to the user's own result strip (1-3 at a time,
  // with the previous entries still in place). Re-renders / re-reads / list shifts are ignored.
  // Containers inside public bet feeds / tables are skipped.
  let prevSides = null;
  function isFeed(el) {
    return !!(el.closest('table, [class*="bets" i], [class*="feed" i], [class*="leaderboard" i], [data-testid*="bets" i]') || el.querySelector('table'));
  }
  function scanDom() {
    const D = FlipMappings.DOM;
    if (!D.pathMatch.test(location.pathname)) return;
    for (const sel of D.historySelectors) {
      let box; try { box = document.querySelector(sel); } catch (e) { continue; }
      if (!box || !box.children.length || isFeed(box)) continue;
      const sides = Array.from(box.children).slice(0, 12).map(sideFromEl);
      if (!sides[0] || sides.filter(Boolean).length < sides.length / 2) continue;
      const sig = sides.join(',');
      if (prevSides === null) { prevSides = sides; lastSig = sig; return; } // baseline: never import existing history
      if (sig === lastSig) return;
      let added = 0;
      for (let k = 1; k <= 3 && !added; k++) {
        const m = Math.min(prevSides.length, sides.length - k, 8);
        if (m >= 3 && sides.slice(k, k + m).join(',') === prevSides.slice(0, m).join(',')) added = k;
      }
      const fresh = sides.slice(0, added).reverse(); // oldest first
      prevSides = sides; lastSig = sig;
      if (!fresh.length) return;
      const seenAt = Date.now();
      setTimeout(() => {
        if (Date.now() - lastNetworkCapture < D.settleDelayMs + 2000) return; // network already captured it
        send({ type: 'capture', source: 'dom', betUpdates: [],
          flips: fresh.map((side, i) => ({ id: 'dom:' + seenAt + ':' + i, ts: seenAt + i, pick: null, result: side, win: null, amount: null, currency: null,
            multiplier: null, payout: null, betId: 'dom:' + seenAt + ':' + i, flipIndex: 1, betActive: null, source: 'dom' })) });
      }, D.settleDelayMs);
      return;
    }
  }
  function maybeStartDom() {
    if (settings.domFallback && !domObserver && document.documentElement) {
      let t = null;
      domObserver = new MutationObserver(() => { clearTimeout(t); t = setTimeout(scanDom, 300); });
      domObserver.observe(document.documentElement, { childList: true, subtree: true });
    } else if (!settings.domFallback && domObserver) { domObserver.disconnect(); domObserver = null; lastSig = null; prevSides = null; }
  }
})();
