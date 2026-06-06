#!/usr/bin/env node
/**
 * Re-OCR garbled normalized files using VLM.
 * 
 * For each normalized/<slug>/content.md that fails isGarbled(),
 * finds the corresponding raw/<slug>.pdf and runs VLM OCR.
 * Backs up old content.md → content.pdftotext.bak before overwriting.
 */

const fs = require('fs');
const path = require('path');
const { ocrPdf, detectBackend } = require('../lib/vlm-formula-ocr');

const TOPIC = 'radar-2026';
const DATA_DIR = path.resolve(__dirname, '../data/topics', TOPIC);
const RAW_DIR = path.join(DATA_DIR, 'raw');
const NORM_DIR = path.join(DATA_DIR, 'normalized');

function isGarbled(text) {
  if (!text || text.trim().length < 20) return { garbled: true, reason: 'too_short' };
  const totalChars = text.length;
  let garbledCount = 0;
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code === 0xFFFD) { garbledCount++; continue; }
    if (code >= 0xE000 && code <= 0xF8FF) { garbledCount++; continue; }
    if (code <= 0x08 || (code >= 0x0E && code <= 0x1F)) { garbledCount++; continue; }
    if (code === 0x000B) { garbledCount++; continue; }
    if (code === 0x00AD) { garbledCount++; continue; }
    if (code >= 0x200B && code <= 0x200F) { garbledCount++; continue; }
    if (code === 0x2028 || code === 0x2029) { garbledCount++; continue; }
    if (code === 0xFEFF && totalChars > 1) { garbledCount++; continue; }
    if (code === 0xFFFE || code === 0xFFFF) { garbledCount++; continue; }
  }
  if (garbledCount / totalChars > 0.001) return { garbled: true, reason: `garbled_chars: ${garbledCount}` };

  const readable = text.match(/[\u4e00-\u9fff\u3400-\u4dbfa-zA-Z0-9\s.,;:!?()（）、。，；：""''！？【】《》〈〉〔〕…\-—·\n\r\t$\\{}[\]^_+=\/<>|~@#%&*"'`°±×÷αβγδεζηθλμνπρστωΩΔΣ∫∂∞≥≤≠≈∈∉√∑∏←→↓↑↔∀∃∅∩∪⊂⊆⊕⊗⋅≡≅≃≪≫²³\u2070-\u209f\u2460-\u24ff\u2000-\u206f]/gu) || [];
  if (readable.length / totalChars < 0.99) return { garbled: true, reason: `low_readable: ${(readable.length / totalChars * 100).toFixed(1)}%` };

  const lines = text.split('\n');
  const nonEmptyLines = lines.filter(l => l.trim().length > 0);
  const spatialLines = nonEmptyLines.filter(l => /\s{3,}/.test(l));
  if (spatialLines.length / (nonEmptyLines.length || 1) > 0.05) return { garbled: true, reason: `spatial_layout` };

  const words = text.split(/\s+/).filter(w => w.length > 0);
  const singleChars = words.filter(w => w.length === 1 && !/[a-zA-Z0-9\u4e00-\u9fff，。！？、$\\]/.test(w));
  if (words.length > 20 && singleChars.length / words.length > 0.01) return { garbled: true, reason: `single_char_words` };

  return { garbled: false };
}

async function main() {
  const backend = await detectBackend();
  if (!backend.available) {
    console.error(`[re-ocr] No VLM backend: ${backend.reason}`);
    process.exit(1);
  }
  console.log(`[re-ocr] VLM backend: ${backend.backend}`);

  const dirs = fs.readdirSync(NORM_DIR).filter(d => {
    const st = fs.statSync(path.join(NORM_DIR, d));
    return st.isDirectory() && !['explanations', 'summaries', 'problems'].includes(d);
  });

  const toReocr = [];
  for (const dir of dirs) {
    const contentPath = path.join(NORM_DIR, dir, 'content.md');
    if (!fs.existsSync(contentPath)) continue;
    const text = fs.readFileSync(contentPath, 'utf-8');
    const result = isGarbled(text);
    if (!result.garbled) continue;

    // Find corresponding raw PDF
    const pdfPath = path.join(RAW_DIR, dir + '.pdf');
    if (!fs.existsSync(pdfPath)) {
      console.log(`[re-ocr] SKIP ${dir}: no raw PDF found (${result.reason})`);
      continue;
    }
    // Skip if already OCR'd (content.md differs from backup)
    const backupPath = path.join(NORM_DIR, dir, 'content.pdftotext.bak');
    if (fs.existsSync(backupPath)) {
      const cur = fs.readFileSync(contentPath);
      const bak = fs.readFileSync(backupPath);
      if (!cur.equals(bak)) {
        console.log(`[re-ocr] SKIP ${dir}: already OCR'd (content differs from backup)`);
        continue;
      }
    }

    toReocr.push({ dir, pdfPath, reason: result.reason });
  }

  const CONCURRENCY = 5;
  const STAGGER_MS = 60_000;
  console.log(`[re-ocr] ${toReocr.length} files to re-OCR (concurrency=${CONCURRENCY}, stagger=${STAGGER_MS/1000}s)\n`);

  let succeeded = 0;
  let failed = 0;

  async function processOne(item, idx) {
    const { dir, pdfPath, reason } = item;
    const tag = `[worker-${idx % CONCURRENCY}]`;
    console.log(`${tag} === ${idx + 1}/${toReocr.length}: ${dir} (${reason}) ===`);

    const srcDir = path.join(NORM_DIR, dir);
    const contentPath = path.join(srcDir, 'content.md');
    const backupPath = path.join(srcDir, 'content.pdftotext.bak');
    if (!fs.existsSync(backupPath)) {
      fs.copyFileSync(contentPath, backupPath);
      console.log(`${tag}   backed up → content.pdftotext.bak`);
    }

    try {
      const result = await ocrPdf(pdfPath, srcDir, backend);
      const ocrOutput = path.join(srcDir, path.basename(pdfPath, '.pdf') + '.md');
      if (fs.existsSync(ocrOutput)) {
        const ocrText = fs.readFileSync(ocrOutput, 'utf-8');
        fs.writeFileSync(contentPath, ocrText, 'utf-8');
        if (ocrOutput !== contentPath) fs.unlinkSync(ocrOutput);
        console.log(`${tag}   ✅ ${dir}: ${result.pages} pages, ${result.chars} chars`);
        succeeded++;
      }
    } catch (e) {
      console.error(`${tag}   ❌ ${dir}: ${e.message}`);
      failed++;
    }
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const running = [];

  for (let i = 0; i < toReocr.length; i++) {
    if (i > 0 && i % CONCURRENCY === 0) {
      await Promise.all(running);
      running.length = 0;
    }
    if (running.length > 0) {
      console.log(`[re-ocr] stagger: waiting ${STAGGER_MS / 1000}s before next worker...`);
      await sleep(STAGGER_MS);
    }
    running.push(processOne(toReocr[i], i));
  }
  await Promise.all(running);

  console.log(`\n[re-ocr] Done: ${succeeded}/${toReocr.length} succeeded, ${failed} failed`);
}

main().catch(e => {
  console.error('[re-ocr] Fatal:', e.message);
  process.exit(1);
});
