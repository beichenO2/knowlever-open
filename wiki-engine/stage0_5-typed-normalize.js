#!/usr/bin/env node
/**
 * Stage 0.5 — Typed Normalize
 *
 * Classifies plaintext content into typed raw corpus:
 *   - explanations/ (concepts, derivations, examples, lectures)
 *   - summaries/ (key points, recaps, chapter overviews)
 *   - problems/ (questions + solutions as unified records)
 *
 * Full extraction — no content dropped, no pre-knowledge-ification.
 *
 * Input:  data/topics/<topic>/normalized/<source>/content.md  (plaintext from Stage 0)
 * Output: data/topics/<topic>/normalized/explanations/<source>.explanations.raw.md
 *         data/topics/<topic>/normalized/summaries/<source>.summaries.raw.md
 *         data/topics/<topic>/normalized/problems/<source>.problems.yaml
 *         data/topics/<topic>/normalized/manifest.yaml
 */

const fs = require('fs');
const path = require('path');
const { chatCompletion } = require('../lib/llm-proxy');
const { recordDecision } = require('./tech-decisions');

const CHUNK_SIZE = 50000;
const CHUNK_OVERLAP = 2000;
const COVERAGE_THRESHOLD = 0.70;
const MAX_RETRIES = 3;

const SPAN_ITEM = {
  type: 'object',
  required: ['title', 'type', 'start', 'end'],
  properties: {
    title: { type: 'string', description: '该段标题（10-30字）' },
    type: { type: 'string', enum: ['explanation', 'summary', 'problem'], description: '内容类型' },
    start: { type: 'integer', description: '原文起始字符偏移量（0-based）' },
    end: { type: 'integer', description: '原文结束字符偏移量（不含）' },
    problem_meta: {
      type: 'object',
      description: '仅 type=problem 时填写',
      properties: {
        id: { type: 'string', description: '题目唯一ID（如 prob_001）' },
        has_solution: { type: 'boolean', description: '原文是否包含答案/解析' },
      },
    },
  },
};

const CLASSIFY_TOOL = {
  type: 'function',
  function: {
    name: 'classify_content',
    description: '把源材料按字符坐标全量分流。只需给出每段的 start/end 偏移量和类型，不需要复制原文。',
    parameters: {
      type: 'object',
      required: ['spans'],
      properties: {
        spans: {
          type: 'array',
          description: '按出现顺序排列的分段列表，每段用 start/end 标注原文范围',
          items: SPAN_ITEM,
        },
      },
    },
  },
};

const SYSTEM_PROMPT = `你是学习资料结构化引擎。

调用 classify_content 工具，把输入的学习资料**全量**标注分类。

**关键：你只需要输出每段的坐标（start/end 字符偏移量），不需要复制原文内容。**

核心规则：
1. **全量覆盖** — 输入的每个字符都应属于某个 span。span 之间不应有遗漏（小量空白/分隔符除外）。
2. **三类分流**：
   - explanation：概念解释、原理说明、推导过程、例子、课堂讲解、定义
   - summary：知识点列表、章节总结、复习提纲、recap、重点整理
   - problem：题目+答案+解题步骤。一道完整题目（含题干、选项、答案、解析）用一个 span
3. **坐标精确** — start 是该段第一个字符的 0-based 偏移，end 是最后一个字符之后的偏移（即 [start, end) 半开区间）。
4. **按顺序排列** — spans 按 start 递增排列。
5. **不重叠** — 相邻 span 的 start >= 前一个的 end。
6. 如果一段内容同时包含讲解和题目，拆成讲解 span + 题目 span。
7. 每行前有行号标注 \`[NNN]\`，利用它精确定位 start/end。`;

function addLineNumbers(content) {
  const lines = content.split('\n');
  let offset = 0;
  const numbered = [];
  for (let i = 0; i < lines.length; i++) {
    numbered.push(`[${offset}]${lines[i]}`);
    offset += lines[i].length + 1;
  }
  return numbered.join('\n');
}

function buildUserPrompt(sourceId, content, chunkIndex, totalChunks, chunkOffset) {
  const chunkInfo = totalChunks > 1 ? `（第 ${chunkIndex + 1}/${totalChunks} 块，偏移 ${chunkOffset}）` : '';
  const numbered = addLineNumbers(content);
  return `来源文件：${sourceId}${chunkInfo}
总长度：${content.length} 字符

---
${numbered}
---

调用 classify_content 标注每段的 start/end 坐标和类型。全量覆盖，不遗漏。`;
}

