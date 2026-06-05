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
const { chatCompletion, getModel } = require('../lib/llm-proxy');
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

const SYSTEM_PROMPT = `你是知识总结引擎。先通读全文，理解其核心逻辑和知识结构。

然后调用 emit_atoms 输出你总结出的每个核心知识点。每个 atom 应该是你理解后的总结，而不是机械复制原文的一段。

规则：
- claim 是你总结的核心表述（≤ 40 中文字），让高中生能充分理解。不是原文剪贴。
- evidence_quote 仍然引用原文连续片段（保证可追溯），≤ 200 中文字，不改写。
- evidence_char_offset 用文本开头给出的"起始偏移"加上片段在文本里的相对位置。
- kind 反映知识的职能角色，必须是闭集之一：${KIND_ENUM.join(' / ')}。
- draft_tags 给 2-5 个关键词。
- 要抽取概念间的因果关系和前置条件（用 claim 表达"A 导致 B""A 是 B 的前提"等）。
- 一个 atom 承载一个核心知识点。一段文字含多个知识点必须拆成多个 atom。
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
  const chunkSize = options.chunkSize || 50000;
  const overlap = options.overlap || 2000;
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
      max_tokens: 98000,
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
        id: `atom-${topic}-${sourceId.replace(/[^a-z0-9\u4e00-\u9fff]/gi, '-').replace(/-+/g, '-').toLowerCase()}-${String(seq).padStart(3, '0')}`,
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

  // LLM-based deduplication: feed all atoms back to LLM for merge judgment
  let dedupedAtoms = allAtoms;
  if (allAtoms.length > 1) {
    console.log(`[Stage 1] LLM dedup: ${allAtoms.length} atoms`);
    const atomSummary = allAtoms.map((a, i) => `[${i}] ${a.claim} (${a.kind}) — "${a.evidence.quote.slice(0, 60)}..."`).join('\n');

    const DEDUP_TOOL = {
      type: 'function',
      function: {
        name: 'report_duplicates',
        description: '报告重复的 atom 索引对。如果两个 atom 表述的是同一个知识点（即使角度不同也不算重复），才算重复。',
        parameters: {
          type: 'object',
          required: ['duplicate_groups'],
          properties: {
            duplicate_groups: {
              type: 'array',
              description: '每组是一个重复集合的索引数组，保留第一个，删除后续的',
              items: { type: 'array', items: { type: 'integer' } },
            },
          },
        },
      },
    };

    try {
      const dedupResp = await chatCompletion({
        messages: [
          { role: 'system', content: '你是知识原子去重引擎。检查以下 atoms 列表，找出表述完全相同知识点的重复项。注意：同一段原文的不同角度/不同 claim 不算重复。只有当两个 atom 的核心知识点完全一样时才报告为重复。' },
          { role: 'user', content: `共 ${allAtoms.length} 个 atoms:\n${atomSummary}\n\n调用 report_duplicates 报告重复组。如果没有重复，返回空数组。` },
        ],
        tools: [DEDUP_TOOL],
        tool_choice: { type: 'function', function: { name: 'report_duplicates' } },
        temperature: 0.05,
        max_tokens: 100000,
      });

      const dedupChoice = dedupResp?.choices?.[0];
      const dedupCalls = dedupChoice?.message?.tool_calls || [];
      if (dedupCalls.length > 0) {
        const args = JSON.parse(dedupCalls[0].function?.arguments || '{}');
        const groups = args.duplicate_groups || [];
        const toRemove = new Set();
        for (const group of groups) {
          for (let i = 1; i < group.length; i++) toRemove.add(group[i]);
        }
        dedupedAtoms = allAtoms.filter((_, i) => !toRemove.has(i));
        console.log(`[Stage 1] LLM dedup: removed ${toRemove.size} duplicates`);
      }
    } catch (e) {
      console.warn(`[Stage 1] LLM dedup failed (${e.message}), keeping all atoms`);
    }
  }

  // LLM coverage check: verify atoms cover the input content
  if (dedupedAtoms.length > 0) {
    console.log(`[Stage 1] Coverage check: ${dedupedAtoms.length} atoms vs source content`);
    const claimList = dedupedAtoms.map((a, i) => `${i + 1}. ${a.claim}`).join('\n');

    const COVERAGE_TOOL = {
      type: 'function',
      function: {
        name: 'coverage_report',
        description: '判断 atoms 是否完整覆盖了源文本的知识内容',
        parameters: {
          type: 'object',
          required: ['is_complete', 'missing_topics'],
          properties: {
            is_complete: { type: 'boolean', description: '是否完整覆盖（允许遗漏不超过5%的边缘内容）' },
            missing_topics: { type: 'array', items: { type: 'string' }, description: '遗漏的知识主题（如果有）' },
          },
        },
      },
    };

    try {
      const coverageResp = await chatCompletion({
        messages: [
          { role: 'system', content: '你是覆盖率审核员。检查提取的知识原子是否完整覆盖了源材料的所有知识内容。' },
          { role: 'user', content: `源文件: ${sourceId}\n\n源材料原文:\n---\n${content.slice(0, 200000)}\n---\n\n已提取的 ${dedupedAtoms.length} 个知识原子:\n${claimList}\n\n调用 coverage_report 判断是否完整覆盖。` },
        ],
        tools: [COVERAGE_TOOL],
        tool_choice: { type: 'function', function: { name: 'coverage_report' } },
        temperature: 0.1,
        max_tokens: 100000,
      });

      const covChoice = coverageResp?.choices?.[0];
      const covCalls = covChoice?.message?.tool_calls || [];
      if (covCalls.length > 0) {
        const args = JSON.parse(covCalls[0].function?.arguments || '{}');
        if (args.is_complete) {
          console.log(`[Stage 1] ✅ Coverage check passed`);
        } else {
          console.warn(`[Stage 1] ⚠️ Coverage gaps: ${(args.missing_topics || []).join(', ')}`);
        }
      }
    } catch (e) {
      console.warn(`[Stage 1] Coverage check failed (${e.message}), proceeding`);
    }
  }

  const atomsDir = path.join(outputDir, 'atoms');
  fs.mkdirSync(atomsDir, { recursive: true });
  const outputPath = path.join(atomsDir, `${sourceId.replace(/[^a-z0-9\u4e00-\u9fff]/gi, '-').replace(/-+/g, '-')}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(dedupedAtoms, null, 2), 'utf-8');

  recordDecision(outputDir, topic, {
    stage: 'stage-1',
    name: 'crystallize LLM',
    chosen: getModel(),
    rationale: `[2026-06-05 决策] 从"机械切分"改为"理解后总结"。`
      + ` 依据 EACL 2026 ARC 框架和 Selective Abstraction 论文：原子化擅长精确定位和验证，整体总结擅长完整性和连贯性。`
      + ` 方案：保留 emit_atoms tool schema（后续 Stage 2/3 依赖），但 prompt 引导 LLM 先通读理解再总结，claim 是总结而非剪贴。`
      + ` 技术参数：chunkSize=${chunkSize}, overlap=${overlap}。tool schema required fields 不变。`,
    known_limits: [
      'LLM 仍可能误判 char_offset（建议 Stage 5 evidence offset 校验闸门）',
      'claim 偶有超长情况（后处理截断）',
      '"理解后总结"依赖 LLM 的全局理解能力，chunk 过大时效果可能下降',
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
