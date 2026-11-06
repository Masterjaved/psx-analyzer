/**
 * AI provider abstraction with automatic fallback.
 * Tries providers in PROVIDER_ORDER (from Netlify environment variables);
 * on cloud deployment Ollama is skipped by default since there's no local
 * machine for it to reach — you can still list it if you point OLLAMA_HOST
 * at a machine that's reachable from the internet.
 */

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

async function callClaude(prompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new ProviderError("ANTHROPIC_API_KEY not set");

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
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
  });

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

async function callGemini(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new ProviderError("GEMINI_API_KEY not set");

  const model = process.env.GEMINI_MODEL || "gemini-2.0-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const resp = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });

  if (resp.status === 429) throw new ProviderError("Gemini daily free quota exhausted (429)");
  if (!resp.ok) throw new ProviderError(`Gemini request failed (status ${resp.status})`);

  const data = await resp.json();
  const text =
    data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
  if (!text) throw new ProviderError("Gemini returned an empty response");
  return text;
}

async function callGroq(prompt) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new ProviderError("GROQ_API_KEY not set");

  const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
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
  });

  if ([401, 402, 403, 429].includes(resp.status)) {
    throw new ProviderError(`Groq unavailable (status ${resp.status}) — low credits or rate limited`);
  }
  if (!resp.ok) throw new ProviderError(`Groq request failed (status ${resp.status})`);

  const data = await resp.json();
  const text = data?.choices?.[0]?.message?.content?.trim() || "";
  if (!text) throw new ProviderError("Groq returned an empty response");
  return text;
}

async function callOllama(prompt) {
  const host = process.env.OLLAMA_HOST;
  if (!host) throw new ProviderError("OLLAMA_HOST not set (only useful if reachable from the internet)");

  const resp = await fetch(`${host}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: process.env.OLLAMA_MODEL || "llama3:latest",
      prompt,
      stream: false,
    }),
  });

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

async function analyzeWithFallback(prompt) {
  const order = getProviderOrder();
  const errors = [];

  for (const name of order) {
    const fn = PROVIDER_FUNCS[name];
    if (!fn) continue;
    try {
      const text = await fn(prompt);
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