function resolveSpans(spans, fullContent, chunkOffset) {
  const resolved = { explanations: [], summaries: [], problems: [] };
  let probSeq = 1;

  for (const span of (spans || [])) {
    const start = (span.start || 0) + chunkOffset;
    const end = Math.min((span.end || span.start || 0) + chunkOffset, fullContent.length);
    if (start >= end) continue;

    const content = fullContent.slice(start, end);
    const sourceSpan = `offset ${start}-${end}`;

    if (span.type === 'explanation') {
      resolved.explanations.push({ title: span.title || '', content, source_span: sourceSpan });
    } else if (span.type === 'summary') {
      resolved.summaries.push({ title: span.title || '', content, source_span: sourceSpan });
    } else if (span.type === 'problem') {
      const id = span.problem_meta?.id || `prob_${String(probSeq++).padStart(3, '0')}`;
      resolved.problems.push({
        id,
        source_span: sourceSpan,
        content,
        has_solution: span.problem_meta?.has_solution ?? false,
      });
    }
  }
  return resolved;
}

function mergeResults(results) {
  const merged = { explanations: [], summaries: [], problems: [] };
  for (const r of results) {
    if (Array.isArray(r.explanations)) merged.explanations.push(...r.explanations);
    if (Array.isArray(r.summaries)) merged.summaries.push(...r.summaries);
    if (Array.isArray(r.problems)) merged.problems.push(...r.problems);
  }
  return merged;
}

function validateResult(result, originalLength) {
  const errors = [];

  for (const [i, exp] of (result.explanations || []).entries()) {
    if (!exp.content || exp.content.length < 10) {
      errors.push(`explanations[${i}]: content too short or empty`);
    }
  }

  for (const [i, prob] of (result.problems || []).entries()) {
    if (!prob.content || prob.content.length < 5) {
      errors.push(`problems[${i}]: content too short or empty`);
    }
  }

  const totalExtracted =
    (result.explanations || []).reduce((s, e) => s + (e.content?.length || 0), 0) +
    (result.summaries || []).reduce((s, e) => s + (e.content?.length || 0), 0) +
    (result.problems || []).reduce((s, p) => s + (p.content?.length || 0), 0);

  const coverage = originalLength > 0 ? totalExtracted / originalLength : 0;

  return { errors, coverage, totalExtracted };
}

function writeExplanations(outDir, sourceSlug, explanations) {
  if (!explanations || explanations.length === 0) return;
  const dir = path.join(outDir, 'explanations');
  fs.mkdirSync(dir, { recursive: true });
  const lines = [];
  for (const exp of explanations) {
    lines.push(`## ${exp.title || '未命名讲解段'}\n`);
    lines.push(`> 来源：${exp.source_span || '未知'}\n`);
    lines.push(exp.content || '');
    lines.push('\n---\n');
  }
  fs.writeFileSync(path.join(dir, `${sourceSlug}.explanations.raw.md`), lines.join('\n'), 'utf-8');
}

function writeSummaries(outDir, sourceSlug, summaries) {
  if (!summaries || summaries.length === 0) return;
  const dir = path.join(outDir, 'summaries');
  fs.mkdirSync(dir, { recursive: true });
  const lines = [];
  for (const s of summaries) {
    lines.push(`## ${s.title || '未命名总结段'}\n`);
    lines.push(`> 来源：${s.source_span || '未知'}\n`);
    lines.push(s.content || '');
    lines.push('\n---\n');
  }
  fs.writeFileSync(path.join(dir, `${sourceSlug}.summaries.raw.md`), lines.join('\n'), 'utf-8');
}

function writeProblems(outDir, sourceSlug, problems) {
  if (!problems || problems.length === 0) return;
  const dir = path.join(outDir, 'problems');
  fs.mkdirSync(dir, { recursive: true });

  const yamlLines = ['problems:'];
  for (const p of problems) {
    yamlLines.push(`  - id: ${JSON.stringify(p.id || 'unknown')}`);
    yamlLines.push(`    source_span: ${JSON.stringify(p.source_span || 'unknown')}`);
    yamlLines.push(`    has_solution: ${p.has_solution ? 'true' : 'false'}`);
    yamlLines.push(`    content: ${JSON.stringify(p.content || '')}`);
    yamlLines.push('');
  }
  fs.writeFileSync(path.join(dir, `${sourceSlug}.problems.yaml`), yamlLines.join('\n'), 'utf-8');
}

