/*
 * Flip Tracker — on-page overlay + loss-warning modal (content script, Shadow DOM).
 * Read-only with respect to Stake: it never touches Stake's UI. Its own buttons only
 * talk to the extension (Begin/Stop Tracker, collapse, close warning).
 */
/* global ext, FlipStats, FlipCodesUI */
(function () {
  'use strict';
  if (window.__flipTrackerOverlay || window !== window.top) return; // overlay/modal only in the top frame
  window.__flipTrackerOverlay = true;

  function FlipStatusLine(st) {
    const now = Date.now();
    const fr = st && st.frames ? Object.values(st.frames).filter((f) => now - f.at < 2 * 60000) : [];
    const sum = (k) => fr.reduce((a, f) => a + (f[k] || 0), 0);
    return 'Interceptor active in ' + fr.length + ' frame' + (fr.length === 1 ? '' : 's') + ' \u00b7 ' + sum('seen') + ' responses seen \u00b7 ' + sum('flipLike') + ' flip-like';
  }
  const NOTE = 'Each flip is an independent 50/50 (provably fair). Past results don\u2019t predict future flips.';
  const INTRO_MS = 5000;
  let settings = { overlay: false, lossWarnSC: 10 };
  let tracker = { active: false };
  let flips = [];
  const POS_VERSION = 2; // bumping this resets everyone's saved position to the top-right dock
  let pos = { x: null, y: null, collapsed: false };
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
  .box{position:fixed;width:272px;background:#000;color:#39FF14;border:2px solid #39FF14;border-radius:10px;
    font:10.5px/1.35 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;animation:pulse 1.6s ease-in-out infinite;
    pointer-events:auto;user-select:none;overflow:hidden}
  .box.pill{width:auto;border-radius:999px}
  .box.pill .hd{border-bottom:none;padding:3px 6px 3px 9px}
  .hd{display:flex;align-items:center;gap:6px;padding:4px 6px 4px 8px;cursor:move;border-bottom:1px solid rgba(57,255,20,.35);
    letter-spacing:.06em;font-weight:700;position:relative;z-index:1;background:#000;white-space:nowrap}
  .hd .t{flex:1}
  .pillinfo{font-weight:700;opacity:.9}
  .dot{width:8px;height:8px;border-radius:50%;background:#1d4d14;display:inline-block;flex:none}
  .dot.on{background:#39FF14;box-shadow:0 0 8px #39FF14;animation:blink 1s infinite}
  button{font:inherit;color:#39FF14;background:#000;border:1px solid #39FF14;border-radius:6px;padding:3px 7px;cursor:pointer;font-weight:700}
  button:hover{background:#0b2a06}
  .icon{padding:0 5px;line-height:15px;font-size:11px}
  .bd{padding:6px 8px 8px;max-height:min(55vh, 420px);overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;
    -webkit-overflow-scrolling:touch;touch-action:pan-y;scrollbar-width:thin;scrollbar-color:#39FF14 #000}
  .bd::-webkit-scrollbar{width:5px}
  .bd::-webkit-scrollbar-track{background:#000}
  .bd::-webkit-scrollbar-thumb{background:#39FF14;border-radius:3px;box-shadow:0 0 6px #39FF14}
  .seq{font-weight:800;letter-spacing:.02em;word-break:break-all;line-height:1.45;font-size:11px}
  .seq .H{color:#3b9cff}.seq .T{color:#ff9f1c}.seq .c{opacity:.45}
  .intro{display:flex;align-items:center;justify-content:center;height:96px;font-size:18px;font-weight:800;letter-spacing:.06em;
    text-shadow:0 0 8px #39FF14}
  .top{display:flex;gap:6px;align-items:center}
  .go{flex:1;padding:5px 6px;font-size:11px;letter-spacing:.04em}
  .go.on{background:#39FF14;color:#000}
  .games{text-align:right;line-height:1.15;white-space:nowrap;font-size:9.5px}
  .games b{font-size:15px;display:block}
  .st{opacity:.75;margin:3px 0 2px;font-size:9.5px}
  h4{margin:6px 0 2px;font-size:9.5px;letter-spacing:.08em;opacity:.8;font-weight:700}
  .sep{border-top:1px solid rgba(57,255,20,.25);margin:7px 0 2px}
  table{width:100%;border-collapse:collapse}
  td,th{padding:1px 3px;text-align:right;font-variant-numeric:tabular-nums}
  th{font-weight:600;opacity:.7}
  td:first-child,th:first-child{text-align:left}
  .neg{color:#ff3b3b}
  .note{margin-top:5px;padding:4px 6px;border:1px dashed rgba(57,255,20,.45);border-radius:6px;font-size:9.5px;opacity:.85}
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
    const pill = el('span', 'pillinfo hidden'); pill.setAttribute('data-ft', 'pill');
    const rst = el('button', 'icon', '\u2197'); rst.title = 'Reset position (top-right)'; rst.setAttribute('data-ft', 'reset-pos');
    const col = el('button', 'icon', '\u2013'); col.title = 'Collapse / expand'; col.setAttribute('data-ft', 'collapse');
    hd.append(dot, title, pill, rst, col);
    const intro = el('div', 'intro', 'Made by TDM'); intro.setAttribute('data-ft', 'intro');
    const bd = el('div', 'bd'); bd.setAttribute('data-ft', 'body');
    const top = el('div', 'top');
    const go = el('button', 'go'); go.setAttribute('data-ft', 'toggle');
    const games = el('div', 'games'); games.setAttribute('data-ft', 'games-top');
    top.append(go, games);
    const st = el('div', 'st'); st.setAttribute('data-ft', 'status');
    const plH = el('h4', null, 'SESSION P/L \u00b7 per game');
    const pl = el('table'); pl.setAttribute('data-ft', 'pl');
    const lsH = el('h4', null, 'LAST 25 FLIPS \u00b7 oldest \u2192 newest');
    const ls = el('div', 'seq'); ls.setAttribute('data-ft', 'last25');
    const sep = el('div', 'sep');
    const fsH = el('h4', null, 'DETAILED STATS (this session)');
    const fs = el('table'); fs.setAttribute('data-ft', 'flipstats');
    const note = el('div', 'note', NOTE); note.setAttribute('data-ft', 'note');
    const cdH = el('h4', null, 'RECENTLY POSTED CODES');
    const cd = el('div'); cd.setAttribute('data-ft', 'codes');
    const dbg = el('div', 'st'); dbg.setAttribute('data-ft', 'debug-status');
    bd.append(top, st, plH, pl, lsH, ls, note, sep, fsH, fs, cdH, cd, dbg);
    box.append(hd, intro, bd);
    root.appendChild(box);

    go.addEventListener('click', () => ext.runtime.sendMessage({ type: 'setTracker', active: !tracker.active }).catch(() => {}));
    col.addEventListener('click', (e) => { e.stopPropagation(); pos.collapsed = !pos.collapsed; savePos(); layout(); });
    rst.addEventListener('click', (e) => { e.stopPropagation(); pos.x = null; pos.y = null; savePos(); layout(); });

    // dragging (header only)
    let drag = null;
    hd.addEventListener('pointerdown', (e) => {
      if (e.target === col || e.target === rst) return;
      if (pos.collapsed) return; // the pill stays docked top-right
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

    ov = { host, root, box, dot, intro, bd, go, st, pl, fs, col, cd, dbg, ls, games, pill, title, rst };
    ov.timer = setInterval(renderCodes, 30000);
    if (!introDone) {
      introDone = true;
      ov.introActive = true;
      setTimeout(() => { if (ov) { ov.introActive = false; layout(); } }, INTRO_MS);
    }
    layout(); render(); renderCodes(); renderDebug();
  }
  function savePos() { ext.storage.local.set({ overlayState: { v: POS_VERSION, x: pos.x, y: pos.y, collapsed: pos.collapsed } }).catch(() => {}); }
  function layout() {
    if (!ov) return;
    const docked = pos.collapsed || pos.x === null || pos.y === null;
    if (docked) { ov.box.style.left = 'auto'; ov.box.style.right = '12px'; ov.box.style.top = '12px'; }
    else {
      const x = Math.max(0, Math.min(window.innerWidth - 60, pos.x)), y = Math.max(0, Math.min(window.innerHeight - 30, pos.y));
      ov.box.style.right = 'auto'; ov.box.style.left = x + 'px'; ov.box.style.top = y + 'px';
    }
    ov.box.classList.toggle('pill', !!pos.collapsed);
    ov.pill.classList.toggle('hidden', !pos.collapsed);
    ov.title.textContent = pos.collapsed ? 'FT' : 'FLIP TRACKER';
    ov.rst.classList.toggle('hidden', !!pos.collapsed);
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
    const g = s.games;
    const scNet = (s.currencies.SC || { net: 0 }).net;
    const gb = el('b', null, String(g.played)); gb.setAttribute('data-k', 'games'); gb.setAttribute('data-value', String(g.played));
    ov.games.replaceChildren(gb, document.createTextNode('games \u00b7 ' + g.won + 'W/' + g.lost + 'L'));
    ov.pill.textContent = g.played + 'g \u00b7 ' + fmt(scNet, 'SC') + ' SC';
    ov.pill.classList.toggle('neg', scNet < 0);
    ov.fs.replaceChildren(
      row([{ text: 'Games won / lost' }, { text: g.won + ' / ' + g.lost + (g.open ? ' (' + g.open + ' open)' : ''), k: 'games-won', v: g.won }]),
      row([{ text: 'Flips (W / L)' }, { text: s.flips + ' (' + s.wins + ' / ' + s.losses + ')', k: 'flips', v: s.flips }]),
      row([{ text: 'Results heads' }, { text: s.results.heads + ' (' + Math.round(s.results.heads / t * 100) + '%)', k: 'heads', v: s.results.heads }]),
      row([{ text: 'Results tails' }, { text: s.results.tails + ' (' + Math.round(s.results.tails / t * 100) + '%)', k: 'tails', v: s.results.tails }]),
      row([{ text: 'Current streak' }, { text: cs.length ? cs.length + (cs.type === 'win' ? ' W' : ' L') : '\u2014' }]),
      row([{ text: 'Longest W / L' }, { text: s.streaks.longestWin + ' / ' + s.streaks.longestLoss }]));
    const seq = s.last25;
    ov.ls.setAttribute('data-seq', FlipStats.sequence(seq));
    ov.ls.replaceChildren(...(seq.length ? seq.flatMap((f, i) => {
      const x = el('span', f.result === 'heads' ? 'H' : 'T', f.result === 'heads' ? 'H' : 'T');
      x.title = (f.result === 'heads' ? 'Heads' : 'Tails') + ' \u00b7 game flip #' + f.flipIndex + ' \u00b7 ' + new Date(f.ts).toLocaleTimeString();
      return i ? [el('span', 'c', ','), x] : [x];
    }) : [el('span', 'c', 'No flips yet this session')]));
  }
  let icStatus = null;
  function renderDebug() {
    if (!ov) return;
    ov.dbg.classList.toggle('hidden', !settings.debug);
    ov.dbg.textContent = FlipStatusLine(icStatus);
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
    return ext.storage.local.get(['settings', 'tracker', 'flips', 'overlayState', 'codesCache', 'codeMarks', 'interceptorStatus']).then((r) => {
      icStatus = r.interceptorStatus || null;
      codes = { cache: r.codesCache || null, marks: r.codeMarks || {} };
      settings = Object.assign(settings, r.settings || {});
      tracker = Object.assign({ active: false }, r.tracker || {});
      flips = Array.isArray(r.flips) ? r.flips : [];
      if (r.overlayState && r.overlayState.v === POS_VERSION) pos = Object.assign(pos, r.overlayState);
      else if (r.overlayState) savePos(); // v1.0.1: reset old positions to top-right
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
      if (ch.overlayState && ch.overlayState.newValue && ch.overlayState.newValue.v === POS_VERSION) { pos = Object.assign(pos, ch.overlayState.newValue); layout(); }
      if (ch.interceptorStatus || ch.settings) { if (ch.interceptorStatus) icStatus = ch.interceptorStatus.newValue || null; renderDebug(); }
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
