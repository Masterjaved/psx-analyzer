const { fetchHistory, PSXDataError } = require("./lib/psxData");
const { computeSnapshot, highLowPosition } = require("./lib/indicators");
const { analyzeWithFallback, ProviderError } = require("./lib/aiProviders");
const { fetchNews } = require("./lib/newsFetch");
const { initBlobs, recommendationStore } = require("./lib/blobStore");

// Logs today's recommendation for a symbol so track-record.js can later
// check whether it turned out right — one entry per symbol per day
// (re-analyzing the same symbol later the same day does not duplicate it).
async function logRecommendation(symbol, snapshot) {
  try {
    const store = recommendationStore();
    const dateKey = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const key = `${symbol}:${dateKey}`;
    const existing = await store.get(key, { type: "json" });
    if (existing) return; // already logged today
    await store.setJSON(key, {
      symbol,
      date: dateKey,
      price: snapshot.price,
      recommendation: snapshot.recommendation,
      recommendation_en: snapshot.recommendationEn,
      upside_pct: snapshot.upsidePct,
    });
  } catch {
    // Logging is best-effort — never fail the actual analysis over this.
  }
}

exports.handler = async (event, context) => {
  initBlobs(event);
  const user = context.clientContext && context.clientContext.user;
  if (!user) {
    return { statusCode: 401, body: JSON.stringify({ error: "پہلے لاگ ان کریں" }) };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "POST استعمال کریں" }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "غلط JSON" }) };
  }

  const symbols = Array.isArray(body.symbols) ? body.symbols : [];
  if (symbols.length === 0) {
    return { statusCode: 400, body: JSON.stringify({ error: "کم از کم ایک سٹاک بھیجیں" }) };
  }
  if (symbols.length > 10) {
    return { statusCode: 400, body: JSON.stringify({ error: "ایک وقت میں زیادہ سے زیادہ 10 سٹاکس" }) };
  }

  const results = [];

  for (const raw of symbols) {
    const symbol = String(raw).trim().toUpperCase();
    if (!symbol) continue;

    try {
      const history = await fetchHistory(symbol);
      const snapshot = computeSnapshot(history);
      const threeMonth = highLowPosition(history, 63); // ~3 trading months
      const oneYear = highLowPosition(history, 252); // ~1 trading year

      await logRecommendation(symbol, snapshot);

      // If the stock is trading near its recent low, pull in a few recent
      // headlines so the AI can factor in whether the news backdrop looks
      // likely to help it recover tomorrow, or points to more weakness.
      let newsHeadlines = [];
      const nearLow = threeMonth?.labelEn === "Near low";
      if (nearLow) {
        newsHeadlines = await fetchNews(symbol);
      }
      const newsBlock = newsHeadlines.length
        ? `Recent headlines: ${newsHeadlines.map((h) => `"${h.title}"`).join("; ")}. `
        : "";

      const prompt =
        `You are a PSX (Pakistan Stock Exchange) technical analyst. ` +
        `Stock: ${symbol}. Price: ${snapshot.price}. ` +
        `20-day SMA: ${snapshot.sma20}, 50-day SMA: ${snapshot.sma50}, ` +
        `RSI(14): ${snapshot.rsi14}, MACD: ${snapshot.macd} vs signal ${snapshot.macdSignal}, ` +
        `support: ${snapshot.support}, resistance: ${snapshot.resistance}. ` +
        `Trend (10-day SMA slope): ${snapshot.trendEn} (${snapshot.trendSlopePct}% slope). ` +
        `3-month range: low ${threeMonth?.low}, high ${threeMonth?.high} (${threeMonth?.labelEn}). ` +
        `1-year range: low ${oneYear?.low}, high ${oneYear?.high} (${oneYear?.labelEn}). ` +
        newsBlock +
        `Rule-based read: position=${snapshot.positionEn}, recommendation=${snapshot.recommendationEn}, ` +
        `upside=${snapshot.upsidePct}%. In 2-3 short sentences (Urdu followed by one English line), ` +
        `explain simply which direction the stock appears to be heading (up/down/sideways) and why` +
        (nearLow
          ? `, and — since it's near its recent low — whether the headlines above suggest it's likely to bounce back soon or stay weak`
          : "") +
        `, and what a retail trader should watch out for. ` +
        `Do not give financial guarantees; note this is not financial advice.`;

      let aiSummary = null;
      let aiProvider = null;
      try {
        const aiResult = await analyzeWithFallback(prompt);
        aiSummary = aiResult.text;
        aiProvider = aiResult.providerLabel;
      } catch (e) {
        aiSummary =
          "AI تجزیہ فی الحال دستیاب نہیں (تمام providers ناکام) — نیچے صرف ٹیکنیکل نمبرز پر مبنی نتیجہ ہے۔";
      }

      results.push({
        symbol,
        price: snapshot.price,
        position: snapshot.position,
        position_en: snapshot.positionEn,
        upside_pct: snapshot.upsidePct,
        tradeable: snapshot.tradeable,
        recommendation: snapshot.recommendation,
        recommendation_en: snapshot.recommendationEn,
        trend: snapshot.trend,
        trend_en: snapshot.trendEn,
        ai_summary: aiSummary,
        ai_provider: aiProvider,
        three_month: threeMonth,
        one_year: oneYear,
        news: newsHeadlines,
      });
    } catch (e) {
      const message = e instanceof PSXDataError || e instanceof ProviderError ? e.message : `غیر متوقع خرابی: ${e.message}`;
      results.push({ symbol, error: message });
    }
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(results),
  };
};
