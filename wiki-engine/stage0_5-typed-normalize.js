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

const CLASSIFY_TOOL = {
  type: 'function',
  function: {
    name: 'classify_content',
    description: '把源材料全量分流到三类：知识讲解(explanation)、知识总结(summary)、题目(problem)。不删内容、不挑重点。',
    parameters: {
      type: 'object',
      required: ['explanations', 'summaries', 'problems'],
      properties: {
        explanations: {
          type: 'array',
          description: '知识讲解类内容：概念解释、原理说明、推导过程、例子、课堂讲解',
          items: {
            type: 'object',
            required: ['title', 'content', 'source_span'],
            properties: {
              title: { type: 'string', description: '该讲解段的标题（10-30字）' },
              content: { type: 'string', description: '原文内容，不删不改，完整保留' },
              source_span: { type: 'string', description: '来源位置描述（如 "第3页" 或 "offset 1200-2400"）' },
            },
          },
        },
        summaries: {
          type: 'array',
          description: '知识总结类内容：知识点列表、章节总结、复习提纲、recap、重点总结',
          items: {
            type: 'object',
            required: ['title', 'content', 'source_span'],
            properties: {
              title: { type: 'string', description: '该总结段的标题' },
              content: { type: 'string', description: '原文内容，不删不改' },
              source_span: { type: 'string', description: '来源位置' },
            },
          },
        },
        problems: {
          type: 'array',
          description: '题目单元：题干+答案+解题步骤作为完整记录，不拆分',
          items: {
            type: 'object',
            required: ['id', 'source_span', 'question'],
            properties: {
              id: { type: 'string', description: '题目唯一ID（如 prob_001）' },
              source_span: { type: 'string', description: '来源位置' },
              question: {
                type: 'object',
                required: ['text'],
                properties: {
                  text: { type: 'string', description: '完整题干' },
                  options: { type: 'array', items: { type: 'string' }, description: '选项（选择题）' },
                  given_conditions: { type: 'array', items: { type: 'string' }, description: '已知条件' },
                  target: { type: 'string', description: '求解目标' },
                },
              },
              solution: {
                type: 'object',
                properties: {
                  answer: { type: 'string', description: '答案' },
                  explanation: { type: 'string', description: '解析' },
                  steps: { type: 'array', items: { type: 'string' }, description: '解题步骤' },
                  status: { type: 'string', enum: ['present', 'missing_in_source'], description: '原文是否包含解答' },
                },
              },
              assets: { type: 'array', items: { type: 'string' }, description: '关联图片/图表文件名' },
            },
          },
        },
      },
    },
  },
};

const SYSTEM_PROMPT = `你是学习资料结构化引擎。

调用 classify_content 工具，把输入的学习资料**全量**分流到三类。

核心规则：
1. **全量抽取** — 不删内容、不挑重点、不提前做知识化。输入有多少内容，输出就应该有多少。
2. **三类分流**：
   - explanations：概念解释、原理说明、推导过程、例子、课堂讲解、定义
   - summaries：知识点列表、章节总结、复习提纲、recap、重点整理
   - problems：题目+答案+解题步骤作为完整记录。如果原文有答案就填，没有就标记 status="missing_in_source"
3. **content 字段必须是原文** — 你可以适当整理格式（如修复OCR错误的换行），但不能改写语义、不能缩写、不能总结。
4. **source_span 必须填写** — 标注这段内容在原文中的位置。
5. **题目和解答不分离** — 一道题的题干、选项、条件、答案、步骤、解析都放在同一个 problem 记录里。
6. 如果一段内容同时包含讲解和题目，拆成讲解部分 + 题目部分。`;

function buildUserPrompt(sourceId, content, chunkIndex, totalChunks) {
  const chunkInfo = totalChunks > 1 ? `（第 ${chunkIndex + 1}/${totalChunks} 块）` : '';
  return `来源文件：${sourceId}${chunkInfo}

---
${content}
---

调用 classify_content 将以上内容全量分流到 explanations / summaries / problems 三类。`;
}

function mergeResults(results) {
  const merged = { explanations: [], summaries: [], problems: [] };
  let probSeq = 1;
  for (const r of results) {
    if (Array.isArray(r.explanations)) merged.explanations.push(...r.explanations);
    if (Array.isArray(r.summaries)) merged.summaries.push(...r.summaries);
    if (Array.isArray(r.problems)) {
      for (const p of r.problems) {
        if (!p.id) p.id = `prob_${String(probSeq++).padStart(3, '0')}`;
        merged.problems.push(p);
      }
    }
  }
  return merged;
}

