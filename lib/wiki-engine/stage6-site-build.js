/**
 * Stage 6 — Site Build
 *
 * 把 wiki/*.md 渲染为静态 HTML 站点。
 * 独立实现，不依赖 PolarDesign Tool。
 *
 * 必产出：index.html, 每页 HTML, tech-decisions.html, 侧边栏导航。
 */

const fs = require('fs');
const path = require('path');
const { recordDecision, load: loadTechDecisions } = require('./tech-decisions');

function loadTree(treePath) {
  return JSON.parse(fs.readFileSync(treePath, 'utf-8'));
}

function readWikiPage(wikiDir, slug) {
  const filePath = path.join(wikiDir, `${slug}.md`);
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

function markdownToHtml(md) {
  let html = md
    .replace(/^#### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/^---$/gm, '<hr>');

  // Wiki links → HTML links
  html = html.replace(/\[\[([^\]]+)\]\]/g, '<a href="$1.html">$1</a>');

  // Wrap consecutive <li> in <ul>
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');

  // Paragraphs
  html = html.replace(/\n{2,}/g, '</p><p>');
  html = '<p>' + html + '</p>';
  html = html.replace(/<p><\/p>/g, '');
  html = html.replace(/<p>(<h[1-6]>)/g, '$1');
  html = html.replace(/(<\/h[1-6]>)<\/p>/g, '$1');
  html = html.replace(/<p>(<ul>)/g, '$1');
  html = html.replace(/(<\/ul>)<\/p>/g, '$1');
  html = html.replace(/<p>(<blockquote>)/g, '$1');
  html = html.replace(/(<\/blockquote>)<\/p>/g, '$1');
  html = html.replace(/<p>(<hr>)<\/p>/g, '$1');

  return html;
}

function buildSidebar(tree, currentSlug) {
  function renderNode(node, depth = 0) {
    const isActive = node.page_slug === currentSlug;
    const cls = isActive ? ' class="active"' : '';
    const indent = '  '.repeat(depth);
    let html = `${indent}<li${cls}><a href="${node.page_slug}.html">${node.label}</a>`;
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

  let sidebar = '<nav class="sidebar"><ul>\n';
  sidebar += `<li><a href="index.html">首页</a></li>\n`;
  if (tree.children) {
    for (const child of tree.children) {
      sidebar += renderNode(child, 1) + '\n';
    }
  }
  sidebar += `<li><a href="tech-decisions.html">编译决策</a></li>\n`;
  sidebar += '</ul></nav>';
  return sidebar;
}

function pageTemplate(title, sidebar, content) {
  return `<!doctype html>
<html lang="zh">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} — KnowLever</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, "Noto Sans SC", sans-serif; line-height: 1.7; color: #1a1a2e; display: flex; min-height: 100vh; }
    .sidebar { width: 260px; padding: 1.5rem 1rem; background: #f8f9fc; border-right: 1px solid #e2e8f0; overflow-y: auto; position: fixed; top: 0; bottom: 0; }
    .sidebar ul { list-style: none; }
    .sidebar li { margin: 0.3rem 0; }
    .sidebar a { color: #4a5568; text-decoration: none; font-size: 0.9rem; }
    .sidebar a:hover { color: #2563eb; }
    .sidebar .active > a { color: #2563eb; font-weight: 600; }
    .sidebar li ul { margin-left: 1rem; }
    .content { margin-left: 260px; padding: 2rem 3rem; max-width: 52rem; flex: 1; }
    h1 { font-size: 1.8rem; margin-bottom: 1rem; color: #1e293b; }
    h2 { font-size: 1.4rem; margin-top: 2rem; margin-bottom: 0.5rem; color: #334155; }
    h3 { font-size: 1.15rem; margin-top: 1.5rem; margin-bottom: 0.4rem; color: #475569; }
    p { margin: 0.6rem 0; }
    a { color: #2563eb; }
    code { background: #f1f5f9; padding: 2px 6px; border-radius: 3px; font-size: 0.9em; }
    pre { background: #f1f5f9; padding: 1rem; border-radius: 6px; overflow-x: auto; margin: 1rem 0; }
    blockquote { border-left: 3px solid #3b82f6; padding-left: 1rem; color: #64748b; margin: 1rem 0; }
    ul { margin: 0.5rem 0; padding-left: 1.5rem; }
    li { margin: 0.2rem 0; }
    strong { color: #1e293b; }
    table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
    th, td { border: 1px solid #e2e8f0; padding: 0.5rem; text-align: left; }
    th { background: #f8fafc; }
    hr { margin: 2rem 0; border: none; border-top: 1px solid #e2e8f0; }
    @media (max-width: 768px) {
      .sidebar { display: none; }
      .content { margin-left: 0; padding: 1rem; }
    }
  </style>
</head>
<body>
  ${sidebar}
  <main class="content">
    <h1>${title}</h1>
    ${content}
  </main>
</body>
</html>`;
}

function renderTechDecisionsPage(techDecisions, sidebar) {
  let content = '<p>每个 stage 的技术取舍记录。</p>';
  if (techDecisions?.decisions) {
    for (const d of techDecisions.decisions) {
      content += `<h3>[${d.stage}] ${d.name}</h3>`;
      content += `<p><strong>选择</strong>：${d.chosen}</p>`;
      if (d.rationale) content += `<p><strong>理由</strong>：${d.rationale}</p>`;
      if (d.known_limits?.length) {
        content += `<p><strong>已知限制</strong>：</p><ul>${d.known_limits.map(l => `<li>${l}</li>`).join('')}</ul>`;
      }
    }
  }
  if (techDecisions?.audit) {
    content += `<h2>编译审计</h2><ul>`;
    for (const [k, v] of Object.entries(techDecisions.audit)) {
      content += `<li>${k}: ${v}</li>`;
    }
    content += '</ul>';
  }
  return pageTemplate('编译决策', sidebar, content);
}

function run(wikiDir, treePath, outputDir, topic) {
  console.log(`[Stage 6] Site Build: ${topic}`);

  const tree = loadTree(treePath);
  const siteDir = path.join(outputDir, 'site');
  fs.mkdirSync(siteDir, { recursive: true });

  function collectSlugs(node) {
    const set = new Set();
    if (node.page_slug) set.add(node.page_slug);
    if (node.children) for (const c of node.children) for (const s of collectSlugs(c)) set.add(s);
    return set;
  }
  const allSlugs = collectSlugs(tree);

  let pagesBuilt = 0;
  for (const slug of allSlugs) {
    const { frontmatter, content } = readWikiPage(wikiDir, slug);
    const title = frontmatter.title || slug;
    const sidebar = buildSidebar(tree, slug);
    const htmlContent = markdownToHtml(content);
    const html = pageTemplate(title, sidebar, htmlContent);
    fs.writeFileSync(path.join(siteDir, `${slug}.html`), html, 'utf-8');
    pagesBuilt++;
  }

  // Index page
  const indexSidebar = buildSidebar(tree, null);
  const indexContent = `<p>本知识库由 KnowLever 7-Stage Pipeline 自动编译。</p>
    <p>共 ${pagesBuilt} 个知识页面。生成时间：${new Date().toISOString().split('T')[0]}</p>
    <h2>目录</h2><ul>${[...allSlugs].map(s => `<li><a href="${s}.html">${s}</a></li>`).join('\n')}</ul>`;
  fs.writeFileSync(path.join(siteDir, 'index.html'), pageTemplate(topic, indexSidebar, indexContent), 'utf-8');

  // Tech decisions page
  const techDecisions = loadTechDecisions(outputDir);
  const tdSidebar = buildSidebar(tree, null);
  fs.writeFileSync(path.join(siteDir, 'tech-decisions.html'), renderTechDecisionsPage(techDecisions, tdSidebar), 'utf-8');

  recordDecision(outputDir, topic, {
    stage: 'stage-6',
    name: 'site build',
    chosen: 'standalone HTML (no PolarDesign)',
    rationale: `渲染 ${pagesBuilt} 页为静态 HTML，带侧边栏导航和 wiki-link 互联。`,
    known_limits: ['Markdown → HTML 为简易正则转换，不支持复杂表格和 Mermaid 渲染'],
    switch_conditions: ['集成 marked/remark 完整 markdown parser'],
  });

  console.log(`[Stage 6] ✅ Built ${pagesBuilt} pages → ${siteDir}`);
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
