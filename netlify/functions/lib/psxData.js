/**
 * Fetches PSX (Pakistan Stock Exchange) price history from the PSX Data
 * Portal Services (DPS) site — https://dps.psx.com.pk
 *
 * IMPORTANT: this uses PSX's internal JSON timeseries endpoints, NOT the
 * human-facing /historical page. The /historical page loads its data via
 * client-side JS from these same endpoints — POSTing directly to
 * /historical (as an older version of this file did) returns 404, because
 * that page is not itself an API.
 *
 *   https://dps.psx.com.pk/timeseries/eod/{SYMBOL}  — end-of-day history
 *   https://dps.psx.com.pk/timeseries/int/{SYMBOL}  — today's intraday ticks
 *
 * These are undocumented by PSX and can change shape without notice. If
 * fetchHistory/fetchIntraday start failing again, check the Netlify
 * function logs first — both now log the exact URL, HTTP status, and a
 * snippet of the response body on any failure, so the real cause (vs. a
 * generic 404) should be visible immediately instead of needing this file
 * re-diagnosed from scratch.
 */

const { timedFetch } = require("./net");

// Shown next to every price so users know where a number came from.
const DATA_SOURCE = "PSX Data Portal (dps.psx.com.pk)";

// Small in-memory cache. A warm Netlify function instance reuses it, so
// several users (or the daily alert job) asking for the same symbol
// within a few minutes cost one PSX request instead of many.
const HISTORY_TTL_MS = 5 * 60 * 1000;
const historyCache = new Map(); // key -> { at, promise }

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  Accept: "application/json, text/plain, */*",
};

class PSXDataError extends Error {}

/**
 * Normalizes one row from the PSX timeseries JSON into
 * { date, open, high, low, close, volume }.
 *
 * The EOD feed's row shape has been seen as either:
 *   [unixSeconds, open, close, volume]              (4 columns, no H/L)
 *   [unixSeconds, open, high, low, close, volume]    (6 columns)
 * This handles both. When high/low aren't provided, they're approximated
 * from open/close (noted via `approxRange: true`) — fine for price
 * display and most indicators, but not a substitute for true intraday
 * high/low if PSX ever starts providing it under a different shape.
 */
function normalizeRow(row) {
  if (!Array.isArray(row) || row.length < 4) return null;

  const ts = Number(row[0]);
  if (!Number.isFinite(ts)) return null;
  const date = new Date(ts * 1000).toISOString().slice(0, 10);

  let open, high, low, close, volume, approxRange = false;

  if (row.length >= 6) {
    [, open, high, low, close, volume] = row;
  } else {
    [, open, close, volume] = row;
    high = Math.max(Number(open), Number(close));
    low = Math.min(Number(open), Number(close));
    approxRange = true;
  }

  close = Number(close);
  if (!Number.isFinite(close)) return null;

  return {
    date,
    open: Number.isFinite(Number(open)) ? Number(open) : null,
    high: Number.isFinite(Number(high)) ? Number(high) : null,
    low: Number.isFinite(Number(low)) ? Number(low) : null,
    close,
    volume: Number.isFinite(Number(volume)) ? Number(volume) : null,
    approxRange,
  };
}

async function fetchJson(url) {
  let resp;
  try {
    resp = await timedFetch(url, { headers: HEADERS }, 8000);
  } catch (e) {
    const err = new Error(`network error fetching ${url}: ${e.message}`);
    err.cause = e;
    throw err;
  }

  if (!resp.ok) {
    const bodySnippet = await resp.text().catch(() => "");
    console.error(
      `[psxData] non-OK response from ${url} — status ${resp.status}; body (first 300 chars): ${bodySnippet.slice(0, 300)}`
    );
    const err = new Error(`status ${resp.status}`);
    err.status = resp.status;
    throw err;
  }

  const text = await resp.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error(
      `[psxData] non-JSON response from ${url}; body (first 300 chars): ${text.slice(0, 300)}`
    );
    const err = new Error("response was not valid JSON");
    err.cause = e;
    throw err;
  }
}

async function fetchHistoryUncached(symbol) {
  const sym = symbol.trim().toUpperCase();
  const url = `https://dps.psx.com.pk/timeseries/eod/${encodeURIComponent(sym)}`;

  let data;
  try {
    data = await fetchJson(url);
  } catch (e) {
    if (e.status) {
      throw new PSXDataError(`'${sym}' کے لیے PSX سے جواب نہیں ملا (status ${e.status})`);
    }
    throw new PSXDataError(`'${sym}' کی تاریخی قیمتیں نہیں ملیں / network error: ${e.message}`);
  }

  const rawRows = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
  const rows = rawRows.map(normalizeRow).filter(Boolean);

  if (rows.length === 0) {
    console.error(`[psxData] ${url} returned OK but no usable rows; raw payload keys: ${Object.keys(data || {}).join(",")}`);
    throw new PSXDataError(
      `'${sym}' کے لیے کوئی ڈیٹا نہیں ملا — یا تو کوڈ غلط ہے یا PSX کے ڈیٹا کی ساخت بدل گئی ہے`
    );
  }

  // PSX returns newest first — we want oldest-first for indicator math.
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return rows;
}

/** Cached wrapper: same symbol within HISTORY_TTL_MS → one PSX request. */
function fetchHistory(symbol) {
  const key = symbol.trim().toUpperCase();
  const hit = historyCache.get(key);
  if (hit && Date.now() - hit.at < HISTORY_TTL_MS) return hit.promise;

  const promise = fetchHistoryUncached(symbol);
  historyCache.set(key, { at: Date.now(), promise });
  // Never cache failures — the next request should try PSX again.
  promise.catch(() => {
    if (historyCache.get(key)?.promise === promise) historyCache.delete(key);
  });
  return promise;
}

/**
 * Fetches today's intraday tick data (time + price) for a symbol.
 */
async function fetchIntraday(symbol) {
  const sym = symbol.trim().toUpperCase();
  const url = `https://dps.psx.com.pk/timeseries/int/${encodeURIComponent(sym)}`;

  let data;
  try {
    data = await fetchJson(url);
  } catch (e) {
    if (e.status) {
      throw new PSXDataError(`'${sym}' کے آج کے ڈیٹا کے لیے PSX سے جواب نہیں ملا (status ${e.status})`);
    }
    throw new PSXDataError(`'${sym}' کا آج کا ڈیٹا نہیں ملا / network error: ${e.message}`);
  }

  const points = Array.isArray(data?.data) ? data.data : [];
  if (points.length === 0) {
    throw new PSXDataError(`'${sym}' کے لیے آج کا کوئی ڈیٹا نہیں ملا (ممکن ہے مارکیٹ بند ہو)`);
  }

  return points.map(([ts, price]) => ({
    time: new Date(ts * 1000).toISOString(),
    price: Number(price),
  }));
}

module.exports = { fetchHistory, fetchIntraday, PSXDataError, DATA_SOURCE };
