/**
 * Fetches PSX (Pakistan Stock Exchange) price history from the PSX Data
 * Portal Services (DPS) site — https://dps.psx.com.pk
 *
 * KNOWN PSX ISSUE: dps.psx.com.pk is served by several rotating nodes.
 * Some nodes return 404 (styled as an ordinary page) for data/API routes
 * while serving normal HTML pages fine. DNS hands out a random node, so a
 * single request is a coin flip.
 *
 * An earlier version of this file tried pinning requests to a specific
 * resolved IP to work around this — that approach fails outright in
 * Netlify's network ("fetch failed"), apparently because direct-IP
 * connections aren't permitted there. So instead: just retry the normal
 * request several times. A plain request to the hostname works fine here
 * (confirmed: we get real HTTP responses, not connection errors) — it's
 * only a matter of which node DNS happens to route to.
 *
 *   https://dps.psx.com.pk/timeseries/eod/{SYMBOL}  — end-of-day history
 *   https://dps.psx.com.pk/timeseries/int/{SYMBOL}  — today's intraday ticks
 *
 * Undocumented by PSX, can change shape without notice. Check the Netlify
 * function logs first if this fails again — every attempt is logged with
 * its outcome.
 */

const PSX_HOST = "dps.psx.com.pk";
const DATA_SOURCE = "PSX Data Portal (dps.psx.com.pk)";

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  Accept: "application/json, text/plain, */*",
};

const FETCH_TIMEOUT_MS = 8000;
const MAX_ATTEMPTS = 5;
const RETRY_BASE_DELAY_MS = 500;

class PSXDataError extends Error {}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJsonOnce(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(url, { headers: HEADERS, signal: controller.signal });
    if (!resp.ok) {
      const bodySnippet = await resp.text().catch(() => "");
      const err = new Error(`status ${resp.status}`);
      err.status = resp.status;
      err.bodySnippet = bodySnippet.slice(0, 150);
      throw err;
    }
    const text = await resp.text();
    try {
      return JSON.parse(text);
    } catch {
      const err = new Error("response was not JSON — PSX likely served its normal site page instead of data");
      err.bodySnippet = text.slice(0, 150);
      throw err;
    }
  } finally {
    clearTimeout(timer);
  }
}

/** Fetches a dps.psx.com.pk JSON path, retrying a few times since PSX's
 * rotating nodes mean any single request may hit a broken one. */
async function fetchPsxJson(path) {
  const url = `https://${PSX_HOST}${path}`;
  const failures = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fetchJsonOnce(url);
    } catch (e) {
      failures.push(`attempt ${attempt}: ${e.status ? `status ${e.status}` : e.message}`);
      if (attempt < MAX_ATTEMPTS) await sleep(RETRY_BASE_DELAY_MS * attempt);
    }
  }

  console.error(`[psxData] ${path} failed after ${MAX_ATTEMPTS} attempts — ${failures.join("; ")}`);
  const err = new Error(`${path} failed after ${MAX_ATTEMPTS} attempts`);
  throw err;
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
    data = await fetchPsxJson(path);
  } catch (e) {
    throw new PSXDataError(`'${sym}' کی تاریخی قیمتیں نہیں ملیں — PSX بار بار جواب نہیں دے رہا (${e.message})`);
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
    data = await fetchPsxJson(path);
  } catch (e) {
    throw new PSXDataError(`'${sym}' کا آج کا ڈیٹا نہیں ملا — PSX بار بار جواب نہیں دے رہا (${e.message})`);
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
