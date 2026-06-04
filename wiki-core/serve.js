/**
 * Shared dev server with live reload.
 * Parameterized: outputRoot, buildCommand, watchDirs, port, serverName.
 * Extracted from KnowLever/LLM-Wiki — no external dependencies.
 */
const { execSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');

const DEFAULT_PORT = 3000;
const DEFAULT_MODE = 'build-on-save';
const LIVE_RELOAD_CLIENT_PATH = '/__livereload.js';
const WS_PATH = '/__ws';
const LIVE_RELOAD_SCRIPT_TAG = `<script src="${LIVE_RELOAD_CLIENT_PATH}" data-llmwiki-live-reload></script>`;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function normalizeMode(rawMode) {
  const value = String(rawMode || '').trim().toLowerCase();
  if (!value || value === 'build' || value === 'build-on-save') return 'build-on-save';
  if (value === 'instant' || value === 'preview') return 'instant';
  throw new Error(`invalid_mode:${rawMode}`);
}

function createLiveReloadClientSource() {
  return `(function(){if(window.__llmwikiLiveReloadClient)return;window.__llmwikiLiveReloadClient=true;var reconnectTimer=0;function connect(){var protocol=location.protocol==='https:'?'wss://':'ws://';var socket=new WebSocket(protocol+location.host+'${WS_PATH}');socket.addEventListener('message',function(event){if(event.data==='reload'){location.reload()}});socket.addEventListener('close',function(){window.clearTimeout(reconnectTimer);reconnectTimer=window.setTimeout(connect,1000)});socket.addEventListener('error',function(){socket.close()})}connect()})();`;
}

function injectLiveReloadClient(html) {
  const source = String(html || '');
  if (source.includes('data-llmwiki-live-reload')) return source;
  if (source.includes('</body>')) {
    return source.replace('</body>', `${LIVE_RELOAD_SCRIPT_TAG}</body>`);
  }
  return source + LIVE_RELOAD_SCRIPT_TAG;
}

function resolveRequestPath(rawUrl, outputRoot) {
  const pathname = String(rawUrl || '/').split('?')[0] || '/';
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {}

  const normalized = decoded === '/' ? '/index.html' : decoded;
  const filePath = path.resolve(outputRoot, `.${normalized}`);
  if (filePath !== outputRoot && !filePath.startsWith(`${outputRoot}${path.sep}`)) {
    return null;
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    return path.join(filePath, 'index.html');
  }

  if (!path.extname(filePath)) {
    const htmlPath = `${filePath}.html`;
    if (fs.existsSync(htmlPath)) return htmlPath;
  }

  return filePath;
}

function createWebSocketFrame(message) {
  const payload = Buffer.from(String(message));
  if (payload.length < 126) {
    return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
  }
  if (payload.length < 65536) {
    return Buffer.concat([
      Buffer.from([0x81, 126, (payload.length >> 8) & 0xff, payload.length & 0xff]),
      payload,
    ]);
  }
  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(payload.length), 2);
  return Buffer.concat([header, payload]);
}

function watchDirectory(dirPath, onChange) {
  if (!fs.existsSync(dirPath)) return null;
  const handler = (eventType, filename) => {
    const relative = String(filename || '').trim();
    if (!relative) return;
    if (path.basename(relative).startsWith('.')) return;
    onChange(eventType, relative);
  };
  try {
    return fs.watch(dirPath, { recursive: true }, handler);
  } catch {
    return fs.watch(dirPath, handler);
  }
}

/**
 * Start the dev server with live reload.
 * @param {object} options
 * @param {number} [options.port]
 * @param {string} [options.mode] - 'build-on-save' or 'instant'
 * @param {string} options.outputRoot - absolute path to output directory
 * @param {string} options.buildCommand - shell command to run on file change (e.g. 'node scripts/build.js')
 * @param {string} options.projectRoot - absolute path to project root (cwd for build command)
 * @param {string[]} options.watchDirs - directories to watch for changes (trigger build)
 * @param {string} [options.serverName] - display name in console output
 */
