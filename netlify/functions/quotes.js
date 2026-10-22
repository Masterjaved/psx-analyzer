/**
 * Lightweight price lookup for the portfolio page: last close, previous
 * close and change — NO AI calls, NO news. The portfolio page used to call
 * /api/analyze (AI on every holding, max 10 stocks) just to read prices,
 * which was slow, costly and silently ignored holdings beyond the 10th.
 */
const { fetchHistory, PSXDataError, DATA_SOURCE } = require("./lib/psxData");
const { json, getUser, parseJsonBody } = require("./lib/http");
const { normalizeSymbol } = require("./lib/validate");
const { mapLimit } = require("./lib/pool");

const MAX_SYMBOLS = 30;
const CONCURRENCY = 6;

async function quoteOne(symbol) {
  try {
    const history = await fetchHistory(symbol);
    const last = history[history.length - 1];
    const prev = history.length > 1 ? history[history.length - 2] : null;
    const change = prev ? Math.round((last.close - prev.close) * 100) / 100 : null;
    const changePct = prev && prev.close ? Math.round(((last.close - prev.close) / prev.close) * 10000) / 100 : null;
    return {
      symbol,
      price: last.close,
      prev_close: prev ? prev.close : null,
      change,
      change_pct: changePct,
      data_source: DATA_SOURCE,
      data_as_of: last.date || null,
      fetched_at: new Date().toISOString(),
    };
  } catch (e) {
    return { symbol, error: e instanceof PSXDataError ? e.message : `غیر متوقع خرابی: ${e.message}` };
  }
}

exports.handler = async (event, context) => {
  const user = await getUser(event);
  if (!user) return json(401, { error: "پہلے لاگ ان کریں" });
  if (event.httpMethod !== "POST") return json(405, { error: "POST استعمال کریں" });

  let body;
  try {
    body = parseJsonBody(event);
  } catch (e) {
    return json(e.code === "TOO_LARGE" ? 413 : 400, { error: e.code === "TOO_LARGE" ? "درخواست بہت بڑی ہے" : "غلط JSON" });
  }

  const raw = Array.isArray(body.symbols) ? body.symbols : [];
  if (raw.length === 0) return json(400, { error: "کم از کم ایک سٹاک بھیجیں" });

  const symbols = [...new Set(raw.map(normalizeSymbol).filter(Boolean))];
  if (symbols.length === 0) return json(400, { error: "کوئی درست سٹاک کوڈ نہیں ملا" });
  if (symbols.length > MAX_SYMBOLS) return json(400, { error: `ایک وقت میں زیادہ سے زیادہ ${MAX_SYMBOLS} سٹاکس` });

  const results = await mapLimit(symbols, CONCURRENCY, quoteOne);
  return json(200, results);
};
