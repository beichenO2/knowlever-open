/**
 * KnowLever Stats Dashboard — loads stats data and renders the stats page.
 *
 * Data sources (priority order):
 *   1. window.__STATS_DATA — inlined at build time (works with file://)
 *   2. fetch from assets/data/*.json — fallback for http-served sites
 *
 * Inlined data contains:
 *   - stats (hero stats)
 *   - buildStats (build history)
 *   - versions (page versions)
 */
(function () {
  'use strict';
  var base = window.__KNOWLEVER_BASE || '';
  var prefix = base + 'assets/data/';

  function fetchJSON(name) {
    return fetch(prefix + name).then(function (r) {
      if (!r.ok) throw new Error(name + ': ' + r.status);
      return r.json();
    });
  }

  function $(id) { return document.getElementById(id); }

  function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  function renderSummaryCards(stats) {
    var el = $('stats-summary-cards');
    if (!el || !stats) return;
    var items = [
      { label: '知识页面', value: stats.knowledgePages || 0 },
      { label: '交叉引用', value: stats.crossReferences || 0 },
      { label: '知识类型', value: stats.pageTypes || 0 },
      { label: '构建时间', value: stats.buildTime ? stats.buildTime.split('T')[0] : '-' },
    ];
    el.innerHTML = items.map(function (it) {
      return '<section class="card stats-card"><div class="stats-label">' + esc(it.label) + '</div><div class="stats-metric">' + esc(String(it.value)) + '</div></section>';
    }).join('');
  }

  function renderBuildCards(buildStats) {
    var el = $('stats-build-cards');
    if (!el || !buildStats) return;
    var builds = buildStats.builds || buildStats.history || [];
    var latest = builds[0];
    if (!latest) { el.innerHTML = '<p>暂无构建记录</p>'; return; }
    var items = [
      { label: '构建页面数', value: latest.pages || 0 },
      { label: '写入页面', value: latest.writtenPages || 0 },
      { label: '跳过页面', value: latest.skippedPages || 0 },
      { label: '耗时', value: (latest.durationMs || 0) + ' ms' },
    ];
    el.innerHTML = items.map(function (it) {
      return '<section class="card stats-card"><div class="stats-label">' + esc(it.label) + '</div><div class="stats-metric">' + esc(String(it.value)) + '</div></section>';
    }).join('');
  }

  function renderCategoryChart(versions) {
    var el = $('stats-category-chart');
    if (!el || !versions) return;
    var types = {};
    for (var slug in versions.pages) {
      var p = versions.pages[slug];
      var type = (p.type || 'unknown');
      types[type] = (types[type] || 0) + 1;
    }
    var entries = Object.entries(types).sort(function (a, b) { return b[1] - a[1]; });
    var max = entries.length ? entries[0][1] : 1;
    el.innerHTML = entries.map(function (e) {
      var pct = Math.round(e[1] / max * 100);
      return '<div class="stats-bar-row"><span class="stats-bar-label">' + esc(e[0]) + '</span><div class="stats-bar-track"><div class="stats-bar-fill" style="width:' + pct + '%"></div></div><span class="stats-bar-count">' + e[1] + '</span></div>';
    }).join('');
  }

  function renderVersionCards(versions) {
    var el = $('stats-version-cards');
    if (!el || !versions) return;
    var count = Object.keys(versions.pages || {}).length;
    var items = [
      { label: '已跟踪页面', value: count },
      { label: '最新版本快照', value: versions.latestVersion || '-' },
    ];
    el.innerHTML = items.map(function (it) {
      return '<section class="card stats-card"><div class="stats-label">' + esc(it.label) + '</div><div class="stats-metric">' + esc(String(it.value)) + '</div></section>';
    }).join('');
  }

  function renderHistory(buildStats) {
    var el = $('stats-history');
    if (!el || !buildStats) return;
    var builds = buildStats.builds || buildStats.history || [];
    if (!builds.length) return;
    el.innerHTML = builds.slice(0, 10).map(function (b) {
      return '<div class="timeline-item"><div class="timeline-date">' + esc(b.buildTime ? b.buildTime.split('T')[0] : '-') + '</div><div class="timeline-title">' + (b.pages || 0) + ' 页面 · ' + (b.writtenPages || 0) + ' 写入 · ' + (b.durationMs || 0) + 'ms</div></div>';
    }).join('');
  }

  function renderSizeChart(buildStats) {
    var el = $('stats-size-chart');
    if (!el || !buildStats) return;
    var builds = buildStats.builds || buildStats.history || [];
    var latest = builds[0];
    if (!latest) return;
    var items = [
      { label: 'search-index.json', value: latest.searchEntries || 0, unit: ' 条' },
      { label: '总标签', value: latest.totalTags || 0, unit: '' },
      { label: 'Wiki Link', value: latest.wikiLinks || 0, unit: '' },
    ];
    var max = items.length ? Math.max.apply(null, items.map(function (x) { return x.value; })) : 1;
    el.innerHTML = items.map(function (it) {
      var pct = Math.round(it.value / max * 100);
      return '<div class="stats-bar-row"><span class="stats-bar-label">' + esc(it.label) + '</span><div class="stats-bar-track"><div class="stats-bar-fill" style="width:' + pct + '%"></div></div><span class="stats-bar-count">' + it.value + it.unit + '</span></div>';
    }).join('');
  }

  function renderAll(stats, buildStats, versions) {
    renderSummaryCards(stats && stats.hero ? stats.hero : stats);
    renderBuildCards(buildStats);
    renderCategoryChart(versions);
    renderVersionCards(versions);
    renderHistory(buildStats);
    renderSizeChart(buildStats);
  }

  // Priority 1: inlined data (works with file:// protocol)
  var inlineData = window.__STATS_DATA;
  if (inlineData && (inlineData.stats || inlineData.buildStats)) {
    renderAll(inlineData.stats, inlineData.buildStats, inlineData.versions);
    return;
  }

  // Priority 2: fetch from JSON files (for http-served sites)
  Promise.all([
    fetchJSON('stats.json').catch(function () { return null; }),
    fetchJSON('build-stats.json').catch(function () { return null; }),
    fetchJSON('versions.json').catch(function () { return null; }),
  ]).then(function (results) {
    var stats = results[0];
    var buildStats = results[1];
    var versions = results[2];

    if (!stats && !buildStats) {
      var err = $('stats-error');
      if (err) { err.textContent = '无法加载统计数据（stats.json / build-stats.json 不存在）'; err.hidden = false; }
      return;
    }

    renderAll(stats, buildStats, versions);
  }).catch(function (e) {
    var err = $('stats-error');
    if (err) { err.textContent = '加载失败：' + e.message; err.hidden = false; }
  });
})();
