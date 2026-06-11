#!/usr/bin/env node
/**
 * KnowLever 语料摄入管线
 * 
 * 流程：原始文件 → raw/ → Layer 2A normalize → normalized/ → wiki/
 * 
 * 用法：
 *   node wiki-engine/ingest.js <输入文件或目录> --topic <主题名> [--user admin]
 * 
 * 支持格式：.md .txt .pdf .pptx .ppt .png .jpg .gif .webp .svg .mp4 .mkv .avi .mov .webm
 * 额外支持：--from-codebase 摄入代码库（本地目录或 Git URL）
 */
const fs = require('fs');
const path = require('path');
const { ensureTopicDirs, ROOT } = require('../lib/paths');
const { normalizeMarkdown } = require('../normalize/deterministic/normalize-md');
const { normalizePdf } = require('../normalize/deterministic/normalize-pdf');
const { normalizeImage, isImageFile, classifyImageVLM } = require('../normalize/deterministic/normalize-image');
const { normalizeVideo, isVideoFile } = require('../normalize/deterministic/normalize-video');
const { normalizePpt, isPptFile } = require('../normalize/deterministic/normalize-ppt');
const { shouldDomainKeepImages, shouldKeepImage, detectDomain, CLASSIFICATION_MAP } = require('../normalize/deterministic/image-policy');
const { normalizeCodebase, isCodebase, isGitUrl } = require('../normalize/deterministic/normalize-codebase');
const { isFinderAlias, resolveAlias, resolveSmartPath, isVideoFile: isVideoFileAlias, walkDirWithAliasResolution } = require('../normalize/deterministic/resolve-alias');

const DIGIST_ROOT = process.env.DIGIST_ROOT || path.join(ROOT, '..', 'digist');
const DIGEST_NORMALIZER = path.join(DIGIST_ROOT, 'src', 'normalizer', 'index.ts');
const DIGEST_DB_DEFAULT = path.join(DIGIST_ROOT, 'data', 'digist.sqlite');

function parseArgs(args = process.argv.slice(2)) {
  let input = null;
  let topic = null;
  let user = undefined;
  let skipNormalize = false;
  let fromDigest = false;
  let fromCodebase = false;
  let since = null;
  let limit = 500;
  let platform = null;
  let recursive = false;
  let externalRef = false;
  let chapterDir = false;
  let domain = null;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--topic' || a === '-t') { topic = args[++i]; }
    else if (a === '--user' || a === '-u') { user = args[++i]; }
    else if (a === '--skip-normalize') { skipNormalize = true; }
    else if (a === '--from-digest') { fromDigest = true; }
    else if (a === '--from-codebase') { fromCodebase = true; }
    else if (a === '--since') { since = args[++i]; }
    else if (a === '--limit') { limit = parseInt(args[++i], 10) || 500; }
    else if (a === '--platform') { platform = args[++i]; }
    else if (a === '--recursive' || a === '-r') { recursive = true; }
    else if (a === '--external-ref') { externalRef = true; }
    else if (a === '--chapter-dir') { chapterDir = true; }
    else if (a === '--domain') { domain = args[++i]; }
    else if (!a.startsWith('-') && !input) { input = a; }
  }

  return { input, topic, user, skipNormalize, fromDigest, fromCodebase, since, limit, platform, recursive, externalRef, chapterDir, domain };
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

function formatDate(date) {
  return date.toISOString().split('T')[0];
}

function fileHash(filePath) {
  const content = fs.readFileSync(filePath);
  return require('crypto').createHash('sha256').update(content).digest('hex');
}

/**
 * Walk a directory recursively, returning all files with paths relative to root.
 * Skips .DS_Store, Thumbs.db, and hidden directories.
 * Auto-resolves Mac Finder aliases and symlinks.
 */
