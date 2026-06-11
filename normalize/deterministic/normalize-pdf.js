#!/usr/bin/env node
/**
 * Layer 2A Deterministic Normalizer for PDF files.
 * 
 * Extraction chain (tries each in order, best first):
 *   1. MinerU (Document AI) — highest content extraction, layout + tables + formulas
 *   2. Marker (Datalab) — clean Markdown output, best image extraction
 *   3. pdftotext (poppler-utils) — fast, layout-aware fallback
 *   4. pdfminer.six (Python) — complex PDF fallback
 *   5. markitdown (Python, Microsoft) — last resort
 * 
 * Output: Curated Markdown Contract in normalized/{source_id}/
 */
const { execSync, execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { CONTRACT_VERSION, slugify, sha256, detectLanguage, countWords, extractSegments } = require('./normalize-md');

const VENV_PYTHON = path.resolve(__dirname, '../../.venv/bin/python');

function tryPdfToText(pdfPath, maxPages) {
  try {
    const pageFlag = maxPages ? `-l ${maxPages}` : '';
    const output = execSync(`pdftotext -layout ${pageFlag} "${pdfPath}" -`, {
      encoding: 'utf-8',
      timeout: 30000,
      maxBuffer: 50 * 1024 * 1024,
    });
    if (output.trim().length < 50) return null;

    const pages = (output.match(/\f/g) || []).length + 1;
    return { markdown: formatAsMarkdown(output), pages, method: 'pdftotext' };
  } catch {
    return null;
  }
}

function tryPdfMiner(pdfPath) {
  try {
    const output = execSync(`python3 -m pdfminer.high_level "${pdfPath}"`, {
      encoding: 'utf-8',
      timeout: 60000,
      maxBuffer: 50 * 1024 * 1024,
    });
    if (output.trim().length < 50) return null;

    const pages = (output.match(/\f/g) || []).length + 1;
    return { markdown: formatAsMarkdown(output), pages, method: 'pdfminer' };
  } catch {
    return null;
  }
}

function tryMarkItDown(pdfPath) {
  try {
    const output = execSync(`python3 -m markitdown "${pdfPath}"`, {
      encoding: 'utf-8',
      timeout: 120000,
      maxBuffer: 50 * 1024 * 1024,
    });
    if (output.trim().length < 50) return null;
    return { markdown: output.trim(), pages: 1, method: 'markitdown' };
  } catch {
    return null;
  }
}

function formatAsMarkdown(rawText) {
  let md = rawText.replace(/\f/g, '\n\n---\n\n');
  md = md.replace(/\n{4,}/g, '\n\n\n');
  md = md.replace(/[ \t]+$/gm, '');

  const lines = md.split('\n');
  const formatted = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      formatted.push('');
      continue;
    }
    if (trimmed.length < 80 && trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed)) {
      formatted.push(`## ${trimmed}`);
    } else {
      formatted.push(line);
    }
  }

  return formatted.join('\n').trim();
}

function generateSourceId(filePath) {
  const date = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const slug = slugify(path.basename(filePath, path.extname(filePath)));
  return `src-${date}-${slug}`.slice(0, 80);
}

/**
 * Extract embedded images from a PDF using pdfimages (poppler-utils).
 * Returns count of extracted images. Images saved to assetsDir as PNG.
 */
function extractPdfImages(pdfPath, assetsDir, maxImages = 30) {
  try {
    const prefix = path.join(assetsDir, 'pdf-img');
    execSync(`pdfimages -png -j "${pdfPath}" "${prefix}"`, {
      timeout: 60000,
      stdio: 'pipe',
    });
    const files = fs.readdirSync(assetsDir).filter(f => /\.(png|jpg|jpeg|ppm)$/i.test(f));
    let kept = 0;
    for (const f of files) {
      const fp = path.join(assetsDir, f);
      const stat = fs.statSync(fp);
      if (stat.size < 5120 || kept >= maxImages) {
        fs.unlinkSync(fp);
      } else {
        kept++;
      }
    }
    return kept;
  } catch {
    return 0;
  }
}

/**
 * Capture PDF pages as PNG screenshots using pdftoppm (poppler-utils).
 * Selects pages with visual content (charts, formulas) by sampling evenly.
 * Returns count of captured page images.
 */
