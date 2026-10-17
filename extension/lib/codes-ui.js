/*
 * Flip Tracker — "Recently posted codes" panel renderer (shared by overlay + popup).
 * Renders untrusted Telegram text via textContent only. Never redeems anything.
 */
/* global ext */
(function (g) {
  'use strict';
  const CSS = `
  .cd-head{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
  .cd-meta{font-size:10.5px;opacity:.8;flex:1;min-width:150px}
  .cd-warn{font-size:10.5px;opacity:.8;margin:4px 0 6px}
  .cd-list{max-height:220px;overflow:auto;display:flex;flex-direction:column;gap:6px;padding-right:2px}
  .cd-item{border:1px solid rgba(57,255,20,.4);border-radius:8px;padding:6px 7px}
  .cd-row{display:flex;align-items:center;gap:6px}
  .cd-code{flex:1;font-weight:800;font-size:12.5px;word-break:break-all;user-select:text}
  .cd-sub{font-size:10.5px;opacity:.8;margin-top:2px}
  .cd-snip{font-size:10.5px;opacity:.7;margin-top:2px}
  .cd-act{display:flex;gap:5px;margin-top:4px;flex-wrap:wrap;align-items:center}
  .cd-act a{color:inherit;font-size:10.5px}
  .cd-sm{padding:2px 7px !important;font-size:10.5px !important}
  .cd-err{color:#ff6b6b;font-size:10.5px}
  .cd-empty{font-size:11px;opacity:.75}`;

  function age(ms) {
    const s = Math.round(Math.abs(ms) / 1000);
    if (s < 60) return s + 's';
    if (s < 3600) return Math.round(s / 60) + ' min';
    if (s < 86400) return (s / 3600).toFixed(s < 36000 ? 1 : 0).replace(/\.0$/, '') + ' h';
    return Math.round(s / 86400) + ' d';
  }
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }

  async function copyText(text, root) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* fall back */ }
    try {
      const ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;left:-9999px;top:0';
      (root || document.body).appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok;
    } catch (e) { return false; }
  }
  function send(msg) { return ext.runtime.sendMessage(msg).then((r) => (r && r.ok ? r.result : Promise.reject(new Error(r && r.error)))); }

  /** render(container, { cache, marks }, { root, now, buttonClass }) */
  function render(container, data, opts) {
    opts = opts || {};
    const now = opts.now || Date.now();
    const cache = data.cache || {};
    const marks = data.marks || {};
    const items = Array.isArray(cache.items) ? cache.items : [];
    const visible = items.filter((x) => !x.code || !marks[x.code]);
    const hidden = items.filter((x) => x.code && marks[x.code]);
    const bc = opts.buttonClass || '';

    const head = el('div', 'cd-head');
    const meta = el('span', 'cd-meta');
    meta.setAttribute('data-ft', 'codes-meta');
    meta.textContent = (cache.refreshedAt ? 'Last refreshed ' + age(now - cache.refreshedAt) + ' ago' : 'Not refreshed yet') +
      ' \u00b7 next refresh ' + (cache.nextRefreshAt ? (cache.nextRefreshAt > now ? 'in ' + age(cache.nextRefreshAt - now) : 'due now') : 'scheduled every 12 h');
    const btn = el('button', bc + ' cd-sm', 'Refresh now'); btn.setAttribute('data-ft', 'codes-refresh');
    btn.addEventListener('click', async () => {
      btn.disabled = true; btn.textContent = 'Refreshing\u2026';
      try {
        const r = await send({ type: 'refreshCodes' });
        btn.textContent = r && r.limited ? 'Try again in ' + Math.ceil(r.retryInMs / 60000) + ' min' : 'Refreshed';
      } catch (e) { btn.textContent = 'Failed'; }
      setTimeout(() => { btn.disabled = false; btn.textContent = 'Refresh now'; }, 3000);
    });
    head.append(meta, btn);

    const warn = el('div', 'cd-warn', 'From official Stake.us Telegram channels. Codes may already be expired or fully claimed \u2014 we can\u2019t check without redeeming, and Flip Tracker never redeems or touches your account.' +
      (cache.mode === 'fallback' ? ' No codes posted in the last 12 h \u2014 showing the newest ' + items.length + ' (older).' : ' Showing codes posted in the last 12 h.'));
    warn.setAttribute('data-ft', 'codes-mode');

    const list = el('div', 'cd-list'); list.setAttribute('data-ft', 'codes-list');
    if (!visible.length) list.appendChild(el('div', 'cd-empty', items.length ? 'All codes from this scan are hidden.' : 'No codes found in the latest scan.'));
    for (const it of visible) {
      const box = el('div', 'cd-item'); box.setAttribute('data-ft', 'code-item');
      const row = el('div', 'cd-row');
      if (it.code) {
        const code = el('span', 'cd-code', it.code); code.setAttribute('data-ft', 'code');
        const copy = el('button', bc + ' cd-sm', 'Copy'); copy.setAttribute('data-ft', 'copy');
        copy.addEventListener('click', async () => {
          const ok = await copyText(it.code, opts.root);
          copy.textContent = ok ? 'Copied!' : 'Copy failed';
          setTimeout(() => { copy.textContent = 'Copy'; }, 1500);
        });
        row.append(code, copy);
      } else row.append(el('span', 'cd-code', 'Code is in the post\u2019s image/video'));
      const d = it.details || {};
      const sub = el('div', 'cd-sub', it.channel + ' \u00b7 posted ' + (it.ts ? age(now - it.ts) + ' ago' : 'unknown time') +
        (d.value ? ' \u00b7 ' + d.value : '') + (d.requirements ? ' \u00b7 req: ' + d.requirements : ''));
      const snip = el('div', 'cd-snip', it.snippet || '');
      const act = el('div', 'cd-act');
      const a = el('a', null, 'Open post \u2197');
      if (/^https:\/\/t\.me\/[A-Za-z0-9_]+\/\d+$/.test(it.url)) { a.href = it.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; }
      act.appendChild(a);
      if (it.code) {
        for (const [mark, label] of [['used', 'Used'], ['failed', 'Didn\u2019t work']]) {
          const b = el('button', bc + ' cd-sm', label); b.setAttribute('data-ft', 'mark-' + mark);
          b.addEventListener('click', () => send({ type: 'markCode', code: it.code, mark }));
          act.appendChild(b);
        }
      }
      box.append(row, sub, snip, act);
      list.appendChild(box);
    }
    const kids = [head, warn, list];
    if (hidden.length) {
      const un = el('button', bc + ' cd-sm', 'Unhide ' + hidden.length + ' marked'); un.setAttribute('data-ft', 'codes-unhide');
      un.addEventListener('click', () => send({ type: 'unhideCodes', codes: hidden.map((x) => x.code) }));
      kids.push(un);
    }
    if (cache.errors && cache.errors.length) kids.push(el('div', 'cd-err', 'Last refresh issues: ' + cache.errors.join('; ')));
    container.replaceChildren(...kids);
  }

  g.FlipCodesUI = { CSS, render, age };
})(typeof self !== 'undefined' ? self : this);
