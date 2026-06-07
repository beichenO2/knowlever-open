/**
 * Stage 3 — Tree Construct (Hybrid Semantic Grouping)
 *
 * 从 clusters.json + atoms 构建 tree.json。
 *
 * 核心算法：双策略递归分组
 *   - >15 个条目：embedding cosine 贪心聚类（快速粗分）
 *   - ≤15 个条目：LLM 智能分类+命名+合理性评价（精细分组）
 *   - Slug 在此唯一发放
 *
 * 输入：clusters.json + atoms/*.json
 * 输出：tree.json
 */

const fs = require('fs');
const path = require('path');
const { chatCompletion, embedding: getEmbeddings } = require('../lib/llm-proxy');
const { recordDecision } = require('./tech-decisions');

const TARGET_GROUP_SIZE = 4;
const MIN_GROUP_SIZE = 3;
const MAX_GROUP_SIZE = 6;
const LLM_CLASSIFY_THRESHOLD = 15;

function loadAtoms(atomsDir) {
  const atoms = {};
  if (!fs.existsSync(atomsDir)) return atoms;
  const files = fs.readdirSync(atomsDir).filter(f => f.endsWith('.json'));
  for (const f of files) {
    const list = JSON.parse(fs.readFileSync(path.join(atomsDir, f), 'utf-8'));
    for (const a of (Array.isArray(list) ? list : [])) atoms[a.id] = a;
  }
  return atoms;
}

function generateSlug(prefix, label, index) {
  const normalized = label
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return `${prefix}-${normalized || index}`;
}

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
}

function computeCentroid(vectors) {
  if (vectors.length === 0) return [];
  const dim = vectors[0].length;
  const centroid = new Array(dim).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) centroid[i] += v[i];
  }
  for (let i = 0; i < dim; i++) centroid[i] /= vectors.length;
  return centroid;
}

/**
 * Greedy semantic grouping: given N items with embeddings,
 * group them into clusters of TARGET_GROUP_SIZE using nearest-neighbor merging.
 */
function semanticGroup(items, targetSize = TARGET_GROUP_SIZE) {
  if (items.length <= MAX_GROUP_SIZE) return [items];

  // Start: each item is its own group
  let groups = items.map(item => ({
    items: [item],
    centroid: item.embedding,
  }));

  // Iteratively merge closest pair until we have ≤ ceil(N/targetSize) groups
  const desiredGroupCount = Math.ceil(items.length / targetSize);

  while (groups.length > desiredGroupCount) {
    // Find closest pair
    let bestI = 0, bestJ = 1, bestSim = -Infinity;
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        // Don't merge if combined size would exceed MAX_GROUP_SIZE
        if (groups[i].items.length + groups[j].items.length > MAX_GROUP_SIZE) continue;
        const sim = cosineSimilarity(groups[i].centroid, groups[j].centroid);
        if (sim > bestSim) {
          bestSim = sim;
          bestI = i;
          bestJ = j;
        }
      }
    }

    // If no valid merge possible, break
    if (bestSim === -Infinity) break;

    // Merge
    const merged = {
      items: [...groups[bestI].items, ...groups[bestJ].items],
      centroid: computeCentroid([
        ...groups[bestI].items.map(it => it.embedding),
        ...groups[bestJ].items.map(it => it.embedding),
      ]),
    };
    groups = groups.filter((_, idx) => idx !== bestI && idx !== bestJ);
    groups.push(merged);
  }

  return groups.map(g => g.items);
}

/**
 * LLM-based classification: given ≤15 items with labels and summaries,
 * ask LLM to group them into categories and name each category.
 * parentLabel provides the higher-level topic name for context.
 * Returns: { groups: [[item indices]], names: [group name], assessment: string }
 */
