#!/usr/bin/env node
/**
 * Multi-user wiki server for KnowLever.
 *
 * Routes:
 *   /                     → user listing dashboard
 *   /{user}               → topic listing for user
 *   /{user}/{topic}/...   → static wiki pages from output/
 *
 * Supports BASE_PATH env for Funnel prefix stripping.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DATA_ROOT = path.join(PROJECT_ROOT, 'data', 'users');
const PORT = parseInt(process.env.KNOWLEVER_WIKI_PORT || process.env.PORT || '18085', 10);
const BASE_PATH = (process.env.BASE_PATH || '').replace(/\/+$/, '');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg':  'image/svg+xml',
  '.gif':  'image/gif',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
};

function getUsers() {
  if (!fs.existsSync(DATA_ROOT)) return [];
  return fs.readdirSync(DATA_ROOT).filter(u =>
    fs.statSync(path.join(DATA_ROOT, u)).isDirectory() && u !== '.DS_Store'
  );
}

function getTopics(user) {
  const topicsDir = path.join(DATA_ROOT, user, 'topics');
  if (!fs.existsSync(topicsDir)) return [];
  return fs.readdirSync(topicsDir).filter(t => {
    const tDir = path.join(topicsDir, t);
    if (!fs.statSync(tDir).isDirectory() || t.startsWith('.') || t.startsWith('_')) return false;
    const outDir = path.join(tDir, 'output');
    return fs.existsSync(outDir) && fs.readdirSync(outDir).some(f => f.endsWith('.html'));
  }).map(t => {
    const outDir = path.join(topicsDir, t, 'output');
    const htmlCount = fs.readdirSync(outDir).filter(f => f.endsWith('.html')).length;
    const wikiDir = path.join(topicsDir, t, 'wiki');
    let wikiCount = 0;
    if (fs.existsSync(wikiDir)) {
      const walk = d => {
        for (const f of fs.readdirSync(d)) {
          const fp = path.join(d, f);
          if (fs.statSync(fp).isDirectory()) walk(fp);
          else if (f.endsWith('.md') && !f.startsWith('.')) wikiCount++;
        }
      };
      walk(wikiDir);
    }
    return { name: t, htmlCount, wikiCount };
  });
}

function renderDashboard(users) {
  const userCards = users.map(u => {
    const topics = getTopics(u);
    const topicList = topics.map(t =>
      `<li><a href="${BASE_PATH}/${u}/${t.name}/">${t.name}</a> — ${t.wikiCount} wiki, ${t.htmlCount} HTML</li>`
    ).join('\n');
    return `<div class="user-card">
      <h2><a href="${BASE_PATH}/${u}/">${u}</a></h2>
      <ul>${topicList || '<li>No built topics</li>'}</ul>
    </div>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>KnowLever Wiki</title>
  <style>
    body{font-family:system-ui,-apple-system,sans-serif;margin:0;padding:2rem;background:#f5f5f5;color:#333}
    h1{color:#1a1a2e;border-bottom:2px solid #16213e;padding-bottom:.5rem}
    .user-card{background:#fff;padding:1.5rem;margin:1rem 0;border-radius:8px;box-shadow:0 2px 4px rgba(0,0,0,.1)}
    .user-card h2{margin-top:0;color:#16213e}
    .user-card a{color:#0f3460;text-decoration:none}
    .user-card a:hover{text-decoration:underline}
    ul{padding-left:1.5rem}
    li{margin:.4rem 0}
  </style>
</head>
<body>
  <h1>KnowLever Wiki Dashboard</h1>
  ${userCards}
</body>
</html>`;
}

function renderUserDashboard(user) {
  const topics = getTopics(user);
  const topicList = topics.map(t =>
    `<li><a href="${BASE_PATH}/${user}/${t.name}/">${t.name}</a> — ${t.wikiCount} wiki pages, ${t.htmlCount} HTML pages</li>`
  ).join('\n');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${user} — KnowLever</title>
  <style>
    body{font-family:system-ui,-apple-system,sans-serif;margin:0;padding:2rem;background:#f5f5f5;color:#333}
    h1{color:#1a1a2e;border-bottom:2px solid #16213e;padding-bottom:.5rem}
    a{color:#0f3460;text-decoration:none}
    a:hover{text-decoration:underline}
    .back{margin-bottom:1rem;display:inline-block}
    li{margin:.5rem 0;font-size:1.1rem}
  </style>
</head>
<body>
  <a class="back" href="${BASE_PATH}/">← All Users</a>
  <h1>${user}</h1>
  <ul>${topicList || '<li>No built topics</li>'}</ul>
</body>
</html>`;
}

function serveStatic(res, filePath) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';

  res.writeHead(200, { 'Content-Type': mime });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer((req, res) => {
  let pathname = decodeURIComponent(url.parse(req.url).pathname);

  if (BASE_PATH && pathname.startsWith(BASE_PATH)) {
    pathname = pathname.slice(BASE_PATH.length) || '/';
  }

  if (pathname === '/' || pathname === '') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderDashboard(getUsers()));
    return;
  }

  const parts = pathname.replace(/^\/+/, '').split('/');
  const user = parts[0];
  const topic = parts[1];
  const rest = parts.slice(2).join('/');

  if (!topic) {
    if (getUsers().includes(user)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderUserDashboard(user));
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('User not found');
    }
    return;
  }

  const outputDir = path.join(DATA_ROOT, user, 'topics', topic, 'output');
  if (!fs.existsSync(outputDir)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end(`Topic "${topic}" not found for user "${user}"`);
    return;
  }

  let filePath = path.join(outputDir, rest || 'index.html');
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }

  if (!filePath.startsWith(outputDir)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  serveStatic(res, filePath);
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`[wiki] Wiki server: http://localhost:${PORT}`);
    if (BASE_PATH) console.log(`[wiki] Base path: ${BASE_PATH}`);
  });
}

module.exports = { server };