function startServer(options) {
  options = options || {};
  const port = Number.isInteger(options.port) ? options.port : DEFAULT_PORT;
  const mode = normalizeMode(options.mode || DEFAULT_MODE);
  const outputRoot = options.outputRoot;
  const buildCommand = options.buildCommand;
  const projectRoot = options.projectRoot;
  const watchDirsInput = options.watchDirs || [];
  const serverName = options.serverName || 'Wiki';

  if (!outputRoot) throw new Error('options.outputRoot is required');
  if (!projectRoot) throw new Error('options.projectRoot is required');

  const clients = new Set();
  const watchers = [];

  let building = false;
  let pendingBuild = false;
  let buildTimer = null;
  let reloadTimer = null;
  let ignoreOutputUntil = 0;

  function broadcastReload(reason) {
    if (reason) {
      console.log(`[serve] reload -> ${reason}`);
    }
    const frame = createWebSocketFrame('reload');
    for (const socket of clients) {
      try {
        socket.write(frame);
      } catch {}
    }
  }

  function scheduleReload(reason) {
    if (Date.now() < ignoreOutputUntil) return;
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      broadcastReload(reason);
    }, 120);
  }

  function runBuild(reason) {
    if (building) {
      pendingBuild = true;
      return;
    }
    building = true;
    ignoreOutputUntil = Date.now() + 900;
    try {
      console.log(`[serve] build-on-save -> ${reason}`);
      execSync(buildCommand, { cwd: projectRoot, stdio: 'inherit' });
      broadcastReload(`build:${reason}`);
    } catch (error) {
      console.error('[serve] build failed:', error.message);
    } finally {
      building = false;
      if (pendingBuild) {
        pendingBuild = false;
        runBuild('queued changes');
      }
    }
  }

  function scheduleBuild(reason) {
    clearTimeout(buildTimer);
    buildTimer = setTimeout(() => {
      runBuild(reason);
    }, 220);
  }

  const server = http.createServer((req, res) => {
    const urlPath = String(req.url || '/');
    if (urlPath.split('?')[0] === LIVE_RELOAD_CLIENT_PATH) {
      res.writeHead(200, {
        'Content-Type': MIME['.js'],
        'Cache-Control': 'no-store',
      });
      res.end(createLiveReloadClientSource());
      return;
    }

    const filePath = resolveRequestPath(urlPath, outputRoot);
    if (!filePath) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    fs.readFile(filePath, (error, data) => {
      if (error) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      const ext = path.extname(filePath);
      const contentType = MIME[ext] || 'application/octet-stream';
      const headers = {
        'Content-Type': contentType,
        'Cache-Control': 'no-store',
      };

      if (ext === '.html') {
        res.writeHead(200, headers);
        res.end(injectLiveReloadClient(data.toString('utf-8')));
        return;
      }

      res.writeHead(200, headers);
      res.end(data);
    });
  });

  server.on('upgrade', (req, socket) => {
    if (req.url !== WS_PATH) {
      socket.destroy();
      return;
    }

    const key = req.headers['sec-websocket-key'];
    if (!key) {
      socket.destroy();
      return;
    }

    const accept = crypto
      .createHash('sha1')
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64');

    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );

    clients.add(socket);
    socket.on('close', () => clients.delete(socket));
    socket.on('end', () => clients.delete(socket));
    socket.on('error', () => clients.delete(socket));
  });

  for (const dir of watchDirsInput) {
    const label = path.relative(projectRoot, dir) || path.basename(dir);
    const watcher = watchDirectory(dir, (_eventType, filename) => {
      if (mode === 'build-on-save') {
        scheduleBuild(`${label}/${filename}`);
        return;
      }
      console.log(`[serve] ${label} changed (${filename}) — instant mode does not auto-build.`);
    });
    if (watcher) watchers.push(watcher);
  }

  const outputWatcher = watchDirectory(outputRoot, (_eventType, filename) => {
    scheduleReload(`output/${filename}`);
  });
  if (outputWatcher) watchers.push(outputWatcher);

  if (mode === 'build-on-save') {
    runBuild('startup');
  } else {
    console.log('[serve] instant preview mode: watching output/ for direct changes.');
  }

  server.listen(port, () => {
    console.log(`[serve] ${serverName} dev server: http://localhost:${port}`);
    console.log(`[serve] mode=${mode}; output=${path.relative(projectRoot, outputRoot)}`);
  });

  return {
    server,
    close() {
      clearTimeout(buildTimer);
      clearTimeout(reloadTimer);
      watchers.forEach(watcher => watcher && watcher.close());
      clients.forEach(socket => {
        try { socket.destroy(); } catch {}
      });
      server.close();
    },
  };
}

module.exports = {
  DEFAULT_MODE,
  DEFAULT_PORT,
  WS_PATH,
  LIVE_RELOAD_CLIENT_PATH,
  normalizeMode,
  createLiveReloadClientSource,
  injectLiveReloadClient,
  resolveRequestPath,
  watchDirectory,
  startServer,
};
