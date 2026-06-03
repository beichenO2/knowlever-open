/**
 * normalize-formulas.js — 公式保护层
 *
 * 在 ingest → normalized 之后运行，检测 content.md 中疑似未包裹的数学公式，
 * 用 LLM 补上 LaTeX $...$ / $$...$$ 包裹。
 *
 * 检测模式：
 *   1. 裸上下标：x2, C_A^n, α/β/γ + 数字/字母组合
 *   2. 裸运算符：→, ≥, ≤, ∑, ∫, ∂, ∞ 周围无 $
 *   3. 分数/根号文本：如 "1/2"、"√2" 在非代码上下文中
 *   4. 化学式模式：H2O, NaOH, CH3COOH 等
 *
 * 用法：
 *   node lib/normalize-formulas.js <content.md> [--apply]
 *   node lib/normalize-formulas.js --dir <normalized-dir> [--apply]
 *
 * --apply 时直接覆写文件；否则打印 diff 预览。
 */

const fs = require('fs');
const path = require('path');
const { chatCompletion } = require('./llm-client');

const MATH_SYMBOLS = /[αβγδεζηθικλμνξπρστυφχψωΔΣΠ∫∂∞≥≤≠≈∈∉⊂⊃∪∩±×÷√∝∀∃⇒⇔→←↑↓]/;
const SUPERSCRIPT_PATTERN = /(?<![$`])\b([A-Za-z]+)(\d+)\b(?![$`])/g;
const FRACTION_PATTERN = /(?<![$/`])(\d+)\/(\d+)(?![$/`])/g;
const CHEMICAL_FORMULA = /\b([A-Z][a-z]?(?:\d+)?(?:[A-Z][a-z]?(?:\d+)?){1,})\b/g;
const ARROW_PATTERN = /(?<!\$)([→←⇒⇔↑↓])(?!\$)/g;

function detectMathCandidates(text) {
  const lines = text.split('\n');
  const candidates = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip code blocks and existing LaTeX
    if (line.startsWith('```') || line.startsWith('    ') || line.startsWith('\t')) continue;
    if (/\$[^$]+\$/.test(line)) continue;

    // Check for math symbols without $ wrapping
    if (MATH_SYMBOLS.test(line)) {
      candidates.push({ line: i + 1, text: line, reason: 'math_symbol' });
      continue;
    }

    // Check for bare superscripts (like x2, C_A)
    if (SUPERSCRIPT_PATTERN.test(line)) {
      SUPERSCRIPT_PATTERN.lastIndex = 0;
      candidates.push({ line: i + 1, text: line, reason: 'bare_superscript' });
      continue;
    }

    // Check for chemical formulas
    const chemMatches = line.match(CHEMICAL_FORMULA);
    if (chemMatches) {
      const confirmed = chemMatches.filter(m =>
        /[A-Z][a-z]?\d/.test(m) && m.length >= 3 && m.length <= 20
      );
      if (confirmed.length > 0) {
        candidates.push({ line: i + 1, text: line, reason: 'chemical_formula', matches: confirmed });
      }
    }
  }

  return candidates;
}

const FORMULA_FIX_PROMPT = `你是公式格式化助手。以下文本行中可能含有未用 LaTeX 包裹的数学公式或化学式。

规则：
- 数学公式/变量用 $...$ 包裹（inline）或 $$...$$ 包裹（独占一行的长公式）
- 化学式也用 $...$ 包裹：$H_2O$, $NaOH$, $CH_3COOH$
- 上下标：$x^2$, $C_A^n$, $a_1$
- 希腊字母：$\\alpha$, $\\beta$, $\\gamma$
- 箭头：$\\to$, $\\rightarrow$
- 如果一行已经有 $ 包裹的部分，不要重复包裹
- 只修改需要 LaTeX 包裹的部分，保持其余文本不变
- 如果某行不含任何公式，原样返回

请对每一行输出修正后的结果。只输出修正后的行，不要解释。`;

async function fixFormulas(lines) {
  if (lines.length === 0) return [];

  const userContent = lines.map((l, i) => `${i + 1}. ${l}`).join('\n');

  try {
    const response = await chatCompletion({
      messages: [
        { role: 'system', content: FORMULA_FIX_PROMPT },
        { role: 'user', content: userContent },
      ],
      temperature: 0.1,
      max_tokens: 4096,
    });

    const output = response?.choices?.[0]?.message?.content || '';
    const fixedLines = output.split('\n')
      .map(l => l.replace(/^\d+\.\s*/, '').trim())
      .filter(l => l.length > 0);

    if (fixedLines.length === lines.length) return fixedLines;
    return lines;
  } catch (e) {
    console.warn(`[normalize-formulas] LLM call failed: ${e.message}`);
    return lines;
  }
}

async function processFile(filePath, apply = false) {
  const text = fs.readFileSync(filePath, 'utf-8');
  const candidates = detectMathCandidates(text);

  if (candidates.length === 0) {
    console.log(`[normalize-formulas] ${filePath}: no candidates found`);
    return { changed: false, candidates: 0 };
  }

  console.log(`[normalize-formulas] ${filePath}: ${candidates.length} candidates`);

  const lines = text.split('\n');
  const candidateLines = candidates.map(c => c.text);

  // Process in batches of 20
  const batchSize = 20;
  let totalFixed = 0;

  for (let i = 0; i < candidates.length; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize);
    const batchTexts = batch.map(c => c.text);
    const fixed = await fixFormulas(batchTexts);

    for (let j = 0; j < batch.length; j++) {
      const lineIdx = batch[j].line - 1;
      if (fixed[j] && fixed[j] !== lines[lineIdx]) {
        if (!apply) {
          console.log(`  L${batch[j].line}: ${lines[lineIdx]}`);
          console.log(`      → ${fixed[j]}`);
        }
        lines[lineIdx] = fixed[j];
        totalFixed++;
      }
    }
  }

  if (totalFixed > 0 && apply) {
    fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
    console.log(`[normalize-formulas] ✅ Fixed ${totalFixed} lines in ${filePath}`);
  } else if (totalFixed > 0) {
    console.log(`[normalize-formulas] Would fix ${totalFixed} lines (use --apply to write)`);
  }

  return { changed: totalFixed > 0, candidates: candidates.length, fixed: totalFixed };
}

async function processDirectory(dir, apply = false) {
  if (!fs.existsSync(dir)) {
    console.error(`[normalize-formulas] Directory not found: ${dir}`);
    process.exit(1);
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let totalFixed = 0;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const contentPath = path.join(dir, entry.name, 'content.md');
    if (!fs.existsSync(contentPath)) continue;

    const result = await processFile(contentPath, apply);
    totalFixed += result.fixed || 0;
  }

  console.log(`[normalize-formulas] Done: ${totalFixed} total fixes`);
}

if (require.main === module) {
  const args = process.argv.slice(2);
  let target = null;
  let isDir = false;
  let apply = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--apply') apply = true;
    else if (args[i] === '--dir') { isDir = true; target = args[++i]; }
    else if (!target) target = args[i];
  }

  if (!target) {
    console.error('Usage: node normalize-formulas.js <content.md> [--apply]');
    console.error('       node normalize-formulas.js --dir <normalized-dir> [--apply]');
    process.exit(2);
  }

  if (isDir) {
    processDirectory(target, apply).catch(e => {
      console.error('[normalize-formulas] Fatal:', e.message);
      process.exit(1);
    });
  } else {
    processFile(target, apply).catch(e => {
      console.error('[normalize-formulas] Fatal:', e.message);
      process.exit(1);
    });
  }
}

module.exports = { processFile, processDirectory, detectMathCandidates, fixFormulas };