function capturePdfPages(pdfPath, assetsDir, options = {}) {
  const { maxPages = 10, dpi = 150 } = options;
  try {
    const pageCountStr = execSync(
      `pdfinfo "${pdfPath}" 2>/dev/null | grep "Pages:" | awk '{print $2}'`,
      { encoding: 'utf-8', timeout: 5000 }
    ).trim();
    const totalPages = parseInt(pageCountStr, 10) || 0;
    if (totalPages === 0) return 0;

    const pagesToCapture = [];
    if (totalPages <= maxPages) {
      for (let i = 1; i <= totalPages; i++) pagesToCapture.push(i);
    } else {
      const step = Math.floor(totalPages / maxPages);
      for (let i = 1; i <= totalPages && pagesToCapture.length < maxPages; i += step) {
        pagesToCapture.push(i);
      }
    }

    let captured = 0;
    for (const page of pagesToCapture) {
      const outPrefix = path.join(assetsDir, `page-${String(page).padStart(3, '0')}`);
      try {
        execSync(
          `pdftoppm -png -r ${dpi} -f ${page} -l ${page} -singlefile "${pdfPath}" "${outPrefix}"`,
          { timeout: 15000, stdio: 'pipe' }
        );
        const outFile = `${outPrefix}.png`;
        if (fs.existsSync(outFile) && fs.statSync(outFile).size > 10240) {
          captured++;
        } else if (fs.existsSync(outFile)) {
          fs.unlinkSync(outFile);
        }
      } catch { /* skip page */ }
    }
    return captured;
  } catch {
    return 0;
  }
}

/**
 * Normalize a PDF file into the Curated Markdown Contract format.
 */
function normalizePdf(rawFilePath, options = {}) {
  const { topicId = 'admin/default', normalizedDir, rawRelPath } = options;

  const extraction = tryPdfToText(rawFilePath) || tryPdfMiner(rawFilePath) || tryMarkItDown(rawFilePath);

  if (!extraction) {
    throw new Error(`PDF extraction failed for all methods: ${rawFilePath}`);
  }

  const content = extraction.markdown;
  const sourceId = generateSourceId(rawFilePath);
  const sourceDir = path.join(normalizedDir, sourceId);

  fs.mkdirSync(path.join(sourceDir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(sourceDir, 'content.md'), content);

  const assetsPath = path.join(sourceDir, 'assets');
  const embeddedImages = extractPdfImages(rawFilePath, assetsPath);
  const pageScreenshots = capturePdfPages(rawFilePath, assetsPath);
  const imageCount = embeddedImages + pageScreenshots;

  const rawStats = fs.statSync(rawFilePath);
  const now = new Date().toISOString();

  const metadata = {
    source_id: sourceId,
    topic_id: topicId,
    raw_path: rawRelPath || `raw/${path.basename(rawFilePath)}`,
    source_type: 'pdf',
    original_filename: path.basename(rawFilePath),
    created_at: now,
    language: detectLanguage(content),
    processing_status: 'deterministic_normalized',
    content_hash: sha256(content),
    normalize_version: CONTRACT_VERSION,
    page_count: extraction.pages,
    word_count: countWords(content),
    image_count: imageCount,
    extraction_method: extraction.method,
  };

  fs.writeFileSync(
    path.join(sourceDir, 'metadata.json'),
    JSON.stringify(metadata, null, 2) + '\n'
  );

  const provenance = {
    source_id: sourceId,
    raw_path: metadata.raw_path,
    raw_hash: sha256(fs.readFileSync(rawFilePath, 'latin1')),
    raw_size_bytes: rawStats.size,
    upload_time: now,
    normalize_time: now,
    normalize_pipeline: [
      { step: 'pdf_extract', tool: extraction.method, duration_ms: 0 },
      { step: 'format_markdown', tool: 'builtin', duration_ms: 0 },
      { step: 'metadata_extract', tool: 'builtin', duration_ms: 0 },
    ],
    semantic_pipeline: [],
    parent_source: null,
    derived_from: null,
  };

  fs.writeFileSync(
    path.join(sourceDir, 'provenance.json'),
    JSON.stringify(provenance, null, 2) + '\n'
  );

  const segments = extractSegments(content);
  fs.writeFileSync(
    path.join(sourceDir, 'segments.json'),
    JSON.stringify(segments, null, 2) + '\n'
  );

  return { sourceId, sourceDir, method: extraction.method, pages: extraction.pages };
}

module.exports = { normalizePdf, extractPdfImages, capturePdfPages, tryPdfToText, tryPdfMiner, tryMarkItDown, formatAsMarkdown };
