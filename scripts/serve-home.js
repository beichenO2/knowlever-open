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

const TOPIC_ICONS = ['📚', '🔬', '🧠', '⚡', '🎯', '📊', '🌐', '🔧', '💡', '🎓'];
const TOPIC_COLORS = ['#4361ee', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#ec4899', '#14b8a6'];

function discoverTopics() {
  if (!fs.existsSync(DATA_ROOT)) return [];
  return fs.readdirSync(DATA_ROOT).filter(d => !d.startsWith('.')).map((d, i) => {
    const outputDir = path.join(DATA_ROOT, d, 'output');
    const siteDir = path.join(outputDir, 'site');
    const hasOutput = fs.existsSync(path.join(outputDir, 'index.html')) || fs.existsSync(path.join(siteDir, 'index.html'));
    const wikiDir = path.join(DATA_ROOT, d, 'wiki');
    let wikiCount = 0;
    let subdirs = [];
    if (fs.existsSync(wikiDir)) {
      const entries = fs.readdirSync(wikiDir, { withFileTypes: true });
      wikiCount = entries.filter(e => e.isFile() && e.name.endsWith('.md')).length;
      subdirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.')).map(e => {
        const subCount = fs.readdirSync(path.join(wikiDir, e.name)).filter(f => f.endsWith('.md')).length;
        return { name: e.name, count: subCount };
      });
      subdirs.forEach(s => { wikiCount += s.count; });
    }
    let href = `/library/${d}/`;
    if (fs.existsSync(path.join(siteDir, 'index.html'))) href = `/library/${d}/site/`;
    return {
      id: d, title: d, href, status: hasOutput ? 'ready' : 'pending',
      pages: wikiCount, icon: TOPIC_ICONS[i % TOPIC_ICONS.length],
      color: TOPIC_COLORS[i % TOPIC_COLORS.length], subdirs,
    };
  });
}

