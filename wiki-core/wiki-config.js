/**
 * Shared wiki configuration management.
 * Parameterized by configRelPath so KnowLever and LLM-Wiki can use different config locations.
 *
 * Usage:
 *   const wikiConfig = require('wiki-core/wiki-config')({
 *     configRelPath: 'wiki-engine/wikis.json',  // or 'schema/wikis.json'
 *     root: ROOT,
 *   });
 *   const wiki = wikiConfig.resolveWiki(root, wikiId);
 */
const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG = {
  defaultWiki: 'default',
  wikis: {
    default: {
      name: 'Default Wiki',
      wikiDir: 'wiki',
      graphFile: 'output/assets/data/graph.json',
      outputDir: 'output',
    },
  },
};

function cloneDefaultConfig() {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}

function normalizeWikiId(value) {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function normalizeEntry(entry, id) {
  const source = entry && typeof entry === 'object' ? entry : {};
  return {
    ...source,
    name: typeof source.name === 'string' && source.name.trim() ? source.name.trim() : id,
    wikiDir: typeof source.wikiDir === 'string' && source.wikiDir.trim() ? source.wikiDir.trim() : path.join('wikis', id, 'wiki'),
    graphFile: typeof source.graphFile === 'string' && source.graphFile.trim() ? source.graphFile.trim() : path.join('wikis', id, 'graph.json'),
    outputDir: typeof source.outputDir === 'string' && source.outputDir.trim() ? source.outputDir.trim() : path.join('wikis', id, 'output'),
  };
}

function normalizeConfig(raw) {
  const fallback = cloneDefaultConfig();
  const source = raw && typeof raw === 'object' ? raw : {};
  const rawWikis = source.wikis && typeof source.wikis === 'object' && !Array.isArray(source.wikis)
    ? source.wikis
    : fallback.wikis;

  const wikis = {};
  for (const [id, entry] of Object.entries(rawWikis)) {
    wikis[id] = normalizeEntry(entry, id);
  }

  if (!Object.keys(wikis).length) {
    return fallback;
  }

  const defaultWiki = typeof source.defaultWiki === 'string' && wikis[source.defaultWiki]
    ? source.defaultWiki
    : Object.keys(wikis)[0];

  return { defaultWiki, wikis };
}

function isPathInside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function createManagedWikiEntry(id, name) {
  const wikiId = normalizeWikiId(id);
  const baseDir = path.join('wikis', wikiId);
  return {
    name: name || wikiId,
    managed: true,
    baseDir,
    wikiDir: path.join(baseDir, 'wiki'),
    graphFile: path.join(baseDir, 'graph.json'),
    outputDir: path.join(baseDir, 'output'),
  };
}

/**
 * Factory: create a wiki-config instance bound to a specific config file location.
 * @param {object} params
 * @param {string} params.configRelPath - relative path from project root to wikis.json (e.g. 'wiki-engine/wikis.json')
 * @param {string} params.root - project root directory
 */
function createWikiConfig(params) {
  const { configRelPath, root } = params;
  const CONFIG_PATH = path.join(root, configRelPath);

  function ensureConfigExists(r) {
    r = r || root;
    const configPath = path.join(r, configRelPath);
    if (fs.existsSync(configPath)) {
      return configPath;
    }
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, `${JSON.stringify(cloneDefaultConfig(), null, 2)}\n`);
    return configPath;
  }

  function loadWikiConfig(r) {
    r = r || root;
    const configPath = ensureConfigExists(r);
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    return normalizeConfig(raw);
  }

  function writeWikiConfig(config, r) {
    r = r || root;
    const configPath = path.join(r, configRelPath);
    const normalized = normalizeConfig(config);
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, `${JSON.stringify(normalized, null, 2)}\n`);
    return normalized;
  }

  function resolveWiki(r, wikiId) {
    r = r || root;
    const config = loadWikiConfig(r);
    const id = wikiId || config.defaultWiki;
    const entry = config.wikis[id];

    if (!entry) {
      throw new Error(`unknown_wiki:${id}`);
    }

    return {
      id,
      name: entry.name,
      root: r,
      config,
      configPath: path.join(r, configRelPath),
      entry,
      managed: Boolean(entry.managed),
      baseDirRel: entry.baseDir || null,
      baseDir: entry.baseDir ? path.resolve(r, entry.baseDir) : null,
      wikiDirRel: entry.wikiDir,
      wikiDir: path.resolve(r, entry.wikiDir),
      graphFileRel: entry.graphFile,
      graphFile: path.resolve(r, entry.graphFile),
      outputDirRel: entry.outputDir,
      outputDir: path.resolve(r, entry.outputDir),
    };
  }

  return {
    ROOT: root,
    CONFIG_PATH,
    DEFAULT_CONFIG,
    normalizeWikiId,
    normalizeConfig,
    ensureConfigExists,
    loadWikiConfig,
    writeWikiConfig,
    resolveWiki,
    createManagedWikiEntry,
    isPathInside,
  };
}

module.exports = createWikiConfig;
module.exports.DEFAULT_CONFIG = DEFAULT_CONFIG;
module.exports.normalizeWikiId = normalizeWikiId;
module.exports.normalizeConfig = normalizeConfig;
module.exports.createManagedWikiEntry = createManagedWikiEntry;
module.exports.isPathInside = isPathInside;
