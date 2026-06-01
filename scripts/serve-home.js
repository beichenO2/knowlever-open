#!/usr/bin/env node
/**
 * 本地开源主页 + 已编译知识库静态站
 * http://127.0.0.1:4180/           — 入口
 * http://127.0.0.1:4180/library/<topic>/ — data/topics/<topic>/output/
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PROJECT = path.join(__dirname, '..');
const SITE_ROOT = path.join(PROJECT, 'site');
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
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
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

  const libMatch = url.match(/^\/library\/([^/]+)(?:\/(.*))?$/);
  if (libMatch) {
    const topic = libMatch[1];
    const rest = libMatch[2] || 'index.html';
    const outRoot = path.join(DATA_ROOT, topic, 'output');
    const file = safeJoin(outRoot, rest === '' ? 'index.html' : rest);
    if (file) return file;
    return null;
  }

  const sitePath = url === '/' ? '/index.html' : url;
  return safeJoin(SITE_ROOT, sitePath.replace(/^\//, ''));
}

http
  .createServer((req, res) => {
    const file = resolve(req.url || '/');
    if (!file) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    sendFile(res, file);
  })
  .listen(PORT, '127.0.0.1', () => {
    console.log(`[home] http://127.0.0.1:${PORT}/`);
    console.log('[home] 知识库: /library/<topic>/  (例: /library/demo-parity/)');
    console.log('[home] Ctrl+C 停止');
  });
