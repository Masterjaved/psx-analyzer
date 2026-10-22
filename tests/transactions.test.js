const test = require("node:test");
const assert = require("node:assert");
const { stubPackage, stubFile, fakeSupabase, post } = require("./helpers/env");

stubPackage("cheerio", {});
const { addUser } = fakeSupabase();
const { handler } = require("../netlify/functions/transactions");

const GET = (headers) => ({ httpMethod: "GET", headers: headers || {} });
const del = (id, headers) => ({ httpMethod: "DELETE", queryStringParameters: { id }, headers });
const body = (r) => JSON.parse(r.body);
const tx = (over = {}) => ({ symbol: "OGDC", transaction_type: "BUY", quantity: 10, price: 100, transaction_date: "2026-01-15", ...over });

test("no login → 401 on every method", async () => {
  assert.strictEqual((await handler(GET())).statusCode, 401);
  assert.strictEqual((await handler(post(tx()))).statusCode, 401);
  assert.strictEqual((await handler(del("x"))).statusCode, 401);
});

test("a fresh user automatically gets a Main portfolio, empty transaction list", async () => {
  const u = addUser("u1", "u1@example.com");
  const r = body(await handler(GET(u.headers)));
  assert.strictEqual(r.portfolio.name, "Main");
  assert.deepStrictEqual(r.transactions, []);
});

test("POST validates, then inserts, and GET reflects it", async () => {
  const u = addUser("u2", "u2@example.com");
  const bad = await handler(post({ symbol: "<x>", transaction_type: "BUY", quantity: 1, price: 1, transaction_date: "2026-01-01" }, u.headers));
  assert.strictEqual(bad.statusCode, 400);

  const good = await handler(post(tx(), u.headers));
  assert.strictEqual(good.statusCode, 200);
  assert.strictEqual(body(good).symbol, "OGDC");

  const list = body(await handler(GET(u.headers)));
  assert.strictEqual(list.transactions.length, 1);
});

test("USER ISOLATION: user B's transactions never appear for user A", async () => {
  const a = addUser("alice2", "alice2@example.com");
  const b = addUser("bob2", "bob2@example.com");
  await handler(post(tx({ symbol: "FFC" }), a.headers));
  await handler(post(tx({ symbol: "HUBC" }), b.headers));
  const aList = body(await handler(GET(a.headers))).transactions.map((t) => t.symbol);
  const bList = body(await handler(GET(b.headers))).transactions.map((t) => t.symbol);
  assert.deepStrictEqual(aList, ["FFC"]);
  assert.deepStrictEqual(bList, ["HUBC"]);
});

test("DELETE removes only the caller's own row; a stranger's id is not found", async () => {
  const a = addUser("alice3", "alice3@example.com");
  const b = addUser("bob3", "bob3@example.com");
  const inserted = body(await handler(post(tx(), a.headers)));

  const strangerAttempt = await handler(del(inserted.id, b.headers));
  assert.strictEqual(strangerAttempt.statusCode, 404);
  assert.strictEqual(body(await handler(GET(a.headers))).transactions.length, 1);

  const ownAttempt = await handler(del(inserted.id, a.headers));
  assert.strictEqual(ownAttempt.statusCode, 200);
  assert.strictEqual(body(await handler(GET(a.headers))).transactions.length, 0);
});

test("huge request body → 413, invalid JSON → 400", async () => {
  const u = addUser("u3", "u3@example.com");
  const huge = await handler(post({ ...tx(), notes: "x".repeat(200 * 1024) }, u.headers));
  assert.strictEqual(huge.statusCode, 413);
  const badJson = await handler(post("{not json", u.headers));
  assert.strictEqual(badJson.statusCode, 400);
});
