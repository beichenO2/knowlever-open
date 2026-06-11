#!/usr/bin/env node
/**
 * Watch raw/ directories for changes and trigger recompilation.
 * Single-user mode: watches data/topics/*/raw/**
 */
const chokidar = require('chokidar');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { resolveTopic } = require('../lib/paths');

const WATCH_PATTERN = path.join(__dirname, '../data/topics/*/raw/**/*');
const DEBOUNCE_MS = 3000;
const topicStates = new Map();

console.log(`[watch-compile] Monitoring raw changes: ${WATCH_PATTERN}`);

function getTopicFromPath(filePath) {
  const parts = filePath.split(path.sep);
  const topicsIdx = parts.indexOf('topics');
  if (topicsIdx !== -1 && parts[topicsIdx + 1]) {
    return parts[topicsIdx + 1];
  }
  return null;
}

function ensureTopicState(topic) {
  if (!topicStates.has(topic)) {
    topicStates.set(topic, {
      topic,
      changedFiles: new Set(),
      hasDelete: false,
      timer: null,
      running: false,
      rerunRequested: false,
    });
  }
  return topicStates.get(topic);
}

function runNode(scriptRelPath, args, label) {
  const scriptAbs = path.join(__dirname, '..', scriptRelPath);
  const pretty = ['node', scriptRelPath, ...args].join(' ');
  console.log(`[watch-compile] ${label}: ${pretty}`);
  const result = spawnSync('node', [scriptAbs, ...args], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (typeof result.status === 'number' && result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status}`);
  }
}

function fileExists(filePath) {
  try { return fs.existsSync(filePath) && fs.statSync(filePath).isFile(); } catch { return false; }
}

function shouldIngestFile(filePath) {
  const base = path.basename(filePath);
  if (!fileExists(filePath)) return false;
  if (base.startsWith('.')) return false;
  if (base.endsWith('.source-ref.json')) return false;
  return true;
}

function processTopicEvents(topic) {
  const state = topicStates.get(topic);
  if (!state) return;

  if (state.running) {
    state.rerunRequested = true;
    return;
  }

  state.running = true;
  state.rerunRequested = false;

  try {
    const changedFiles = [...state.changedFiles];
    state.changedFiles.clear();
    state.hasDelete = false;

    console.log(`\n[watch-compile] Topic ${topic}: ${changedFiles.length} changed file(s)`);

    for (const filePath of changedFiles) {
      if (!shouldIngestFile(filePath)) continue;
      runNode('wiki-engine/ingest.js', [filePath, '--topic', topic], `ingest ${path.basename(filePath)}`);
    }

    runNode('scripts/compile-7stage.js', ['--topic', topic, '--skip-embed', '--skip-pdf'], `compile ${topic}`);
    console.log(`[watch-compile] Topic ${topic} processed; waiting for new changes...`);
  } catch (err) {
    console.error(`[watch-compile] Topic ${topic} failed: ${err.message}`);
  } finally {
    state.running = false;
    if (state.rerunRequested || state.changedFiles.size > 0 || state.hasDelete) {
      state.rerunRequested = false;
      setTimeout(() => processTopicEvents(topic), 200);
    }
  }
}

function scheduleTopicProcess(topic, state) {
  if (state.timer) clearTimeout(state.timer);
  state.timer = setTimeout(() => {
    state.timer = null;
    processTopicEvents(topic);
  }, DEBOUNCE_MS);
}

chokidar.watch(WATCH_PATTERN, {
  ignored: /(^|[\/\\])\../,
  persistent: true,
  ignoreInitial: true,
}).on('all', (event, filePath) => {
  const topic = getTopicFromPath(filePath);
  if (!topic) return;
  const state = ensureTopicState(topic);

  if (event === 'add' || event === 'change') {
    state.changedFiles.add(filePath);
    scheduleTopicProcess(topic, state);
    return;
  }

  if (event === 'unlink' || event === 'unlinkDir') {
    state.hasDelete = true;
    scheduleTopicProcess(topic, state);
  }
});
