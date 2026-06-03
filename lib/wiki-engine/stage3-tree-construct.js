/**
 * Stage 3 — Tree Construct
 *
 * 从 clusters.json 构建 tree.json。Slug 在此唯一发放。
 *
 * 输入：clusters.json + atoms/*.json
 * 输出：tree.json
 *
 * 纯确定性——不调 LLM。
 */

const fs = require('fs');
const path = require('path');
const { recordDecision } = require('./tech-decisions');

const MAX_CHILDREN = 7;

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

function buildTree(clusters, atoms, topic) {
  const slugSet = new Set();

  function ensureUniqueSlug(slug) {
    let final = slug;
    let counter = 2;
    while (slugSet.has(final)) {
      final = `${slug}-${counter}`;
      counter++;
    }
    slugSet.add(final);
    return final;
  }

  const leafNodes = [];
  for (let i = 0; i < clusters.length; i++) {
    const cluster = clusters[i];
    const clusterAtoms = cluster.atom_ids.map(id => atoms[id]).filter(Boolean);
    const label = clusterAtoms.length > 0
      ? (clusterAtoms[0].draft_tags?.[0] || clusterAtoms[0].claim.slice(0, 20))
      : `cluster-${i}`;
    const slug = ensureUniqueSlug(generateSlug('concept', label, i));

    leafNodes.push({
      page_slug: slug,
      kind: 'leaf-cluster',
      label,
      atoms: cluster.atom_ids,
      children: [],
    });
  }

  if (leafNodes.length <= MAX_CHILDREN) {
    return {
      page_slug: ensureUniqueSlug(`root-${topic}`),
      kind: 'root',
      label: topic,
      children: leafNodes,
    };
  }

  const groups = [];
  for (let i = 0; i < leafNodes.length; i += MAX_CHILDREN) {
    groups.push(leafNodes.slice(i, i + MAX_CHILDREN));
  }

  const intermediates = groups.map((group, gi) => {
    const label = group[0]?.label || `group-${gi}`;
    return {
      page_slug: ensureUniqueSlug(generateSlug('section', label, gi)),
      kind: 'intermediate',
      label: `${label} 等 ${group.length} 个概念`,
      children: group,
    };
  });

  if (intermediates.length <= MAX_CHILDREN) {
    return {
      page_slug: ensureUniqueSlug(`root-${topic}`),
      kind: 'root',
      label: topic,
      children: intermediates,
    };
  }

  return buildTreeRecursive(intermediates, topic, slugSet);
}

function buildTreeRecursive(nodes, topic, slugSet) {
  if (nodes.length <= MAX_CHILDREN) {
    let rootSlug = `root-${topic}`;
    let counter = 2;
    while (slugSet.has(rootSlug)) { rootSlug = `root-${topic}-${counter++}`; }
    slugSet.add(rootSlug);
    return { page_slug: rootSlug, kind: 'root', label: topic, children: nodes };
  }

  const groups = [];
  for (let i = 0; i < nodes.length; i += MAX_CHILDREN) {
    groups.push(nodes.slice(i, i + MAX_CHILDREN));
  }

  const intermediates = groups.map((group, gi) => {
    let slug = `section-${topic}-l${gi}`;
    let c = 2;
    while (slugSet.has(slug)) { slug = `section-${topic}-l${gi}-${c++}`; }
    slugSet.add(slug);
    return { page_slug: slug, kind: 'intermediate', label: `Section ${gi + 1}`, children: group };
  });

  return buildTreeRecursive(intermediates, topic, slugSet);
}

function run(clustersPath, atomsDir, outputDir, topic) {
  console.log(`[Stage 3] Tree Construct: ${topic}`);

  const clusters = JSON.parse(fs.readFileSync(clustersPath, 'utf-8'));
  const atoms = loadAtoms(atomsDir);

  if (clusters.length === 0) {
    console.log('[Stage 3] No clusters, creating empty tree.');
    const tree = { page_slug: `root-${topic}`, kind: 'root', label: topic, children: [] };
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'tree.json'), JSON.stringify(tree, null, 2), 'utf-8');
    return tree;
  }

  const tree = buildTree(clusters, atoms, topic);

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'tree.json'), JSON.stringify(tree, null, 2), 'utf-8');

  recordDecision(outputDir, topic, {
    stage: 'stage-3',
    name: 'tree construct',
    chosen: `deterministic (MAX_CHILDREN=${MAX_CHILDREN})`,
    rationale: `从 ${clusters.length} 个 cluster 构建语义树，slug 唯一发放，超过 ${MAX_CHILDREN} 子节点时递归分层。`,
    known_limits: ['基于顺序分组而非语义相似度，层级标签可能不够精确'],
    switch_conditions: ['LLM 审核层级时纠正分组（当前未启用）'],
  });

  function countNodes(n) { return 1 + (n.children || []).reduce((s, c) => s + countNodes(c), 0); }
  console.log(`[Stage 3] ✅ Tree built: ${countNodes(tree)} nodes`);
  return tree;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length < 4) {
    console.error('Usage: node stage3-tree-construct.js <clusters.json> <atoms-dir> <output-dir> <topic>');
    process.exit(2);
  }
  run(args[0], args[1], args[2], args[3]);
}

module.exports = { run, buildTree };
