const test = require("node:test");
const assert = require("node:assert");
const { stubPackage, stubFile, fakeSupabase, post } = require("./helpers/env");

stubPackage("cheerio", {});
const { addUser } = fakeSupabase();
stubFile("lib/psxData.js", { PSXDataError: class extends Error {}, DATA_SOURCE: "TEST", fetchHistory: async () => [{ date: "D1", close: 100 }] });

const transactions = require("../netlify/functions/transactions").handler;
const { handler: adminUsers } = require("../netlify/functions/admin-users");
const GET = (headers) => ({ httpMethod: "GET", headers });
const body = (r) => JSON.parse(r.body);

test("normal user gets 403", async () => {
  const u = addUser("nu", "nu@example.com");
  assert.strictEqual((await adminUsers(GET(u.headers))).statusCode, 403);
});

test("admin sees every user's profile and computed positions, using only their own token", async () => {
  const admin = addUser("root2", "root2@example.com", "admin");
  const alice = addUser("alice9", "alice9@example.com");
  await transactions(post({ symbol: "OGDC", transaction_type: "BUY", quantity: 10, price: 100, transaction_date: "2026-01-01" }, alice.headers));

  const r = body(await adminUsers(GET(admin.headers)));
  const emails = r.map((u) => u.email).sort();
  assert.ok(emails.includes("alice9@example.com"));
  assert.ok(emails.includes("root2@example.com"));

  const aliceRow = r.find((u) => u.email === "alice9@example.com");
  assert.strictEqual(aliceRow.openPositions.length, 1);
  assert.strictEqual(aliceRow.openPositions[0].symbol, "OGDC");
});
