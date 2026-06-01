#!/usr/bin/env node
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const config = require('../config.json');
const { ROOT, syncToEngine, knowLeverRoot, ensureTopicDirs, resolveTopic } = require('../lib/paths');

function parseArgs() {
  const args = process.argv.slice(2);
  let topic = config.default_topic;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--topic' && args[i + 1]) topic = args[++i];
  }
  return { topic };
}

function run(engineRoot, scriptRel, args, label) {
  const scriptPath = path.join(engineRoot, scriptRel);
  if (!fs.existsSync(scriptPath)) {
    console.error(`[compile] missing ${scriptPath}`);
    process.exit(1);
  }
  console.log(`[compile] ${label}: node ${scriptRel} ${args.join(' ')}`);
  const r = spawnSync('node', [scriptPath, ...args], { cwd: engineRoot, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const { topic } = parseArgs();
ensureTopicDirs(topic);
const engineRoot = knowLeverRoot();
const user = 'open';
const engineTopic = path.join(engineRoot, 'data', 'users', user, 'topics', topic);

if (!fs.existsSync(path.join(engineRoot, 'wiki-engine', 'ingest.js'))) {
  console.error(`KNOWLEVER_ROOT invalid: ${engineRoot}`);
  process.exit(1);
}

// 1) ingest 从 examples/ 入口（避免 input===rawDir 时「全 unchanged」跳过 normalize）
const ingestInput = path.join(ROOT, 'examples', topic, 'raw');
if (!fs.existsSync(ingestInput)) {
  console.error(`[compile] missing examples/${topic}/raw — run npm run init:demo`);
  process.exit(1);
}
run(
  engineRoot,
  'wiki-engine/ingest.js',
  [ingestInput, '--topic', topic, '--user', user, '--recursive'],
  'ingest',
);

// 2) LLM compile (legacy path)
run(
  engineRoot,
  'wiki-engine/_legacy/compile.js',
  ['--topic', topic, '--user', user, '--model', config.llm.model],
  'compile',
);

console.log('[compile] wiki done; run npm run build for html site');
