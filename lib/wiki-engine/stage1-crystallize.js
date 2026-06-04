/**
 * Stage 1 — Crystallize
 *
 * 从 normalized content.md 提取知识原子（atoms）。
 * 一个 atom = 一个 idea（Zettelkasten 原子化原则）。
 *
 * LLM 仅做"提取 + 改写到 ≤40 字 claim"，不写整页、不起 slug、不判断 parent。
 * 使用 function calling (tool schema 强约束)。
 *
 * 输入：normalized content.md
 * 输出：atoms/<source-id>.json
 */

const fs = require('fs');
const path = require('path');
const { chatCompletion, getModel } = require('../llm-client');
const { recordDecision } = require('./tech-decisions');

const CLAIM_MAX_CHARS = 120;
const EVIDENCE_MAX_CHARS = 600;
const KIND_ENUM = ['definition', 'example', 'formula', 'rule', 'anti-pattern', 'problem'];

const EXTRACT_TOOL = {
  type: 'function',
  function: {
    name: 'emit_atoms',
    description: '把当前文本片段提取为知识原子数组。每个 atom 承载一个 idea，所有字段必填。',
    parameters: {
      type: 'object',
      required: ['atoms'],
      properties: {
        atoms: {
          type: 'array',
          items: {
            type: 'object',
            required: ['claim', 'evidence_quote', 'evidence_char_offset', 'kind', 'draft_tags'],
            properties: {
              claim: {
                type: 'string',
                description: '知识点凝练表述，≤ 40 个中文字（高中生最少信息）',
              },
              evidence_quote: {
                type: 'string',
                description: '原文中支持该 claim 的连续片段，≤ 200 中文字。必须是原文片段，不能改写。',
              },
              evidence_char_offset: {
                type: 'array',
                description: '[start, end) 偏移量。',
                items: { type: 'integer' },
                minItems: 2,
                maxItems: 2,
              },
              kind: {
                type: 'string',
                enum: KIND_ENUM,
              },
              draft_tags: {
                type: 'array',
                description: '2-5 个关键词标签，用于聚类初始化',
                items: { type: 'string' },
              },
            },
          },
        },
      },
    },
  },
};

const SYSTEM_PROMPT = `你是知识结晶化引擎。

调用 emit_atoms 工具把文本切成知识原子。规则：
- 一个 atom 承载一个 idea。一段文字含多个 idea 必须拆成多个 atom。
- claim ≤ 40 中文字，让高中生能充分理解。
- evidence_quote 必须是原文连续片段（不要改写、不要省略号）。
- evidence_char_offset 用文本开头给出的"起始偏移"加上片段在文本里的相对位置。
- kind 必须是闭集之一：${KIND_ENUM.join(' / ')}。
- draft_tags 给 2-5 个关键词。
- 不要写整页内容、不要起 slug、不要判断父子关系——这些由后续 stage 完成。`;

function buildUserPrompt(sourceId, content, startOffset) {
  return `来源文件：${sourceId}
起始偏移：${startOffset}（请把 evidence_char_offset 的两个值加上此基准）

---
${content}
---

调用 emit_atoms 提取所有知识原子。`;
}

function validateAtom(atom) {
  const errors = [];
  if (!atom.claim || atom.claim.length > CLAIM_MAX_CHARS) {
    errors.push(`claim 超长或缺失 (${atom.claim?.length || 0} chars)`);
  }
  if (!atom.evidence?.quote) {
    errors.push('缺少 evidence.quote');
  } else if (atom.evidence.quote.length > EVIDENCE_MAX_CHARS) {
    errors.push(`evidence.quote 超长 (${atom.evidence.quote.length} chars)`);
  }
  if (!atom.evidence?.char_offset || atom.evidence.char_offset.length !== 2) {
    errors.push('缺少或格式错误的 char_offset');
  }
  if (!KIND_ENUM.includes(atom.kind)) {
    errors.push(`无效 kind: ${atom.kind}`);
  }
  return errors;
}

