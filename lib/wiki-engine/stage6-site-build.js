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
      const target = m[1];
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
      if (allSlugs.has(m[1]) && m[1] !== sourceSlug) {
        if (!incoming[m[1]].includes(sourceSlug)) {
          incoming[m[1]].push(sourceSlug);
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

  // [[slug]] → wiki link (client-side will resolve, but provide fallback)
  html = html.replace(/\[\[([^\]]+)\]\]/g, '<a href="$1.html" class="wiki-link">$1</a>');

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

function buildSidebar(tree, currentSlug) {
  function renderNode(node, depth = 0) {
    const isActive = node.page_slug === currentSlug;
    const cls = isActive ? ' class="active"' : '';
    const indent = '  '.repeat(depth);
    let html = `${indent}<li${cls}><a href="${node.page_slug}.html">${node.label || node.page_slug}</a>`;
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
    <nav class="toc-nav" aria-label="页面目录">
      <h4>目录</h4>
      <ul>${toc.map(h => `<li class="${h.level === 3 ? 'toc-sub' : ''}"><a href="#${h.id}">${h.text}</a></li>`).join('\n')}</ul>
    </nav>` : '';

  const breadcrumbHtml = breadcrumb.length > 1 ? `
    <div class="breadcrumb" aria-label="面包屑导航">
      ${breadcrumb.map((c, i) => i === breadcrumb.length - 1
        ? `<span class="current">${c.label}</span>`
        : `<a href="${c.slug}.html">${c.label}</a><span class="sep">›</span>`
      ).join('')}
    </div>` : '';

  const backlinksHtml = backlinks.length > 0 ? `
    <aside class="backlinks">
      <h3>🔗 反向链接（${backlinks.length}）</h3>
      <ul>${backlinks.map(s => `<li><a href="${s}.html">${s}</a></li>`).join('')}</ul>
    </aside>` : '';

  const relatedHtml = relatedPages.length > 0 ? `
    <section class="related-pages">
      <h3>📎 相关页面</h3>
      <div class="related-grid">${relatedPages.map(p => `<a href="${p.slug}.html" class="related-card"><span class="type-badge">${p.type}</span><span>${p.title}</span></a>`).join('')}</div>
    </section>` : '';

  const prevNextHtml = prevNext.prev || prevNext.next ? `
    <nav class="page-pager" aria-label="前后导航">
      <div class="pager-cell">${prevNext.prev ? `<a href="${prevNext.prev}.html">← 上一页</a>` : ''}</div>
      <div class="pager-cell">${prevNext.next ? `<a href="${prevNext.next}.html">下一页 →</a>` : ''}</div>
    </nav>` : '';

  return `<!doctype html>
<html lang="zh">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} — ${topic} | KnowLever</title>
  <link rel="stylesheet" href="assets/css/style.css">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.21/dist/katex.min.css">
  <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.21/dist/katex.min.js"></script>
  <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.21/dist/contrib/auto-render.min.js" onload="renderMathInElement(document.body, {delimiters:[{left:'$$',right:'$$',display:true},{left:'$',right:'$',display:false}]});"></script>
  <script defer src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js" onload="mermaid.initialize({startOnLoad:true,theme:'neutral'});"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/themes/prism.min.css">
  <script defer src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/prism.min.js"></script>
  <script defer src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/plugins/autoloader/prism-autoloader.min.js"></script>
</head>
<body>
  <div class="page-layout">
    ${sidebar}
    <main class="content">
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
</body>
</html>`;
}

// --- CSS ---

function generateCSS() {
  return `* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, "Noto Sans SC", "SF Pro Text", sans-serif; line-height: 1.8; color: #1a1a2e; }
.page-layout { display: grid; grid-template-columns: 240px 1fr 200px; min-height: 100vh; }
.tree-sidebar { padding: 1.5rem 1rem; background: #f8f9fc; border-right: 1px solid #e2e8f0; overflow-y: auto; position: sticky; top: 0; height: 100vh; }
.tree-sidebar ul { list-style: none; }
.tree-sidebar li { margin: 0.25rem 0; }
.tree-sidebar a { color: #4a5568; text-decoration: none; font-size: 0.88rem; display: block; padding: 2px 6px; border-radius: 4px; transition: background 0.15s; }
.tree-sidebar a:hover { background: #e2e8f0; color: #2563eb; }
.tree-sidebar .active > a { background: #dbeafe; color: #1d4ed8; font-weight: 600; }
.tree-sidebar li ul { margin-left: 0.8rem; border-left: 1px solid #e2e8f0; padding-left: 0.4rem; }
.content { padding: 2rem 3rem; max-width: 54rem; overflow-wrap: break-word; }
.right-sidebar { padding: 2rem 1rem; position: sticky; top: 0; height: 100vh; overflow-y: auto; border-left: 1px solid #f0f0f0; }
.breadcrumb { font-size: 0.85rem; color: #64748b; margin-bottom: 1rem; }
.breadcrumb a { color: #2563eb; text-decoration: none; }
.breadcrumb .sep { margin: 0 0.4rem; }
.breadcrumb .current { color: #1e293b; font-weight: 500; }
h1 { font-size: 1.8rem; margin-bottom: 1.2rem; color: #1e293b; border-bottom: 2px solid #e2e8f0; padding-bottom: 0.5rem; }
h2 { font-size: 1.4rem; margin-top: 2rem; margin-bottom: 0.6rem; color: #334155; }
h3 { font-size: 1.15rem; margin-top: 1.5rem; margin-bottom: 0.4rem; color: #475569; }
h4 { font-size: 1.05rem; margin-top: 1.2rem; color: #555; }
p { margin: 0.6rem 0; }
a { color: #2563eb; text-decoration: none; }
a:hover { text-decoration: underline; }
.wiki-link { border-bottom: 1px dashed #93c5fd; }
code { background: #f1f5f9; padding: 2px 6px; border-radius: 3px; font-size: 0.9em; }
pre { background: #f8fafc; padding: 1rem; border-radius: 6px; overflow-x: auto; margin: 1rem 0; border: 1px solid #e2e8f0; }
pre code { background: none; padding: 0; }
blockquote { border-left: 3px solid #3b82f6; padding-left: 1rem; color: #64748b; margin: 1rem 0; font-style: italic; }
ul { margin: 0.5rem 0; padding-left: 1.5rem; }
li { margin: 0.2rem 0; }
strong { color: #1e293b; }
table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
th, td { border: 1px solid #e2e8f0; padding: 0.5rem 0.8rem; text-align: left; }
th { background: #f8fafc; font-weight: 600; }
hr { margin: 2rem 0; border: none; border-top: 1px solid #e2e8f0; }
.toc-nav { font-size: 0.82rem; }
.toc-nav h4 { font-size: 0.9rem; margin-bottom: 0.5rem; color: #64748b; }
.toc-nav ul { list-style: none; padding: 0; }
.toc-nav li { margin: 0.2rem 0; }
.toc-nav a { color: #64748b; text-decoration: none; }
.toc-nav a:hover { color: #2563eb; }
.toc-nav .toc-sub { margin-left: 0.8rem; }
.backlinks { margin-top: 2rem; padding: 1rem; background: #fefce8; border-radius: 8px; border: 1px solid #fde68a; }
.backlinks h3 { font-size: 1rem; margin-bottom: 0.5rem; color: #92400e; }
.backlinks ul { list-style: none; padding: 0; display: flex; flex-wrap: wrap; gap: 0.5rem; }
.backlinks li a { display: inline-block; padding: 2px 10px; background: #fff; border: 1px solid #fde68a; border-radius: 4px; font-size: 0.85rem; }
.related-pages { margin-top: 2rem; }
.related-pages h3 { font-size: 1rem; margin-bottom: 0.8rem; color: #475569; }
.related-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 0.6rem; }
.related-card { display: flex; flex-direction: column; padding: 0.6rem 0.8rem; border: 1px solid #e2e8f0; border-radius: 6px; text-decoration: none; transition: border-color 0.15s, box-shadow 0.15s; }
.related-card:hover { border-color: #93c5fd; box-shadow: 0 2px 8px rgba(37,99,235,0.1); }
.type-badge { font-size: 0.7rem; color: #64748b; text-transform: uppercase; margin-bottom: 0.2rem; }
.page-pager { display: flex; justify-content: space-between; margin-top: 2rem; padding-top: 1rem; border-top: 1px solid #e2e8f0; }
.pager-cell a { color: #2563eb; font-size: 0.9rem; }
.index-hero { text-align: center; padding: 3rem 0 2rem; }
.index-hero h1 { border: none; font-size: 2.2rem; }
.index-stats { display: flex; justify-content: center; gap: 2rem; margin: 1.5rem 0; }
.stat-item { text-align: center; }
.stat-num { font-size: 1.8rem; font-weight: 700; color: #2563eb; }
.stat-label { font-size: 0.85rem; color: #64748b; }
.graph-section { margin: 2rem 0; padding: 1.5rem; background: #f8fafc; border-radius: 12px; border: 1px solid #e2e8f0; }
.graph-section h2 { margin-top: 0; }
#knowledge-graph { width: 100%; height: 400px; border: 1px solid #e2e8f0; border-radius: 8px; background: #fff; }
@media (max-width: 1024px) { .page-layout { grid-template-columns: 1fr; } .tree-sidebar, .right-sidebar { display: none; } .content { padding: 1rem; } }
`;
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

// --- Index Page ---

function buildIndexPage(tree, graph, topic, sidebar) {
  const nodeCount = graph.nodes.length;
  const edgeCount = graph.edges.length;
  const leafCount = graph.nodes.filter(n => n.type === 'concept').length;

  const content = `
    <div class="index-hero">
      <h1>${tree.label || topic}</h1>
      <p>由 KnowLever 7-Stage Pipeline 自动编译的知识图谱</p>
      <div class="index-stats">
        <div class="stat-item"><div class="stat-num">${nodeCount}</div><div class="stat-label">知识节点</div></div>
        <div class="stat-item"><div class="stat-num">${edgeCount}</div><div class="stat-label">关系连接</div></div>
        <div class="stat-item"><div class="stat-num">${leafCount}</div><div class="stat-label">概念页面</div></div>
      </div>
    </div>
    <div class="graph-section">
      <h2>知识图谱</h2>
      <div id="knowledge-graph"></div>
      <script src="https://cdn.jsdelivr.net/npm/cytoscape@3/dist/cytoscape.min.js"></script>
      <script>
        fetch('graph.json').then(r=>r.json()).then(g=>{
          const cy = cytoscape({
            container: document.getElementById('knowledge-graph'),
            elements: [
              ...g.nodes.map(n=>({data:{id:n.id,label:n.title,type:n.type},classes:n.type})),
              ...g.edges.map(e=>({data:{source:e.source,target:e.target,label:e.relation}}))
            ],
            style: [
              {selector:'node',style:{'label':'data(label)','text-valign':'center','font-size':'11px','background-color':'#93c5fd','width':30,'height':30,'border-width':2,'border-color':'#3b82f6'}},
              {selector:'node.topic',style:{'background-color':'#f59e0b','width':50,'height':50,'font-size':'14px','font-weight':'bold','border-color':'#d97706'}},
              {selector:'node.structure',style:{'background-color':'#10b981','width':40,'height':40,'border-color':'#059669'}},
              {selector:'node.concept',style:{'background-color':'#93c5fd','border-color':'#3b82f6'}},
              {selector:'edge',style:{'width':1.5,'line-color':'#cbd5e1','target-arrow-color':'#94a3b8','target-arrow-shape':'triangle','curve-style':'bezier','font-size':'9px'}},
              {selector:'edge[label="child_of"]',style:{'line-color':'#d1d5db','line-style':'dashed'}},
              {selector:'edge[label="related_to"]',style:{'line-color':'#93c5fd'}},
            ],
            layout:{name:'cose',idealEdgeLength:120,nodeRepulsion:8000,gravity:0.5,animate:false}
          });
          cy.on('tap','node',e=>{window.location.href=e.target.id()+'.html';});
        });
      </script>
    </div>
    <h2>知识目录</h2>
    <div class="related-grid">
      ${(tree.children || []).map(c => `<a href="${c.page_slug}.html" class="related-card"><span class="type-badge">${c.kind}</span><span>${c.label}</span></a>`).join('\n')}
    </div>`;

  return `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${topic} — KnowLever</title><link rel="stylesheet" href="assets/css/style.css"></head>
<body><div class="page-layout">${sidebar}<main class="content">${content}</main><aside class="right-sidebar"></aside></div></body></html>`;
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
  fs.mkdirSync(siteDir, { recursive: true });
  fs.mkdirSync(path.join(siteDir, 'assets', 'css'), { recursive: true });
  fs.mkdirSync(path.join(siteDir, 'about'), { recursive: true });

  // Build graph
  const graph = buildGraph(tree, wikiDir, allSlugs);
  fs.writeFileSync(path.join(siteDir, 'graph.json'), JSON.stringify(graph, null, 2), 'utf-8');

  // Build backlinks index
  const incoming = buildIncomingLinks(wikiDir, allSlugs);

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

  // Write CSS
  fs.writeFileSync(path.join(siteDir, 'assets', 'css', 'style.css'), generateCSS(), 'utf-8');

  // Build pages
  let pagesBuilt = 0;
  for (const slug of allSlugs) {
    const { frontmatter, content } = readWikiPage(wikiDir, slug);
    const title = frontmatter.title || slug;
    const htmlContent = markdownToHtml(content);
    const toc = extractToc(htmlContent);
    const breadcrumb = buildBreadcrumb(slug, nodeMap);
    const sidebar = buildSidebar(tree, slug);
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

  // Index page
  const indexSidebar = buildSidebar(tree, null);
  fs.writeFileSync(path.join(siteDir, 'index.html'), buildIndexPage(tree, graph, topic, indexSidebar), 'utf-8');

  // Tech decisions page
  const techDecisions = loadTechDecisions(outputDir);
  fs.writeFileSync(
    path.join(siteDir, 'about', 'tech-decisions.html'),
    buildTechDecisionsPage(techDecisions, buildSidebar(tree, null), topic),
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
