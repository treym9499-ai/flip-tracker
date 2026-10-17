/*
 * Flip Tracker — parse public Telegram channel previews (https://t.me/s/<channel>)
 * for recently posted bonus/drop codes. Regex-based (no DOMParser in MV3 service workers).
 * Rules live in codes-config.js. Output is plain data; UI renders it with textContent only.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./codes-config.js'));
  else root.FlipTelegramCodes = factory(root.FlipCodesConfig);
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';
  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
  function decode(s) {
    return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (m, e) => {
      if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
      return ENT[e.toLowerCase()] !== undefined ? ENT[e.toLowerCase()] : m;
    });
  }
  function htmlToText(html) {
    return decode(html.replace(/<br\s*\/?>/gi, '\n').replace(/<i class="emoji"[^>]*><b>(.*?)<\/b><\/i>/gi, '$1')
      .replace(/<[^>]+>/g, '')).replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  }
  const stop = new Set(C.STOPWORDS);
  function okToken(t) {
    if (!t || t.length < 5 || t.length > 40) return false;
    if (stop.has(t.toLowerCase())) return false;
    if (/^\d+$/.test(t)) return false;            // plain numbers (amounts, dates)
    if (/^\d+(sc|gc|k|m)$/i.test(t)) return false; // "2000SC"
    return true;
  }
  function reAll(re, s) { re.lastIndex = 0; const out = []; let m; while ((m = re.exec(s))) { out.push(m); if (m.index === re.lastIndex) re.lastIndex++; } return out; }

  /** Extract code candidates from a post's plain text. */
  function extractCodes(text) {
    const found = [];
    const add = (c) => { if (okToken(c) && !found.some((x) => x.toLowerCase() === c.toLowerCase())) found.push(c); };
    for (const m of reAll(C.KEYWORD_CODE, text)) add(m[1]);
    for (const m of reAll(C.STAKE_TOKEN, text)) add(m[0]);
    for (const k of reAll(C.NEAR_KEYWORD, text)) {
      const win = text.slice(k.index, k.index + C.NEAR_CHARS);
      for (const m of reAll(C.UPPER_TOKEN, win)) add(m[0]);
    }
    return found;
  }

  function details(text) {
    const d = {};
    for (const [k, re] of Object.entries(C.DETAILS)) { const m = re.exec(text); if (m) d[k] = m[1].trim().replace(/[-–\s]+$/, ''); }
    return d;
  }

  /** Parse a t.me/s/<channel> HTML page -> [{ code|null, codeInMedia, channel, postId, url, ts, snippet, details }] */
  function parsePreview(html, channelId) {
    const out = [];
    const chunks = String(html || '').split('tgme_widget_message_wrap').slice(1);
    for (const ch of chunks) {
      const pm = /data-post="([A-Za-z0-9_]{3,64})\/(\d{1,12})"/.exec(ch);
      if (!pm || pm[1].toLowerCase() !== String(channelId).toLowerCase()) continue; // only the channel's own posts
      const tm = /<time[^>]*datetime="([^"]+)"/.exec(ch);
      const ts = tm ? Date.parse(tm[1]) : null;
      const xm = /<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(ch);
      if (!xm) continue;
      const text = htmlToText(xm[1]);
      if (!C.POST_HINT.test(text)) continue;
      const codes = extractCodes(text);
      const base = {
        channel: pm[1], postId: Number(pm[2]), url: 'https://t.me/' + pm[1] + '/' + pm[2], ts,
        snippet: text.replace(/Do not click Telegram ads[\s\S]*$/i, '').replace(/\s+/g, ' ').trim().slice(0, 160),
        details: details(text)
      };
      if (codes.length) codes.forEach((code) => out.push(Object.assign({ code, codeInMedia: false }, base)));
      else if (C.CODE_IN_MEDIA.test(text)) out.push(Object.assign({ code: null, codeInMedia: true }, base));
    }
    return out;
  }

  function mergeItems(lists, max) {
    const all = [].concat(...lists);
    const seen = new Set();
    return all.filter((x) => { const k = (x.code || 'media') + '|' + x.url; if (seen.has(k)) return false; seen.add(k); return true; })
      .sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, max || C.MAX_ITEMS);
  }

  function age(ts, now) {
    if (!ts) return 'unknown time';
    const s = Math.max(0, Math.round(((now || Date.now()) - ts) / 1000));
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' h ago';
    return Math.round(s / 86400) + ' d ago';
  }

  /** Choose what to display from one scan: last-12h window, else newest N (flagged). */
  function selectWindow(items, now, windowMs, fallbackN) {
    const recent = items.filter((x) => x.ts && now - x.ts <= windowMs);
    if (recent.length) return { items: recent, mode: 'window' };
    return { items: items.slice(0, fallbackN), mode: 'fallback' };
  }

  return { parsePreview, extractCodes, htmlToText, mergeItems, selectWindow, age };
});