async function llmClassifyAndName(items, parentLabel = '') {
  const itemDescriptions = items.map((item, i) => {
    const summary = (item.atoms || []).length > 0
      ? ` — 包含${item.atoms.length}个知识点`
      : '';
    const childCount = (item.children || []).length;
    const childInfo = childCount > 0 ? ` (含${childCount}个子概念)` : '';
    return `${i + 1}. ${item.label}${summary}${childInfo}`;
  }).join('\n');

  const parentContext = parentLabel
    ? `\n上层主题是「${parentLabel}」。你要生成的分类是它的**子层级**，所以分类名称不能与上层主题重名。`
    : '';

  try {
    const response = await chatCompletion({
      messages: [{
        role: 'user',
        content: `你是知识体系架构师。你正在构建一棵知识树：把零散知识点（叶子）归类为更高级的抽象概念（中间节点）。${parentContext}

以下是 ${items.length} 个同级知识概念，需要你同时为它们分组并一次性命名所有分类：

${itemDescriptions}

**设计哲学**：
- 分类标题是「更高级的抽象」——它不是重复上层主题名，而是概括一组子概念的共同本质
- 好的标题让读者一看就知道这组知识讲什么：如「脉冲测距与分辨」「角度跟踪体制」「目标散射特性」
- 坏的标题就是把上层主题名抄一遍或用笼统词：如「雷达原理」「信号处理」「基础概念」

请完成以下任务：
1. 将这些概念分成若干类（每类 2-6 个），形成树状结构
2. 一次性为所有分类命名（≤10字，互不相同，有区分度）
3. 评价分类是否合理

输出严格 JSON 格式：
{
  "groups": [
    {"name": "分类名称A", "members": [1, 3, 5]},
    {"name": "分类名称B", "members": [2, 4, 6]}
  ],
  "assessment": "合理性评价（一句话）"
}

规则：
- members 使用上方的序号（1-based）
- 每个概念只能属于一个分类
- 所有概念必须被分配
- ⛔ 所有分类名称必须互不相同，且不能与上层主题名「${parentLabel || '(根)'}」重名
- 标题要具体、有区分度——用「目标散射特性」而非笼统的「雷达原理」
- 只输出 JSON`,
      }],
      temperature: 0.1,
      max_tokens: 2000,
    });

    const raw = response?.choices?.[0]?.message?.content?.trim() || '';
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in LLM response');

    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.groups || !Array.isArray(parsed.groups)) throw new Error('Missing groups');

    const assigned = new Set();
    const result = [];
    for (const g of parsed.groups) {
      if (!g.name || !Array.isArray(g.members) || g.members.length === 0) continue;
      const indices = g.members.map(m => m - 1).filter(idx => idx >= 0 && idx < items.length && !assigned.has(idx));
      indices.forEach(idx => assigned.add(idx));
      if (indices.length > 0) {
        result.push({ name: g.name, items: indices.map(idx => items[idx]) });
      }
    }

    // Catch unassigned items
    for (let i = 0; i < items.length; i++) {
      if (!assigned.has(i)) {
        if (result.length > 0) {
          result[result.length - 1].items.push(items[i]);
        } else {
          result.push({ name: items[i].label, items: [items[i]] });
        }
      }
    }

    console.log(`[Stage 3] LLM classify: ${items.length} items → ${result.length} groups`);
    for (const g of result) {
      console.log(`[Stage 3]   "${g.name}": [${g.items.map(it => it.label).join(', ')}]`);
    }
    if (parsed.assessment) {
      console.log(`[Stage 3]   Assessment: ${parsed.assessment}`);
    }

    return result;
  } catch (e) {
    console.warn(`[Stage 3] LLM classify failed (${e.message}), falling back to embedding grouping`);
    return null;
  }
}

/**
 * Generate a group label using LLM (or fallback to tag-based).
 * Used only when embedding-based grouping is active (>15 items).
 * parentLabel prevents generating a label that duplicates the higher-level topic.
 */
async function generateGroupLabel(childLabels, options = {}) {
  if (!options.useLlmLabels) {
    return childLabels.slice(0, 2).join('、') + (childLabels.length > 2 ? ' 等' : '');
  }

  const parentHint = options.parentLabel
    ? `\n上层主题是「${options.parentLabel}」，你的标题不能与之重名，必须是更具体的子领域概括。`
    : '';

  try {
    const response = await chatCompletion({
      messages: [{
        role: 'user',
        content: `以下是一组相关知识概念的标题：\n${childLabels.map(l => `- ${l}`).join('\n')}${parentHint}\n\n请用一个 ≤ 10 字的中文短语概括它们的共同主题。\n\n要求：\n1. 必须具体，反映这组概念的共同本质\n2. ⛔ 绝对禁止使用笼统名称如「雷达原理」「信号处理」「基础概念」「系统基础」\n3. 好的例子：「脉冲测距与分辨」「角度跟踪体制」「频域滤波与积累」\n4. 如果子概念涉及不同方面，选最突出的方面命名\n\n只输出短语，不要解释。`,
      }],
      temperature: 0.1,
      max_tokens: 200,
    });
    const label = response?.choices?.[0]?.message?.content?.trim();
    if (label && label.length <= 20) return label;
  } catch (e) {
    // Fallback silently
  }
  return childLabels.slice(0, 2).join('、') + (childLabels.length > 2 ? ' 等' : '');
}

/**
 * Recursively build a semantic tree from leaf nodes.
 * Dual strategy: >15 items → embedding clustering; ≤15 items → LLM classification.
 */
