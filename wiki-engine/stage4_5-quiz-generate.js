/**
 * Stage 4.5 — Quiz Compile
 *
 * Compiles existing problems from normalized/problems/*.problems.yaml into
 * wiki quiz pages. Uses LLM to generate solutions for problems that lack them.
 *
 * Input:  data/topics/<topic>/normalized/problems/*.problems.yaml
 *         wiki/*.md (for context when generating solutions)
 *         tree.json (for page mapping)
 * Output: wiki/quiz-<source-slug>.md (one quiz page per problems file)
 *         wiki index updated with quiz page links
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { chatCompletion } = require('../lib/llm-proxy');

const SOLVE_PROMPT = `你是一位严谨的教师。请为以下练习题提供详细的解答过程。

题目：
---
{problem}
---

要求：
1. 写出完整的解题步骤
2. 如有公式请用 LaTeX（$...$）书写
3. 如有计算请给出数值结果
4. 保持简洁，不要重复题目

直接输出解答，不要加前缀。`;

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

async function solveProblem(content) {
  const prompt = SOLVE_PROMPT.replace('{problem}', content.slice(0, 6000));
  try {
    const response = await chatCompletion({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 4096,
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

  console.log(`[Stage 4.5] Found ${files.length} problem files`);

  let totalProblems = 0;
  let solvedCount = 0;
  let pagesWritten = 0;

  for (const file of files) {
    const raw = fs.readFileSync(path.join(problemsDir, file), 'utf-8');
    const problems = parseYaml(raw);

    if (problems.length === 0) {
      console.log(`[Stage 4.5] ${file}: no problems parsed — skipping`);
      continue;
    }

    const sourceName = file.replace(/\.problems\.yaml$/, '');
    const slug = `quiz-${slugify(sourceName)}`;

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

      if (!solution && prob.has_solution) {
        solution = existingSolution;
      }

      if (!solution) {
        console.log(`[Stage 4.5] ${sourceName} prob ${i + 1}: no solution, requesting LLM...`);
        solution = await solveProblem(question);
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
    console.log(`[Stage 4.5]    LLM generated ${solvedCount} solutions`);
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
