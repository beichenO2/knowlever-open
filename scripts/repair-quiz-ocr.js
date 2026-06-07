#!/usr/bin/env node
/**
 * repair-quiz-ocr.js — 直接修复 wiki/quiz-*.md 中题目文本的 OCR 乱码
 *
 * 策略：
 *   1. 解析每个 quiz-*.md，提取 ## 题 N 到 <details> 之间的题目文本
 *   2. 用 LLM 将碎裂的 OCR 公式重构为正确的 LaTeX 格式
 *   3. 原地回写文件，解答部分（<details> 内）保持不变
 *
 * 用法：node scripts/repair-quiz-ocr.js [topic]
 *       默认 topic = radar-2026
 */

const fs = require('fs');
const path = require('path');
const { chatCompletion } = require('../lib/llm-proxy');

const REPAIR_PROMPT = `你是一位雷达/电子工程领域的 LaTeX 排版专家。

下面给你一段从 PDF 用 OCR 提取出来的练习题文本，其中的数学公式被 OCR 严重破坏了：
- 变量赋值写成 "N  66" 应该是 "$N = 66$"
- 希腊字母丢失，如 "脉冲宽度   1 s" 应该是 "脉冲宽度 $\\tau = 1\\mu s$"
- 分数被拆成多行空格对齐，如分子在上行、分母在下行
- 上下标被拆成独立的数字
- 运算符和等号用空格替代
- 单位没有用 \\text{} 包裹

请修复这段文本，规则：
1. 把所有数学公式和变量用 LaTeX 行内公式 $...$ 包裹
2. 保留原始的中文文字内容不变，不增删语义
3. 把多行碎裂的公式合并为正确的单行 LaTeX
4. 删除明显的 OCR 垃圾（如 \\f 分页符、"信息与通信工程学院" 页脚）
5. 保留题目编号和结构（如"例："、"①"、"练习"等）
6. 如果文本中已经有正确的 LaTeX，保持不变
7. 不要添加解答，只修复题目文本的格式

直接输出修复后的题目文本，不要加任何解释。`;

function needsRepair(text) {
  if (!text || text.trim().length < 10) return false;
  const ocrPatterns = [
    /[A-Z]\s{2,}\d/,
    /\n\s{3,}\d\b/,
    /\f/,
    /信息与通信工程学院/,
    /\b[A-Z]\s{2,}[a-z]/,
    /\d+\s{3,}\d+/,
    /[a-z]\s{2,}[a-z]\s{2,}\d/,
    /\(4\s*\)\s*\d/,
    /PRF\s{3,}/,
  ];
  return ocrPatterns.some(p => p.test(text));
}

async function repairText(text, maxRetries = 3) {
  if (!needsRepair(text)) return text;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await chatCompletion({
        messages: [
          { role: 'user', content: `${REPAIR_PROMPT}\n\n---\n${text}\n---` }
        ],
        temperature: 0.1,
        max_tokens: 8192,
      });
      const result = response?.choices?.[0]?.message?.content?.trim();
      if (result && result.length > 10) return result;
    } catch (e) {
      console.error(`  [repair] attempt ${attempt}/${maxRetries} failed: ${e.message}`);
      if (attempt < maxRetries) {
        const delay = 2000 * attempt;
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  return text;
}

function parseQuizMd(content) {
  const sections = [];
  let currentSection = null;
  const lines = content.split('\n');

  let i = 0;
  let header = '';

  while (i < lines.length && !lines[i].startsWith('## 题 ')) {
    header += lines[i] + '\n';
    i++;
  }

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith('## 题 ')) {
      if (currentSection) sections.push(currentSection);
      currentSection = { heading: line, question: '', detailsPre: '', solutionBody: '', detailsPost: '' };
      i++;

      while (i < lines.length && !lines[i].startsWith('<details>') && !lines[i].startsWith('## 题 ')) {
        currentSection.question += lines[i] + '\n';
        i++;
      }

      if (i < lines.length && lines[i].startsWith('<details>')) {
        currentSection.detailsPre = lines[i] + '\n';
        i++;
        if (i < lines.length && lines[i].startsWith('<summary>')) {
          currentSection.detailsPre += lines[i] + '\n';
          i++;
        }
        while (i < lines.length && lines[i].trim() !== '</details>' && !lines[i].startsWith('## 题 ')) {
          currentSection.solutionBody += lines[i] + '\n';
          i++;
        }
        if (i < lines.length && lines[i].trim() === '</details>') {
          currentSection.detailsPost = lines[i] + '\n';
          i++;
        }
        while (i < lines.length && !lines[i].startsWith('## 题 ')) {
          currentSection.detailsPost += lines[i] + '\n';
          i++;
        }
      }
      continue;
    }
    i++;
  }
  if (currentSection) sections.push(currentSection);

  return { header, sections };
}

function rebuildQuizMd(header, sections) {
  let md = header;
  for (const sec of sections) {
    md += sec.heading + '\n\n';
    md += sec.question.trim() + '\n\n';
    if (sec.detailsPre) {
      md += sec.detailsPre;
      md += '\n' + sec.solutionBody.trim() + '\n\n';
      md += sec.detailsPost.trimEnd() + '\n\n';
    }
    md += '---\n\n';
  }
  return md.trimEnd() + '\n';
}

async function run() {
  const topic = process.argv[2] || 'radar-2026';
  const ROOT = path.resolve(__dirname, '..');
  const wikiDir = path.join(ROOT, 'data', 'topics', topic, 'output', 'wiki');

  const files = fs.readdirSync(wikiDir).filter(f => f.startsWith('quiz-') && f.endsWith('.md'));
  console.log(`[repair] Found ${files.length} quiz files in ${wikiDir}`);

  let totalQuestions = 0;
  let repairedCount = 0;
  let skippedCount = 0;

  for (const file of files) {
    const filePath = path.join(wikiDir, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const { header, sections } = parseQuizMd(content);

    if (sections.length === 0) {
      console.log(`  [skip] ${file}: no questions found`);
      continue;
    }

    console.log(`[repair] ${file}: ${sections.length} questions`);
    let fileChanged = false;

    for (let j = 0; j < sections.length; j++) {
      totalQuestions++;
      const sec = sections[j];

      process.stdout.write(`  ${j + 1}/${sections.length} question...`);
      const qOriginal = sec.question;
      const qRepaired = await repairText(qOriginal);
      if (qRepaired !== qOriginal) {
        sec.question = qRepaired + '\n';
        fileChanged = true;
        repairedCount++;
        process.stdout.write(' ✅');
      } else {
        skippedCount++;
        process.stdout.write(' ⏭️');
      }

      if (sec.solutionBody && needsRepair(sec.solutionBody)) {
        process.stdout.write(' | solution...');
        const sOriginal = sec.solutionBody;
        const sRepaired = await repairText(sOriginal);
        if (sRepaired !== sOriginal) {
          sec.solutionBody = sRepaired + '\n';
          fileChanged = true;
          process.stdout.write(' ✅');
        } else {
          process.stdout.write(' ⏭️');
        }
      }
      console.log('');
    }

    if (fileChanged) {
      const newContent = rebuildQuizMd(header, sections);
      fs.writeFileSync(filePath, newContent, 'utf-8');
      console.log(`  → wrote ${file}`);
    }
  }

  console.log(`\n[repair] ✅ Done: ${repairedCount} repaired, ${skippedCount} skipped, ${totalQuestions} total`);
}

run().catch(e => {
  console.error('[repair] Fatal:', e.message);
  process.exit(1);
});
