/* global UI, FlipStats, FlipCodesUI, ext */
(function () {
  'use strict';
  const { h, card, fmtAmt, fmtSigned, pct, cls, sideEl, outcomeEl } = UI;
  const $ = (id) => document.getElementById(id);
  $('note').textContent = UI.NOTE;
  // Intro: "Made by TDM" for 5 seconds every time the popup opens.
  setTimeout(() => { $('intro').classList.add('hidden'); $('main').classList.remove('hidden'); }, 5000);
  let tracker = { active: false };
  $('tracker').addEventListener('click', () => UI.send({ type: 'setTracker', active: !tracker.active }));
  $('overlayToggle').addEventListener('change', (e) => UI.send({ type: 'setSettings', settings: { overlay: e.target.checked } }));
  $('open').addEventListener('click', () => {
    if (ext.runtime.openOptionsPage) ext.runtime.openOptionsPage().catch(() => ext.tabs.create({ url: ext.runtime.getURL('ui/dashboard.html') }));
    else ext.tabs.create({ url: ext.runtime.getURL('ui/dashboard.html') });
    window.close();
  });
  async function render() {
    const r = await UI.load();
    const settings = r.settings || {};
    const tr = await ext.storage.local.get('tracker');
    tracker = Object.assign({ active: false }, tr.tracker || {});
    $('tracker').textContent = tracker.active ? '\u25A0 Stop Tracker' : '\u25B6 Begin Tracker';
    $('tracker').classList.toggle('on', !!tracker.active);
    $('trackerInd').replaceChildren(h('span', { class: 'tdot' + (tracker.active ? ' on' : '') }),
      tracker.active ? ' Tracking since ' + new Date(tracker.startedAt).toLocaleTimeString() : ' Stopped \u2014 not recording');
    $('overlayToggle').checked = !!settings.overlay;
    const s = FlipStats.computeStats(r.flips || [], { sessionGapMin: settings.sessionGapMin || 30 });
    const st = s.streaks;
    $('cards').replaceChildren(
      card('Flips', String(s.flips), s.wins + 'W / ' + s.losses + 'L'),
      card('Win rate', pct(s.winRate)),
      card('Streak', st.current.length ? st.current.length + (st.current.type === 'win' ? ' W' : ' L') : '—', 'best W ' + st.longestWin + ' · L ' + st.longestLoss),
      ...Object.entries(s.currencies).map(([c, v]) => card('Net ' + c, fmtSigned(v.net, c), 'ROI ' + pct(v.roi), cls(v.net))));
    const last = s.rows.slice(-6).reverse();
    $('recent').replaceChildren(last.length ? h('table', {}, h('tbody', {}, last.map((x) => h('tr', {},
      h('td', {}, sideEl(x.pick)), h('td', {}, sideEl(x.result)), h('td', {}, outcomeEl(x.win)), h('td', { text: fmtAmt(x.amount, x.currency) })))))
      : h('p', { class: 'muted', text: 'No flips yet. Open Flip on stake.us and play as usual.' }));
    $('status').textContent = 'Read-only · never places bets' + (settings.debug ? ' · DEBUG ON' : '');
  }
  const st = document.createElement('style'); st.textContent = FlipCodesUI.CSS; document.head.appendChild(st);
  async function renderCodes() {
    const r = await ext.storage.local.get(['codesCache', 'codeMarks']);
    FlipCodesUI.render($('codes'), { cache: r.codesCache || null, marks: r.codeMarks || {} }, { buttonClass: 'tracker-btn' });
  }
  renderCodes();
  ext.storage.onChanged.addListener((ch, area) => { if (area === 'local' && (ch.codesCache || ch.codeMarks)) renderCodes(); });
  ext.storage.onChanged.addListener((ch, area) => { if (area === 'local') render(); });
  render();
})();
