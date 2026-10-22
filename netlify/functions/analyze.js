const { fetchHistory, PSXDataError, DATA_SOURCE } = require("./lib/psxData");
const { computeSnapshot, highLowPosition } = require("./lib/indicators");
const { analyzeWithFallback, ProviderError } = require("./lib/aiProviders");
const { fetchNews } = require("./lib/newsFetch");
const { json, getUser, parseJsonBody } = require("./lib/http");
const { normalizeSymbol } = require("./lib/validate");
const { mapLimit } = require("./lib/pool");

const MAX_SYMBOLS = 10;
const CONCURRENCY = 4;
// Below this many daily closes the indicators (SMA/RSI/MACD) are not
// meaningful, so we say so instead of showing made-up-looking numbers.
const MIN_DATA_POINTS = 30;
// Netlify free tier stops a function at ~10s. Leave headroom for the response.
const TIME_BUDGET_MS = 8500;

async function analyzeOne(symbol, deadline) {
  try {
    const history = await fetchHistory(symbol);
    if (history.length < MIN_DATA_POINTS) {
      return {
        symbol,
        error: `ڈیٹا ناکافی ہے (صرف ${history.length} دن کی قیمتیں دستیاب) — قابلِ اعتماد تجزیہ ممکن نہیں / Insufficient data for reliable analysis.`,
      };
    }

    const snapshot = computeSnapshot(history);
    const threeMonth = highLowPosition(history, 63); // ~3 trading months
    const oneYear = highLowPosition(history, 252); // ~1 trading year

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
      `Do not give financial guarantees; note this is not financial advice. ` +
      `Only use the numbers given above; if something is not provided, say it is unavailable rather than guessing.`;

    let aiSummary = null;
    let aiProvider = null;
    try {
      const aiResult = await analyzeWithFallback(prompt, { deadline });
      aiSummary = aiResult.text;
      aiProvider = aiResult.providerLabel;
    } catch (e) {
      aiSummary =
        "AI تجزیہ فی الحال دستیاب نہیں (تمام providers ناکام) — نیچے صرف ٹیکنیکل نمبرز پر مبنی نتیجہ ہے۔";
    }

    const last = history[history.length - 1];
    return {
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
      // Where the number came from and how fresh it is (last daily close,
      // not a live tick).
      data_source: DATA_SOURCE,
      data_as_of: last?.date || null,
      fetched_at: new Date().toISOString(),
    };
  } catch (e) {
    const message = e instanceof PSXDataError || e instanceof ProviderError ? e.message : `غیر متوقع خرابی: ${e.message}`;
    return { symbol, error: message };
  }
}

exports.handler = async (event, context) => {
  const startedAt = Date.now();
  const user = await getUser(event);
  if (!user) return json(401, { error: "پہلے لاگ ان کریں" });

  if (event.httpMethod !== "POST") return json(405, { error: "POST استعمال کریں" });

  let body;
  try {
    body = parseJsonBody(event);
  } catch (e) {
    return json(e.code === "TOO_LARGE" ? 413 : 400, { error: e.code === "TOO_LARGE" ? "درخواست بہت بڑی ہے" : "غلط JSON" });
  }

  const rawSymbols = Array.isArray(body.symbols) ? body.symbols : [];
  if (rawSymbols.length === 0) return json(400, { error: "کم از کم ایک سٹاک بھیجیں" });
  if (rawSymbols.length > MAX_SYMBOLS) return json(400, { error: `ایک وقت میں زیادہ سے زیادہ ${MAX_SYMBOLS} سٹاکس` });

  // Normalise, drop duplicates (keep first), and report invalid codes
  // per-symbol instead of failing the whole request.
  const seen = new Set();
  const jobs = [];
  for (const raw of rawSymbols) {
    const symbol = normalizeSymbol(raw);
    if (!symbol) {
      jobs.push({ invalid: String(raw).slice(0, 20) });
      continue;
    }
    if (seen.has(symbol)) continue;
    seen.add(symbol);
    jobs.push({ symbol });
  }

  const deadline = startedAt + TIME_BUDGET_MS;
  const results = await mapLimit(jobs, CONCURRENCY, async (job) => {
    if (job.invalid !== undefined) {
      return { symbol: job.invalid, error: "سٹاک کوڈ غلط ہے / invalid symbol" };
    }
    return analyzeOne(job.symbol, deadline);
  });

  return json(200, results);
};
