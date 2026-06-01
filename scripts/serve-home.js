#!/usr/bin/env node
/**
 * 本地开源主页 + 知识库静态站（开盖即食：优先本地 output，否则 prebuilt/）
 * http://127.0.0.1:4180/
 * http://127.0.0.1:4180/library/demo-parity/
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PROJECT = path.join(__dirname, '..');
const SITE_ROOT = path.join(PROJECT, 'site');
const DATA_ROOT = path.join(PROJECT, 'data', 'topics');
const PREBUILT_ROOT = path.join(PROJECT, 'prebuilt');
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

function libraryOutputRoot(topic) {
  const live = path.join(DATA_ROOT, topic, 'output');
  if (fs.existsSync(path.join(live, 'index.html'))) return live;
  const pre = path.join(PREBUILT_ROOT, topic);
  if (fs.existsSync(path.join(pre, 'index.html'))) return pre;
  return null;
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

  const libMatch = url.match(/^\/library\/([^/]+)(?:\/(.*))?$/);
  if (libMatch) {
    const topic = libMatch[1];
    const rest = libMatch[2] || 'index.html';
    const outRoot = libraryOutputRoot(topic);
    if (!outRoot) return null;
    return safeJoin(outRoot, rest === '' ? 'index.html' : rest);
  }

  const sitePath = url === '/' ? '/index.html' : url;
  return safeJoin(SITE_ROOT, sitePath.replace(/^\//, ''));
}

http
  .createServer((req, res) => {
    const file = resolve(req.url || '/');
    sendFile(res, file);
  })
  .listen(PORT, '127.0.0.1', () => {
    console.log(`[home] http://127.0.0.1:${PORT}/`);
    console.log('[home] demo: /library/demo-parity/ (prebuilt 或本地 output)');
    console.log('[home] Ctrl+C 停止');
  });
