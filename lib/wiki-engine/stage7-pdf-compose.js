/**
 * Stage 7 — PDF Compose
 *
 * 生成教科书式知识手册（HTML for print / PDF）。
 * DFS 遍历 tree.json，按教科书结构组织。
 * 卷尾含「本卷如何被编译出来」附录章。
 *
 * wiki-link [[slug]] 转为页内锚点跳转。
 */

const fs = require('fs');
const path = require('path');
const { recordDecision, load: loadTechDecisions } = require('./tech-decisions');

function flattenDFS(node, depth = 1) {
  const out = [{ node, depth }];
  if (node.children) {
    for (const c of node.children) out.push(...flattenDFS(c, depth + 1));
  }
  return out;
}

function readPageContent(wikiDir, slug) {
  const filePath = path.join(wikiDir, `${slug}.md`);
  if (!fs.existsSync(filePath)) return '';
  const md = fs.readFileSync(filePath, 'utf-8');
  const fmMatch = md.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
  return fmMatch ? fmMatch[1].trim() : md;
}

function renderTechDecisionsAppendix(techDecisions) {
  if (!techDecisions) return '';
  const decisions = (techDecisions.decisions ?? []).map(d =>
    `### [${d.stage}] ${d.name}\n\n` +
    `**选择**：${d.chosen}\n\n` +
    `**理由**：${d.rationale ?? ''}\n\n` +
    (d.known_limits?.length ? `**已知限制**：\n${d.known_limits.map(l => `- ${l}`).join('\n')}\n\n` : '') +
    (d.switch_conditions?.length ? `**切换条件**：\n${d.switch_conditions.map(c => `- ${c}`).join('\n')}\n\n` : '')
  ).join('\n');

  const audit = techDecisions.audit
    ? `### 编译审计\n\n` +
      Object.entries(techDecisions.audit).map(([k, v]) => `- ${k}：${v}`).join('\n') + '\n\n'
    : '';

  return `## 附录：本卷如何被编译出来\n\n` +
         `> 每个 stage 的工程取舍。\n\n` +
         decisions + audit;
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
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');

  // [[slug]] → page-internal anchor
  html = html.replace(/\[\[([^\]]+)\]\]/g, '<a href="#$1">$1</a>');

  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');
  html = html.replace(/\n{2,}/g, '</p><p>');

  return html;
}

function run(wikiDir, treePath, outputDir, topic) {
  console.log(`[Stage 7] PDF Compose: ${topic}`);

  const tree = JSON.parse(fs.readFileSync(treePath, 'utf-8'));
  const techDecisions = loadTechDecisions(outputDir);

  const flatNodes = flattenDFS(tree);

  const sections = flatNodes.map(({ node, depth }) => {
    const content = readPageContent(wikiDir, node.page_slug);
    const headingLevel = Math.min(depth + 1, 6);
    const heading = '#'.repeat(headingLevel);
    const label = node.label || node.page_slug;
    if (content) {
      return `${heading} ${label}\n\n${content}\n\n`;
    }
    if (node.children?.length > 0) {
      return `${heading} ${label}\n\n`;
    }
    return `${heading} ${label}\n\n*(详见 wiki)*\n\n`;
  });

  const titleSection = `# ${tree.label || '知识手册'}\n\n` +
    `> 本手册由 KnowLever 7-Stage Pipeline 自动生成。\n` +
    `> 生成时间：${new Date().toISOString().split('T')[0]}\n` +
    `> 共 ${flatNodes.length} 个知识节点。\n\n---\n\n`;

  const appendix = renderTechDecisionsAppendix(techDecisions);
  const fullMarkdown = titleSection + sections.join('\n') + appendix;

  const pdfDir = path.join(outputDir, 'pdf');
  fs.mkdirSync(pdfDir, { recursive: true });
  const mdPath = path.join(pdfDir, 'manuscript.md');
  fs.writeFileSync(mdPath, fullMarkdown, 'utf-8');

  // Generate print-ready HTML
  const htmlContent = markdownToHtml(fullMarkdown);
  const printHtml = `<!doctype html>
<html lang="zh">
<head>
  <meta charset="utf-8">
  <title>${tree.label || 'KnowLever 知识手册'}</title>
  <style>
    @page { size: A4; margin: 2cm; }
    body { font-family: "Noto Serif SC", "Source Han Serif CN", serif; max-width: 42rem; margin: 2rem auto; padding: 1rem; line-height: 1.8; color: #1a1a1a; }
    h1 { font-size: 2rem; text-align: center; border-bottom: 2px solid #333; padding-bottom: 0.5rem; margin-top: 3rem; page-break-before: always; }
    h1:first-of-type { page-break-before: avoid; }
    h2 { font-size: 1.5rem; margin-top: 2rem; color: #2c3e50; border-bottom: 1px solid #ddd; padding-bottom: 0.3rem; }
    h3 { font-size: 1.2rem; margin-top: 1.5rem; color: #34495e; }
    h4 { font-size: 1.1rem; margin-top: 1rem; color: #555; }
    p { margin: 0.6rem 0; text-align: justify; }
    pre { background: #f4f4f4; padding: 0.8rem; border-radius: 4px; overflow-x: auto; font-size: 0.85rem; }
    code { background: #f0f0f0; padding: 2px 6px; border-radius: 3px; font-size: 0.9em; }
    blockquote { border-left: 3px solid #3b82f6; padding-left: 1rem; color: #555; margin: 1rem 0; }
    ul { margin: 0.5rem 0; padding-left: 1.5rem; }
    li { margin: 0.2rem 0; }
    a { color: #2563eb; text-decoration: none; }
    strong { color: #1e293b; }
    table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
    th, td { border: 1px solid #ddd; padding: 0.5rem; text-align: left; }
    th { background: #f8f9fa; }
    hr { margin: 2rem 0; border: none; border-top: 1px solid #ddd; }
  </style>
</head>
<body>
${htmlContent}
</body>
</html>`;

  const htmlPath = path.join(pdfDir, 'knowledge-handbook.html');
  fs.writeFileSync(htmlPath, printHtml, 'utf-8');

  recordDecision(outputDir, topic, {
    stage: 'stage-7',
    name: 'pdf compose',
    chosen: 'standalone print-HTML',
    rationale: `DFS tree.json → 教科书章节结构，${flatNodes.length} 节。卷尾含编译决策附录。wiki-link 转页内锚点。`,
    known_limits: ['浏览器 Print → PDF 依赖用户操作', 'LaTeX/Mermaid 未渲染'],
    switch_conditions: ['集成 puppeteer 自动打印为 PDF'],
  });

  console.log(`[Stage 7] ✅ Manuscript: ${mdPath}`);
  console.log(`[Stage 7] ✅ Print HTML: ${htmlPath}`);
  console.log(`[Stage 7]    Open in browser → Print → Save as PDF`);
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length < 4) {
    console.error('Usage: node stage7-pdf-compose.js <wiki-dir> <tree.json> <output-dir> <topic>');
    process.exit(2);
  }
  run(args[0], args[1], args[2], args[3]);
}

module.exports = { run, flattenDFS, renderTechDecisionsAppendix };
