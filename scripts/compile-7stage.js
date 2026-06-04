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
const { ROOT, resolveTopic, ensureTopicDirs } = require('../lib/paths');

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

if (fs.existsSync(rawDir) && fs.readdirSync(rawDir).some(f => !f.startsWith('.'))) {
  const normalizedFiles = fs.existsSync(normalizedDir) ? fs.readdirSync(normalizedDir).filter(f => !f.startsWith('.')) : [];
  if (normalizedFiles.length === 0) {
    console.log('[pipeline] KnowLever standalone ingest: raw/ → normalized/');
    fs.mkdirSync(normalizedDir, { recursive: true });

    const textExts = ['.md', '.txt'];
    const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
    const pdfExts = ['.pdf'];
    const vlmOcrPath = path.resolve(ROOT, 'lib/vlm-formula-ocr.js');
    const hasVlmOcr = fs.existsSync(vlmOcrPath);

    function isGarbled(text) {
      if (!text || text.trim().length < 20) return true;
      const totalChars = text.length;
      const replacementChars = (text.match(/[\ufffd]/g) || []).length;
      if (replacementChars / totalChars > 0.1) return true;
      const readable = text.match(/[\u4e00-\u9fff\u3400-\u4dbf\uf000-\uf8ff\u2460-\u24ff\u2000-\u206fa-zA-Z0-9\s.,;:!?()（）、。，；：""''！？【】《》〈〉〔〕…\-—·\n\r\t$\\{}[\]^_+=/<>|~@#%&*"'`°±×÷αβγδεζηθλμνπρστωΩΔΣ∫∂∞≥≤≠≈∈∉]/gu) || [];
      if (readable.length / totalChars < 0.5) return true;
      // PPT-style PDF: pdftotext preserves spatial layout with excessive whitespace
      const lines = text.split('\n');
      const spatialLines = lines.filter(l => (l.match(/  {3,}/g) || []).length >= 2);
      if (spatialLines.length / lines.length > 0.3) return true;
      // Formula garbling: high ratio of single-char "words" from broken math symbols
      const words = text.split(/\s+/).filter(w => w.length > 0);
      const singleChars = words.filter(w => w.length === 1 && !/[a-zA-Z0-9\u4e00-\u9fff，。！？、]/.test(w));
      if (words.length > 20 && singleChars.length / words.length > 0.15) return true;
      return false;
    }

    for (const f of fs.readdirSync(rawDir)) {
      if (f.startsWith('.')) continue;
      const ext = path.extname(f).toLowerCase();
      const srcSlug = f.replace(/\.[^.]+$/, '').replace(/\s+/g, '-');
      const srcDir = path.join(normalizedDir, srcSlug);

      if (textExts.includes(ext)) {
        fs.mkdirSync(srcDir, { recursive: true });
        fs.copyFileSync(path.join(rawDir, f), path.join(srcDir, 'content.md'));
      } else if (pdfExts.includes(ext)) {
        fs.mkdirSync(srcDir, { recursive: true });
        // Tier 1: Fast pdftotext extraction
        console.log(`[pipeline] pdftotext: ${f}`);
        const pdfResult = spawnSync('pdftotext', ['-layout', path.join(rawDir, f), '-'], {
          stdio: ['pipe', 'pipe', 'pipe'], timeout: 30_000,
        });
        const pdfText = pdfResult.stdout?.toString('utf-8') || '';

        if (!isGarbled(pdfText)) {
          fs.writeFileSync(path.join(srcDir, 'content.md'), pdfText);
          console.log(`[pipeline]   → ${srcSlug}/content.md (pdftotext, ${pdfText.length} chars)`);
        } else if (hasVlmOcr) {
          // Tier 2: VLM OCR for garbled/image-based pages
          console.log(`[pipeline]   ⚠️ pdftotext garbled, falling back to VLM OCR: ${f}`);
          const r = spawnSync('node', [vlmOcrPath, '--pdf', path.join(rawDir, f), '--out', srcDir], {
            cwd: ROOT, stdio: 'inherit', timeout: 300_000,
          });
          if (r.status === 0) {
            const mdFiles = fs.readdirSync(srcDir).filter(x => x.endsWith('.md'));
            if (mdFiles.length > 0 && mdFiles[0] !== 'content.md') {
              fs.renameSync(path.join(srcDir, mdFiles[0]), path.join(srcDir, 'content.md'));
            }
            console.log(`[pipeline]   → ${srcSlug}/content.md (VLM OCR)`);
          } else {
            console.warn(`[pipeline]   ❌ VLM OCR also failed for ${f}, skipping`);
            fs.rmdirSync(srcDir, { recursive: true });
          }
        } else {
          console.warn(`[pipeline]   ⚠️ ${f}: pdftotext garbled & no VLM available, skipping`);
        }
      } else if (imageExts.includes(ext) && hasVlmOcr) {
        console.log(`[pipeline] VLM OCR (image): ${f}`);
        fs.mkdirSync(srcDir, { recursive: true });
        const r = spawnSync('node', [vlmOcrPath, path.join(rawDir, f)], {
          cwd: ROOT, stdio: ['pipe', 'pipe', 'inherit'], timeout: 120_000,
        });
        if (r.status === 0 && r.stdout) {
          fs.writeFileSync(path.join(srcDir, 'content.md'), r.stdout.toString('utf-8'));
          console.log(`[pipeline]   → ${srcSlug}/content.md`);
        } else {
          console.warn(`[pipeline]   ⚠️ VLM OCR failed for ${f}, skipping`);
        }
      } else if (ext === '.docx') {
        // Try pandoc for docx
        console.log(`[pipeline] pandoc: ${f}`);
        const r = spawnSync('pandoc', [path.join(rawDir, f), '-t', 'markdown', '-o', path.join(srcDir, 'content.md')], {
          stdio: 'pipe', timeout: 30_000,
        });
        if (r.status === 0) {
          fs.mkdirSync(srcDir, { recursive: true });
          console.log(`[pipeline]   → ${srcSlug}/content.md (pandoc)`);
        } else {
          console.warn(`[pipeline]   ⚠️ pandoc failed for ${f}, skipping`);
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

// Step 0.5: Formula normalization (detect and fix bare math in content.md)
// Non-blocking: if LLM is unavailable, skip gracefully
{
  console.log(`\n[pipeline] === Formula Normalize ===`);
  const scriptPath = path.resolve(ROOT, 'lib/normalize-formulas.js');
  const r = spawnSync('node', [scriptPath, '--dir', normalizedDir, '--apply'], { stdio: 'inherit', cwd: ROOT });
  if (r.status !== 0) {
    console.warn('[pipeline] ⚠️ Formula normalization failed (non-blocking), continuing...');
  }
}

// Stage 0.5: Typed Normalize (classify content into explanations/summaries/problems)
runNode('wiki-engine/stage0_5-typed-normalize.js', ['--all', topic], 'Stage 0.5: Typed Normalize');

// Stage 1: Crystallize (from explanations + summaries, not raw content.md)
const expDir = path.join(normalizedDir, 'explanations');
const sumDir = path.join(normalizedDir, 'summaries');
const typedSources = [];
if (fs.existsSync(expDir)) {
  for (const f of fs.readdirSync(expDir).filter(x => x.endsWith('.raw.md'))) {
    typedSources.push({ id: f.replace('.explanations.raw.md', ''), path: path.join(expDir, f) });
  }
}
if (fs.existsSync(sumDir)) {
  for (const f of fs.readdirSync(sumDir).filter(x => x.endsWith('.raw.md'))) {
    const id = f.replace('.summaries.raw.md', '');
    if (!typedSources.find(s => s.id === id)) {
      typedSources.push({ id: id + '-summaries', path: path.join(sumDir, f) });
    }
  }
}

if (typedSources.length === 0) {
  console.warn('[pipeline] ⚠️ Stage 0.5 produced no typed sources. Falling back to raw content.md...');
  for (const sourceId of sources) {
    const contentPath = path.join(normalizedDir, sourceId, 'content.md');
    if (!fs.existsSync(contentPath)) continue;
    runNode('wiki-engine/stage1-crystallize.js', [sourceId, contentPath, outputDir, topic], `Stage 1: ${sourceId}`);
  }
} else {
  for (const { id, path: srcPath } of typedSources) {
    runNode('wiki-engine/stage1-crystallize.js', [id, srcPath, outputDir, topic], `Stage 1: ${id}`);
  }
}

// Stage 2: Embed + Cluster
const atomsDir = path.join(outputDir, 'atoms');
if (!skipEmbed) {
  runPython('wiki-engine/stage2-embed-cluster.py', [atomsDir, outputDir, topic], 'Stage 2: Embed + Cluster');
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
runNode('wiki-engine/stage3-tree-construct.js', [clustersPath, atomsDir, outputDir, topic], 'Stage 3: Tree Construct');

// Stage 4: Page Compose
const treePath = path.join(outputDir, 'tree.json');
runNode('wiki-engine/stage4-page-compose.js', [treePath, atomsDir, outputDir, topic], 'Stage 4: Page Compose');

// Stage 5: Link Validate (non-blocking — stub links are expected in open version)
const wikiDir = path.join(outputDir, 'wiki');
{
  const scriptPath = path.resolve(ROOT, 'wiki-engine/stage5-link-validate.js');
  console.log(`\n[pipeline] === Stage 5: Link Validate ===`);
  console.log(`[pipeline] node wiki-engine/stage5-link-validate.js ${wikiDir} ${treePath} ${outputDir}`);
  const r = spawnSync('node', [scriptPath, wikiDir, treePath, outputDir], { stdio: 'inherit', cwd: ROOT });
  const linkReport = path.join(outputDir, 'link-report.json');
  if (fs.existsSync(linkReport)) {
    const report = JSON.parse(fs.readFileSync(linkReport, 'utf-8'));
    if (report.errors?.length > 0) {
      console.warn(`\n[pipeline] ⚠️ Stage 5 found ${report.errors.length} stub-link errors (non-blocking in open version).`);
    }
    if (report.warnings?.length > 0) {
      console.warn(`[pipeline]   ${report.warnings.length} warnings.`);
    }
  }
  if (r.status !== 0) {
    console.warn(`[pipeline] Stage 5 exited ${r.status} — continuing (link errors are advisory).`);
  }
}

// Stage 4.5: Quiz Generate (after link validation, before site build)
runNode('wiki-engine/stage4_5-quiz-generate.js', [wikiDir, treePath, outputDir, topic], 'Stage 4.5: Quiz Generate');

// Stage 6: Site Build
if (!skipSite) {
  runNode('wiki-engine/stage6-site-build.js', [wikiDir, treePath, outputDir, topic], 'Stage 6: Site Build');
} else {
  console.log('\n[pipeline] ⏭️ Skipping Stage 6 (--skip-site)');
}

// Stage 7: PDF Compose
if (!skipPdf) {
  runNode('wiki-engine/stage7-pdf-compose.js', [wikiDir, treePath, outputDir, topic], 'Stage 7: PDF Compose');
} else {
  console.log('\n[pipeline] ⏭️ Skipping Stage 7 (--skip-pdf)');
}

console.log(`\n[pipeline] ✅ 7-Stage Pipeline complete!`);
console.log(`[pipeline] Wiki:  ${wikiDir}`);
if (!skipSite) console.log(`[pipeline] Site:  ${path.join(outputDir, 'site')}`);
if (!skipPdf) console.log(`[pipeline] PDF:   ${path.join(outputDir, 'pdf')}`);
