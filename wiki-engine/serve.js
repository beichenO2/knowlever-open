#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const coreServe = require('wiki-core/serve');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const OUTPUT_ROOT = path.join(PROJECT_ROOT, 'output');
const WIKI_ROOT = path.join(PROJECT_ROOT, 'wiki');
const SITE_ROOT = path.join(PROJECT_ROOT, 'site-standard');

function parseServeArgs(args = process.argv.slice(2)) {
  let port = parseInt(process.env.PORT || `${coreServe.DEFAULT_PORT}`, 10);
  let mode = coreServe.DEFAULT_MODE;
  let topicName = null;
  let user = null;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--port' || arg === '-p') {
      const nextPort = parseInt(args[i + 1] || '', 10);
      if (!Number.isInteger(nextPort) || nextPort <= 0) throw new Error('invalid_port');
      port = nextPort;
      i += 1;
    } else if (arg === '--mode' || arg === '-m') {
      mode = coreServe.normalizeMode(args[i + 1]);
      i += 1;
    } else if (arg === '--topic' || arg === '-t') {
      topicName = args[i + 1];
      i += 1;
    } else if (arg === '--user' || arg === '-u') {
      user = args[i + 1];
      i += 1;
    } else if (arg === '--instant') {
      mode = 'instant';
    } else if (arg === '--build-on-save') {
      mode = 'build-on-save';
    }
  }

  return { port, mode, topicName, user };
}

function resolveTopic(topicName, user) {
  const u = user || 'admin';
  const topicDir = path.join(PROJECT_ROOT, 'data', 'users', u, 'topics', topicName);
  if (!fs.existsSync(topicDir)) {
    throw new Error(`Topic "${topicName}" not found for user "${u}" at ${topicDir}`);
  }
  return {
    wikiDir: path.join(topicDir, 'wiki'),
    outputDir: path.join(topicDir, 'output'),
    graphDir: path.join(topicDir, 'graph'),
  };
}

function startServer(options = {}) {
  if (!options.topicName) {
    console.error('Usage: node wiki-engine/serve.js --topic <name> [--user <user>] [--port <port>]');
    console.error('');
    console.error('Error: --topic is required. KnowLever operates in Topic-only mode.');
    process.exit(1);
  }

  const topic = resolveTopic(options.topicName, options.user);
  const buildArgs = ` --topic ${options.topicName}${options.user ? ` --user ${options.user}` : ''}`;

  return coreServe.startServer({
    port: options.port,
    mode: options.mode,
    outputRoot: topic.outputDir,
    buildCommand: `node wiki-engine/build.js${buildArgs}`,
    projectRoot: PROJECT_ROOT,
    watchDirs: [topic.wikiDir, SITE_ROOT],
    serverName: `KnowLever [topic: ${options.topicName}]`,
  });
}

function main(argsOrOptions = process.argv.slice(2)) {
  if (Array.isArray(argsOrOptions)) {
    return startServer(parseServeArgs(argsOrOptions));
  }
  return startServer(argsOrOptions || {});
}

if (require.main === module) {
  const parsed = parseServeArgs(process.argv.slice(2));
  startServer(parsed);
}

module.exports = {
  DEFAULT_MODE: coreServe.DEFAULT_MODE,
  DEFAULT_PORT: coreServe.DEFAULT_PORT,
  WS_PATH: coreServe.WS_PATH,
  LIVE_RELOAD_CLIENT_PATH: coreServe.LIVE_RELOAD_CLIENT_PATH,
  parseServeArgs,
  createLiveReloadClientSource: coreServe.createLiveReloadClientSource,
  injectLiveReloadClient: coreServe.injectLiveReloadClient,
  startServer,
  main,
};
