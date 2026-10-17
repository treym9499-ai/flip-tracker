/*
 * Flip Tracker — on-page overlay + loss-warning modal (content script, Shadow DOM).
 * Read-only with respect to Stake: it never touches Stake's UI. Its own buttons only
 * talk to the extension (Begin/Stop Tracker, collapse, close warning).
 */
/* global ext, FlipStats, FlipCodesUI */
(function () {
  'use strict';
  if (window.__flipTrackerOverlay) return;
  window.__flipTrackerOverlay = true;

  const NOTE = 'Each flip is an independent 50/50 (provably fair). Past results don\u2019t predict future flips.';
  const INTRO_MS = 5000;
  let settings = { overlay: false, lossWarnSC: 10 };
  let tracker = { active: false };
  let flips = [];
  let pos = { x: null, y: 80, collapsed: false };
  let ov = null;            // overlay refs
  let introDone = false;    // intro shown once per page load
  let modal = null;
  let codes = { cache: null, marks: {} };

  const CSS = `
  :host{all:initial}
  *{box-sizing:border-box}
  @keyframes pulse{0%,100%{box-shadow:0 0 4px #39FF14,0 0 10px rgba(57,255,20,.45);border-color:#39FF14}
    50%{box-shadow:0 0 14px #39FF14,0 0 32px rgba(57,255,20,.75);border-color:#a6ff8f}}
  @keyframes blink{0%,100%{opacity:1}50%{opacity:.25}}
  .box{position:fixed;width:320px;background:#000;color:#39FF14;border:2px solid #39FF14;border-radius:12px;
    font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;animation:pulse 1.6s ease-in-out infinite;
    pointer-events:auto;user-select:none;overflow:hidden}
  .hd{display:flex;align-items:center;gap:8px;padding:7px 10px;cursor:move;border-bottom:1px solid rgba(57,255,20,.35);
    letter-spacing:.08em;font-weight:700}
  .hd .t{flex:1}
  .dot{width:9px;height:9px;border-radius:50%;background:#1d4d14;display:inline-block}
  .dot.on{background:#39FF14;box-shadow:0 0 8px #39FF14;animation:blink 1s infinite}
  button{font:inherit;color:#39FF14;background:#000;border:1px solid #39FF14;border-radius:7px;padding:5px 10px;cursor:pointer;font-weight:700}
  button:hover{background:#0b2a06}
  .icon{padding:0 7px;line-height:18px}
  .bd{padding:9px 10px;max-height:calc(100vh - 70px);overflow:auto}
  .intro{display:flex;align-items:center;justify-content:center;height:150px;font-size:22px;font-weight:800;letter-spacing:.06em;
    text-shadow:0 0 8px #39FF14}
  .go{width:100%;padding:8px;font-size:13px;letter-spacing:.06em}
  .go.on{background:#39FF14;color:#000}
  .st{opacity:.8;margin:5px 0 8px;font-size:11px}
  h4{margin:9px 0 4px;font-size:11px;letter-spacing:.1em;opacity:.85}
  table{width:100%;border-collapse:collapse}
  td,th{padding:2px 4px;text-align:right;font-variant-numeric:tabular-nums}
  th{font-weight:600;opacity:.75}
  td:first-child,th:first-child{text-align:left}
  .neg{color:#ff3b3b}
  .note{margin-top:9px;padding:6px 7px;border:1px dashed rgba(57,255,20,.5);border-radius:7px;font-size:10.5px;opacity:.9}
  .hidden{display:none !important}
  .backdrop{position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;pointer-events:auto}
  .modal{max-width:440px;margin:16px;background:#000;color:#39FF14;border:2px solid #39FF14;border-radius:14px;padding:20px 22px;
    font:15px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;animation:pulse 1.6s ease-in-out infinite;text-align:center}
  .modal .w{color:#ff2020;font-weight:900;letter-spacing:.06em;text-shadow:0 0 8px rgba(255,32,32,.6)}
  .modal button{margin-top:16px;padding:7px 22px}
  `;

  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function makeHost(id) {
    const host = document.createElement('flip-tracker-ui');
    host.id = id;
    // host is a 0x0 fixed layer: only the box/modal itself receives pointer events
    host.style.cssText = 'all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:none;';
    const root = host.attachShadow({ mode: 'open' });
    const style = el('style'); style.textContent = CSS + (typeof FlipCodesUI !== 'undefined' ? FlipCodesUI.CSS : ''); root.appendChild(style);
    (document.body || document.documentElement).appendChild(host);
    return { host, root };
  }
  const fmt = (v, cur) => (v > 0 ? '+' : '') + v.toLocaleString(undefined, { minimumFractionDigits: cur === 'SC' ? 2 : 0, maximumFractionDigits: 2 });
  const money = (t) => '$' + (Number.isInteger(t) ? String(t) : t.toFixed(2));

  /* ---------------- overlay ---------------- */
  function buildOverlay() {
    const { host, root } = makeHost('flip-tracker-overlay');
    const box = el('div', 'box'); box.setAttribute('data-ft', 'box');
    const hd = el('div', 'hd');
    const dot = el('span', 'dot');
    const title = el('span', 't', 'FLIP TRACKER');
    const col = el('button', 'icon', '\u2013'); col.title = 'Collapse / expand'; col.setAttribute('data-ft', 'collapse');
    hd.append(dot, title, col);
    const intro = el('div', 'intro', 'Made by TDM'); intro.setAttribute('data-ft', 'intro');
    const bd = el('div', 'bd'); bd.setAttribute('data-ft', 'body');
    const go = el('button', 'go'); go.setAttribute('data-ft', 'toggle');
    const st = el('div', 'st'); st.setAttribute('data-ft', 'status');
    const plH = el('h4', null, 'SESSION P/L (since Begin Tracker)');
    const pl = el('table'); pl.setAttribute('data-ft', 'pl');
    const fsH = el('h4', null, 'FLIP STATS (this session)');
    const fs = el('table'); fs.setAttribute('data-ft', 'flipstats');
    const note = el('div', 'note', NOTE); note.setAttribute('data-ft', 'note');
    const cdH = el('h4', null, 'RECENTLY POSTED CODES');
    const cd = el('div'); cd.setAttribute('data-ft', 'codes');
    bd.append(go, st, plH, pl, fsH, fs, note, cdH, cd);
    box.append(hd, intro, bd);
    root.appendChild(box);

    go.addEventListener('click', () => ext.runtime.sendMessage({ type: 'setTracker', active: !tracker.active }).catch(() => {}));
    col.addEventListener('click', (e) => { e.stopPropagation(); pos.collapsed = !pos.collapsed; savePos(); layout(); });

    // dragging (header only)
    let drag = null;
    hd.addEventListener('pointerdown', (e) => {
      if (e.target === col) return;
      const r = box.getBoundingClientRect();
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      hd.setPointerCapture(e.pointerId);
    });
    hd.addEventListener('pointermove', (e) => {
      if (!drag) return;
      pos.x = Math.max(0, Math.min(window.innerWidth - 60, e.clientX - drag.dx));
      pos.y = Math.max(0, Math.min(window.innerHeight - 30, e.clientY - drag.dy));
      layout();
    });
    hd.addEventListener('pointerup', () => { if (drag) { drag = null; savePos(); } });

    ov = { host, root, box, dot, intro, bd, go, st, pl, fs, col, cd };
    ov.timer = setInterval(renderCodes, 30000);
    if (!introDone) {
      introDone = true;
      ov.introActive = true;
      setTimeout(() => { if (ov) { ov.introActive = false; layout(); } }, INTRO_MS);
    }
    layout(); render(); renderCodes();
  }
  function savePos() { ext.storage.local.set({ overlayState: { x: pos.x, y: pos.y, collapsed: pos.collapsed } }).catch(() => {}); }
  function layout() {
    if (!ov) return;
    const x = pos.x === null ? Math.max(0, window.innerWidth - 320) : pos.x;
    ov.box.style.left = x + 'px'; ov.box.style.top = (pos.y || 0) + 'px';
    ov.intro.classList.toggle('hidden', !ov.introActive || pos.collapsed);
    ov.bd.classList.toggle('hidden', !!ov.introActive || pos.collapsed);
    ov.col.textContent = pos.collapsed ? '+' : '\u2013';
  }
  function row(cells, tag) { const tr = el('tr'); cells.forEach((c) => { const x = el(tag || 'td', c.cls, c.text); if (c.k) { x.setAttribute('data-k', c.k); x.setAttribute('data-value', String(c.v)); } tr.appendChild(x); }); return tr; }
  function render() {
    if (!ov) return;
    ov.dot.classList.toggle('on', !!tracker.active);
    ov.go.textContent = tracker.active ? '\u25A0 Stop Tracker' : '\u25B6 Begin Tracker';
    ov.go.classList.toggle('on', !!tracker.active);
    ov.st.textContent = tracker.active
      ? '\u25CF TRACKING since ' + new Date(tracker.startedAt).toLocaleTimeString()
      : (tracker.sessionId ? 'Stopped \u2014 not recording. Showing last session.' : 'Stopped \u2014 press Begin Tracker to record flips.');
    const sess = tracker.sessionId ? flips.filter((f) => f.trackerSession === tracker.sessionId) : [];
    const s = FlipStats.computeStats(sess);
    ov.pl.replaceChildren(row([{ text: '' }, { text: 'Profit' }, { text: 'Losses' }, { text: 'Net' }], 'th'));
    for (const cur of ['SC', 'GC']) {
      const c = s.currencies[cur] || { won: 0, lost: 0, net: 0 };
      const k = cur.toLowerCase();
      ov.pl.appendChild(row([{ text: cur },
        { text: fmt(c.won, cur), k: k + '-profit', v: c.won },
        { text: fmt(c.lost, cur), cls: c.lost < 0 ? 'neg' : '', k: k + '-losses', v: c.lost },
        { text: fmt(c.net, cur), cls: c.net < 0 ? 'neg' : '', k: k + '-net', v: c.net }]));
    }
    const t = s.results.heads + s.results.tails || 1;
    const cs = s.streaks.current;
    ov.fs.replaceChildren(
      row([{ text: 'Flips (W / L)' }, { text: s.flips + ' (' + s.wins + ' / ' + s.losses + ')', k: 'flips', v: s.flips }]),
      row([{ text: 'Results heads' }, { text: s.results.heads + ' (' + Math.round(s.results.heads / t * 100) + '%)', k: 'heads', v: s.results.heads }]),
      row([{ text: 'Results tails' }, { text: s.results.tails + ' (' + Math.round(s.results.tails / t * 100) + '%)', k: 'tails', v: s.results.tails }]),
      row([{ text: 'Current streak' }, { text: cs.length ? cs.length + (cs.type === 'win' ? ' W' : ' L') : '\u2014' }]),
      row([{ text: 'Longest W / L' }, { text: s.streaks.longestWin + ' / ' + s.streaks.longestLoss }]));
  }
  function renderCodes() {
    if (ov && typeof FlipCodesUI !== 'undefined') FlipCodesUI.render(ov.cd, codes, { root: ov.root });
  }
  function syncOverlay() {
    if (settings.overlay && !ov && (document.body || document.documentElement)) buildOverlay();
    else if (!settings.overlay && ov) { clearInterval(ov.timer); ov.host.remove(); ov = null; }
    else render();
  }

  /* ---------------- loss warning modal ---------------- */
  function syncWarning() {
    const w = tracker.warning;
    const show = !!(tracker.active && w && !w.dismissed);
    if (show && !modal) {
      const { host, root } = makeHost('flip-tracker-warning');
      const back = el('div', 'backdrop');
      const m = el('div', 'modal'); m.setAttribute('role', 'alertdialog'); m.setAttribute('data-ft', 'warning');
      const p = el('div');
      p.append(el('span', 'w', 'WARNING!'), document.createTextNode(' Maybe you should change seeds or try a different game for now\u2026 you\u2019ve lost ' + money(w.threshold) + ' so far.'));
      const close = el('button', null, 'Close'); close.setAttribute('data-ft', 'close');
      close.addEventListener('click', () => { hideWarning(); ext.runtime.sendMessage({ type: 'dismissWarning' }).catch(() => {}); });
      m.append(p, close); back.appendChild(m); root.appendChild(back);
      modal = { host, at: w.at };
    } else if (!show && modal) hideWarning();
    else if (show && modal && modal.at !== w.at) { hideWarning(); syncWarning(); }
  }
  function hideWarning() { if (modal) { modal.host.remove(); modal = null; } }

  /* ---------------- data ---------------- */
  function load() {
    return ext.storage.local.get(['settings', 'tracker', 'flips', 'overlayState', 'codesCache', 'codeMarks']).then((r) => {
      codes = { cache: r.codesCache || null, marks: r.codeMarks || {} };
      settings = Object.assign(settings, r.settings || {});
      tracker = Object.assign({ active: false }, r.tracker || {});
      flips = Array.isArray(r.flips) ? r.flips : [];
      if (r.overlayState) pos = Object.assign(pos, r.overlayState);
    });
  }
  function start() {
    load().then(() => { syncOverlay(); syncWarning(); });
    ext.storage.onChanged.addListener((ch, area) => {
      if (area !== 'local') return;
      if (ch.settings) settings = Object.assign(settings, ch.settings.newValue || {});
      if (ch.tracker) tracker = Object.assign({ active: false }, ch.tracker.newValue || {});
      if (ch.flips) flips = ch.flips.newValue || [];
      if (ch.settings || ch.tracker || ch.flips) { syncOverlay(); syncWarning(); }
      if (ch.codesCache || ch.codeMarks) {
        if (ch.codesCache) codes.cache = ch.codesCache.newValue || null;
        if (ch.codeMarks) codes.marks = ch.codeMarks.newValue || {};
        renderCodes();
      }
    });
    window.addEventListener('resize', layout);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
