#!/usr/bin/env node
/**
 * Layer 2A Deterministic Normalizer for Markdown files.
 * 
 * Produces the Curated Markdown Contract output:
 *   normalized/{source_id}/
 *     content.md, metadata.json, provenance.json, segments.json, assets/
 * 
 * Usage (called by ingest.js, not directly):
 *   const { normalizeMarkdown } = require('./normalize-md');
 *   normalizeMarkdown(rawFilePath, { topicId, normalizedDir });
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const iconv = require('iconv-lite');

const CONTRACT_VERSION = '1.0.0';

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.tiff']);

/**
 * Detect encoding of a buffer by checking for UTF-8 BOM and
 * heuristic GBK detection (high-byte CJK ranges).
 */
function detectEncoding(buf) {
  if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) return 'utf-8';
  const utf8Str = buf.toString('utf-8');
  const replacements = (utf8Str.match(/\uFFFD/g) || []).length;
  if (replacements === 0) return 'utf-8';
  let gbkPairs = 0;
  for (let i = 0; i < buf.length - 1; i++) {
    if (buf[i] >= 0x81 && buf[i] <= 0xFE && buf[i + 1] >= 0x40 && buf[i + 1] <= 0xFE) {
      gbkPairs++;
      i++;
    }
  }
  if (gbkPairs > 5) return 'gbk';
  return 'utf-8';
}

function readFileAutoEncoding(filePath) {
  const buf = fs.readFileSync(filePath);
  const enc = detectEncoding(buf);
  if (enc === 'utf-8') return { text: buf.toString('utf-8').replace(/^\uFEFF/, ''), encoding: 'utf-8' };
  return { text: iconv.decode(buf, enc), encoding: enc };
}

function sha256(text) {
  return 'sha256:' + crypto.createHash('sha256').update(text, 'utf-8').digest('hex');
}

function sha256Binary(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 12);
}

/**
 * Collect local images referenced in markdown, copy them to assets/,
 * and rewrite the markdown paths to point to assets/{hashed-name}.
 * Remote URLs (http/https/data:) are left untouched.
 * Returns { rewritten: string, collected: number }.
 */
function collectLocalImages(content, rawFileDir, assetsDir) {
  let collected = 0;
  const rewritten = content.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, ref) => {
    if (/^(https?:|data:)/i.test(ref)) return match;
    const absPath = path.resolve(rawFileDir, ref);
    if (!fs.existsSync(absPath)) return match;
    const ext = path.extname(absPath).toLowerCase();
    if (!IMAGE_EXTS.has(ext)) return match;
    const hash = sha256Binary(fs.readFileSync(absPath));
    const assetName = `img-${hash}${ext}`;
    const dest = path.join(assetsDir, assetName);
    if (!fs.existsSync(dest)) fs.copyFileSync(absPath, dest);
    collected++;
    return `![${alt}](assets/${assetName})`;
  });
  return { rewritten, collected };
}

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9\u4e00-\u9fff-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    || 'page';
}

function detectLanguage(text) {
  const sample = text.slice(0, 2000);
  const cjk = (sample.match(/[\u4e00-\u9fff]/g) || []).length;
  const ascii = (sample.match(/[a-zA-Z]/g) || []).length;
  return cjk > ascii * 0.3 ? 'zh' : 'en';
}

function countWords(text) {
  const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const ascii = (text.match(/[a-zA-Z]+/g) || []).length;
  return cjk + ascii;
}

function countImages(text) {
  return (text.match(/!\[.*?\]\(.*?\)/g) || []).length;
}

function extractSegments(text) {
  const segments = [];
  const pattern = /^(#{1,6})\s+(.+)$/gm;
  let match;
  let idx = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (segments.length > 0) {
      segments[segments.length - 1].end_char = match.index;
    }
    segments.push({
      index: idx++,
      heading: match[2].trim(),
      start_char: match.index,
      end_char: text.length,
      level: match[1].length,
    });
  }

  if (segments.length === 0) {
    segments.push({
      index: 0,
      heading: '(full document)',
      start_char: 0,
      end_char: text.length,
      level: 0,
    });
  }

  return segments;
}

