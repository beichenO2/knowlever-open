/**
 * Stage 4.5 — Quiz Generate
 *
 * 在 wiki 页面中穿插练习题，并生成对应答案。
 *
 * 策略：
 *   - 每个叶子页面末尾追加 1-3 道练习题
 *   - 题目类型：选择题 / 简答题 / 计算题（根据内容自动判断）
 *   - 答案单独写入 answers/{slug}-answers.md
 *   - 页面内以折叠标签包裹答案提示
 *
 * 输入：wiki/*.md + tree.json
 * 输出：wiki/*.md (追加题目) + answers/*.md
 */

const fs = require('fs');
const path = require('path');
const { chatCompletion } = require('../lib/llm-proxy');

const QUIZ_PROMPT = `你是一位严谨的出题教师。请基于以下知识页面内容，出 2 道练习题。

知识页面内容：
---
{content}
---

出题要求：
1. 题目类型从以下选择（根据内容特点）：
   - 选择题（4 选 1，含干扰项设计）
   - 简答题（考查概念理解）
   - 计算题（如果内容涉及公式/数值）
2. 每题标注类型和分值（选择 2分，简答 5分，计算 8分）
3. 题目必须从页面内容出发，不能超纲
4. 干扰项要有区分度（常见误解作为干扰）

输出格式（严格遵守）：

### 练习题

**题 1**（{类型}，{分值}分）

{题目正文}

{如果是选择题：}
A. ...
B. ...
C. ...
D. ...

**题 2**（{类型}，{分值}分）

{题目正文}

---ANSWERS---

**题 1 答案**

{完整解答过程}

**题 2 答案**

{完整解答过程}`;

async function generateQuiz(pageContent, slug) {
  const prompt = QUIZ_PROMPT.replace('{content}', pageContent.slice(0, 3000));

  try {
    const response = await chatCompletion({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.4,
      max_tokens: 131072,
    });

    const output = response?.choices?.[0]?.message?.content || '';
    const parts = output.split('---ANSWERS---');
    const questions = (parts[0] || '').trim();
    const answers = (parts[1] || '').trim();
    return { questions, answers };
  } catch (e) {
    console.error(`[Stage 4.5] Quiz gen failed for ${slug}: ${e.message}`);
    return { questions: '', answers: '' };
  }
}

async function run(wikiDir, treePath, outputDir, topic) {
  console.log(`[Stage 4.5] Quiz Generate: ${topic}`);

  const tree = JSON.parse(fs.readFileSync(treePath, 'utf-8'));
  const answersDir = path.join(outputDir, 'answers');
  fs.mkdirSync(answersDir, { recursive: true });

  function collectLeaves(node) {
    if (!node.children || node.children.length === 0) return [node];
    return node.children.flatMap(collectLeaves);
  }
  const leaves = collectLeaves(tree);

  let quizCount = 0;
  for (const leaf of leaves) {
    const slug = leaf.page_slug;
    const wikiPath = path.join(wikiDir, `${slug}.md`);
    if (!fs.existsSync(wikiPath)) continue;

    const content = fs.readFileSync(wikiPath, 'utf-8');

    // Skip pages with very little content
    if (content.length < 200) continue;

    const { questions, answers } = await generateQuiz(content, slug);
    if (!questions) continue;

    // Append quiz to wiki page
    const quizSection = `\n\n---\n\n${questions}\n\n<details>\n<summary>💡 点击查看答案提示</summary>\n\n参见答案文档：answers/${slug}-answers.md\n\n</details>\n`;
    fs.writeFileSync(wikiPath, content + quizSection, 'utf-8');

    // Write answers file
    if (answers) {
      fs.writeFileSync(
        path.join(answersDir, `${slug}-answers.md`),
        `# ${leaf.label} — 练习题答案\n\n${answers}\n`,
        'utf-8'
      );
    }

    quizCount++;
    console.log(`[Stage 4.5] ${quizCount}/${leaves.length} ${slug}`);
  }

  console.log(`[Stage 4.5] ✅ Generated quizzes for ${quizCount} pages`);
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

module.exports = { run, generateQuiz };
