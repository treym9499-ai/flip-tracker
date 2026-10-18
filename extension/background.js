/* Flip Tracker — background service worker. Serialises all writes to storage.local. */
try { importScripts('lib/browser-shim.js', 'lib/records.js', 'lib/stats.js', 'lib/codes-config.js', 'lib/telegram-codes.js'); } catch (e) { /* loaded via manifest scripts */ }
/* global ext, FlipRecords, FlipStats, FlipCodesConfig, FlipTelegramCodes */

const DEFAULT_SETTINGS = { debug: false, domFallback: false, sessionGapMin: 30, overlay: false, lossWarnSC: 10 };
const DEFAULT_TRACKER = { active: false, sessionId: null, startedAt: null, stoppedAt: null, warnArmed: true, warning: null };
const MAX_DEBUG = 200;
let chain = Promise.resolve();
function serial(fn) { const p = chain.then(fn); chain = p.catch(() => {}); return p; }

async function get(keys) { return ext.storage.local.get(keys); }
async function getSettings() { const r = await get('settings'); return Object.assign({}, DEFAULT_SETTINGS, r.settings || {}); }
async function getTracker() { const r = await get('tracker'); return Object.assign({}, DEFAULT_TRACKER, r.tracker || {}); }
async function getFlips() { const r = await get('flips'); return Array.isArray(r.flips) ? r.flips : []; }

