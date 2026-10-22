const test = require("node:test");
const assert = require("node:assert");
const { mapLimit } = require("../netlify/functions/lib/pool");

test("mapLimit keeps result order", async () => {
  const out = await mapLimit([30, 5, 20, 1], 2, async (ms, i) => {
    await new Promise((r) => setTimeout(r, ms));
    return `${i}:${ms}`;
  });
  assert.deepStrictEqual(out, ["0:30", "1:5", "2:20", "3:1"]);
});

test("mapLimit never exceeds the concurrency limit", async () => {
  let running = 0;
  let peak = 0;
  await mapLimit(Array.from({ length: 12 }, (_, i) => i), 3, async () => {
    running++;
    peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, 10));
    running--;
  });
  assert.strictEqual(peak, 3);
});

test("mapLimit handles empty input", async () => {
  assert.deepStrictEqual(await mapLimit([], 4, async (x) => x), []);
});