function generateIndex() {
  const topics = discoverTopics();
  const totalPages = topics.reduce((s, t) => s + t.pages, 0);
  const readyCount = topics.filter(t => t.status === 'ready').length;

  const cards = topics.map(t => {
    const tags = t.subdirs.filter(s => s.count > 0).slice(0, 4)
      .map(s => `<span class="entry-sub-tag">${s.name} (${s.count})</span>`).join('');
    const disabled = t.status !== 'ready' ? ' onclick="return false" style="opacity:0.5;cursor:default"' : '';
    return `
      <a class="entry-card" href="${t.href}"${disabled}>
        <span class="entry-icon">${t.icon}</span>
        <h3>${t.title}</h3>
        <p>${t.status === 'ready' ? `探索 ${t.pages} 个知识页面` : '待编译'}</p>
        <div class="entry-sub">${tags}</div>
        <div class="entry-status"><span class="status-dot status-${t.status}"></span>${t.status === 'ready' ? '可浏览' : '待编译'}</div>
      </a>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>KnowLever Open — 知识库入口</title>
  <style>
:root {
  --bg: #ffffff;
  --bg-secondary: #f8f9fa;
  --text: #1a1a2e;
  --text-muted: #6c757d;
  --accent: #4361ee;
  --accent-hover: #3a56d4;
  --border: #dee2e6;
  --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', Roboto, sans-serif;
  --max-width: 1200px;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: var(--font-sans); color: var(--text); background: var(--bg); line-height: 1.7; }

.site-header {
  border-bottom: 1px solid var(--border);
  padding: 0.75rem 1.5rem;
  display: flex; align-items: center; justify-content: space-between;
  position: sticky; top: 0; background: var(--bg); z-index: 100;
}
.site-header h1 { font-size: 1.1rem; font-weight: 600; }
.site-header h1 a { color: var(--text); text-decoration: none; display: flex; align-items: center; gap: 0.5rem; }
.site-header svg { width: 28px; height: 28px; }

.main-wrap { max-width: var(--max-width); margin: 0 auto; padding: 2rem 1.5rem; }

.hero {
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
  color: #fff; padding: 3rem 2rem; border-radius: 12px; margin-bottom: 2rem;
  position: relative; overflow: hidden;
}
.hero::after {
  content: ''; position: absolute; top: -50%; right: -20%;
  width: 400px; height: 400px;
  background: radial-gradient(circle, rgba(67,97,238,0.15) 0%, transparent 70%);
  border-radius: 50%;
}
.hero h1 { font-size: 2.2rem; margin-bottom: 0.5rem; position: relative; z-index: 1; }
.hero p { color: rgba(255,255,255,0.75); font-size: 1.05rem; margin-bottom: 1.5rem; max-width: 600px; position: relative; z-index: 1; }
.hero-stats { display: flex; gap: 2.5rem; position: relative; z-index: 1; }
.hero-stat { text-align: center; }
.hero-stat-ring {
  width: 72px; height: 72px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  margin: 0 auto 0.4rem; position: relative;
}
.hero-stat-ring::before {
  content: ''; position: absolute; inset: 0; border-radius: 50%;
  border: 3px solid rgba(255,255,255,0.15);
}
.hero-stat-ring::after {
  content: ''; position: absolute; inset: 0; border-radius: 50%;
  border: 3px solid #4361ee;
  border-color: #4361ee transparent transparent transparent;
  transform: rotate(-45deg);
}
.hero-stat-number { font-size: 1.6rem; font-weight: 700; color: #fff; }
.hero-stat-label { font-size: 0.78rem; color: rgba(255,255,255,0.6); letter-spacing: 0.03em; }
.hero-badge {
  display: inline-block; margin-top: 0.75rem; padding: 0.25rem 0.65rem;
  border-radius: 999px; font-size: 0.75rem; position: relative; z-index: 1;
  background: rgba(67,97,238,.15); color: rgba(255,255,255,0.8); border: 1px solid rgba(67,97,238,.35);
}

.section-header {
  display: flex; align-items: center; gap: 0.6rem;
  font-size: 1.3rem; margin: 2rem 0 1rem; padding-bottom: 0.3rem;
  border-bottom: 2px solid var(--border);
}
.section-icon {
  width: 28px; height: 28px; border-radius: 8px; display: inline-flex;
  align-items: center; justify-content: center; font-size: 0.95rem;
}

.entry-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1.5rem; margin: 2rem 0; }
.entry-card {
  background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 16px;
  padding: 2rem; text-decoration: none; color: inherit; transition: all 0.2s ease;
  position: relative; overflow: hidden; display: block;
}
.entry-card:hover { transform: translateY(-4px); box-shadow: 0 8px 24px rgba(0,0,0,0.1); border-color: var(--accent); }
.entry-icon { font-size: 2.5rem; margin-bottom: 1rem; display: block; }
.entry-card h3 { font-size: 1.3rem; margin-bottom: 0.5rem; }
.entry-card p { color: var(--text-muted); font-size: 0.95rem; line-height: 1.5; margin-bottom: 1rem; }
.entry-sub { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-bottom: 0.75rem; }
.entry-sub-tag {
  background: var(--bg); border: 1px solid var(--border); border-radius: 6px;
  padding: 2px 8px; font-size: 0.75rem; color: var(--text-muted);
}
.entry-status { font-size: 0.8rem; color: var(--text-muted); display: flex; align-items: center; gap: 0.4rem; }
.status-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
.status-dot.status-ready { background: #28a745; }
.status-dot.status-pending { background: #ffc107; }

.guide-section {
  margin: 2.5rem 0; padding: 1.5rem 2rem; background: var(--bg-secondary);
  border: 1px solid var(--border); border-radius: 12px;
}
.guide-section h3 { font-size: 1.05rem; margin-bottom: 0.75rem; }
.guide-section code {
  background: #e8eaed; padding: 2px 6px; border-radius: 3px; font-size: 0.88em;
  font-family: 'SF Mono', 'Fira Code', monospace;
}
.guide-steps { list-style: none; counter-reset: step; }
.guide-steps li { counter-increment: step; padding: 0.3rem 0; font-size: 0.92rem; color: var(--text-muted); }
.guide-steps li::before {
  content: counter(step); display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; border-radius: 50%; background: var(--accent); color: #fff;
  font-size: 0.72rem; font-weight: 600; margin-right: 0.6rem;
}

footer {
  margin-top: 2rem; padding: 1rem 0; border-top: 1px solid var(--border);
  color: var(--text-muted); font-size: 0.85rem; text-align: center;
}
  </style>
</head>
<body>
  <header class="site-header">
    <h1><a href="/">${LOGO_SVG} KnowLever Open</a></h1>
  </header>

  <div class="main-wrap">
    <div class="hero">
      <h1>KnowLever Open</h1>
      <p>开源知识编译工具 — 将原始资料编译为互链、可演化的知识网络</p>
      <div class="hero-stats">
        <div class="hero-stat">
          <div class="hero-stat-ring"><span class="hero-stat-number">${topics.length}</span></div>
          <div class="hero-stat-label">知识库</div>
        </div>
        <div class="hero-stat">
          <div class="hero-stat-ring"><span class="hero-stat-number">${totalPages}</span></div>
          <div class="hero-stat-label">知识页面</div>
        </div>
        <div class="hero-stat">
          <div class="hero-stat-ring"><span class="hero-stat-number">${readyCount}</span></div>
          <div class="hero-stat-label">已编译</div>
        </div>
      </div>
      <span class="hero-badge">单用户 · 7-Stage Pipeline · MIT</span>
    </div>

    <h2 class="section-header"><span class="section-icon" style="background:#dbeafe;">📚</span> 知识库</h2>
    <div class="entry-grid">${cards || '<p style="color:var(--text-muted);padding:2rem;">还没有编译好的知识库。</p>'}</div>

    <div class="guide-section">
      <h3>快速开始</h3>
      <ol class="guide-steps">
        <li>将文件放入 <code>data/topics/&lt;name&gt;/raw/</code></li>
        <li>运行 <code>npm run compile -- --topic &lt;name&gt;</code></li>
        <li>刷新本页，点击卡片进入知识库</li>
      </ol>
    </div>

    <footer>
      <p>KnowLever Open · 由 7-Stage Pipeline 自动编译</p>
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
