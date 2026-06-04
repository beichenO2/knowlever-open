/**
 * Shared markdown-to-HTML pipeline.
 * Extracted from KnowLever/LLM-Wiki — no external dependencies.
 */
const crypto = require('crypto');

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function hashPageContent(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function normalizeMarkdown(md) {
  return md.replace(/\r\n/g, '\n');
}

function createTokenStore() {
  const values = [];
  return {
    stash(html) {
      const token = `\u0000HTML${values.length}\u0000`;
      values.push(html);
      return token;
    },
    restore(text) {
      return text.replace(/\u0000HTML(\d+)\u0000/g, (_, index) => values[Number(index)] || '');
    }
  };
}

function isTokenOnly(text) {
  return /^\u0000HTML\d+\u0000$/.test(text.trim());
}

/**
 * @param {string} md
 * @param {object} tokens
 * @param {object} [options]
 * @param {boolean} [options.escapeMermaidBody] - true = escapeHtml the mermaid body (LLM-Wiki style)
 */
function stashFencedCodeBlocks(md, tokens, options) {
  const escapeMermaid = options && options.escapeMermaidBody;
  return md.replace(/```([^\n`]*)\n([\s\S]*?)```/g, (_, rawLang, code) => {
    const lang = rawLang.trim();
    if (lang === 'mermaid') {
      const body = escapeMermaid ? escapeHtml(code.trim()) : code.trim();
      return tokens.stash(`<pre class="mermaid">\n${body}\n</pre>`);
    }
    const cls = lang ? ` class="language-${lang}"` : '';
    return tokens.stash(`<pre><code${cls}>${escapeHtml(code.trim())}</code></pre>`);
  });
}

function stashInlineCode(text, tokens) {
  return text.replace(/`([^`]+)`/g, (_, code) => tokens.stash(`<code>${escapeHtml(code)}</code>`));
}

function stashInlineMath(text, tokens) {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch !== '$' || text[i + 1] === '$' || text[i - 1] === '\\') {
      out += ch;
      continue;
    }

    let end = i + 1;
    while (end < text.length) {
      if (text[end] === '$' && text[end - 1] !== '\\') break;
      end += 1;
    }

    if (end >= text.length) {
      out += ch;
      continue;
    }

    const inner = text.slice(i + 1, end);
    if (!inner.trim()) {
      out += ch;
      continue;
    }

    out += tokens.stash(`<span class="math-inline">$${inner}$</span>`);
    i = end;
  }
  return out;
}

function extractFootnotes(md) {
  const lines = normalizeMarkdown(md).split('\n');
  const bodyLines = [];
  const definitions = new Map();

  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(/^\[\^([^\]]+)\]:\s*(.*)$/);
    if (!match) {
      bodyLines.push(lines[i]);
      continue;
    }

    const noteLines = [match[2]];
    while (i + 1 < lines.length) {
      const next = lines[i + 1];
      if (/^(?: {2,}|\t)/.test(next)) {
        noteLines.push(next.replace(/^(?: {2,}|\t)/, ''));
        i += 1;
        continue;
      }
      if (!next.trim() && /^(?: {2,}|\t)/.test(lines[i + 2] || '')) {
        noteLines.push('');
        i += 1;
        continue;
      }
      break;
    }

    definitions.set(match[1], noteLines.join('\n').trim());
  }

  return {
    body: bodyLines.join('\n'),
    definitions
  };
}

function createFootnoteState(definitions) {
  return {
    definitions,
    order: [],
    numbers: new Map()
  };
}

function getFootnoteNumber(state, id) {
  if (!state.definitions.has(id)) return null;
  if (!state.numbers.has(id)) {
    state.order.push(id);
    state.numbers.set(id, state.order.length);
  }
  return state.numbers.get(id);
}

function toFootnoteSlug(id) {
  return id.replace(/[^\w-]+/g, '-');
}

