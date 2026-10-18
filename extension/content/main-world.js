/*
 * Flip Tracker — MAIN-WORLD OBSERVER (read-only). Declared in manifest.json with
 * "world": "MAIN", "run_at": "document_start", "all_frames": true, so Chrome runs it
 * before any page script and regardless of the page's Content-Security-Policy.
 *
 * Wraps fetch / XMLHttpRequest / WebSocket purely to OBSERVE responses. It never modifies
 * requests or responses, never reads headers, cookies or storage, never sends requests.
 * Game-/bet-looking JSON is posted to the isolated content script via window.postMessage
 * tagged with TAG; parsing, whitelisting and redaction happen there.
 */
(function () {
  'use strict';
  if (window.__flipTrackerObserver) return;
  try { Object.defineProperty(window, '__flipTrackerObserver', { value: true }); } catch (e) { window.__flipTrackerObserver = true; }

  var TAG = '__flip_tracker_v1__';
  var HINT = /bet|game|casino|flip|payout|multiplier/i;
  var MAX = 1500000;
  var frameId = Math.random().toString(36).slice(2, 10);
  var seen = 0, gameLike = 0, lastSent = '';

  function post(o) {
    o.tag = TAG; o.frameId = frameId;
    try { window.postMessage(o, '*'); } catch (e) { /* ignore */ }
  }
  function stripQuery(u) { try { var x = new URL(u, location.href); return x.origin + x.pathname; } catch (e) { return String(u).split('?')[0]; } }
  function observe(transport, url, reqBody, text) {
    seen++;
    if (typeof text !== 'string' || !text || text.length > MAX) return;
    var c = text.charAt(0) === ' ' || text.charAt(0) === '\n' ? text.trimStart().charAt(0) : text.charAt(0);
    if (c !== '{' && c !== '[') return; // JSON only
    if (!HINT.test(text) && !(reqBody && HINT.test(reqBody))) return;
    gameLike++;
    post({ kind: 'traffic', transport: transport, url: stripQuery(url),
      requestBody: typeof reqBody === 'string' && reqBody.length < MAX ? reqBody : null, responseText: text });
  }
  var lastBeat = 0;
  function status() {
    var s = seen + ':' + gameLike, now = Date.now();
    if (s === lastSent && now - lastBeat < 30000) return; // changes every 5 s, heartbeat every 30 s
    lastSent = s; lastBeat = now;
    post({ kind: 'status', seen: seen, gameLike: gameLike, path: location.pathname, top: window === window.top });
  }
  post({ kind: 'status', seen: 0, gameLike: 0, path: location.pathname, top: window === window.top, hello: true });
  setInterval(status, 5000);

  /* fetch */
  var origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    var wrapped = function fetch(input, init) {
      var p = origFetch.apply(this, arguments);
      try {
        var url = typeof input === 'string' ? input : (input && input.url) || String(input);
        var bodyP = init && typeof init.body === 'string' ? Promise.resolve(init.body)
          : (input && typeof input === 'object' && typeof input.clone === 'function' && !(init && init.body))
            ? input.clone().text().catch(function () { return null; }) : Promise.resolve(null);
        p.then(function (res) {
          var ct = ''; try { ct = res.headers.get('content-type') || ''; } catch (e) {} // content-type only, never other headers
          if (/event-stream|image|video|audio|font|octet/i.test(ct)) { seen++; return; }
          var c; try { c = res.clone(); } catch (e) { return; }
          Promise.all([bodyP, c.text()]).then(function (v) { observe('fetch', url, v[0], v[1]); }).catch(function () {});
        }).catch(function () {});
      } catch (e) { /* never interfere */ }
      return p;
    };
    window.fetch = wrapped;
  }

  /* XMLHttpRequest */
  var XP = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
  if (XP) {
    var oOpen = XP.open, oSend = XP.send;
    XP.open = function open(method, url) { try { this.__ftUrl = String(url); } catch (e) {} return oOpen.apply(this, arguments); };
    XP.send = function send(body) {
      try {
        var xhr = this, url = xhr.__ftUrl || '';
        var reqBody = typeof body === 'string' ? body : null;
        xhr.addEventListener('loadend', function () {
          try {
            var t = xhr.responseType;
            var text = (t === '' || t === 'text') ? xhr.responseText : (t === 'json' ? JSON.stringify(xhr.response) : null);
            observe('xhr', url, reqBody, text);
          } catch (e) {}
        });
      } catch (e) {}
      return oSend.apply(this, arguments);
    };
  }

  /* WebSocket: our own listener on every instance sees all messages, whether the app
     uses ws.onmessage = ... or ws.addEventListener('message', ...). */
  var OWS = window.WebSocket;
  if (typeof OWS === 'function') {
    var WS = function WebSocket(url, protocols) {
      var ws = arguments.length > 1 ? new OWS(url, protocols) : new OWS(url);
      try {
        var u = String(url);
        ws.addEventListener('message', function (ev) {
          if (typeof ev.data === 'string') observe('ws', u, null, ev.data); else seen++;
        });
      } catch (e) {}
      return ws;
    };
    WS.prototype = OWS.prototype;
    ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach(function (k) { try { Object.defineProperty(WS, k, { value: OWS[k] }); } catch (e) {} });
    try { Object.setPrototypeOf(WS, OWS); } catch (e) {}
    window.WebSocket = WS;
  }
})();
