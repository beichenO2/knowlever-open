/**
 * Stage 6 — Site Build (Graph Architecture)
 *
 * 从 wiki/*.md + tree.json + atoms 构建知识图谱式静态站点。
 *
 * 产出：
 *   - site/*.html (每页带侧边栏、面包屑、目录、backlinks、related pages、prev/next)
 *   - site/graph.json (Cytoscape.js 兼容的节点+边数据)
 *   - site/index.html (带知识图谱可视化入口)
 *   - site/about/tech-decisions.html
 *   - site/assets/js/site-page.js (客户端 wiki-link 解析、代码高亮等)
 */

const fs = require('fs');
const path = require('path');
const { recordDecision, load: loadTechDecisions } = require('./tech-decisions');

function loadTree(treePath) {
  return JSON.parse(fs.readFileSync(treePath, 'utf-8'));
}

function readWikiPage(wikiDir, slug) {
  let filePath = path.join(wikiDir, `${slug}.md`);
  if (!fs.existsSync(filePath) && slug.includes('--')) {
    filePath = path.join(wikiDir, slug.replace('--', '/') + '.md');
  }
  if (!fs.existsSync(filePath)) return { frontmatter: {}, content: '' };
  const md = fs.readFileSync(filePath, 'utf-8');
  const fmMatch = md.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fmMatch) return { frontmatter: {}, content: md };
  const fm = {};
  for (const line of fmMatch[1].split('\n')) {
    const [k, ...rest] = line.split(':');
    if (k && rest.length) fm[k.trim()] = rest.join(':').trim().replace(/^["']|["']$/g, '');
  }
  return { frontmatter: fm, content: fmMatch[2] };
}

function collectAllSlugs(tree) {
  const set = new Set();
  (function walk(n) {
    if (n.page_slug) set.add(n.page_slug);
    if (n.children) n.children.forEach(walk);
  })(tree);
  return set;
}

// --- Graph Generation ---

function buildGraph(tree, wikiDir, allSlugs) {
  const nodes = [];
  const edges = [];

  function walkTree(node, parentSlug = null) {
    const kind = node.kind || 'concept';
    nodes.push({
      id: node.page_slug,
      type: kind === 'root' ? 'topic' : kind === 'intermediate' ? 'structure' : 'concept',
      title: node.label || node.page_slug,
      file: `wiki/${node.page_slug}.md`,
    });

    if (parentSlug) {
      edges.push({ source: node.page_slug, target: parentSlug, relation: 'child_of' });
      edges.push({ source: parentSlug, target: node.page_slug, relation: 'parent_of' });
    }

    if (node.children) {
      for (const child of node.children) {
        walkTree(child, node.page_slug);
      }
    }
  }
  walkTree(tree);

  // Extract [[wiki-links]] from pages → build related_to edges
  for (const slug of allSlugs) {
    let filePath = path.join(wikiDir, `${slug}.md`);
    if (!fs.existsSync(filePath) && slug.includes('--')) {
      filePath = path.join(wikiDir, slug.replace('--', '/') + '.md');
    }
    if (!fs.existsSync(filePath)) continue;
    const md = fs.readFileSync(filePath, 'utf-8');
    const linkRe = /\[\[([^\]]+)\]\]/g;
    let m;
    while ((m = linkRe.exec(md)) !== null) {
      const raw = m[1];
      const target = raw.includes('|') ? raw.split('|')[0].trim() : raw.trim();
      if (allSlugs.has(target) && target !== slug) {
        const existingEdge = edges.find(e => e.source === slug && e.target === target);
        if (!existingEdge) {
          edges.push({ source: slug, target, relation: 'related_to' });
        }
      }
    }
  }

  return { nodes, edges };
}

// --- Backlinks Index ---

function buildIncomingLinks(wikiDir, allSlugs) {
  const incoming = {};
  for (const slug of allSlugs) incoming[slug] = [];
  const files = fs.readdirSync(wikiDir).filter(f => f.endsWith('.md'));
  for (const f of files) {
    const sourceSlug = f.replace(/\.md$/, '');
    const md = fs.readFileSync(path.join(wikiDir, f), 'utf-8');
    const linkRe = /\[\[([^\]]+)\]\]/g;
    let m;
    while ((m = linkRe.exec(md)) !== null) {
      const raw = m[1];
      const target = raw.includes('|') ? raw.split('|')[0].trim() : raw.trim();
      if (allSlugs.has(target) && target !== sourceSlug) {
        if (!incoming[target].includes(sourceSlug)) {
          incoming[target].push(sourceSlug);
        }
      }
    }
  }
  return incoming;
}

// --- Content Sequence (for prev/next) ---

function buildContentSequence(tree) {
  const seq = [];
  function dfs(node) {
    seq.push(node.page_slug);
    if (node.children) {
      for (const child of node.children) dfs(child);
    }
  }
  dfs(tree);
  return seq;
}

// --- Breadcrumb ---

function buildBreadcrumb(slug, nodeMap) {
  const crumbs = [];
  let current = slug;
  while (current) {
    const node = nodeMap.get(current);
    if (!node) break;
    crumbs.unshift({ slug: current, label: node.label || current });
    current = node._parentSlug;
  }
  return crumbs;
}

// --- Markdown → HTML (enhanced) ---

