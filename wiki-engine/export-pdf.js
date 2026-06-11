#!/usr/bin/env node
/**
 * Export KnowLever wiki markdown pages to A4 PDF.
 *
 * Pipeline (since 260508):
 *   1. PolarDesign CLI (`doc/report` skill) renders wiki/*.md → print-ready HTML
 *      using a chosen design system (default polar-soft, light + B&W-print safe).
 *   2. AutoOffice CLI (`html-to-pdf`) drives headless Chromium to produce PDF.
 *
 * study-review template (260513):
 *   Uses embedded Handlebars template + Playwright to render HTML to PDF directly,
 *   without depending on AutoOffice template system.
 *
 * Visual style is now sourced exclusively from PolarDesign DESIGN.md tokens.
 * AutoOffice's hardcoded `technical-report`/`study-notes` themes are no
 * longer used for KnowLever output (kept only for AutoOffice's own consumers).
 *
 * Usage:
 *   node wiki-engine/export-pdf.js --topic <name> [--user admin] [--output <dir>]
 *   node wiki-engine/export-pdf.js --topic <name> --pages concepts/foo.html,concepts/bar.md
 *   node wiki-engine/export-pdf.js --topic <name> --system polar-soft
 *   node wiki-engine/export-pdf.js --topic <name> --template study-review
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { ROOT } = require('../lib/paths');
const { normalizeFormulas } = require('./normalize-formulas');

const POLARDESIGN_SYSTEMS = new Set(['polar-soft', 'polar-tech', 'polar-dense']);
const STUDY_REVIEW_SYSTEM = 'study-review';

/**
 * study-review HTML template: A4 double-sided print with TOC, code blocks, LaTeX.
 * Sourced from templates/study-review/template.html (extracted 260514).
 */
const STUDY_REVIEW_TEMPLATE = fs.readFileSync(
  path.join(__dirname, '..', 'templates', 'study-review', 'template.html'),
  'utf-8'
);

function parseArgs() {
  const args = process.argv.slice(2);
  let topic = null;
  let user = 'admin';
  let outputDir = null;
  let all = false;
  let pageFilter = null;
  let system = 'polar-soft';
  let normalizeFormulasFlag = true;
  let formulaModel = null;
  let formulaService = null;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--topic' || a === '-t') topic = args[++i];
    else if (a === '--user' || a === '-u') user = args[++i];
    else if (a === '--output' || a === '-o') outputDir = args[++i];
    else if (a === '--all') all = true;
    else if (a === '--pages') pageFilter = args[++i].split(',').map(s => s.trim()).filter(Boolean);
    else if (a === '--system') system = args[++i];
    else if (a === '--no-normalize-formulas') normalizeFormulasFlag = false;
    else if (a === '--normalize-formulas') normalizeFormulasFlag = true;
    else if (a === '--formula-model') formulaModel = args[++i];
    else if (a === '--formula-service') formulaService = args[++i];
    else if (a === '--template') {
      const tpl = args[++i];
      if (tpl === 'study-review') {
        system = STUDY_REVIEW_SYSTEM;
      } else {
        // Backward-compat: other --template values map to polar-soft
        system = 'polar-soft';
      }
    }
    else if (a === '--help' || a === '-h') {
      console.log(`Usage: node wiki-engine/export-pdf.js --topic <name> [--user admin] [--output dir] [--all] [--pages a.html,b.md] [--system polar-soft|polar-tech|polar-dense] [--no-normalize-formulas]`);
      process.exit(0);
    }
  }

  if (system !== STUDY_REVIEW_SYSTEM && !POLARDESIGN_SYSTEMS.has(system)) {
    throw new Error(`Unknown system: ${system}. Supported: ${[...POLARDESIGN_SYSTEMS].join(', ')}, ${STUDY_REVIEW_SYSTEM}`);
  }

  return { topic, user, outputDir, all, pageFilter, system, normalizeFormulasFlag, formulaModel, formulaService };
}

function walkMarkdown(dir, rel = '') {
  const files = [];
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    const childRel = path.join(rel, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkMarkdown(abs, childRel));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push({ abs, rel: childRel });
    }
  }
  return files;
}

