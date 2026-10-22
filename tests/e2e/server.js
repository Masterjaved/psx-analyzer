/**
 * Local test server for the browser (end-to-end) test.
 * Serves public/ and runs the REAL Netlify Function handlers. Supabase
 * (Auth + database) is faked with the SAME in-memory backend used by the
 * unit tests (tests/helpers/env.js createFakeSupabaseBackend) — the
 * Netlify Functions reach it because SUPABASE_URL is pointed at this local
 * server; the browser reaches it because e2e.js intercepts requests to the
 * real (hardcoded) Supabase URL and forwards them here. PSX data, news and
 * the AI providers are also faked.
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { stubPackage, stubFile, fakeStore, makeHistory, ROOT, createFakeSupabaseBackend } = require("../helpers/env");

stubPackage("cheerio", {});
const portfolios = fakeStore();
const alertState = fakeStore();
stubPackage("@netlify/blobs", { getStore: () => alertState });
stubFile("lib/blobStore.js", { portfolioStore: () => portfolios });

class PSXDataError extends Error {}
stubFile("lib/psxData.js", {
  PSXDataError,
  DATA_SOURCE: "PSX Data Portal (test)",
  fetchIntraday: async () => [],
  fetchHistory: async (symbol) => {
    if (symbol === "NOPE") throw new PSXDataError("کوئی ڈیٹا نہیں ملا");
    if (symbol === "LOWCO") return makeHistory(120, (i) => 300 - i);
    if (symbol === "DOWN") return makeHistory(120, (i) => 300 - i);
    return makeHistory(120, (i) => 100 + i);
  },
});
stubFile("lib/aiProviders.js", {
  ProviderError: class extends Error {},
  analyzeWithFallback: async (prompt) =>
    prompt.includes("Stock: XSSAI.")
      ? { text: "<img src=x onerror=window.__xssAI=1>", providerLabel: "<b>Evil</b>" }
      : { text: "AI summary (test)", providerLabel: "TestAI" },
});
stubFile("lib/newsFetch.js", {
  fetchNews: async () => [
    { title: '<img src=x onerror=window.__xssNews=1> Big news', pubDate: "Mon, 21 Sep 2026", link: "https://news.example/a", source: "Dawn" },
    { title: "Bad link", pubDate: "", link: "javascript:window.__xssLink=1", source: "X" },
  ],
});
const sentEmails = [];
stubFile("lib/email.js", { sendEmail: async (to, subject, html) => void sentEmails.push({ to, subject, html }) });

function start(port = 0) {
  // SUPABASE_URL is set once the server knows its own port (below), so
  // require the functions AFTER that — they read process.env.SUPABASE_URL
  // once at module load via lib/supabase.js's top-level constants.
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, "http://x");
      let raw = "";
      for await (const c of req) raw += c;

      if (url.pathname === "/__stats") return res.end(JSON.stringify({ apiCalls: stats.apiCalls }));
      if (url.pathname === "/__seed-admin") {
        backend.addUser("root", "admin@example.com", "admin");
        return res.end("ok");
      }
      if (url.pathname === "/__emails") return res.end(JSON.stringify(sentEmails));

      // ---- fake Supabase (both Auth and PostgREST) — used directly by
      // Netlify Functions here, and proxied to from the browser by e2e.js.
      if (url.pathname.startsWith("/auth/v1/") || url.pathname.startsWith("/rest/v1/")) {
        const r = backend.respond(req.method, url.pathname, url.searchParams, req.headers, raw);
        res.statusCode = r.status;
        res.setHeader("Content-Type", "application/json");
        return res.end(JSON.stringify(r.json));
      }

      // ---- Netlify Functions
      const fnMatch = /^\/(?:api|\.netlify\/functions)\/([\w-]+)$/.exec(url.pathname);
      if (fnMatch && handlers[fnMatch[1]]) {
        stats.apiCalls[fnMatch[1]] = (stats.apiCalls[fnMatch[1]] || 0) + 1;
        const event = {
          httpMethod: req.method,
          body: raw || null,
          headers: req.headers,
          queryStringParameters: Object.fromEntries(url.searchParams),
        };
        const out = await handlers[fnMatch[1]](event, {});
        res.statusCode = out.statusCode;
        for (const [k, v] of Object.entries(out.headers || {})) res.setHeader(k, v);
        return res.end(out.body);
      }

      // ---- static files
      let p = url.pathname === "/" ? "/index.html" : url.pathname;
      const file = path.join(ROOT, "public", p);
      if (!file.startsWith(path.join(ROOT, "public")) || !fs.existsSync(file)) {
        res.statusCode = 404;
        return res.end("not found");
      }
      const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json", ".png": "image/png" };
      res.setHeader("Content-Type", MIME[path.extname(file)] || "application/octet-stream");
      res.end(fs.readFileSync(file));
    });
    server.listen(port, () => {
      process.env.SUPABASE_URL = `http://localhost:${server.address().port}`;
      process.env.SUPABASE_ANON_KEY = "test-anon-key";
      resolve(server);
    });
  });
}

const stats = { apiCalls: {} };
const backend = createFakeSupabaseBackend();
backend.addUser("alice", "alice@example.com");
backend.addUser("bob", "bob@example.com");

// The functions read SUPABASE_URL from process.env at require-time, so they
// must be required only once the server (above) has set it — start() sets
// it synchronously inside server.listen's callback before resolving, and
// callers always `await start()` before making any request, but the
// require() calls themselves must still happen after start() sets the env
// var. Requiring them lazily on first use keeps this correct either way.
let handlers = null;
const realStart = start;
module.exports = {
  start: async (port) => {
    const server = await realStart(port);
    handlers = {
      analyze: require("../../netlify/functions/analyze").handler,
      quotes: require("../../netlify/functions/quotes").handler,
      positions: require("../../netlify/functions/positions").handler,
      transactions: require("../../netlify/functions/transactions").handler,
      watchlist: require("../../netlify/functions/watchlist").handler,
      portfolio: require("../../netlify/functions/portfolio").handler,
      intraday: require("../../netlify/functions/intraday").handler,
      "admin-portfolios": require("../../netlify/functions/admin-portfolios").handler,
      "admin-users": require("../../netlify/functions/admin-users").handler,
      "debug-env": require("../../netlify/functions/debug-env").handler,
      "daily-alert-check": require("../../netlify/functions/daily-alert-check").handler,
    };
    return server;
  },
  backend,
};
