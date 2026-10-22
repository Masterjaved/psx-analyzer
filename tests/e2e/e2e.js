/**
 * Browser (end-to-end) test — OPTIONAL developer tool, not part of `npm test`.
 * Needs Playwright + Chromium: npm i -D playwright && npx playwright install chromium
 * Run: node tests/e2e/e2e.js
 *
 * Loads the real pages in a real browser against the real function
 * handlers (see server.js for what is faked). There is no internet access
 * in this build environment, so two more things are faked purely for this
 * test: the Chart.js and @supabase/supabase-js CDN scripts (stand-ins —
 * see supabase-shim.js) and, by extension, all real network calls the
 * browser would make to Supabase — those are intercepted and answered by
 * the SAME in-memory backend the Netlify Functions use (server.js),
 * so browser and server sides always agree on the data. This means the
 * real Supabase Auth server, the real supabase-js library, and the real
 * Supabase database have NOT been exercised by this test — only our own
 * code has. A token-expiry/refresh scenario and the invite/recovery email
 * link flow are also not covered here for the same reason (they depend on
 * behaviour of the real services).
 */
const fs = require("fs");
const path = require("path");
const assert = require("node:assert");
const { chromium } = require("playwright");
const { start, backend } = require("./server");

const SUPABASE_URL = "https://qlexjyoyujsecjdagovq.supabase.co";
const SUPABASE_JS_CDN = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
const SHIM = fs.readFileSync(path.join(__dirname, "supabase-shim.js"), "utf8");

const results = [];
async function step(name, fn) {
  try {
    await fn();
    results.push(["PASS", name]);
    console.log("PASS", name);
  } catch (e) {
    results.push(["FAIL", name, e.message]);
    console.log("FAIL", name, "\n     ", e.message.split("\n")[0]);
  }
}

