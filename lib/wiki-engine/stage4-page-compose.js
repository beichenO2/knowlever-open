/**
 * Stage 4 — Page Compose
 *
 * 从 tree.json + atoms 生成 wiki/*.md 页面。
 *
 * 生成顺序：叶子→中间→根（roll-up）。
 * 五段故事模板：「目的→困难→方法→结果→局限」。
 * 白名单约束链接：prompt 只塞祖先链 + 兄弟 + 直接子的 slug。
 *
 * 字数硬上限：叶子 ≤ 600 字 / 中间 ≤ 1200 字 / 根 ≤ 2000 字。
 */

const fs = require('fs');
const path = require('path');
const { chatCompletion, getModel } = require('../llm-client');
const { recordDecision } = require('./tech-decisions');

const WORD_LIMITS = { 'leaf-cluster': 600, intermediate: 1200, root: 2000 };

function flattenTree(node, parent = null, siblings = []) {
  const entry = {
    node,
    parent,
    siblings: siblings.filter(s => s.page_slug !== node.page_slug).map(s => s.page_slug),
    childSlugs: (node.children || []).map(c => c.page_slug),
  };
  const result = [];
  if (node.children) {
    for (const child of node.children) {
      result.push(...flattenTree(child, node, node.children));
    }
  }
  result.push(entry);
  return result;
}

function buildAllowedSlugs(entry, ancestorChain) {
  const allowed = new Set();
  ancestorChain.forEach(s => allowed.add(s));
  entry.siblings.forEach(s => allowed.add(s));
  entry.childSlugs.forEach(s => allowed.add(s));
  return [...allowed];
}

function buildPagePrompt(entry, atoms, allowedSlugs, wordLimit) {
  const atomTexts = (entry.node.atoms || [])
    .map(id => atoms[id])
    .filter(Boolean)
    .map(a => `- [${a.kind}] ${a.claim}\n  证据：${a.evidence?.quote || '(无)'}`)
    .join('\n');

  const isLeaf = entry.node.kind === 'leaf-cluster';
  const nodeKind = isLeaf ? '叶子（知识点）' : '非叶子（概述/总结）';

  const storyRequirement = isLeaf
    ? `叶子节点直接写知识点，不需要故事弧。`
    : `非叶子节点必须以故事弧开头！按以下5段结构组织：
   1. 目的：为了达成什么目标？
   2. 困难：遇到了什么矛盾/挑战？
   3. 方法：采取什么核心思路/原理？
   4. 结果：取得了什么关键结论？
   5. 局限：有什么未解决的问题？
   每段用 H3 标题分隔。`;

  return `你是知识页面撰写引擎。请为以下知识节点撰写一个 wiki 页面。

节点：${entry.node.label}（${nodeKind}）
slug：${entry.node.page_slug}

关联的知识原子：
${atomTexts || '(本节点无直接关联的 atom，请基于子节点概要 roll-up 撰写)'}

允许引用的页面 slug（白名单，使用 [[slug]] 格式）：
${allowedSlugs.join(', ')}

=== 严格规则 ===

【结构】
1. ${storyRequirement}
2. 字数硬上限：${wordLimit} 中文字

【写作风格 — 三条编译规则】
3. **长的变短**：长篇叙述必须拆成短句（≤40 字/句），每句独立一行或用分号隔开。
   用"因为…所以…""但是…""因此…"等逻辑连词串联思路。
   禁止出现连续 3 行以上的"文字墙"（大段密集中文无换行）。
4. **短的变长**：遇到纯名词/术语列表时，每个名词必须展开为：
   **名词** — 一句话解释它是什么、为什么重要。
   多个名词要串联成一个完整的逻辑链（不是罗列，而是因果/递进关系）。
   关键名词用 **加粗** 并前后各加一个空格。
5. **公式和化学式**：
   - 数学公式用 LaTeX 包裹：inline 用 $...$，display 用 $$...$$
   - 化学方程式也用 LaTeX：$A + B \\to C$

【链接与表述】
6. 仅允许引用白名单中的 slug，使用 [[slug]] 格式
7. 用"高中生能充分理解"的语言，但保持专业准确
8. 多引用其他概念（白名单内），让知识变成网
9. 不要写 slug、不要写 frontmatter、不要写标题（系统自动加）
10. **Mermaid 图表规则**（Mermaid v11+）：
   - subgraph 标签必须用引号包裹
   - 节点标签中的 < > | & ; 必须转义或避免使用
   - 箭头语法：\`-->\` (实线), \`-.->\` (虚线)

请直接输出 Markdown 正文。`;
}

function loadAtoms(atomsDir) {
  const atoms = {};
  if (!fs.existsSync(atomsDir)) return atoms;
  const files = fs.readdirSync(atomsDir).filter(f => f.endsWith('.json'));
  for (const f of files) {
    const list = JSON.parse(fs.readFileSync(path.join(atomsDir, f), 'utf-8'));
    for (const a of (Array.isArray(list) ? list : [])) atoms[a.id] = a;
  }
  return atoms;
}

async function composePage(entry, atoms, allowedSlugs, options = {}) {
  const wordLimit = WORD_LIMITS[entry.node.kind] || 600;
  const prompt = buildPagePrompt(entry, atoms, allowedSlugs, wordLimit);

  const response = await chatCompletion({
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
    max_tokens: 4096,
  });

  return response?.choices?.[0]?.message?.content || '';
}

async function run(treePath, atomsDir, outputDir, topic, options = {}) {
  console.log(`[Stage 4] Page Compose: ${topic}`);

  const tree = JSON.parse(fs.readFileSync(treePath, 'utf-8'));
  const atoms = loadAtoms(atomsDir);
  const wikiDir = path.join(outputDir, 'wiki');
  fs.mkdirSync(wikiDir, { recursive: true });

  const entries = flattenTree(tree);

  let composed = 0;
  for (const entry of entries) {
    const ancestorChain = [];
    let cur = entry.parent;
    while (cur) {
      ancestorChain.push(cur.page_slug);
      cur = null;
    }
    const allowedSlugs = buildAllowedSlugs(entry, ancestorChain);

    const content = await composePage(entry, atoms, allowedSlugs, options);

    const slug = entry.node.page_slug;
    const frontmatter = [
      '---',
      `slug: ${slug}`,
      `title: "${entry.node.label}"`,
      `kind: ${entry.node.kind === 'leaf-cluster' ? 'leaf' : entry.node.kind}`,
      `parent: ${entry.parent?.page_slug || 'null'}`,
      '---',
      '',
    ].join('\n');

    fs.writeFileSync(path.join(wikiDir, `${slug}.md`), frontmatter + content, 'utf-8');
    composed++;
    console.log(`[Stage 4] ${composed}/${entries.length} ${slug}`);
  }

  recordDecision(outputDir, topic, {
    stage: 'stage-4',
    name: 'page compose LLM',
    chosen: getModel(),
    rationale: `Roll-up 生成 ${composed} 页，五段故事模板，白名单约束链接。`,
    known_limits: ['LLM 可能超字数限制，需后处理截断'],
    switch_conditions: ['出现专门的知识撰写模型'],
  });

  console.log(`[Stage 4] ✅ Composed ${composed} pages`);
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length < 4) {
    console.error('Usage: node stage4-page-compose.js <tree.json> <atoms-dir> <output-dir> <topic>');
    process.exit(2);
  }
  run(args[0], args[1], args[2], args[3]).catch(e => {
    console.error('[Stage 4] Fatal:', e.message);
    process.exit(1);
  });
}

module.exports = { composePage, flattenTree, buildAllowedSlugs, run };