function updateManifest(outDir, sourceSlug, stats) {
  const manifestPath = path.join(outDir, 'manifest.yaml');
  let manifest = '';
  if (fs.existsSync(manifestPath)) manifest = fs.readFileSync(manifestPath, 'utf-8');

  const entry = [
    `  ${sourceSlug}:`,
    `    explanations: ${stats.explanationCount}`,
    `    summaries: ${stats.summaryCount}`,
    `    problems: ${stats.problemCount}`,
    `    coverage: ${(stats.coverage * 100).toFixed(1)}%`,
    `    original_chars: ${stats.originalLength}`,
    `    extracted_chars: ${stats.totalExtracted}`,
    `    processed_at: ${new Date().toISOString()}`,
  ].join('\n') + '\n';

  if (!manifest.startsWith('sources:')) manifest = 'sources:\n';
  const escaped = sourceSlug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const sourceRegex = new RegExp(`^  ${escaped}:\\n(?:    .+\\n)*`, 'gm');
  manifest = manifest.replace(sourceRegex, '');
  manifest += entry;

  fs.writeFileSync(manifestPath, manifest, 'utf-8');
}

async function classifyChunk(sourceId, chunkContent, chunkIndex, totalChunks, fullContent, chunkOffset) {
  const prompt = buildUserPrompt(sourceId, chunkContent, chunkIndex, totalChunks, chunkOffset);
  const response = await chatCompletion({
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
    tools: [CLASSIFY_TOOL],
    tool_choice: { type: 'function', function: { name: 'classify_content' } },
    temperature: 0.1,
    max_tokens: 16384,
  });

  const choice = response?.choices?.[0];
  const toolCalls = choice?.message?.tool_calls || [];

  let parsed = { spans: [] };
  if (toolCalls.length > 0) {
    try {
      parsed = JSON.parse(toolCalls[0].function?.arguments || '{}');
    } catch (e) {
      console.warn(`[Stage 0.5]   tool_call parse failed for chunk ${chunkIndex}: ${e.message}`);
    }
  } else {
    const text = choice?.message?.content || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    try {
      if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
    } catch {
      console.warn(`[Stage 0.5]   JSON regex parse failed for chunk ${chunkIndex}`);
    }
  }

  return resolveSpans(parsed.spans, fullContent, chunkOffset);
}

async function typedNormalize(sourceId, contentPath, normalizedDir, topic, options = {}) {
  const content = fs.readFileSync(contentPath, 'utf-8');
  const originalLength = content.length;

  if (originalLength < 50) {
    console.log(`[Stage 0.5] Skipping ${sourceId} — too short (${originalLength} chars)`);
    return null;
  }

  console.log(`[Stage 0.5] Processing ${sourceId} (${originalLength} chars)`);

  const chunks = [];
  const chunkOffsets = [];
  if (originalLength <= CHUNK_SIZE) {
    chunks.push(content);
    chunkOffsets.push(0);
  } else {
    const step = Math.max(CHUNK_SIZE - CHUNK_OVERLAP, 1);
    for (let offset = 0; offset < originalLength; offset += step) {
      chunks.push(content.slice(offset, offset + CHUNK_SIZE));
      chunkOffsets.push(offset);
    }
  }

  let bestResult = null;
  let bestCoverage = 0;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    console.log(`[Stage 0.5]   Attempt ${attempt + 1}/${MAX_RETRIES} (${chunks.length} chunk${chunks.length > 1 ? 's' : ''})`);

    const chunkResults = [];
    for (let i = 0; i < chunks.length; i++) {
      console.log(`[Stage 0.5]   Classifying chunk ${i + 1}/${chunks.length}...`);
      const result = await classifyChunk(sourceId, chunks[i], i, chunks.length, content, chunkOffsets[i]);
      chunkResults.push(result);
    }

    const merged = mergeResults(chunkResults);
    const { errors, coverage, totalExtracted } = validateResult(merged, originalLength);

    console.log(`[Stage 0.5]   Coverage: ${(coverage * 100).toFixed(1)}% (${totalExtracted}/${originalLength} chars)`);
    console.log(`[Stage 0.5]   explanations: ${merged.explanations.length}, summaries: ${merged.summaries.length}, problems: ${merged.problems.length}`);

    if (errors.length > 0) {
      console.warn(`[Stage 0.5]   Validation issues: ${errors.slice(0, 5).join('; ')}`);
    }

    if (coverage > bestCoverage) {
      bestResult = merged;
      bestCoverage = coverage;
    }

    if (coverage >= COVERAGE_THRESHOLD) {
      console.log(`[Stage 0.5]   ✅ Coverage OK (${(coverage * 100).toFixed(1)}% >= ${(COVERAGE_THRESHOLD * 100)}%)`);
      break;
    }

    if (attempt < MAX_RETRIES - 1) {
      console.log(`[Stage 0.5]   ⚠️ Coverage below ${(COVERAGE_THRESHOLD * 100)}%, retrying...`);
    }
  }

  if (bestCoverage < COVERAGE_THRESHOLD) {
    console.warn(`[Stage 0.5]   ⚠️ Best coverage ${(bestCoverage * 100).toFixed(1)}% still below threshold. Using best attempt.`);
  }

  const slug = sourceId.replace(/[^a-z0-9\u4e00-\u9fff]/gi, '-').replace(/-+/g, '-');
  writeExplanations(normalizedDir, slug, bestResult.explanations);
  writeSummaries(normalizedDir, slug, bestResult.summaries);
  writeProblems(normalizedDir, slug, bestResult.problems);

  const stats = {
    explanationCount: bestResult.explanations.length,
    summaryCount: bestResult.summaries.length,
    problemCount: bestResult.problems.length,
    coverage: bestCoverage,
    originalLength,
    totalExtracted: validateResult(bestResult, originalLength).totalExtracted,
  };
  updateManifest(normalizedDir, slug, stats);

  recordDecision(path.dirname(normalizedDir), topic, {
    stage: 'stage-0.5',
    name: 'typed-normalize',
    chosen: 'LLM classify_content tool',
    rationale: `Full-extraction typed normalize. Chunk: ${CHUNK_SIZE} chars, overlap: ${CHUNK_OVERLAP}. Coverage threshold: ${(COVERAGE_THRESHOLD * 100)}%. RetryLoop max ${MAX_RETRIES}.`,
    known_limits: [
      'Coverage metric is char-count based, not semantic — LLM reformatting can reduce ratio',
      'OCR-degraded sources may have low coverage due to garbled text',
    ],
    switch_conditions: [
      'Fine-tuned classification model available',
      'Structured input formats (LaTeX, structured DOCX) could use rule-based classification',
    ],
  });

  console.log(`[Stage 0.5] ✅ ${sourceId}: E=${stats.explanationCount} S=${stats.summaryCount} P=${stats.problemCount} (${(bestCoverage * 100).toFixed(1)}% coverage)`);
  return stats;
}