function renderInlineMarkdown(text, tokens, footnotes, options) {
  options = options || {};
  let html = text;
  html = stashInlineCode(html, tokens);
  html = stashInlineMath(html, tokens);
  if (options.allowFootnoteRefs !== false) {
    html = html.replace(/\[\^([^\]]+)\]/g, (_, id) => {
      const number = getFootnoteNumber(footnotes, id);
      if (!number) return `[^${id}]`;
      const slug = toFootnoteSlug(id);
      return `<sup id="fnref-${slug}"><a href="#fn-${slug}" class="footnote-ref">${number}</a></sup>`;
    });
  }
  html = html.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '<a href="$1.html" class="wiki-link">$2</a>');
  // Space-separated wikilink (LLM frequently emits [[concept-foo 中文标签]] instead of
  // the canonical [[concept-foo|中文标签]]). Split on the first whitespace iff the
  // leading token looks like a slug (kebab-case, starts with letter).
  html = html.replace(/\[\[([^\]|]+)\]\]/g, (_, inner) => {
    const trimmed = inner.trim();
    const firstSpace = trimmed.search(/\s/);
    if (firstSpace > 0) {
      const slugCandidate = trimmed.slice(0, firstSpace);
      const labelCandidate = trimmed.slice(firstSpace).trim();
      if (/^[a-z][a-z0-9-]*$/i.test(slugCandidate) && labelCandidate) {
        return `<a href="${slugCandidate}.html" class="wiki-link">${labelCandidate}</a>`;
      }
    }
    return `<a href="${trimmed}.html" class="wiki-link">${trimmed}</a>`;
  });
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" loading="lazy">');
  // Markdown link [text](url) — but if the URL has no scheme, no extension, and looks like a wiki slug
  // (concept-X / entity-X / src-X / ...), treat it as a wiki-link so build.js can resolve it via slugMap.
  // This catches LLM output like "[src-20260504-ch05-...](src-20260504-ch05-...)".
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) => {
    const trimmed = url.trim();
    const isExternal = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|mailto:|tel:)/i.test(trimmed);
    const hasExtension = /\.[a-z0-9]+(?:[#?]|$)/i.test(trimmed);
    const looksLikeSlug = /^(concept|entity|comparison|synthesis|src|structure|skill|checklist|question)-/i.test(trimmed);
    if (!isExternal && !hasExtension && looksLikeSlug) {
      return `<a href="${trimmed}.html" class="wiki-link">${text}</a>`;
    }
    return `<a href="${trimmed}">${text}</a>`;
  });
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, '<em>$1</em>');
  return tokens.restore(html);
}

function splitTableRow(row) {
  const source = row.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells = [];
  let current = '';
  let inCode = false;
  let inWikiLink = false;

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];

    if (ch === '\\' && next) {
      current += ch + next;
      i += 1;
      continue;
    }

    if (ch === '`') {
      inCode = !inCode;
      current += ch;
      continue;
    }

    if (!inCode && ch === '[' && next === '[') {
      inWikiLink = true;
      current += '[[';
      i += 1;
      continue;
    }

    if (!inCode && ch === ']' && next === ']' && inWikiLink) {
      inWikiLink = false;
      current += ']]';
      i += 1;
      continue;
    }

    if (ch === '|' && !inCode && !inWikiLink) {
      cells.push(current.trim());
      current = '';
      continue;
    }

    current += ch;
  }

  cells.push(current.trim());
  return cells;
}

function parseTable(block, renderInline) {
  const lines = block.split('\n').map(line => line.trim()).filter(Boolean);
  if (lines.length < 2) return null;

  const headers = splitTableRow(lines[0]);
  const separators = splitTableRow(lines[1]);
  if (!headers.length || headers.length !== separators.length) return null;

  const aligns = [];
  for (const separator of separators) {
    const trimmed = separator.trim();
    if (!/^:?-{3,}:?$/.test(trimmed)) return null;
    if (trimmed.startsWith(':') && trimmed.endsWith(':')) {
      aligns.push('center');
    } else if (trimmed.endsWith(':')) {
      aligns.push('right');
    } else if (trimmed.startsWith(':')) {
      aligns.push('left');
    } else {
      aligns.push(null);
    }
  }

  const renderCell = (tag, content, align) => {
    const alignAttr = align ? ` style="text-align:${align}"` : '';
    return `<${tag}${alignAttr}>${renderInline(content)}</${tag}>`;
  };
  const ths = headers.map((cell, index) => renderCell('th', cell, aligns[index])).join('');
  const rows = lines.slice(2).map(line => {
    const cells = splitTableRow(line);
    const padded = headers.map((_, index) => cells[index] || '');
    return `<tr>${padded.map((cell, index) => renderCell('td', cell, aligns[index])).join('')}</tr>`;
  }).join('\n');

  return `<table>\n<thead><tr>${ths}</tr></thead>\n<tbody>\n${rows}\n</tbody>\n</table>`;
}

