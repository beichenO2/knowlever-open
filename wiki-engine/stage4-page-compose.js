/**
 * Stage 4 — Page Compose
 *
 * 从 tree.json + atoms 生成 wiki/*.md 页面。
 *
 * 生成顺序：叶子→中间→根（roll-up）。
 *
 * 写法策略（v2）：
 *   叶子（复杂术语）：寓言/场景故事 → 揭示概念 → 边界与局限
 *   叶子（简单事实）：**名词** — 一句话解释
 *   非叶子：四句话总结体（问题→方法→效果→缺陷）
 *
 * 白名单约束链接：prompt 只塞祖先链 + 兄弟 + 直接子的 slug。
 * 字数硬上限：叶子 ≤ 600 字 / 中间 ≤ 1200 字 / 根 ≤ 2000 字。
 */

const fs = require('fs');
const path = require('path');
const { chatCompletion, getModel } = require('../lib/llm-proxy');
const { recordDecision } = require('./tech-decisions');

const WORD_LIMITS = { 'leaf-cluster': 1500, intermediate: 2000, root: 3000 };

function flattenTree(node, parent = null, siblings = [], ancestors = []) {
  const entry = {
    node,
    parent,
    siblings: siblings.filter(s => s.page_slug !== node.page_slug).map(s => s.page_slug),
    childSlugs: (node.children || []).map(c => c.page_slug),
    ancestors: [...ancestors],
  };
  const result = [];
  const childAncestors = [...ancestors, node.page_slug];
  if (node.children) {
    for (const child of node.children) {
      result.push(...flattenTree(child, node, node.children, childAncestors));
    }
  }
  result.push(entry);
  return result;
}

function buildAllowedSlugs(entry) {
  const allowed = new Set();
  entry.ancestors.forEach(s => allowed.add(s));
  entry.siblings.forEach(s => allowed.add(s));
  entry.childSlugs.forEach(s => allowed.add(s));
  return [...allowed];
}

