/**
 * macOS Finder Alias / Bookmark 解析器
 *
 * Mac Finder "替身" (alias) 不是 symlink，是 Apple 私有格式。
 * Node.js fs API 无法跟随替身——需要通过 osascript 或 mdls 解析真实路径。
 *
 * 同时提供视频文件识别，用于 ingest 管线的"视频替身、其余复制"策略。
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const VIDEO_EXTS = new Set([
  '.mp4', '.mkv', '.avi', '.mov', '.webm', '.flv', '.wmv',
  '.m4v', '.ts', '.mpg', '.mpeg', '.3gp', '.vob',
]);

/**
 * 检测文件是否是 Mac Finder 替身（alias）。
 * 替身文件的 content type 是 com.apple.alias-file。
 */
function isFinderAlias(filePath) {
  try {
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink() || stat.isDirectory()) return false;
    if (stat.size > 10 * 1024 * 1024) return false;

    const output = execSync(
      `mdls -name kMDItemContentType -raw "${filePath.replace(/"/g, '\\"')}"`,
      { encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
    return output === 'com.apple.alias-file' || output === 'com.apple.bookmark';
  } catch {
    try {
      const output = execSync(
        `file -b "${filePath.replace(/"/g, '\\"')}"`,
        { encoding: 'utf-8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'] }
      ).trim();
      return output.includes('MacOS Alias') || output.includes('Apple alias');
    } catch {
      return false;
    }
  }
}

/**
 * 将 Mac Finder 替身解析为真实路径。
 * 使用 osascript (AppleScript) 调用 Finder 解析。
 */
function resolveAlias(aliasPath) {
  const absPath = path.resolve(aliasPath);
  try {
    const script = `tell application "Finder" to get POSIX path of (original item of (POSIX file "${absPath.replace(/"/g, '\\"')}" as alias))`;
    const resolved = execSync(
      `osascript -e '${script.replace(/'/g, "'\\''")}'`,
      { encoding: 'utf-8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
    if (resolved && fs.existsSync(resolved)) return resolved;
  } catch { /* fall through to next method */ }

  try {
    const script = `
      use framework "Foundation"
      set posixPath to "${absPath.replace(/"/g, '\\"')}"
      set theURL to current application's NSURL's fileURLWithPath:posixPath
      set bookmarkData to current application's NSURL's bookmarkDataWithContentsOfURL:theURL |error|:(missing value)
      if bookmarkData is not missing value then
        set resolvedURL to current application's NSURL's URLByResolvingBookmarkData:bookmarkData options:0 relativeToURL:(missing value) bookmarkDataIsStale:(missing value) |error|:(missing value)
        if resolvedURL is not missing value then
          return (resolvedURL's |path|()) as text
        end if
      end if
    `;
    const resolved = execSync(
      `osascript -e '${script.replace(/'/g, "'\\''")}'`,
      { encoding: 'utf-8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
    if (resolved && fs.existsSync(resolved)) return resolved;
  } catch { /* fall through */ }

  return null;
}

/**
 * 智能路径解析：如果是替身则解析真实路径，否则返回原路径。
 * 符号链接由 fs.realpathSync 处理。
 */
function resolveSmartPath(filePath) {
  try {
    const lstat = fs.lstatSync(filePath);
    if (lstat.isSymbolicLink()) {
      return fs.realpathSync(filePath);
    }
  } catch {
    return filePath;
  }

  if (isFinderAlias(filePath)) {
    const resolved = resolveAlias(filePath);
    if (resolved) return resolved;
  }

  return filePath;
}

function isVideoFile(filePath) {
  return VIDEO_EXTS.has(path.extname(filePath).toLowerCase());
}

/**
 * 递归遍历目录，自动解析替身和符号链接。
 * 对每个文件返回 { absolute: 真实路径, relative: 相对路径, isAlias: bool }。
 */
function walkDirWithAliasResolution(dir, rootDir = dir) {
  const results = [];

  const realDir = resolveSmartPath(dir);
  if (!fs.existsSync(realDir)) return results;
  const stat = fs.statSync(realDir);
  if (!stat.isDirectory()) {
    results.push({
      absolute: realDir,
      relative: path.basename(dir),
      isAlias: realDir !== dir,
    });
    return results;
  }

  for (const entry of fs.readdirSync(realDir)) {
    if (entry.startsWith('.') || entry === 'Thumbs.db' || entry === 'desktop.ini') continue;
    const full = path.join(realDir, entry);
    const relBase = path.relative(rootDir, path.join(dir, entry));

    let resolvedFull = full;
    let entryIsAlias = false;
    try {
      const lstat = fs.lstatSync(full);
      if (lstat.isSymbolicLink()) {
        resolvedFull = fs.realpathSync(full);
        entryIsAlias = true;
      } else if (!lstat.isDirectory() && isFinderAlias(full)) {
        const resolved = resolveAlias(full);
        if (resolved) {
          resolvedFull = resolved;
          entryIsAlias = true;
        }
      }
    } catch { continue; }

    try {
      const rstat = fs.statSync(resolvedFull);
      if (rstat.isDirectory()) {
        const subResults = walkDirWithAliasResolution(resolvedFull, rootDir);
        for (const sub of subResults) {
          const subRel = path.join(relBase, path.relative(resolvedFull, sub.absolute));
          results.push({
            absolute: sub.absolute,
            relative: sub.relative.startsWith(relBase) ? sub.relative : subRel,
            isAlias: sub.isAlias || entryIsAlias,
          });
        }
      } else {
        results.push({
          absolute: resolvedFull,
          relative: relBase,
          isAlias: entryIsAlias,
        });
      }
    } catch { continue; }
  }

  return results;
}

module.exports = {
  isFinderAlias,
  resolveAlias,
  resolveSmartPath,
  isVideoFile,
  walkDirWithAliasResolution,
  VIDEO_EXTS,
};