function detectSourceType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    '.md': 'markdown', '.txt': 'markdown',
    '.pdf': 'pdf', '.html': 'html', '.htm': 'html',
    '.pptx': 'ppt', '.ppt': 'ppt',
    '.docx': 'word', '.doc': 'word',
    '.xlsx': 'excel', '.xls': 'excel',
    '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.gif': 'image', '.webp': 'image',
    '.mp4': 'video', '.mkv': 'video', '.avi': 'video',
    '.mp3': 'audio', '.wav': 'audio', '.m4a': 'audio',
  };
  return map[ext] || 'markdown';
}

function generateSourceId(filePath) {
  const date = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const slug = slugify(path.basename(filePath, path.extname(filePath)));
  return `src-${date}-${slug}`.slice(0, 80);
}

/**
 * Normalize a Markdown file into the Curated Markdown Contract format.
 * 
 * @param {string} rawFilePath - Absolute path to the raw file
 * @param {object} options
 * @param {string} options.topicId - e.g. "admin/pharma"
 * @param {string} options.normalizedDir - e.g. "data/users/admin/topics/pharma/normalized"
 * @param {string} options.rawRelPath - Relative path in raw/ for provenance
 * @returns {{ sourceId: string, sourceDir: string }}
 */
function normalizeMarkdown(rawFilePath, options = {}) {
  const { text: rawContent, encoding: detectedEncoding } = readFileAutoEncoding(rawFilePath);
  const { topicId = 'admin/default', normalizedDir, rawRelPath } = options;

  const sourceId = generateSourceId(rawFilePath);
  const sourceDir = path.join(normalizedDir, sourceId);
  const assetsDir = path.join(sourceDir, 'assets');

  fs.mkdirSync(assetsDir, { recursive: true });

  const rawFileDir = path.dirname(rawFilePath);
  const { rewritten: content, collected } = collectLocalImages(rawContent, rawFileDir, assetsDir);

  fs.writeFileSync(path.join(sourceDir, 'content.md'), content);

  const rawStats = fs.statSync(rawFilePath);
  const now = new Date().toISOString();

  const metadata = {
    source_id: sourceId,
    topic_id: topicId,
    raw_path: rawRelPath || `raw/${path.basename(rawFilePath)}`,
    source_type: detectSourceType(rawFilePath),
    original_filename: path.basename(rawFilePath),
    created_at: now,
    language: detectLanguage(content),
    processing_status: 'deterministic_normalized',
    content_hash: sha256(content),
    normalize_version: CONTRACT_VERSION,
    page_count: 1,
    word_count: countWords(content),
    image_count: countImages(content),
    collected_images: collected,
    detected_encoding: detectedEncoding,
  };

  fs.writeFileSync(
    path.join(sourceDir, 'metadata.json'),
    JSON.stringify(metadata, null, 2) + '\n'
  );

  const provenance = {
    source_id: sourceId,
    raw_path: metadata.raw_path,
    raw_hash: sha256(content),
    raw_size_bytes: rawStats.size,
    upload_time: now,
    normalize_time: now,
    normalize_pipeline: [
      ...(detectedEncoding !== 'utf-8' ? [{ step: 'encoding_convert', from: detectedEncoding, to: 'utf-8', tool: 'iconv-lite' }] : []),
      { step: 'copy_md', tool: 'knowlever-normalize@' + CONTRACT_VERSION, duration_ms: 0 },
      ...(collected > 0 ? [{ step: 'collect_images', tool: 'builtin', count: collected, duration_ms: 0 }] : []),
      { step: 'metadata_extract', tool: 'builtin', duration_ms: 0 },
      { step: 'segment_extract', tool: 'builtin', duration_ms: 0 },
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

  return { sourceId, sourceDir };
}

module.exports = {
  normalizeMarkdown,
  generateSourceId,
  detectSourceType,
  detectLanguage,
  detectEncoding,
  readFileAutoEncoding,
  countWords,
  countImages,
  extractSegments,
  sha256,
  slugify,
  CONTRACT_VERSION,
};
