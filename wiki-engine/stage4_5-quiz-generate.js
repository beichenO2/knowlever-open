/**
 * Stage 4.5 — Quiz Compile
 *
 * Compiles existing problems from normalized/problems/*.problems.yaml into
 * wiki quiz pages. Uses LLM to generate solutions for problems that lack them.
 *
 * Knowledge injection: reads tree.json + atoms to find which wiki page each
 * problem maps to, then injects that page's content as context for the LLM.
 *
 * Input:  data/topics/<topic>/normalized/problems/*.problems.yaml
 *         wiki/*.md (knowledge context for solution generation)
 *         tree.json (problem→atom→page mapping)
 *         atoms/*.json (source offsets for mapping)
 * Output: wiki/quiz-<source-slug>.md (one quiz page per problems file)
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { chatCompletion } = require('../lib/llm-proxy');

const SOLVE_PROMPT_WITH_CONTEXT = `你是一位严谨的教师。请基于下方提供的知识背景，为练习题提供详细的解答。

## 知识背景
---
{context}
---

## 题目
---
{problem}
---

要求：
1. 用"为了实现XX → 有XX困难 → 用XX方法 → 结果XX"的逻辑结构讲解
2. 术语和表述与知识背景保持一致
3. 公式用 LaTeX（$...$）书写
4. 如有计算给出数值结果
5. 不要重复题目

直接输出解答。`;

const SOLVE_PROMPT_NO_CONTEXT = `你是一位严谨的教师。请为以下练习题提供详细的解答过程。

## 题目
---
{problem}
---

要求：
1. 用"为了实现XX → 有XX困难 → 用XX方法 → 结果XX"的逻辑结构讲解
2. 公式用 LaTeX（$...$）书写
3. 如有计算给出数值结果
4. 不要重复题目

直接输出解答。`;

function parseYaml(text) {
  try {
    const doc = yaml.load(text);
    if (!doc?.problems || !Array.isArray(doc.problems)) return [];
    return doc.problems.map((p, i) => ({
      id: p.id || `prob_${i + 1}`,
      content: (p.content || '').trim(),
      has_solution: p.has_solution === true,
      source_span: p.source_span || '',
    }));
  } catch (e) {
    console.error(`[Stage 4.5] YAML parse error: ${e.message}`);
    return [];
  }
}

function slugify(name) {
  return name
    .replace(/\.problems\.yaml$/, '')
    .replace(/[^\w\u4e00-\u9fff-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Build atom→page_slug reverse index from tree.json.
 * Walks the tree recursively; leaf-cluster nodes have `atoms` arrays.
 */
function buildAtomPageIndex(node) {
  const index = {};
  if (node.atoms && Array.isArray(node.atoms)) {
    for (const atomId of node.atoms) {
      index[atomId] = node.page_slug;
    }
  }
  if (node.children) {
    for (const child of node.children) {
      Object.assign(index, buildAtomPageIndex(child));
    }
  }
  return index;
}

/**
 * Load all atoms from atoms/*.json, keyed by atom.id.
 */
function loadAtoms(atomsDir) {
  const atoms = {};
  if (!fs.existsSync(atomsDir)) return atoms;
  const files = fs.readdirSync(atomsDir).filter(f => f.endsWith('.json'));
  for (const f of files) {
    try {
      const list = JSON.parse(fs.readFileSync(path.join(atomsDir, f), 'utf-8'));
      for (const a of (Array.isArray(list) ? list : [])) {
        atoms[a.id] = a;
      }
    } catch (e) {
      console.warn(`[Stage 4.5] Failed to load atoms file ${f}: ${e.message}`);
    }
  }
  return atoms;
}

/**
 * Build source_id → Set<page_slug> index.
 * Maps each original source to the wiki pages that contain its atoms.
 */
function buildSourcePageIndex(atoms, atomPageIndex) {
  const index = {};
  for (const [atomId, atom] of Object.entries(atoms)) {
    const sourceId = atom.evidence?.source_id || '';
    if (!sourceId) continue;
    const pageSlug = atomPageIndex[atomId];
    if (!pageSlug) continue;
    if (!index[sourceId]) index[sourceId] = new Set();
    index[sourceId].add(pageSlug);
  }
  return index;
}

/**
 * Find relevant wiki page slugs for a problem source.
 * Uses source_id matching: all atoms from the same original source file
 * map to specific wiki pages via the tree structure.
 */
function findRelevantPages(sourceName, sourcePageIndex) {
  for (const [sourceId, pages] of Object.entries(sourcePageIndex)) {
    const normalizedId = sourceId.replace(/[^a-z0-9\u4e00-\u9fff]/gi, '').toLowerCase();
    const normalizedName = sourceName.replace(/[^a-z0-9\u4e00-\u9fff]/gi, '').toLowerCase();
    if (normalizedId === normalizedName || normalizedId.includes(normalizedName) || normalizedName.includes(normalizedId)) {
      return [...pages];
    }
  }
  return [];
}

/**
 * Read wiki page overview section (before first ### heading).
 * This is the "总述" part that summarizes the page's core knowledge.
 */
function readWikiPageOverview(wikiDir, slug) {
  const filePath = path.join(wikiDir, `${slug}.md`);
  if (!fs.existsSync(filePath)) return '';
  let content = fs.readFileSync(filePath, 'utf-8');
  content = content.replace(/^---[\s\S]*?---\n*/, '');
  const firstHeading = content.indexOf('\n### ');
  if (firstHeading > 0) {
    content = content.slice(0, firstHeading);
  }
  return content.trim();
}

