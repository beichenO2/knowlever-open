/**
 * Preview-relative base path for static assets (depth 0–2 under preview/).
 * Asset URLs: getWikiBasePath() + 'assets/js/...'
 *
 * Priority order:
 * 1. window.__KNOWLEVER_BASE — set by build.js per-page (authoritative for prefix-served sites like serve-multi).
 *    Empty string '' is a valid value (top-level page); only undefined falls through.
 * 2. <base href> — explicit override.
 * 3. /preview/ marker — auto-detect under preview directory.
 * 4. pathname depth heuristic — fallback for legacy single-topic sites.
 */
(function () {
  window.getWikiBasePath = function getWikiBasePath() {
    if (typeof window.__KNOWLEVER_BASE === 'string') {
      return window.__KNOWLEVER_BASE;
    }

    var pathname = window.location && window.location.pathname ? window.location.pathname : '';

    var base = document.querySelector('base[href]');
    if (base) {
      var href = base.getAttribute('href') || '';
      if (href) return href.replace(/\/?$/, '/');
    }

    var marker = '/preview/';
    var rel;
    var idx = pathname.indexOf(marker);
    if (idx !== -1) {
      rel = pathname.slice(idx + marker.length);
    } else {
      rel = pathname.replace(/^\/+/, '');
    }
    var segments = rel.split('/').filter(function (s) {
      return s.length > 0;
    });
    var depth = Math.max(0, segments.length - 1);
    if (depth === 0) return '';
    if (depth === 1) return '../';
    if (depth === 2) return '../../';
    var out = '';
    for (var i = 0; i < depth; i++) {
      out += '../';
    }
    return out;
  };
})();
