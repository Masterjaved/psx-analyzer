const test = require("node:test");
const assert = require("node:assert");
const { stubPackage, stubFile, makeHistory, post, fakeSupabase } = require("./helpers/env");

stubPackage("cheerio", {});
const { addUser } = fakeSupabase();
const u1 = addUser("u1", "u1@example.com");

class PSXDataError extends Error {}
let aiCalls = 0;
stubFile("lib/psxData.js", {
  PSXDataError,
  DATA_SOURCE: "TEST SOURCE",
  fetchIntraday: async () => [],
  fetchHistory: async (symbol) => {
    if (symbol === "NOPE") throw new PSXDataError("no data");
    if (symbol === "ONE") return [{ date: "D1", close: 10 }];
    return makeHistory(5, (i) => (i === 4 ? 110 : 100));
  },
});
stubFile("lib/aiProviders.js", { analyzeWithFallback: async () => { aiCalls++; return {}; } });

const { handler } = require("../netlify/functions/quotes");
const rows = (r) => JSON.parse(r.body);

test("quotes: login required", async () => {
  assert.strictEqual((await handler(post({ symbols: ["OGDC"] }))).statusCode, 401);
});

test("quotes: price, previous close, change and % — and no AI is ever called", async () => {
  const [q] = rows(await handler(post({ symbols: ["ogdc"] }, u1.headers)));
  assert.strictEqual(q.price, 110);
  assert.strictEqual(q.prev_close, 100);
  assert.strictEqual(q.change, 10);
  assert.strictEqual(q.change_pct, 10);
  assert.strictEqual(q.data_source, "TEST SOURCE");
  assert.strictEqual(aiCalls, 0);
});

test("quotes: handles a single-day history, unknown symbols, and supports 30 symbols (analyze only allowed 10)", async () => {
  const r = rows(await handler(post({ symbols: ["ONE", "NOPE"] }, u1.headers)));
  assert.strictEqual(r[0].change, null);
  assert.strictEqual(r[0].price, 10);
  assert.ok(r[1].error);

  const thirty = Array.from({ length: 30 }, (_, i) => `S${i}`);
  assert.strictEqual((await handler(post({ symbols: thirty }, u1.headers))).statusCode, 200);
  assert.strictEqual((await handler(post({ symbols: [...thirty, "EXTRA"] }, u1.headers))).statusCode, 400);
  assert.strictEqual((await handler(post({ symbols: ["<x>"] }, u1.headers))).statusCode, 400);
});
