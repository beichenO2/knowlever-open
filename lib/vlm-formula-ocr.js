/**
 * vlm-formula-ocr.js — VLM OCR for PDF/image formula recognition
 *
 * Uses PolarPrivate capability 101 (VLM) via OpenAI-compatible API.
 * Fallback: Ollama local model if PolarPrivate is unavailable.
 *
 * Usage:
 *   node lib/vlm-formula-ocr.js <image-path>
 *   node lib/vlm-formula-ocr.js --dir <images-dir>
 *   node lib/vlm-formula-ocr.js --pdf <pdf-path> --out <output-dir>
 *
 * Environment:
 *   POLARPRIVATE_URL — PolarPrivate base URL (default: http://127.0.0.1:12790/v1)
 *   OLLAMA_HOST      — Ollama fallback (default: http://127.0.0.1:11434)
 *   VLM_MODEL        — Ollama fallback model (default: qwen3-vl:8b)
 *   PDF_DPI          — PDF page render DPI (default: 300)
 */

const fs = require('fs');
const path = require('path');

const POLARPRIVATE_URL = process.env.POLARPRIVATE_URL || 'http://127.0.0.1:12790/v1';
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
const VLM_MODEL = process.env.VLM_MODEL || 'qwen3-vl:8b';
const PDF_DPI = parseInt(process.env.PDF_DPI || '300', 10);

const FORMULA_OCR_PROMPT = `你是数学公式 OCR 引擎。发给你的图片中应该有数学公式，请你识别并还原图片中的有效信息。

输出规则：
1. 数学公式用 LaTeX 格式：inline 用 $...$，独立公式用 $$...$$
2. 化学式也用 LaTeX：$H_2O$, $CH_3COOH$
3. 普通文字直接输出（保持原文语言）
4. 保持原文结构（段落、列表等）
5. 如果图片中有多行公式，每行一个 $$...$$
6. 上下标：$x^2$, $a_n$, $C_A^{n-1}$
7. 分数：$\\frac{a}{b}$
8. 根号：$\\sqrt{x}$
9. 希腊字母：$\\alpha$, $\\beta$, $\\Delta$
10. 如果无法识别某部分，用 [?] 标记

只输出识别结果，不要解释。`;

/**
 * Check if PolarPrivate VLM (101) is available.
 */
async function checkPolarPrivate() {
  try {
    const res = await fetch(`${POLARPRIVATE_URL}/models`, {
      signal: AbortSignal.timeout(5000),
      headers: { 'Authorization': 'Bearer sk-placeholder' },
    });
    if (!res.ok) return { available: false, reason: `PolarPrivate returned ${res.status}` };
    const data = await res.json();
    const models = (data.data || []).map(m => m.id);
    const has101 = models.some(m => m === '101');
    if (!has101) return { available: false, reason: '101 capability not in models list' };
    return { available: true, backend: 'polarprivate' };
  } catch (e) {
    return { available: false, reason: `PolarPrivate not reachable: ${e.message}` };
  }
}

/**
 * Check if Ollama is running with the VLM model.
 */
async function checkOllama() {
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { available: false, reason: `Ollama returned ${res.status}` };
    const data = await res.json();
    const models = (data.models || []).map(m => m.name);
    const hasModel = models.some(m => m.startsWith(VLM_MODEL.split(':')[0]));
    if (!hasModel) {
      return { available: false, reason: `Model ${VLM_MODEL} not found. Available: ${models.join(', ')}` };
    }
    return { available: true, backend: 'ollama', model: VLM_MODEL, models };
  } catch (e) {
    return { available: false, reason: `Ollama not reachable: ${e.message}` };
  }
}

/**
 * Detect available VLM backend: PolarPrivate first, then Ollama.
 */
async function detectBackend() {
  const pp = await checkPolarPrivate();
  if (pp.available) return pp;
  console.log(`[vlm-ocr] PolarPrivate unavailable (${pp.reason}), trying Ollama...`);
  const ol = await checkOllama();
  if (ol.available) return ol;
  return { available: false, reason: `No VLM backend: PP=${pp.reason}; Ollama=${ol.reason}` };
}

/**
 * OCR via PolarPrivate 101 (OpenAI-compatible vision API).
 */
async function ocrViaPolarPrivate(base64Image, mimeType) {
  const response = await fetch(`${POLARPRIVATE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer sk-placeholder',
    },
    body: JSON.stringify({
      model: '101',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: FORMULA_OCR_PROMPT },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Image}` } },
        ],
      }],
      temperature: 0.1,
      max_tokens: 65536,
    }),
    signal: AbortSignal.timeout(300_000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`PolarPrivate ${response.status}: ${text.slice(0, 200)}`);
  }

  const data = await response.json();
  return (data.choices?.[0]?.message?.content || '').trim();
}

