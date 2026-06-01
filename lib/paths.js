const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function resolveTopic(topic) {
  const topicPath = topic || 'demo-parity';
  const topicDir = path.join(ROOT, 'data', 'topics', topicPath);
  return {
    root: ROOT,
    topic: topicPath,
    topicDir,
    rawDir: path.join(topicDir, 'raw'),
    normalizedDir: path.join(topicDir, 'normalized'),
    wikiDir: path.join(topicDir, 'wiki'),
    outputDir: path.join(topicDir, 'output'),
  };
}

const { knowLeverRoot: engineRoot } = require('./ecosystem');

function knowLeverRoot() {
  return engineRoot();
}

/** 同步到生态 KnowLever 单用户目录 open/topics/{topic} 供引擎编译 */
function syncToEngine(topic) {
  const t = resolveTopic(topic);
  const engineRoot = knowLeverRoot();
  const engineTopic = path.join(engineRoot, 'data', 'users', 'open', 'topics', t.topic);
  for (const sub of ['raw', 'normalized', 'wiki', 'output']) {
    const src = path.join(t.topicDir, sub);
    const dest = path.join(engineTopic, sub);
    if (!fs.existsSync(src)) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.cpSync(src, dest, { recursive: true, force: true });
  }
  return { engineRoot, engineTopic, user: 'open', topic: t.topic };
}

function ensureTopicDirs(topic) {
  const t = resolveTopic(topic);
  for (const dir of [t.rawDir, t.normalizedDir, t.wikiDir, t.outputDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return t;
}

module.exports = { ROOT, resolveTopic, knowLeverRoot, syncToEngine, ensureTopicDirs };
