#!/usr/bin/env node
/**
 * 用开源 AutoOffice 将 Office/PDF 转为 Markdown，写入 topic 的 raw/，供 KnowLever ingest。
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const config = require('../config.json');
const { resolveTopic, checkEcosystem, autoOfficeRoot } = require('../lib/paths');

function parseArgs() {
  const args = process.argv.slice(2);
  let topic = config.default_topic;
  let fromDir = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--topic' && args[i + 1]) topic = args[++i];
    else if (args[i] === '--from' && args[i + 1]) fromDir = args[++i];
  }
  return { topic, fromDir };
}

function ensureAutoOfficeCli() {
  const ao = autoOfficeRoot();
  const cli = path.join(ao, 'dist', 'cli.js');
  if (fs.existsSync(cli)) return cli;
  console.log('[office-import] building AutoOffice…');
  const r = spawnSync('npm', ['run', 'build'], { cwd: ao, stdio: 'inherit' });
  if (r.status !== 0 || !fs.existsSync(cli)) {
    console.error('[office-import] AutoOffice build failed');
    process.exit(1);
  }
  return cli;
}

const { topic, fromDir } = parseArgs();
checkEcosystem({ requirePolarDesign: false });

if (!fs.existsSync(fromDir)) {
  console.error(`[office-import] missing source dir: ${fromDir}`);
  process.exit(1);
}

const { rawDir } = resolveTopic(topic);
fs.mkdirSync(rawDir, { recursive: true });

const cli = ensureAutoOfficeCli();
const r = spawnSync(
  process.execPath,
  [cli, 'to-markdown', '-i', path.resolve(fromDir), '-o', rawDir],
  { cwd: autoOfficeRoot(), stdio: 'inherit', env: process.env },
);
process.exit(r.status ?? 0);
