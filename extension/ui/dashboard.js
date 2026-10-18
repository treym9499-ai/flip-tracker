/* global UI, FlipStats, ext */
(function () {
  'use strict';
  const { h, card, fmtAmt, fmtSigned, pct, cls, fmtTime, sideEl, outcomeEl } = UI;
  const $ = (id) => document.getElementById(id);
  let state = { flips: [], settings: {}, debugShapes: [] };
  $('note').append(h('b', { text: 'Note: ' }), UI.NOTE);

  function filters() {
    const from = $('fFrom').value ? new Date($('fFrom').value + 'T00:00:00').getTime() : null;
    const to = $('fTo').value ? new Date($('fTo').value + 'T23:59:59.999').getTime() : null;
    return { from, to, currency: $('fCur').value, sessionGapMin: state.settings.sessionGapMin || 30 };
  }

  function render() {
    const s = FlipStats.computeStats(state.flips, filters());
    state.lastStats = s;
    // currency filter options
    const curs = Array.from(new Set(state.flips.map((f) => f.currency || '?'))).sort();
    const sel = $('fCur'), cur = sel.value;
    sel.replaceChildren(h('option', { value: 'ALL', text: 'All' }), ...curs.map((c) => h('option', { value: c, text: c })));
    sel.value = curs.includes(cur) ? cur : 'ALL';

    $('status').textContent = state.flips.length + ' flips stored' + (state.lastCaptureAt ? ' · last capture ' + fmtTime(state.lastCaptureAt) : '') + (state.settings.debug ? ' · DEBUG ON' : '');

    const cs = Object.entries(s.currencies);
    const st = s.streaks;
    const g = s.games;
    $('cards').replaceChildren(
      card('Games played', String(g.played), g.open ? g.open + ' still open' : 'Play \u2192 lose or cash out', null),
      card('Games won', String(g.won), 'cashed out', 'pos'),
      card('Games lost', String(g.lost), null, 'neg'),
      card('Game win rate', pct(g.winRate), 'of finished games'),
      card('Flips', String(s.flips), s.wins + ' W / ' + s.losses + ' L' + (s.unknown ? ' · ' + s.unknown + ' ?' : '')),
      card('Flip win rate', pct(s.winRate), 'of decided flips'),
      card('Current streak', st.current.length ? st.current.length + ' ' + (st.current.type === 'win' ? 'W' : 'L') : '—', null, st.current.type === 'win' ? 'pos' : st.current.type === 'loss' ? 'neg' : ''),
      card('Longest win streak', String(st.longestWin), null, 'pos'),
      card('Longest loss streak', String(st.longestLoss), null, 'neg'),
      ...cs.map(([c, v]) => card('Net ' + c, fmtSigned(v.net, c), 'ROI ' + pct(v.roi) + ' · wagered ' + fmtAmt(v.wagered, c), cls(v.net)))
    );

    $('curTable').replaceChildren(cs.length ? h('table', {},
      h('thead', {}, h('tr', {}, ['Currency', 'Games', 'Wagered', 'Paid out', 'Net', 'ROI'].map((t) => h('th', { text: t })))),
      h('tbody', {}, cs.map(([c, v]) => h('tr', {}, h('td', { text: c }), h('td', { text: v.bets + (v.bets - v.settled ? ' (' + (v.bets - v.settled) + ' open)' : '') }),
        h('td', { text: fmtAmt(v.wagered, c) }), h('td', { text: fmtAmt(v.payout, c) }),
        h('td', { class: cls(v.net), text: fmtSigned(v.net, c) }), h('td', { class: cls(v.roi), text: pct(v.roi) })))))
      : h('p', { class: 'muted', text: 'No data yet. Play Flip on stake.us with the extension enabled, or add a flip manually.' }));

    $('splits').replaceChildren(
      h('div', { class: 'muted', text: 'Your picks', style: 'margin-bottom:4px' }), UI.splitBar(s.picks.heads, s.picks.tails),
      h('div', { class: 'muted', text: 'Results', style: 'margin:12px 0 4px' }), UI.splitBar(s.results.heads, s.results.tails));

    $('last25').setAttribute('data-seq', FlipStats.sequence(s.last25));
    $('last25').replaceChildren(...(s.last25.length ? s.last25.flatMap((f, i) => {
      const x = h('span', { class: 'seq-' + (f.result === 'heads' ? 'H' : 'T'), title: (f.result === 'heads' ? 'Heads' : 'Tails') + ' · ' + fmtTime(f.ts), text: f.result === 'heads' ? 'H' : 'T' });
      return i ? [h('span', { class: 'muted', text: ',' }), x] : [x];
    }) : [h('span', { class: 'muted', text: 'No flips yet' })]));
    const chartCurs = Object.keys(s.series);
    $('charts').replaceChildren(...(chartCurs.length ? chartCurs.map((c) => h('div', { style: 'margin-bottom:10px' },
      h('div', { class: 'muted', text: c }), UI.lineChart(s.series[c], c))) : [UI.lineChart([], '')]));

    $('sessions').replaceChildren(h('table', {},
      h('thead', {}, h('tr', {}, ['#', 'Start', 'Duration', 'Flips', 'Flip W / L', 'Games', 'Net'].map((t) => h('th', { text: t })))),
      h('tbody', {}, s.sessions.slice().reverse().map((x) => h('tr', {},
        h('td', { text: String(x.no) }), h('td', { text: fmtTime(x.start) }),
        h('td', { text: Math.max(1, Math.round((x.end - x.start) / 60000)) + ' min' }),
        h('td', { text: String(x.flips) }), h('td', { text: x.wins + ' / ' + x.losses }), h('td', { text: String(x.bets) }),
        h('td', {}, ...Object.entries(x.net).map(([c, v]) => h('span', { class: cls(v), text: fmtSigned(v, c) + '  ' }))))))));

    const lim = parseInt($('limit').value, 10);
    const rows = s.rows.slice().reverse();
    const shown = lim ? rows.slice(0, lim) : rows;
    $('flips').replaceChildren(h('table', { id: 'flipTable' },
      h('thead', {}, h('tr', {}, ['Time', 'Session', 'Game', 'Flip #', 'Pick', 'Result', 'Outcome', 'Bet', 'Mult.', 'Payout', 'Source', ''].map((t) => h('th', { text: t })))),
      h('tbody', {}, shown.map((r) => h('tr', {},
        h('td', { text: fmtTime(r.ts) }), h('td', { text: String(r.session) }), h('td', { text: String(r.round) }), h('td', { text: String(r.flipIndex) }),
        h('td', {}, sideEl(r.pick)), h('td', {}, sideEl(r.result)), h('td', {}, outcomeEl(r.win)),
        h('td', { text: fmtAmt(r.amount, r.currency) }), h('td', { text: r.multiplier ? r.multiplier + '×' : '—' }),
        h('td', { text: r.payout !== null && r.payout !== undefined ? fmtAmt(r.payout, r.currency) : (r.betActive ? 'open' : '—') }),
        h('td', { class: 'muted', text: r.source }),
        h('td', {}, h('button', { class: 'link', title: 'Delete this flip', onclick: () => del(r.id), text: '×' })))))),
      rows.length > shown.length ? h('p', { class: 'muted', text: 'Showing ' + shown.length + ' of ' + rows.length }) : null);

    $('sDebug').checked = !!state.settings.debug;
    $('sDom').checked = !!state.settings.domFallback;
    if (document.activeElement !== $('sWarn')) $('sWarn').value = state.settings.lossWarnSC || 10;
    if (document.activeElement !== $('sGap')) $('sGap').value = state.settings.sessionGapMin || 30;
    renderIc();
    $('debugCount').textContent = (state.debugShapes || []).length + ' debug shapes saved';
  }

  function renderIc() {
      const now = Date.now();
      const fr = state.ic && state.ic.frames ? Object.values(state.ic.frames).filter((f) => now - f.at < 2 * 60000) : [];
      const sum = (k) => fr.reduce((a, f) => a + (f[k] || 0), 0);
      $('icStatus').textContent = 'Interceptor active in ' + fr.length + ' frame' + (fr.length === 1 ? '' : 's') + ' \u00b7 ' + sum('seen') + ' responses seen \u00b7 ' + sum('flipLike') + ' flip-like' +
        (fr.length ? '' : ' (open stake.us in a tab to start it)');
  }
  setInterval(renderIc, 15000);

  async function refresh() {
    const r = await UI.load();
    state = { flips: r.flips || [], settings: Object.assign({ debug: false, domFallback: false, sessionGapMin: 30, lossWarnSC: 10 }, r.settings || {}), debugShapes: r.debugShapes || [], lastCaptureAt: r.lastCaptureAt, ic: r.interceptorStatus || null };
    render();
  }
  async function del(id) { await UI.send({ type: 'deleteFlip', id }); }
  const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

  ['fFrom', 'fTo', 'fCur', 'limit'].forEach((id) => $(id).addEventListener('change', render));
  $('fReset').addEventListener('click', () => { $('fFrom').value = ''; $('fTo').value = ''; $('fCur').value = 'ALL'; render(); });
  $('btnCsv').addEventListener('click', () => {
    const s = FlipStats.computeStats(state.flips, filters());
    UI.download('flip-tracker-' + stamp() + '.csv', FlipStats.toCSV(s.rows), 'text/csv;charset=utf-8');
    UI.toast('Exported ' + s.rows.length + ' flips (current filters) to CSV');
  });
  $('btnJson').addEventListener('click', () => {
    UI.download('flip-tracker-' + stamp() + '.json', JSON.stringify({ app: 'flip-tracker', version: 1, exportedAt: new Date().toISOString(), flips: state.flips }, null, 2), 'application/json');
    UI.toast('Exported ' + state.flips.length + ' flips to JSON');
  });
  $('btnImport').addEventListener('click', () => $('fileImport').click());
  $('fileImport').addEventListener('change', async (e) => {
    const file = e.target.files[0]; e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const flips = Array.isArray(data) ? data : data && Array.isArray(data.flips) ? data.flips : null;
      if (!flips) throw new Error('No "flips" array found');
      const r = await UI.send({ type: 'importFlips', flips: flips.slice(0, 200000) });
      UI.toast('Imported: ' + r.added + ' new, ' + r.updated + ' updated');
    } catch (err) { UI.toast('Import failed: ' + err.message); }
  });
  $('btnReset').addEventListener('click', async () => {
    if (!confirm('Reset stats? This deletes all ' + state.flips.length + ' recorded flips (games, P/L, streaks) and starts a fresh tracker session. Export JSON first if you want a backup.')) return;
    await UI.send({ type: 'resetStats' }); UI.toast('Stats reset');
  });
  $('btnClear').addEventListener('click', async () => {
    if (!confirm('Delete ALL ' + state.flips.length + ' stored flips? Export a JSON backup first if you want to keep them. This cannot be undone.')) return;
    await UI.send({ type: 'clearAll' }); UI.toast('All flip data cleared');
  });
  $('sDebug').addEventListener('change', (e) => UI.send({ type: 'setSettings', settings: { debug: e.target.checked } }));
  $('sDom').addEventListener('change', (e) => UI.send({ type: 'setSettings', settings: { domFallback: e.target.checked } }));
  $('sWarn').addEventListener('change', (e) => UI.send({ type: 'setSettings', settings: { lossWarnSC: e.target.value } }));
  $('sGap').addEventListener('change', (e) => UI.send({ type: 'setSettings', settings: { sessionGapMin: e.target.value } }));
  $('btnDebugExport').addEventListener('click', () => {
    UI.download('flip-tracker-debug-shapes-' + stamp() + '.json', JSON.stringify({ app: 'flip-tracker', kind: 'debug-shapes', note: 'Keys only; values redacted except game fields. No headers/cookies/tokens.', ua: navigator.userAgent, shapes: state.debugShapes }, null, 2), 'application/json');
  });
  $('btnDebugClear').addEventListener('click', () => UI.send({ type: 'clearDebug' }));

  const form = $('manual');
  const localNow = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 19); };
  form.ts.value = localNow();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pick = form.pick.value, result = form.result.value, win = pick === result;
    const amount = parseFloat(form.amount.value);
    const mult = form.multiplier.value ? parseFloat(form.multiplier.value) : (win ? 1.96 : 0);
    const payout = form.payout.value ? parseFloat(form.payout.value) : (win ? amount * mult : 0);
    const flip = { ts: new Date(form.ts.value).getTime(), pick, result, win, amount, currency: form.currency.value,
      multiplier: mult, payout, betId: form.betId.value.trim() || null, flipIndex: parseInt(form.flipIndex.value, 10) || 1 };
    try { await UI.send({ type: 'addManual', flip }); UI.toast('Flip added'); form.amount.value = ''; form.payout.value = ''; form.ts.value = localNow(); }
    catch (err) { UI.toast('Could not add: ' + err.message); }
  });

  ext.storage.onChanged.addListener((ch, area) => {
    if (area !== 'local') return;
    const keys = Object.keys(ch);
    if (keys.length === 1 && keys[0] === 'interceptorStatus') { state.ic = ch.interceptorStatus.newValue || null; renderIc(); return; }
    refresh();
  });
  refresh();
})();
