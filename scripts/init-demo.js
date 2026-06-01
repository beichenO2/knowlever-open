#!/usr/bin/env node
/**
 * 初始化 demo-parity：优先 examples/demo-parity/raw（公开 md）。
 * 注意：「示例/」目录若含私人 PDF（如雷达课件），不会自动拷入 pipeline。
 */
const fs = require('fs');
const path = require('path');
const { ensureTopicDirs, ROOT } = require('../lib/paths');

const src = path.join(ROOT, 'examples', 'demo-parity', 'raw');
const t = ensureTopicDirs('demo-parity');
const dest = t.rawDir;

if (!fs.existsSync(src)) {
  console.error(`[init:demo] missing ${src}`);
  process.exit(1);
}

fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });
let n = 0;
for (const name of fs.readdirSync(src)) {
  if (!name.endsWith('.md')) continue;
  fs.copyFileSync(path.join(src, name), path.join(dest, name));
  n++;
}
console.log(`[init:demo] copied ${n} md → ${dest}`);
const sampleDir = path.join(ROOT, '示例');
if (fs.existsSync(sampleDir)) {
  const pdfs = fs.readdirSync(sampleDir).filter((f) => f.endsWith('.pdf')).length;
  if (pdfs) {
    console.log(`[init:demo] note: 「示例/」含 ${pdfs} 个 PDF，未纳入 demo-parity（需单独 topic + ingest PDF）`);
  }
}
