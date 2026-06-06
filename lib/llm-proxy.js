/**
 * llm-proxy.js — Unified LLM access layer for KnowLever Open.
 *
 * HTTP direct to PolarPrivate /v1/chat/completions — standalone mode.
 *
 * All stage files should require this instead of the old llm-client.js.
 */

const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
let _config = null;

function loadConfig() {
  if (_config) return _config;
  const cfgPath = path.join(ROOT, 'config.json');
  _config = fs.existsSync(cfgPath)
    ? JSON.parse(fs.readFileSync(cfgPath, 'utf-8'))
    : {};
  return _config;
}

function getCapability() {
  const cfg = loadConfig();
  return cfg.llm?.capability || '001';
}

function getModel() {
  const cfg = loadConfig();
  return process.env.LLM_MODEL || cfg.llm?.model || getCapability();
}

function getPolarPrivateUrl() {
  return process.env.LLM_BASE_URL || 'http://127.0.0.1:12790';
}

function getApiKey() {
  return process.env.LLM_API_KEY || 'sk-placeholder';
}

function getEmbedModel() {
  const cfg = loadConfig();
  return process.env.EMBED_MODEL || cfg.embedding?.model || 'E000';
}

/**
 * HTTP direct call to PolarPrivate.
 */
async function httpChat({ model, messages, tools, tool_choice, temperature = 0.3, max_tokens = 4096 }) {
  const baseUrl = getPolarPrivateUrl().replace(/\/$/, '');
  const body = {
    model: model || getModel(),
    messages,
    temperature,
    max_tokens,
    stream: false,
  };
  if (tools) body.tools = tools;
  if (tool_choice) body.tool_choice = tool_choice;

  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getApiKey()}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(600_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`LLM API ${res.status}: ${text.slice(0, 200)}`);
  }

  return await res.json();
}

/**
 * Unified chat completion.
 * Returns the same shape as OpenAI /v1/chat/completions response.
 */
async function chatCompletion({ capability, model, messages, tools, tool_choice, temperature = 0.3, max_tokens = 4096 }) {
  const cap = capability || model || getModel();
  return httpChat({ model: cap, messages, tools, tool_choice, temperature, max_tokens });
}

/**
 * Embedding via HTTP direct (SOTAgent has no embedding RPC).
 */
async function embedding(texts, { model } = {}) {
  const baseUrl = getPolarPrivateUrl().replace(/\/$/, '');
  const body = {
    model: model || getEmbedModel(),
    input: Array.isArray(texts) ? texts : [texts],
  };

  const res = await fetch(`${baseUrl}/v1/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getApiKey()}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Embedding API ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  return data.data.map(d => d.embedding);
}

module.exports = { chatCompletion, embedding, getModel, getEmbedModel, getCapability, loadConfig };
