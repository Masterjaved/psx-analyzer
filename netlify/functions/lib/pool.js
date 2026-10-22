/**
 * Runs `fn` over `items` with at most `limit` running at the same time.
 * Results keep the same order as `items`. `fn` must not throw (wrap it
 * yourself) — if it does, the whole call rejects.
 */
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker);
  await Promise.all(workers);
  return results;
}

module.exports = { mapLimit };
