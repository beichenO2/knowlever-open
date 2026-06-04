/**
 * llm-client.js — OpenAI-compatible LLM client for KnowLever Open.
 *
 * Reads config from config.json and supports:
 *   - Standard chat completions (with/without tools)
 *   - Embedding requests
 *
 * Environment overrides:
 *   LLM_BASE_URL    — OpenAI-compatible base URL (default: http://127.0.0.1:12790)
 *   LLM_API_KEY     — API key (default: "sk-placeholder")
 *   LLM_MODEL       — Model name override
 *   EMBED_BASE_URL  — Embedding endpoint base URL
 *   EMBED_MODEL     — Embedding model name
 */

const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
let _config = null;

function loadConfig() {
  if (_config) return _config;
  const cfgPath = path.join(ROOT, 'config.json');
  if (fs.existsSync(cfgPath)) {
    _config = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
  } else {
    _config = {};
  }
  return _config;
}

function getBaseUrl() {
  return process.env.LLM_BASE_URL || 'http://127.0.0.1:12790';
}

function getApiKey() {
  return process.env.LLM_API_KEY || 'sk-placeholder';
}

function getModel() {
  const cfg = loadConfig();
  return process.env.LLM_MODEL || cfg.llm?.model || 'gpt-4o-mini';
}

function getEmbedBaseUrl() {
  return process.env.EMBED_BASE_URL || getBaseUrl();
}

function getEmbedModel() {
  const cfg = loadConfig();
  return process.env.EMBED_MODEL || cfg.embedding?.model || 'text-embedding-3-small';
}

async function chatCompletion({ messages, tools, tool_choice, temperature = 0.3, max_tokens = 4096, model }) {
  const baseUrl = getBaseUrl().replace(/\/$/, '');

  // For Ollama qwen3 thinking models: prepend /no_think to disable CoT
  const isOllama = baseUrl.includes('11434');
  let processedMessages = messages;
  if (isOllama && messages.length > 0) {
    processedMessages = [...messages];
    const lastMsg = { ...processedMessages[processedMessages.length - 1] };
    if (lastMsg.role === 'user' && typeof lastMsg.content === 'string') {
      lastMsg.content = '/no_think\n' + lastMsg.content;
    }
    processedMessages[processedMessages.length - 1] = lastMsg;
  }

  const body = {
    model: model || getModel(),
    messages: processedMessages,
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
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`LLM API ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();

  // Handle qwen3 thinking model: if content is empty but reasoning exists
  if (data.choices?.[0]?.message) {
    const msg = data.choices[0].message;
    if ((!msg.content || msg.content.trim() === '') && msg.reasoning) {
      msg.content = msg.reasoning;
    }
  }

  return data;
}

async function embedding(texts, { model } = {}) {
  const baseUrl = getEmbedBaseUrl().replace(/\/$/, '');
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

module.exports = { chatCompletion, embedding, getModel, getEmbedModel, loadConfig };