(async () => {
  const server = await start(0);
  const BASE = `http://localhost:${server.address().port}`;
  const browser = await chromium.launch();
  const pageErrors = [];
  const consoleLines = [];

  async function newCtx(opts = {}) {
    const ctx = await browser.newContext(opts);
    await ctx.route("https://cdnjs.cloudflare.com/**", (r) =>
      r.fulfill({ contentType: "text/javascript", body: "window.Chart = class { constructor(){} destroy(){} };" })
    );
    await ctx.route(SUPABASE_JS_CDN, (r) => r.fulfill({ contentType: "text/javascript", body: SHIM }));
    await ctx.route(`${SUPABASE_URL}/**`, async (route) => {
      const req = route.request();
      const u = new URL(req.url());
      const r = backend.respond(req.method(), u.pathname, u.searchParams, req.headers(), req.postData());
      await route.fulfill({ status: r.status, contentType: "application/json", body: JSON.stringify(r.json) });
    });
    ctx.on("page", (p) => {
      p.on("pageerror", (e) => pageErrors.push(e.message));
      p.on("console", (m) => consoleLines.push(m.text()));
      p.on("dialog", (d) => d.accept());
    });
    return ctx;
  }

  async function login(page, email, url) {
    await page.goto(BASE + url);
    await page.waitForSelector("#auth-email");
    await page.fill("#auth-email", email);
    await page.fill("#auth-password", "pw");
    await page.click("#auth-gate-form button[type=submit]");
    await page.waitForSelector("#auth-gate", { state: "detached" });
  }

  const posRows = (page) => page.$$eval("#posBody tr", (trs) => trs.map((t) => t.innerText.replace(/\s+/g, " ").trim()));
  const txRows = (page) => page.$$eval("#txBody tr", (trs) => trs.map((t) => t.innerText.replace(/\s+/g, " ").trim()));
  const waitPriced = (page, sym) =>
    page.waitForFunction((s) => [...document.querySelectorAll("#posBody tr")].some((t) => t.innerText.includes(s) && !t.innerText.includes("دستیاب نہیں")), sym);

  async function addTx(page, { symbol, type = "BUY", qty, price, date = "2026-01-15" }) {
    await page.fill("#txSymbol", symbol);
    await page.selectOption("#txType", type);
    await page.fill("#txQty", String(qty));
    await page.fill("#txPrice", price != null ? String(price) : "");
    await page.fill("#txDate", date);
    await page.click('#txForm button[type=submit]');
  }

  const desktopCtx = await newCtx();
  const A = await desktopCtx.newPage();

  await step("login gate shows, wrong password is refused with a message", async () => {
    await A.goto(BASE + "/portfolio.html");
    await A.waitForSelector("#auth-email");
    await A.fill("#auth-email", "alice@example.com");
    await A.fill("#auth-password", "wrong");
    await A.click("#auth-gate-form button[type=submit]");
    await A.waitForFunction(() => document.querySelector("#auth-gate-msg").textContent.length > 0);
    assert.ok(await A.$("#auth-gate"));
  });

  await step("portfolio: login, BUY 100 OGDC @ 200 → priced position + unrealized P/L", async () => {
    await login(A, "alice@example.com", "/portfolio.html");
    await addTx(A, { symbol: "ogdc", qty: 100, price: 200 });
    await waitPriced(A, "OGDC");
    const r = (await posRows(A))[0];
    assert.match(r, /OGDC/);
    assert.match(r, /1,900/); // unrealized P/L
    assert.match(await A.textContent("#summaryGrid"), /1,900/);
  });

  await step("portfolio: server-side validation errors show in #txErr, nothing bad is saved", async () => {
    await addTx(A, { symbol: "<img src=x onerror=window.__xssTx=1>", qty: 1, price: 1 });
    await A.waitForFunction(() => document.querySelector("#txErr").style.display !== "none");
    await addTx(A, { symbol: "HBL", qty: -4, price: 1 });
    await A.waitForFunction(() => document.querySelector("#txErr").textContent.length > 0);
    assert.strictEqual((await txRows(A)).length, 1); // only the OGDC buy from the previous step
  });

  const phoneCtx = await newCtx({ viewport: { width: 390, height: 800 }, isMobile: true });
  const B = await phoneCtx.newPage();

  await step("CLOUD SYNC: same account on a phone shows the position added on the computer", async () => {
    await login(B, "alice@example.com", "/portfolio.html");
    await waitPriced(B, "OGDC");
    assert.match((await posRows(B))[0], /OGDC/);
    await B.screenshot({ path: "/tmp/portfolio-mobile.png" });
    const overflow = await B.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    assert.strictEqual(overflow, false);
  });

  await step("USER ISOLATION: another user sees an empty portfolio and watchlist", async () => {
    const ctx = await newCtx();
    const P = await ctx.newPage();
    await login(P, "bob@example.com", "/portfolio.html");
    await P.waitForFunction(() => document.querySelector("#posEmpty").style.display !== "none");
    assert.strictEqual((await posRows(P)).length, 0);
    await ctx.close();
  });

  await step("SELL: partial sell lowers quantity and records realized P/L, full history kept", async () => {
    await addTx(A, { symbol: "OGDC", type: "SELL", qty: 40, price: 230, date: "2026-02-01" });
    await A.waitForFunction(() => document.querySelectorAll("#txBody tr").length === 2);
    const posText = (await posRows(A))[0];
    assert.match(posText, /^OGDC 60/); // 100 - 40 sold = 60 remaining
    assert.match(await A.textContent("#summaryGrid"), /1,200/); // realized P/L: (230-200)*40
  });

  await step("watchlist: add, list, and remove", async () => {
    await A.fill("#wlSymbol", "ffc");
    await A.click('#wlForm button[type=submit]');
    await A.waitForFunction(() => document.querySelector("#wlBody").textContent.includes("FFC"));
    await A.click('#wlBody tr:has-text("FFC") .remove-btn');
    await A.waitForFunction(() => document.querySelector("#wlEmpty").style.display !== "none");
  });

  await step("delete a transaction removes only that row and recalculates the position", async () => {
    await A.reload();
    await A.waitForSelector("#txBody tr");
    await A.click('#txBody tr:has-text("SELL") .remove-btn');
    await A.waitForFunction(() => document.querySelectorAll("#txBody tr").length === 1);
    await waitPriced(A, "OGDC");
    assert.match((await posRows(A))[0], /^OGDC 100/); // SELL undone → back to the full 100
  });

  await step("analyzer page: table, per-symbol errors, source line, insufficient-input handling", async () => {
    await A.goto(BASE + "/index.html");
    await A.waitForSelector("#symbolInput");
    for (const s of ["OGDC", "FFC", "XSSAI", "LOWCO", "NOPE"]) {
      await A.fill("#symbolInput", s);
      await A.click("#addBtn");
    }
    await A.fill("#symbolInput", "<img src=x onerror=window.__xssChip2=1>");
    await A.click("#addBtn");
    assert.strictEqual(await A.$$eval("#chips .chip", (c) => c.length), 5);
    assert.match(await A.textContent("#symbolHint"), /انگریزی/);

    await A.click("#analyzeBtn");
    await A.waitForSelector("#tblBody tr");
    await A.waitForFunction(() => document.querySelectorAll("#tblBody tr").length >= 5);
    const text = await A.textContent("#tblBody");
    assert.match(text, /کوئی ڈیٹا نہیں ملا/); // NOPE
    assert.match(text, /D120/);
    assert.match(text, /PSX Data Portal \(test\)/);
  });

  await step("XSS: AI text, provider name and news titles/links are shown as text, never executed", async () => {
    const flags = await A.evaluate(() => ({
      ai: window.__xssAI, news: window.__xssNews, link: window.__xssLink,
      chip2: window.__xssChip2, tx: window.__xssTx,
    }));
    assert.deepStrictEqual(flags, { ai: undefined, news: undefined, link: undefined, chip2: undefined, tx: undefined });
    const text = await A.textContent("#tblBody");
    assert.ok(text.includes("<img src=x onerror=window.__xssAI=1>"), "AI markup should be visible as literal text");
    assert.strictEqual(await A.$$eval("#tblBody img", (i) => i.length), 0);
    const anchors = await A.$$eval("#tblBody a", (as) => as.map((a) => ({ href: a.href, rel: a.rel })));
    assert.deepStrictEqual(anchors, [{ href: "https://news.example/a", rel: "noopener noreferrer" }]);
    assert.ok(text.includes("Dawn"));
  });

  await step("ADMIN: a stored-XSS payload in another user's data is inert; normal users are blocked", async () => {
    const mallory = backend.addUser("mallory", "<img src=x onerror=window.__xssAdminEmail=1>@evil.test");
    backend.tables.portfolio_transactions.push({
      id: "mal-tx-1", user_id: "mallory", portfolio_id: mallory.portfolioId,
      symbol: "<img src=x onerror=window.__xssAdmin=1>", transaction_type: "BUY",
      quantity: 1, price: 1, transaction_date: "2026-01-01", created_at: new Date().toISOString(),
    });

    const ctxU = await newCtx();
    const U = await ctxU.newPage();
    await login(U, "bob@example.com", "/admin.html");
    await U.waitForSelector(".denied");
    assert.match(await U.textContent(".denied"), /صرف ایڈمن/);
    assert.strictEqual(await U.$eval("#toolsCard", (e) => e.style.display), "none");
    await ctxU.close();

    backend.addUser("root", "admin@example.com", "admin");
    const ctxA = await newCtx();
    const M = await ctxA.newPage();
    await login(M, "admin@example.com", "/admin.html");
    await M.waitForSelector("#content .card");
    assert.strictEqual(await M.evaluate(() => window.__xssAdmin), undefined);
    assert.strictEqual(await M.evaluate(() => window.__xssAdminEmail), undefined);
    assert.strictEqual(await M.$$eval("#content img", (i) => i.length), 0);
    const content = await M.textContent("#content");
    assert.ok(content.includes("<img src=x onerror=window.__xssAdmin=1>"));
    assert.ok(content.includes("alice@example.com"));

    await M.click("#btnDry");
    await M.waitForFunction(() => document.querySelector("#toolOut").textContent.includes("dryRun"));
    assert.match(await M.textContent("#toolOut"), /"dryRun": true/);
    await M.click("#btnEnv");
    await M.waitForFunction(() => document.querySelector("#toolOut").textContent.includes("RESEND_API_KEY"));
    await ctxA.close();
  });

  await step("daily-alert URL is no longer open to the public", async () => {
    const r = await fetch(BASE + "/.netlify/functions/daily-alert-check");
    assert.strictEqual(r.status, 403);
    const emails = await (await fetch(BASE + "/__emails")).json();
    assert.strictEqual(emails.length, 0);
  });

  await step("logout returns to the login gate and clears the stored session", async () => {
    await A.goto(BASE + "/index.html");
    await A.waitForSelector("#logout-btn");
    await A.click("#logout-btn");
    await A.waitForSelector("#auth-email");
    const stored = await A.evaluate(() => JSON.stringify(localStorage));
    assert.ok(!stored.includes("access_token"));
  });

  await step("no tokens are written to the browser console; no uncaught page errors", async () => {
    assert.ok(!consoleLines.some((l) => /access_token|refresh_token|Bearer /.test(l)), consoleLines.join("\n"));
    assert.deepStrictEqual(pageErrors, []);
  });

  await browser.close();
  server.close();
  const failed = results.filter((r) => r[0] === "FAIL");
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})();
