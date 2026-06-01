#!/usr/bin/env node
/** 将引擎侧 topic 的 wiki + output 同步到仓库可提交目录（不含 raw/normalized） */
const fs = require('fs');
const path = require('path');
const { knowLeverRoot } = require('../lib/ecosystem');

const topic = process.argv[2] || 'radar-2026';
const user = 'open';
const ROOT = path.join(__dirname, '..');
const engineTopic = path.join(knowLeverRoot(), 'data', 'users', user, 'topics', topic);
const wikiSrc = path.join(engineTopic, 'wiki');
const outSrc = path.join(engineTopic, 'output');
const wikiDest = path.join(ROOT, 'wiki', topic);
const prebuiltDest = path.join(ROOT, 'prebuilt', topic);

function cpDir(src, dest) {
  if (!fs.existsSync(src)) {
    console.error(`missing ${src}`);
    process.exit(1);
  }
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true });
  const n = fs.readdirSync(dest, { recursive: true }).filter((p) => {
    const full = path.join(dest, String(p));
    try {
      return fs.statSync(full).isFile();
    } catch {
      return false;
    }
  }).length;
  console.log(`[sync] ${dest} (${n} files)`);
}

if (!fs.existsSync(wikiSrc)) {
  console.error(`[sync] no wiki at ${wikiSrc} — run compile first`);
  process.exit(1);
}
cpDir(wikiSrc, wikiDest);
if (fs.existsSync(path.join(outSrc, 'index.html'))) {
  cpDir(outSrc, prebuiltDest);
} else {
  console.warn(`[sync] skip prebuilt: no ${outSrc}/index.html — run build first`);
}
