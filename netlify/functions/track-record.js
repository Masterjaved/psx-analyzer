/**
 * Looks back at every recommendation analyze.js has logged
 * (lib/blobStore.js -> recommendationStore, one entry per symbol per
 * day) and checks it against today's price (from the market screener,
 * which is one cheap fetch covering every symbol at once) to see how
 * it actually turned out.
 *
 * "Correct" is judged simply:
 *  - Buy      -> correct if price is now higher than when recommended
 *  - Don't buy -> correct if price is now flat or lower
 *  - Hold/wait -> not scored either way, shown for reference only
 *
 * Recommendations from today are skipped — not enough time has passed
 * to judge them yet.
 */
const { initBlobs, recommendationStore } = require("./lib/blobStore");
const { fetchScreener } = require("./lib/psxScreener");

exports.handler = async (event, context) => {
  initBlobs(event);
  const user = context.clientContext && context.clientContext.user;
  if (!user) {
    return { statusCode: 401, body: JSON.stringify({ error: "لاگ ان درکار ہے" }) };
  }

  try {
    const store = recommendationStore();
    const { blobs } = await store.list();

    const today = new Date().toISOString().slice(0, 10);
    const screenerRows = await fetchScreener();
    const priceBySymbol = {};
    for (const r of screenerRows) priceBySymbol[r.symbol] = r.price;

    const entries = [];
    for (const b of blobs) {
      const rec = await store.get(b.key, { type: "json" });
      if (!rec || rec.date === today) continue;

      const currentPrice = priceBySymbol[rec.symbol];
      if (currentPrice == null || currentPrice <= 0) continue;

      const changePct = Math.round(((currentPrice - rec.price) / rec.price) * 1000) / 10;

      let correct = null; // null = not scored (Hold/wait)
      if (rec.recommendation_en === "Buy") correct = changePct > 0;
      else if (rec.recommendation_en === "Don't buy") correct = changePct <= 0;

      entries.push({
        symbol: rec.symbol,
        date: rec.date,
        priceThen: rec.price,
        priceNow: currentPrice,
        changePct,
        recommendation: rec.recommendation,
        recommendation_en: rec.recommendation_en,
        correct,
      });
    }

    entries.sort((a, b) => (a.date < b.date ? 1 : -1));

    const scored = entries.filter((e) => e.correct !== null);
    const winRate = scored.length
      ? Math.round((scored.filter((e) => e.correct).length / scored.length) * 1000) / 10
      : null;

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        asOf: new Date().toISOString(),
        totalScored: scored.length,
        winRate,
        entries: entries.slice(0, 200),
      }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: e.message }),
    };
  }
};