if (require.main === module) {
  const args = process.argv.slice(2);

  if (args[0] === '--all') {
    const topic = args[1];
    if (!topic) {
      console.error('Usage: node stage0_5-typed-normalize.js --all <topic>');
      process.exit(2);
    }
    const { ROOT, resolveTopic, ensureTopicDirs } = require('../lib/paths');
    const t = ensureTopicDirs(topic);
    const normalizedDir = t.normalizedDir;
    const sources = fs.readdirSync(normalizedDir).filter(f => {
      const fp = path.join(normalizedDir, f);
      return fs.statSync(fp).isDirectory() && !f.startsWith('.') && fs.existsSync(path.join(fp, 'content.md'));
    });

    if (sources.length === 0) {
      console.error('[Stage 0.5] No sources found in', normalizedDir);
      process.exit(1);
    }

    const manifestPath = path.join(normalizedDir, 'manifest.yaml');
    const manifestText = fs.existsSync(manifestPath) ? fs.readFileSync(manifestPath, 'utf-8') : '';
    const alreadyDone = new Set();
    for (const m of manifestText.matchAll(/^  ([^\s:][^:]*?):\s*$/gm)) {
      alreadyDone.add(m[1].trim());
    }

    const todo = sources.filter(src => {
      const slug = src.replace(/[^a-z0-9\u4e00-\u9fff]/gi, '-').replace(/-+/g, '-');
      return !alreadyDone.has(src) && !alreadyDone.has(slug);
    });

    console.log(`[Stage 0.5] ${sources.length} total sources, ${alreadyDone.size} already done, ${todo.length} remaining for topic: ${topic}`);

    (async () => {
      for (const src of todo) {
        const contentPath = path.join(normalizedDir, src, 'content.md');
        await typedNormalize(src, contentPath, normalizedDir, topic);
      }
      console.log(`[Stage 0.5] All ${sources.length} sources processed.`);
    })().catch(e => {
      console.error('[Stage 0.5] Fatal:', e.message);
      process.exit(1);
    });
  } else {
    if (args.length < 4) {
      console.error('Usage: node stage0_5-typed-normalize.js <source-id> <content.md> <normalized-dir> <topic>');
      console.error('       node stage0_5-typed-normalize.js --all <topic>');
      process.exit(2);
    }
    typedNormalize(args[0], args[1], args[2], args[3]).catch(e => {
      console.error('[Stage 0.5] Fatal:', e.message);
      process.exit(1);
    });
  }
}

module.exports = { typedNormalize, CLASSIFY_TOOL, SYSTEM_PROMPT };
