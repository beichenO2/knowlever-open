/**
 * Breadcrumb (NAV-02), sidebar TOC (NAV-03), Prism (UIC-02),
 * wiki [[links]] (UIC-03), related pages (UIC-04), prev/next (UIC-05).
 * Data loaded from assets/data/site-page-data.js (window.__WIKI_SLUG_MAP etc.)
 */
(function () {
  var WIKI_SLUG_MAP = window.__WIKI_SLUG_MAP || {};
  var PAGE_REGISTRY = window.__PAGE_REGISTRY || [];
  var CONTENT_SEQUENCES = window.__CONTENT_SEQUENCES || {};
  var PRISM_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/';

  function onReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  function contentPathKind(pathname) {
    if (pathname.indexOf('/entities/') !== -1) return { kind: 'entities', label: '实体' };
    if (pathname.indexOf('/structures/') !== -1) return { kind: 'structures', label: '结构' };
    if (pathname.indexOf('/sources/') !== -1) return { kind: 'sources', label: '来源' };
    return null;
  }

  function projectFolderName(parts, typeKey) {
    var i;
    for (i = 0; i < parts.length; i++) {
      if (parts[i] === typeKey) break;
    }
    if (i >= parts.length || i + 1 >= parts.length) return null;
    var seg = parts[i + 1];
    if (/\.html?$/i.test(seg)) return null;
    if (i + 2 < parts.length && /\.html?$/i.test(parts[i + 2])) return seg;
    return null;
  }

  function humanizeFolder(name) {
    if (!name) return name;
    var lower = name.toLowerCase();
    var map = {
      nextjs: 'Next.js',
      fastapi: 'FastAPI',
      langchain: 'LangChain',
      agent: 'Agent'
    };
    if (map[lower]) return map[lower];
    return name.charAt(0).toUpperCase() + name.slice(1);
  }

  function buildBreadcrumb(base, pathname) {
    var meta = contentPathKind(pathname);
    if (!meta) return null;

    var parts = pathname.split('/').filter(function (p) {
      return p.length > 0;
    });
    var project = projectFolderName(parts, meta.kind);

    var h1 = document.querySelector('.page-content h1');
    var title = h1 && h1.textContent ? h1.textContent.trim() : '';

    var bits = [];
    bits.push('<a href="' + base + 'index.html">首页</a>');
    bits.push('<span aria-hidden="true">›</span>');
    bits.push('<span>' + meta.label + '</span>');
    if (project) {
      bits.push('<span aria-hidden="true">›</span>');
      bits.push('<span>' + humanizeFolder(project) + '</span>');
    }
    if (title) {
      bits.push('<span aria-hidden="true">›</span>');
      bits.push('<span>' + title + '</span>');
    }

    var el = document.createElement('div');
    el.className = 'breadcrumb';
    el.setAttribute('aria-label', 'breadcrumb');
    el.innerHTML = bits.join('');
    return el;
  }

  function ensureBreadcrumb() {
    if (document.querySelector('.breadcrumb')) return;
    var base = typeof window.getWikiBasePath === 'function' ? window.getWikiBasePath() : '';
    var pathname = window.location.pathname || '';
    var crumb = buildBreadcrumb(base, pathname);
    if (!crumb) return;
    var header = document.querySelector('header.site-header');
    if (!header || !header.parentNode) return;
    header.parentNode.insertBefore(crumb, header.nextSibling);
  }

  function assignHeadingIds(container) {
    var headings = container.querySelectorAll('h2, h3');
    var n = 0;
    for (var i = 0; i < headings.length; i++) {
      var h = headings[i];
      if (h.id && String(h.id).trim()) continue;
      n += 1;
      var id = 'section-' + n;
      while (document.getElementById(id)) {
        n += 1;
        id = 'section-' + n;
      }
      h.id = id;
    }
  }

  function buildToc(container) {
    var headings = container.querySelectorAll('h2, h3');
    if (!headings.length) return null;

    assignHeadingIds(container);

    var nav = document.createElement('nav');
    nav.className = 'toc-nav';
    nav.setAttribute('aria-label', '页面目录');
    var h4 = document.createElement('h4');
    h4.textContent = '目录';
    nav.appendChild(h4);
    var ul = document.createElement('ul');

    for (var j = 0; j < headings.length; j++) {
      var hd = headings[j];
      var li = document.createElement('li');
      if (hd.tagName === 'H3') {
        li.className = 'toc-nav__sub';
      }
      var a = document.createElement('a');
      a.href = '#' + hd.id;
      a.textContent = (hd.textContent || '').trim();
      li.appendChild(a);
      ul.appendChild(li);
    }
    nav.appendChild(ul);
    return nav;
  }

  function ensureToc() {
    var layout = document.querySelector('.page-layout');
    if (!layout) return;

    var container =
      document.querySelector('.page-content .wiki-body') || document.querySelector('.page-content');
    if (!container) return;

    var toc = buildToc(container);
    if (!toc) return;

    var aside = layout.querySelector('aside.sidebar');
    if (!aside) {
      aside = document.createElement('aside');
      aside.className = 'sidebar';
      aside.setAttribute('data-toc-generated', '');
      layout.appendChild(aside);
    }
    aside.insertBefore(toc, aside.firstChild);
  }

  function currentSiteRelativePath() {
    var pathname = window.location.pathname || '';
    var marker = '/preview/';
    var idx = pathname.indexOf(marker);
    var rel = idx !== -1 ? pathname.slice(idx + marker.length) : pathname.replace(/^\/+/, '');
    return decodeURIComponent(rel.split('?')[0] || '');
  }

  function resolveWikiLinks(wikiBody, base, slugMap) {
    if (!wikiBody || !slugMap) return;
    var re = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

    function inSkip(el) {
      var p = el;
      while (p) {
        var tag = p.nodeName;
        if (tag === 'PRE' || tag === 'CODE' || tag === 'SCRIPT' || tag === 'STYLE' || tag === 'A') return true;
        p = p.parentElement;
      }
      return false;
    }

    var walker = document.createTreeWalker(wikiBody, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        if (!node.nodeValue || node.nodeValue.indexOf('[[') === -1) return NodeFilter.FILTER_REJECT;
        if (inSkip(node.parentNode)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    var textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);

    for (var t = 0; t < textNodes.length; t++) {
      var textNode = textNodes[t];
      var text = textNode.nodeValue;
      re.lastIndex = 0;
      if (!re.test(text)) continue;
      re.lastIndex = 0;
      var frag = document.createDocumentFragment();
      var last = 0;
      var m;
      while ((m = re.exec(text))) {
        if (m.index > last) {
          frag.appendChild(document.createTextNode(text.slice(last, m.index)));
        }
        var slug = (m[1] || '').trim();
        var label = (m[2] != null && m[2] !== '') ? m[2].trim() : slug;
        var path = slugMap[slug];
        if (path) {
          var a = document.createElement('a');
          a.href = base + path;
          a.textContent = label;
          frag.appendChild(a);
        } else {
          var span = document.createElement('span');
          span.className = 'pending-link';
          span.textContent = label;
          span.title = '未解析的 wiki 链接: ' + slug;
          frag.appendChild(span);
        }
        last = re.lastIndex;
      }
      if (last < text.length) {
        frag.appendChild(document.createTextNode(text.slice(last)));
      }
      textNode.parentNode.replaceChild(frag, textNode);
    }
  }

  function typeBadgeLabel(type) {
    var map = {
      entity: '实体',
      structure: '结构',
      concept: '概念',
      source: '来源',
      comparison: '对比',
      synthesis: '综合',
      question: '问答',
      page: '页面'
    };
    return map[type] || type || '页面';
  }

  function findRelatedPages(currentPath, registry, limit) {
    var lim = limit || 5;
    var cur = null;
    for (var i = 0; i < registry.length; i++) {
      if (registry[i].path === currentPath) {
        cur = registry[i];
        break;
      }
    }
    if (!cur) return [];
    var scored = [];
    for (var j = 0; j < registry.length; j++) {
      var p = registry[j];
      if (p.path === currentPath) continue;
      var score = 0;
      if (cur.tags && cur.tags.length && p.tags && p.tags.length) {
        for (var a = 0; a < p.tags.length; a++) {
          if (cur.tags.indexOf(p.tags[a]) !== -1) score++;
        }
      }
      if (score === 0 && cur.type && p.type === cur.type) score = 0.1;
      if (score > 0) scored.push({ page: p, score: score });
    }
    scored.sort(function (x, y) { return y.score - x.score; });
    var out = [];
    for (var k = 0; k < scored.length && out.length < lim; k++) {
      out.push(scored[k].page);
    }
    return out;
  }

  function buildRelatedSection(base, currentPath, registry) {
    var related = findRelatedPages(currentPath, registry, 5);
    if (!related.length) return null;

    var sec = document.createElement('section');
    sec.className = 'related-pages';
    sec.setAttribute('aria-labelledby', 'related-pages-heading');

    var h2 = document.createElement('h2');
    h2.id = 'related-pages-heading';
    h2.className = 'related-pages__title';
    h2.textContent = '相关页面';
    sec.appendChild(h2);

    var grid = document.createElement('div');
    grid.className = 'related-pages__grid';

    for (var i = 0; i < related.length; i++) {
      var pg = related[i];
      var card = document.createElement('a');
      card.className = 'related-pages__card';
      card.href = base + pg.path;
      var badge = document.createElement('span');
      badge.className = 'type-badge ' + (pg.type || 'page');
      badge.textContent = typeBadgeLabel(pg.type);
      var ttl = document.createElement('span');
      ttl.className = 'related-pages__card-title';
      ttl.textContent = pg.title || pg.slug;
      card.appendChild(badge);
      card.appendChild(ttl);
      grid.appendChild(card);
    }
    sec.appendChild(grid);
    return sec;
  }

  function findPrevNext(currentPath) {
    var lists = [];
    var k;
    if (typeof ENTITY_SEQUENCES !== 'undefined') {
      for (k in ENTITY_SEQUENCES) {
        if (ENTITY_SEQUENCES.hasOwnProperty(k)) lists.push(ENTITY_SEQUENCES[k]);
      }
    }
    if (typeof CONTENT_SEQUENCES !== 'undefined') {
      for (k in CONTENT_SEQUENCES) {
        if (CONTENT_SEQUENCES.hasOwnProperty(k)) lists.push(CONTENT_SEQUENCES[k]);
      }
    }
    for (var i = 0; i < lists.length; i++) {
      var seq = lists[i];
      var idx = seq.indexOf(currentPath);
      if (idx !== -1) {
        return {
          prev: idx > 0 ? seq[idx - 1] : null,
          next: idx < seq.length - 1 ? seq[idx + 1] : null
        };
      }
    }
    return { prev: null, next: null };
  }

  function titleForPath(relPath) {
    if (typeof PAGE_REGISTRY === 'undefined') return relPath;
    for (var i = 0; i < PAGE_REGISTRY.length; i++) {
      if (PAGE_REGISTRY[i].path === relPath) return PAGE_REGISTRY[i].title || relPath;
    }
    return relPath;
  }

  function buildPagerNav(base, currentPath) {
    var pn = findPrevNext(currentPath);
    if (!pn.prev && !pn.next) return null;

    var nav = document.createElement('nav');
    nav.className = 'page-pager';
    nav.setAttribute('aria-label', '上一页 / 下一页');

    function link(href, label, arrow) {
      var a = document.createElement('a');
      a.className = 'page-pager__link';
      a.href = base + href;
      a.innerHTML = arrow === 'prev'
        ? '<span class="page-pager__arr" aria-hidden="true">←</span><span class="page-pager__text">' + label + '</span>'
        : '<span class="page-pager__text">' + label + '</span><span class="page-pager__arr" aria-hidden="true">→</span>';
      return a;
    }

    var prevEl = document.createElement('div');
    prevEl.className = 'page-pager__cell page-pager__cell--prev';
    if (pn.prev) prevEl.appendChild(link(pn.prev, titleForPath(pn.prev), 'prev'));
    else prevEl.innerHTML = '<span class="page-pager__placeholder"></span>';

    var nextEl = document.createElement('div');
    nextEl.className = 'page-pager__cell page-pager__cell--next';
    if (pn.next) nextEl.appendChild(link(pn.next, titleForPath(pn.next), 'next'));
    else nextEl.innerHTML = '<span class="page-pager__placeholder"></span>';

    nav.appendChild(prevEl);
    nav.appendChild(nextEl);
    return nav;
  }

  function ensurePrismThemeLink() {
    var dark = document.documentElement.getAttribute('data-theme') === 'dark';
    var id = 'prism-agent-wiki-theme';
    var link = document.getElementById(id);
    if (!link) {
      link = document.createElement('link');
      link.id = id;
      link.rel = 'stylesheet';
      document.head.appendChild(link);
    }
    link.href = dark
      ? PRISM_CDN + 'themes/prism-tomorrow.min.css'
      : PRISM_CDN + 'themes/prism.min.css';
  }

  function loadScript(src, onload) {
    var s = document.createElement('script');
    s.src = src;
    s.async = false;
    s.onload = onload;
    s.onerror = function () {
      if (typeof console !== 'undefined' && console.warn) console.warn('Failed to load script', src);
      if (onload) onload();
    };
    document.head.appendChild(s);
  }

  function guessLanguage(code) {
    var t = (code || '').replace(/^\uFEFF/, '').trim();
    if (!t) return 'markdown';
    var first = t.split('\n')[0] || '';
    if (/^#!/.test(first) && /bash|sh|zsh/.test(first)) return 'bash';
    try {
      JSON.parse(t);
      return 'json';
    } catch (e1) {}
    if (/^\s*(\{|\[)/.test(t) && /"[\s\S]*":/.test(t)) return 'json';
    if (/^(def |class |import |from )/m.test(t)) return 'python';
    if (/\b(public |private |interface |type |enum )/m.test(t)) return 'typescript';
    if (/\b(const|let|var|function|=>)\b/.test(t) || /require\(/.test(t)) return 'javascript';
    if (/^#\s/.test(t) || /^(\*|-|_)+\s/.test(t) || /\[.*\]\(.*\)/.test(t)) return 'markdown';
    return 'markdown';
  }

  function enhanceCodeBlocks() {
    var roots = document.querySelectorAll('.wiki-body, .page-content');
    for (var r = 0; r < roots.length; r++) {
      var codes = roots[r].querySelectorAll('pre code');
      for (var i = 0; i < codes.length; i++) {
        var code = codes[i];
        var pre = code.parentNode;
        if (pre && pre.classList && pre.classList.contains('mermaid')) continue;
        if (code.className && /language-(\w+)/.test(code.className)) continue;
        var lang = guessLanguage(code.textContent || '');
        code.className = (code.className ? code.className + ' ' : '') + 'language-' + lang;
      }
    }
  }

  function initPrism() {
    ensurePrismThemeLink();
    loadScript(PRISM_CDN + 'components/prism-core.min.js', function () {
      loadScript(PRISM_CDN + 'plugins/autoloader/prism-autoloader.min.js', function () {
        if (window.Prism && Prism.plugins && Prism.plugins.autoloader) {
          Prism.plugins.autoloader.languages_path = PRISM_CDN + 'components/';
        }
        enhanceCodeBlocks();
        if (window.Prism) Prism.highlightAll();
      });
    });
  }

  function observeThemeForPrism() {
    if (typeof MutationObserver === 'undefined') return;
    var obs = new MutationObserver(function () {
      ensurePrismThemeLink();
    });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  function enhanceContentPage() {
    var base = typeof window.getWikiBasePath === 'function' ? window.getWikiBasePath() : '';
    var rel = currentSiteRelativePath();
    var wikiBody = document.querySelector('.wiki-body');
    if (wikiBody) {
      resolveWikiLinks(wikiBody, base, WIKI_SLUG_MAP);
      if (document.querySelector('.related-pages') === null) {
        var relSec = buildRelatedSection(base, rel, PAGE_REGISTRY);
        if (relSec) wikiBody.parentNode.insertBefore(relSec, wikiBody.nextSibling);
      }
      if (document.querySelector('.page-pager') === null) {
        var pager = buildPagerNav(base, rel);
        if (pager) {
          var anchor = document.querySelector('.related-pages') || wikiBody;
          anchor.parentNode.insertBefore(pager, anchor.nextSibling);
        }
      }
    }
    initPrism();
    observeThemeForPrism();
  }

  onReady(function () {
    ensureBreadcrumb();
    ensureToc();
    enhanceContentPage();
  });
})();