function buildPagePrompt(entry, atoms, allowedSlugs, wordLimit) {
  const nodeAtoms = (entry.node.atoms || [])
    .map(id => atoms[id])
    .filter(Boolean);

  const atomTexts = nodeAtoms
    .map(a => `- [${a.kind}] **${a.claim}**\n  原文证据：「${a.evidence?.quote || '(无)'}」\n  标签：${(a.draft_tags || []).join(', ')}`)
    .join('\n\n');

  const isLeaf = entry.node.kind === 'leaf-cluster';
  const nodeKind = isLeaf ? '叶子（知识点）' : '非叶子（概述/总结）';

  const leafStrategy = `【叶子节点写法 — 总分结构·问题驱动叙事】
你的任务是让一个聪明但没学过这个领域的人真正理解这组知识。
你有 ${nodeAtoms.length} 个知识原子需要全部涵盖。

**结构要求：先总后分。**
- 开篇第一段是"总述"（2-3句话），概括这组知识要解决什么问题、核心方法是什么、关键结论。
  总述是整页的摘要，读者只看这段就能抓住要点。
- 然后是分述（### 标题分隔），逐步展开细节。

按以下逻辑结构写：

（先写总述段落，不加标题，直接写2-3句概括）

### 有什么困难（矛盾/约束/陷阱）
这组知识要解决的工程/科学问题是什么？一两句话直接说清楚。

### 有什么困难（矛盾/约束/陷阱）
为什么这个问题不简单？有哪些反直觉的约束、物理限制、或者常犯的错误？
每个困难点对应一个或多个知识原子。

### 怎么解决（方法/公式/原理）
核心方法是什么？逐条展开：
- 给出公式（完整推导 + 变量定义 + 数值代入示例）
- 给出原理解释
- 如果有多种方法，对比优劣

### 效果与边界
方法的效果如何（量化）？在什么条件下失效？有什么已知局限？

=== 解释复杂度规则 ===

**解释的词藻修饰程度必须与概念的复杂度正相关：**

- **简单概念**（其他领域研究生不会感到吃力）：直接用"**名词** — 一句话解释"格式。绝不展开为长段落。
- **中等概念**：简洁的因果解释，2-3句话。
- **复杂抽象概念**（其他领域研究生学习时会明显感到吃力）：
  - 鼓励使用类比来辅助理解（如"脉冲压缩类似于范围门"）
  - 允许使用寓言式讲解帮助建立直觉
  - 但类比/寓言只是辅助，之后必须给出严格的因果解释和公式

⚠️ 禁止：
- 禁止对简单概念过度解释（不要用3段话解释一个一句话就能说清的东西）
- 禁止空洞泛泛而谈（每一句都必须有具体的技术内容）
- 禁止只有类比没有因果链（类比是引入，不是替代）

✅ 要求：
- 用工程师写技术报告的语气
- 公式必须完整（变量定义 + 推导 + 代入具体数值算一遍）
- 每个知识原子的核心信息必须体现在正文中`;

  const nonLeafStrategy = `【非叶子节点写法 — 总分结构·问题驱动总结】
本节点是对下属 ${entry.childSlugs.length} 个子知识的概括。

**结构要求：先总后分。**
- 开篇第一段是"总述"（2-3句话），概括这组子知识共同要解决的问题、核心路径和关键结论。
- 然后是分述（### 标题分隔），逐步展开。

按以下结构写：

（先写总述段落，不加标题）

### 解决什么问题
一两句话说清楚：这一组知识要回答的核心工程/科学问题是什么。

### 采取什么方法
核心思路/原理/路径是什么。每个子节点对应一个要点，给出具体内容：
- 子节点 A 解决了什么子问题、用什么方法
- 子节点 B 解决了什么子问题、用什么方法
- ...

### 达到什么效果
关键结论/成果（量化数据优先，给出具体数值和条件）。

### 有什么缺陷
当前未解决的问题、已知局限、在什么条件下失效。

⚠️ 禁止空洞文字。每一段都必须有实质技术内容。
如果信息不足，宁可写短也不要编。
每个子节点必须在"方法"或"效果"中被具体提及。`;

  return `你是知识页面撰写引擎。请为以下知识节点撰写一个 wiki 页面。

节点：${entry.node.label}（${nodeKind}）
slug：${entry.node.page_slug}

关联的知识原子（共 ${nodeAtoms.length} 个，必须全部覆盖）：
${atomTexts || '(本节点无直接关联的 atom，请基于子节点标签做概括性总结)'}

允许引用的页面 slug（白名单，使用 [[slug]] 格式）：
${allowedSlugs.join(', ')}

=== 写法策略 ===

${isLeaf ? leafStrategy : nonLeafStrategy}

=== 通用规则 ===

1. 字数目标：${wordLimit} 中文字（不得少于 ${Math.floor(wordLimit * 0.6)}）
2. **长的变短**：连续文字不超过 40 字就要有一个断句/换行。禁止"文字墙"。
3. **公式排版品味**：
   - **重要公式独占一行**：凡是定义性公式、核心推导结论、含 \\frac/\\int/\\sum 的复杂表达式，必须用 $$...$$ 单独成行显示。
   - **简单符号保持内联**：变量名（$R$）、简单赋值（$T_0=290\\text{K}$）、单位（$\\text{dB}$）用 $...$ 内联即可。
   - 完整给出公式和变量定义。化学式也用 LaTeX。
   - **禁止**将长公式（含分数、积分、连加等）塞在行内 $...$ 中。
   - **禁止** Unicode 下标/上标字符（₀₁₂₃₄₅⁰¹²³等），一律用 LaTeX 语法 $F_1$、$10^{-23}$。
4. 仅允许引用白名单中的 slug，格式 [[slug]]。多引用 → 让知识变成网。
5. 用"高中生能充分理解"的语言，但保持专业准确。
6. 不要写 slug、不要写 frontmatter、不要写标题（系统自动加）。
7. **Mermaid 图表**（v11+）：subgraph 标签必须用引号，节点标签中 < > | & ; 要转义。
   - **禁止**在 Mermaid 节点标签中使用 slug 前缀（concept-、section-、root- 等），只写中文标题。例如用 "目标截面积" 而不是 "concept-目标截面积"。
   - **禁止**在 Mermaid 节点标签中使用 LaTeX 公式（$...$），因为 Mermaid SVG 不支持 KaTeX 渲染。用纯文本替代，如 "σ 散射" 而不是 "$\\sigma$ 散射"。
8. **覆盖率**：每个知识原子都必须在正文中有对应内容。原文证据是权威信源。

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
  const wordLimit = WORD_LIMITS[entry.node.kind] || 1500;
  const prompt = buildPagePrompt(entry, atoms, allowedSlugs, wordLimit);

  const response = await chatCompletion({
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.4,
    max_tokens: 131072,
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
    const allowedSlugs = buildAllowedSlugs(entry);

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
