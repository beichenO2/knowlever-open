#!/usr/bin/env node
/**
 * Layer 2A Deterministic Normalizer for Video files.
 * 
 * Pipeline:
 *   1. ffprobe → get duration
 *   2. ffmpeg → extract audio track (WAV 16kHz mono)
 *   3. Qwen3-ASR (MLX) → timestamped transcript
 *   4. ffmpeg → extract keyframes at interval
 *   5. Copy keyframes to normalized/{source_id}/assets/
 *   6. Produce content.md with transcript + frame references
 * 
 * Frame extraction policy varies by domain:
 *   - medical/academic: every 10-15s, VLM analysis in Layer 2B
 *   - tech: every 30s
 *   - finance/general: skip frames
 * 
 * Requires: ffmpeg, ffprobe, mlx-qwen3-asr (mlx-qwen3-asr CLI)
 */
const { execSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { CONTRACT_VERSION, slugify, sha256, detectLanguage, countWords, extractSegments } = require('./normalize-md');
const { shouldDomainKeepImages } = require('./image-policy');

const VIDEO_EXTS = new Set(['.mp4', '.mkv', '.avi', '.mov', '.webm', '.m4v', '.flv']);

const FRAME_POLICY = {
  medical:  { extract: true, interval: 10, maxFrames: 30 },
  academic: { extract: true, interval: 15, maxFrames: 20 },
  tech:     { extract: true, interval: 30, maxFrames: 15 },
  finance:  { extract: true, interval: 30, maxFrames: 15 },
  general:  { extract: false, interval: 0, maxFrames: 0 },
};

function isVideoFile(filePath) {
  return VIDEO_EXTS.has(path.extname(filePath).toLowerCase());
}

function getVideoDuration(videoPath) {
  try {
    const output = execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`,
      { encoding: 'utf-8', timeout: 10000 }
    );
    return parseFloat(output.trim()) || 0;
  } catch {
    return 0;
  }
}

function formatTimestamp(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function extractAudio(videoPath, outputDir) {
  const audioPath = path.join(outputDir, 'audio.wav');
  try {
    execSync(
      `ffmpeg -y -i "${videoPath}" -vn -acodec pcm_s16le -ar 16000 -ac 1 "${audioPath}"`,
      { timeout: 600000, encoding: 'utf-8', stdio: 'pipe' }
    );
    return fs.existsSync(audioPath) ? audioPath : null;
  } catch (e) {
    console.error(`  [audio] extraction failed: ${e.message?.slice(0, 120)}`);
    return null;
  }
}

function transcribeWithQwen3ASR(audioPath, options = {}) {
  const model = options.model || 'Qwen/Qwen3-ASR-0.6B';
  const lang = options.language ? `--language ${options.language}` : '--language Chinese';

  try {
    const outDir = path.join(path.dirname(audioPath), 'qwen3-asr-out');
    fs.mkdirSync(outDir, { recursive: true });

    const asrBin = process.env.QWEN3_ASR_BIN || 'mlx-qwen3-asr';
    const timeoutMs = Math.max(3600000, 10 * 60 * 1000);
    execSync(
      `${asrBin} "${audioPath}" --model ${model} ${lang} -f json --timestamps -o "${outDir}"`,
      { timeout: timeoutMs, encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024, stdio: 'pipe' }
    );

    const base = path.basename(audioPath, path.extname(audioPath));
    const jsonPath = path.join(outDir, `${base}.json`);
    if (!fs.existsSync(jsonPath)) return null;

    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    const segments = (data.segments || []).map(s => ({
      start: s.start,
      end: s.end,
      text: s.text?.trim() || '',
    }));

    return { text: data.text || '', segments, method: 'qwen3-asr-mlx' };
  } catch (e) {
    console.error(`  [qwen3-asr] transcription failed: ${e.message?.slice(0, 200)}`);
    return null;
  }
}

/**
 * Detect topic transition points from ASR segments.
 * Looks for: long pauses, topic keyword shifts, sentence-ending patterns.
 * Returns timestamps (seconds) where the speaker changes topic.
 */
function detectTopicTransitions(whisperSegments, maxPoints) {
  if (!whisperSegments || whisperSegments.length < 3) return [];

  const transitions = [];

  for (let i = 1; i < whisperSegments.length; i++) {
    const prev = whisperSegments[i - 1];
    const curr = whisperSegments[i];
    let score = 0;

    const gap = curr.start - prev.end;
    if (gap > 3.0) score += 3;
    else if (gap > 1.5) score += 2;
    else if (gap > 0.8) score += 1;

    const prevWords = new Set((prev.text || '').split(/\s+/).map(w => w.toLowerCase()));
    const currWords = new Set((curr.text || '').split(/\s+/).map(w => w.toLowerCase()));
    let overlap = 0;
    for (const w of currWords) { if (prevWords.has(w)) overlap++; }
    const similarity = currWords.size > 0 ? overlap / currWords.size : 1;
    if (similarity < 0.15) score += 2;
    else if (similarity < 0.3) score += 1;

    if (/[。！？.!?]$/.test((prev.text || '').trim())) score += 1;

    const transitionWords = /^(接下来|然后|下面|第[一二三四五六七八九十\d]|next|now|so|let'?s|另外|此外|首先|其次|最后|总结)/i;
    if (transitionWords.test((curr.text || '').trim())) score += 2;

    if (score >= 3) {
      transitions.push({ timestamp: curr.start, score, context: curr.text?.slice(0, 60) });
    }
  }

  transitions.sort((a, b) => b.score - a.score);
  const selected = transitions.slice(0, maxPoints);
  selected.sort((a, b) => a.timestamp - b.timestamp);

  const minGap = 30;
  const deduplicated = [];
  for (const t of selected) {
    if (deduplicated.length === 0 || t.timestamp - deduplicated[deduplicated.length - 1].timestamp >= minGap) {
      deduplicated.push(t);
    }
  }

  return deduplicated;
}

/**
 * Extract specific frames at given timestamps using ffmpeg.
 */
function extractFramesAtTimestamps(videoPath, outputDir, timestamps) {
  const framesDir = path.join(outputDir, 'frames');
  fs.mkdirSync(framesDir, { recursive: true });
  const results = [];

  for (let i = 0; i < timestamps.length; i++) {
    const ts = timestamps[i];
    const outFile = `frame_${String(i + 1).padStart(4, '0')}.jpg`;
    const outPath = path.join(framesDir, outFile);
    try {
      execSync(
        `ffmpeg -y -ss ${ts.timestamp} -i "${videoPath}" -vframes 1 -q:v 2 "${outPath}"`,
        { timeout: 30000, stdio: 'pipe' }
      );
      if (fs.existsSync(outPath) && fs.statSync(outPath).size > 1000) {
        results.push({
          file: outFile,
          path: outPath,
          index: i + 1,
          timestamp: ts.timestamp,
          context: ts.context || '',
        });
      }
    } catch { /* skip failed frame */ }
  }
  return results;
}

/**
 * Fallback: extract keyframes at fixed interval (used when no ASR data).
 */
function extractKeyframesFixedInterval(videoPath, outputDir, duration, maxFrames) {
  const framesDir = path.join(outputDir, 'frames');
  fs.mkdirSync(framesDir, { recursive: true });

  const interval = Math.max(30, Math.ceil(duration / maxFrames));

  try {
    execSync(
      `ffmpeg -y -i "${videoPath}" -vf "fps=1/${interval}" -q:v 2 "${framesDir}/frame_%04d.jpg"`,
      { timeout: 300000, encoding: 'utf-8', stdio: 'pipe' }
    );

    const frames = fs.readdirSync(framesDir)
      .filter(f => f.endsWith('.jpg'))
      .sort()
      .slice(0, maxFrames);

    return frames.map(f => ({
      file: f,
      path: path.join(framesDir, f),
      index: parseInt(f.replace(/\D/g, '')) || 0,
      timestamp: (parseInt(f.replace(/\D/g, '')) || 0) * interval,
    }));
  } catch {
    return [];
  }
}

function generateSourceId(filePath) {
  const date = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const slug = slugify(path.basename(filePath, path.extname(filePath)));
  return `src-${date}-vid-${slug}`.slice(0, 80);
}

/**
 * Normalize a video file into the Curated Markdown Contract format.
 */
function normalizeVideo(rawFilePath, options = {}) {
  const { topicId = 'admin/default', normalizedDir, rawRelPath, domain = 'academic', language } = options;
  const whisperModel = 'Qwen/Qwen3-ASR-0.6B';

  const sourceId = generateSourceId(rawFilePath);
  const sourceDir = path.join(normalizedDir, sourceId);
  const assetsDir = path.join(sourceDir, 'assets');
  const tmpDir = path.join(sourceDir, '.tmp');
  fs.mkdirSync(assetsDir, { recursive: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  const duration = getVideoDuration(rawFilePath);
  const pipelineSteps = [];

  // Step 1: Audio extraction + transcription
  let transcript = null;
  const audioPath = extractAudio(rawFilePath, tmpDir);
  if (audioPath) {
    pipelineSteps.push({ step: 'audio_extract', tool: 'ffmpeg', duration_ms: 0 });
    transcript = transcribeWithQwen3ASR(audioPath, { model: whisperModel, language });
    if (transcript) {
      pipelineSteps.push({ step: 'transcribe', tool: `qwen3-asr-${whisperModel}`, duration_ms: 0 });
    }
  }

  // Step 2: Keyframe extraction — smart (Whisper-guided) or fallback (fixed interval)
  const domainPolicy = shouldDomainKeepImages(domain);
  const policy = FRAME_POLICY[domain] || FRAME_POLICY.general;
  let frames = [];
  let frameMethod = 'none';

  if (policy.extract && domainPolicy.keepImages) {
    if (transcript && transcript.segments && transcript.segments.length >= 3) {
      const transitions = detectTopicTransitions(transcript.segments, policy.maxFrames);
      if (transitions.length > 0) {
        frames = extractFramesAtTimestamps(rawFilePath, tmpDir, transitions);
        frameMethod = 'whisper-guided';
        pipelineSteps.push({
          step: 'keyframe_extract',
          tool: 'ffmpeg+whisper-transitions',
          duration_ms: 0,
          frames: frames.length,
          transitions_detected: transitions.length,
        });
      }
    }

    if (frames.length === 0) {
      frames = extractKeyframesFixedInterval(rawFilePath, tmpDir, duration, policy.maxFrames);
      frameMethod = 'fixed-interval';
      pipelineSteps.push({ step: 'keyframe_extract', tool: 'ffmpeg-fixed', duration_ms: 0, frames: frames.length });
    }

    for (const frame of frames) {
      const hash = crypto.createHash('md5').update(fs.readFileSync(frame.path)).digest('hex').slice(0, 8);
      const destName = `frame-${formatTimestamp(frame.timestamp).replace(/:/g, '')}-${hash}.jpg`;
      fs.copyFileSync(frame.path, path.join(assetsDir, destName));
      frame.assetName = destName;
    }
  }

  // Build content.md
  const sections = [];
  const filename = path.basename(rawFilePath);
  sections.push(`# ${filename}`);
  sections.push('');
  sections.push(`*Duration: ${formatTimestamp(duration)} | Domain: ${domain}*`);
  sections.push('');
  sections.push('> ⚠️ **ASR 水印**：本转录由 Qwen3-ASR (MLX) 自动生成，ASR 结果不保证语意不变。后续处理 LLM 需要上下文梳理和事实核查、术语核查。');
  sections.push('');

  if (transcript && transcript.segments.length > 0) {
    sections.push('## Transcript');
    sections.push('');
    for (const seg of transcript.segments) {
      sections.push(`**[${formatTimestamp(seg.start)}]** ${seg.text}`);
      sections.push('');
    }
  } else if (transcript && transcript.text) {
    sections.push('## Transcript');
    sections.push('');
    sections.push(transcript.text);
    sections.push('');
  }

  if (frames.length > 0) {
    sections.push(`## Keyframes (${frameMethod})`);
    sections.push('');
    for (const frame of frames) {
      if (frame.assetName) {
        const contextNote = frame.context ? ` — ${frame.context}` : '';
        sections.push(`### ${formatTimestamp(frame.timestamp)}${contextNote}`);
        sections.push('');
        sections.push(`![Frame at ${formatTimestamp(frame.timestamp)}](assets/${frame.assetName})`);
        sections.push('');
      }
    }
  }

  if (!transcript && frames.length === 0) {
    sections.push('> Video normalization produced no transcript or frames.');
    sections.push('> This may indicate missing ffmpeg/qwen3-asr or an unsupported format.');
  }

  const content = sections.join('\n');
  fs.writeFileSync(path.join(sourceDir, 'content.md'), content);

  const now = new Date().toISOString();
  const rawStats = fs.statSync(rawFilePath);

  const metadata = {
    source_id: sourceId,
    topic_id: topicId,
    raw_path: rawRelPath || `raw/${filename}`,
    source_type: 'video',
    original_filename: filename,
    created_at: now,
    language: transcript ? detectLanguage(transcript.text || '') : 'unknown',
    processing_status: 'deterministic_normalized',
    content_hash: sha256(content),
    normalize_version: CONTRACT_VERSION,
    page_count: 1,
    word_count: transcript ? countWords(transcript.text || '') : 0,
    image_count: frames.length,
    video_duration_seconds: Math.round(duration),
    video_domain: domain,
    transcript_method: transcript?.method || 'none',
    frames_extracted: frames.length,
    frame_method: frameMethod,
  };

  fs.writeFileSync(
    path.join(sourceDir, 'metadata.json'),
    JSON.stringify(metadata, null, 2) + '\n'
  );

  const provenance = {
    source_id: sourceId,
    raw_path: metadata.raw_path,
    raw_hash: sha256(filename),
    raw_size_bytes: rawStats.size,
    upload_time: now,
    normalize_time: now,
    normalize_pipeline: pipelineSteps,
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

  // Cleanup tmp
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}

  return {
    sourceId,
    sourceDir,
    duration: Math.round(duration),
    transcriptMethod: transcript?.method || 'none',
    framesExtracted: frames.length,
  };
}

module.exports = { normalizeVideo, isVideoFile, VIDEO_EXTS, getVideoDuration, formatTimestamp };
