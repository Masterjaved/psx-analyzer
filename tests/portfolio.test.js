const test = require("node:test");
const assert = require("node:assert");
const { stubFile, fakeStore, post, fakeSupabase } = require("./helpers/env");

const store = fakeStore();
stubFile("lib/blobStore.js", { portfolioStore: () => store });
const { addUser } = fakeSupabase();
const { handler } = require("../netlify/functions/portfolio");

const GET = (headers) => ({ httpMethod: "GET", headers: headers || {} });
const body = (r) => JSON.parse(r.body);
const h = (symbol = "OGDC", qty = 100, buyPrice = 200) => ({ symbol, qty, buyPrice });

test("no login → 401", async () => {
  assert.strictEqual((await handler(GET())).statusCode, 401);
  assert.strictEqual((await handler(post({ holdings: [] }))).statusCode, 401);
});

test("new user gets an empty portfolio", async () => {
  const u = addUser("new-user", "new-user@example.com");
  const r = await handler(GET(u.headers));
  assert.strictEqual(r.statusCode, 200);
  assert.deepStrictEqual(body(r).holdings, []);
});

test("save then load returns the same data (what another device would see)", async () => {
  const u1 = addUser("u1", "u1@example.com");
  const save = await handler(post({ holdings: [h("ogdc", 100, 200)], baseUpdatedAt: null }, u1.headers));
  assert.strictEqual(save.statusCode, 200);
  const saved = body(save);
  assert.strictEqual(saved.holdings[0].symbol, "OGDC");
  assert.ok(saved.holdings[0].id);

  const load = body(await handler(GET(u1.headers)));
  assert.deepStrictEqual(load.holdings, saved.holdings);
  assert.strictEqual(load.updatedAt, saved.updatedAt);
});

test("USER ISOLATION: user B never sees user A's holdings", async () => {
  const alice = addUser("alice", "alice@example.com");
  const bob = addUser("bob", "bob@example.com");
  const mallory = addUser("mallory", "mallory@example.com");

  await handler(post({ holdings: [h("FFC", 5, 400)] }, alice.headers));
  await handler(post({ holdings: [h("HUBC", 7, 90)] }, bob.headers));
  const a = body(await handler(GET(alice.headers)));
  const b = body(await handler(GET(bob.headers)));
  assert.deepStrictEqual(a.holdings.map((x) => x.symbol), ["FFC"]);
  assert.deepStrictEqual(b.holdings.map((x) => x.symbol), ["HUBC"]);
  // a client-supplied userId/email in the body must not redirect the write
  await handler(post({ holdings: [h("PPL")], userId: "alice", email: "alice@example.com" }, mallory.headers));
  assert.deepStrictEqual(body(await handler(GET(alice.headers))).holdings.map((x) => x.symbol), ["FFC"]);
});

test("stored-XSS attempt via symbol is rejected and nothing is saved", async () => {
  const attacker = addUser("attacker", "attacker@example.com");
  const r = await handler(post({ holdings: [{ symbol: "<img src=x onerror=alert(1)>", qty: 1, buyPrice: 1 }] }, attacker.headers));
  assert.strictEqual(r.statusCode, 400);
  assert.deepStrictEqual(body(await handler(GET(attacker.headers))).holdings, []);
});

test("invalid numbers and oversize lists → 400", async () => {
  const v = addUser("v", "v@example.com");
  for (const bad of [h("OGDC", -1, 10), h("OGDC", 1, 0), { symbol: "OGDC", qty: "5", buyPrice: 1 }]) {
    assert.strictEqual((await handler(post({ holdings: [bad] }, v.headers))).statusCode, 400);
  }
  const many = Array.from({ length: 201 }, () => h());
  assert.strictEqual((await handler(post({ holdings: many }, v.headers))).statusCode, 400);
  assert.strictEqual((await handler(post("{not json", v.headers))).statusCode, 400);
});

test("huge request body → 413", async () => {
  const v2 = addUser("v2", "v2@example.com");
  const r = await handler(post({ holdings: [], pad: "x".repeat(200 * 1024) }, v2.headers));
  assert.strictEqual(r.statusCode, 413);
});

test("two devices: a stale save is refused with 409 and current data", async () => {
  const dual = addUser("dual", "dual@example.com");
  const first = body(await handler(post({ holdings: [h("OGDC")], baseUpdatedAt: null }, dual.headers)));
  // phone saves on top of the version it loaded…
  await new Promise((r) => setTimeout(r, 5));
  const phone = await handler(post({ holdings: [...first.holdings, h("PPL")], baseUpdatedAt: first.updatedAt }, dual.headers));
  assert.strictEqual(phone.statusCode, 200);
  // …computer still holds the old version
  const computer = await handler(post({ holdings: [h("MLCF")], baseUpdatedAt: first.updatedAt }, dual.headers));
  assert.strictEqual(computer.statusCode, 409);
  assert.deepStrictEqual(body(computer).current.holdings.map((x) => x.symbol), ["OGDC", "PPL"]);
  // nothing was overwritten
  assert.deepStrictEqual(body(await handler(GET(dual.headers))).holdings.map((x) => x.symbol), ["OGDC", "PPL"]);
});

test("legacy holdings (saved before ids existed) get ids on load", async () => {
  const legacy = addUser("legacy", "l@example.com");
  await store.setJSON(legacy.id, { email: "l@example.com", holdings: [{ symbol: "HBL", qty: 10, buyPrice: 100 }], updatedAt: "2026-09-01T00:00:00.000Z" });
  const r = body(await handler(GET(legacy.headers)));
  assert.ok(r.holdings[0].id);
});