function markdownToHtml(md) {
  let html = md
    .replace(/^#### (.+)$/gm, '<h4 id="$1">$1</h4>')
    .replace(/^### (.+)$/gm, '<h3 id="$1">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 id="$1">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/^---$/gm, '<hr>');

  // Numbered lists
  html = html.replace(/^\d+\. (.+)$/gm, '<li class="ol-item">$1</li>');
  html = html.replace(/((?:<li class="ol-item">.*<\/li>\n?)+)/g, '<ol>$1</ol>');
  html = html.replace(/ class="ol-item"/g, '');

  // Markdown tables
  html = html.replace(/^(\|.+\|)\n(\|[\s:|-]+\|)\n((?:\|.+\|\n?)+)/gm, (match, headerRow, alignRow, bodyRows) => {
    const headers = headerRow.split('|').filter(c => c.trim()).map(c => `<th>${c.trim()}</th>`).join('');
    const rows = bodyRows.trim().split('\n').map(row => {
      const cells = row.split('|').filter(c => c.trim()).map(c => `<td>${c.trim()}</td>`).join('');
      return `<tr>${cells}</tr>`;
    }).join('');
    return `<table><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`;
  });

  // [[slug]] or [[slug|display]] → wiki link
  // Strip kind prefixes (concept-, section-, root-) from display text when no explicit label
  // URL-encode href for CJK filenames
  html = html.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, (_, slug, display) => {
    return `<a href="${encodeURIComponent(slug)}.html" class="wiki-link">${display}</a>`;
  });
  html = html.replace(/\[\[([^\]]+)\]\]/g, (_, slug) => {
    const display = slug.replace(/^(concept|section|root|problems|quiz)-/, '');
    return `<a href="${encodeURIComponent(slug)}.html" class="wiki-link">${display}</a>`;
  });

  // Mermaid code blocks
  html = html.replace(/```mermaid\n([\s\S]*?)```/g, '<pre class="mermaid">$1</pre>');

  // Generic code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>');

  // <details> blocks (pass through)
  // Already HTML, leave as-is

  // Wrap consecutive <li> in <ul>
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');

  // Paragraphs
  html = html.replace(/\n{2,}/g, '</p><p>');
  html = '<p>' + html + '</p>';
  html = html.replace(/<p><\/p>/g, '');
  html = html.replace(/<p>(<h[1-6][^>]*>)/g, '$1');
  html = html.replace(/(<\/h[1-6]>)<\/p>/g, '$1');
  html = html.replace(/<p>(<ul>)/g, '$1');
  html = html.replace(/(<\/ul>)<\/p>/g, '$1');
  html = html.replace(/<p>(<ol>)/g, '$1');
  html = html.replace(/(<\/ol>)<\/p>/g, '$1');
  html = html.replace(/<p>(<table>)/g, '$1');
  html = html.replace(/(<\/table>)<\/p>/g, '$1');
  html = html.replace(/<p>(<blockquote>)/g, '$1');
  html = html.replace(/(<\/blockquote>)<\/p>/g, '$1');
  html = html.replace(/<p>(<hr>)<\/p>/g, '$1');
  html = html.replace(/<p>(<pre[^>]*>)/g, '$1');
  html = html.replace(/(<\/pre>)<\/p>/g, '$1');
  html = html.replace(/<p>(<details>)/g, '$1');
  html = html.replace(/(<\/details>)<\/p>/g, '$1');

  return html;
}

// --- TOC extraction ---

function extractToc(htmlContent) {
  const headings = [];
  const re = /<h([23])\s*(?:id="([^"]*)")?[^>]*>(.*?)<\/h[23]>/g;
  let m;
  while ((m = re.exec(htmlContent)) !== null) {
    const level = parseInt(m[1]);
    const id = m[2] || m[3].replace(/[^a-z0-9\u4e00-\u9fff]/gi, '-').toLowerCase();
    headings.push({ level, id, text: m[3].replace(/<[^>]+>/g, '') });
  }
  return headings;
}

// --- Sidebar (tree navigation) ---

function buildSidebar(tree, currentSlug, contentSlugsSet) {
  function renderNode(node, depth = 0) {
    const isActive = node.page_slug === currentSlug;
    const cls = isActive ? ' class="active"' : '';
    const indent = '  '.repeat(depth);
    const hasContent = contentSlugsSet && contentSlugsSet.has(node.page_slug);
    const isGroup = node.kind === 'intermediate' || node.kind === 'root';
    let href;
    if (hasContent) {
      href = `${encodeURIComponent(node.page_slug)}.html`;
    } else if (isGroup && node.children?.length > 0) {
      const first = node.children.find(c => contentSlugsSet?.has(c.page_slug));
      href = first ? `${encodeURIComponent(first.page_slug)}.html` : '#';
    } else {
      href = '#';
    }
    let html = `${indent}<li${cls}><a href="${href}">${node.label || node.page_slug}</a>`;
    if (node.children && node.children.length > 0) {
      html += `\n${indent}  <ul>\n`;
      for (const child of node.children) {
        html += renderNode(child, depth + 2) + '\n';
      }
      html += `${indent}  </ul>`;
    }
    html += `</li>`;
    return html;
  }

  let sidebar = '<nav class="tree-sidebar" aria-label="知识树">\n<ul>\n';
  sidebar += `  <li><a href="index.html">🏠 首页</a></li>\n`;
  if (tree.children) {
    for (const child of tree.children) {
      sidebar += renderNode(child, 1) + '\n';
    }
  }
  sidebar += `  <li><a href="about/tech-decisions.html">⚙️ 编译决策</a></li>\n`;
  sidebar += '</ul>\n</nav>';
  return sidebar;
}

// --- Page Template ---

