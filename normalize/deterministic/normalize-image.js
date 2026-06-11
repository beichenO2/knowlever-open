#!/usr/bin/env node
/**
 * Layer 2A Deterministic Normalizer for Image files.
 * 
 * Images are first-class knowledge objects in KnowLever.
 * Not every image becomes a wiki page — only those with independent
 * knowledge significance get promoted to diagram pages.
 * 
 * This normalizer:
 *   1. Copies the image to normalized/{source_id}/assets/
 *   2. Creates metadata.json with image-specific fields
 *   3. Creates content.md with image reference
 *   4. When ocr=true: sends image to VLM for text extraction (textbook photos, etc.)
 *   5. Optionally: Layer 2B will add semantic.json with VLM analysis
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { CONTRACT_VERSION, slugify, sha256 } = require('./normalize-md');

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.tiff']);

function isImageFile(filePath) {
  return IMAGE_EXTS.has(path.extname(filePath).toLowerCase());
}

function imageHash(filePath) {
  const data = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(data).digest('hex').slice(0, 12);
}

function generateSourceId(filePath) {
  const date = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const slug = slugify(path.basename(filePath, path.extname(filePath)));
  return `src-${date}-img-${slug}`.slice(0, 80);
}

let POLARPRIVATE_URL = process.env.POLARPRIVATE_URL || 'http://127.0.0.1:12790';
try {
  const { loadConfig } = require('../../lib/llm-proxy');
  const cfg = loadConfig();
  if (cfg.llm?.base_url) POLARPRIVATE_URL = cfg.llm.base_url;
} catch {}
/** Opaque capability codes (4-bit QCSA / V-prefix) — PolarPrivate maps to upstream. */
const LOCAL_VLM = 'L0000';
const CLOUD_VLM = 'V1000';

let _vlmAvailable = null; // cached per-process

function postJsonSync(url, body, timeoutMs = 60000) {
  const { execSync } = require('child_process');
  const tmpIn = path.join(require('os').tmpdir(), `kl-vlm-${Date.now()}.json`);
  const tmpOut = path.join(require('os').tmpdir(), `kl-vlm-out-${Date.now()}.json`);
  fs.writeFileSync(tmpIn, JSON.stringify(body));
  try {
    execSync(
      `curl -s -X POST "${url}" -H "Content-Type: application/json" -d @"${tmpIn}" -o "${tmpOut}" --max-time ${Math.ceil(timeoutMs / 1000)}`,
      { timeout: timeoutMs + 5000, stdio: 'pipe' }
    );
    if (fs.existsSync(tmpOut)) {
      const raw = fs.readFileSync(tmpOut, 'utf-8');
      return JSON.parse(raw);
    }
  } catch { /* fall through */ }
  finally {
    try { fs.unlinkSync(tmpIn); } catch {}
    try { fs.unlinkSync(tmpOut); } catch {}
  }
  return null;
}

/**
 * Check once if VLM is available. Cached for process lifetime.
 */
function checkVLMAvailable() {
  if (_vlmAvailable !== null) return _vlmAvailable;
  const url = `${POLARPRIVATE_URL}/v1/chat/completions`;
  const result = postJsonSync(url, {
    model: LOCAL_VLM,
    messages: [{ role: 'user', content: 'ping' }],
    max_tokens: 1, stream: false,
  }, 10000);
  _vlmAvailable = !!(result?.choices);
  return _vlmAvailable;
}

function _visionBody(imagePath, systemPrompt, userText) {
  const imgData = fs.readFileSync(imagePath);
  const b64 = imgData.toString('base64');
  const ext = path.extname(imagePath).toLowerCase().slice(1);
  const mimeType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;
  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({
    role: 'user',
    content: [
      { type: 'image_url', image_url: { url: `data:${mimeType};base64,${b64}` } },
      { type: 'text', text: userText },
    ],
  });
  return { messages, mimeType };
}

/**
 * Local VLM OCR via PolarPrivate L101 → Ollama.
 */
function ocrViaLocalVLM(imagePath) {
  const { messages } = _visionBody(
    imagePath,
    null,
    'OCR this image. Output ALL text exactly as written. Use markdown formatting (## for headings, - for lists, | for tables). Do NOT summarize. Do NOT add commentary. Start directly with the text content.',
  );
  const result = postJsonSync(`${POLARPRIVATE_URL}/v1/chat/completions`, {
    model: LOCAL_VLM,
    messages,
    max_tokens: 4096,
    temperature: 0.0,
    stream: false,
  }, 180000);
  return result?.choices?.[0]?.message?.content || null;
}

/**
 * Cloud VLM OCR via PolarPrivate capability V1000.
 */
