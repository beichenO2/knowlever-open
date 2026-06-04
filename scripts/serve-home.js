#!/usr/bin/env node
/**
 * KnowLever Open — 本地知识库静态站服务
 * http://127.0.0.1:4180/library/demo-parity/
 * http://127.0.0.1:4180/library/radar-2026/
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
};

function safeJoin(root, rel) {
  const file = path.normalize(path.join(root, rel));
  if (!file.startsWith(root)) return null;
  return file;
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

function listTopics() {
  if (!fs.existsSync(DATA_ROOT)) return [];
  return fs.readdirSync(DATA_ROOT).filter(d => {
    const outputIndex = path.join(DATA_ROOT, d, 'output', 'index.html');
    return fs.existsSync(outputIndex);
  });
}

function generateIndex() {
  const topics = listTopics();
  const items = topics.map(t => `<li><a href="/library/${t}/">${t}</a></li>`).join('\n');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>KnowLever Open</title></head>
<body><h1>KnowLever Open</h1><ul>${items || '<li>No compiled topics yet</li>'}</ul></body></html>`;
}

function resolve(reqPath) {
  const url = decodeURIComponent(reqPath.split('?')[0]);

  if (url === '/' || url === '/index.html') return '__INDEX__';

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
    sendFile(res, file);
  })
  .listen(PORT, '127.0.0.1', () => {
    console.log(`[home] http://127.0.0.1:${PORT}/`);
    const topics = listTopics();
    topics.forEach(t => console.log(`[home]   /library/${t}/`));
    console.log('[home] Ctrl+C 停止');
  });