async function solveProblem(content, knowledgeContext) {
  let prompt;
  if (knowledgeContext && knowledgeContext.length > 50) {
    prompt = SOLVE_PROMPT_WITH_CONTEXT
      .replace('{context}', knowledgeContext.slice(0, 20000))
      .replace('{problem}', content.slice(0, 6000));
  } else {
    prompt = SOLVE_PROMPT_NO_CONTEXT
      .replace('{problem}', content.slice(0, 6000));
  }

  try {
    const response = await chatCompletion({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 100000,
    });
    return response?.choices?.[0]?.message?.content?.trim() || '';
  } catch (e) {
    console.error(`[Stage 4.5] LLM solve failed: ${e.message}`);
    return '';
  }
}

function separateContentAndSolution(content) {
  const solutionMarkers = ['\n解：', '\n 解：', '\n解:'];
  for (const marker of solutionMarkers) {
    const idx = content.indexOf(marker);
    if (idx !== -1) {
      return {
        question: content.slice(0, idx).trim(),
        existingSolution: content.slice(idx).trim(),
      };
    }
  }
  return { question: content.trim(), existingSolution: '' };
}

async function run(wikiDir, treePath, outputDir, topic) {
  console.log(`[Stage 4.5] Quiz Compile: ${topic}`);

  const dataRoot = path.resolve(outputDir, '..');
  const problemsDir = path.join(dataRoot, 'normalized', 'problems');

  if (!fs.existsSync(problemsDir)) {
    console.log('[Stage 4.5] No problems/ directory found — skipping.');
    return;
  }

  const files = fs.readdirSync(problemsDir).filter(f => f.endsWith('.problems.yaml'));
  if (files.length === 0) {
    console.log('[Stage 4.5] No .problems.yaml files found — skipping.');
    return;
  }

  let tree = null;
  let atomPageIndex = {};
  let atoms = {};

  if (fs.existsSync(treePath)) {
    try {
      tree = JSON.parse(fs.readFileSync(treePath, 'utf-8'));
      atomPageIndex = buildAtomPageIndex(tree);
      console.log(`[Stage 4.5] Loaded tree.json: ${Object.keys(atomPageIndex).length} atom→page mappings`);
    } catch (e) {
      console.warn(`[Stage 4.5] Failed to load tree.json: ${e.message}`);
    }
  }

  const atomsDir = path.join(outputDir, 'atoms');
  atoms = loadAtoms(atomsDir);
  const sourcePageIndex = buildSourcePageIndex(atoms, atomPageIndex);
  console.log(`[Stage 4.5] Loaded ${Object.keys(atoms).length} atoms, ${Object.keys(sourcePageIndex).length} source→page mappings`);
  console.log(`[Stage 4.5] Found ${files.length} problem files`);

  let totalProblems = 0;
  let solvedCount = 0;
  let contextHits = 0;
  let pagesWritten = 0;

  for (const file of files) {
    const raw = fs.readFileSync(path.join(problemsDir, file), 'utf-8');
    const problems = parseYaml(raw);

    if (problems.length === 0) {
      console.log(`[Stage 4.5] ${file}: no problems parsed — skipping`);
      continue;
    }

    const sourceName = file.replace(/\.problems\.yaml$/, '');
    const sourceSlug = slugify(sourceName);
    const slug = `quiz-${sourceSlug}`;

    let md = `---\ntitle: "${sourceName} — 练习题"\ntype: quiz\nsource: "${sourceName}"\n---\n\n`;
    md += `# ${sourceName} — 练习题\n\n`;
    md += `> 本页包含 ${problems.length} 道练习题，来自原始教学材料。\n\n`;

    for (let i = 0; i < problems.length; i++) {
      const prob = problems[i];
      totalProblems++;

      const { question, existingSolution } = separateContentAndSolution(prob.content);

      md += `## 题 ${i + 1}\n\n`;
      md += `${question}\n\n`;

      let solution = existingSolution;

      if (!solution) {
        const pageSlugs = findRelevantPages(sourceName, sourcePageIndex);
        let knowledgeContext = '';
        if (pageSlugs.length > 0) {
          knowledgeContext = pageSlugs
            .map(s => readWikiPageOverview(wikiDir, s))
            .filter(c => c.length > 0)
            .join('\n\n---\n\n');
          if (knowledgeContext.length > 0) {
            contextHits++;
            console.log(`[Stage 4.5] ${sourceName} prob ${i + 1}: injecting ${pageSlugs.length} wiki pages as context`);
          }
        }

        console.log(`[Stage 4.5] ${sourceName} prob ${i + 1}: no solution, requesting LLM...`);
        solution = await solveProblem(question, knowledgeContext);
        if (solution) solvedCount++;
      }

      if (solution) {
        md += `<details>\n<summary>查看解答</summary>\n\n`;
        md += `${solution}\n\n`;
        md += `</details>\n\n`;
      } else {
        md += `*（暂无解答）*\n\n`;
      }

      md += `---\n\n`;
    }

    const quizPath = path.join(wikiDir, `${slug}.md`);
    fs.writeFileSync(quizPath, md, 'utf-8');
    pagesWritten++;
    console.log(`[Stage 4.5] ${pagesWritten}/${files.length} ${slug} (${problems.length} problems)`);
  }

  console.log(`[Stage 4.5] ✅ Compiled ${totalProblems} problems into ${pagesWritten} quiz pages`);
  if (solvedCount > 0) {
    console.log(`[Stage 4.5]    LLM generated ${solvedCount} solutions (${contextHits} with knowledge context)`);
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length < 4) {
    console.error('Usage: node stage4_5-quiz-generate.js <wiki-dir> <tree.json> <output-dir> <topic>');
    process.exit(2);
  }
  run(args[0], args[1], args[2], args[3]).catch(e => {
    console.error('[Stage 4.5] Fatal:', e.message);
    process.exit(1);
  });
}

module.exports = { run };
