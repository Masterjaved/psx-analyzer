const test = require("node:test");
const assert = require("node:assert");
const { stubFile, fakeStore, fakeSupabase } = require("./helpers/env");

const store = fakeStore();
stubFile("lib/blobStore.js", { portfolioStore: () => store });
const { addUser } = fakeSupabase();
const normal = addUser("u1", "u1@example.com");
const root = addUser("root", "root@example.com", "admin");

const admin = require("../netlify/functions/admin-portfolios").handler;
const debugEnv = require("../netlify/functions/debug-env").handler;

test("admin endpoints: anonymous and normal users get 403, admin gets data", async () => {
  await store.setJSON("u1", { email: "a@example.com", holdings: [{ symbol: "OGDC", qty: 1, buyPrice: 1 }] });
  await store.setJSON("u2", { email: "b@example.com", holdings: [] });

  for (const fn of [admin, debugEnv]) {
    assert.strictEqual((await fn({ httpMethod: "GET", headers: {} })).statusCode, 403);
    assert.strictEqual((await fn({ httpMethod: "GET", headers: normal.headers })).statusCode, 403);
  }
  const ok = await admin({ httpMethod: "GET", headers: root.headers });
  assert.strictEqual(ok.statusCode, 200);
  assert.strictEqual(JSON.parse(ok.body).length, 2);
});

test("debug-env never returns secret values", async () => {
  process.env.ANTHROPIC_API_KEY = "sk-ant-SUPERSECRET";
  process.env.RESEND_API_KEY = "re_SUPERSECRET";
  const r = await debugEnv({ httpMethod: "GET", headers: root.headers });
  assert.strictEqual(r.statusCode, 200);
  assert.ok(!r.body.includes("SUPERSECRET"));
  assert.strictEqual(JSON.parse(r.body).ai.ANTHROPIC_API_KEY.set, true);
});