/**
 * OCR via Ollama local VLM.
 */
async function ocrViaOllama(base64Image) {
  const response = await fetch(`${OLLAMA_HOST}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: VLM_MODEL,
      messages: [{
        role: 'user',
        content: '/no_think\n\n' + FORMULA_OCR_PROMPT,
        images: [base64Image],
      }],
      stream: false,
      options: { temperature: 0.1, num_predict: 65536 },
    }),
    signal: AbortSignal.timeout(300_000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Ollama ${response.status}: ${text.slice(0, 200)}`);
  }

  const data = await response.json();
  return (data.message?.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

async function ocrImage(imagePath, backend, maxRetries = 5) {
  const imageBuffer = fs.readFileSync(imagePath);
  const base64Image = imageBuffer.toString('base64');
  const ext = path.extname(imagePath).toLowerCase();
  const mimeMap = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
  const mimeType = mimeMap[ext] || 'image/png';

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    let content = '';
    try {
      if (backend.backend === 'polarprivate') {
        content = await ocrViaPolarPrivate(base64Image, mimeType);
      } else {
        content = await ocrViaOllama(base64Image);
      }
    } catch (e) {
      if (attempt === maxRetries) throw e;
      console.warn(`[vlm-ocr]   attempt ${attempt} failed: ${e.message}`);
    }

    if (content.length > 0) return content;
    if (attempt < maxRetries) {
      const delay = 3000 * attempt;
      console.log(`[vlm-ocr]   empty response, retrying in ${delay / 1000}s (${attempt}/${maxRetries})...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  return '';
}

async function ocrDirectory(dir, backend) {
  const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
  const files = fs.readdirSync(dir)
    .filter(f => imageExts.includes(path.extname(f).toLowerCase()))
    .sort();

  if (files.length === 0) {
    console.log('[vlm-ocr] No images found in', dir);
    return [];
  }

  console.log(`[vlm-ocr] Processing ${files.length} images from ${dir} (backend: ${backend.backend})`);
  const results = [];

  for (const file of files) {
    const filePath = path.join(dir, file);
    console.log(`[vlm-ocr]   ${file}...`);
    try {
      const text = await ocrImage(filePath, backend);
      results.push({ file, text });
      console.log(`[vlm-ocr]   -> ${text.length} chars`);
    } catch (e) {
      console.error(`[vlm-ocr]   failed ${file}: ${e.message}`);
      results.push({ file, text: '', error: e.message });
    }
  }

  return results;
}

// At 300 DPI, an A4 page ≈ 8.7M pixels ≈ 8,500 tokens.
// Batch up to BATCH_TARGET_TOKENS tokens per API call to stay under 36k.
const BATCH_TARGET_TOKENS = 32000;
const TOKENS_PER_A4_300DPI = 8500;
const PAGES_PER_BATCH = Math.max(1, Math.floor(BATCH_TARGET_TOKENS / TOKENS_PER_A4_300DPI));

/**
 * OCR a batch of images in a single PolarPrivate API call (multi-image vision).
 */
async function ocrBatchViaPolarPrivate(imagePaths) {
  const contentParts = [{ type: 'text', text: FORMULA_OCR_PROMPT + `\n\n以下共 ${imagePaths.length} 页，请按顺序识别每页内容，页与页之间用 "---" 分隔。` }];

  for (const imgPath of imagePaths) {
    const buf = fs.readFileSync(imgPath);
    const ext = path.extname(imgPath).toLowerCase();
    const mimeMap = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };
    const mime = mimeMap[ext] || 'image/png';
    contentParts.push({
      type: 'image_url',
      image_url: { url: `data:${mime};base64,${buf.toString('base64')}` },
    });
  }

  const response = await fetch(`${POLARPRIVATE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer sk-placeholder',
    },
    body: JSON.stringify({
      model: '101',
      messages: [{ role: 'user', content: contentParts }],
      temperature: 0.1,
      max_tokens: 65536,
    }),
    signal: AbortSignal.timeout(600_000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`PolarPrivate batch ${response.status}: ${text.slice(0, 200)}`);
  }

  const data = await response.json();
  return (data.choices?.[0]?.message?.content || '').trim();
}

/**
 * Process a PDF by extracting page images and OCR-ing them.
 * Batches multiple pages per API call when using PolarPrivate.
 * Requires `pdftoppm` (from poppler-utils).
 */
async function ocrPdf(pdfPath, outputDir, backend) {
  const { spawnSync } = require('child_process');

  const imagesDir = path.join(outputDir, '_pdf_pages');
  fs.mkdirSync(imagesDir, { recursive: true });

  const pdfBase = path.basename(pdfPath, '.pdf');
  const result = spawnSync('pdftoppm', ['-png', '-r', String(PDF_DPI), pdfPath, path.join(imagesDir, pdfBase)], {
    stdio: 'pipe',
  });

  if (result.status !== 0) {
    const stderr = result.stderr?.toString() || '';
    throw new Error(`pdftoppm failed: ${stderr.slice(0, 200)}. Install poppler-utils: brew install poppler`);
  }

  const pages = fs.readdirSync(imagesDir)
    .filter(f => f.endsWith('.png'))
    .sort();

  console.log(`[vlm-ocr] PDF -> ${pages.length} pages at ${PDF_DPI} DPI (backend: ${backend.backend})`);

  const allText = [];

  if (backend.backend === 'polarprivate' && pages.length > 1) {
    console.log(`[vlm-ocr] Batching ${PAGES_PER_BATCH} pages per API call (~${TOKENS_PER_A4_300DPI * PAGES_PER_BATCH} tokens/batch)`);

    for (let i = 0; i < pages.length; i += PAGES_PER_BATCH) {
      const batch = pages.slice(i, i + PAGES_PER_BATCH);
      const batchPaths = batch.map(p => path.join(imagesDir, p));
      const batchLabel = `pages ${i + 1}-${i + batch.length}`;
      console.log(`[vlm-ocr]   ${batchLabel}...`);
      try {
        const text = await ocrBatchViaPolarPrivate(batchPaths);
        allText.push(text);
        console.log(`[vlm-ocr]   ${batchLabel} -> ${text.length} chars`);
      } catch (e) {
        console.error(`[vlm-ocr]   ${batchLabel} batch failed, falling back to per-page: ${e.message}`);
        for (const page of batch) {
          const pagePath = path.join(imagesDir, page);
          try {
            const text = await ocrImage(pagePath, backend);
            allText.push(text);
          } catch (e2) {
            allText.push(`[OCR failed: ${e2.message}]`);
          }
        }
      }
    }
  } else {
    for (const page of pages) {
      const pagePath = path.join(imagesDir, page);
      console.log(`[vlm-ocr]   ${page}...`);
      try {
        const text = await ocrImage(pagePath, backend);
        allText.push(text);
        console.log(`[vlm-ocr]   -> ${text.length} chars`);
      } catch (e) {
        console.error(`[vlm-ocr]   failed ${page}: ${e.message}`);
        allText.push(`[OCR failed: ${e.message}]`);
      }
    }
  }

  const combined = allText.join('\n\n---\n\n');
  const outputPath = path.join(outputDir, `${pdfBase}.md`);
  fs.writeFileSync(outputPath, combined, 'utf-8');
  console.log(`[vlm-ocr] Done: ${outputPath} (${combined.length} chars)`);

  return { outputPath, pages: pages.length, chars: combined.length };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  let mode = 'single';
  let target = null;
  let outDir = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dir') { mode = 'dir'; target = args[++i]; }
    else if (args[i] === '--pdf') { mode = 'pdf'; target = args[++i]; }
    else if (args[i] === '--out') { outDir = args[++i]; }
    else if (args[i] === '--check') { mode = 'check'; }
    else if (!target) target = args[i];
  }

  async function main() {
    if (mode === 'check') {
      const status = await detectBackend();
      console.log(JSON.stringify(status, null, 2));
      process.exit(status.available ? 0 : 1);
    }

    const backend = await detectBackend();
    if (!backend.available) {
      console.error(`[vlm-ocr] No VLM backend available: ${backend.reason}`);
      process.exit(1);
    }
    console.log(`[vlm-ocr] Using backend: ${backend.backend}`);

    if (mode === 'pdf') {
      if (!target) { console.error('Usage: --pdf <path.pdf> --out <dir>'); process.exit(2); }
      const out = outDir || path.dirname(target);
      await ocrPdf(target, out, backend);
    } else if (mode === 'dir') {
      if (!target) { console.error('Usage: --dir <images-dir>'); process.exit(2); }
      await ocrDirectory(target, backend);
    } else {
      if (!target) { console.error('Usage: node vlm-formula-ocr.js <image>'); process.exit(2); }
      const text = await ocrImage(target, backend);
      console.log(text);
    }
  }

  main().catch(e => {
    console.error('[vlm-ocr] Fatal:', e.message);
    process.exit(1);
  });
}

module.exports = { ocrImage, ocrDirectory, ocrPdf, checkPolarPrivate, checkOllama, detectBackend };
