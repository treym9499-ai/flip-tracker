/*
 * Flip Tracker — PAGE-WORLD OBSERVER (read-only).
 * Wraps fetch / XMLHttpRequest / WebSocket purely to *observe* responses from
 * Stake's API. It never modifies requests or responses, never reads request
 * or response HEADERS, cookies or storage, and never initiates any request.
 * Matching payloads are handed to the extension's content script via a
 * DOM CustomEvent (JSON string); parsing + whitelisting happens there.
 */
(function () {
  'use strict';
  var script = document.currentScript;
  var channel = script && script.dataset && script.dataset.channel;
  if (!channel || window.__flipTrackerObserver) return;
  Object.defineProperty(window, '__flipTrackerObserver', { value: true });

  var API = /\/_api\//i;
  var HINT = /flip/i;
  var MAX = 1500000;

  function stripQuery(u) { try { var x = new URL(u, location.href); return x.origin + x.pathname; } catch (e) { return String(u).split('?')[0]; } }
  function emit(o) {
    try { document.dispatchEvent(new CustomEvent(channel, { detail: JSON.stringify(o) })); } catch (e) { /* ignore */ }
  }
  function maybeEmit(transport, url, reqBody, text) {
    if (typeof text !== 'string' || text.length > MAX) return;
    if (HINT.test(text) || HINT.test(url) || (reqBody && HINT.test(reqBody))) {
      emit({ transport: transport, url: stripQuery(url), requestBody: reqBody && reqBody.length < MAX ? reqBody : null, responseText: text });
    }
  }

  /* fetch */
  var origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    var wrapped = function (input, init) {
      var p = origFetch.apply(this, arguments);
      try {
        var url = typeof input === 'string' ? input : (input && input.url) || String(input);
        if (API.test(url)) {
          var bodyP = init && typeof init.body === 'string' ? Promise.resolve(init.body)
            : (input && typeof input === 'object' && typeof input.clone === 'function' && !(init && init.body))
              ? input.clone().text().catch(function () { return null; }) : Promise.resolve(null);
          p.then(function (res) {
            var c; try { c = res.clone(); } catch (e) { return; }
            Promise.all([bodyP, c.text()]).then(function (v) { maybeEmit('fetch', url, v[0], v[1]); }).catch(function () {});
          }).catch(function () {});
        }
      } catch (e) { /* never interfere */ }
      return p;
    };
    try { Object.defineProperty(wrapped, 'name', { value: 'fetch' }); } catch (e) {}
    window.fetch = wrapped;
  }

  /* XMLHttpRequest */
  var XP = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
  if (XP) {
    var oOpen = XP.open, oSend = XP.send;
    XP.open = function (method, url) { try { this.__ftUrl = String(url); } catch (e) {} return oOpen.apply(this, arguments); };
    XP.send = function (body) {
      try {
        var xhr = this, url = xhr.__ftUrl || '';
        if (API.test(url)) {
          var reqBody = typeof body === 'string' ? body : null;
          xhr.addEventListener('loadend', function () {
            try {
              var t = xhr.responseType;
              var text = (t === '' || t === 'text') ? xhr.responseText : (t === 'json' ? JSON.stringify(xhr.response) : null);
              maybeEmit('xhr', url, reqBody, text);
            } catch (e) {}
          });
        }
      } catch (e) {}
      return oSend.apply(this, arguments);
    };
  }

  /* WebSocket (receive-only observation) */
  var OWS = window.WebSocket;
  if (typeof OWS === 'function') {
    var WS = function (url, protocols) {
      var ws = arguments.length > 1 ? new OWS(url, protocols) : new OWS(url);
      try {
        var u = stripQuery(String(url));
        if (API.test(u) || /stake/i.test(u)) {
          ws.addEventListener('message', function (ev) {
            if (typeof ev.data === 'string' && HINT.test(ev.data)) maybeEmit('ws', u, null, ev.data);
          });
        }
      } catch (e) {}
      return ws;
    };
    WS.prototype = OWS.prototype;
    ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach(function (k) { try { Object.defineProperty(WS, k, { value: OWS[k] }); } catch (e) {} });
    try { Object.setPrototypeOf(WS, OWS); } catch (e) {}
    window.WebSocket = WS;
  }
})();
