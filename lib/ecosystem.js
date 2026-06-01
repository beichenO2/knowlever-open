const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/** 与 KnowLever、AutoOffice 并排克隆时的父目录 */
function ecosystemRoot() {
  return (
    process.env.ECOSYSTEM_ROOT ||
    process.env.POLARISOR_ROOT ||
    path.join(ROOT, '..')
  );
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

function polarDesignRoot() {
  return resolveProject('POLARDESIGN_DIR', 'PolarDesign');
}

function assertDir(dir, label, hint) {
  if (!fs.existsSync(path.join(dir, 'package.json'))) {
    throw new Error(
      `${label} 未找到: ${dir}\n` +
        `请克隆开源仓库并设置环境变量，例如：\n` +
        `  export ${hint}=${dir}\n` +
        `详见 README「生态依赖」一节。`,
    );
  }
  return dir;
}

/** @param {{ requireAutoOffice?: boolean, requirePolarDesign?: boolean }} opts */
function checkEcosystem(opts = {}) {
  const { requireAutoOffice = true, requirePolarDesign = false } = opts;
  const kl = assertDir(knowLeverRoot(), 'KnowLever 引擎', 'KNOWLEVER_ROOT');
  const out = { knowLever: kl };
  if (requireAutoOffice) {
    out.autoOffice = assertDir(autoOfficeRoot(), 'AutoOffice', 'AUTOOFFICE_DIR');
  }
  if (requirePolarDesign) {
    out.polarDesign = assertDir(polarDesignRoot(), 'PolarDesign', 'POLARDESIGN_DIR');
  }
  return out;
}

module.exports = {
  ROOT,
  ecosystemRoot,
  knowLeverRoot,
  autoOfficeRoot,
  polarDesignRoot,
  checkEcosystem,
};
