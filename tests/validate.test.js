const test = require("node:test");
const assert = require("node:assert");
const { normalizeSymbol, validateHoldings, MAX_HOLDINGS } = require("../netlify/functions/lib/validate");

const id = () => "gen-id";

test("normalizeSymbol accepts real PSX-style codes and uppercases them", () => {
  for (const s of ["OGDC", "ffc", " hubc ", "BIPL", "CNERGY", "MLCF", "PPL", "OGDC-DEC"]) {
    assert.ok(normalizeSymbol(s), s);
  }
  assert.strictEqual(normalizeSymbol(" ogdc "), "OGDC");
});

test("normalizeSymbol rejects markup, spaces, empties and non-strings", () => {
  for (const s of ["<script>", "OG DC", "", "   ", "A".repeat(16), "-OGDC", "OGDC;DROP", 123, null, {}]) {
    assert.strictEqual(normalizeSymbol(s), null, String(s));
  }
});

test("validateHoldings cleans a valid list and assigns ids", () => {
  const r = validateHoldings([{ symbol: "ogdc", qty: 100, buyPrice: 200, evil: "<b>", currentPrice: 999 }], id);
  assert.ok(r.ok);
  assert.deepStrictEqual(r.holdings, [{ id: "gen-id", symbol: "OGDC", qty: 100, buyPrice: 200 }]);
});

test("validateHoldings keeps an existing id and optional fields", () => {
  const r = validateHoldings(
    [{ id: "abc", symbol: "FFC", qty: 5, buyPrice: 10.5, buyDate: "2026-01-31", strategy: "SWING", notes: "x" }],
    id
  );
  assert.ok(r.ok);
  assert.strictEqual(r.holdings[0].id, "abc");
  assert.strictEqual(r.holdings[0].strategy, "SWING");
});

test("validateHoldings rejects bad numbers, dates, strategies", () => {
  const bad = [
    { symbol: "OGDC", qty: 0, buyPrice: 1 },
    { symbol: "OGDC", qty: -5, buyPrice: 1 },
    { symbol: "OGDC", qty: "5", buyPrice: 1 },
    { symbol: "OGDC", qty: 5, buyPrice: NaN },
    { symbol: "OGDC", qty: Infinity, buyPrice: 1 },
    { symbol: "OGDC", qty: 1, buyPrice: 1, buyDate: "31/01/2026" },
    { symbol: "OGDC", qty: 1, buyPrice: 1, strategy: "YOLO" },
    { symbol: "OGDC", qty: 1, buyPrice: 1, notes: "x".repeat(501) },
    { symbol: "<img src=x onerror=alert(1)>", qty: 1, buyPrice: 1 },
  ];
  for (const h of bad) assert.strictEqual(validateHoldings([h], id).ok, false, JSON.stringify(h));
});

test("validateHoldings rejects non-arrays and oversize lists", () => {
  assert.strictEqual(validateHoldings("nope", id).ok, false);
  assert.strictEqual(validateHoldings({}, id).ok, false);
  const many = Array.from({ length: MAX_HOLDINGS + 1 }, () => ({ symbol: "OGDC", qty: 1, buyPrice: 1 }));
  assert.strictEqual(validateHoldings(many, id).ok, false);
});

// ---- Phase 2: transaction + watchlist validation ----
const { validateTransaction, validateWatchlistEntry } = require("../netlify/functions/lib/validate");

test("validateTransaction accepts a valid BUY and cleans/normalizes it", () => {
  const r = validateTransaction({ symbol: "ogdc", transaction_type: "BUY", quantity: 100, price: 200, transaction_date: "2026-01-15" });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.row.symbol, "OGDC");
  assert.strictEqual(r.row.price, 200);
});

test("validateTransaction rejects bad symbol, type, quantity, date", () => {
  const base = { symbol: "OGDC", transaction_type: "BUY", quantity: 10, price: 10, transaction_date: "2026-01-15" };
  assert.strictEqual(validateTransaction({ ...base, symbol: "<x>" }).ok, false);
  assert.strictEqual(validateTransaction({ ...base, transaction_type: "STEAL" }).ok, false);
  assert.strictEqual(validateTransaction({ ...base, quantity: -5 }).ok, false);
  assert.strictEqual(validateTransaction({ ...base, quantity: "10" }).ok, false);
  assert.strictEqual(validateTransaction({ ...base, transaction_date: "15-01-2026" }).ok, false);
  assert.strictEqual(validateTransaction({ ...base, transaction_date: "2026-01-15T00:00:00Z" }).ok, false);
});

test("validateTransaction: BUY/SELL need a non-zero price, BONUS/SPLIT don't, DIVIDEND allows 0", () => {
  const base = { symbol: "OGDC", quantity: 10, transaction_date: "2026-01-15" };
  assert.strictEqual(validateTransaction({ ...base, transaction_type: "BUY", price: 0 }).ok, false);
  assert.strictEqual(validateTransaction({ ...base, transaction_type: "BONUS", price: 0 }).ok, true);
  assert.strictEqual(validateTransaction({ ...base, transaction_type: "SPLIT" }).ok, true);
  assert.strictEqual(validateTransaction({ ...base, transaction_type: "DIVIDEND", price: 0 }).ok, true);
});

test("validateTransaction keeps optional strategy/notes/portfolio_id when valid, rejects when not", () => {
  const base = { symbol: "OGDC", transaction_type: "BUY", quantity: 10, price: 10, transaction_date: "2026-01-15" };
  assert.strictEqual(validateTransaction({ ...base, strategy: "HOLD" }).row.strategy, "HOLD");
  assert.strictEqual(validateTransaction({ ...base, strategy: "NOT_A_STRATEGY" }).ok, false);
  assert.strictEqual(validateTransaction({ ...base, notes: "x".repeat(501) }).ok, false);
});

test("validateWatchlistEntry cleans a valid entry and rejects a bad symbol", () => {
  const r = validateWatchlistEntry({ symbol: "hubc", notes: "watching" });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.row.symbol, "HUBC");
  assert.strictEqual(validateWatchlistEntry({ symbol: "<bad>" }).ok, false);
  assert.strictEqual(validateWatchlistEntry({ symbol: "OGDC", notes: "x".repeat(501) }).ok, false);
});
