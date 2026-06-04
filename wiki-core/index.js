/**
 * @polarisor/wiki-core — shared wiki build infrastructure.
 * Re-exports all public APIs from sub-modules.
 */
const markdown = require('./markdown');
const buildPipeline = require('./build-pipeline');
const createWikiConfig = require('./wiki-config');
const serve = require('./serve');

module.exports = {
  ...markdown,
  ...buildPipeline,
  createWikiConfig,
  serve,
};