async function buildSemanticTree(leafNodes, topic, slugSet, options = {}) {
  function ensureUniqueSlug(slug) {
    let final = slug;
    let counter = 2;
    while (slugSet.has(final)) { final = `${slug}-${counter}`; counter++; }
    slugSet.add(final);
    return final;
  }

  // Base case: few enough to be direct children of root
  if (leafNodes.length <= MAX_GROUP_SIZE) {
    return {
      page_slug: ensureUniqueSlug(`root-${topic}`),
      kind: 'root',
      label: topic,
      children: leafNodes,
    };
  }

  let intermediates;

  if (leafNodes.length <= LLM_CLASSIFY_THRESHOLD) {
    // ≤15 items: LLM does classification + naming + assessment
    console.log(`[Stage 3] Using LLM classify for ${leafNodes.length} items (≤${LLM_CLASSIFY_THRESHOLD})`);
    const llmResult = await llmClassifyAndName(leafNodes, topic);

    if (llmResult && llmResult.length > 0) {
      const usedLabels = new Set();
      intermediates = llmResult.map((g, gi) => {
        let label = g.name;
        if (usedLabels.has(label)) {
          const childHints = g.items.slice(0, 2).map(it => it.label).join('·');
          label = `${label}（${childHints}）`;
          console.log(`[Stage 3] Dedup label: "${g.name}" → "${label}"`);
        }
        usedLabels.add(label);
        return {
          page_slug: ensureUniqueSlug(generateSlug('section', label, gi)),
          kind: 'intermediate',
          label,
          atoms: [],
          children: g.items,
          embedding: computeCentroid(g.items.filter(it => it.embedding).map(it => it.embedding)),
        };
      });
    }
  }

  if (!intermediates) {
    // >15 items OR LLM fallback: embedding-based greedy grouping
    console.log(`[Stage 3] Using embedding grouping for ${leafNodes.length} items`);
    const groups = semanticGroup(leafNodes);

    intermediates = [];
    const orphans = [];
    const usedGroupLabels = new Set();
    for (let gi = 0; gi < groups.length; gi++) {
      const group = groups[gi];

      if (group.length === 1) {
        orphans.push(group[0]);
        continue;
      }

      const childLabels = group.map(n => n.label);
      let label = await generateGroupLabel(childLabels, { ...options, parentLabel: topic });

      if (usedGroupLabels.has(label)) {
        const childHints = childLabels.slice(0, 2).join('·');
        const deduped = `${label}（${childHints}）`;
        console.log(`[Stage 3] Dedup group label: "${label}" → "${deduped}"`);
        label = deduped;
      }
      usedGroupLabels.add(label);

      const slug = ensureUniqueSlug(generateSlug('section', label, gi));

      intermediates.push({
        page_slug: slug,
        kind: 'intermediate',
        label,
        atoms: [],
        children: group,
        embedding: computeCentroid(group.map(n => n.embedding)),
      });
    }

    // Anti-usurpation: absorb orphan leaves into nearest section
    if (orphans.length > 0 && intermediates.length > 0) {
      for (const orphan of orphans) {
        let bestIdx = 0, bestSim = -Infinity;
        for (let i = 0; i < intermediates.length; i++) {
          const sim = cosineSimilarity(orphan.embedding, intermediates[i].embedding);
          if (sim > bestSim) { bestSim = sim; bestIdx = i; }
        }
        intermediates[bestIdx].children.push(orphan);
        intermediates[bestIdx].embedding = computeCentroid(
          intermediates[bestIdx].children.map(c => c.embedding)
        );
        console.log(`[Stage 3] Anti-usurp: "${orphan.label}" → absorbed into "${intermediates[bestIdx].label}"`);
      }
    } else if (orphans.length > 0) {
      intermediates.push(...orphans);
    }
  }

  // Recursively group intermediates if still too many
  if (intermediates.length > MAX_GROUP_SIZE) {
    return buildSemanticTree(intermediates, topic, slugSet, options);
  }

  return {
    page_slug: ensureUniqueSlug(`root-${topic}`),
    kind: 'root',
    label: topic,
    children: intermediates,
  };
}

/**
 * LLM-based tree hierarchy audit.
 * Detects "usurpation" — leaf nodes placed at a level they don't belong to.
 * Returns a corrected tree.
 */
