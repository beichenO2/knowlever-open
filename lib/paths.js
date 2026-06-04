const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function ecosystemRoot() {
  return process.env.ECOSYSTEM_ROOT || process.env.POLARISOR_ROOT || path.join(ROOT, '..');
}

function resolveProject(envKey, folderName) {
  const fromEnv = process.env[envKey];
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(ecosystemRoot(), folderName);
}

function knowLeverRoot() {
  return resolveProject('KNOWLEVER_ROOT', 'KnowLever');
}

function autoOfficeRoot() {
  return resolveProject('AUTOOFFICE_DIR', 'AutoOffice');
}

function assertDir(dir, label, hint) {
  if (!fs.existsSync(path.join(dir, 'package.json'))) {
    throw new Error(
      `${label} 未找到: ${dir}\n请克隆并设置环境变量：export ${hint}=${dir}\n详见 README。`,
    );
  }
  return dir;
}

function checkEcosystem(opts = {}) {
  const { requireAutoOffice = true } = opts;
  const kl = assertDir(knowLeverRoot(), 'KnowLever 引擎', 'KNOWLEVER_ROOT');
  const out = { knowLever: kl };
  if (requireAutoOffice) {
    out.autoOffice = assertDir(autoOfficeRoot(), 'AutoOffice', 'AUTOOFFICE_DIR');
  }
  return out;
}

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

function ensureTopicDirs(topic) {
  const t = resolveTopic(topic);
  for (const dir of [t.rawDir, t.normalizedDir, t.wikiDir, t.outputDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return t;
}

module.exports = {
  ROOT, ecosystemRoot, knowLeverRoot, autoOfficeRoot,
  checkEcosystem, resolveTopic, ensureTopicDirs,
};
