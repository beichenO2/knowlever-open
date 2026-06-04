#!/usr/bin/env node
/**
 * KnowLever Open — 本地知识库首页 + topic 静态站服务
 * http://127.0.0.1:4180/
 * http://127.0.0.1:4180/library/<topic>/
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PROJECT = path.join(__dirname, '..');
const DATA_ROOT = path.join(PROJECT, 'data', 'topics');
const PORT = Number(process.env.KL_HOME_PORT || 4180);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.md': 'text/markdown; charset=utf-8',
};

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" role="img" aria-label="KnowLever">
  <defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#5b8def"/><stop offset="100%" stop-color="#2d4263"/>
  </linearGradient></defs>
  <rect width="120" height="120" rx="28" fill="#0f1419"/>
  <path d="M28 34h38a6 6 0 0 1 6 6v52a6 6 0 0 1-6 6H28V34z" fill="url(#g)" opacity="0.95"/>
  <path d="M66 34h26a6 6 0 0 1 6 6v52a6 6 0 0 1-6 6H66V34z" fill="#1a2332" stroke="#5b8def" stroke-width="2"/>
  <line x1="66" y1="34" x2="66" y2="98" stroke="#3d5a80" stroke-width="2"/>
  <circle cx="88" cy="78" r="5" fill="#e8c547"/>
  <rect x="44" y="76" width="52" height="4" rx="2" fill="#e8c547" transform="rotate(-12 44 78)"/>
  <rect x="38" y="88" width="10" height="10" rx="2" fill="#c9a227"/>
</svg>`;

function safeJoin(root, rel) {
  const file = path.normalize(path.join(root, rel));
  if (!file.startsWith(root)) return null;
  return file;
}

function discoverTopics() {
  if (!fs.existsSync(DATA_ROOT)) return [];
  return fs.readdirSync(DATA_ROOT).filter(d => !d.startsWith('.')).map(d => {
    const outputDir = path.join(DATA_ROOT, d, 'output');
    const hasOutput = fs.existsSync(path.join(outputDir, 'index.html'));
    const wikiDir = path.join(DATA_ROOT, d, 'wiki');
    const wikiCount = fs.existsSync(wikiDir)
      ? fs.readdirSync(wikiDir, { recursive: true }).filter(f => String(f).endsWith('.md')).length
      : 0;
    return { id: d, title: d, href: `/library/${d}/`, status: hasOutput ? 'ready' : 'pending', pages: wikiCount };
  });
}

function generateIndex() {
  const topics = discoverTopics();
  const cards = topics.map(t => `
    <a class="card" href="${t.href}" ${t.status !== 'ready' ? 'onclick="return false" style="opacity:0.55;cursor:default"' : ''}>
      <h3>${t.title}</h3>
      <p>${t.pages} wiki 页面</p>
      <div class="meta">
        <span class="status-${t.status}">${t.status === 'ready' ? '可浏览' : '待编译'}</span>
        <span>${t.pages ? t.pages + ' 页' : ''}</span>
      </div>
    </a>`).join('');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>KnowLever Open — 知识库入口</title>
  <style>
:root {
  --bg: #0b0f14; --card: #141b24; --border: #243044;
  --text: #e8eef7; --muted: #8fa3bf; --accent: #5b8def;
  --gold: #e8c547; --radius: 16px;
  font-family: "SF Pro Text", "PingFang SC", "Helvetica Neue", system-ui, sans-serif;
}
* { box-sizing: border-box; }
body {
  margin: 0; min-height: 100vh; color: var(--text);
  background: radial-gradient(ellipse 80% 50% at 50% -20%, rgba(91,141,239,.18), transparent), var(--bg);
}
.wrap { max-width: 1080px; margin: 0 auto; padding: 2.5rem 1.5rem 4rem; }
header { display: flex; align-items: center; gap: 1.25rem; margin-bottom: 2.5rem; }
header svg { width: 72px; height: 72px; }
header h1 { margin: 0; font-size: 1.85rem; font-weight: 650; letter-spacing: -0.02em; }
header p { margin: 0.35rem 0 0; color: var(--muted); font-size: 1rem; max-width: 36rem; }
.hero-badge {
  display: inline-block; margin-top: 0.75rem; padding: 0.25rem 0.65rem;
  border-radius: 999px; font-size: 0.75rem;
  background: rgba(232,197,71,.12); color: var(--gold); border: 1px solid rgba(232,197,71,.35);
}
h2 { font-size: 1.1rem; color: var(--muted); font-weight: 500; margin: 2rem 0 1rem; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1rem; }
.card {
  background: var(--card); border: 1px solid var(--border); border-radius: var(--radius);
  padding: 1.25rem 1.35rem; transition: border-color .2s, transform .2s;
  text-decoration: none; color: inherit; display: block;
}
.card:hover { border-color: var(--accent); transform: translateY(-2px); }
.card h3 { margin: 0 0 0.5rem; font-size: 1.15rem; }
.card p { margin: 0; color: var(--muted); font-size: 0.9rem; line-height: 1.5; }
.card .meta { margin-top: 1rem; font-size: 0.8rem; color: var(--muted); display: flex; justify-content: space-between; }
.status-ready { color: #6ee7a0; }
.status-pending { color: var(--muted); }
footer { margin-top: 3rem; padding-top: 1.5rem; border-top: 1px solid var(--border); color: var(--muted); font-size: 0.85rem; }
footer code { color: var(--gold); font-size: 0.88em; }
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      ${LOGO_SVG}
      <div>
        <h1>KnowLever Open</h1>
        <p>开源知识编译工具 — 用命令行构建可浏览的知识库，从这里进入各个 topic 站点。</p>
        <span class="hero-badge">单用户 · 7-Stage Pipeline · MIT</span>
      </div>
    </header>
    <h2>知识库</h2>
    <div class="grid">${cards || '<p style="color:var(--muted)">还没有编译好的知识库。运行 <code>npm run compile -- --topic &lt;name&gt;</code> 开始。</p>'}</div>
    <footer>
      <p>新增库：将文件放入 <code>data/topics/&lt;topic&gt;/raw/</code>，运行 <code>npm run compile -- --topic &lt;name&gt;</code>。</p>
    </footer>
  </div>
</body>
</html>`;
}

function sendFile(res, file) {
  if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  const ext = path.extname(file);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
}

function resolve(reqPath) {
  const url = decodeURIComponent(reqPath.split('?')[0]);
  if (url === '/' || url === '/index.html') return '__INDEX__';
  if (url === '/logo.svg') return '__LOGO__';

  const libMatch = url.match(/^\/library\/([^/]+)(?:\/(.*))?$/);
  if (libMatch) {
    const topic = libMatch[1];
    const rest = libMatch[2] || 'index.html';
    const outRoot = path.join(DATA_ROOT, topic, 'output');
    if (!fs.existsSync(outRoot)) return null;
    return safeJoin(outRoot, rest === '' ? 'index.html' : rest);
  }
  return null;
}

http
  .createServer((req, res) => {
    const file = resolve(req.url || '/');
    if (file === '__INDEX__') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(generateIndex());
      return;
    }
    if (file === '__LOGO__') {
      res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
      res.end(LOGO_SVG);
      return;
    }
    sendFile(res, file);
  })
  .listen(PORT, '127.0.0.1', () => {
    console.log(`[home] http://127.0.0.1:${PORT}/`);
    const topics = discoverTopics();
    topics.forEach(t => console.log(`[home]   /library/${t.id}/ (${t.status}, ${t.pages} wiki pages)`));
    console.log('[home] Ctrl+C 停止');
  });
