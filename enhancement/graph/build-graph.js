#!/usr/bin/env node
/**
 * Layer 5B: Structural Graph Builder
 * 
 * Extracts wiki-link graph from wiki pages and builds:
 *   1. graph.json — Cytoscape-compatible node/edge data
 *   2. concepts.json — concept frequency map
 *   3. cross-refs.json — inter-page reference matrix
 * 
 * Usage:
 *   node enhancement/graph/build-graph.js --topic <name> [--user admin]
 */
const fs = require('fs');
const path = require('path');

function parseFrontmatter(content) {
  if (!content.startsWith('---')) return { meta: {}, body: content };
  const end = content.indexOf('---', 3);
  if (end === -1) return { meta: {}, body: content };
  const fmBlock = content.slice(3, end);
  const body = content.slice(end + 3).trim();
  const meta = {};
  for (const line of fmBlock.split('\n')) {
    const idx = line.indexOf(':');
    if (idx > 0) {
      const key = line.slice(0, idx).trim();
      let val = line.slice(idx + 1).trim();
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      meta[key] = val;
    }
  }
  return { meta, body };
}

function parseArgs(args = process.argv.slice(2)) {
  let topic = null;
  let user = 'admin';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--topic' || args[i] === '-t') topic = args[++i];
    else if (args[i] === '--user' || args[i] === '-u') user = args[++i];
  }
  return { topic, user };
}

function extractWikiLinks(body) {
  const links = [];
  const pattern = /\[\[([^\]]+)\]\]/g;
  let match;
  while ((match = pattern.exec(body)) !== null) {
    const target = match[1].trim().toLowerCase().replace(/\s+/g, '-');
    links.push(target);
  }
  return [...new Set(links)];
}

function extractTags(meta) {
  const raw = meta.tags || '';
  return raw.split(',').map(t => t.trim()).filter(Boolean);
}

function extractConcepts(body) {
  const concepts = [];
  const headingPattern = /^#{1,3}\s+(.+)$/gm;
  let match;
  while ((match = headingPattern.exec(body)) !== null) {
    const heading = match[1].trim();
    if (heading.length > 2 && heading.length < 80) {
      concepts.push(heading);
    }
  }
  return concepts;
}

function walkMd(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...walkMd(full));
    else if (entry.name.endsWith('.md')) results.push(full);
  }
  return results;
}

function buildGraph(wikiDir) {
  const files = walkMd(wikiDir);
  const nodes = [];
  const edges = [];
  const conceptFreq = {};
  const crossRefs = {};
  const pageMap = {};

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const { meta, body } = parseFrontmatter(content);
    const rel = path.relative(wikiDir, filePath).replace(/\.md$/, '').replace(/\//g, '--');
    const id = rel;
    const title = meta.title || id;
    const type = meta.type || 'concept';
    const tags = extractTags(meta);
    const wikiLinks = extractWikiLinks(body);
    const concepts = extractConcepts(body);

    pageMap[id] = { title, type, tags };

    nodes.push({
      data: {
        id,
        label: title,
        type,
        tags: tags.join(', '),
        degree: wikiLinks.length,
      },
    });

    for (const target of wikiLinks) {
      edges.push({
        data: {
          source: id,
          target,
          type: 'wiki-link',
        },
      });
    }

    crossRefs[id] = wikiLinks;

    for (const concept of concepts) {
      conceptFreq[concept] = (conceptFreq[concept] || 0) + 1;
    }
    for (const tag of tags) {
      conceptFreq[tag] = (conceptFreq[tag] || 0) + 1;
    }
  }

  const tagEdgeSet = new Set();
  for (const [tag, _count] of Object.entries(conceptFreq)) {
    const tagPages = Object.entries(pageMap)
      .filter(([_, p]) => p.tags.includes(tag))
      .map(([id]) => id);

    if (tagPages.length > 1) {
      for (let i = 0; i < tagPages.length - 1; i++) {
        for (let j = i + 1; j < tagPages.length; j++) {
          const edgeKey = `${tagPages[i]}|${tagPages[j]}|shared-tag`;
          if (!tagEdgeSet.has(edgeKey)) {
            tagEdgeSet.add(edgeKey);
            edges.push({
              data: {
                source: tagPages[i],
                target: tagPages[j],
                type: 'shared-tag',
                tag,
              },
            });
          }
        }
      }
    }
  }

  return {
    graph: { nodes, edges },
    concepts: conceptFreq,
    crossRefs,
    stats: {
      pages: nodes.length,
      wikiLinks: edges.filter(e => e.data.type === 'wiki-link').length,
      tagLinks: edges.filter(e => e.data.type === 'shared-tag').length,
      uniqueConcepts: Object.keys(conceptFreq).length,
    },
  };
}

function main() {
  const { topic, user } = parseArgs();

  if (!topic) {
    console.log('Usage: node enhancement/graph/build-graph.js --topic <name> [--user admin]');
    process.exit(0);
  }

  const ROOT = path.resolve(__dirname, '../..');
  const wikiDir = path.join(ROOT, 'data', 'users', user, 'topics', topic, 'wiki');
  const graphDir = path.join(ROOT, 'data', 'users', user, 'topics', topic, 'graph');

  if (!fs.existsSync(wikiDir)) {
    console.error(`[error] Wiki not found: ${wikiDir}`);
    process.exit(1);
  }

  console.log(`[graph] Topic: ${topic} (user: ${user})`);
  console.log(`[graph] Wiki: ${wikiDir}`);

  const { graph, concepts, crossRefs, stats } = buildGraph(wikiDir);

  fs.mkdirSync(graphDir, { recursive: true });

  fs.writeFileSync(
    path.join(graphDir, 'graph.json'),
    JSON.stringify(graph, null, 2) + '\n'
  );

  fs.writeFileSync(
    path.join(graphDir, 'concepts.json'),
    JSON.stringify(concepts, null, 2) + '\n'
  );

  fs.writeFileSync(
    path.join(graphDir, 'cross-refs.json'),
    JSON.stringify(crossRefs, null, 2) + '\n'
  );

  console.log(`[graph] Built: ${stats.pages} pages, ${stats.wikiLinks} wiki-links, ${stats.tagLinks} tag-links, ${stats.uniqueConcepts} concepts`);
  console.log(`[graph] Output: ${graphDir}`);
}

if (require.main === module) {
  main();
}

module.exports = { buildGraph, extractWikiLinks, extractTags, extractConcepts };
