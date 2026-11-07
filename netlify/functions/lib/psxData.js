/**
 * Fetches PSX (Pakistan Stock Exchange) price history from the PSX Data
 * Portal Services (DPS) site — https://dps.psx.com.pk
 *
 * This is PSX's own public data site; there is no official free real-time
 * API, so this scrapes the DPS "historical" page. If PSX changes their
 * page layout, the table-parsing logic below (parseHistoryHtml) is the
 * part that needs updating.
 */

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
};

class PSXDataError extends Error {}

// --- Source 1: PSX's own JSON end-of-day feed -----------------------------
// GET /timeseries/eod/<SYMBOL>  ->  { data: [[epochSeconds, close, volume, open], ...] }
// newest first, ~5 years. No High/Low in this feed (indicators fall back to close).
async function historyFromPSX(sym, days) {
  let resp;
  try {
    resp = await fetch(`https://dps.psx.com.pk/timeseries/eod/${encodeURIComponent(sym)}`, {
      headers: { ...HEADERS, Accept: "application/json", Referer: "https://dps.psx.com.pk/" },
    });
  } catch (e) {
    throw new Error(`network error: ${e.message}`);
  }
  if (!resp.ok) throw new Error(`status ${resp.status}`);

  let json;
  try {
    json = await resp.json();
  } catch {
    throw new Error("PSX نے JSON کی جگہ کچھ اور بھیجا");
  }

  const points = Array.isArray(json?.data) ? json.data : [];
  const cutoff = Date.now() - days * 86400000;
  const rows = points
    .map(([ts, close, volume, open]) => {
      const c = Number(close);
      if (!Number.isFinite(c) || !Number.isFinite(Number(ts))) return null;
      // PSX epochs are Pakistan wall-clock seconds: read as UTC = correct calendar date.
      const d = new Date(Number(ts) * 1000);
      return {
        t: d.getTime(),
        date: d.toISOString().slice(0, 10),
        open: Number.isFinite(Number(open)) ? Number(open) : null,
        high: null,
        low: null,
        close: c,
        volume: Number.isFinite(Number(volume)) ? Number(volume) : null,
      };
    })
    .filter((r) => r && r.t >= cutoff)
    .sort((a, b) => a.t - b.t)
    .map(({ t, ...rest }) => rest);

  if (rows.length === 0) throw new Error("کوئی ڈیٹا نہیں");
  return rows;
}

// --- Source 2 (fallback): Yahoo Finance, PSX tickers end in ".KA" ----------
// Free, no key, includes High/Low. Covers normal shares; not ETFs/indices.
async function historyFromYahoo(sym, days) {
  const range = days > 365 ? "2y" : "1y";
  let resp;
  try {
    resp = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}.KA?range=${range}&interval=1d`,
      { headers: { ...HEADERS, Accept: "application/json" } }
    );
  } catch (e) {
    throw new Error(`network error: ${e.message}`);
  }
  if (!resp.ok) throw new Error(`status ${resp.status}`);

  const json = await resp.json();
  const r = json?.chart?.result?.[0];
  const ts = r?.timestamp || [];
  const q = r?.indicators?.quote?.[0] || {};
  const rows = [];
  for (let i = 0; i < ts.length; i++) {
    const close = Number(q.close?.[i]);
    if (!Number.isFinite(close) || q.close?.[i] == null) continue;
    const num = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
    rows.push({
      date: new Date(ts[i] * 1000).toISOString().slice(0, 10),
      open: num(q.open?.[i]),
      high: num(q.high?.[i]),
      low: num(q.low?.[i]),
      close,
      volume: num(q.volume?.[i]),
    });
  }
  if (rows.length === 0) throw new Error("کوئی ڈیٹا نہیں");
  return rows;
}

async function fetchHistory(symbol, days = 400) {
  const sym = symbol.trim().toUpperCase();
  const problems = [];

  try {
    return await historyFromPSX(sym, days);
  } catch (e) {
    problems.push(`PSX: ${e.message}`);
  }
  try {
    return await historyFromYahoo(sym, days);
  } catch (e) {
    problems.push(`Yahoo: ${e.message}`);
  }

  throw new PSXDataError(`'${sym}' کی قیمتیں کسی بھی ذریعے سے نہیں ملیں — ${problems.join(" | ")}`);
}

/**
 * Fetches today's intraday tick data (time + price) for a symbol.
 * Uses PSX DPS's internal timeseries endpoint. This endpoint is NOT
 * officially documented by PSX, so its shape can change without notice —
 * if this starts failing, that's the first place to check.
 */
async function fetchIntraday(symbol) {
  const sym = symbol.trim().toUpperCase();
  let resp;
  try {
    resp = await fetch(`https://dps.psx.com.pk/timeseries/int/${sym}`, {
      headers: HEADERS,
    });
  } catch (e) {
    throw new PSXDataError(`'${sym}' کا آج کا ڈیٹا نہیں ملا / network error: ${e.message}`);
  }

  if (!resp.ok) {
    throw new PSXDataError(`'${sym}' کے آج کے ڈیٹا کے لیے PSX سے جواب نہیں ملا (status ${resp.status})`);
  }

  let data;
  try {
    data = await resp.json();
  } catch {
    throw new PSXDataError(`'${sym}' کا آج کا ڈیٹا سمجھ نہیں آیا (فارمیٹ بدل گیا ہو گا)`);
  }

  // Expected shape: { data: [[unixSeconds, price], ...] } — adjust here if
  // PSX's response shape turns out different once tested live.
  const points = Array.isArray(data?.data) ? data.data : [];
  if (points.length === 0) {
    throw new PSXDataError(`'${sym}' کے لیے آج کا کوئی ڈیٹا نہیں ملا (ممکن ہے مارکیٹ بند ہو)`);
  }

  return points
    .map(([ts, price]) => ({ ts: Number(ts), time: new Date(Number(ts) * 1000).toISOString(), price: Number(price) }))
    .sort((a, b) => a.ts - b.ts)
    .map(({ ts, ...rest }) => rest);
}

module.exports = { fetchHistory, fetchIntraday, PSXDataError };