function walkDir(dir, rootDir = dir) {
  const results = [];
  const realDir = resolveSmartPath(dir);
  if (!fs.existsSync(realDir)) return results;

  for (const entry of fs.readdirSync(realDir)) {
    if (entry.startsWith('.') || entry === 'Thumbs.db' || entry === 'desktop.ini') continue;
    const full = path.join(realDir, entry);

    let resolved = full;
    let entryIsAlias = false;
    try {
      const lstat = fs.lstatSync(full);
      if (lstat.isSymbolicLink()) {
        resolved = fs.realpathSync(full);
        entryIsAlias = true;
      } else if (lstat.isFile() && isFinderAlias(full)) {
        const aliasTarget = resolveAlias(full);
        if (aliasTarget) {
          resolved = aliasTarget;
          entryIsAlias = true;
          console.log(`  [alias] ${entry} → ${aliasTarget}`);
        }
      }
    } catch { continue; }

    try {
      const rstat = fs.statSync(resolved);
      if (rstat.isDirectory()) {
        results.push(...walkDir(resolved, rootDir));
      } else if (rstat.isFile()) {
        results.push({
          absolute: resolved,
          relative: path.relative(rootDir, path.join(dir, entry)),
          isAlias: entryIsAlias,
        });
      }
    } catch { continue; }
  }
  return results;
}

const LARGE_FILE_THRESHOLD = 1024 * 1024 * 1024; // 1GB

/**
 * @returns {{ copied: string[], skipped: string[], externalRefs: string[], copiedOrigins: Set<string> }}
 *   copiedOrigins: Set of original absolute paths that were newly copied (for change detection).
 */
function copyToRaw(inputPath, rawDir, options = {}) {
  const { recursive = false, externalRef = false, videoAsRef = true } = options;
  fs.mkdirSync(rawDir, { recursive: true });
  const copied = [];
  const skipped = [];
  const externalRefs = [];
  const copiedOrigins = new Set();

  const resolvedInput = resolveSmartPath(inputPath);

  if (fs.statSync(resolvedInput).isDirectory()) {
    const files = recursive ? walkDir(resolvedInput) : fs.readdirSync(resolvedInput)
      .filter(f => {
        try {
          const full = path.join(resolvedInput, f);
          const resolved = resolveSmartPath(full);
          return fs.statSync(resolved).isFile();
        } catch { return false; }
      })
      .map(f => {
        const full = path.join(resolvedInput, f);
        const resolved = resolveSmartPath(full);
        return { absolute: resolved, relative: f, isAlias: resolved !== full };
      });

    for (const { absolute: src, relative: rel } of files) {
      const flatName = rel.replace(/[\\/]/g, '--');
      const stat = fs.statSync(src);
      const useExternalRef = externalRef
        || stat.size >= LARGE_FILE_THRESHOLD
        || (videoAsRef && isVideoFileAlias(src));

      if (useExternalRef) {
        const refFile = path.join(rawDir, `${flatName}.source-ref.json`);
        const ref = {
          type: 'external-reference',
          original_path: path.resolve(src),
          original_relative: rel,
          size_bytes: stat.size,
          created_at: new Date().toISOString(),
          reason: isVideoFileAlias(src) ? 'video-auto-ref' : (stat.size >= LARGE_FILE_THRESHOLD ? 'large-file' : 'user-requested'),
        };
        if (!fs.existsSync(refFile)) {
          fs.writeFileSync(refFile, JSON.stringify(ref, null, 2) + '\n');
          externalRefs.push(refFile);
          const sizeLabel = stat.size > 1024 * 1024 ? `${(stat.size / 1024 / 1024).toFixed(1)}MB` : `${(stat.size / 1024).toFixed(0)}KB`;
          const reason = isVideoFileAlias(src) ? 'video→ref' : 'external ref';
          console.log(`  [ref] ${rel} (${sizeLabel} → ${reason})`);
        } else {
          skipped.push(flatName);
        }
        copiedOrigins.add(path.resolve(src));
        continue;
      }

      const dest = path.join(rawDir, flatName);
      if (fs.existsSync(dest) && fileHash(src) === fileHash(dest)) {
        skipped.push(flatName);
        continue;
      }
      fs.copyFileSync(src, dest);
      copied.push(dest);
      copiedOrigins.add(path.resolve(src));
      console.log(`  [raw] ${rel}`);
    }
  } else {
    const stat = fs.statSync(resolvedInput);
    const useExternalRef = externalRef
      || stat.size >= LARGE_FILE_THRESHOLD
      || (videoAsRef && isVideoFileAlias(resolvedInput));

    if (useExternalRef) {
      const refFile = path.join(rawDir, `${path.basename(resolvedInput)}.source-ref.json`);
      const ref = {
        type: 'external-reference',
        original_path: path.resolve(resolvedInput),
        size_bytes: stat.size,
        created_at: new Date().toISOString(),
        reason: isVideoFileAlias(resolvedInput) ? 'video-auto-ref' : 'large-file',
      };
      if (!fs.existsSync(refFile)) {
        fs.writeFileSync(refFile, JSON.stringify(ref, null, 2) + '\n');
        externalRefs.push(refFile);
        console.log(`  [ref] ${path.basename(resolvedInput)} (${(stat.size / 1024 / 1024).toFixed(1)}MB → ref)`);
      }
      copiedOrigins.add(path.resolve(resolvedInput));
    } else {
      const dest = path.join(rawDir, path.basename(resolvedInput));
      if (fs.existsSync(dest) && fileHash(resolvedInput) === fileHash(dest)) {
        skipped.push(path.basename(resolvedInput));
      } else {
        fs.copyFileSync(resolvedInput, dest);
        copied.push(dest);
        copiedOrigins.add(path.resolve(resolvedInput));
        console.log(`  [raw] ${path.basename(resolvedInput)}`);
      }
    }
  }

  if (skipped.length > 0) {
    console.log(`  [skip] ${skipped.length} unchanged file(s)`);
  }

  return { copied, skipped, externalRefs, copiedOrigins };
}

