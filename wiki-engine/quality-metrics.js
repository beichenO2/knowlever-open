#!/usr/bin/env node
/**
 * KnowLever Compile Quality Metrics (C02)
 * 
 * Scans wiki/ pages, extracts frontmatter, and produces aggregate quality metrics.
 * 
 * Usage:
 *   node wiki-engine/quality-metrics.js --topic <name> [--user admin] [--json] [--fix-missing]
 */
const fs = require('fs');
const path = require('path');
const { resolveTopic } = require('../lib/paths');

function parseArgs(args = process.argv.slice(2)) {
  let topic = null, user = 'admin', json = false, fixMissing = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--topic' || a === '-t') topic = args[++i];
    else if (a === '--user' || a === '-u') user = args[++i];
    else if (a === '--json') json = true;
    else if (a === '--fix-missing') fixMissing = true;
  }
  if (!topic) { console.error('Usage: quality-metrics.js --topic <name>'); process.exit(1); }
  return { topic, user, json, fixMissing };
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const meta = {};
  for (const line of match[1].split('\n')) {
    const m = line.match(/^(\w[\w_-]*)\s*:\s*(.+)/);
    if (m) {
      let val = m[2].trim();
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      if (/^\d+(\.\d+)?$/.test(val)) val = parseFloat(val);
      meta[m[1]] = val;
    }
  }
  return meta;
}

function computeMetrics(wikiDir) {
  if (!fs.existsSync(wikiDir)) return null;

  const files = fs.readdirSync(wikiDir).filter(f => f.endsWith('.md'));
  const pages = [];

  for (const file of files) {
    const content = fs.readFileSync(path.join(wikiDir, file), 'utf-8');
    const meta = parseFrontmatter(content);
    const bodyStart = content.indexOf('---', 4);
    const body = bodyStart > 0 ? content.slice(content.indexOf('\n', bodyStart) + 1) : content;

    pages.push({
      file,
      meta: meta || {},
      bodyLength: body.length,
      wordCount: body.split(/\s+/).filter(Boolean).length,
      wikiLinks: (body.match(/\[\[[^\]]+\]\]/g) || []).length,
      headings: (body.match(/^#{1,6}\s+/gm) || []).length,
      hasConfidence: meta && typeof meta.confidence === 'number',
      hasSummary: meta && typeof meta.summary === 'string' && meta.summary.length > 0,
      hasType: meta && typeof meta.type === 'string',
      hasParent: meta && (meta.parent_concept || meta.parent_ids),
    });
  }

  const totalPages = pages.length;
  if (totalPages === 0) return { totalPages: 0, error: 'No wiki pages found' };

  const withConfidence = pages.filter(p => p.hasConfidence);
  const confidences = withConfidence.map(p => p.meta.confidence);
  const avgConfidence = confidences.length > 0
    ? confidences.reduce((a, b) => a + b, 0) / confidences.length
    : 0;

  const byType = {};
  for (const p of pages) {
    const t = p.meta.type || 'unknown';
    byType[t] = (byType[t] || 0) + 1;
  }

  const shortPages = pages.filter(p => p.bodyLength < 200);
  const longPages = pages.filter(p => p.bodyLength > 20000);
  const noLinks = pages.filter(p => p.wikiLinks === 0);
  const noSummary = pages.filter(p => !p.hasSummary);
  const noConfidence = pages.filter(p => !p.hasConfidence);
  const noParent = pages.filter(p => !p.hasParent);

  const totalLinks = pages.reduce((s, p) => s + p.wikiLinks, 0);
  const totalWords = pages.reduce((s, p) => s + p.wordCount, 0);

  const completeness = {
    confidence: withConfidence.length / totalPages,
    summary: pages.filter(p => p.hasSummary).length / totalPages,
    type: pages.filter(p => p.hasType).length / totalPages,
    parent: pages.filter(p => p.hasParent).length / totalPages,
    links: pages.filter(p => p.wikiLinks > 0).length / totalPages,
  };

  const overallScore = (
    completeness.confidence * 0.2 +
    completeness.summary * 0.2 +
    completeness.type * 0.15 +
    completeness.parent * 0.15 +
    completeness.links * 0.15 +
    Math.min(avgConfidence, 1.0) * 0.15
  );

  const grade =
    overallScore >= 0.9 ? 'A' :
    overallScore >= 0.8 ? 'B' :
    overallScore >= 0.7 ? 'C' :
    overallScore >= 0.5 ? 'D' : 'F';

  return {
    totalPages,
    totalWords,
    totalWikiLinks: totalLinks,
    avgWordsPerPage: Math.round(totalWords / totalPages),
    avgLinksPerPage: (totalLinks / totalPages).toFixed(1),
    avgConfidence: avgConfidence.toFixed(3),
    byType,
    completeness: Object.fromEntries(
      Object.entries(completeness).map(([k, v]) => [k, `${(v * 100).toFixed(1)}%`])
    ),
    issues: {
      shortPages: shortPages.length,
      longPages: longPages.length,
      noLinks: noLinks.length,
      noSummary: noSummary.length,
      noConfidence: noConfidence.length,
      noParent: noParent.length,
    },
    overallScore: overallScore.toFixed(3),
    grade,
    issueFiles: {
      shortPages: shortPages.slice(0, 5).map(p => p.file),
      noLinks: noLinks.slice(0, 5).map(p => p.file),
      noSummary: noSummary.slice(0, 5).map(p => p.file),
      noConfidence: noConfidence.slice(0, 5).map(p => p.file),
    },
  };
}

function main() {
  const { topic, user, json, fixMissing } = parseArgs();
  const resolved = resolveTopic(topic, user);
  const wikiDir = resolved.wikiDir;

  const metrics = computeMetrics(wikiDir);
  if (!metrics) {
    console.error(`No wiki directory found: ${wikiDir}`);
    process.exit(1);
  }

  if (json) {
    console.log(JSON.stringify(metrics, null, 2));
    return;
  }

  console.log(`\n╔══════════════════════════════════════════════════╗`);
  console.log(`║  KnowLever Compile Quality Report               ║`);
  console.log(`║  Topic: ${topic.padEnd(40)}║`);
  console.log(`╚══════════════════════════════════════════════════╝\n`);

  console.log(`Grade: ${metrics.grade} (score: ${metrics.overallScore})\n`);

  console.log(`Overview:`);
  console.log(`  Pages: ${metrics.totalPages}`);
  console.log(`  Words: ${metrics.totalWords.toLocaleString()}`);
  console.log(`  Wiki Links: ${metrics.totalWikiLinks}`);
  console.log(`  Avg words/page: ${metrics.avgWordsPerPage}`);
  console.log(`  Avg links/page: ${metrics.avgLinksPerPage}`);
  console.log(`  Avg confidence: ${metrics.avgConfidence}\n`);

  console.log(`Page types:`);
  for (const [type, count] of Object.entries(metrics.byType)) {
    console.log(`  ${type}: ${count}`);
  }

  console.log(`\nCompleteness:`);
  for (const [field, pct] of Object.entries(metrics.completeness)) {
    console.log(`  ${field}: ${pct}`);
  }

  console.log(`\nIssues:`);
  for (const [issue, count] of Object.entries(metrics.issues)) {
    if (count > 0) console.log(`  ⚠ ${issue}: ${count}`);
  }

  if (fixMissing) {
    console.log(`\n--fix-missing not yet implemented.`);
  }
}

module.exports = { computeMetrics, parseFrontmatter };
main();
