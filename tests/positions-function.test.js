const test = require("node:test");
const assert = require("node:assert");
const { stubPackage, stubFile, fakeSupabase, post } = require("./helpers/env");

stubPackage("cheerio", {});
const { addUser } = fakeSupabase();

class PSXDataError extends Error {}
stubFile("lib/psxData.js", {
  PSXDataError,
  DATA_SOURCE: "TEST",
  fetchHistory: async (symbol) => {
    if (symbol === "NOPRICE") throw new PSXDataError("کوئی قیمت نہیں");
    return [{ date: "2026-09-01", close: 150 }];
  },
});

const transactions = require("../netlify/functions/transactions").handler;
const { handler: positions } = require("../netlify/functions/positions");
const GET = (headers) => ({ httpMethod: "GET", headers });

test("no login → 401", async () => {
  assert.strictEqual((await positions(GET({}))).statusCode, 401);
});

test("empty portfolio (no transactions yet) → empty open/closed, zeroed totals", async () => {
  const u = addUser("p1", "p1@example.com");
  const r = JSON.parse((await positions(GET(u.headers))).body);
  assert.deepStrictEqual(r.open, []);
  assert.deepStrictEqual(r.closed, []);
  assert.deepStrictEqual(r.totals, { investedAmount: 0, currentValue: 0, unrealizedPL: 0, realizedPL: 0 });
});

test("open holding is priced, current value / unrealized P&L / weight computed", async () => {
  const u = addUser("p2", "p2@example.com");
  await transactions(post({ symbol: "OGDC", transaction_type: "BUY", quantity: 10, price: 100, transaction_date: "2026-01-01" }, u.headers));
  const r = JSON.parse((await positions(GET(u.headers))).body);
  assert.strictEqual(r.open.length, 1);
  const p = r.open[0];
  assert.strictEqual(p.price, 150);
  assert.strictEqual(p.currentValue, 1500);
  assert.strictEqual(p.unrealizedPL, 500);
  assert.strictEqual(p.weightPct, 100);
  assert.strictEqual(r.totals.investedAmount, 1000);
});

test("a symbol with no price data shows an error, not a fake number", async () => {
  const u = addUser("p3", "p3@example.com");
  await transactions(post({ symbol: "NOPRICE", transaction_type: "BUY", quantity: 5, price: 10, transaction_date: "2026-01-01" }, u.headers));
  const r = JSON.parse((await positions(GET(u.headers))).body);
  assert.strictEqual(r.open[0].price, null);
  assert.ok(r.open[0].error);
});
