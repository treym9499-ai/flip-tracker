/* Cross-browser namespace: Safari/Firefox expose `browser` (promise-based);
 * Chrome exposes `chrome` (promise-based for the MV3 APIs we use). */
(function (g) {
  g.ext = (typeof g.browser !== 'undefined' && g.browser && g.browser.runtime) ? g.browser : g.chrome;
})(typeof self !== 'undefined' ? self : this);
