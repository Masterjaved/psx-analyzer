const test = require("node:test");
const assert = require("node:assert");
const { computePositions, splitOpenClosed } = require("../netlify/functions/lib/positions");

const tx = (overrides) => ({
  symbol: "OGDC", transaction_type: "BUY", quantity: 0, price: 0, transaction_date: "2026-01-01", ...overrides,
});

test("BUY then partial SELL: average cost, realized P/L, remaining qty", () => {
  const rows = [
    tx({ transaction_type: "BUY", quantity: 100, price: 200, transaction_date: "2026-01-01" }),
    tx({ transaction_type: "SELL", quantity: 40, price: 230, transaction_date: "2026-02-01" }),
  ];
  const [p] = computePositions(rows);
  assert.strictEqual(p.qty, 60);
  assert.strictEqual(p.avgCost, 200);
  assert.strictEqual(p.investedAmount, 12000);
  assert.strictEqual(p.realizedPL, 1200); // (230-200)*40
});

test("multiple BUYs at different prices average correctly", () => {
  const rows = [
    tx({ transaction_type: "BUY", quantity: 100, price: 100, transaction_date: "2026-01-01" }),
    tx({ transaction_type: "BUY", quantity: 100, price: 200, transaction_date: "2026-01-05" }),
  ];
  const [p] = computePositions(rows);
  assert.strictEqual(p.qty, 200);
  assert.strictEqual(p.avgCost, 150);
  assert.strictEqual(p.investedAmount, 30000);
});

test("BONUS shares lower the average cost without adding invested amount", () => {
  const rows = [
    tx({ transaction_type: "BUY", quantity: 100, price: 100, transaction_date: "2026-01-01" }),
    tx({ transaction_type: "BONUS", quantity: 10, price: 0, transaction_date: "2026-02-01" }),
  ];
  const [p] = computePositions(rows);
  assert.strictEqual(p.qty, 110);
  assert.strictEqual(p.investedAmount, 10000);
  assert.ok(Math.abs(p.avgCost - 90.9091) < 0.001);
});

test("DIVIDEND doesn't change qty or invested amount, tracked separately", () => {
  const rows = [
    tx({ transaction_type: "BUY", quantity: 100, price: 100, transaction_date: "2026-01-01" }),
    tx({ transaction_type: "DIVIDEND", quantity: 100, price: 5, transaction_date: "2026-03-01" }),
  ];
  const [p] = computePositions(rows);
  assert.strictEqual(p.qty, 100);
  assert.strictEqual(p.investedAmount, 10000);
  assert.strictEqual(p.totalDividends, 500);
});

test("selling more than held is clamped and flagged, never goes negative", () => {
  const rows = [
    tx({ transaction_type: "BUY", quantity: 10, price: 100, transaction_date: "2026-01-01" }),
    tx({ transaction_type: "SELL", quantity: 50, price: 120, transaction_date: "2026-01-02" }),
  ];
  const [p] = computePositions(rows);
  assert.strictEqual(p.qty, 0);
  assert.strictEqual(p.oversold, true);
});

test("fully-exited position moves to closed with its realized P/L, not open", () => {
  const rows = [
    tx({ transaction_type: "BUY", quantity: 50, price: 100, transaction_date: "2026-01-01" }),
    tx({ transaction_type: "SELL", quantity: 50, price: 150, transaction_date: "2026-02-01" }),
  ];
  const { open, closed } = splitOpenClosed(computePositions(rows));
  assert.strictEqual(open.length, 0);
  assert.strictEqual(closed.length, 1);
  assert.strictEqual(closed[0].realizedPL, 2500);
});

test("transactions are processed oldest-first regardless of input order", () => {
  const rows = [
    tx({ transaction_type: "SELL", quantity: 10, price: 150, transaction_date: "2026-02-01" }),
    tx({ transaction_type: "BUY", quantity: 20, price: 100, transaction_date: "2026-01-01" }),
  ];
  const [p] = computePositions(rows);
  assert.strictEqual(p.qty, 10);
  assert.strictEqual(p.realizedPL, 500); // (150-100)*10
});

test("multiple symbols are tracked independently", () => {
  const rows = [
    tx({ symbol: "OGDC", transaction_type: "BUY", quantity: 10, price: 100, transaction_date: "2026-01-01" }),
    tx({ symbol: "FFC", transaction_type: "BUY", quantity: 5, price: 400, transaction_date: "2026-01-02" }),
  ];
  const positions = computePositions(rows);
  assert.strictEqual(positions.length, 2);
  assert.deepStrictEqual(positions.map((p) => p.symbol).sort(), ["FFC", "OGDC"]);
});
