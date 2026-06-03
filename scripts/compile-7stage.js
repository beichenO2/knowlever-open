#!/usr/bin/env node
/**
 * KnowLever Open — 7-Stage Pipeline
 *
 * 全量编译管线：ingest → crystallize → embed+cluster → tree → compose → validate → site → pdf
 *
 * 用法：
 *   node scripts/compile-7stage.js [--topic <name>] [--skip-embed] [--skip-pdf]
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const config = require('../config.json');
const { ROOT, resolveTopic, knowLeverRoot, ensureTopicDirs } = require('../lib/paths');

function parseArgs() {
  const args = process.argv.slice(2);
  let topic = config.default_topic;
  let skipEmbed = false;
  let skipPdf = false;
  let skipSite = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--topic' && args[i + 1]) topic = args[++i];
    else if (args[i] === '--skip-embed') skipEmbed = true;
    else if (args[i] === '--skip-pdf') skipPdf = true;
    else if (args[i] === '--skip-site') skipSite = true;
  }
  return { topic, skipEmbed, skipPdf, skipSite };
}

function runNode(script, args, label) {
  const scriptPath = path.resolve(ROOT, script);
  if (!fs.existsSync(scriptPath)) {
    console.error(`[pipeline] ❌ missing ${scriptPath}`);
    process.exit(1);
  }
  console.log(`\n[pipeline] === ${label} ===`);
  console.log(`[pipeline] node ${script} ${args.join(' ')}`);
  const r = spawnSync('node', [scriptPath, ...args], { stdio: 'inherit', cwd: ROOT });
  if (r.status !== 0) {
    console.error(`[pipeline] ❌ ${label} failed (exit ${r.status})`);
    process.exit(r.status ?? 1);
  }
}

function runPython(script, args, label) {
  const scriptPath = path.resolve(ROOT, script);
  if (!fs.existsSync(scriptPath)) {
    console.error(`[pipeline] ❌ missing ${scriptPath}`);
    process.exit(1);
  }
  console.log(`\n[pipeline] === ${label} ===`);
  console.log(`[pipeline] python3 ${script} ${args.join(' ')}`);
  const r = spawnSync('python3', [scriptPath, ...args], { stdio: 'inherit', cwd: ROOT });
  if (r.status !== 0) {
    console.error(`[pipeline] ❌ ${label} failed (exit ${r.status})`);
    process.exit(r.status ?? 1);
  }
}

const { topic, skipEmbed, skipPdf, skipSite } = parseArgs();
const t = ensureTopicDirs(topic);

console.log(`[pipeline] 🚀 7-Stage Pipeline for topic: ${topic}`);
console.log(`[pipeline] Data dir: ${t.topicDir}`);

// Ensure normalized dir has content (from ingest or previous compile)
const normalizedDir = t.normalizedDir;
const outputDir = t.outputDir;
fs.mkdirSync(outputDir, { recursive: true });

// Step 0: Ingest (if raw/ has files and normalized/ is empty)
const rawDir = t.rawDir;
const examplesRaw = path.join(ROOT, 'examples', topic, 'raw');
const ingestInput = fs.existsSync(rawDir) && fs.readdirSync(rawDir).some(f => !f.startsWith('.'))
  ? rawDir
  : examplesRaw;

if (fs.existsSync(ingestInput)) {
  const normalizedFiles = fs.existsSync(normalizedDir) ? fs.readdirSync(normalizedDir) : [];
  if (normalizedFiles.filter(f => !f.startsWith('.')).length === 0) {
    // Use KnowLever engine ingest if available
    const engineRoot = knowLeverRoot();
    const ingestScript = path.join(engineRoot, 'wiki-engine/ingest.js');
    if (fs.existsSync(ingestScript)) {
      console.log(`\n[pipeline] === Ingest ===`);
      const r = spawnSync('node', [ingestScript, ingestInput, '--topic', topic, '--user', 'open', '--recursive'], {
        stdio: 'inherit', cwd: engineRoot,
      });
      if (r.status !== 0) {
        console.error('[pipeline] ❌ Ingest failed');
        process.exit(1);
      }
      // Copy normalized output back
      const engineNorm = path.join(engineRoot, 'data/users/open/topics', topic, 'normalized');
      if (fs.existsSync(engineNorm)) {
        fs.cpSync(engineNorm, normalizedDir, { recursive: true, force: true });
      }
    } else {
      console.log('[pipeline] KnowLever engine ingest not available, using raw as normalized');
      fs.mkdirSync(normalizedDir, { recursive: true });
      for (const f of fs.readdirSync(ingestInput)) {
        if (f.endsWith('.md') || f.endsWith('.txt')) {
          const srcSlug = f.replace(/\.[^.]+$/, '');
          const srcDir = path.join(normalizedDir, srcSlug);
          fs.mkdirSync(srcDir, { recursive: true });
          fs.copyFileSync(path.join(ingestInput, f), path.join(srcDir, 'content.md'));
        }
      }
    }
  }
}

// Verify normalized content exists
const sources = fs.existsSync(normalizedDir)
  ? fs.readdirSync(normalizedDir).filter(f => {
    const stat = fs.statSync(path.join(normalizedDir, f));
    return stat.isDirectory() && !f.startsWith('.');
  })
  : [];

if (sources.length === 0) {
  console.error('[pipeline] ❌ No normalized sources found. Run ingest first or place .md files in raw/');
  process.exit(1);
}

console.log(`[pipeline] Found ${sources.length} normalized sources`);

// Stage 1: Crystallize
for (const sourceId of sources) {
  const contentPath = path.join(normalizedDir, sourceId, 'content.md');
  if (!fs.existsSync(contentPath)) continue;
  runNode('lib/wiki-engine/stage1-crystallize.js', [sourceId, contentPath, outputDir, topic], `Stage 1: ${sourceId}`);
}

// Stage 2: Embed + Cluster
const atomsDir = path.join(outputDir, 'atoms');
if (!skipEmbed) {
  runPython('lib/wiki-engine/stage2-embed-cluster.py', [atomsDir, outputDir, topic], 'Stage 2: Embed + Cluster');
} else {
  console.log('\n[pipeline] ⏭️ Skipping Stage 2 (--skip-embed)');
  if (!fs.existsSync(path.join(outputDir, 'clusters.json'))) {
    // Fallback: one cluster per source
    const allAtomFiles = fs.existsSync(atomsDir) ? fs.readdirSync(atomsDir).filter(f => f.endsWith('.json')) : [];
    const clusters = allAtomFiles.map((f, i) => {
      const atoms = JSON.parse(fs.readFileSync(path.join(atomsDir, f), 'utf-8'));
      return { label: `cluster-${i}`, atom_ids: atoms.map(a => a.id) };
    });
    fs.writeFileSync(path.join(outputDir, 'clusters.json'), JSON.stringify(clusters, null, 2), 'utf-8');
  }
}

// Stage 3: Tree Construct
const clustersPath = path.join(outputDir, 'clusters.json');
runNode('lib/wiki-engine/stage3-tree-construct.js', [clustersPath, atomsDir, outputDir, topic], 'Stage 3: Tree Construct');

// Stage 4: Page Compose
const treePath = path.join(outputDir, 'tree.json');
runNode('lib/wiki-engine/stage4-page-compose.js', [treePath, atomsDir, outputDir, topic], 'Stage 4: Page Compose');

// Stage 5: Link Validate
const wikiDir = path.join(outputDir, 'wiki');
runNode('lib/wiki-engine/stage5-link-validate.js', [wikiDir, treePath, outputDir], 'Stage 5: Link Validate');

// Check Stage 5 result
const linkReport = path.join(outputDir, 'link-report.json');
if (fs.existsSync(linkReport)) {
  const report = JSON.parse(fs.readFileSync(linkReport, 'utf-8'));
  if (report.errors?.length > 0) {
    console.error(`\n[pipeline] ⚠️ Stage 5 found ${report.errors.length} link errors.`);
    console.error('[pipeline] Proceeding to Stage 6/7 anyway (non-blocking in open version).');
  }
}

// Stage 6: Site Build
if (!skipSite) {
  runNode('lib/wiki-engine/stage6-site-build.js', [wikiDir, treePath, outputDir, topic], 'Stage 6: Site Build');
} else {
  console.log('\n[pipeline] ⏭️ Skipping Stage 6 (--skip-site)');
}

// Stage 7: PDF Compose
if (!skipPdf) {
  runNode('lib/wiki-engine/stage7-pdf-compose.js', [wikiDir, treePath, outputDir, topic], 'Stage 7: PDF Compose');
} else {
  console.log('\n[pipeline] ⏭️ Skipping Stage 7 (--skip-pdf)');
}

console.log(`\n[pipeline] ✅ 7-Stage Pipeline complete!`);
console.log(`[pipeline] Wiki:  ${wikiDir}`);
if (!skipSite) console.log(`[pipeline] Site:  ${path.join(outputDir, 'site')}`);
if (!skipPdf) console.log(`[pipeline] PDF:   ${path.join(outputDir, 'pdf')}`);
