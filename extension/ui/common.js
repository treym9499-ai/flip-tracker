/* Shared UI helpers (no remote code, no innerHTML with data). */
/* global ext */
(function (g) {
  'use strict';
  const NOTE = 'Each flip is an independent 50/50 (provably fair). Past results don\u2019t predict future flips.';
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'text') el.textContent = v; else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
    return el;
  }
  function fmtAmt(v, cur) {
    if (v === null || v === undefined || !Number.isFinite(v)) return '—';
    const max = Math.abs(v) < 1 && v !== 0 ? 4 : 2;
    return v.toLocaleString(undefined, { maximumFractionDigits: max, minimumFractionDigits: cur === 'SC' ? 2 : 0 }) + (cur ? ' ' + cur : '');
  }
  function fmtSigned(v, cur) { if (v === null || !Number.isFinite(v)) return '—'; return (v > 0 ? '+' : '') + fmtAmt(v, cur); }
  function pct(v) { return v === null || !Number.isFinite(v) ? '—' : (v * 100).toFixed(1) + '%'; }
  function cls(v) { return v > 0 ? 'pos' : v < 0 ? 'neg' : ''; }
  function fmtTime(ts) { return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
  function sideEl(s) { return s ? h('span', { class: 'side ' + (s === 'heads' ? 'h' : 't'), text: s === 'heads' ? 'Heads' : 'Tails' }) : h('span', { class: 'muted', text: '—' }); }
  function outcomeEl(w) { return h('span', { class: 'pill ' + (w === true ? 'win' : w === false ? 'loss' : 'unk'), text: w === true ? 'Win' : w === false ? 'Loss' : '?' }); }
  function card(k, v, s, vcls) { return h('div', { class: 'card' }, h('div', { class: 'k', text: k }), h('div', { class: 'v ' + (vcls || ''), text: v }), s ? h('div', { class: 's', text: s }) : null); }
  function splitBar(a, b) {
    const t = a + b || 1;
    return h('div', {}, h('div', { class: 'bar' }, h('span', { class: 'heads', style: 'width:' + (a / t * 100) + '%' }), h('span', { class: 'tails', style: 'width:' + (b / t * 100) + '%' })),
      h('div', { class: 'row muted', style: 'justify-content:space-between;font-size:12px;margin-top:4px' },
        h('span', { text: 'Heads ' + a + ' (' + pct(a / t) + ')' }), h('span', { text: 'Tails ' + b + ' (' + pct(b / t) + ')' })));
  }
  /** Inline SVG line chart of cumulative profit (no external libs). */
  function lineChart(points, cur, opts) {
    opts = opts || {};
    const W = opts.width || 760, H = opts.height || 220, P = { l: 64, r: 14, t: 14, b: 26 };
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Cumulative profit ' + cur);
    const mk = (t, a) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); svg.appendChild(e); return e; };
    const pts = [{ ts: points.length ? points[0].ts : 0, value: 0 }].concat(points);
    const vals = pts.map((p) => p.value);
    let lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
    if (hi === lo) { hi += 1; lo -= 1; }
    const x = (i) => P.l + (pts.length < 2 ? 0 : (i / (pts.length - 1)) * (W - P.l - P.r));
    const y = (v) => P.t + (1 - (v - lo) / (hi - lo)) * (H - P.t - P.b);
    for (let k = 0; k <= 4; k++) {
      const v = lo + (hi - lo) * k / 4;
      mk('line', { x1: P.l, x2: W - P.r, y1: y(v), y2: y(v), stroke: '#2f4553', 'stroke-width': 1 });
      const t = mk('text', { x: P.l - 6, y: y(v) + 4, fill: '#8fa3b1', 'font-size': 11, 'text-anchor': 'end' });
      t.textContent = fmtAmt(v);
    }
    mk('line', { x1: P.l, x2: W - P.r, y1: y(0), y2: y(0), stroke: '#8fa3b1', 'stroke-width': 1, 'stroke-dasharray': '4 3' });
    if (pts.length > 1) {
      const d = pts.map((p, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p.value).toFixed(1)).join(' ');
      const last = pts[pts.length - 1].value;
      const color = last >= 0 ? '#00e701' : '#ff4d5e';
      mk('path', { d: d + ` L${x(pts.length - 1).toFixed(1)} ${y(0)} L${x(0)} ${y(0)} Z`, fill: color, opacity: 0.08 });
      mk('path', { d, fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round' });
      const t0 = mk('text', { x: P.l, y: H - 6, fill: '#8fa3b1', 'font-size': 11 }); t0.textContent = new Date(pts[1].ts).toLocaleDateString();
      const t1 = mk('text', { x: W - P.r, y: H - 6, fill: '#8fa3b1', 'font-size': 11, 'text-anchor': 'end' }); t1.textContent = new Date(pts[pts.length - 1].ts).toLocaleDateString() + ' · ' + (pts.length - 1) + ' rounds';
    } else {
      const t = mk('text', { x: W / 2, y: H / 2, fill: '#8fa3b1', 'font-size': 13, 'text-anchor': 'middle' }); t.textContent = 'No settled rounds yet';
    }
    return svg;
  }
  function download(name, text, mime) {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = h('a', { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  function send(msg) {
    return ext.runtime.sendMessage(msg).then((r) => { if (!r || !r.ok) throw new Error((r && r.error) || 'no response'); return r.result; });
  }
  function load() { return ext.storage.local.get(['flips', 'settings', 'debugShapes', 'lastCaptureAt']); }
  function toast(msg) {
    let t = document.querySelector('.toast'); if (!t) { t = h('div', { class: 'toast' }); document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('show'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 2500);
  }
  g.UI = { NOTE, h, fmtAmt, fmtSigned, pct, cls, fmtTime, sideEl, outcomeEl, card, splitBar, lineChart, download, send, load, toast };
})(window);
