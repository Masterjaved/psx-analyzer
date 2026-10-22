/**
 * AI provider abstraction with automatic fallback.
 * Tries providers in PROVIDER_ORDER (from Netlify environment variables);
 * on cloud deployment Ollama is skipped by default since there's no local
 * machine for it to reach — you can still list it if you point OLLAMA_HOST
 * at a machine that's reachable from the internet.
 */

const { timedFetch } = require("./net");

class ProviderError extends Error {}

const PROVIDER_LABELS = {
  claude: "Claude",
  gemini: "Gemini",
  groq: "Groq",
  ollama: "Ollama",
};

function getProviderOrder() {
  const raw = process.env.PROVIDER_ORDER || "claude,gemini,groq";
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

async function callClaude(prompt, timeoutMs) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new ProviderError("ANTHROPIC_API_KEY not set");

  const resp = await timedFetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.CLAUDE_MODEL || "claude-sonnet-4-6",
      max_tokens: 500,
      messages: [{ role: "user", content: prompt }],
    }),
  }, timeoutMs);

  if ([401, 402, 403, 429].includes(resp.status)) {
    throw new ProviderError(`Claude unavailable (status ${resp.status}) — low credits or rate limited`);
  }
  if (!resp.ok) throw new ProviderError(`Claude request failed (status ${resp.status})`);

  const data = await resp.json();
  const text = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  if (!text) throw new ProviderError("Claude returned an empty response");
  return text;
}

async function callGemini(prompt, timeoutMs) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new ProviderError("GEMINI_API_KEY not set");

  const model = process.env.GEMINI_MODEL || "gemini-2.0-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const resp = await timedFetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  }, timeoutMs);

  if (resp.status === 429) throw new ProviderError("Gemini daily free quota exhausted (429)");
  if (!resp.ok) throw new ProviderError(`Gemini request failed (status ${resp.status})`);

  const data = await resp.json();
  const text =
    data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
  if (!text) throw new ProviderError("Gemini returned an empty response");
  return text;
}

async function callGroq(prompt, timeoutMs) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new ProviderError("GROQ_API_KEY not set");

  const resp = await timedFetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 500,
    }),
  }, timeoutMs);

  if ([401, 402, 403, 429].includes(resp.status)) {
    throw new ProviderError(`Groq unavailable (status ${resp.status}) — low credits or rate limited`);
  }
  if (!resp.ok) throw new ProviderError(`Groq request failed (status ${resp.status})`);

  const data = await resp.json();
  const text = data?.choices?.[0]?.message?.content?.trim() || "";
  if (!text) throw new ProviderError("Groq returned an empty response");
  return text;
}

async function callOllama(prompt, timeoutMs) {
  const host = process.env.OLLAMA_HOST;
  if (!host) throw new ProviderError("OLLAMA_HOST not set (only useful if reachable from the internet)");

  const resp = await timedFetch(`${host}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: process.env.OLLAMA_MODEL || "llama3:latest",
      prompt,
      stream: false,
    }),
  }, timeoutMs);

  if (!resp.ok) throw new ProviderError(`Ollama request failed (status ${resp.status})`);
  const data = await resp.json();
  const text = (data.response || "").trim();
  if (!text) throw new ProviderError("Ollama returned an empty response");
  return text;
}

const PROVIDER_FUNCS = {
  claude: callClaude,
  gemini: callGemini,
  groq: callGroq,
  ollama: callOllama,
};

/**
 * Tries each provider in order. `options.deadline` (epoch ms) is the latest
 * moment we are willing to wait — each provider gets at most the time that
 * is left, so one slow provider can't eat the whole function budget and a
 * failing provider falls through to the next one while time remains.
 */
async function analyzeWithFallback(prompt, options = {}) {
  const order = getProviderOrder();
  const deadline = options.deadline || Date.now() + 8000;
  const errors = [];

  for (const name of order) {
    const fn = PROVIDER_FUNCS[name];
    if (!fn) continue;
    const remaining = deadline - Date.now();
    if (remaining < 1500) {
      errors.push(`${name}: skipped (out of time)`);
      continue;
    }
    try {
      const text = await fn(prompt, remaining);
      return { text, provider: name, providerLabel: PROVIDER_LABELS[name] || name };
    } catch (e) {
      errors.push(`${name}: ${e.message}`);
    }
  }

  throw new ProviderError(
    "تمام AI providers ناکام ہو گئے / all providers failed: " + errors.join(" | ")
  );
}

module.exports = { analyzeWithFallback, ProviderError };
