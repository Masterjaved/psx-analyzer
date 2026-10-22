const test = require("node:test");
const assert = require("node:assert");
const { fakeSupabase, post } = require("./helpers/env");

const { addUser } = fakeSupabase();
const { handler } = require("../netlify/functions/watchlist");

const GET = (headers) => ({ httpMethod: "GET", headers });
const del = (symbol, headers) => ({ httpMethod: "DELETE", queryStringParameters: { symbol }, headers });
const body = (r) => JSON.parse(r.body);

test("no login → 401", async () => {
  assert.strictEqual((await handler(GET({}))).statusCode, 401);
});

test("add, list, and re-adding the same symbol updates instead of duplicating", async () => {
  const u = addUser("w1", "w1@example.com");
  await handler(post({ symbol: "ogdc" }, u.headers));
  await handler(post({ symbol: "OGDC", notes: "watching support" }, u.headers));
  const list = body(await handler(GET(u.headers)));
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].notes, "watching support");
});

test("invalid symbol → 400", async () => {
  const u = addUser("w2", "w2@example.com");
  assert.strictEqual((await handler(post({ symbol: "<bad>" }, u.headers))).statusCode, 400);
});

test("USER ISOLATION and DELETE by symbol", async () => {
  const a = addUser("wa", "wa@example.com");
  const b = addUser("wb", "wb@example.com");
  await handler(post({ symbol: "FFC" }, a.headers));
  await handler(post({ symbol: "HUBC" }, b.headers));
  assert.deepStrictEqual(body(await handler(GET(a.headers))).map((w) => w.symbol), ["FFC"]);

  const missing = await handler(del("HUBC", a.headers));
  assert.strictEqual(missing.statusCode, 404); // a's watchlist has no HUBC — b's row is untouched
  assert.strictEqual(body(await handler(GET(b.headers))).length, 1);

  const ok = await handler(del("FFC", a.headers));
  assert.strictEqual(ok.statusCode, 200);
  assert.strictEqual(body(await handler(GET(a.headers))).length, 0);
});