function parseList(block, renderInline) {
  const rawLines = block.split('\n').filter(l => l.trim() !== '');
  if (!rawLines.length) return null;

  const first = rawLines[0];
  const topIndent = first.length - first.trimStart().length;
  const trimmedFirst = first.trimStart();
  const isOrdered = /^\d+\.\s/.test(trimmedFirst);
  const isUnordered = /^-\s/.test(trimmedFirst);
  if (!isOrdered && !isUnordered) return null;

  const itemRe = isOrdered ? /^(\s*)\d+\.\s(.*)$/ : /^(\s*)-\s(.*)$/;
  const parsed = [];
  for (const line of rawLines) {
    const m = line.match(itemRe);
    if (m) {
      const depth = Math.floor((m[1].length - topIndent) / 2);
      parsed.push({ depth: Math.max(0, depth), text: m[2].trim() });
    } else if (parsed.length > 0) {
      parsed[parsed.length - 1].text += ' ' + line.trim();
    }
  }
  if (!parsed.length) return null;

  const tag = isOrdered ? 'ol' : 'ul';
  let html = `<${tag}>`;
  const stack = [0];
  for (let i = 0; i < parsed.length; i++) {
    const { depth, text } = parsed[i];
    const curDepth = stack[stack.length - 1];
    if (depth > curDepth) {
      html += `<${tag}>`;
      stack.push(depth);
    } else {
      while (stack.length > 1 && stack[stack.length - 1] > depth) {
        html += `</li></${tag}>`;
        stack.pop();
      }
      if (i > 0) html += '</li>';
    }
    html += `<li>${renderInline(text)}`;
  }
  while (stack.length > 1) {
    html += `</li></${tag}>`;
    stack.pop();
  }
  html += `</li></${tag}>`;
  return html;
}

function renderFootnotes(tokens, footnotes) {
  if (!footnotes.order.length) return '';
  const items = footnotes.order.map(id => {
    const slug = toFootnoteSlug(id);
    const content = renderInlineMarkdown(
      footnotes.definitions.get(id) || '',
      tokens,
      footnotes,
      { allowFootnoteRefs: false }
    );
    return `<li id="fn-${slug}">${content} <a href="#fnref-${slug}" class="footnote-backref" aria-label="返回正文">↩</a></li>`;
  }).join('\n');

  return `<section class="footnotes">\n<hr>\n<ol>\n${items}\n</ol>\n</section>`;
}

function renderBlock(block, tokens, footnotes) {
  const trimmed = block.trim();
  if (!trimmed) return '';
  if (isTokenOnly(trimmed)) return trimmed;
  if (/^<(h[1-6]|ul|ol|pre|div|section|table|blockquote)/.test(trimmed)) return trimmed;

  if (trimmed.includes('\n') && /^#{1,6}\s/.test(trimmed)) {
    const lines = trimmed.split('\n');
    const parts = [];
    let buf = [];
    for (const line of lines) {
      if (/^#{1,6}\s/.test(line) && buf.length > 0) {
        parts.push(buf.join('\n'));
        buf = [];
      }
      buf.push(line);
    }
    if (buf.length > 0) parts.push(buf.join('\n'));
    if (parts.length > 1 || parts[0] !== trimmed) {
      return parts.map(p => renderBlock(p, tokens, footnotes)).filter(Boolean).join('\n');
    }
  }

  const headingMatch = trimmed.match(/^(#{1,6}) (.+)$/);
  if (headingMatch && !trimmed.includes('\n')) {
    const level = headingMatch[1].length;
    const raw = headingMatch[2];
    const slug = raw.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^\w\u4e00-\u9fff]+/g, '-').replace(/^-|-$/g, '') || `h${level}`;
    return `<h${level} id="${slug}">${renderInlineMarkdown(raw, tokens, footnotes)}</h${level}>`;
  }

  if (/^#{1,6}\s+.+\n/.test(trimmed)) {
    const firstNl = trimmed.indexOf('\n');
    const headLine = trimmed.slice(0, firstNl);
    const rest = trimmed.slice(firstNl + 1);
    return renderBlock(headLine, tokens, footnotes) + '\n' + renderBlock(rest, tokens, footnotes);
  }

  if (/^\$\$[\s\S]+\$\$$/.test(trimmed)) {
    return `<div class="math-block">${trimmed}</div>`;
  }

  if (/^>\s?/.test(trimmed)) {
    const bqLines = trimmed.split('\n');
    const inner = bqLines.map(l => l.replace(/^>\s?/, '')).join('\n');
    const innerBlocks = inner.split(/\n\n+/).filter(Boolean);
    const innerHtml = innerBlocks
      .map(b => renderBlock(b.trim(), tokens, footnotes))
      .filter(Boolean)
      .join('\n');
    return `<blockquote>${innerHtml}</blockquote>`;
  }

  const renderInline = value => renderInlineMarkdown(value, tokens, footnotes);
  const table = parseTable(trimmed, renderInline);
  if (table) return table;

  if (trimmed.includes('\n') && /\n\s*(-\s|\d+\.\s)/.test('\n' + trimmed)) {
    const lines = trimmed.split('\n');
    const listStart = lines.findIndex(l => /^\s*(-\s|\d+\.\s)/.test(l));
    if (listStart > 0) {
      const prePart = lines.slice(0, listStart).join('\n');
      const listPart = lines.slice(listStart).join('\n');
      const preHtml = renderBlock(prePart, tokens, footnotes);
      const listHtml = renderBlock(listPart, tokens, footnotes);
      return [preHtml, listHtml].filter(Boolean).join('\n');
    }
  }

  const list = parseList(trimmed, renderInline);
  if (list) return list;

  return `<p>${renderInline(trimmed)}</p>`;
}