const handlers = {
  async capture(msg, sender) {
    if (!sender.tab) throw new Error('capture only from content scripts');
    const tracker = await getTracker();
    if (!tracker.active) return { ignored: 'tracker stopped' }; // nothing is recorded until "Begin Tracker"
    const tagged = (msg.flips || []).map((f) => Object.assign({}, f, { trackerSession: tracker.sessionId }));
    const res = FlipRecords.merge(await getFlips(), tagged, msg.betUpdates, msg.source);
    if (res.added || res.updated) await ext.storage.local.set({ flips: res.flips, lastCaptureAt: Date.now() });
    await checkLossWarning(tracker, res.flips);
    return { added: res.added, updated: res.updated };
  },
  async debugShape(msg) {
    const s = await getSettings();
    if (!s.debug) return { stored: false };
    const r = await get('debugShapes');
    const list = Array.isArray(r.debugShapes) ? r.debugShapes : [];
    const shape = msg.shape || {};
    const ex = shape.sig ? list.find((x) => x.sig === shape.sig) : null;
    if (ex) { ex.count = (ex.count || 1) + 1; ex.lastAt = shape.at; if (shape.parsed && shape.parsed.flipLike) Object.assign(ex, shape, { count: ex.count }); }
    else list.push(Object.assign({ count: 1 }, shape));
    await ext.storage.local.set({ debugShapes: list.slice(-MAX_DEBUG) });
    return { stored: true };
  },
  async addManual(msg) {
    const rec = Object.assign({}, msg.flip, { source: 'manual', betActive: false, id: 'm-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) });
    const res = FlipRecords.merge(await getFlips(), [rec], [], 'manual');
    await ext.storage.local.set({ flips: res.flips });
    return { added: res.added };
  },
  async importFlips(msg) {
    const incoming = (msg.flips || []).map((f) => Object.assign({}, f, { source: f.source || 'import' }));
    const res = FlipRecords.merge(await getFlips(), incoming, [], 'import');
    await ext.storage.local.set({ flips: res.flips });
    return { added: res.added, updated: res.updated, total: res.flips.length };
  },
  async deleteFlip(msg) {
    const flips = (await getFlips()).filter((f) => f.id !== msg.id);
    await ext.storage.local.set({ flips });
    return { total: flips.length };
  },
  async resetStats() {
    const t = await getTracker();
    const nt = t.active ? Object.assign({}, DEFAULT_TRACKER, { active: true, sessionId: 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), startedAt: Date.now() })
      : Object.assign({}, DEFAULT_TRACKER);
    await ext.storage.local.set({ flips: [], lastCaptureAt: null, tracker: nt });
    return { ok: true };
  },
  async clearAll() { await ext.storage.local.set({ flips: [] }); return { ok: true }; },
  async clearDebug() { await ext.storage.local.set({ debugShapes: [] }); return { ok: true }; },
  async setSettings(msg) {
    const s = Object.assign(await getSettings(), msg.settings || {});
    s.sessionGapMin = Math.min(1440, Math.max(1, parseInt(s.sessionGapMin, 10) || 30));
    s.debug = !!s.debug; s.domFallback = !!s.domFallback; s.overlay = !!s.overlay;
    s.lossWarnSC = Math.max(0.01, Math.min(1e9, parseFloat(s.lossWarnSC) || 10));
    await ext.storage.local.set({ settings: s });
    return s;
  },
  async getSettings() { return getSettings(); },
  async interceptorStatus(msg, sender) {
    if (!sender.tab || !msg.frame) return null;
    const r = await get('interceptorStatus');
    const st = r.interceptorStatus && r.interceptorStatus.frames ? r.interceptorStatus : { frames: {} };
    const now = Date.now();
    const f = msg.frame;
    st.frames[String(f.id).slice(0, 20)] = { at: now, tab: sender.tab.id, top: !!f.top, path: String(f.path || '').slice(0, 120),
      seen: Number(f.seen) || 0, gameLike: Number(f.gameLike) || 0, flipLike: Number(f.flipLike) || 0 };
    for (const k of Object.keys(st.frames)) if (now - st.frames[k].at > 10 * 60000) delete st.frames[k];
    await ext.storage.local.set({ interceptorStatus: st });
    return true;
  },
  async setTracker(msg) {
    let t = await getTracker();
    if (msg.active && !t.active) {
      t = Object.assign({}, DEFAULT_TRACKER, { active: true, sessionId: 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), startedAt: Date.now() });
    } else if (!msg.active && t.active) {
      t = Object.assign({}, t, { active: false, stoppedAt: Date.now() });
    }
    await ext.storage.local.set({ tracker: t });
    return t;
  },
  async getTracker() { return getTracker(); },
  async refreshCodes() {
    const c = (await get('codesCache')).codesCache || {};
    const since = Date.now() - (c.lastManualAt || 0);
    if (since < FlipCodesConfig.MANUAL_GAP_MS) return { limited: true, retryInMs: FlipCodesConfig.MANUAL_GAP_MS - since };
    return refreshCodes('manual');
  },
  async markCode(msg) {
    const marks = (await get('codeMarks')).codeMarks || {};
    if (msg.mark === 'used' || msg.mark === 'failed') marks[String(msg.code).slice(0, 60)] = msg.mark;
    else delete marks[String(msg.code).slice(0, 60)];
    await ext.storage.local.set({ codeMarks: marks });
    return marks;
  },
  async unhideCodes(msg) {
    const marks = (await get('codeMarks')).codeMarks || {};
    for (const code of msg.codes || []) delete marks[code];
    await ext.storage.local.set({ codeMarks: marks });
    return marks;
  },
  async dismissWarning() {
    const t = await getTracker();
    if (t.warning) { t.warning = Object.assign({}, t.warning, { dismissed: true }); await ext.storage.local.set({ tracker: t }); }
    return t;
  }
};

/* Loss warning: fires once each time the tracker session's SC net crosses <= -threshold. */
async function checkLossWarning(tracker, flips) {
  const settings = await getSettings();
  const T = Number(settings.lossWarnSC) > 0 ? Number(settings.lossWarnSC) : 10;
  const sess = flips.filter((f) => f.trackerSession === tracker.sessionId);
  const sc = FlipStats.computeStats(sess).currencies.SC;
  const net = sc ? sc.net : 0;
  if (net <= -T + 1e-9) {
    if (tracker.warnArmed !== false) {
      tracker.warnArmed = false;
      tracker.warning = { at: Date.now(), threshold: T, net, dismissed: false };
      await ext.storage.local.set({ tracker });
    }
  } else if (tracker.warnArmed === false) {
    tracker.warnArmed = true; // back above the line: re-arm for the next crossing
    await ext.storage.local.set({ tracker });
  }
}

