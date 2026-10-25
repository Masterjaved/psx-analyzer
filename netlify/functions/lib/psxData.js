/**
 * Fetches PSX (Pakistan Stock Exchange) price history from the PSX Data
 * Portal Services (DPS) site — https://dps.psx.com.pk
 *
 * ROOT CAUSE (found by inspecting a real browser's Network tab against
 * the live site): the earlier "broken rotating node" theory was WRONG —
 * a direct browser request to the exact same IP (52.128.23.6) that our
 * server was also hitting got a clean 200. The real issue was simpler:
 * PSX's timeseries endpoints reject requests that don't look like they
 * came from their own page — specifically, they need:
 *   - Referer: https://dps.psx.com.pk/company/{SYMBOL}
 *   - X-Requested-With: XMLHttpRequest
 *   - Accept: application/json, text/javascript, * /*; q=0.01
 * Sending those (which a browser adds automatically, and which we now
 * add explicitly) is enough — no node-probing or IP-pinning needed.
 *
 *   https://dps.psx.com.pk/timeseries/eod/{SYMBOL}  — end-of-day history
 *   https://dps.psx.com.pk/timeseries/int/{SYMBOL}  — today's intraday ticks
 *
 * Undocumented by PSX, can change without notice. Check the Netlify
 * function logs first if this fails again — failures are logged with
 * status and a response snippet.
 */

const PSX_HOST = "dps.psx.com.pk";
const DATA_SOURCE = "PSX Data Portal (dps.psx.com.pk)";

const BASE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  Accept: "application/json, text/javascript, */*; q=0.01",
  "Accept-Language": "en-PK,en-GB;q=0.9,en-US;q=0.8,en;q=0.7",
  "X-Requested-With": "XMLHttpRequest",
};

const REQUEST_TIMEOUT_MS = 8000;

class PSXDataError extends Error {}

async function fetchPsxJson(path, symbol) {
  const url = `https://${PSX_HOST}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const resp = await fetch(url, {
      headers: {
        ...BASE_HEADERS,
        // PSX's endpoints check this — must point at the company page for
        // the symbol being requested, matching what a browser sends.
        Referer: `https://${PSX_HOST}/company/${encodeURIComponent(symbol)}`,
      },
      signal: controller.signal,
    });

    if (!resp.ok) {
      const bodySnippet = await resp.text().catch(() => "");
      console.error(`[psxData] ${path} — status ${resp.status}; body: ${bodySnippet.slice(0, 150)}`);
      const err = new Error(`status ${resp.status}`);
      err.status = resp.status;
      throw err;
    }

    const text = await resp.text();
    try {
      return JSON.parse(text);
    } catch {
      console.error(`[psxData] ${path} — response was not JSON; body: ${text.slice(0, 150)}`);
      throw new Error("response was not JSON");
    }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * EOD timeseries rows come as [epochSeconds, close, volume, open] — not
 * full OHLC (no high/low on this route). High/low approximated from
 * open/close.
 */
function normalizeEodRow(row) {
  if (!Array.isArray(row) || row.length < 4) return null;
  const [ts, closeRaw, volumeRaw, openRaw] = row;

  const t = Number(ts);
  const close = Number(closeRaw);
  const open = Number(openRaw);
  if (!Number.isFinite(t) || !Number.isFinite(close)) return null;

  const high = Number.isFinite(open) ? Math.max(open, close) : close;
  const low = Number.isFinite(open) ? Math.min(open, close) : close;

  return {
    date: new Date(t * 1000).toISOString().slice(0, 10),
    open: Number.isFinite(open) ? open : null,
    high,
    low,
    close,
    volume: Number.isFinite(Number(volumeRaw)) ? Number(volumeRaw) : null,
    approxRange: true,
  };
}

async function fetchHistoryUncached(symbol) {
  const sym = symbol.trim().toUpperCase();
  const path = `/timeseries/eod/${encodeURIComponent(sym)}`;

  let data;
  try {
    data = await fetchPsxJson(path, sym);
  } catch (e) {
    if (e.status) {
      throw new PSXDataError(`'${sym}' کے لیے PSX سے جواب نہیں ملا (status ${e.status})`);
    }
    throw new PSXDataError(`'${sym}' کی تاریخی قیمتیں نہیں ملیں / network error: ${e.message}`);
  }

  const rawRows = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
  const rows = rawRows.map(normalizeEodRow).filter(Boolean);

  if (rows.length === 0) {
    console.error(`[psxData] ${path} returned OK but no usable rows; payload keys: ${Object.keys(data || {}).join(",")}`);
    throw new PSXDataError(
      `'${sym}' کے لیے کوئی ڈیٹا نہیں ملا — یا تو کوڈ غلط ہے یا PSX کے ڈیٹا کی ساخت بدل گئی ہے`
    );
  }

  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return rows;
}

const HISTORY_TTL_MS = 5 * 60 * 1000;
const historyCache = new Map();

function fetchHistory(symbol) {
  const key = symbol.trim().toUpperCase();
  const hit = historyCache.get(key);
  if (hit && Date.now() - hit.at < HISTORY_TTL_MS) return hit.promise;

  const promise = fetchHistoryUncached(symbol);
  historyCache.set(key, { at: Date.now(), promise });
  promise.catch(() => {
    if (historyCache.get(key)?.promise === promise) historyCache.delete(key);
  });
  return promise;
}

async function fetchIntraday(symbol) {
  const sym = symbol.trim().toUpperCase();
  const path = `/timeseries/int/${encodeURIComponent(sym)}`;

  let data;
  try {
    data = await fetchPsxJson(path, sym);
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
