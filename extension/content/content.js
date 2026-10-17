/* Flip Tracker — content script (isolated world). Read-only: never clicks, types or bets. */
/* global ext, FlipParser, FlipMappings */
(function () {
  'use strict';
  if (window.__flipTrackerContent) return;
  window.__flipTrackerContent = true;

  const channel = 'ft-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  let settings = { debug: false, domFallback: false };
  let lastNetworkCapture = 0;

  function send(msg) {
    try { return ext.runtime.sendMessage(msg).catch(() => null); } catch (e) { return Promise.resolve(null); }
  }
  ext.storage.local.get('settings').then((r) => { settings = Object.assign(settings, r.settings || {}); maybeStartDom(); });
  ext.storage.onChanged.addListener((ch, area) => {
    if (area === 'local' && ch.settings) { settings = Object.assign(settings, ch.settings.newValue || {}); maybeStartDom(); }
  });

  // 1) Inject the page-world observer (needs page world to see the app's fetch/XHR/WS).
  try {
    const s = document.createElement('script');
    s.src = ext.runtime.getURL('content/injected.js');
    s.dataset.channel = channel;
    s.onload = () => s.remove();
    (document.head || document.documentElement).appendChild(s);
  } catch (e) { /* ignore */ }

  // 2) Receive observed traffic, parse + whitelist, forward to background.
  document.addEventListener(channel, (ev) => {
    let m;
    try { m = JSON.parse(ev.detail); } catch (e) { return; }
    if (!m || typeof m.responseText !== 'string') return;
    const input = { transport: m.transport, url: m.url, requestBody: m.requestBody, responseText: m.responseText, now: Date.now() };
    let parsed;
    try { parsed = FlipParser.parseTraffic(input); } catch (e) { parsed = { flips: [], betUpdates: [], related: false }; }
    if (settings.debug) {
      try {
        const shape = FlipParser.debugShape(input);
        shape.parsed = { flips: parsed.flips.length, betUpdates: parsed.betUpdates.length };
        send({ type: 'debugShape', shape });
      } catch (e) {}
    }
    if (parsed.flips.length || parsed.betUpdates.length) {
      if (m.transport !== 'ws') lastNetworkCapture = Date.now();
      send({ type: 'capture', flips: parsed.flips, betUpdates: parsed.betUpdates, source: parsed.flips[0] ? parsed.flips[0].source : m.transport });
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
  function scanDom() {
    const D = FlipMappings.DOM;
    if (!D.pathMatch.test(location.pathname)) return;
    for (const sel of D.historySelectors) {
      let box; try { box = document.querySelector(sel); } catch (e) { continue; }
      if (!box || !box.children.length) continue;
      const items = Array.from(box.children);
      const newest = items[0];
      const side = sideFromEl(newest);
      if (!side) continue;
      const sig = items.length + ':' + items.slice(0, 5).map(sideFromEl).join(',');
      if (lastSig === null) { lastSig = sig; return; } // baseline, don't import existing history
      if (sig === lastSig) return;
      lastSig = sig;
      const seenAt = Date.now();
      setTimeout(() => {
        if (Date.now() - lastNetworkCapture < D.settleDelayMs + 2000) return; // network already captured it
        send({ type: 'capture', source: 'dom', betUpdates: [],
          flips: [{ id: 'dom:' + seenAt, ts: seenAt, pick: null, result: side, win: null, amount: null, currency: null,
            multiplier: null, payout: null, betId: null, flipIndex: 1, betActive: null, source: 'dom' }] });
      }, D.settleDelayMs);
      return;
    }
  }
  function maybeStartDom() {
    if (settings.domFallback && !domObserver && document.documentElement) {
      let t = null;
      domObserver = new MutationObserver(() => { clearTimeout(t); t = setTimeout(scanDom, 300); });
      domObserver.observe(document.documentElement, { childList: true, subtree: true });
    } else if (!settings.domFallback && domObserver) { domObserver.disconnect(); domObserver = null; lastSig = null; }
  }
})();
