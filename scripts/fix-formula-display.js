#!/usr/bin/env node
/**
 * Post-processing script: promote important inline LaTeX ($...$) to display math ($$...$$).
 *
 * Heuristics for "important formula" (should be display math):
 *   1. Contains relation operators: =, \approx, \le, \ge, \propto, \equiv, \sim
 *   2. Contains structural commands: \frac, \int, \sum, \prod, \sqrt, \iint, \oint
 *   3. Is long enough (>40 chars) to benefit from its own line
 *   4. NOT a simple variable definition like $R$ or $P_t$
 *
 * Also fixes Unicode sub/superscript characters inside LaTeX delimiters.
 *
 * Usage: node scripts/fix-formula-display.js <wiki-dir>
 */

const fs = require('fs');
const path = require('path');

const wikiDir = process.argv[2];
if (!wikiDir) {
  console.error('Usage: node fix-formula-display.js <wiki-dir>');
  process.exit(1);
}

const UNICODE_SUB = {
  '₀': '_0', '₁': '_1', '₂': '_2', '₃': '_3', '₄': '_4',
  '₅': '_5', '₆': '_6', '₇': '_7', '₈': '_8', '₉': '_9',
  'ₐ': '_a', 'ₑ': '_e', 'ₒ': '_o', 'ₓ': '_x', 'ₙ': '_n',
  'ₘ': '_m', 'ₖ': '_k', 'ₜ': '_t', 'ₛ': '_s', 'ₚ': '_p',
  'ₗ': '_l', 'ᵢ': '_i', 'ⱼ': '_j',
};
const UNICODE_SUP = {
  '⁰': '^0', '¹': '^1', '²': '^2', '³': '^3', '⁴': '^4',
  '⁵': '^5', '⁶': '^6', '⁷': '^7', '⁸': '^8', '⁹': '^9',
  'ⁿ': '^n',
};

const subRe = new RegExp('[' + Object.keys(UNICODE_SUB).join('') + ']', 'g');
const supRe = new RegExp('[' + Object.keys(UNICODE_SUP).join('') + ']', 'g');

function fixUnicodeMath(text) {
  text = text.replace(subRe, m => UNICODE_SUB[m] || m);
  text = text.replace(supRe, m => UNICODE_SUP[m] || m);
  return text;
}