async function auditTreeHierarchy(tree, topic) {
  function treeToOutline(node, depth = 0) {
    const prefix = '  '.repeat(depth);
    const kindTag = node.kind === 'root' ? '[ROOT]' :
                    node.kind === 'intermediate' ? '[SECTION]' : '[LEAF]';
    let lines = [`${prefix}${kindTag} ${node.label} (${node.page_slug})`];
    for (const child of (node.children || [])) {
      lines.push(...treeToOutline(child, depth + 1));
    }
    return lines;
  }

  const outline = treeToOutline(tree).join('\n');

  try {
    const response = await chatCompletion({
      messages: [{
        role: 'user',
        content: `你是知识体系架构审核员。下面是一棵自动生成的知识树，主题是「${topic}」。

${outline}

请审核此树结构是否存在**僭越**问题：
- 僭越 = 一个具体知识点（LEAF）出现在它不应有的高层级，与更大的概念分类（SECTION）平级
- 正确的层级关系：具体知识点应该是某个分类的子节点，而不是与分类平级
- 例如：「第一盲速」不应该和「雷达技术基础」平级，它应该归属于某个信号处理或测速相关的 SECTION 下

如果发现僭越，请输出 JSON 数组，每个元素是一个修正操作：
[{"move": "要移动的leaf的page_slug", "to": "目标section的page_slug"}]

如果层级合理无需修改，输出空数组 []

只输出 JSON，不要解释。`,
      }],
      temperature: 0,
      max_tokens: 2000,
    });

    const raw = response?.choices?.[0]?.message?.content?.trim() || '[]';
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return tree;

    const moves = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(moves) || moves.length === 0) {
      console.log('[Stage 3] Tree audit: hierarchy OK, no usurpation detected.');
      return tree;
    }

    function findNodeAndRemove(parent, slug) {
      if (!parent.children) return null;
      const idx = parent.children.findIndex(c => c.page_slug === slug);
      if (idx >= 0) return parent.children.splice(idx, 1)[0];
      for (const child of parent.children) {
        const found = findNodeAndRemove(child, slug);
        if (found) return found;
      }
      return null;
    }

    function findNode(node, slug) {
      if (node.page_slug === slug) return node;
      for (const child of (node.children || [])) {
        const found = findNode(child, slug);
        if (found) return found;
      }
      return null;
    }

    for (const { move, to } of moves) {
      if (!move || !to) continue;
      const node = findNodeAndRemove(tree, move);
      if (!node) { console.warn(`[Stage 3] Audit: cannot find "${move}" to move`); continue; }
      const target = findNode(tree, to);
      if (!target) { console.warn(`[Stage 3] Audit: target "${to}" not found`); continue; }
      if (!target.children) target.children = [];
      target.children.push(node);
      console.log(`[Stage 3] Audit fix: moved "${node.label}" → "${target.label}"`);
    }

    return tree;
  } catch (e) {
    console.warn(`[Stage 3] Tree audit LLM call failed: ${e.message} — skipping audit.`);
    return tree;
  }
}

/**
 * Strip embedding vectors from tree before writing (they're large).
 */
function stripEmbeddings(node) {
  const { embedding, ...rest } = node;
  if (rest.children) {
    rest.children = rest.children.map(stripEmbeddings);
  }
  return rest;
}

/**
 * Micro-merge: merge tiny clusters (< MIN_ATOMS_PER_CLUSTER atoms) into their
 * nearest neighbor by embedding similarity. Prevents "dust" one-atom pages.
 */
const MIN_ATOMS_PER_CLUSTER = 3;

function microMerge(clusters, atoms) {
  if (clusters.length <= 1) return clusters;

  const big = [];
  const tiny = [];
  for (const c of clusters) {
    if (c.atom_ids.length < MIN_ATOMS_PER_CLUSTER) {
      tiny.push(c);
    } else {
      big.push(c);
    }
  }

  if (tiny.length === 0 || big.length === 0) return clusters;

  console.log(`[Stage 3] Micro-merge: ${tiny.length} tiny clusters (< ${MIN_ATOMS_PER_CLUSTER} atoms) → merging into nearest big cluster`);

  function clusterCentroid(cluster) {
    const clusterAtoms = cluster.atom_ids
      .map(id => atoms[id])
      .filter(Boolean);
    if (clusterAtoms.length === 0) return null;
    const tags = clusterAtoms.map(a => (a.draft_tags || []).join(' ') + ' ' + a.claim).join(' ');
    return tags;
  }

  for (const t of tiny) {
    let bestIdx = 0;
    let bestOverlap = -1;

    const tinyTags = new Set();
    for (const id of t.atom_ids) {
      const a = atoms[id];
      if (a) (a.draft_tags || []).forEach(tag => tinyTags.add(tag));
    }

    for (let i = 0; i < big.length; i++) {
      const bigTags = new Set();
      for (const id of big[i].atom_ids) {
        const a = atoms[id];
        if (a) (a.draft_tags || []).forEach(tag => bigTags.add(tag));
      }
      let overlap = 0;
      for (const tag of tinyTags) {
        if (bigTags.has(tag)) overlap++;
      }
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestIdx = i;
      }
    }

    big[bestIdx].atom_ids.push(...t.atom_ids);
    console.log(`[Stage 3]   merged "${t.label}" (${t.atom_ids.length} atoms) → "${big[bestIdx].label}"`);
  }

  return big;
}

