#!/usr/bin/env node
/**
 * Layer 2A Deterministic Normalizer for Codebases (open-source repos).
 *
 * Produces the Curated Markdown Contract output:
 *   normalized/{source_id}/
 *     content.md, metadata.json, provenance.json, segments.json, assets/
 *
 * One repo = one source. content.md is structured:
 *   § Overview (README) → § Directory Tree → § Config → § Source Files
 *
 * Supports local paths and Git URLs (auto-clone to temp dir).
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

const CONTRACT_VERSION = '1.0.0';

const IGNORE_DIRS = new Set([
  '.git', 'node_modules', '__pycache__', '.venv', 'venv', 'env',
  'dist', 'build', 'out', '.next', '.nuxt', '.output',
  'target', 'vendor', '.gradle', '.idea', '.vscode', '.cursor',
  '.DS_Store', 'coverage', '.nyc_output', '.pytest_cache',
  '.mypy_cache', '.tox', 'eggs', '*.egg-info',
  '.planning', '.gsd', '致继任者',
]);

const IGNORE_FILES = new Set([
  '.DS_Store', 'Thumbs.db', '.gitattributes',
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
  'Cargo.lock', 'poetry.lock', 'Pipfile.lock',
  'composer.lock', 'Gemfile.lock',
]);

const SOURCE_EXTENSIONS = new Set([
  '.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs',
  '.py', '.pyi',
  '.rs', '.go', '.java', '.kt', '.scala', '.cs', '.cpp', '.c', '.h', '.hpp',
  '.rb', '.php', '.swift', '.m', '.mm',
  '.lua', '.zig', '.nim', '.ex', '.exs', '.erl', '.hrl',
  '.sh', '.bash', '.zsh', '.fish',
  '.sql', '.graphql', '.gql',
  '.vue', '.svelte', '.astro',
  '.css', '.scss', '.sass', '.less', '.styl',
  '.html', '.htm', '.xml', '.xsl',
  '.yml', '.yaml', '.toml', '.json', '.jsonc', '.json5',
  '.md', '.mdx', '.rst', '.txt', '.adoc',
  '.dockerfile', '.containerfile',
  '.proto', '.thrift', '.avsc',
]);

const CONFIG_FILES = new Set([
  'package.json', 'tsconfig.json', 'jsconfig.json',
  'pyproject.toml', 'setup.py', 'setup.cfg', 'requirements.txt', 'Pipfile',
  'Cargo.toml', 'go.mod', 'go.sum',
  'Makefile', 'CMakeLists.txt', 'Dockerfile', 'docker-compose.yml', 'docker-compose.yaml',
  '.env.example', '.env.sample',
  'Gemfile', 'composer.json', 'build.gradle', 'build.gradle.kts', 'pom.xml',
  'deno.json', 'deno.jsonc', 'bun.lockb',
  'webpack.config.js', 'vite.config.ts', 'vite.config.js',
  'next.config.js', 'next.config.mjs', 'nuxt.config.ts',
  'tailwind.config.js', 'tailwind.config.ts',
  '.eslintrc.js', '.eslintrc.json', '.prettierrc',
  'jest.config.js', 'jest.config.ts', 'vitest.config.ts',
]);

const README_PATTERNS = [
  'README.md', 'readme.md', 'README', 'README.rst', 'README.txt',
  'CONTRIBUTING.md', 'ARCHITECTURE.md', 'DESIGN.md',
];

const MAX_FILE_SIZE = 64 * 1024;   // 64 KB per file
const MAX_TOTAL_SIZE = 2048 * 1024; // 2 MB total content cap
const MAX_TREE_DEPTH = 8;

function sha256(text) {
  return 'sha256:' + crypto.createHash('sha256').update(text, 'utf-8').digest('hex');
}

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9\u4e00-\u9fff-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    || 'repo';
}

function detectLanguage(text) {
  const sample = text.slice(0, 4000);
  const cjk = (sample.match(/[\u4e00-\u9fff]/g) || []).length;
  const ascii = (sample.match(/[a-zA-Z]/g) || []).length;
  return cjk > ascii * 0.3 ? 'zh' : 'en';
}

function isGitUrl(input) {
  return /^(https?:\/\/|git@|git:\/\/)/.test(input) || input.endsWith('.git');
}

function cloneRepo(url) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowlever-repo-'));
  const repoDir = path.join(tmpDir, 'repo');
  console.log(`  [codebase] Cloning ${url} → ${repoDir}`);
  execSync(`git clone --depth 1 ${url} ${repoDir}`, { stdio: 'pipe', timeout: 120_000 });
  return { repoDir, tmpDir };
}

function shouldIgnoreDir(name) {
  if (IGNORE_DIRS.has(name)) return true;
  if (name.endsWith('.egg-info')) return true;
  if (name.startsWith('.') && name !== '.github') return true;
  return false;
}

function isSourceFile(name) {
  if (IGNORE_FILES.has(name)) return false;
  const ext = path.extname(name).toLowerCase();
  if (SOURCE_EXTENSIONS.has(ext)) return true;
  if (CONFIG_FILES.has(name)) return true;
  if (README_PATTERNS.includes(name)) return true;
  if (name === 'Dockerfile' || name === 'Makefile') return true;
  return false;
}

function walkDir(dir, relPrefix = '', depth = 0) {
  if (depth > MAX_TREE_DEPTH) return [];
  const results = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch { return results; }

  entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  for (const entry of entries) {
    const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (shouldIgnoreDir(entry.name)) continue;
      results.push({ type: 'dir', relPath, depth });
      results.push(...walkDir(path.join(dir, entry.name), relPath, depth + 1));
    } else if (entry.isFile()) {
      if (!isSourceFile(entry.name)) continue;
      const stats = fs.statSync(path.join(dir, entry.name));
      results.push({ type: 'file', relPath, depth, size: stats.size });
    }
  }
  return results;
}

function buildTree(entries) {
  const lines = [];
  for (const e of entries) {
    const indent = '  '.repeat(e.depth);
    if (e.type === 'dir') {
      lines.push(`${indent}${e.relPath.split('/').pop()}/`);
    } else {
      const sizeStr = e.size > 1024 ? `${(e.size / 1024).toFixed(1)}K` : `${e.size}B`;
      lines.push(`${indent}${e.relPath.split('/').pop()}  (${sizeStr})`);
    }
  }
  return lines.join('\n');
}

function detectProjectInfo(repoDir) {
  const info = {
    name: path.basename(repoDir),
    languages: [],
    framework: null,
    description: '',
    version: null,
    license: null,
  };

  const pkgPath = path.join(repoDir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      info.name = pkg.name || info.name;
      info.description = pkg.description || '';
      info.version = pkg.version;
      info.license = pkg.license;
      info.languages.push('JavaScript');
      if (pkg.dependencies?.typescript || pkg.devDependencies?.typescript) info.languages.push('TypeScript');
      if (pkg.dependencies?.react || pkg.devDependencies?.react) info.framework = 'React';
      else if (pkg.dependencies?.vue || pkg.devDependencies?.vue) info.framework = 'Vue';
      else if (pkg.dependencies?.next) info.framework = 'Next.js';
      else if (pkg.dependencies?.express) info.framework = 'Express';
    } catch {}
  }

  const pyprojectPath = path.join(repoDir, 'pyproject.toml');
  if (fs.existsSync(pyprojectPath)) {
    info.languages.push('Python');
    const pyContent = fs.readFileSync(pyprojectPath, 'utf-8');
    const nameMatch = pyContent.match(/^name\s*=\s*"(.+?)"/m);
    if (nameMatch) info.name = nameMatch[1];
    const descMatch = pyContent.match(/^description\s*=\s*"(.+?)"/m);
    if (descMatch) info.description = descMatch[1];
    if (pyContent.includes('fastapi')) info.framework = 'FastAPI';
    else if (pyContent.includes('django')) info.framework = 'Django';
    else if (pyContent.includes('flask')) info.framework = 'Flask';
  }

  if (fs.existsSync(path.join(repoDir, 'Cargo.toml'))) {
    info.languages.push('Rust');
    try {
      const cargo = fs.readFileSync(path.join(repoDir, 'Cargo.toml'), 'utf-8');
      const nameMatch = cargo.match(/^name\s*=\s*"(.+?)"/m);
      if (nameMatch) info.name = nameMatch[1];
    } catch {}
  }

  if (fs.existsSync(path.join(repoDir, 'go.mod'))) {
    info.languages.push('Go');
    try {
      const gomod = fs.readFileSync(path.join(repoDir, 'go.mod'), 'utf-8');
      const modMatch = gomod.match(/^module\s+(.+)$/m);
      if (modMatch) info.name = modMatch[1].split('/').pop();
    } catch {}
  }

  if (info.languages.length === 0) {
    if (fs.existsSync(path.join(repoDir, 'setup.py')) || fs.existsSync(path.join(repoDir, 'requirements.txt'))) {
      info.languages.push('Python');
    }
  }

  for (const lic of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'COPYING']) {
    if (fs.existsSync(path.join(repoDir, lic))) {
      const licText = fs.readFileSync(path.join(repoDir, lic), 'utf-8').slice(0, 200);
      if (licText.includes('MIT')) info.license = 'MIT';
      else if (licText.includes('Apache')) info.license = 'Apache-2.0';
      else if (licText.includes('GPL')) info.license = 'GPL';
      else if (licText.includes('BSD')) info.license = 'BSD';
      break;
    }
  }

  return info;
}

function readFileSafe(filePath) {
  try {
    const stats = fs.statSync(filePath);
    if (stats.size > MAX_FILE_SIZE) {
      const partial = Buffer.alloc(MAX_FILE_SIZE);
      const fd = fs.openSync(filePath, 'r');
      fs.readSync(fd, partial, 0, MAX_FILE_SIZE, 0);
      fs.closeSync(fd);
      return partial.toString('utf-8') + '\n\n<!-- truncated at 64KB -->';
    }
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function langTag(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
    '.ts': 'typescript', '.tsx': 'typescript', '.jsx': 'javascript',
    '.py': 'python', '.pyi': 'python',
    '.rs': 'rust', '.go': 'go', '.java': 'java', '.kt': 'kotlin',
    '.rb': 'ruby', '.php': 'php', '.swift': 'swift',
    '.c': 'c', '.cpp': 'cpp', '.h': 'c', '.hpp': 'cpp', '.cs': 'csharp',
    '.sh': 'bash', '.bash': 'bash', '.zsh': 'zsh',
    '.sql': 'sql', '.graphql': 'graphql',
    '.vue': 'vue', '.svelte': 'svelte', '.astro': 'astro',
    '.css': 'css', '.scss': 'scss', '.sass': 'sass', '.less': 'less',
    '.html': 'html', '.htm': 'html', '.xml': 'xml',
    '.yml': 'yaml', '.yaml': 'yaml', '.toml': 'toml',
    '.json': 'json', '.jsonc': 'jsonc',
    '.md': 'markdown', '.mdx': 'markdown', '.rst': 'rst',
    '.dockerfile': 'dockerfile', '.proto': 'protobuf',
    '.lua': 'lua', '.zig': 'zig', '.ex': 'elixir', '.exs': 'elixir',
  };
  return map[ext] || '';
}

function buildContentMd(repoDir, projectInfo, entries) {
  const sections = [];
  let totalSize = 0;

  // § 1 — Project Overview
  sections.push(`# ${projectInfo.name}\n`);

  const metaLines = [];
  if (projectInfo.languages.length) metaLines.push(`**Languages**: ${projectInfo.languages.join(', ')}`);
  if (projectInfo.framework) metaLines.push(`**Framework**: ${projectInfo.framework}`);
  if (projectInfo.version) metaLines.push(`**Version**: ${projectInfo.version}`);
  if (projectInfo.license) metaLines.push(`**License**: ${projectInfo.license}`);
  if (projectInfo.description) metaLines.push(`\n${projectInfo.description}`);
  if (metaLines.length) sections.push(metaLines.join('  \n') + '\n');

  // § 2 — README
  for (const rp of README_PATTERNS) {
    const readmePath = path.join(repoDir, rp);
    if (fs.existsSync(readmePath)) {
      const content = readFileSafe(readmePath);
      if (content) {
        sections.push(`## README\n\n${content}\n`);
        totalSize += content.length;
        break;
      }
    }
  }

  // § 3 — Directory Tree
  const tree = buildTree(entries);
  sections.push(`## Directory Structure\n\n\`\`\`\n${tree}\n\`\`\`\n`);
  totalSize += tree.length;

  // § 4 — Configuration Files
  const configEntries = entries.filter(e => e.type === 'file' && CONFIG_FILES.has(e.relPath.split('/').pop()));
  if (configEntries.length > 0) {
    const configParts = ['## Configuration\n'];
    for (const ce of configEntries) {
      if (totalSize > MAX_TOTAL_SIZE) break;
      const content = readFileSafe(path.join(repoDir, ce.relPath));
      if (!content) continue;
      const tag = langTag(ce.relPath);
      configParts.push(`### ${ce.relPath}\n\n\`\`\`${tag}\n${content}\n\`\`\`\n`);
      totalSize += content.length;
    }
    sections.push(configParts.join('\n'));
  }

  // § 5 — Source Code Files (prioritize by relevance)
  const sourceEntries = entries.filter(e => {
    if (e.type !== 'file') return false;
    const name = e.relPath.split('/').pop();
    if (CONFIG_FILES.has(name)) return false;
    if (README_PATTERNS.includes(name)) return false;
    return true;
  });

  // Sort: entry points first, then by depth (shallower = more important), then size
  sourceEntries.sort((a, b) => {
    const aName = a.relPath.split('/').pop().toLowerCase();
    const bName = b.relPath.split('/').pop().toLowerCase();
    const entryPatterns = ['index', 'main', 'app', 'server', 'cli', 'mod', 'lib'];
    const aEntry = entryPatterns.some(p => aName.startsWith(p)) ? 0 : 1;
    const bEntry = entryPatterns.some(p => bName.startsWith(p)) ? 0 : 1;
    if (aEntry !== bEntry) return aEntry - bEntry;
    if (a.depth !== b.depth) return a.depth - b.depth;
    return a.size - b.size;
  });

  if (sourceEntries.length > 0) {
    const srcParts = ['## Source Code\n'];
    let fileCount = 0;
    for (const se of sourceEntries) {
      if (totalSize > MAX_TOTAL_SIZE) {
        srcParts.push(`\n> ⚠️ Content cap reached (${(MAX_TOTAL_SIZE / 1024).toFixed(0)}KB). ${sourceEntries.length - fileCount} file(s) omitted.\n`);
        break;
      }
      const content = readFileSafe(path.join(repoDir, se.relPath));
      if (!content) continue;
      const tag = langTag(se.relPath);
      srcParts.push(`### ${se.relPath}\n\n\`\`\`${tag}\n${content}\n\`\`\`\n`);
      totalSize += content.length;
      fileCount++;
    }
    sections.push(srcParts.join('\n'));
  }

  return { content: sections.join('\n'), totalSize };
}

function extractSegments(content) {
  const segments = [];
  const pattern = /^(#{1,3})\s+(.+)$/gm;
  let match;
  let idx = 0;

  while ((match = pattern.exec(content)) !== null) {
    if (segments.length > 0) {
      segments[segments.length - 1].end_char = match.index;
    }
    segments.push({
      index: idx++,
      heading: match[2].trim(),
      start_char: match.index,
      end_char: content.length,
      level: match[1].length,
    });
  }

  if (segments.length === 0) {
    segments.push({
      index: 0,
      heading: '(full document)',
      start_char: 0,
      end_char: content.length,
      level: 0,
    });
  }

  return segments;
}

function countWords(text) {
  const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const ascii = (text.match(/[a-zA-Z]+/g) || []).length;
  return cjk + ascii;
}

/**
 * Detect whether a directory is a codebase.
 * Returns true if it contains common project markers.
 */
