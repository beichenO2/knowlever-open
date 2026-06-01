/**
 * Injected primary nav, theme toggle, mobile drawer (NAV-01, NAV-05).
 * Load after site-common.js so getWikiBasePath() exists.
 */
(function () {
  function applySavedTheme() {
    try {
      var saved = localStorage.getItem('theme');
      if (saved) document.documentElement.dataset.theme = saved;
    } catch (e) {}
  }
  applySavedTheme();
  window.__applySavedTheme = applySavedTheme;

  window.toggleTheme = function toggleTheme() {
    var html = document.documentElement;
    var next = html.dataset.theme === 'dark' ? '' : 'dark';
    html.dataset.theme = next;
    try {
      localStorage.setItem('theme', next || '');
    } catch (e) {}
  };

  function onReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  function navItems(base) {
    return [
      { label: '首页', href: base + 'index.html' },
      { label: '概念', href: base + 'concepts-hub.html' },
      { label: '知识库', href: base + 'knowledge-hub.html' },
      { label: '术语表', href: base + 'glossary.html' },
      { label: '站点地图', href: base + 'sitemap.html' },
      { label: '统计', href: base + 'stats.html' }
    ];
  }

  function anchorTags(base) {
    return navItems(base)
      .map(function (it) {
        return '<a href="' + it.href + '">' + it.label + '</a>';
      })
      .join('');
  }

  function pathnameActive(anchor) {
    var href = anchor.getAttribute('href');
    if (!href) return false;
    try {
      var resolved = new URL(href, window.location.href);
      return resolved.pathname === window.location.pathname;
    } catch (err) {
      return false;
    }
  }

  function markActive(root) {
    var links = root.querySelectorAll('a[href]');
    for (var i = 0; i < links.length; i++) {
      if (pathnameActive(links[i])) {
        links[i].classList.add('active');
      }
    }
  }

  onReady(function () {
    var base = typeof window.getWikiBasePath === 'function' ? window.getWikiBasePath() : '';
    var mount =
      document.querySelector('header.site-header[data-site-nav]') ||
      document.querySelector('[data-site-nav]') ||
      document.querySelector('header.site-header');
    if (!mount) return;

    var links = anchorTags(base);
    mount.innerHTML =
      '<div class="site-header__inner">' +
      '<h1><a href="' +
      base +
      'index.html">' + (window.__KNOWLEVER_SITE_NAME || 'KnowLever') + '</a></h1>' +
      '<nav class="site-nav site-nav--desktop" aria-label="主导航">' +
      links +
      '</nav>' +
      '<button type="button" class="nav-mobile-toggle" aria-label="打开菜单" aria-expanded="false" aria-controls="site-nav-drawer">\u2630</button>' +
      '<button type="button" class="theme-toggle" aria-label="切换主题">🌓</button>' +
      '</div>' +
      '<div id="site-nav-drawer" class="site-nav-drawer">' +
      '<nav class="site-nav site-nav--drawer" aria-label="主导航（移动端）">' +
      links +
      '<button type="button" class="theme-toggle theme-toggle--drawer" aria-label="切换主题">🌓</button>' +
      '</nav>' +
      '</div>';

    markActive(mount);

    var toggleBtn = mount.querySelector('.nav-mobile-toggle');

    function closeDrawer() {
      document.body.classList.remove('nav-drawer-open');
      if (toggleBtn) toggleBtn.setAttribute('aria-expanded', 'false');
    }

    function openDrawer() {
      document.body.classList.add('nav-drawer-open');
      if (toggleBtn) toggleBtn.setAttribute('aria-expanded', 'true');
    }

    if (toggleBtn) {
      toggleBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (document.body.classList.contains('nav-drawer-open')) {
          closeDrawer();
        } else {
          openDrawer();
        }
      });
    }

    var themeBtns = mount.querySelectorAll('.theme-toggle');
    for (var t = 0; t < themeBtns.length; t++) {
      themeBtns[t].addEventListener('click', function (e) {
        e.preventDefault();
        window.toggleTheme();
      });
    }

    var drawerLinks = mount.querySelectorAll('.site-nav--drawer a[href]');
    for (var d = 0; d < drawerLinks.length; d++) {
      drawerLinks[d].addEventListener('click', function () {
        closeDrawer();
      });
    }

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeDrawer();
    });

    document.addEventListener('click', function (e) {
      if (!document.body.classList.contains('nav-drawer-open')) return;
      if (mount.contains(e.target)) return;
      closeDrawer();
    });
  });
})();
