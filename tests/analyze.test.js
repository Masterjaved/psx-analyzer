const test = require("node:test");
const assert = require("node:assert");
const { stubPackage, stubFile, makeHistory, post, fakeSupabase } = require("./helpers/env");

stubPackage("cheerio", {});
const { addUser } = fakeSupabase();
const u1 = addUser("u1", "u1@example.com");

class PSXDataError extends Error {}
const calls = { history: [], ai: 0, news: 0, peak: 0, running: 0 };
let aiShouldFail = false;

stubFile("lib/psxData.js", {
  PSXDataError,
  DATA_SOURCE: "TEST SOURCE",
  fetchIntraday: async () => [],
  fetchHistory: async (symbol) => {
    calls.history.push(symbol);
    calls.running++;
    calls.peak = Math.max(calls.peak, calls.running);
    await new Promise((r) => setTimeout(r, 60));
    calls.running--;
    if (symbol === "NOPE") throw new PSXDataError("کوئی ڈیٹا نہیں ملا");
    if (symbol === "NEWCO") return makeHistory(10, (i) => 50 + i); // too short
    if (symbol === "LOWCO") return makeHistory(120, (i) => 300 - i); // near its low → news fetched
    return makeHistory(120, (i) => 100 + i);
  },
});
stubFile("lib/aiProviders.js", {
  ProviderError: class extends Error {},
  analyzeWithFallback: async () => {
    calls.ai++;
    if (aiShouldFail) throw new Error("all providers failed");
    return { text: "AI summary", providerLabel: "TestAI" };
  },
});
stubFile("lib/newsFetch.js", {
  fetchNews: async () => {
    calls.news++;
    return [{ title: "Headline", pubDate: "Mon", link: "https://x.test/a", source: "Src" }];
  },
});

const { handler } = require("../netlify/functions/analyze");
const call = (symbols, headers = u1.headers) => handler(post({ symbols }, headers));
const rows = (r) => JSON.parse(r.body);

test("auth and method checks", async () => {
  assert.strictEqual((await handler(post({ symbols: ["OGDC"] }))).statusCode, 401);
  assert.strictEqual((await handler({ httpMethod: "GET", headers: u1.headers })).statusCode, 405);
  assert.strictEqual((await call([])).statusCode, 400);
  assert.strictEqual((await call(Array.from({ length: 11 }, (_, i) => `S${i}`))).statusCode, 400);
  assert.strictEqual((await handler(post("{bad", u1.headers))).statusCode, 400);
});

test("success row carries source and as-of date, results keep request order", async () => {
  const r = rows(await call(["ogdc", "ffc", "hubc"]));
  assert.deepStrictEqual(r.map((x) => x.symbol), ["OGDC", "FFC", "HUBC"]);
  assert.strictEqual(r[0].data_source, "TEST SOURCE");
  assert.strictEqual(r[0].data_as_of, "D120");
  assert.ok(r[0].fetched_at);
  assert.strictEqual(r[0].ai_summary, "AI summary");
  assert.strictEqual(r[0].trend_en, "Uptrend");
});

test("per-symbol failures don't sink the others: invalid, unknown, too little data", async () => {
  const r = rows(await call(["OGDC", "<script>", "NOPE", "NEWCO"]));
  assert.ok(!r[0].error);
  assert.match(r[1].error, /غلط|invalid/);
  assert.match(r[2].error, /ڈیٹا/);
  assert.match(r[3].error, /Insufficient|ناکافی/);
  assert.ok(!("price" in r[3]), "no numbers are shown when data is insufficient");
});

test("duplicate symbols are analysed once", async () => {
  calls.history.length = 0;
  const r = rows(await call(["OGDC", "ogdc", " OGDC "]));
  assert.strictEqual(r.length, 1);
  assert.strictEqual(calls.history.length, 1);
});

test("symbols are processed in parallel (max 4 at once), not one after another", async () => {
  calls.peak = 0;
  const t0 = Date.now();
  rows(await call(["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8"]));
  const took = Date.now() - t0;
  assert.strictEqual(calls.peak, 4);
  assert.ok(took < 8 * 60 * 0.6, `took ${took}ms — sequential would be ~480ms`);
});

test("AI failure still returns the rule-based analysis with a clear note", async () => {
  aiShouldFail = true;
  const r = rows(await call(["OGDC"]));
  aiShouldFail = false;
  assert.ok(r[0].price != null && r[0].recommendation);
  assert.match(r[0].ai_summary, /دستیاب نہیں/);
  assert.strictEqual(r[0].ai_provider, null);
});

test("news is fetched only when the stock is near its recent low", async () => {
  calls.news = 0;
  const near = rows(await call(["LOWCO"]))[0];
  assert.strictEqual(near.three_month.labelEn, "Near low");
  assert.strictEqual(calls.news, 1);
  assert.strictEqual(near.news[0].source, "Src");
  calls.news = 0;
  rows(await call(["OGDC"]));
  assert.strictEqual(calls.news, 0);
});