function isCodebase(dirPath) {
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) return false;
  const markers = [
    'package.json', 'pyproject.toml', 'setup.py', 'Cargo.toml',
    'go.mod', 'Makefile', 'CMakeLists.txt', 'Gemfile', 'composer.json',
    'build.gradle', 'pom.xml', '.git', 'deno.json',
    'requirements.txt', 'setup.cfg',
  ];
  const files = fs.readdirSync(dirPath);
  return markers.some(m => files.includes(m));
}

/**
 * Normalize a codebase directory into the Curated Markdown Contract format.
 *
 * @param {string} inputPath - Local dir path or Git URL
 * @param {object} options
 * @param {string} options.topicId - e.g. "admin/pharma"
 * @param {string} options.normalizedDir - e.g. "data/users/admin/topics/pharma/normalized"
 * @param {string} options.rawRelPath - Relative path in raw/ for provenance
 * @returns {{ sourceId, sourceDir, projectInfo, fileCount, method }}
 */
function normalizeCodebase(inputPath, options = {}) {
  const { topicId = 'admin/default', normalizedDir, rawRelPath } = options;
  let repoDir = inputPath;
  let tmpDir = null;
  const isUrl = isGitUrl(inputPath);

  if (isUrl) {
    const result = cloneRepo(inputPath);
    repoDir = result.repoDir;
    tmpDir = result.tmpDir;
  }

  if (!fs.existsSync(repoDir) || !fs.statSync(repoDir).isDirectory()) {
    throw new Error(`Not a directory: ${repoDir}`);
  }

  const projectInfo = detectProjectInfo(repoDir);
  const entries = walkDir(repoDir);
  const fileEntries = entries.filter(e => e.type === 'file');

  const date = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const slug = slugify(projectInfo.name);
  const sourceId = `src-${date}-codebase-${slug}`.slice(0, 80);
  const sourceDir = path.join(normalizedDir, sourceId);

  fs.mkdirSync(path.join(sourceDir, 'assets'), { recursive: true });

  const { content, totalSize } = buildContentMd(repoDir, projectInfo, entries);
  fs.writeFileSync(path.join(sourceDir, 'content.md'), content);

  const now = new Date().toISOString();
  const metadata = {
    source_id: sourceId,
    topic_id: topicId,
    raw_path: rawRelPath || `raw/${path.basename(repoDir)}`,
    source_type: 'codebase',
    original_filename: path.basename(repoDir),
    created_at: now,
    language: detectLanguage(content),
    processing_status: 'deterministic_normalized',
    content_hash: sha256(content),
    normalize_version: CONTRACT_VERSION,
    page_count: fileEntries.length,
    word_count: countWords(content),
    image_count: 0,
    codebase: {
      name: projectInfo.name,
      languages: projectInfo.languages,
      framework: projectInfo.framework,
      description: projectInfo.description,
      version: projectInfo.version,
      license: projectInfo.license,
      file_count: fileEntries.length,
      total_size: totalSize,
      source_url: isUrl ? inputPath : null,
    },
  };

  fs.writeFileSync(
    path.join(sourceDir, 'metadata.json'),
    JSON.stringify(metadata, null, 2) + '\n'
  );

  const provenance = {
    source_id: sourceId,
    raw_path: metadata.raw_path,
    raw_hash: sha256(content),
    raw_size_bytes: totalSize,
    upload_time: now,
    normalize_time: now,
    normalize_pipeline: [
      { step: 'detect_project', tool: 'knowlever-normalize-codebase@' + CONTRACT_VERSION, duration_ms: 0 },
      { step: 'walk_directory', tool: 'builtin', duration_ms: 0 },
      { step: 'build_content_md', tool: 'builtin', duration_ms: 0 },
      { step: 'metadata_extract', tool: 'builtin', duration_ms: 0 },
      { step: 'segment_extract', tool: 'builtin', duration_ms: 0 },
    ],
    semantic_pipeline: [],
    parent_source: null,
    derived_from: null,
    clone_url: isUrl ? inputPath : null,
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

  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  return {
    sourceId,
    sourceDir,
    projectInfo,
    fileCount: fileEntries.length,
    method: isUrl ? 'git-clone' : 'local',
  };
}

module.exports = {
  normalizeCodebase,
  isCodebase,
  isGitUrl,
  detectProjectInfo,
  walkDir,
  buildTree,
  CONTRACT_VERSION,
};
