const test = require("node:test");
const assert = require("node:assert");
const { stubPackage, stubFile, fakeStore, makeHistory, fakeSupabase } = require("./helpers/env");

const portfolios = fakeStore();
const alertState = fakeStore();
stubPackage("@netlify/blobs", { getStore: () => alertState });
stubPackage("cheerio", {});
stubFile("lib/blobStore.js", { portfolioStore: () => portfolios });
const { addUser } = fakeSupabase();
const alice = addUser("alice", "alice@example.com");
const admin = addUser("root", "root@example.com", "admin");

class PSXDataError extends Error {}
let historyCalls = 0;
stubFile("lib/psxData.js", {
  PSXDataError,
  DATA_SOURCE: "TEST",
  fetchIntraday: async () => [],
  fetchHistory: async (symbol) => {
    historyCalls++;
    if (symbol === "DOWN" || symbol.startsWith("<")) return makeHistory(120, (i) => 300 - i); // downtrend → sell signal
    if (symbol === "BOOM") return makeHistory(120, (i) => 100 + i * 2); // big profit vs buy price
    if (symbol === "SHORT") return makeHistory(5, () => 10);
    return makeHistory(120, () => 100); // sideways, nothing to report
  },
});

const sent = [];
let emailFails = false;
stubFile("lib/email.js", {
  sendEmail: async (to, subject, html) => {
    if (emailFails) throw new Error("Resend failed (status 403)");
    sent.push({ to, subject, html });
  },
});

const { handler } = require("../netlify/functions/daily-alert-check");
const SCHEDULED = { httpMethod: "POST", body: JSON.stringify({ next_run: "2026-09-21T10:30:00Z" }) };
const body = (r) => JSON.parse(r.body);

test.beforeEach(async () => {
  sent.length = 0;
  historyCalls = 0;
  emailFails = false;
  alertState._map.clear();
  portfolios._map.clear();
  await portfolios.setJSON("alice", { email: "alice@example.com", holdings: [{ symbol: "DOWN", qty: 10, buyPrice: 250 }, { symbol: "FLAT", qty: 1, buyPrice: 100 }] });
  await portfolios.setJSON("bob", { email: "bob@example.com", holdings: [{ symbol: "DOWN", qty: 3, buyPrice: 260 }, { symbol: "<img src=x onerror=alert(1)>", qty: 1, buyPrice: 1 }] });
});

test("anonymous / normal-user requests cannot trigger the job (403)", async () => {
  assert.strictEqual((await handler({ httpMethod: "GET", queryStringParameters: {}, headers: {} })).statusCode, 403);
  assert.strictEqual((await handler({ httpMethod: "GET", queryStringParameters: {}, headers: alice.headers })).statusCode, 403);
  assert.strictEqual(sent.length, 0);
});

test("scheduled run: each user only gets an email about their own holdings", async () => {
  const r = body(await handler(SCHEDULED));
  assert.strictEqual(r.emailsSent, 2);
  const toAlice = sent.find((m) => m.to === "alice@example.com");
  const toBob = sent.find((m) => m.to === "bob@example.com");
  assert.ok(toAlice.html.includes("DOWN"));
  assert.ok(!toAlice.html.includes("FLAT"));
  assert.ok(!toAlice.html.includes("onerror")); // bob's data never reaches alice
  assert.ok(!toBob.html.includes("<img"), "symbols are HTML-escaped in emails");
  assert.ok(toBob.html.includes("&lt;img"), "the odd symbol did trigger an alert, and was escaped");
});

test("the same symbol is fetched once per run even if many users own it", async () => {
  await handler(SCHEDULED);
  // DOWN (2 owners), FLAT, and bob's odd symbol → DOWN must not be fetched twice
  assert.ok(historyCalls <= 3, `history calls: ${historyCalls}`);
});

test("no repeat email the next day for the same, unchanged condition", async () => {
  await handler(SCHEDULED);
  sent.length = 0;
  const again = body(await handler(SCHEDULED));
  assert.strictEqual(again.emailsSent, 0);
});

test("a FAILED email is not marked as sent — it is retried on the next run", async () => {
  emailFails = true;
  const first = body(await handler(SCHEDULED));
  assert.strictEqual(first.emailsSent, 0);
  assert.ok(first.errors.some((e) => e.includes("alice@example.com")));
  emailFails = false;
  const second = body(await handler(SCHEDULED));
  assert.strictEqual(second.emailsSent, 2);
});

test("admin dry run reports what would be sent, sends nothing, changes no state", async () => {
  const r = body(await handler({ httpMethod: "GET", queryStringParameters: { dryRun: "1" }, headers: admin.headers }));
  assert.strictEqual(r.dryRun, true);
  assert.strictEqual(r.wouldSend.length, 2);
  assert.strictEqual(sent.length, 0);
  assert.strictEqual(alertState._map.size, 0);
});

test("one broken symbol or short history doesn't stop the run", async () => {
  await portfolios.setJSON("carol", { email: "carol@example.com", holdings: [{ symbol: "SHORT", qty: 1, buyPrice: 10 }, { symbol: "BOOM", qty: 1, buyPrice: 100 }] });
  const r = body(await handler(SCHEDULED));
  assert.ok(sent.some((m) => m.to === "carol@example.com" && m.html.includes("BOOM")));
  assert.ok(r.errors.some((e) => e.startsWith("SHORT")));
});