function normalizeFile(rawFilePath, topicId, normalizedDir, extraOpts = {}) {
  let actualPath = rawFilePath;

  if (rawFilePath.endsWith('.source-ref.json')) {
    try {
      const ref = JSON.parse(fs.readFileSync(rawFilePath, 'utf-8'));
      if (ref.original_path && fs.existsSync(ref.original_path)) {
        actualPath = ref.original_path;
        console.log(`  [deref] ${path.basename(rawFilePath)} → ${actualPath}`);
      } else {
        console.log(`  [skip] ${path.basename(rawFilePath)} — original not found: ${ref.original_path}`);
        return null;
      }
    } catch (err) {
      console.log(`  [skip] ${path.basename(rawFilePath)} — invalid ref: ${err.message}`);
      return null;
    }
  }

  const rawRelPath = `raw/${path.basename(rawFilePath)}`;
  const ext = path.extname(actualPath).toLowerCase();

  if (ext === '.pdf') {
    const result = normalizePdf(actualPath, { topicId, normalizedDir, rawRelPath, domain: extraOpts.domain });
    console.log(`  [normalize] ${path.basename(actualPath)} → ${result.sourceId}/ (${result.method}, ${result.pages} pages)`);
    return result;
  }

  if (isPptFile(actualPath)) {
    const result = normalizePpt(actualPath, { topicId, normalizedDir, rawRelPath, domain: extraOpts.domain });
    const imgLabel = result.filteredImages > 0 ? `, ${result.keptImages} imgs kept, ${result.filteredImages} filtered` : `, ${result.keptImages} imgs`;
    console.log(`  [normalize] ${path.basename(actualPath)} → ${result.sourceId}/ (${result.method}, ${result.slides} slides${imgLabel})`);
    return result;
  }

  if (isImageFile(actualPath)) {
    const result = normalizeImage(actualPath, {
      topicId, normalizedDir, rawRelPath,
      ocr: extraOpts.ocr || false,
      domain: extraOpts.domain,
    });
    const ocrLabel = result.ocrText ? `OCR:${result.ocrMethod}` : (result.ocrMethod === 'sotagent-pending' ? 'OCR:pending' : 'no-ocr');
    console.log(`  [normalize] ${path.basename(actualPath)} → ${result.sourceId}/ (image ${ocrLabel})`);
    return result;
  }

  if (isVideoFile(actualPath)) {
    const result = normalizeVideo(actualPath, { topicId, normalizedDir, rawRelPath, domain: extraOpts.domain });
    console.log(`  [normalize] ${path.basename(actualPath)} → ${result.sourceId}/ (video ${result.duration}s, ${result.transcriptMethod}, ${result.framesExtracted} frames)`);
    return result;
  }

  const result = normalizeMarkdown(actualPath, { topicId, normalizedDir, rawRelPath });
  console.log(`  [normalize] ${path.basename(actualPath)} → ${result.sourceId}/`);
  return result;
}

