#!/usr/bin/env node
/**
 * Layer 2A Deterministic Normalizer for PowerPoint files.
 *
 * Extraction chain:
 *   1. python-pptx (via _pptx_extract.py) — slide text + embedded images
 *   2. markitdown (Microsoft, fallback) — text only
 *
 * Image filtering uses the shared image-policy module:
 *   - Level 1: domain → keep/discard all images
 *   - Level 2: per-image size/quality filter
 *
 * Output: Curated Markdown Contract in normalized/{source_id}/
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { CONTRACT_VERSION, slugify, sha256, detectLanguage, countWords, extractSegments } = require('./normalize-md');
const { shouldDomainKeepImages, shouldKeepImage } = require('./image-policy');

const PPT_EXTS = new Set(['.pptx', '.ppt']);
const VENV_PYTHON = path.resolve(__dirname, '../../.venv/bin/python');

function isPptFile(filePath) {
  return PPT_EXTS.has(path.extname(filePath).toLowerCase());
}

function generateSourceId(filePath) {
  const date = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const slug = slugify(path.basename(filePath, path.extname(filePath)));
  return `src-${date}-ppt-${slug}`.slice(0, 80);
}

function tryPythonPptx(pptxPath, assetsDir) {
  const helperScript = path.join(__dirname, '_pptx_extract.py');
  const pythonCmd = fs.existsSync(VENV_PYTHON) ? VENV_PYTHON : 'python3';

  try {
    const result = execSync(
      `"${pythonCmd}" "${helperScript}" "${pptxPath}" "${assetsDir}"`,
      { encoding: 'utf-8', timeout: 120000, maxBuffer: 50 * 1024 * 1024 }
    );
    const lastLine = result.trim().split('\n').pop();
    const parsed = JSON.parse(lastLine);
    if (parsed.error) return null;
    if (!parsed.markdown || parsed.markdown.length < 20) return null;
    return {
      markdown: parsed.markdown,
      slides: parsed.slides || 0,
      imageCount: parsed.images || 0,
      method: 'python-pptx',
    };
  } catch (err) {
    console.error(`  [python-pptx] Failed: ${err.message?.slice(0, 100)}`);
    return null;
  }
}

function tryMarkItDown(pptxPath) {
  try {
    const output = execSync(`python3 -m markitdown "${pptxPath}"`, {
      encoding: 'utf-8',
      timeout: 60000,
      maxBuffer: 50 * 1024 * 1024,
    });
    if (output.trim().length < 20) return null;
    return { markdown: output.trim(), slides: 1, imageCount: 0, method: 'markitdown' };
  } catch {
    return null;
  }
}

/**
 * Filter extracted images in assets/ using two-level image policy.
 * Removes images that don't pass the filter, returns count of kept images.
 */
function filterExtractedImages(assetsDir, domain) {
  const domainPolicy = shouldDomainKeepImages(domain);
  const imageFiles = fs.existsSync(assetsDir)
    ? fs.readdirSync(assetsDir).filter(f => /\.(png|jpg|jpeg|gif|bmp|webp|svg)$/i.test(f))
    : [];

  if (imageFiles.length === 0) return 0;

  if (!domainPolicy.keepImages) {
    for (const f of imageFiles) {
      fs.unlinkSync(path.join(assetsDir, f));
    }
    return 0;
  }

  let kept = 0;
  for (let i = 0; i < imageFiles.length; i++) {
    const f = imageFiles[i];
    const fp = path.join(assetsDir, f);
    const stat = fs.statSync(fp);
    const decision = shouldKeepImage({
      fileSize: stat.size,
      filename: f,
      batchIndex: i,
      batchTotal: imageFiles.length,
    });
    if (decision.keep) {
      kept++;
    } else {
      fs.unlinkSync(fp);
    }
  }
  return kept;
}

/**
 * Remove image references from markdown for images that were filtered out.
 */
function cleanImageReferences(markdown, assetsDir) {
  const existingImages = fs.existsSync(assetsDir)
    ? new Set(fs.readdirSync(assetsDir))
    : new Set();

  return markdown.replace(/!\[([^\]]*)\]\(assets\/([^)]+)\)/g, (match, alt, filename) => {
    if (existingImages.has(filename)) return match;
    return `*[Image removed: ${alt || filename}]*`;
  });
}

/**
 * Normalize a PowerPoint file into the Curated Markdown Contract format.
 */
function normalizePpt(rawFilePath, options = {}) {
  const { topicId = 'admin/default', normalizedDir, rawRelPath, domain = 'general' } = options;

  const sourceId = generateSourceId(rawFilePath);
  const sourceDir = path.join(normalizedDir, sourceId);
  const assetsDir = path.join(sourceDir, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });

  const t0 = Date.now();

  let extraction = tryPythonPptx(rawFilePath, assetsDir);
  if (!extraction) {
    extraction = tryMarkItDown(rawFilePath);
  }

  if (!extraction) {
    throw new Error(`PPT extraction failed for all methods: ${rawFilePath}`);
  }

  const elapsed = Date.now() - t0;
  const rawImageCount = extraction.imageCount;
  const keptImages = filterExtractedImages(assetsDir, domain);
  const filteredCount = rawImageCount - keptImages;
  let content = extraction.markdown;

  if (filteredCount > 0) {
    content = cleanImageReferences(content, assetsDir);
  }

  fs.writeFileSync(path.join(sourceDir, 'content.md'), content);

  const rawStats = fs.statSync(rawFilePath);
  const now = new Date().toISOString();

  const metadata = {
    source_id: sourceId,
    topic_id: topicId,
    raw_path: rawRelPath || `raw/${path.basename(rawFilePath)}`,
    source_type: 'ppt',
    original_filename: path.basename(rawFilePath),
    created_at: now,
    language: detectLanguage(content),
    processing_status: 'deterministic_normalized',
    content_hash: sha256(content),
    normalize_version: CONTRACT_VERSION,
    page_count: extraction.slides,
    word_count: countWords(content),
    image_count: keptImages,
    images_extracted: rawImageCount,
    images_filtered: filteredCount,
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
      { step: 'ppt_extract', tool: extraction.method, duration_ms: elapsed },
      ...(filteredCount > 0 ? [{ step: 'image_filter', tool: 'image-policy', kept: keptImages, filtered: filteredCount }] : []),
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

  return {
    sourceId,
    sourceDir,
    method: extraction.method,
    slides: extraction.slides,
    keptImages,
    filteredImages: filteredCount,
  };
}

module.exports = { normalizePpt, isPptFile, PPT_EXTS };