async function run(clustersPath, atomsDir, outputDir, topic, options = {}) {
  console.log(`[Stage 3] Tree Construct (Semantic): ${topic}`);

  let clusters = JSON.parse(fs.readFileSync(clustersPath, 'utf-8'));
  const atoms = loadAtoms(atomsDir);
  const slugSet = new Set();

  // Micro-merge tiny clusters before tree building
  clusters = microMerge(clusters, atoms);

  if (clusters.length === 0) {
    console.log('[Stage 3] No clusters, creating empty tree.');
    const tree = { page_slug: `root-${topic}`, kind: 'root', label: topic, children: [] };
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'tree.json'), JSON.stringify(tree, null, 2), 'utf-8');
    return tree;
  }

  // Build leaf nodes with labels and embeddings
  console.log(`[Stage 3] Embedding ${clusters.length} cluster labels...`);
  const clusterLabels = clusters.map((cluster, i) => {
    const clusterAtoms = cluster.atom_ids.map(id => atoms[id]).filter(Boolean);
    if (clusterAtoms.length > 0) {
      return clusterAtoms[0].draft_tags?.[0] || clusterAtoms[0].claim.slice(0, 20);
    }
    return `cluster-${i}`;
  });

  let embeddings;
  try {
    embeddings = await getEmbeddings(clusterLabels);
  } catch (e) {
    console.warn(`[Stage 3] Embedding failed (${e.message}), falling back to sequential grouping`);
    embeddings = clusterLabels.map(() => [0]);
  }

  function ensureUniqueSlug(slug) {
    let final = slug;
    let counter = 2;
    while (slugSet.has(final)) { final = `${slug}-${counter}`; counter++; }
    slugSet.add(final);
    return final;
  }

  const leafNodes = clusters.map((cluster, i) => ({
    page_slug: ensureUniqueSlug(generateSlug('concept', clusterLabels[i], i)),
    kind: 'leaf-cluster',
    label: clusterLabels[i],
    atoms: cluster.atom_ids,
    children: [],
    embedding: embeddings[i],
  }));

  // Build tree recursively
  const tree = await buildSemanticTree(leafNodes, topic, slugSet, {
    useLlmLabels: options.useLlmLabels ?? true,
  });
  let cleanTree = stripEmbeddings(tree);

  // LLM Tree Audit: check hierarchy for usurpation
  cleanTree = await auditTreeHierarchy(cleanTree, topic);

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'tree.json'), JSON.stringify(cleanTree, null, 2), 'utf-8');

  recordDecision(outputDir, topic, {
    stage: 'stage-3',
    name: 'tree construct',
    chosen: `recursive semantic grouping (target=${TARGET_GROUP_SIZE}, range=${MIN_GROUP_SIZE}-${MAX_GROUP_SIZE})`,
    rationale: `从 ${clusters.length} 个 cluster 用 embedding 余弦相似度递归分组。每组 ${MIN_GROUP_SIZE}-${MAX_GROUP_SIZE} 个子节点，LLM 为分组生成概括性标签。`,
    known_limits: ['embedding 质量直接影响分组合理性', '贪心合并非全局最优'],
    switch_conditions: ['集成 HDBSCAN condensed_tree_ 做层级聚类'],
  });

  function countNodes(n) { return 1 + (n.children || []).reduce((s, c) => s + countNodes(c), 0); }
  function treeDepth(n) { return 1 + Math.max(0, ...(n.children || []).map(treeDepth)); }
  console.log(`[Stage 3] ✅ Tree: ${countNodes(cleanTree)} nodes, depth ${treeDepth(cleanTree)}`);
  return cleanTree;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length < 4) {
    console.error('Usage: node stage3-tree-construct.js <clusters.json> <atoms-dir> <output-dir> <topic>');
    process.exit(2);
  }
  run(args[0], args[1], args[2], args[3]).catch(e => {
    console.error('[Stage 3] Fatal:', e.message);
    process.exit(1);
  });
}

module.exports = { run, buildSemanticTree, semanticGroup };