/**
 * Convert markdown string to HTML.
 * @param {string} md
 * @param {object} [options]
 * @param {boolean} [options.escapeMermaidBody] - escape mermaid content (LLM-Wiki style)
 */
function mergeListBlocks(source) {
  const blocks = source.split(/\n\n+/);
  const merged = [];
  const listLineRe = /^(\s*(-|\d+\.)\s)/;
  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    const prev = merged.length > 0 ? merged[merged.length - 1] : null;
    if (prev && listLineRe.test(trimmed) && listLineRe.test(prev.trim().split('\n')[0])) {
      merged[merged.length - 1] = prev + '\n' + trimmed;
    } else {
      merged.push(block);
    }
  }
  return merged;
}

function markdownToHtml(md, options) {
  const tokens = createTokenStore();
  const { body, definitions } = extractFootnotes(md);
  const footnotes = createFootnoteState(definitions);
  const blockSource = stashFencedCodeBlocks(normalizeMarkdown(body), tokens, options);
  const blocks = mergeListBlocks(blockSource);
  const htmlBlocks = blocks
    .map(block => renderBlock(block, tokens, footnotes))
    .filter(Boolean);

  const footnotesHtml = renderFootnotes(tokens, footnotes);
  if (footnotesHtml) {
    htmlBlocks.push(footnotesHtml);
  }

  return tokens.restore(htmlBlocks.join('\n'));
}

/**
 * Parse YAML-like frontmatter from markdown content.
 * Uses KnowLever's richer parser: indexOf for colon, bracket stripping, date fallbacks.
 */
function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };
  const meta = {};
  match[1].split('\n').forEach(line => {
    const ci = line.indexOf(':');
    if (ci < 1) return;
    const k = line.slice(0, ci).trim();
    if (k.startsWith('-') || k.startsWith(' ')) return;
    let v = line.slice(ci + 1).trim();
    if (/^".*"$/.test(v)) v = v.slice(1, -1);
    if (k === 'tags' || k === 'aliases' || k === 'projects' || k === 'related' || k === 'sources') {
      v = v.replace(/^\[/, '').replace(/\]$/, '');
    }
    meta[k] = v;
  });
  if (!meta.date && meta.updated) meta.date = meta.updated;
  if (!meta.date && meta.created) meta.date = meta.created;
  return { meta, body: match[2] };
}

function extractToc(bodyHtml) {
  const headings = [];
  const re = /<h([2-4])\s+id="([^"]*)"[^>]*>([\s\S]*?)<\/h\1>/g;
  let m;
  while ((m = re.exec(bodyHtml)) !== null) {
    headings.push({ level: Number(m[1]), id: m[2], text: m[3].replace(/<[^>]+>/g, '') });
  }
  return headings;
}

function renderTocHtml(toc) {
  if (!toc.length) return '';
  const items = toc.map(h => {
    const indent = h.level - 2;
    return `<a href="#${h.id}" class="toc-link toc-level-${h.level}" style="padding-left:${indent * 0.9}rem">${h.text}</a>`;
  }).join('\n');
  return `<nav class="page-toc" aria-label="目录">\n<div class="toc-title">目录</div>\n${items}\n</nav>`;
}

module.exports = {
  escapeHtml,
  hashPageContent,
  normalizeMarkdown,
  createTokenStore,
  stashFencedCodeBlocks,
  stashInlineCode,
  stashInlineMath,
  extractFootnotes,
  renderInlineMarkdown,
  splitTableRow,
  parseTable,
  parseList,
  renderFootnotes,
  renderBlock,
  markdownToHtml,
  parseFrontmatter,
  extractToc,
  renderTocHtml,
};
