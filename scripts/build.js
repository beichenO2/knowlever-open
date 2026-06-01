#!/usr/bin/env node
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const config = require('../config.json');
const { syncToEngine, knowLeverRoot, resolveTopic } = require('../lib/paths');

function parseArgs() {
  const args = process.argv.slice(2);
  let topic = config.default_topic;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--topic' && args[i + 1]) topic = args[++i];
  }
  return { topic };
}

const { topic } = parseArgs();
const { engineRoot, user, engineTopic } = syncToEngine(topic);

const buildScript = path.join(engineRoot, 'wiki-engine/_legacy/build.js');
if (!fs.existsSync(buildScript)) {
  console.error(`missing ${buildScript}`);
  process.exit(1);
}

const r = spawnSync(
  'node',
  [buildScript, '--topic', topic, '--user', user],
  { cwd: engineRoot, stdio: 'inherit' },
);
if (r.status !== 0) process.exit(r.status ?? 1);

const engineOut = path.join(engineTopic, 'output');
const localOut = resolveTopic(topic).outputDir;
if (fs.existsSync(engineOut)) {
  fs.mkdirSync(localOut, { recursive: true });
  fs.cpSync(engineOut, localOut, { recursive: true, force: true });
}

const siteRoot = fs.existsSync(path.join(localOut, 'index.html'))
  ? localOut
  : path.join(localOut, 'html-site');
const indexHtml = path.join(siteRoot, 'index.html');
const glossaryHtml = path.join(siteRoot, 'glossary.html');
console.log(`[build] site root: ${siteRoot}`);
if (fs.existsSync(indexHtml)) console.log(`[build] open: file://${indexHtml}`);
if (fs.existsSync(glossaryHtml)) console.log(`[build] glossary: file://${glossaryHtml}`);