// Fix Unicode sub/superscripts in plain text (outside LaTeX delimiters).
// Converts patterns like "F₁" to "$F_1$" and "10⁻²³" to "$10^{-23}$"
function fixUnicodePlainText(line) {
  // Skip lines that are frontmatter or headings
  if (/^(---|#|slug:|title:|kind:|parent:|type:|source:)/.test(line.trim())) return line;

  let changed = false;

  // Pattern: letter/digit followed by Unicode subscript digits -> wrap in $...$
  // e.g. F₁ -> $F_1$, G₁ -> $G_1$, T₀ -> $T_0$
  line = line.replace(/([A-Za-z])([₀₁₂₃₄₅₆₇₈₉ₐₑₒₓₙₘₖₜₛₚₗᵢⱼ]+)/g, (match, letter, subs) => {
    // Check if already inside $...$
    const fixed = subs.replace(subRe, m => UNICODE_SUB[m] || m);
    changed = true;
    return `$${letter}${fixed}$`;
  });

  // Pattern: digit followed by Unicode superscript (e.g. 10⁻²³ or x²)
  line = line.replace(/([A-Za-z0-9])([⁰¹²³⁴⁵⁶⁷⁸⁹ⁿ⁻]+)/g, (match, base, sups) => {
    const fixed = sups
      .replace(supRe, m => UNICODE_SUP[m] || m)
      .replace(/⁻/g, '^{-}');
    changed = true;
    if (/^\^/.test(fixed)) {
      return `$${base}${fixed}$`;
    }
    return `$${base}^{${fixed.replace(/\^/g, '')}}$`;
  });

  // Pattern: standalone Unicode subscript/superscript digits (rare, but clean up)
  line = line.replace(subRe, m => { changed = true; return UNICODE_SUB[m] || m; });
  line = line.replace(supRe, m => { changed = true; return UNICODE_SUP[m] || m; });

  // Clean up double-wrapped $$ from adjacent replacements: $X_1$$Y_2$ -> $X_1 Y_2$
  line = line.replace(/\$\$/g, (m, offset) => {
    // Only merge if not display math (preceded by another $)
    if (offset > 0 && line[offset - 1] === '$') return '$$';
    return ' ';
  });

  return line;
}

const STRUCTURAL_CMDS = /\\(frac|int|iint|oint|sum|prod|sqrt|begin\{|lim|max|min|det|log|ln|exp|binom|left|right|underbrace|overbrace)/;
const RELATION_OPS = /(=|\\approx|\\le|\\ge|\\propto|\\equiv|\\sim(?![\w])|\\ne|\\neq)/;

function shouldBeDisplay(formula) {
  const trimmed = formula.trim();
  if (trimmed.length < 15) return false;
  if (/^[A-Za-z_{}\\]+$/.test(trimmed)) return false;
  if (/^\\(text|mathrm)\{[^}]+\}$/.test(trimmed)) return false;

  const hasStructural = STRUCTURAL_CMDS.test(trimmed);
  const hasRelation = RELATION_OPS.test(trimmed);
  const isLong = trimmed.length > 40;

  if (hasStructural) return true;
  if (hasRelation && trimmed.length > 20) return true;
  if (isLong && hasRelation) return true;

  return false;
}

function processFile(filePath) {
  const originalContent = fs.readFileSync(filePath, 'utf-8');
  let content = originalContent;
  let changes = 0;

  content = content.replace(/\$\$[\s\S]*?\$\$/g, match => {
    const inner = match.slice(2, -2);
    const fixed = fixUnicodeMath(inner);
    if (fixed !== inner) changes++;
    return '$$' + fixed + '$$';
  });

  // Phase 2: Fix Unicode sub/superscripts everywhere
  // For lines without $: apply fixUnicodePlainText (wraps into $...$)
  // For lines with $: fix Unicode both inside and outside LaTeX delimiters
  const rawLines = content.split('\n');
  const fixedPlainLines = [];
  for (const rl of rawLines) {
    if (!rl.includes('$')) {
      const fixed = fixUnicodePlainText(rl);
      if (fixed !== rl) changes++;
      fixedPlainLines.push(fixed);
    } else {
      // Process segments: split by $...$ and $$...$$ delimiters
      // Inside $...$: use fixUnicodeMath (LaTeX syntax)
      // Outside $...$: use fixUnicodePlainText
      let fixed = rl;
      // Fix Unicode inside existing $...$ (single dollar)
      fixed = fixed.replace(/\$([^$]+)\$/g, (m, inner) => {
        const f = fixUnicodeMath(inner);
        if (f !== inner) changes++;
        return '$' + f + '$';
      });
      // Fix Unicode in non-LaTeX segments (between $...$ blocks)
      // Split by $...$ tokens and process non-math parts
      const parts = [];
      let lastEnd = 0;
      const mathRe = /\$\$[\s\S]*?\$\$|\$[^$]+\$/g;
      let match;
      while ((match = mathRe.exec(fixed)) !== null) {
        if (match.index > lastEnd) {
          const segment = fixed.slice(lastEnd, match.index);
          const fixedSeg = fixUnicodePlainText(segment);
          if (fixedSeg !== segment) changes++;
          parts.push(fixedSeg);
        }
        parts.push(match[0]);
        lastEnd = match.index + match[0].length;
      }
      if (lastEnd < fixed.length) {
        const segment = fixed.slice(lastEnd);
        const fixedSeg = fixUnicodePlainText(segment);
        if (fixedSeg !== segment) changes++;
        parts.push(fixedSeg);
      }
      fixedPlainLines.push(parts.join(''));
    }
  }
  content = fixedPlainLines.join('\n');

  const lines = content.split('\n');
  const result = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    if (/^\$\$/.test(line.trim())) {
      result.push(line);
      continue;
    }

    let newLine = '';
    let pos = 0;
    const pendingPromotions = [];

    while (pos < line.length) {
      const dollarIdx = line.indexOf('$', pos);
      if (dollarIdx === -1) {
        newLine += line.slice(pos);
        break;
      }

      if (dollarIdx + 1 < line.length && line[dollarIdx + 1] === '$') {
        newLine += line.slice(pos, dollarIdx + 2);
        pos = dollarIdx + 2;
        continue;
      }

      const endIdx = line.indexOf('$', dollarIdx + 1);
      if (endIdx === -1) {
        newLine += line.slice(pos);
        break;
      }

      const formula = line.slice(dollarIdx + 1, endIdx);
      const fixedFormula = fixUnicodeMath(formula);
      if (fixedFormula !== formula) changes++;

      const before = line.slice(pos, dollarIdx);
      const after = line.slice(endIdx + 1);

      if (shouldBeDisplay(fixedFormula)) {
        const beforeTrimmed = (newLine + before).trim();
        const afterTrimmed = after.trim();

        if (beforeTrimmed === '' && afterTrimmed === '') {
          newLine = '$$' + fixedFormula + '$$';
          pos = line.length;
          changes++;
          continue;
        }

        if (beforeTrimmed.endsWith(':') || beforeTrimmed.endsWith('：') ||
            beforeTrimmed.endsWith('为') || beforeTrimmed.endsWith('得') ||
            beforeTrimmed.endsWith('即') || beforeTrimmed === '') {
          pendingPromotions.push({
            beforeText: newLine + before,
            formula: fixedFormula,
            afterText: after,
            endPos: endIdx + 1,
          });
          newLine = '';
          pos = endIdx + 1;
          changes++;
          continue;
        }
      }

      newLine += before + '$' + fixedFormula + '$';
      pos = endIdx + 1;
    }

    if (pendingPromotions.length > 0) {
      for (const promo of pendingPromotions) {
        const bt = promo.beforeText.trimEnd();
        if (bt) result.push(bt);
        result.push('$$' + promo.formula + '$$');
      }
      const remaining = newLine.trim();
      if (remaining) result.push(remaining);
    } else {
      result.push(newLine);
    }
  }

  const finalContent = result.join('\n');
  if (finalContent !== originalContent) {
    fs.writeFileSync(filePath, finalContent, 'utf-8');
    return changes || 1;
  }
  return 0;
}

const files = fs.readdirSync(wikiDir).filter(f => f.endsWith('.md'));
let totalChanges = 0;
let filesChanged = 0;

for (const f of files) {
  const fp = path.join(wikiDir, f);
  const n = processFile(fp);
  if (n > 0) {
    console.log(`  ${f}: ${n} fixes`);
    totalChanges += n;
    filesChanged++;
  }
}

console.log(`\nDone: ${totalChanges} total fixes across ${filesChanged}/${files.length} files`);
