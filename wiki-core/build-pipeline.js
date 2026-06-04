/**
 * Shared build pipeline utilities: version stores, manifests, search index,
 * file operations, graph sync, related pages.
 * Extracted from KnowLever/LLM-Wiki — no external dependencies.
 */
const fs = require('fs');
const path = require('path');
const { hashPageContent, normalizeMarkdown } = require('./markdown');

const BUILD_MANIFEST_VERSION = 12;

function copyFile(sourcePath, targetPath) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
}

function copyDirectory(sourceDir, targetDir) {
  if (!fs.existsSync(sourceDir)) return;
  fs.mkdirSync(targetDir, { recursive: true });
  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(sourcePath, targetPath);
    } else {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}

function copyRootHtmlFiles(sourceDir, targetDir) {
  if (!fs.existsSync(sourceDir)) return;
  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.html')) continue;
    copyFile(path.join(sourceDir, entry.name), path.join(targetDir, entry.name));
  }
}

/**
 * Copy static assets (HTML files, CSS, JS) from siteDir to outputDir.
 * @param {string} outputDir
 * @param {string} siteDir - absolute path to the site template directory
 */
function syncStaticAssets(outputDir, siteDir) {
  const siteAssetsDir = path.join(siteDir, 'assets');
  copyRootHtmlFiles(siteDir, outputDir);
  copyDirectory(path.join(siteAssetsDir, 'css'), path.join(outputDir, 'assets', 'css'));
  copyDirectory(path.join(siteAssetsDir, 'js'), path.join(outputDir, 'assets', 'js'));
}

/**
 * Sync graph.json from source to output.
 * @param {object} options
 * @param {string} options.graphSource - path to source graph.json
 * @param {string} options.outputDir
 * @param {string} [options.fallbackGraph] - path to fallback graph.json in site template
 * @param {boolean} [options.throwIfMissing] - throw if source is missing (LLM-Wiki). Default: false (seed empty).
 * @returns {string} path to the output graph.json
 */
function syncGraphFile(options) {
  const { graphSource, outputDir, fallbackGraph, throwIfMissing } = options;
  const outputGraph = path.join(outputDir, 'assets', 'data', 'graph.json');
  fs.mkdirSync(path.dirname(outputGraph), { recursive: true });

  if (!fs.existsSync(graphSource)) {
    if (path.resolve(graphSource) === path.resolve(outputGraph) && fallbackGraph && fs.existsSync(fallbackGraph)) {
      copyFile(fallbackGraph, outputGraph);
      return outputGraph;
    }
    if (throwIfMissing) {
      throw new Error(`[build] graph.json 不存在: ${graphSource}`);
    }
    if (fallbackGraph && fs.existsSync(fallbackGraph)) {
      copyFile(fallbackGraph, outputGraph);
      return outputGraph;
    }
    const emptyGraph = { tree: { id: 'root', label: 'Root', children: [] }, glossary: {} };
    fs.writeFileSync(outputGraph, JSON.stringify(emptyGraph, null, 2));
    return outputGraph;
  }

  if (path.resolve(graphSource) !== path.resolve(outputGraph)) {
    copyFile(graphSource, outputGraph);
  }

  return outputGraph;
}

function loadVersionStore(filePath) {
  if (!fs.existsSync(filePath)) {
    return { generated_at: null, hash_algorithm: 'sha256', pages: {} };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return {
      generated_at: parsed.generated_at || null,
      hash_algorithm: 'sha256',
      pages: parsed && typeof parsed.pages === 'object' && parsed.pages ? parsed.pages : {},
    };
  } catch (error) {
    console.warn(`[build] versions.json 解析失败，重新初始化：${error.message}`);
    return { generated_at: null, hash_algorithm: 'sha256', pages: {} };
  }
}

function updateVersionStore(existingStore, pages, generatedAt) {
  const nextPages = { ...(existingStore.pages || {}) };

  for (const page of pages) {
    const content = normalizeMarkdown(page.body).trimEnd();
    const hash = hashPageContent(content);
    const lineCount = content ? content.split('\n').length : 0;
    const current = nextPages[page.slug] && typeof nextPages[page.slug] === 'object'
      ? nextPages[page.slug]
      : {};
    const versions = Array.isArray(current.versions) ? current.versions.slice() : [];
    const lastVersion = versions[versions.length - 1];

    if (!lastVersion || lastVersion.hash !== hash) {
      versions.push({
        hash,
        captured_at: generatedAt,
        last_seen_at: generatedAt,
        line_count: lineCount,
        content,
      });
    } else {
      versions[versions.length - 1] = {
        ...lastVersion,
        last_seen_at: generatedAt,
        line_count: lastVersion.line_count ?? lineCount,
        content: lastVersion.content || content,
      };
    }

    nextPages[page.slug] = {
      slug: page.slug,
      title: page.title,
      current_hash: hash,
      updated_at: generatedAt,
      versions,
    };
  }

  return { generated_at: generatedAt, hash_algorithm: 'sha256', pages: nextPages };
}

function loadBuildStatsStore(filePath) {
  if (!fs.existsSync(filePath)) {
    return { history: [] };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return { history: Array.isArray(parsed.history) ? parsed.history : [] };
  } catch (error) {
    console.warn(`[build] build-stats.json 解析失败，重新初始化：${error.message}`);
    return { history: [] };
  }
}

