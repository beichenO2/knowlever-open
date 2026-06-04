/**
 * llm-proxy.js — Unified LLM access layer for KnowLever Open.
 *
 * Priority chain:
 *   1. SOTAgent sdk-port  call('polarprivate.chat', ...) — ecosystem mode
 *   2. HTTP direct to PolarPrivate /v1/chat/completions  — standalone mode
 *
 * All stage files should require this instead of the old llm-client.js.
 */

const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
let _config = null;
let _sdkPort = null;
let _sdkPortAttempted = false;

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
 * Attempt to load SOTAgent sdk-port.
 * Searches multiple candidate paths; caches the result.
 */
function getSdkPort() {
  if (_sdkPortAttempted) return _sdkPort;
  _sdkPortAttempted = true;

  const homeDir = process.env.HOME || process.env.USERPROFILE || '';
  const candidates = [
    path.join(ROOT, '..', 'SOTAgent', 'sdk-port', 'index.js'),
    path.join(homeDir, 'Polarisor', 'SOTAgent', 'sdk-port', 'index.js'),
  ];

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        _sdkPort = require(p);
        console.log(`[llm-proxy] SOTAgent sdk-port loaded from ${p}`);
        return _sdkPort;
      }
    } catch (e) {
      // continue to next candidate
    }
  }

  console.log('[llm-proxy] SOTAgent sdk-port not found, using HTTP direct mode');
  return null;
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
  const sdk = getSdkPort();
  const cap = capability || model || getModel();

  if (sdk?.call) {
    try {
      const params = { capability: cap, messages, temperature, max_tokens };
      if (tools) params.tools = tools;
      if (tool_choice) params.tool_choice = tool_choice;

      const result = await sdk.call('polarprivate.chat', params);
      return result?.data || result;
    } catch (e) {
      console.log(`[llm-proxy] SOTAgent call failed (${e.message}), falling back to HTTP`);
    }
  }

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
