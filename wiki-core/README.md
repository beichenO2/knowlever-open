# @polarisor/wiki-core

Shared wiki build pipeline for KnowLever and similar wiki engines.

## Modules

- `markdown.js` — Markdown → HTML pipeline (frontmatter, wikilinks, tables, footnotes, KaTeX math, code fences)
- `build-pipeline.js` — File ops, version stores, manifests, search index, related pages
- `wiki-config.js` — Multi-wiki config resolver
- `serve.js` — Static dev server
- `index.js` — Entry point exposing all modules

## Usage

```js
const { markdownToHtml, parseFrontmatter } = require('@polarisor/wiki-core/markdown');
const { BUILD_MANIFEST_VERSION } = require('@polarisor/wiki-core/build-pipeline');
```

## Consumers

- `KnowLever` — knowledge compilation system (links via `file:../wiki-core` in its `package.json`)

## Versioning

This package follows semver. When making breaking changes to `markdownToHtml` or `BUILD_MANIFEST_VERSION`, bump the major version and ensure all consumers update their lockfiles.

## Recent changes

See git log for full history. Notable fixes:

- 2026-05-04: `[text](slug)` markdown links auto-upgrade to wikilinks when `slug` matches a known type prefix (concept-/entity-/src-/synthesis-/comparison-/structure-/skill-/checklist-/question-) and has no extension. Solves LLM-emitted naked-slug links.