function updateBuildStatsStore(existingStore, stats, pages) {
  const typeBreakdown = pages.reduce((acc, page) => {
    const type = page.meta.type || 'page';
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {});

  const nextHistory = Array.isArray(existingStore.history) ? existingStore.history.slice(-19) : [];
  nextHistory.push({
    buildTime: stats.buildTime,
    durationMs: stats.durationMs,
    pages: stats.pages,
    writtenPages: stats.writtenPages,
    skippedPages: stats.skippedPages,
    removedPages: stats.removedPages,
    writtenAssets: stats.writtenAssets,
    skippedAssets: stats.skippedAssets,
    wikiLinks: stats.wikiLinks,
    totalTags: stats.totalTags,
    searchEntries: stats.searchEntries,
    categoryCount: Object.keys(typeBreakdown).length,
  });

  return { ...stats, typeBreakdown, history: nextHistory };
}

function findRelated(currentSlug, currentTags, allPages) {
  if (!currentTags.length) return [];
  return allPages
    .filter(p => p.slug !== currentSlug)
    .map(p => {
      const pTags = (p.meta.tags || '').split(',').map(t => t.trim()).filter(Boolean);
      const overlap = pTags.filter(t => currentTags.includes(t)).length;
      return { ...p, overlap };
    })
    .filter(p => p.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap)
    .slice(0, 4);
}

function loadBuildManifest(filePath) {
  if (!fs.existsSync(filePath)) {
    return { version: BUILD_MANIFEST_VERSION, pages: {}, assets: {} };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (parsed.version !== BUILD_MANIFEST_VERSION) {
      return { version: BUILD_MANIFEST_VERSION, pages: {}, assets: {} };
    }
    return {
      version: BUILD_MANIFEST_VERSION,
      pages: parsed && typeof parsed.pages === 'object' && parsed.pages ? parsed.pages : {},
      assets: parsed && typeof parsed.assets === 'object' && parsed.assets ? parsed.assets : {},
    };
  } catch (error) {
    console.warn(`[build] build-manifest.json 解析失败，重新初始化：${error.message}`);
    return { version: BUILD_MANIFEST_VERSION, pages: {}, assets: {} };
  }
}

function buildPageSignature(page, related) {
  return hashPageContent(JSON.stringify({
    version: BUILD_MANIFEST_VERSION,
    slug: page.slug,
    title: page.title,
    meta: page.meta,
    body: normalizeMarkdown(page.body).trimEnd(),
    related: related.map(item => ({
      slug: item.slug,
      title: item.title,
      type: item.meta.type || 'page',
      overlap: item.overlap,
    })),
  }));
}

/**
 * Build search index entries from pages.
 * @param {Array} pages
 * @param {function} [hrefResolver] - (slug, meta) => href string. Defaults to flat `slug + '.html'`.
 */
function buildSearchIndex(pages, hrefResolver) {
  const resolve = hrefResolver || ((slug) => slug + '.html');
  return pages.map(p => ({
    title: p.title,
    type: p.meta.type || p.meta.node_type || 'page',
    href: resolve(p.slug, p.meta),
    summary: (p.meta.summary || p.body.substring(0, 200).replace(/[#*`\[\]]/g, '')).substring(0, 200),
    body: p.body.substring(0, 800).replace(/[#*`\[\]]/g, ''),
    keywords: (p.meta.tags || '').split(',').map(t => t.trim()).filter(Boolean),
    confidence: typeof p.meta.confidence === 'number' ? p.meta.confidence : undefined,
  }));
}

/**
 * Build glossary page content (terms only, not wrapped in full HTML).
 * Returns { terms, sortedEntries, bodyHtml }.
 */
function collectGlossaryTerms(pages, options) {
  options = options || {};
  const terms = {};
  for (const p of pages) {
    const defs = (p.meta.defines || '').split(',').map(t => t.trim()).filter(Boolean);
    for (const d of defs) {
      const [term, ...descParts] = d.split('=');
      if (term && descParts.length) terms[term.trim()] = descParts.join('=').trim();
    }
  }

  const outputDir = options.outputDir;
  const graphFile = options.graphFile || (outputDir ? path.join(outputDir, 'assets', 'data', 'graph.json') : null);
  if (graphFile && fs.existsSync(graphFile)) {
    try {
      const g = JSON.parse(fs.readFileSync(graphFile, 'utf-8'));
      if (g.glossary) Object.assign(terms, g.glossary);
    } catch {}
  }

  if (!Object.keys(terms).length) {
    terms['Mermaid'] = '基于文本的图表语法，可在浏览器中渲染为 SVG。';
    terms['二级展开'] = '同一时刻只展示「当前焦点 → 子节点」两层，可无限向下钻取。';
    terms['Wiki-link'] = '[[slug]] 或 [[slug|文本]] 格式的页面间链接语法。';
    terms['frontmatter'] = 'Markdown 文件头部 --- 包裹的 YAML 元数据区域。';
    terms['静态站点'] = '不依赖服务端运行时，所有页面在编译时生成的网站。';
  }

  return terms;
}

/**
 * Generate glossary body HTML (shared card layout).
 */
function buildGlossaryBodyHtml(terms) {
  const sorted = Object.entries(terms).sort(([a], [b]) => a.localeCompare(b, 'zh'));
  const items = sorted.map(([term, desc]) =>
    `<div class="card" style="border-left-color:var(--accent);">
      <h3>${term}</h3>
      <p style="color:var(--text-muted);font-size:0.9rem;margin:0;">${desc}</p>
    </div>`
  ).join('\n');

  return `<p style="color:var(--text-muted);">共 ${sorted.length} 个术语</p>
<div class="home-grid">\n${items}\n</div>`;
}

module.exports = {
  BUILD_MANIFEST_VERSION,
  copyFile,
  copyDirectory,
  copyRootHtmlFiles,
  syncStaticAssets,
  syncGraphFile,
  loadVersionStore,
  updateVersionStore,
  loadBuildStatsStore,
  updateBuildStatsStore,
  findRelated,
  loadBuildManifest,
  buildPageSignature,
  buildSearchIndex,
  collectGlossaryTerms,
  buildGlossaryBodyHtml,
};