function normalizePageFilter(filter) {
  return filter
    .replace(/^output\//, '')
    .replace(/^wiki\//, '')
    .replace(/\.html$/i, '.md')
    .replace(/\\/g, '/');
}

function findWikiFiles(wikiDir, pageFilter, all) {
  if (!fs.existsSync(wikiDir)) {
    console.error(`[export-pdf] Wiki directory not found: ${wikiDir}`);
    console.error('[export-pdf] Run compile/ingest first so wiki/*.md exists.');
    process.exit(1);
  }

  if (pageFilter) {
    const resolved = [];
    for (const raw of pageFilter) {
      const rel = normalizePageFilter(raw);
      const abs = path.join(wikiDir, rel);
      if (fs.existsSync(abs)) {
        resolved.push({ abs, rel });
      } else {
        console.warn(`[export-pdf] Page not found in wiki/: ${raw} -> ${rel}`);
      }
    }
    return resolved;
  }

  const files = walkMarkdown(wikiDir).sort((a, b) => a.rel.localeCompare(b.rel));
  // Historically the command exported content pages by default. In wiki/ every .md file is content.
  return all ? files : files;
}

function parseFrontmatter(markdown) {
  if (!markdown.startsWith('---\n')) return { meta: {}, body: markdown };
  const end = markdown.indexOf('\n---', 4);
  if (end === -1) return { meta: {}, body: markdown };
  const raw = markdown.slice(4, end).trim();
  const body = markdown.slice(end + 4).replace(/^\s+/, '');
  const meta = {};
  for (const line of raw.split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else if (value.startsWith('[') && value.endsWith(']')) {
      value = value.slice(1, -1).split(',').map(v => v.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
    }
    meta[key] = value;
  }
  return { meta, body };
}

function buildPolarDesignBrief(file, system, manuscriptPath) {
  const meta = parseFrontmatter(fs.readFileSync(file.abs, 'utf-8')).meta;
  const tags = Array.isArray(meta.tags) ? meta.tags : (meta.tags ? [meta.tags] : []);
  const eyebrowParts = ['KNOWLEVER · 知识手册'];
  const taglineParts = [meta.type, meta.status, ...tags].filter(Boolean);
  const subtitle = taglineParts.length
    ? `${taglineParts.map(String).join(' / ')} — KnowLever 7-stage pipeline auto-compiled.`
    : 'KnowLever 7-stage pipeline auto-compiled.';
  const date = String(meta.updated || meta.created || meta.date || new Date().toISOString().slice(0, 10));

  return {
    skill: 'doc/report',
    system,
    brief: `KnowLever wiki page — ${path.basename(file.rel, '.md')}`,
    inputs: {
      manuscript_path: manuscriptPath || file.abs,
      meta: {
        eyebrow: eyebrowParts.join(' · '),
        subtitle,
        author: 'KnowLever',
        date,
        version: meta.confidence ? `v${meta.confidence}` : undefined,
      },
      lang: 'zh',
    },
  };
}

function autoOfficeDir() {
  return process.env.AUTOOFFICE_DIR || path.resolve(ROOT, '..', 'AutoOffice');
}

function polarDesignDir() {
  return process.env.POLARDESIGN_DIR || path.resolve(ROOT, '..', 'PolarDesign');
}

function ensureCli(projectDir, label) {
  const envKey = label === 'AutoOffice' ? 'AUTOOFFICE_CLI' : 'POLARDESIGN_CLI';
  if (process.env[envKey] && fs.existsSync(process.env[envKey])) {
    return process.env[envKey];
  }
  const cliPath = path.join(projectDir, 'dist', 'cli.js');
  if (fs.existsSync(cliPath)) return cliPath;

  if (!fs.existsSync(path.join(projectDir, 'package.json'))) {
    throw new Error(`${label} project not found. Set ${envKey} or its *_DIR env. Tried: ${projectDir}`);
  }

  console.log(`[export-pdf] ${label} CLI not built; preparing ${projectDir}`);
  if (!fs.existsSync(path.join(projectDir, 'node_modules'))) {
    runChecked('npm', ['install'], { cwd: projectDir });
  }
  runChecked('npm', ['run', 'build'], { cwd: projectDir });

  if (!fs.existsSync(cliPath)) {
    throw new Error(`${label} build finished but CLI missing: ${cliPath}`);
  }
  return cliPath;
}

function runChecked(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    encoding: 'utf-8',
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit ${result.status}`);
  }
  return result;
}

function renderViaPolarDesignAndAutoOffice(pdCli, aoCli, brief, pdfPath) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowlever-pd-'));
  const briefPath = path.join(tmpDir, 'brief.json');
  const htmlPath = path.join(tmpDir, 'report.html');
  try {
    fs.writeFileSync(briefPath, JSON.stringify(brief, null, 2), 'utf-8');

    // Step 1: PolarDesign renders print-ready HTML via the doc/report skill.
    runChecked(process.execPath, [pdCli, 'generate', '--brief', briefPath, '--output', htmlPath], {
      cwd: polarDesignDir(),
    });
    if (!fs.existsSync(htmlPath)) {
      throw new Error(`PolarDesign did not produce HTML at ${htmlPath}`);
    }

    // Step 2: AutoOffice html-to-pdf drives headless Chromium for PDF output.
    runChecked(process.execPath, [aoCli, 'html-to-pdf', '--input', htmlPath, '--output', pdfPath], {
      cwd: autoOfficeDir(),
    });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Convert a single markdown file to study-review HTML using Playwright.
 * @param {object} file - Wiki file object with abs and rel paths
 * @param {string} markdownPath - Path to the (possibly normalized) markdown file
 * @param {string} pdfPath - Output PDF path
 */
async function renderStudyReviewMarkdown(file, markdownPath, pdfPath) {
  const { chromium } = require('playwright');
  const matter = parseFrontmatter(fs.readFileSync(markdownPath, 'utf-8'));
  const meta = matter.meta;
  const body = matter.body;

  const title = meta.title || path.basename(file.rel, '.md');
  const date = String(meta.updated || meta.created || meta.date || new Date().toISOString().slice(0, 10));

  // Extract h2/h3 for TOC
  const tocItems = [];
  const lines = body.split('\n');
  const processed = [];
  let inCodeBlock = false;
  let inTable = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      if (inCodeBlock) {
        processed.push('<pre><code>');
      } else {
        processed.push('</code></pre>');
      }
      continue;
    }
    if (inCodeBlock) {
      processed.push(line);
      continue;
    }

    if (line.match(/^\| .+ \|$/)) {
      if (!inTable) {
        inTable = true;
        processed.push('<table><tr>');
      }
      const cells = line.replace(/^\| /, '').replace(/ \|$/, '').split(' | ');
      processed.push(cells.map(c => `<td>${c.trim()}</td>`).join(''));
      if (i === lines.length - 1 || !lines[i + 1].match(/^\| .+ \|$/)) {
        processed.push('</tr></table>');
        inTable = false;
      }
      continue;
    }

    if (line.startsWith('## ')) {
      // Close previous chapter div if open
      if (processed.length > 0 && processed[processed.length - 1].startsWith('<div class="chapter">')) {
        processed.push('</div>');
      }
      const heading = line.slice(3);
      const id = heading.toLowerCase().replace(/[^\w]+/g, '-');
      tocItems.push({ id, title: heading });
      processed.push(`<div class="chapter"><h2 id="${id}">${heading}</h2>`);
    } else if (line.startsWith('### ')) {
      const heading = line.slice(4);
      const id = heading.toLowerCase().replace(/[^\w]+/g, '-');
      tocItems.push({ id, title: heading });
      processed.push(`<h3 id="${id}">${heading}</h3>`);
    } else if (line.startsWith('> ')) {
      processed.push(`<blockquote>${line.slice(2)}</blockquote>`);
    } else if (line.trim() === '') {
      continue;
    } else {
      let l = line;
      l = l.replace(/`([^`]+)`/g, '<code>$1</code>');
      l = l.replace(/\$([^$]+)\$/g, '<span class="formula">$1</span>');
      l = l.replace(/\$\$([^$]+)\$\$/g, '<div class="formula">$1</div>');
      processed.push(`<p>${l}</p>`);
    }
  }

  // Close any open chapter div at the end
  if (processed.length > 0 && processed[processed.length - 1].startsWith('<div class="chapter">')) {
    processed.push('</div>');
  }

  const bodyHtml = processed.join('\n');
  const tocHtml = tocItems.length > 0
    ? `<div class="toc"><h2>目录</h2><ul>${tocItems.map(t => `<li><a href="#${t.id}">${t.title}</a></li>`).join('')}</ul></div>`
    : '';

  const finalHtml = STUDY_REVIEW_TEMPLATE
    .replace('{{title}}', title)
    .replace('{{date}}', date)
    .replace(/{{#if tocItems\.length}}[\s\S]*?\{\{\/if\}\}/, tocHtml)
    .replace('{{{body}}}', bodyHtml);

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(finalHtml, { waitUntil: 'networkidle' });
  await page.pdf({ path: pdfPath, format: 'A4', printBackground: true });
  await browser.close();
  return pdfPath;
}

async function maybeNormalizeManuscript(file, options) {
  if (!options.normalizeFormulasFlag) return { manuscriptPath: file.abs, normalized: false };

  const cacheDir = path.join(options.topicRoot, '.cache', 'formula-normalized');
  const stagingDir = path.join(options.topicRoot, '.cache', 'formula-staging');
  fs.mkdirSync(stagingDir, { recursive: true });

  const raw = fs.readFileSync(file.abs, 'utf-8');
  let result;
  try {
    result = await normalizeFormulas(raw, {
      cacheDir,
      model: options.formulaModel || undefined,
      service: options.formulaService || undefined,
      label: `formula:${path.basename(file.rel)}`,
    });
  } catch (e) {
    console.warn(`[export-pdf] formula normalization failed for ${file.rel}: ${e.message}; using raw markdown`);
    return { manuscriptPath: file.abs, normalized: false };
  }
  const stagedPath = path.join(stagingDir, file.rel.replace(/\//g, '__'));
  fs.mkdirSync(path.dirname(stagedPath), { recursive: true });
  fs.writeFileSync(stagedPath, result.markdown, 'utf-8');
  const tag = result.cached ? 'cached' : `chunks=${result.chunks}/fellBack=${result.fellBack}`;
  return { manuscriptPath: stagedPath, normalized: true, tag };
}

async function main() {
  const { topic, user, outputDir: customOutput, all, pageFilter, system, normalizeFormulasFlag, formulaModel, formulaService } = parseArgs();

  if (!topic) {
    console.log('Usage: node wiki-engine/export-pdf.js --topic <name> [--user admin] [--output dir] [--system polar-soft|polar-tech|polar-dense] [--template study-review]');
    process.exit(0);
  }

  const topicRoot = path.join(ROOT, 'data', 'users', user, 'topics', topic);
  const wikiDir = path.join(topicRoot, 'wiki');
  const pdfOutputDir = path.resolve(customOutput || path.join(topicRoot, 'pdf'));
  fs.mkdirSync(pdfOutputDir, { recursive: true });

  const wikiFiles = findWikiFiles(wikiDir, pageFilter, all);
  if (wikiFiles.length === 0) {
    console.log('[export-pdf] No wiki markdown files found to export.');
    process.exit(0);
  }

  console.log(`[export-pdf] Topic: ${topic} (user: ${user})`);
  console.log(`[export-pdf] Wiki source: ${wikiDir}`);
  console.log(`[export-pdf] Design system:   ${system}`);
  console.log(`[export-pdf] Normalize math:  ${normalizeFormulasFlag ? 'on (LLM → LaTeX)' : 'off'}`);
  console.log(`[export-pdf] PDF output:      ${pdfOutputDir}`);
  console.log(`[export-pdf] Pages: ${wikiFiles.length}`);

  const isStudyReview = system === STUDY_REVIEW_SYSTEM;
  let pdCli, aoCli;
  if (!isStudyReview) {
    pdCli = ensureCli(polarDesignDir(), 'PolarDesign');
    aoCli = ensureCli(autoOfficeDir(), 'AutoOffice');
    console.log(`[export-pdf] PolarDesign CLI: ${pdCli}`);
    console.log(`[export-pdf] AutoOffice CLI:  ${aoCli}`);
  }

  const opts = { normalizeFormulasFlag, formulaModel, formulaService, topicRoot };

  let exported = 0;
  let failed = 0;
  for (const file of wikiFiles) {
    const pdfName = file.rel.replace(/\.md$/i, '.pdf').replace(/\//g, '__');
    const pdfPath = path.join(pdfOutputDir, pdfName);
    try {
      const { manuscriptPath, normalized, tag } = await maybeNormalizeManuscript(file, opts);
      if (isStudyReview) {
        await renderStudyReviewMarkdown(file, manuscriptPath, pdfPath);
      } else {
        const brief = buildPolarDesignBrief(file, system, manuscriptPath);
        renderViaPolarDesignAndAutoOffice(pdCli, aoCli, brief, pdfPath);
      }
      const size = (fs.statSync(pdfPath).size / 1024).toFixed(1);
      const suffix = normalized ? ` [normalized:${tag}]` : '';
      console.log(`  ✓ ${file.rel} → ${pdfName} (${size} KB)${suffix}`);
      exported++;
    } catch (e) {
      console.log(`  ✗ ${file.rel}: ${e.message}`);
      failed++;
    }
  }

  console.log(`\n[export-pdf] Done: ${exported} exported, ${failed} failed`);
  console.log(`[export-pdf] PDFs: ${pdfOutputDir}`);
  if (failed > 0) process.exitCode = 1;
}

if (require.main === module) {
  main().catch(e => {
    console.error('[export-pdf] Fatal:', e);

    process.exit(1);
  });
}

module.exports = {
  parseFrontmatter,
  buildPolarDesignBrief,
  findWikiFiles,
  POLARDESIGN_SYSTEMS,
};
