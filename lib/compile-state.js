/**
 * compile-state.js — Incremental compilation state tracker.
 *
 * Maintains a per-topic compile-state.json recording:
 *   - Which raw files have been normalized (and their content hashes)
 *   - Which stages have run (input hash + code hash + timestamp)
 *   - What version of each stage script produced the current output
 *
 * Used by compile-7stage.js to skip unchanged stages.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STATE_FILE = 'compile-state.json';

function loadState(outputDir) {
  const p = path.join(outputDir, STATE_FILE);
  if (!fs.existsSync(p)) return { stages: {}, files: {} };
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return { stages: {}, files: {} };
  }
}

function saveState(outputDir, state) {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(
    path.join(outputDir, STATE_FILE),
    JSON.stringify(state, null, 2),
    'utf-8'
  );
}

/**
 * Hash a file's contents (SHA-256, first 16 hex chars).
 */
function hashFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/**
 * Hash a directory's file listing + content hashes (recursive).
 * Returns a single hash representing the directory state.
 */
function hashDir(dirPath) {
  if (!fs.existsSync(dirPath)) return null;
  const hasher = crypto.createHash('sha256');
  const entries = [];

  function walk(dir, prefix = '') {
    for (const f of fs.readdirSync(dir).sort()) {
      if (f.startsWith('.')) continue;
      const full = path.join(dir, f);
      const rel = prefix ? `${prefix}/${f}` : f;
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        walk(full, rel);
      } else {
        const h = crypto.createHash('sha256')
          .update(fs.readFileSync(full))
          .digest('hex').slice(0, 16);
        entries.push(`${rel}:${h}`);
      }
    }
  }

  walk(dirPath);
  hasher.update(entries.join('\n'));
  return hasher.digest('hex').slice(0, 16);
}

/**
 * Check if a stage needs to re-run.
 *
 * @param {object} state - Current compile state
 * @param {string} stageName - e.g. "stage0.5", "stage1", "stage2"
 * @param {string} codeFile - Path to the stage script file
 * @param {string|string[]} inputPaths - Path(s) to input files/dirs
 * @returns {{ skip: boolean, reason: string }}
 */
function checkStage(state, stageName, codeFile, inputPaths) {
  const prev = state.stages[stageName];
  if (!prev) return { skip: false, reason: 'first run' };

  const codeHash = hashFile(codeFile);
  if (codeHash !== prev.codeHash) {
    return { skip: false, reason: `code changed (${prev.codeHash} → ${codeHash})` };
  }

  const paths = Array.isArray(inputPaths) ? inputPaths : [inputPaths];
  const inputHashes = paths.map(p => {
    const stat = fs.existsSync(p) ? fs.statSync(p) : null;
    if (!stat) return `${p}:missing`;
    return stat.isDirectory() ? `${p}:${hashDir(p)}` : `${p}:${hashFile(p)}`;
  });
  const inputHash = crypto.createHash('sha256')
    .update(inputHashes.join('|'))
    .digest('hex').slice(0, 16);

  if (inputHash !== prev.inputHash) {
    return { skip: false, reason: `input changed (${prev.inputHash} → ${inputHash})` };
  }

  return { skip: true, reason: `unchanged since ${prev.completedAt}` };
}

/**
 * Record a stage completion.
 */
function recordStage(state, stageName, codeFile, inputPaths) {
  const codeHash = hashFile(codeFile);

  const paths = Array.isArray(inputPaths) ? inputPaths : [inputPaths];
  const inputHashes = paths.map(p => {
    const stat = fs.existsSync(p) ? fs.statSync(p) : null;
    if (!stat) return `${p}:missing`;
    return stat.isDirectory() ? `${p}:${hashDir(p)}` : `${p}:${hashFile(p)}`;
  });
  const inputHash = crypto.createHash('sha256')
    .update(inputHashes.join('|'))
    .digest('hex').slice(0, 16);

  state.stages[stageName] = {
    codeHash,
    inputHash,
    completedAt: new Date().toISOString(),
  };
}

/**
 * Track normalized file state (which raw files produced which normalized outputs).
 */
function recordFileNormalized(state, rawFile, contentHash) {
  if (!state.files) state.files = {};
  state.files[rawFile] = {
    contentHash,
    normalizedAt: new Date().toISOString(),
  };
}

function isFileNormalized(state, rawFile, currentHash) {
  const prev = state.files?.[rawFile];
  if (!prev) return false;
  return prev.contentHash === currentHash;
}

module.exports = {
  loadState,
  saveState,
  hashFile,
  hashDir,
  checkStage,
  recordStage,
  recordFileNormalized,
  isFileNormalized,
};
