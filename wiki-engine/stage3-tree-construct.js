/**
 * Stage 3 — Tree Construct (Recursive Semantic Grouping)
 *
 * 从 clusters.json + atoms 构建 tree.json。
 *
 * 核心算法：递归语义聚类
 *   - 每组 3-5 个子节点（TARGET_GROUP_SIZE = 4）
 *   - 用 embedding centroid 的余弦相似度决定哪些簇/节点放在一起
 *   - LLM 为每个分组生成概括性标签
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
 * Generate a group label using LLM (or fallback to tag-based).
 */
async function generateGroupLabel(childLabels, options = {}) {
  if (!options.useLlmLabels) {
    // Fallback: use most common words from child labels
    return childLabels.slice(0, 2).join('、') + (childLabels.length > 2 ? ' 等' : '');
  }

  try {
    const response = await chatCompletion({
      messages: [{
        role: 'user',
        content: `以下是一组相关知识概念的标题：\n${childLabels.map(l => `- ${l}`).join('\n')}\n\n请用一个 ≤ 10 字的中文短语概括它们的共同主题。只输出短语，不要解释。`,
      }],
      temperature: 0.1,
      max_tokens: 20000,
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

  // Group leaves by semantic similarity
  const groups = semanticGroup(leafNodes);

  // Build intermediate nodes for each group
  const intermediates = [];
  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi];

    if (group.length === 1) {
      intermediates.push(group[0]);
      continue;
    }

    const childLabels = group.map(n => n.label);
    const label = await generateGroupLabel(childLabels, options);
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
  const cleanTree = stripEmbeddings(tree);

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