async function crystallize(sourceId, contentPath, outputDir, topic, options = {}) {
  const content = fs.readFileSync(contentPath, 'utf-8');
  const chunkSize = options.chunkSize || 8000;
  const overlap = options.overlap || 200;
  const allAtoms = [];
  let seq = 1;

  for (let offset = 0; offset < content.length; offset += Math.max(chunkSize - overlap, 1)) {
    const chunk = content.slice(offset, offset + chunkSize);
    if (!chunk.trim()) continue;
    const prompt = buildUserPrompt(sourceId, chunk, offset);

    const response = await chatCompletion({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      tools: [EXTRACT_TOOL],
      tool_choice: { type: 'function', function: { name: 'emit_atoms' } },
      temperature: 0.1,
      max_tokens: 8192,
    });

    const choice = response?.choices?.[0];
    const toolCalls = choice?.message?.tool_calls || [];
    let atoms = [];
    if (toolCalls.length > 0) {
      try {
        const args = JSON.parse(toolCalls[0].function?.arguments || '{}');
        atoms = Array.isArray(args.atoms) ? args.atoms : [];
      } catch (e) {
        console.warn(`[Stage 1] tool_call arguments parse failed at offset ${offset}: ${e.message}`);
      }
    } else {
      const text = choice?.message?.content || '';
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      try {
        atoms = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
      } catch {
        console.warn(`[Stage 1] no tool_call and JSON regex parse failed at offset ${offset}`);
      }
    }

    for (const raw of atoms) {
      const evidenceQuote = raw.evidence_quote || raw.evidence?.quote || raw.quote || '';
      const evidenceOffset = raw.evidence_char_offset
        || raw.evidence?.char_offset
        || raw.char_offset
        || [offset, offset + chunk.length];
      const atom = {
        id: `atom-${topic}-${sourceId.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-${String(seq).padStart(3, '0')}`,
        claim: raw.claim,
        evidence: {
          quote: evidenceQuote,
          source_id: sourceId,
          char_offset: evidenceOffset,
        },
        kind: KIND_ENUM.includes(raw.kind) ? raw.kind : 'definition',
        draft_tags: Array.isArray(raw.draft_tags) ? raw.draft_tags : [],
        lifted_at: new Date().toISOString(),
      };

      const validationErrors = validateAtom(atom);
      if (validationErrors.length > 0) {
        console.warn(`[Stage 1] Atom ${atom.id} validation: ${validationErrors.join('; ')}`);
      }

      allAtoms.push(atom);
      seq++;
    }
  }

  // Deduplicate atoms from overlap regions (same evidence_quote = duplicate)
  const seen = new Set();
  const dedupedAtoms = [];
  for (const atom of allAtoms) {
    const key = atom.evidence.quote.slice(0, 80);
    if (!seen.has(key)) {
      seen.add(key);
      dedupedAtoms.push(atom);
    }
  }

  const atomsDir = path.join(outputDir, 'atoms');
  fs.mkdirSync(atomsDir, { recursive: true });
  const outputPath = path.join(atomsDir, `${sourceId.replace(/[^a-z0-9]/gi, '-')}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(dedupedAtoms, null, 2), 'utf-8');

  recordDecision(outputDir, topic, {
    stage: 'stage-1',
    name: 'crystallize LLM',
    chosen: getModel(),
    rationale: `使用 function calling (emit_atoms tool)。chunkSize=${chunkSize}, overlap=${overlap}。tool schema 把 claim/evidence_quote/evidence_char_offset/kind/draft_tags 全部声明为 required，杜绝字段缺失。`,
    known_limits: [
      'LLM 仍可能误判 char_offset（建议 Stage 5 evidence offset 校验闸门）',
      'claim 偶有超长情况（后处理截断）',
    ],
    switch_conditions: [
      '出现专门的知识结晶化模型（fine-tuned）',
      '上游不再支持 function calling 时回退 response_format JSON mode',
    ],
  });

  console.log(`[Stage 1] Crystallized ${dedupedAtoms.length} atoms from ${sourceId} (${allAtoms.length} raw, ${allAtoms.length - dedupedAtoms.length} deduped)`);
  return dedupedAtoms;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length < 4) {
    console.error('Usage: node stage1-crystallize.js <source-id> <content.md> <output-dir> <topic>');
    process.exit(2);
  }
  crystallize(args[0], args[1], args[2], args[3]).catch(e => {
    console.error('[Stage 1] Fatal:', e.message);
    process.exit(1);
  });
}

module.exports = { crystallize, validateAtom, SYSTEM_PROMPT };