function validateResult(result, originalLength) {
  const errors = [];

  for (const [i, exp] of (result.explanations || []).entries()) {
    if (!exp.content || exp.content.length < 10) {
      errors.push(`explanations[${i}]: content too short or empty`);
    }
    if (!exp.source_span) errors.push(`explanations[${i}]: missing source_span`);
  }

  for (const [i, prob] of (result.problems || []).entries()) {
    if (!prob.question?.text) errors.push(`problems[${i}]: missing question.text`);
    if (prob.solution && !['present', 'missing_in_source'].includes(prob.solution.status)) {
      errors.push(`problems[${i}]: invalid solution.status`);
    }
  }

  const totalExtracted =
    (result.explanations || []).reduce((s, e) => s + (e.content?.length || 0), 0) +
    (result.summaries || []).reduce((s, e) => s + (e.content?.length || 0), 0) +
    (result.problems || []).reduce((s, p) => {
      let len = p.question?.text?.length || 0;
      if (p.solution?.explanation) len += p.solution.explanation.length;
      if (p.solution?.steps) len += p.solution.steps.join('').length;
      return s + len;
    }, 0);

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
    yamlLines.push(`    question:`);
    yamlLines.push(`      text: ${JSON.stringify(p.question?.text || '')}`);
    if (p.question?.options?.length) {
      yamlLines.push(`      options:`);
      for (const opt of p.question.options) yamlLines.push(`        - ${JSON.stringify(opt)}`);
    }
    if (p.question?.given_conditions?.length) {
      yamlLines.push(`      given_conditions:`);
      for (const gc of p.question.given_conditions) yamlLines.push(`        - ${JSON.stringify(gc)}`);
    }
    if (p.question?.target) yamlLines.push(`      target: ${JSON.stringify(p.question.target)}`);

    if (p.solution) {
      yamlLines.push(`    solution:`);
      yamlLines.push(`      status: ${p.solution.status || 'missing_in_source'}`);
      if (p.solution.answer) yamlLines.push(`      answer: ${JSON.stringify(p.solution.answer)}`);
      if (p.solution.explanation) yamlLines.push(`      explanation: ${JSON.stringify(p.solution.explanation)}`);
      if (p.solution.steps?.length) {
        yamlLines.push(`      steps:`);
        for (const step of p.solution.steps) yamlLines.push(`        - ${JSON.stringify(step)}`);
      }
    }
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
    '',
  ].join('\n');

  if (!manifest.startsWith('sources:')) manifest = 'sources:\n';
  const sourceRegex = new RegExp(`  ${sourceSlug}:[\\s\\S]*?(?=  \\w|$)`, 'g');
  manifest = manifest.replace(sourceRegex, '');
  manifest += entry;

  fs.writeFileSync(manifestPath, manifest, 'utf-8');
}

async function classifyChunk(sourceId, content, chunkIndex, totalChunks) {
  const prompt = buildUserPrompt(sourceId, content, chunkIndex, totalChunks);
  const response = await chatCompletion({
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
    tools: [CLASSIFY_TOOL],
    tool_choice: { type: 'function', function: { name: 'classify_content' } },
    temperature: 0.1,
    max_tokens: 65536,
  });

  const choice = response?.choices?.[0];
  const toolCalls = choice?.message?.tool_calls || [];

  if (toolCalls.length > 0) {
    try {
      return JSON.parse(toolCalls[0].function?.arguments || '{}');
    } catch (e) {
      console.warn(`[Stage 0.5] tool_call parse failed for chunk ${chunkIndex}: ${e.message}`);
    }
  }

  const text = choice?.message?.content || '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  try {
    return jsonMatch ? JSON.parse(jsonMatch[0]) : { explanations: [], summaries: [], problems: [] };
  } catch {
    console.warn(`[Stage 0.5] JSON regex parse failed for chunk ${chunkIndex}`);
    return { explanations: [], summaries: [], problems: [] };
  }
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
  if (originalLength <= CHUNK_SIZE) {
    chunks.push(content);
  } else {
    for (let offset = 0; offset < originalLength; offset += Math.max(CHUNK_SIZE - CHUNK_OVERLAP, 1)) {
      chunks.push(content.slice(offset, offset + CHUNK_SIZE));
    }
  }

  let bestResult = null;
  let bestCoverage = 0;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    console.log(`[Stage 0.5]   Attempt ${attempt + 1}/${MAX_RETRIES} (${chunks.length} chunk${chunks.length > 1 ? 's' : ''})`);

    const chunkResults = [];
    for (let i = 0; i < chunks.length; i++) {
      console.log(`[Stage 0.5]   Classifying chunk ${i + 1}/${chunks.length}...`);
      const result = await classifyChunk(sourceId, chunks[i], i, chunks.length);
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

    console.log(`[Stage 0.5] Processing ${sources.length} sources for topic: ${topic}`);

    (async () => {
      for (const src of sources) {
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
