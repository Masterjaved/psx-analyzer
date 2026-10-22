const test = require("node:test");
const assert = require("node:assert");
const { computeSnapshot, highLowPosition } = require("../netlify/functions/lib/indicators");
const { makeHistory } = require("./helpers/env");

test("steady uptrend → Uptrend, RSI 100 (no losses), price above SMAs", () => {
  const s = computeSnapshot(makeHistory(120, (i) => 100 + i));
  assert.strictEqual(s.trendEn, "Uptrend");
  assert.strictEqual(s.rsi14, 100); // was 50 before the RSI fix
  assert.ok(s.price > s.sma20 && s.sma20 > s.sma50);
  assert.strictEqual(s.dataPoints, 120);
});

test("steady downtrend → Downtrend, RSI 0, never a Buy / not tradeable", () => {
  // (The scoring gives an oversold RSI a +1 bounce credit, so the position
  // label is "Stable" here, but it must still not be a Buy.)
  const s = computeSnapshot(makeHistory(120, (i) => 300 - i));
  assert.strictEqual(s.trendEn, "Downtrend");
  assert.strictEqual(s.rsi14, 0);
  assert.strictEqual(s.tradeable, false);
  assert.notStrictEqual(s.recommendationEn, "Buy");
});

test("flat prices → Sideways, RSI neutral 50", () => {
  const s = computeSnapshot(makeHistory(120, () => 100));
  assert.strictEqual(s.trendEn, "Sideways");
  assert.strictEqual(s.rsi14, 50);
});

test("RSI always stays within 0..100 on noisy data", () => {
  let x = 100;
  const h = makeHistory(300, (i) => (x = Math.max(1, x + Math.sin(i * 1.7) * 3 + (i % 7) - 3)));
  const s = computeSnapshot(h);
  assert.ok(s.rsi14 >= 0 && s.rsi14 <= 100);
});

test("support/resistance come from the last 20 sessions' low/high", () => {
  const h = makeHistory(60, (i) => 100 + i);
  const s = computeSnapshot(h);
  const last20 = h.slice(-20);
  assert.strictEqual(s.support, Math.round(Math.min(...last20.map((r) => r.low)) * 100) / 100);
  assert.strictEqual(s.resistance, Math.round(Math.max(...last20.map((r) => r.high)) * 100) / 100);
});

test("computeSnapshot throws on empty history", () => {
  assert.throws(() => computeSnapshot([]));
});

test("highLowPosition labels near high / near low / mid-range", () => {
  assert.strictEqual(highLowPosition(makeHistory(100, (i) => 100 + i), 63).labelEn, "Near high");
  assert.strictEqual(highLowPosition(makeHistory(100, (i) => 300 - i), 63).labelEn, "Near low");
  const mid = highLowPosition(makeHistory(100, (i) => (i < 50 ? 100 + i : 150 - (i - 50) * 0.8)), 100);
  assert.strictEqual(mid.labelEn, "Mid-range");
  assert.strictEqual(highLowPosition([], 63), null);
});