function pageTemplate({ title, sidebar, toc, breadcrumb, content, backlinks, relatedPages, prevNext, topic }) {
  const tocHtml = toc.length > 0 ? `
    <nav class="sidebar-toc" aria-label="页面目录">
      <h4>本页目录</h4>
      <ul>${toc.map(h => `<li style="${h.level === 3 ? 'margin-left:0.8rem;' : ''}"><a href="#${h.id}">${h.text}</a></li>`).join('\n')}</ul>
    </nav>` : '';

  const breadcrumbHtml = breadcrumb.length > 0 ? `
    <div class="breadcrumb"><a href="index.html">首页</a>${breadcrumb.map(c =>
      `<span>›</span><a href="${encodeURIComponent(c.slug)}.html">${c.label}</a>`
    ).join('')}
    </div>` : '<div class="breadcrumb"><a href="index.html">首页</a></div>';

  const backlinksHtml = backlinks.length > 0 ? `
    <aside class="backlinks">
      <h3>🔗 反向链接（${backlinks.length}）</h3>
      <ul>${backlinks.map(s => `<li><a href="${encodeURIComponent(s)}.html">${s.replace(/^(concept|section|root|problems|quiz)-/, '')}</a></li>`).join('')}</ul>
    </aside>` : '';

  const relatedHtml = relatedPages.length > 0 ? `
    <section class="related-pages">
      <h3>📎 相关页面</h3>
      <div class="related-grid">${relatedPages.map(p => `<a href="${encodeURIComponent(p.slug)}.html" class="related-card"><span class="type-badge">${p.type}</span><span>${p.title}</span></a>`).join('')}</div>
    </section>` : '';

  const prevNextHtml = prevNext.prev || prevNext.next ? `
    <nav class="page-pager" aria-label="前后导航">
      <div class="pager-cell">${prevNext.prev ? `<a href="${encodeURIComponent(prevNext.prev)}.html">← 上一页</a>` : ''}</div>
      <div class="pager-cell">${prevNext.next ? `<a href="${encodeURIComponent(prevNext.next)}.html">下一页 →</a>` : ''}</div>
    </nav>` : '';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — ${topic} | KnowLever</title>
  <link rel="stylesheet" href="assets/css/style.css">
  <style>
    .tri-layout { display: grid; grid-template-columns: 240px 1fr 200px; min-height: 100vh; }
    .tree-sidebar { padding: 1.5rem 1rem; background: var(--bg-secondary, #f8f9fa); border-right: 1px solid var(--border, #e2e8f0); overflow-y: auto; position: sticky; top: 0; height: 100vh; }
    .tree-sidebar ul { list-style: none; padding: 0; }
    .tree-sidebar li { margin: 0.25rem 0; }
    .tree-sidebar a { color: var(--text-muted, #4a5568); text-decoration: none; font-size: 0.88rem; display: block; padding: 2px 6px; border-radius: 4px; transition: background 0.15s; }
    .tree-sidebar a:hover { background: var(--border, #e2e8f0); color: var(--accent, #2563eb); }
    .tree-sidebar .active > a { background: #dbeafe; color: #1d4ed8; font-weight: 600; }
    .tree-sidebar li ul { margin-left: 0.8rem; border-left: 1px solid var(--border, #e2e8f0); padding-left: 0.4rem; }
    .tri-content { padding: 2rem 3rem; max-width: 54rem; overflow-wrap: break-word; line-height: 1.75; }
    .tri-content table { border-collapse: collapse; width: 100%; margin: 1rem 0; font-size: 0.92rem; }
    .tri-content th, .tri-content td { border: 1px solid var(--border, #e2e8f0); padding: 0.5rem 0.75rem; text-align: left; }
    .tri-content th { background: var(--bg-secondary, #f8fafc); font-weight: 600; }
    .tri-content tr:nth-child(even) { background: var(--bg-secondary, #f8fafc); }
    .tri-content ol { padding-left: 1.5rem; margin: 0.5rem 0; }
    .tri-content ul { padding-left: 1.5rem; margin: 0.5rem 0; }
    .tri-content .katex-display { margin: 1rem 0; overflow-x: auto; }
    .right-sidebar { padding: 2rem 1rem; position: sticky; top: 0; height: 100vh; overflow-y: auto; border-left: 1px solid var(--border, #f0f0f0); }
    .right-sidebar h4 { font-size: 0.9rem; margin-bottom: 0.5rem; color: var(--text-muted, #64748b); }
    .right-sidebar ul { list-style: none; padding: 0; font-size: 0.82rem; }
    .right-sidebar li { margin: 0.2rem 0; }
    .right-sidebar a { color: var(--text-muted, #64748b); text-decoration: none; }
    .right-sidebar a:hover { color: var(--accent, #2563eb); }
    .backlinks { margin-top: 2rem; padding: 1rem; background: #fefce8; border-radius: 8px; border: 1px solid #fde68a; }
    .backlinks h3 { font-size: 1rem; margin-bottom: 0.5rem; color: #92400e; }
    .backlinks ul { list-style: none; padding: 0; display: flex; flex-wrap: wrap; gap: 0.5rem; }
    .backlinks li a { display: inline-block; padding: 2px 10px; background: #fff; border: 1px solid #fde68a; border-radius: 4px; font-size: 0.85rem; }
    .related-pages { margin-top: 2rem; }
    .related-pages h3 { font-size: 1rem; margin-bottom: 0.8rem; }
    .related-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 0.6rem; }
    .related-card { display: flex; flex-direction: column; padding: 0.6rem 0.8rem; border: 1px solid var(--border, #e2e8f0); border-radius: 6px; text-decoration: none; transition: border-color 0.15s; }
    .related-card:hover { border-color: var(--accent, #93c5fd); }
    .page-pager { display: flex; justify-content: space-between; margin-top: 2rem; padding-top: 1rem; border-top: 1px solid var(--border, #e2e8f0); }
    .pager-cell a { color: var(--accent, #2563eb); font-size: 0.9rem; }
    @media (max-width: 1024px) { .tri-layout { grid-template-columns: 1fr; } .tree-sidebar, .right-sidebar { display: none; } .tri-content { padding: 1rem; } }
  </style>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.21/dist/katex.min.css">
  <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.21/dist/katex.min.js"></script>
  <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.21/dist/contrib/auto-render.min.js" onload="renderMathInElement(document.body, {delimiters:[{left:'$$',right:'$$',display:true},{left:'$',right:'$',display:false}]});"></script>
  <script defer src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js" onload="mermaid.initialize({startOnLoad:true,theme:'neutral'});"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/themes/prism.min.css">
  <script defer src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/prism.min.js"></script>
  <script defer src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/plugins/autoloader/prism-autoloader.min.js"></script>
</head>
<body>
  <div class="tri-layout">
    ${sidebar}
    <main class="tri-content">
      ${breadcrumbHtml}
      <h1>${title}</h1>
      <div class="wiki-body">
        ${content}
      </div>
      ${backlinksHtml}
      ${relatedHtml}
      ${prevNextHtml}
    </main>
    <aside class="right-sidebar">
      ${tocHtml}
    </aside>
  </div>
  <script>window.__KNOWLEVER_BASE="";window.__KNOWLEVER_SITE_NAME=${JSON.stringify(topic)};</script>
  <script src="assets/js/site-common.js"></script>
  <script src="assets/js/site-nav.js" defer></script>
  <script src="assets/js/site-page.js" defer></script>
  <script src="assets/js/tooltips.js"></script>
</body>
</html>`;
}

// --- Assets (copy from site-standard or generate) ---

function copySiteAssets(siteDir) {
  const projectRoot = path.resolve(__dirname, '..');
  const homeDir = process.env.HOME || process.env.USERPROFILE || '';
  const candidates = [
    path.join(projectRoot, 'site-standard', 'assets'),
    path.join(projectRoot, '..', 'KnowLever', 'site-standard', 'assets'),
    path.join(homeDir, 'Polarisor', 'KnowLever', 'site-standard', 'assets'),
  ];
  let src = null;
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'css', 'style.css'))) { src = c; break; }
  }

  const destAssets = path.join(siteDir, 'assets');
  fs.mkdirSync(path.join(destAssets, 'css'), { recursive: true });
  fs.mkdirSync(path.join(destAssets, 'js'), { recursive: true });
  fs.mkdirSync(path.join(destAssets, 'data'), { recursive: true });

  if (src) {
    const copyDir = (rel) => {
      const srcDir = path.join(src, rel);
      const dstDir = path.join(destAssets, rel);
      if (!fs.existsSync(srcDir)) return;
      for (const f of fs.readdirSync(srcDir)) {
        const srcFile = path.join(srcDir, f);
        if (fs.statSync(srcFile).isFile()) {
          fs.copyFileSync(srcFile, path.join(dstDir, f));
        }
      }
    };
    copyDir('css');
    copyDir('js');
    return true;
  }
  fs.writeFileSync(path.join(destAssets, 'css', 'style.css'), generateFallbackCSS(), 'utf-8');
  return false;
}

function generateFallbackCSS() {
  return `:root{--bg:#fff;--bg-secondary:#f8f9fa;--text:#1a1a2e;--text-muted:#6c757d;--accent:#4361ee;--border:#dee2e6;--font-sans:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;--max-width:1200px;--content-width:780px}*{margin:0;padding:0;box-sizing:border-box}body{font-family:var(--font-sans);color:var(--text);background:var(--bg);line-height:1.7}.site-header{border-bottom:1px solid var(--border);padding:.75rem 1.5rem;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;background:var(--bg);z-index:100}.site-header h1{font-size:1.1rem;font-weight:600}.site-header h1 a{color:var(--text);text-decoration:none}.page-layout{display:grid;grid-template-columns:var(--content-width) 280px;gap:2rem;max-width:var(--max-width);margin:0 auto;padding:2rem 1.5rem}.page-content{min-width:0}.hero{background:linear-gradient(135deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%);color:#fff;padding:3rem 2rem;border-radius:12px;margin-bottom:2rem;position:relative;overflow:hidden}.hero h1{font-size:2.2rem;margin-bottom:.5rem;position:relative;z-index:1}.hero p{color:rgba(255,255,255,.75);font-size:1.05rem;margin-bottom:1.5rem;max-width:600px;position:relative;z-index:1}.hero-stats{display:flex;gap:2.5rem;position:relative;z-index:1}.hero-stat{text-align:center}.hero-stat-ring{width:72px;height:72px;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto .4rem;position:relative}.hero-stat-ring::before{content:'';position:absolute;inset:0;border-radius:50%;border:3px solid rgba(255,255,255,.15)}.hero-stat-ring::after{content:'';position:absolute;inset:0;border-radius:50%;border:3px solid #4361ee;border-color:#4361ee transparent transparent transparent;transform:rotate(-45deg)}.hero-stat-number{font-size:1.6rem;font-weight:700;color:#fff}.hero-stat-label{font-size:.78rem;color:rgba(255,255,255,.6)}.section-header{display:flex;align-items:center;gap:.6rem;font-size:1.3rem;margin:2rem 0 1rem;padding-bottom:.3rem;border-bottom:2px solid var(--border)}.section-icon{width:28px;height:28px;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;font-size:.95rem}h1{font-size:1.8rem;margin-bottom:1.2rem;color:#1e293b}h2{font-size:1.4rem;margin-top:2rem;margin-bottom:.6rem;color:#334155}h3{font-size:1.15rem;margin-top:1.5rem;margin-bottom:.4rem;color:#475569}p{margin:.6rem 0}a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}code{background:#f1f5f9;padding:2px 6px;border-radius:3px;font-size:.9em}pre{background:#f8fafc;padding:1rem;border-radius:6px;overflow-x:auto;margin:1rem 0;border:1px solid var(--border)}pre code{background:none;padding:0}blockquote{border-left:3px solid var(--accent);padding-left:1rem;color:var(--text-muted);margin:1rem 0;font-style:italic}ul{margin:.5rem 0;padding-left:1.5rem}li{margin:.2rem 0}table{border-collapse:collapse;width:100%;margin:1rem 0}th,td{border:1px solid var(--border);padding:.5rem .8rem;text-align:left}th{background:var(--bg-secondary);font-weight:600}.breadcrumb{padding:.5rem 1.5rem;font-size:.85rem;color:var(--text-muted);border-bottom:1px solid var(--border)}.breadcrumb a{color:var(--accent);text-decoration:none}.breadcrumb span{margin:0 .4rem}footer{margin-top:2rem;padding:1rem 1.5rem;border-top:1px solid var(--border);color:var(--text-muted);font-size:.85rem;text-align:center}.sidebar{position:sticky;top:60px;padding:1rem 0;font-size:.85rem}.sidebar ul{list-style:none;padding-left:0}.sidebar li{margin:.2rem 0}.sidebar a{color:var(--text-muted);text-decoration:none}.sidebar a:hover{color:var(--accent)}.sidebar .active a{color:var(--accent);font-weight:600}@media(max-width:1024px){.page-layout{grid-template-columns:1fr}.sidebar{display:none}}`;
}

// --- Related Pages (tag-based scoring from atoms) ---

function findRelatedPages(slug, graph, nodeMap, limit = 5) {
  const related = [];
  const thisEdges = graph.edges.filter(e => e.source === slug || e.target === slug);
  const connected = new Set(thisEdges.map(e => e.source === slug ? e.target : e.source));

  for (const id of connected) {
    if (id === slug) continue;
    const node = nodeMap.get(id);
    if (!node) continue;
    const edgeCount = thisEdges.filter(e => e.source === id || e.target === id).length;
    related.push({ slug: id, title: node.label || id, type: node.kind || 'concept', score: edgeCount });
  }

  related.sort((a, b) => b.score - a.score);
  return related.slice(0, limit);
}

// --- Index Page (demo-parity style) ---

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildIndexPage(tree, graph, topic, contentSlugs, wikiDir) {
  const allSlugs = contentSlugs;
  const EMOJIS = ['🎯', '📊', '⚡', '🔬', '🛡️', '📐', '🧠', '💡', '🔧', '📈', '🌐', '🏗️'];
  const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#ec4899', '#14b8a6'];

  const totalPages = allSlugs.size;
  const totalLinks = graph.edges.length;
  const domains = (tree.children || []).filter(c => c.children && c.children.length > 0);

  const domainCards = domains.map((domain, i) => {
    const emoji = EMOJIS[i % EMOJIS.length];
    const count = domain.children.length;
    const subTags = domain.children.slice(0, 3)
      .map(c => `<span>${escapeHtml(c.label || c.page_slug)}</span>`).join('');
    const firstChild = domain.children.find(c => contentSlugs.has(c.page_slug));
    return `<a class="entry-card" href="${encodeURIComponent(firstChild?.page_slug || domain.page_slug)}.html">
        <span class="entry-icon">${emoji}</span>
        <h3>${escapeHtml(domain.label || domain.title)}（${count}）</h3>
        <p>探索 ${count} 个知识页面</p>
        <div class="entry-sub">${subTags}</div>
      </a>`;
  }).join('\n');

  const graphNodes = graph.nodes.map((n, i) => {
    const domain = domains.find(d => d.children?.some(c => c.page_slug === n.id));
    const dIdx = domains.indexOf(domain);
    const color = dIdx >= 0 ? COLORS[dIdx % COLORS.length] : '#999';
    const linkCount = graph.edges.filter(e => e.source === n.id || e.target === n.id).length;
    return { id: n.id, name: escapeHtml(n.title), domain: domain?.label || '其他', color, href: `${encodeURIComponent(n.id)}.html`, r: Math.max(2, Math.min(6, linkCount)), lc: linkCount };
  });
  const graphLinks = graph.edges.filter(e => e.relation === 'related_to' || e.relation === 'child_of')
    .map(e => {
      const si = graphNodes.findIndex(n => n.id === e.source);
      const ti = graphNodes.findIndex(n => n.id === e.target);
      return si >= 0 && ti >= 0 ? { source: si, target: ti } : null;
    }).filter(Boolean);

  const legendHtml = domains.map((d, i) => {
    const color = COLORS[i % COLORS.length];
    const count = d.children.length;
    return `<span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${color};margin-right:4px;vertical-align:middle;"></span>${escapeHtml(d.label || d.title)} (${count})</span>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(topic)} — KnowLever 知识系统</title>
  <link rel="stylesheet" href="assets/css/style.css">
  <style>
    .entry-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1.5rem; margin: 2rem 0; }
    .entry-card { background: var(--bg-secondary, #f8f9fa); border: 1px solid var(--border, #e2e8f0); border-radius: 16px; padding: 2rem; text-decoration: none; color: inherit; transition: all 0.2s ease; position: relative; overflow: hidden; }
    .entry-card:hover { transform: translateY(-4px); box-shadow: 0 8px 24px rgba(0,0,0,0.1); border-color: var(--accent, #3b82f6); }
    .entry-icon { font-size: 2.5rem; margin-bottom: 1rem; display: block; }
    .entry-card h3 { font-size: 1.3rem; margin-bottom: 0.5rem; color: var(--text, #1a1a1a); }
    .entry-card p { color: var(--text-muted, #666); font-size: 0.95rem; line-height: 1.5; margin-bottom: 1rem; }
    .entry-sub { display: flex; flex-wrap: wrap; gap: 0.4rem; }
    .entry-sub span { background: var(--bg, #fff); border: 1px solid var(--border, #e2e8f0); border-radius: 6px; padding: 2px 8px; font-size: 0.75rem; color: var(--text-muted, #888); }
  </style>
</head>
<body>
  <header class="site-header" data-site-nav></header>

  <div style="max-width: var(--max-width); margin: 0 auto; padding: 2rem 1.5rem;">

    <div class="hero">
      <h1>${escapeHtml(tree.label || topic)}</h1>
      <p>持久化知识编译系统 — 将原始资料编译为互链、可演化的知识网络</p>
      <div class="hero-stats" id="hero-stats">
        <div class="hero-stat">
          <div class="hero-stat-ring"><span class="hero-stat-number">${totalPages}</span></div>
          <div class="hero-stat-label">知识页面</div>
        </div>
        <div class="hero-stat">
          <div class="hero-stat-ring"><span class="hero-stat-number">${totalLinks}</span></div>
          <div class="hero-stat-label">交叉引用</div>
        </div>
        <div class="hero-stat">
          <div class="hero-stat-ring"><span class="hero-stat-number">${domains.length}</span></div>
          <div class="hero-stat-label">知识领域</div>
        </div>
        <div class="hero-stat">
          <div class="hero-stat-ring"><span class="hero-stat-number">${graph.nodes.length}</span></div>
          <div class="hero-stat-label">总节点数</div>
        </div>
      </div>
    </div>

    <div style="position:relative;max-width:500px;margin:0 auto 2rem;">
      <input id="search-input" type="text" placeholder="搜索知识页面..." style="width:100%;padding:0.8rem 1rem 0.8rem 2.5rem;border:1px solid var(--border,#e2e8f0);border-radius:10px;font-size:1rem;background:var(--bg-secondary,#f8f9fa);color:var(--text,#333);outline:none;">
      <span style="position:absolute;left:0.8rem;top:50%;transform:translateY(-50%);font-size:1.1rem;color:var(--text-muted,#888);">🔍</span>
      <div id="search-results" style="display:none;position:absolute;top:100%;left:0;right:0;background:var(--bg,#fff);border:1px solid var(--border,#e2e8f0);border-radius:10px;margin-top:4px;max-height:400px;overflow-y:auto;z-index:100;box-shadow:0 8px 24px rgba(0,0,0,0.12);"></div>
    </div>

    <h2 class="section-header" style="margin-top:1rem;"><span class="section-icon" style="background:#dbeafe;">🧠</span> 知识全景</h2>
    <div id="markmap-wrap" style="width:100%;height:480px;border:1px solid var(--border,#e2e8f0);border-radius:12px;overflow:hidden;background:var(--bg-secondary,#f8f9fa);margin-bottom:2rem;"></div>

    <div class="entry-grid">
      ${domainCards}
    </div>

    <div style="margin: 2.5rem 0;">
      <h2 style="font-size: 1.2rem; color: var(--text-muted, #888); margin-bottom: 1rem; font-weight: 500;">知识网络拓扑 <span style="font-size:0.75rem;font-weight:400;color:var(--text-muted,#666);">拖拽 · 缩放 · 悬浮高亮 · 双击跳转</span></h2>
      <div id="graph-container" style="background:#0d1117; border-radius: 12px; overflow: hidden; position: relative; height: 560px;">
        <svg id="knowledge-graph" style="width:100%;height:100%;"></svg>
        <div id="graph-tooltip" style="position:absolute;display:none;background:rgba(0,0,0,0.85);color:#e6edf3;padding:6px 12px;border-radius:6px;font-size:13px;pointer-events:none;white-space:nowrap;z-index:10;"></div>
      </div>
      <div style="display:flex;gap:1rem;flex-wrap:wrap;margin-top:0.5rem;font-size:12px;color:var(--text-muted,#888);">${legendHtml}</div>
    </div>
    <script>
    document.addEventListener('DOMContentLoaded', function(){
      var data = ${JSON.stringify({ nodes: graphNodes, links: graphLinks })};
      if (!data.nodes.length || typeof d3 === 'undefined') return;
      var container = document.getElementById('graph-container');
      var svg = d3.select('#knowledge-graph');
      var W = container.clientWidth, H = container.clientHeight;
      var g = svg.append('g');
      var zoomBehavior = d3.zoom().scaleExtent([0.15, 6]).on('zoom', function(e){ g.attr('transform', e.transform); });
      svg.call(zoomBehavior);
      function fitView(){
        var pad=40,xMin=Infinity,xMax=-Infinity,yMin=Infinity,yMax=-Infinity;
        data.nodes.forEach(function(d){if(d.x-d.r<xMin)xMin=d.x-d.r;if(d.x+d.r>xMax)xMax=d.x+d.r;if(d.y-d.r<yMin)yMin=d.y-d.r;if(d.y+d.r>yMax)yMax=d.y+d.r;});
        var bw=xMax-xMin+pad*2,bh=yMax-yMin+pad*2;if(bw<1||bh<1)return;
        var scale=Math.min(W/bw,H/bh,2),tx=W/2-scale*(xMin+xMax)/2,ty=H/2-scale*(yMin+yMax)/2;
        svg.transition().duration(600).call(zoomBehavior.transform,d3.zoomIdentity.translate(tx,ty).scale(scale));
      }
      var fitted=false;
      var sim = d3.forceSimulation(data.nodes)
        .force('link', d3.forceLink(data.links).distance(function(l){return 30+(l.source.r||4)+(l.target.r||4);}).strength(0.2))
        .force('charge', d3.forceManyBody().strength(function(d){return -30-d.r*5;}).distanceMax(400))
        .force('collision', d3.forceCollide().radius(function(d){return d.r+2;}).strength(0.9))
        .force('center', d3.forceCenter(W/2, H/2))
        .force('x', d3.forceX(W/2).strength(0.03)).force('y', d3.forceY(H/2).strength(0.03))
        .alphaDecay(0.015).velocityDecay(0.4);
      var link = g.append('g').selectAll('line').data(data.links).join('line').attr('stroke','#30363d').attr('stroke-width',0.4).attr('stroke-opacity',0.25);
      var node = g.append('g').selectAll('circle').data(data.nodes).join('circle')
        .attr('r',function(d){return d.r;}).attr('fill',function(d){return d.color;}).attr('fill-opacity',function(d){return 0.4+0.6*(d.r/6);})
        .attr('stroke','#0d1117').attr('stroke-width',0.5).style('cursor','pointer')
        .on('dblclick',function(e,d){window.location.href=d.href;})
        .call(d3.drag().on('start',function(e,d){if(!e.active)sim.alphaTarget(0.08).restart();d.fx=d.x;d.fy=d.y;}).on('drag',function(e,d){d.fx=e.x;d.fy=e.y;}).on('end',function(e,d){if(!e.active)sim.alphaTarget(0);d.fx=null;d.fy=null;}));
      var tooltip = document.getElementById('graph-tooltip');
      node.on('mouseover',function(e,d){tooltip.textContent=d.name+' · '+d.domain+' ('+d.lc+'个链接)';tooltip.style.display='block';tooltip.style.left=(e.offsetX+12)+'px';tooltip.style.top=(e.offsetY-20)+'px';d3.select(this).attr('stroke','#58a6ff').attr('stroke-width',2.5);})
        .on('mousemove',function(e){tooltip.style.left=(e.offsetX+12)+'px';tooltip.style.top=(e.offsetY-20)+'px';})
        .on('mouseout',function(){tooltip.style.display='none';d3.select(this).attr('stroke','#0d1117').attr('stroke-width',0.5);});
      sim.on('tick',function(){
        link.attr('x1',function(d){return d.source.x;}).attr('y1',function(d){return d.source.y;}).attr('x2',function(d){return d.target.x;}).attr('y2',function(d){return d.target.y;});
        node.attr('cx',function(d){return d.x;}).attr('cy',function(d){return d.y;});
        if(!fitted&&sim.alpha()<0.05){fitted=true;fitView();}
      });
    });
    </script>

  </div>

  <footer>
    <p id="site-footer-line">${escapeHtml(topic)} — 编译预览 · 更新: ${new Date().toISOString().split('T')[0]}</p>
  </footer>

  <script>window.__KNOWLEVER_BASE="";window.__KNOWLEVER_SITE_NAME=${JSON.stringify(topic)};</script>
  <script src="assets/js/site-common.js"></script>
  <script src="assets/data/site-page-data.js"></script>
  <script src="assets/js/site-nav.js" defer></script>
  <script src="assets/js/site-page.js" defer></script>
  <script src="assets/js/search.js"></script>
  <script>if(typeof initSearch==='function')initSearch('search-input','search-results','');</script>
  <script src="assets/js/tooltips.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/d3@7"></script>
  <script src="https://cdn.jsdelivr.net/npm/markmap-view@0.17"></script>
  <script src="https://cdn.jsdelivr.net/npm/markmap-lib@0.17"></script>
  <script>
  (function(){
    var md = ${JSON.stringify(buildMarkmapMd(tree, contentSlugs))};
    var wrap = document.getElementById('markmap-wrap');
    if (!wrap || !window.markmap) return;
    var svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('style','width:100%;height:100%');
    wrap.appendChild(svg);
    var transformer = new markmap.Transformer();
    var result = transformer.transform(md);
    var mm = markmap.Markmap.create(svg, {duration:300, maxWidth:260, initialExpandLevel:1, autoFit:true}, result.root);
    setTimeout(function(){ mm.fit(); }, 400);
    setTimeout(function(){
      svg.querySelectorAll('a[href]').forEach(function(a){a.style.cursor='pointer';a.setAttribute('target','_self');});
      svg.addEventListener('click', function(e){var link=e.target.closest('a[href]');if(link){e.preventDefault();e.stopPropagation();window.location.href=link.getAttribute('href');}});
    }, 800);
  })();
  </script>
</body>
</html>`;
}

function buildMarkmapMd(tree, contentSlugs) {
  const lines = [`# ${tree.label || tree.title || tree.page_slug}`];
  for (const child of (tree.children || [])) {
    const firstLeaf = (child.children || []).find(c => contentSlugs.has(c.page_slug));
    const groupHref = firstLeaf ? `${encodeURIComponent(firstLeaf.page_slug)}.html` : '#';
    lines.push(`## [${child.label || child.title}](${groupHref})`);
    for (const leaf of (child.children || []).slice(0, 8)) {
      if (contentSlugs.has(leaf.page_slug)) {
        lines.push(`### [${leaf.label || leaf.title}](${encodeURIComponent(leaf.page_slug)}.html)`);
      }
    }
    if ((child.children || []).length > 8) lines.push(`### ...${child.children.length - 8} more`);
  }
  return lines.join('\n');
}

function generateSitePageData(allSlugs, wikiDir, nodeMap) {
  const pages = [];
  for (const slug of allSlugs) {
    const node = nodeMap.get(slug);
    const title = node?.label || node?.title || slug;
    pages.push({ slug, title, href: `${encodeURIComponent(slug)}.html`, type: node?.kind || 'concept' });
  }
  return `window.__SITE_PAGES=${JSON.stringify(pages)};`;
}

// --- Tech Decisions Page ---

function buildTechDecisionsPage(techDecisions, sidebar, topic) {
  let content = '<h1>本卷如何被编译出来</h1>';
  content += '<p class="lead">每个 stage 的工程取舍——用了什么、为什么、已知限制。</p>';

  if (techDecisions?.decisions) {
    for (const d of techDecisions.decisions) {
      content += `<h3>[${d.stage}] ${d.name}</h3>`;
      content += `<p><strong>选择</strong>：${d.chosen}</p>`;
      if (d.rationale) content += `<p><strong>理由</strong>：${d.rationale}</p>`;
      if (d.known_limits?.length) {
        content += `<p><strong>已知限制</strong>：</p><ul>${d.known_limits.map(l => `<li>${l}</li>`).join('')}</ul>`;
      }
      if (d.switch_conditions?.length) {
        content += `<p><strong>切换条件</strong>：</p><ul>${d.switch_conditions.map(c => `<li>${c}</li>`).join('')}</ul>`;
      }
    }
  }
  if (techDecisions?.audit) {
    content += `<h2>编译审计</h2><ul>`;
    for (const [k, v] of Object.entries(techDecisions.audit)) {
      content += `<li><strong>${k}</strong>：${v}</li>`;
    }
    content += '</ul>';
  }

  return `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>编译决策 — ${topic} | KnowLever</title><link rel="stylesheet" href="../assets/css/style.css"></head>
<body><div class="page-layout">${sidebar}<main class="content">${content}</main><aside class="right-sidebar"></aside></div></body></html>`;
}

// --- Main ---

function run(wikiDir, treePath, outputDir, topic) {
  console.log(`[Stage 6] Site Build (Graph Architecture): ${topic}`);

  const tree = loadTree(treePath);
  const allSlugs = collectAllSlugs(tree);
  const siteDir = path.join(outputDir, 'site');
  if (fs.existsSync(siteDir)) {
    for (const f of fs.readdirSync(siteDir)) {
      if (f.endsWith('.html')) fs.unlinkSync(path.join(siteDir, f));
    }
  }
  fs.mkdirSync(siteDir, { recursive: true });
  fs.mkdirSync(path.join(siteDir, 'about'), { recursive: true });

  // Build graph
  const graph = buildGraph(tree, wikiDir, allSlugs);
  fs.writeFileSync(path.join(siteDir, 'graph.json'), JSON.stringify(graph, null, 2), 'utf-8');

  const wikiFileSlugsForGraph = new Set(fs.readdirSync(wikiDir)
    .filter(f => f.endsWith('.md'))
    .map(f => f.replace(/\.md$/, '')));
  const allKnownSlugs = new Set([...allSlugs, ...wikiFileSlugsForGraph]);

  // Build backlinks index
  const incoming = buildIncomingLinks(wikiDir, allKnownSlugs);

  // Build content sequence for prev/next
  const sequence = buildContentSequence(tree);

  // Build node map
  const nodeMap = new Map();
  function mapNodes(node, parentSlug = null) {
    nodeMap.set(node.page_slug, { ...node, _parentSlug: parentSlug });
    if (node.children) {
      for (const child of node.children) mapNodes(child, node.page_slug);
    }
  }
  mapNodes(tree);

  // Copy site assets (CSS + JS from original KnowLever site-standard)
  const usedOriginalAssets = copySiteAssets(siteDir);
  console.log(`[Stage 6] Assets: ${usedOriginalAssets ? 'copied from site-standard' : 'generated fallback CSS'}`);

  // Build pages (skip virtual nodes with no wiki content)
  let pagesBuilt = 0;
  let skipped = 0;
  const contentSlugs = new Set();
  const wikiFileSlugs = fs.readdirSync(wikiDir)
    .filter(f => f.endsWith('.md'))
    .map(f => f.replace(/\.md$/, ''));
  const allBuildSlugs = new Set([...allSlugs, ...wikiFileSlugs]);
  for (const slug of allBuildSlugs) {
    const { frontmatter, content } = readWikiPage(wikiDir, slug);
    if (!content.trim()) {
      skipped++;
      continue;
    }
    contentSlugs.add(slug);
    const node = nodeMap.get(slug);
    const title = frontmatter.title || node?.label || node?.title || slug;
    const htmlContent = markdownToHtml(content);
    const toc = extractToc(htmlContent);
    const breadcrumb = buildBreadcrumb(slug, nodeMap);
    const sidebar = buildSidebar(tree, slug, contentSlugs);
    const backlinks = incoming[slug] || [];
    const relatedPages = findRelatedPages(slug, graph, nodeMap);
    const seqIdx = sequence.indexOf(slug);
    const prevNext = {
      prev: seqIdx > 0 ? sequence[seqIdx - 1] : null,
      next: seqIdx < sequence.length - 1 ? sequence[seqIdx + 1] : null,
    };

    const html = pageTemplate({
      title, sidebar, toc, breadcrumb, content: htmlContent,
      backlinks, relatedPages, prevNext, topic,
    });
    fs.writeFileSync(path.join(siteDir, `${slug}.html`), html, 'utf-8');
    pagesBuilt++;
  }
  if (skipped > 0) console.log(`[Stage 6] Skipped ${skipped} virtual nodes (no wiki content)`);

  // Index page (demo-parity style)
  fs.writeFileSync(path.join(siteDir, 'index.html'), buildIndexPage(tree, graph, topic, contentSlugs, wikiDir), 'utf-8');

  // site-page-data.js for search/nav (includes quiz and non-tree pages)
  fs.writeFileSync(path.join(siteDir, 'assets', 'data', 'site-page-data.js'), generateSitePageData(allKnownSlugs, wikiDir, nodeMap), 'utf-8');

  // Tech decisions page
  const techDecisions = loadTechDecisions(outputDir);
  fs.writeFileSync(
    path.join(siteDir, 'about', 'tech-decisions.html'),
    buildTechDecisionsPage(techDecisions, buildSidebar(tree, null, contentSlugs), topic),
    'utf-8'
  );

  recordDecision(outputDir, topic, {
    stage: 'stage-6',
    name: 'site build (graph architecture)',
    chosen: 'knowledge-graph wiki with Cytoscape.js',
    rationale: `渲染 ${pagesBuilt} 页为图谱式 Wiki：backlinks、related pages、breadcrumb、TOC、prev/next、Cytoscape.js 知识图谱可视化。graph.json 含 ${graph.nodes.length} nodes + ${graph.edges.length} edges。`,
    known_limits: ['Markdown → HTML 为增强正则，不支持复杂嵌套列表', 'Mermaid 需客户端渲染'],
    switch_conditions: ['集成 remark/rehype 完整 pipeline 做 build-time 渲染'],
  });

  console.log(`[Stage 6] ✅ Built ${pagesBuilt} pages + graph.json (${graph.nodes.length} nodes, ${graph.edges.length} edges) → ${siteDir}`);
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length < 4) {
    console.error('Usage: node stage6-site-build.js <wiki-dir> <tree.json> <output-dir> <topic>');
    process.exit(2);
  }
  run(args[0], args[1], args[2], args[3]);
}

module.exports = { run };
