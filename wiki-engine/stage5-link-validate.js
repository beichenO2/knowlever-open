/**
 * Stage 5 — Link Validate
 *
 * 强阻断闸门：校验 wiki/*.md + tree.json 中的所有链接。
 * 退出码 ≠ 0 时 Stage 6/7 不运行。
 *
 * 检查：
 *   [[slug]]          — wiki 内部链接
 *   click "slug.html" — Mermaid 可点击节点
 *
 * 错误码（P0 阻断）：
 *   E1 桩链接       — [[target]] 不在 tree.json slug 集合中
 *   E4 自引用       — 页面引用自身
 *
 * 警告码（P1 降级）：
 *   W1 孤儿节点     — 页面无入链
 *   W2 hub 过载     — 被引用 > 30 次
 *   W3 循环引用     — A→B→...→A（wiki 中双向链接是正常的）
 */

const fs = require('fs');
const path = require('path');
const { writeAudit } = require('./tech-decisions');

function loadTree(treePath) {
  const raw = JSON.parse(fs.readFileSync(treePath, 'utf-8'));
  const slugs = new Set();
  function walk(node) {
    if (node.page_slug) slugs.add(node.page_slug);
    if (node.children) node.children.forEach(walk);
  }
  walk(raw);
  return { tree: raw, slugs };
}

function extractWikiLinks(md) {
  const links = [];
  const re = /\[\[([^\]]+)\]\]/g;
  let m;
  while ((m = re.exec(md)) !== null) {
    const raw = m[1];
    const target = raw.includes('|') ? raw.split('|')[0].trim() : raw.trim();
    links.push({ type: 'wiki', target, offset: m.index });
  }
  return links;
}

function extractMermaidClicks(md) {
  const links = [];
  const re = /click\s+\S+\s+"([^"]+\.html)"/g;
  let m;
  while ((m = re.exec(md)) !== null) {
    const slug = m[1].replace(/\.html$/, '');
    links.push({ type: 'mermaid-click', target: slug, offset: m.index });
  }
  return links;
}

function run(wikiDir, treePath, outputDir) {
  console.log(`[Stage 5] Link Validate`);

  const { slugs } = loadTree(treePath);
  const errors = [];
  const warnings = [];

  const wikiFiles = fs.readdirSync(wikiDir).filter(f => f.endsWith('.md'));
  const wikiSlugs = new Set(wikiFiles.map(f => f.replace(/\.md$/, '')));
  const allValid = new Set([...slugs, ...wikiSlugs]);
  const incomingCount = {};
  for (const slug of allValid) incomingCount[slug] = 0;

  const outgoing = {};

  for (const file of wikiFiles) {
    const sourceSlug = file.replace(/\.md$/, '');
    const md = fs.readFileSync(path.join(wikiDir, file), 'utf-8');
    const links = [...extractWikiLinks(md), ...extractMermaidClicks(md)];
    outgoing[sourceSlug] = links.map(l => l.target);

    for (const link of links) {
      if (link.target === sourceSlug) {
        errors.push({ code: 'E4', source: sourceSlug, target: link.target, msg: '自引用' });
      } else if (!allValid.has(link.target)) {
        errors.push({ code: 'E1', source: sourceSlug, target: link.target, msg: '桩链接' });
      } else {
        incomingCount[link.target] = (incomingCount[link.target] || 0) + 1;
      }
    }
  }

  // Check orphan nodes
  for (const [slug, count] of Object.entries(incomingCount)) {
    if (count === 0 && slug !== Object.keys(incomingCount)[0]) {
      warnings.push({ code: 'W1', slug, msg: '孤儿节点（无入链）' });
    }
    if (count > 30) {
      warnings.push({ code: 'W2', slug, count, msg: 'hub 过载' });
    }
  }

  // Detect cycles (simple DFS)
  const visited = new Set();
  const stack = new Set();
  function dfs(node) {
    if (stack.has(node)) return true;
    if (visited.has(node)) return false;
    visited.add(node);
    stack.add(node);
    for (const target of (outgoing[node] || [])) {
      if (allValid.has(target) && dfs(target)) {
        warnings.push({ code: 'W3', source: node, target, msg: '循环引用（双向链接）' });
        return true;
      }
    }
    stack.delete(node);
    return false;
  }
  for (const slug of Object.keys(outgoing)) dfs(slug);

  const report = {
    generated_at: new Date().toISOString(),
    total_pages: wikiFiles.length,
    total_links: Object.values(outgoing).reduce((s, l) => s + l.length, 0),
    errors,
    warnings,
  };

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'link-report.json'), JSON.stringify(report, null, 2), 'utf-8');

  writeAudit(outputDir, {
    link_validate_p0_errors: errors.length,
    link_validate_p1_warnings: warnings.length,
  });

  if (errors.length > 0) {
    console.error(`[Stage 5] ❌ ${errors.length} P0 errors — pipeline blocked`);
    for (const e of errors.slice(0, 10)) {
      console.error(`  [${e.code}] ${e.source} → ${e.target}: ${e.msg}`);
    }
    process.exitCode = 1;
  } else {
    console.log(`[Stage 5] ✅ All links valid (${warnings.length} warnings)`);
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length < 3) {
    console.error('Usage: node stage5-link-validate.js <wiki-dir> <tree.json> <output-dir>');
    process.exit(2);
  }
  run(args[0], args[1], args[2]);
}

module.exports = { run, extractWikiLinks };
