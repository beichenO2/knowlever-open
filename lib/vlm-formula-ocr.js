/**
 * vlm-formula-ocr.js — 用本地 VLM (Ollama) 做 PDF/图片中公式的 OCR
 *
 * 将图片中的数学公式转为 LaTeX 文本。
 * 使用 Ollama 的 vision 模型（默认 qwen3-vl:8b）。
 *
 * 用法：
 *   node lib/vlm-formula-ocr.js <image-path>           # 单张图片 → stdout LaTeX
 *   node lib/vlm-formula-ocr.js --dir <images-dir>     # 批量处理目录
 *   node lib/vlm-formula-ocr.js --pdf <pdf-path> --out <output-dir>  # PDF 页面截图 → OCR
 *
 * 环境变量：
 *   OLLAMA_HOST     — Ollama 地址 (default: http://127.0.0.1:11434)
 *   VLM_MODEL       — 模型名 (default: qwen3-vl:8b)
 */

const fs = require('fs');
const path = require('path');

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
const VLM_MODEL = process.env.VLM_MODEL || 'qwen3-vl:8b';

const FORMULA_OCR_PROMPT = `你是数学公式 OCR 引擎。请识别图片中的所有数学公式和文字。

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

async function ocrImage(imagePath) {
  const imageBuffer = fs.readFileSync(imagePath);
  const base64Image = imageBuffer.toString('base64');
  const mimeType = imagePath.endsWith('.png') ? 'image/png' : 'image/jpeg';

  const response = await fetch(`${OLLAMA_HOST}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: VLM_MODEL,
      messages: [{
        role: 'user',
        content: FORMULA_OCR_PROMPT,
        images: [base64Image],
      }],
      stream: false,
      options: {
        temperature: 0.1,
        num_predict: 4096,
      },
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Ollama ${response.status}: ${text.slice(0, 200)}`);
  }

  const data = await response.json();
  return data.message?.content || '';
}

async function ocrDirectory(dir) {
  const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
  const files = fs.readdirSync(dir)
    .filter(f => imageExts.includes(path.extname(f).toLowerCase()))
    .sort();

  if (files.length === 0) {
    console.log('[vlm-ocr] No images found in', dir);
    return [];
  }

  console.log(`[vlm-ocr] Processing ${files.length} images from ${dir}`);
  const results = [];

  for (const file of files) {
    const filePath = path.join(dir, file);
    console.log(`[vlm-ocr]   ${file}...`);
    try {
      const text = await ocrImage(filePath);
      results.push({ file, text });
      console.log(`[vlm-ocr]   → ${text.length} chars`);
    } catch (e) {
      console.error(`[vlm-ocr]   ❌ ${file}: ${e.message}`);
      results.push({ file, text: '', error: e.message });
    }
  }

  return results;
}

/**
 * Check if Ollama is running and has the VLM model.
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
    return { available: true, model: VLM_MODEL, models };
  } catch (e) {
    return { available: false, reason: `Ollama not reachable: ${e.message}` };
  }
}

/**
 * Process a PDF by extracting page images and OCR-ing them.
 * Requires `pdftoppm` (from poppler-utils) to be installed.
 */
async function ocrPdf(pdfPath, outputDir) {
  const { spawnSync } = require('child_process');

  const imagesDir = path.join(outputDir, '_pdf_pages');
  fs.mkdirSync(imagesDir, { recursive: true });

  // Convert PDF to images using pdftoppm
  const pdfBase = path.basename(pdfPath, '.pdf');
  const result = spawnSync('pdftoppm', ['-png', '-r', '200', pdfPath, path.join(imagesDir, pdfBase)], {
    stdio: 'pipe',
  });

  if (result.status !== 0) {
    const stderr = result.stderr?.toString() || '';
    throw new Error(`pdftoppm failed: ${stderr.slice(0, 200)}. Install poppler-utils: brew install poppler`);
  }

  const pages = fs.readdirSync(imagesDir)
    .filter(f => f.endsWith('.png'))
    .sort();

  console.log(`[vlm-ocr] PDF → ${pages.length} pages`);

  const allText = [];
  for (const page of pages) {
    const pagePath = path.join(imagesDir, page);
    console.log(`[vlm-ocr]   ${page}...`);
    try {
      const text = await ocrImage(pagePath);
      allText.push(text);
      console.log(`[vlm-ocr]   → ${text.length} chars`);
    } catch (e) {
      console.error(`[vlm-ocr]   ❌ ${page}: ${e.message}`);
      allText.push(`[OCR failed: ${e.message}]`);
    }
  }

  const combined = allText.join('\n\n---\n\n');
  const outputPath = path.join(outputDir, `${pdfBase}.md`);
  fs.writeFileSync(outputPath, combined, 'utf-8');
  console.log(`[vlm-ocr] ✅ Output: ${outputPath} (${combined.length} chars)`);

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
      const status = await checkOllama();
      console.log(JSON.stringify(status, null, 2));
      process.exit(status.available ? 0 : 1);
    }

    // Verify Ollama is available
    const status = await checkOllama();
    if (!status.available) {
      console.error(`[vlm-ocr] ❌ ${status.reason}`);
      process.exit(1);
    }

    if (mode === 'pdf') {
      if (!target) { console.error('Usage: --pdf <path.pdf> --out <dir>'); process.exit(2); }
      const out = outDir || path.dirname(target);
      await ocrPdf(target, out);
    } else if (mode === 'dir') {
      if (!target) { console.error('Usage: --dir <images-dir>'); process.exit(2); }
      const results = await ocrDirectory(target);
      for (const r of results) {
        if (r.text) console.log(`\n=== ${r.file} ===\n${r.text}`);
      }
    } else {
      if (!target) { console.error('Usage: node vlm-formula-ocr.js <image>'); process.exit(2); }
      const text = await ocrImage(target);
      console.log(text);
    }
  }

  main().catch(e => {
    console.error('[vlm-ocr] Fatal:', e.message);
    process.exit(1);
  });
}

module.exports = { ocrImage, ocrDirectory, ocrPdf, checkOllama };
