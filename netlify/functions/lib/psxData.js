/**
 * Fetches PSX (Pakistan Stock Exchange) price history from the PSX Data
 * Portal Services (DPS) site — https://dps.psx.com.pk
 *
 * KNOWN PSX ISSUE (confirmed independently, see
 * https://github.com/umairsandhu/psx-dps#why-this-exists):
 * dps.psx.com.pk is served by several rotating nodes (IPs). SOME of these
 * nodes return 404 (styled as an ordinary page, not an error page) for
 * every data/API route, while serving normal HTML pages with 200 just
 * fine. DNS hands out a random node, so a plain fetch() to an API route
 * is a coin flip — and because Node/undici reuses one resolved connection
 * per warm function instance, EVERY symbol in a given Netlify Function
 * invocation fails identically if that instance got a broken node.
 *
 * Fix: resolve all current A records for dps.psx.com.pk ourselves, and
 * try each IP in turn (pinned to the hostname via TLS SNI/Host, so it's
 * still a normal HTTPS request to dps.psx.com.pk — just forced to a
 * specific node) until one actually returns JSON. The working IP is
 * cached in-memory for a few minutes so most requests only try once.
 *
 *   https://dps.psx.com.pk/timeseries/eod/{SYMBOL}  — end-of-day history
 *   https://dps.psx.com.pk/timeseries/int/{SYMBOL}  — today's intraday ticks
 *
 * These endpoints are undocumented by PSX and can change shape without
 * notice. If this starts failing again, check the Netlify function logs
 * first — every failure here is logged with the exact path, IP tried,
 * and status/error, so the real cause should be visible immediately.
 */

const dns = require("node:dns").promises;
const { Agent } = require("undici");

const PSX_HOST = "dps.psx.com.pk";
const DATA_SOURCE = "PSX Data Portal (dps.psx.com.pk)";

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  Accept: "application/json, text/plain, */*",
};

const FETCH_TIMEOUT_MS = 8000;

// Pin the last node that actually served data, so most requests in a warm
// function instance only try once instead of re-probing every time.
let pinnedIP = null;
let pinnedAt = 0;
const PIN_TTL_MS = 5 * 60 * 1000;

class PSXDataError extends Error {}

function agentForIP(ip) {
  return new Agent({
    connect: {
      lookup: (_hostname, _options, callback) => callback(null, ip, 4),
    },
  });
}

async function candidateIPs() {
  try {
    const ips = await dns.resolve4(PSX_HOST);
    return [...new Set(ips)];
  } catch (e) {
    console.error(`[psxData] DNS resolve4(${PSX_HOST}) failed: ${e.message}`);
    return [];
  }
}

async function fetchJsonFromIP(path, ip) {
  const url = `https://${PSX_HOST}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      headers: HEADERS,
      dispatcher: ip ? agentForIP(ip) : undefined,
      signal: controller.signal,
    });
    if (!resp.ok) {
      const err = new Error(`status ${resp.status}`);
      err.status = resp.status;
      throw err;
    }
    const text = await resp.text();
    return JSON.parse(text); // throws if PSX served HTML instead of JSON
  } finally {
    clearTimeout(timer);
  }
}

/** Fetches a dps.psx.com.pk JSON path, working around the rotating-node
 * 404 issue described above. */
async function fetchPsxJson(path) {
  if (pinnedIP && Date.now() - pinnedAt < PIN_TTL_MS) {
    try {
      return await fetchJsonFromIP(path, pinnedIP);
    } catch (e) {
      console.error(`[psxData] pinned node ${pinnedIP} failed for ${path}: ${e.message} — re-probing other nodes`);
      pinnedIP = null;
    }
  }

  const ips = await candidateIPs();
  if (ips.length === 0) {
    // DNS lookup itself failed — fall back to a plain request so a clear
    // error still surfaces instead of silently returning nothing.
    return fetchJsonFromIP(path, null);
  }

  const failures = [];
  for (const ip of ips) {
    try {
      const data = await fetchJsonFromIP(path, ip);
      pinnedIP = ip;
      pinnedAt = Date.now();
      return data;
    } catch (e) {
      failures.push(`${ip} → ${e.status ? `status ${e.status}` : e.message}`);
    }
  }

  console.error(`[psxData] all ${ips.length} PSX node(s) failed for ${path} — ${failures.join("; ")}`);
  const err = new Error(`no working PSX node for ${path} (tried ${ips.length}: ${failures.join("; ")})`);
  err.allNodesFailed = true;
  throw err;
}

/**
 * The EOD timeseries route returns rows as [epochSeconds, close, volume,
 * open] — NOT full OHLC (confirmed: no high/low on this route). High/low
 * are approximated from open/close, which is fine for price display and
 * most indicators but is not true intraday range.
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
    data = await fetchPsxJson(path);
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