function ocrViaCloudVLM(imagePath) {
  const { messages } = _visionBody(
    imagePath,
    '你是一个OCR引擎。你的唯一任务是逐字提取图片中的全部文字。禁止添加任何解释、总结、评论。直接输出原文。',
    '逐字提取图中所有文字。保留原始格式（标题用##，列表用-，表格用|）。公式用LaTeX。直接输出原文，不加任何说明。',
  );
  const result = postJsonSync(`${POLARPRIVATE_URL}/v1/chat/completions`, {
    model: CLOUD_VLM,
    messages,
    max_tokens: 4096,
    temperature: 0.0,
    stream: false,
  }, 120000);
  return result?.choices?.[0]?.message?.content || null;
}

/** @deprecated use ocrViaLocalVLM / ocrViaCloudVLM */
function ocrViaVLM(imagePath) {
  return ocrViaCloudVLM(imagePath);
}

let _sotagentChecked = null;
const SOTAGENT_URL = process.env.SOTAGENT_URL || 'http://localhost:4800';

/**
 * Submit OCR task to SOTAgent for async GPU processing.
 * Returns task ID string or null. Non-blocking: skips if SOTAgent unreachable.
 */
function submitOCRToSOTAgent(imagePath, outputPath) {
  if (_sotagentChecked === false) return null;

  const { execSync } = require('child_process');
  if (_sotagentChecked === null) {
    try {
      execSync(`curl -s --max-time 2 "${SOTAGENT_URL}/api/tasks" -o /dev/null`, { stdio: 'pipe' });
      _sotagentChecked = true;
    } catch {
      _sotagentChecked = false;
      return null;
    }
  }

  const ppPort = process.env.POLARPRIVATE_PORT || '12790';
  const prompt = 'OCR this image. Output ALL text exactly as written. Use markdown formatting. Do NOT summarize or add commentary.';
  const escaped = prompt.replace(/'/g, "\\'");

  const script = `python3 -c "
import json, base64, urllib.request
img = open('${imagePath}', 'rb').read()
b64 = base64.b64encode(img).decode()
body = {
  'model': 'V1000',
  'messages': [{'role': 'user', 'content': [
    {'type': 'image_url', 'image_url': {'url': 'data:image/jpeg;base64,' + b64}},
    {'type': 'text', 'text': '${escaped}'},
  ]}],
  'max_tokens': 4096, 'temperature': 0.0,
}
resp = urllib.request.urlopen(urllib.request.Request(
    'http://127.0.0.1:${ppPort}/v1/chat/completions',
    data=json.dumps(body).encode(),
    headers={'Content-Type': 'application/json'}
), timeout=120)
result = json.loads(resp.read())
text = result.get('choices', [{}])[0].get('message', {}).get('content', '')
open('${outputPath}', 'w').write(json.dumps({'ocr_text': text, 'model': 'V1000'}, ensure_ascii=False, indent=2))
print('Done:', '${outputPath}')
"`;

  const taskBody = {
    requester: 'knowlever',
    task_type: 'vlm',
    command: script,
    priority: 3,
    estimated_duration_sec: 120,
    checkpoint_path: outputPath,
  };

  const result = postJsonSync(`${SOTAGENT_URL}/api/tasks`, taskBody, 10000);
  if (result?.id || result?.task_id) {
    return result.id || result.task_id;
  }
  return null;
}

/**
 * Normalize an image file into the Curated Markdown Contract format.
 * @param {string} rawFilePath
 * @param {Object} options
 * @param {boolean} options.ocr - Attempt OCR text extraction
 * @param {string} options.domain - Domain hint for OCR prompts
 */
function normalizeImage(rawFilePath, options = {}) {
  const { topicId = 'admin/default', normalizedDir, rawRelPath, ocr = false, domain } = options;

  const ext = path.extname(rawFilePath).toLowerCase();
  const hash = imageHash(rawFilePath);
  const sourceId = generateSourceId(rawFilePath);
  const sourceDir = path.join(normalizedDir, sourceId);
  const assetsDir = path.join(sourceDir, 'assets');

  fs.mkdirSync(assetsDir, { recursive: true });

  const assetName = `img-${hash}${ext}`;
  fs.copyFileSync(rawFilePath, path.join(assetsDir, assetName));

  const filename = path.basename(rawFilePath);
  let ocrText = null;
  let ocrMethod = 'none';

  if (ocr) {
    ocrText = ocrViaLocalVLM(rawFilePath);
    if (ocrText) {
      ocrMethod = 'local-L0000';
    } else {
      ocrText = ocrViaCloudVLM(rawFilePath);
      if (ocrText) {
        ocrMethod = 'cloud-V1000';
      } else {
        const pendingPath = path.join(sourceDir, 'ocr-pending.json');
        const taskId = submitOCRToSOTAgent(rawFilePath, path.join(sourceDir, 'ocr-result.json'));
        if (taskId) {
          ocrMethod = 'sotagent-pending';
          fs.writeFileSync(pendingPath, JSON.stringify({ taskId, submitted_at: new Date().toISOString() }, null, 2) + '\n');
        }
      }
    }
  }

  let content;
  if (ocrText) {
    const cleanTitle = filename.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ');
    content = `# ${cleanTitle}\n\n> OCR extracted from: ${filename}\n\n![${filename}](assets/${assetName})\n\n${ocrText}\n`;
  } else {
    content = `# ${filename}\n\n![${filename}](assets/${assetName})\n\n> Image awaiting ${ocr ? 'async OCR processing' : 'Layer 2B semantic analysis'}.\n`;
  }
  fs.writeFileSync(path.join(sourceDir, 'content.md'), content);

  const rawStats = fs.statSync(rawFilePath);
  const now = new Date().toISOString();
  const wordCount = ocrText ? ocrText.split(/\s+/).length : 0;

  const metadata = {
    source_id: sourceId,
    topic_id: topicId,
    raw_path: rawRelPath || `raw/${path.basename(rawFilePath)}`,
    source_type: 'image',
    original_filename: filename,
    created_at: now,
    language: ocrText ? 'zh' : 'none',
    processing_status: ocrText ? 'ocr_complete' : (ocrMethod === 'sotagent-pending' ? 'ocr_pending' : 'deterministic_normalized'),
    content_hash: `sha256:${hash}`,
    normalize_version: CONTRACT_VERSION,
    page_count: 1,
    word_count: wordCount,
    image_count: 1,
    image_format: ext.slice(1),
    image_size_bytes: rawStats.size,
    asset_path: `assets/${assetName}`,
    ocr_method: ocrMethod,
  };

  fs.writeFileSync(
    path.join(sourceDir, 'metadata.json'),
    JSON.stringify(metadata, null, 2) + '\n'
  );

  const provenance = {
    source_id: sourceId,
    raw_path: metadata.raw_path,
    raw_hash: `sha256:${hash}`,
    raw_size_bytes: rawStats.size,
    upload_time: now,
    normalize_time: now,
    normalize_pipeline: [
      { step: 'image_copy', tool: 'knowlever-normalize@' + CONTRACT_VERSION, duration_ms: 0 },
      { step: 'metadata_extract', tool: 'builtin', duration_ms: 0 },
      ...(ocrText ? [{ step: 'ocr_vlm', tool: ocrMethod, duration_ms: 0 }] : []),
    ],
    semantic_pipeline: [],
    parent_source: null,
    derived_from: null,
  };

  fs.writeFileSync(
    path.join(sourceDir, 'provenance.json'),
    JSON.stringify(provenance, null, 2) + '\n'
  );

  fs.writeFileSync(
    path.join(sourceDir, 'segments.json'),
    JSON.stringify([{ index: 0, heading: filename, start_char: 0, end_char: content.length, level: 1 }], null, 2) + '\n'
  );

  return { sourceId, sourceDir, assetName, ocrMethod, ocrText: !!ocrText };
}

function _askVLM(imagePath, prompt) {
  const { messages } = _visionBody(imagePath, null, prompt);
  const localResult = postJsonSync(`${POLARPRIVATE_URL}/v1/chat/completions`, {
    model: LOCAL_VLM, messages, max_tokens: 256, temperature: 0.0, stream: false,
  }, 60000);
  if (localResult?.choices?.[0]?.message?.content) {
    return localResult.choices[0].message.content;
  }
  const cloudResult = postJsonSync(`${POLARPRIVATE_URL}/v1/chat/completions`, {
    model: CLOUD_VLM, messages, max_tokens: 256, temperature: 0.0, stream: false,
  }, 60000);
  return cloudResult?.choices?.[0]?.message?.content || null;
}

/**
 * Classify image via VLM for filtering decisions.
 * Two-step: classify first, then refine CHART results to distinguish
 * teaching charts from app screenshots.
 * @returns {{ category: string, raw: string }|null}
 */
function classifyImageVLM(imagePath) {
  const { IMAGE_CLASSIFY_PROMPT, IMAGE_REFINE_PROMPT, parseClassification, parseRefineResponse, CLASSIFICATION_MAP } = require('./image-policy');

  const raw = _askVLM(imagePath, IMAGE_CLASSIFY_PROMPT);
  if (!raw) return null;

  const category = parseClassification(raw);
  if (!category) return null;

  if (CLASSIFICATION_MAP[category]?.refine) {
    const refineRaw = _askVLM(imagePath, IMAGE_REFINE_PROMPT);
    const refined = parseRefineResponse(refineRaw);
    if (refined === 'app') {
      return { category: 'APP_SCREENSHOT', raw: refineRaw || raw };
    }
  }

  return { category, raw };
}

module.exports = {
  normalizeImage, isImageFile, imageHash, IMAGE_EXTS,
  ocrViaVLM, ocrViaLocalVLM, ocrViaCloudVLM, classifyImageVLM,
};