ext.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !handlers[msg.type] || sender.id !== ext.runtime.id) return false;
  serial(() => handlers[msg.type](msg, sender))
    .then((r) => sendResponse({ ok: true, result: r }))
    .catch((e) => sendResponse({ ok: false, error: String(e && e.message || e) }));
  return true; // async sendResponse (works in Chrome and Safari)
});

/* ---------------- Bonus codes: official Telegram channel previews, every 12 h ---------------- */
async function fetchWithTimeout(url, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { credentials: 'omit', cache: 'no-store', signal: ctl.signal }); } finally { clearTimeout(t); }
}
async function nextAlarmAt() {
  try { const a = await ext.alarms.get(FlipCodesConfig.ALARM_NAME); return a ? a.scheduledTime : null; } catch (e) { return null; }
}
async function refreshCodes(reason) {
  const C = FlipCodesConfig, T = FlipTelegramCodes;
  const old = (await get('codesCache')).codesCache || {};
  const now = Date.now();
  if (old.backoffUntil && now < old.backoffUntil && reason !== 'install') {
    return Object.assign({}, old, { skipped: 'backoff' });
  }
  const lists = [], errors = [];
  let backoff = false;
  for (const ch of C.CHANNELS) { // sequential: one request per official channel
    try {
      const res = await fetchWithTimeout(C.PREVIEW_URL(ch.id), C.TIMEOUT_MS);
      if (res.status === 429 || res.status >= 500) { backoff = true; errors.push(ch.id + ': HTTP ' + res.status); continue; }
      if (!res.ok) { errors.push(ch.id + ': HTTP ' + res.status); continue; }
      lists.push(T.parsePreview(await res.text(), ch.id));
    } catch (e) { errors.push(ch.id + ': ' + (e && e.name === 'AbortError' ? 'timeout' : String(e && e.message || e))); }
  }
  const cache = Object.assign({}, old, {
    lastAttemptAt: now, errors, nextRefreshAt: await nextAlarmAt(),
    lastManualAt: reason === 'manual' ? now : old.lastManualAt || 0,
    backoffUntil: backoff ? now + C.BACKOFF_MS : 0
  });
  if (lists.length) {
    // REPLACE the list with this scan only.
    const scanned = T.mergeItems(lists, C.MAX_ITEMS);
    const sel = T.selectWindow(scanned, now, C.WINDOW_MS, C.FALLBACK_COUNT);
    Object.assign(cache, { refreshedAt: now, items: sel.items, mode: sel.mode, scannedCount: scanned.length });
  } // on total failure the previous list is kept and the error is shown
  await ext.storage.local.set({ codesCache: cache });
  return cache;
}
async function ensureAlarm() {
  const C = FlipCodesConfig;
  try {
    const a = await ext.alarms.get(C.ALARM_NAME);
    if (!a) await ext.alarms.create(C.ALARM_NAME, { periodInMinutes: C.REFRESH_MINUTES, delayInMinutes: C.REFRESH_MINUTES });
  } catch (e) { /* alarms unavailable */ }
  const c = (await get('codesCache')).codesCache;
  if (!c || !c.refreshedAt) await serial(() => refreshCodes('install')); // first run: fetch once if cache empty
  else if (!c.nextRefreshAt) { c.nextRefreshAt = await nextAlarmAt(); await ext.storage.local.set({ codesCache: c }); }
}
if (ext.alarms) {
  ext.alarms.onAlarm.addListener((a) => { if (a.name === FlipCodesConfig.ALARM_NAME) serial(() => refreshCodes('alarm')); });
}
ext.runtime.onInstalled.addListener((d) => {
  ensureAlarm();
  if (d && d.reason === 'update') serial(async () => {
    // 1.0.1 migration: drop records 1.0.0 could create from feeds/DOM without a real bet id.
    const flips = await getFlips();
    const keep = flips.filter((f) => f.source === 'manual' || f.source === 'import' || (f.betId && !/^nb:|^dom:/.test(f.id)));
    if (keep.length !== flips.length) await ext.storage.local.set({ flips: keep, migratedRemoved: flips.length - keep.length });
  });
});
ext.runtime.onStartup && ext.runtime.onStartup.addListener(() => { ensureAlarm(); });
ensureAlarm();