function createWikiPage(sourceId, filePath, topic, wikiDir, normalizedDir) {
  const date = formatDate(new Date());
  const ext = path.extname(filePath).toLowerCase();

  let content;
  const normalizedContentPath = normalizedDir ? path.join(normalizedDir, sourceId, 'content.md') : null;
  if (normalizedContentPath && fs.existsSync(normalizedContentPath)) {
    content = fs.readFileSync(normalizedContentPath, 'utf-8');
  } else {
    content = fs.readFileSync(filePath, 'utf-8');
  }

  const slug = slugify(path.basename(filePath, path.extname(filePath)));
  const title = content.match(/^#\s+(.+)$/m)?.[1] || path.basename(filePath, path.extname(filePath));

  let output;
  if (content.startsWith('---')) {
    output = content;
  } else {
    output = `---
title: ${title}
type: ${/^\.(pdf|png|jpg|jpeg|gif|webp|svg)$/i.test(ext) ? 'source' : 'concept'}
tags: ${topic}
date: ${date}
status: draft
confidence: 0.5
source_ids:
  - ${sourceId}
---

${content}`;
  }

  fs.mkdirSync(wikiDir, { recursive: true });
  const outputPath = path.join(wikiDir, `${slug}.md`);
  fs.writeFileSync(outputPath, output);
  console.log(`  [wiki] ${path.basename(filePath)} → ${slug}.md (source: ${sourceId})`);
  return slug;
}

function main(args = process.argv.slice(2)) {
  const { input, topic, user, skipNormalize, fromDigest, fromCodebase, since, limit, platform, recursive, externalRef, chapterDir, domain } = parseArgs(args);

  if (fromDigest) {
    if (!topic) {
      console.log('Usage: node wiki-engine/ingest.js --from-digest --topic <name> [--since 2026-04-01] [--limit 500] [--platform twitter]');
      process.exit(0);
    }
    const { spawnSync } = require('child_process');
    const bridgeArgs = ['--from-db', '--topic', topic, '--user', user, '--limit', String(limit)];
    if (since) bridgeArgs.push('--since', since);
    if (platform) bridgeArgs.push('--platform', platform);
    const bridgePath = path.join(ROOT, 'scripts', 'digest-bridge.js');
    console.log(`[ingest] Delegating to digest-bridge (DB: ${DIGEST_DB_DEFAULT})`);
    const result = spawnSync(process.execPath, [bridgePath, ...bridgeArgs], { stdio: 'inherit', cwd: ROOT });
    process.exit(result.status || 0);
  }

  if (fromCodebase || isGitUrl(input || '')) {
    if (!topic) {
      console.log('Usage: node wiki-engine/ingest.js <repo-dir-or-url> --topic <name> --from-codebase [--user admin]');
      process.exit(0);
    }
    const resolved = ensureTopicDirs(topic, user);
    const topicId = `${user}/${topic}`;
    const repoInput = input || '';

    console.log(`[ingest] Codebase → Topic: ${topic} (user: ${user})`);
    console.log(`[ingest] Input: ${repoInput}`);
    console.log('');

    if (!isGitUrl(repoInput)) {
      console.log('[step 1] Record codebase origin in raw/');
      const repoName = path.basename(path.resolve(repoInput));
      const rawMarker = path.join(resolved.rawDir, `${repoName}.codebase.json`);
      fs.mkdirSync(resolved.rawDir, { recursive: true });
      fs.writeFileSync(rawMarker, JSON.stringify({
        type: 'codebase',
        name: repoName,
        original_path: path.resolve(repoInput),
        archived_at: new Date().toISOString(),
      }, null, 2) + '\n');
      console.log(`  [raw] ${repoName}.codebase.json (reference to ${path.resolve(repoInput)})`);
      console.log('');
    }

    console.log('[step 2] Layer 2A: Normalize codebase → normalized/');
    const result = normalizeCodebase(repoInput || input, {
      topicId,
      normalizedDir: resolved.normalizedDir,
      rawRelPath: `raw/${path.basename(path.resolve(repoInput || input))}`,
    });
    console.log(`  [normalize] ${result.projectInfo.name} → ${result.sourceId}/ (${result.method}, ${result.fileCount} files, ${result.projectInfo.languages.join('+')})`);
    console.log('');

    console.log('[step 3] Generate wiki/ page');
    const slug = createWikiPage(result.sourceId, path.join(result.sourceDir, 'content.md'), topic, resolved.wikiDir, resolved.normalizedDir);
    console.log('');

    console.log(`[ingest] Done — codebase "${result.projectInfo.name}" ingested to ${topic}`);
    console.log(`[ingest] Run: node wiki-engine/build.js --topic ${topic} --user ${user}`);
    return;
  }

  if (!input || !topic) {
    console.log('Usage: node wiki-engine/ingest.js <input> --topic <name> [--user admin]');
    console.log('');
    console.log('Examples:');
    console.log('  node wiki-engine/ingest.js ./notes.md --topic pharma');
    console.log('  node wiki-engine/ingest.js ./papers/ --topic cv --user admin');
    console.log('  node wiki-engine/ingest.js ./docs/ --topic my-docs -r        # recursive');
    console.log('  node wiki-engine/ingest.js --from-digest --topic ai-news --since 2026-04-01');
    console.log('  node wiki-engine/ingest.js --from-codebase ./my-project --topic my-lib');
    console.log('  node wiki-engine/ingest.js https://github.com/user/repo.git --topic repo-wiki');
    console.log('  node wiki-engine/ingest.js /ext/videos/ --topic course --external-ref --domain finance');
    console.log('  node wiki-engine/ingest.js /ext/course/ --topic course --chapter-dir --domain finance');
    console.log('');
    console.log('Options:');
    console.log('  -r, --recursive    Recurse into subdirectories');
    console.log('  --external-ref     Store references instead of copying large files');
    console.log('  --chapter-dir      Treat each subdirectory as a chapter/source-group');
    console.log('  --domain <name>    Hint domain for video frame policy (medical/academic/tech/finance)');
    console.log('  --skip-normalize   Skip Layer 2A normalization (raw → wiki only)');
    console.log('  --from-digest      Pull from DiGist SQLite database (uses digest-bridge)');
    console.log('  --from-codebase    Ingest a codebase directory or Git URL');
    console.log('  --since <date>     Only ingest items after this date (with --from-digest)');
    console.log('  --limit <n>        Max items to ingest (default: 500, with --from-digest)');
    console.log('  --platform <name>  Filter by platform (with --from-digest)');
    console.log('');
    console.log('Supported: .md .txt .pdf .png .jpg .jpeg .gif .webp .svg .mp4 .mkv .avi .mov .webm + codebases');
    process.exit(0);
  }

  if (!fs.existsSync(input)) {
    console.error(`[error] Input not found: ${input}`);
    process.exit(1);
  }

  // --chapter-dir: each subdirectory becomes a source group
  if (chapterDir && fs.statSync(input).isDirectory()) {
    const resolved = ensureTopicDirs(topic, user);
    const chapters = fs.readdirSync(input)
      .filter(d => { try { return fs.statSync(path.join(input, d)).isDirectory(); } catch { return false; } })
      .filter(d => !d.startsWith('.'))
      .sort();

    console.log(`[ingest] Chapter-dir mode: ${chapters.length} chapters in ${path.basename(input)}`);
    console.log(`[ingest] Topic: ${topic} (user: ${user})`);
    console.log('');

    let totalFiles = 0;
    for (const ch of chapters) {
      const chapterPath = path.join(input, ch);
      console.log(`── Chapter: ${ch} ──`);
      const chapterArgs = [chapterPath, '--topic', topic, '--user', user, '-r'];
      if (externalRef) chapterArgs.push('--external-ref');
      if (domain) chapterArgs.push('--domain', domain);
      if (skipNormalize) chapterArgs.push('--skip-normalize');
      main(chapterArgs);
      totalFiles++;
      console.log('');
    }
    console.log(`[ingest] All ${chapters.length} chapters processed for topic "${topic}"`);
    return;
  }

  if (fs.statSync(input).isDirectory() && !recursive && isCodebase(input)) {
    console.log(`[info] Detected codebase at ${input} — re-routing to codebase normalizer`);
    console.log('[info] (To skip auto-detection, use -r for recursive file ingest instead)');
    console.log('');
    const resolved = ensureTopicDirs(topic, user);
    const topicId = `${user}/${topic}`;
    const repoName = path.basename(path.resolve(input));
    fs.mkdirSync(resolved.rawDir, { recursive: true });
    const rawMarker = path.join(resolved.rawDir, `${repoName}.codebase.json`);
    fs.writeFileSync(rawMarker, JSON.stringify({
      type: 'codebase',
      name: repoName,
      original_path: path.resolve(input),
      archived_at: new Date().toISOString(),
    }, null, 2) + '\n');
    console.log(`  [raw] ${repoName}.codebase.json`);
    const result = normalizeCodebase(input, {
      topicId,
      normalizedDir: resolved.normalizedDir,
      rawRelPath: `raw/${repoName}`,
    });
    console.log(`  [normalize] ${result.projectInfo.name} → ${result.sourceId}/ (${result.fileCount} files)`);
    createWikiPage(result.sourceId, path.join(result.sourceDir, 'content.md'), topic, resolved.wikiDir, resolved.normalizedDir);
    console.log(`\n[ingest] Done — codebase "${result.projectInfo.name}" ingested to ${topic}`);
    console.log(`[ingest] Run: node wiki-engine/build.js --topic ${topic} --user ${user}`);
    return;
  }

  const resolved = ensureTopicDirs(topic, user);
  const topicId = `${user}/${topic}`;

  console.log(`[ingest] Topic: ${topic} (user: ${user})${recursive ? ' [recursive]' : ''}${externalRef ? ' [external-ref]' : ''}`);
  console.log(`[ingest] Input: ${input}`);
  console.log('');

  console.log('[step 1] Copy to raw/ (immutable source archive)');
  const { copied: rawFiles, skipped: rawSkipped, externalRefs, copiedOrigins } = copyToRaw(input, resolved.rawDir, { recursive, externalRef });
  if (externalRefs && externalRefs.length > 0) {
    console.log(`  [external] ${externalRefs.length} file(s) stored as external references`);
  }
  console.log('');

  const isDir = fs.statSync(input).isDirectory();
  const SUPPORTED_EXT = /\.(md|txt|pdf|pptx|ppt|png|jpg|jpeg|gif|webp|svg|mp4|mkv|avi|mov|webm)$/i;
  const allSourceFiles = isDir
    ? (recursive ? walkDir(input) : fs.readdirSync(input)
        .filter(f => { try { return fs.statSync(path.join(input, f)).isFile(); } catch { return false; } })
        .map(f => ({ absolute: path.join(input, f), relative: f })))
      .filter(({ relative }) => SUPPORTED_EXT.test(relative))
      .map(({ absolute }) => absolute)
    : (SUPPORTED_EXT.test(input) ? [input] : []);

  const sourceFiles = allSourceFiles.filter(f => copiedOrigins.has(path.resolve(f)));

  if (rawSkipped.length > 0 && sourceFiles.length < allSourceFiles.length) {
    console.log(`[info] ${allSourceFiles.length - sourceFiles.length} file(s) unchanged — skipping re-normalization`);
    console.log('');
  }

  const normalizeResults = [];
  const normalizeErrors = [];
  if (!skipNormalize && sourceFiles.length > 0) {
    const isImageBatch = sourceFiles.every(f => isImageFile(f));
    const effectiveDomain = domain || detectDomain(topic);
    const ocrEnabled = isImageBatch && effectiveDomain;

    const domainPolicy = shouldDomainKeepImages(effectiveDomain);
    const imageFiles = sourceFiles.filter(f => isImageFile(f));
    const nonImageFiles = sourceFiles.filter(f => !isImageFile(f));
    let imageFilteredCount = 0;

    if (imageFiles.length > 0 && !domainPolicy.keepImages) {
      console.log(`[step 2] 图片策略: ${effectiveDomain} → 不保留图片 (${domainPolicy.reason})`);
      imageFilteredCount = imageFiles.length;
    }

    const filesToNormalize = domainPolicy.keepImages ? sourceFiles : nonImageFiles;
    const imagesToNormalize = domainPolicy.keepImages ? imageFiles : [];

    let imageKeptCount = 0;
    let imageDiscardedCount = 0;
    let vlmReviewCount = 0;
    const keptImages = [];
    const pendingVLMReview = [];

    if (imagesToNormalize.length > 0) {
      for (let i = 0; i < imagesToNormalize.length; i++) {
        const f = imagesToNormalize[i];
        const stats = fs.statSync(f);
        const decision = shouldKeepImage({
          fileSize: stats.size,
          filename: path.basename(f),
          batchIndex: i,
          batchTotal: imagesToNormalize.length,
        });
        if (decision.needsVLMReview) {
          pendingVLMReview.push(f);
        } else if (decision.keep) {
          keptImages.push(f);
          imageKeptCount++;
        } else {
          console.log(`  [filter] ${path.basename(f)} → 跳过 (${decision.reason})`);
          imageDiscardedCount++;
        }
      }

      if (pendingVLMReview.length > 0) {
        console.log(`[step 2] VLM 调查: ${pendingVLMReview.length} 张图需要 VLM 分类...`);
        for (const f of pendingVLMReview) {
          const vlmResult = classifyImageVLM(f);
          if (vlmResult) {
            const mapped = CLASSIFICATION_MAP[vlmResult.category];
            const shouldKeep = mapped && (
              mapped.keep === 'always' ||
              (mapped.keep === 'domain' && domainPolicy.keepDomainImages) ||
              mapped.keep === true
            );
            if (shouldKeep) {
              keptImages.push(f);
              imageKeptCount++;
              console.log(`  [VLM ✅] ${path.basename(f)} → ${vlmResult.category} (${mapped.reason})`);
            } else if (mapped) {
              imageDiscardedCount++;
              const extra = mapped.keep === 'domain' ? ' (此领域仅保留架构图)' : '';
              console.log(`  [VLM ❌] ${path.basename(f)} → ${vlmResult.category} (${mapped.reason}${extra})`);
            }
            vlmReviewCount++;
          } else {
            imageDiscardedCount++;
            console.log(`  [VLM ??] ${path.basename(f)} → VLM 无响应，少而精原则过滤`);
          }
        }
      }

      if (imageDiscardedCount > 0 || vlmReviewCount > 0) {
        console.log(`[step 2] 图片筛选: ${imageKeptCount} 保留, ${imageDiscardedCount} 跳过${vlmReviewCount > 0 ? ` (其中 ${vlmReviewCount} 张经 VLM 调查)` : ''}`);
      }
    }

    const finalFiles = [...nonImageFiles, ...keptImages];
    const finalOcrEnabled = keptImages.length > 0 && keptImages.length === finalFiles.length && effectiveDomain;

    console.log(`[step 2] Layer 2A: Deterministic normalization → normalized/${finalOcrEnabled ? ' (OCR enabled)' : ''}`);
    if (imageFilteredCount > 0) {
      console.log(`  [info] ${imageFilteredCount} 张图片被领域策略过滤`);
    }
    for (const f of finalFiles) {
      try {
        normalizeResults.push(normalizeFile(f, topicId, resolved.normalizedDir, { ocr: isImageFile(f) && finalOcrEnabled, domain: effectiveDomain }));
      } catch (err) {
        console.log(`  [ERROR] ${path.basename(f)}: ${err.message}`);
        normalizeErrors.push({ file: path.basename(f), error: err.message });
        normalizeResults.push(null);
      }
    }
    sourceFiles.length = 0;
    sourceFiles.push(...finalFiles);
    console.log('');
  }

  if (sourceFiles.length > 0) {
    console.log(`[step ${skipNormalize ? 2 : 3}] Generate wiki/ pages`);
    const slugs = [];
    for (let i = 0; i < sourceFiles.length; i++) {
      if (!normalizeResults[i]) continue;
      const f = sourceFiles[i];
      const sourceId = normalizeResults[i]?.sourceId || 'unknown';
      slugs.push(createWikiPage(sourceId, f, topic, resolved.wikiDir, resolved.normalizedDir));
    }
    console.log('');
    if (normalizeErrors.length > 0) {
      console.log(`[ingest] ⚠ ${normalizeErrors.length} file(s) failed normalization — see errors above`);
    }
    console.log(`[ingest] Done — ${slugs.length} new/updated file(s) ingested to ${topic}`);
  } else {
    console.log(`[ingest] Done — all files unchanged, nothing to ingest`);
  }

  const unsupported = (isDir ? fs.readdirSync(input) : [path.basename(input)])
    .filter(f => !SUPPORTED_EXT.test(f));
  for (const f of unsupported) {
    console.log(`  [skip] ${f} (unsupported — needs Digest preprocessing)`);
  }

  if (normalizeResults.length > 0) {
    console.log(`[ingest] ${normalizeResults.length} normalized contract(s) written to normalized/`);
  }
  console.log(`[ingest] Run: node wiki-engine/build.js --topic ${topic} --user ${user}`);

  if (fs.existsSync(DIGEST_NORMALIZER)) {
    console.log('[info] Digest normalizer available for non-Markdown formats');
  }
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`[ingest] Fatal: ${err.message}`);
    process.exit(1);
  }
}

module.exports = {
  DIGEST_NORMALIZER,
  parseArgs,
  slugify,
  formatDate,
  walkDir,
  copyToRaw,
  normalizeFile,
  createWikiPage,
  main,
};
