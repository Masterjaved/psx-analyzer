/**
 * Fetches PSX (Pakistan Stock Exchange) price history from the PSX Data
 * Portal Services (DPS) site — https://dps.psx.com.pk
 *
 * KNOWN PSX ISSUE (confirmed live, in this project's own function logs):
 * dps.psx.com.pk is served by several rotating nodes. At least one node
 * (52.128.23.6) returns 404 for every data/API route while serving normal
 * HTML pages fine; another (52.128.23.16) serves data correctly. Plain
 * retries did NOT help — a warm Netlify function instance reuses its one
 * TCP connection, so every retry within an invocation hit the same bad
 * node every time.
 *
 * An earlier attempt pinned requests to a specific IP via undici's
 * `dispatcher`/`lookup` option — that failed outright ("fetch failed") in
 * Netlify's network, for reasons that weren't worth chasing further. This
 * version does the same IP-pinning idea but via Node's built-in `https`
 * module directly (host = IP, servername/Host header = dps.psx.com.pk) —
 * a much older, more universally-supported technique for this exact
 * scenario (HTTPS to a specific IP with correct SNI).
 *
 *   https://dps.psx.com.pk/timeseries/eod/{SYMBOL}  — end-of-day history
 *   https://dps.psx.com.pk/timeseries/int/{SYMBOL}  — today's intraday ticks
 *
 * Undocumented by PSX, can change shape (or node IPs) without notice.
 * Check the Netlify function logs first if this fails again — every
 * attempt against every IP is logged with its outcome.
 */

const https = require("node:https");
const dns = require("node:dns").promises;

const PSX_HOST = "dps.psx.com.pk";
const DATA_SOURCE = "PSX Data Portal (dps.psx.com.pk)";

// Documented-good node, tried first as a hint (see module comment above).
// If PSX changes its nodes, DNS discovery below still finds whatever is
// current — this is just a head start, not a hard dependency.
const KNOWN_GOOD_IP_HINTS = ["52.128.23.16"];

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  Accept: "application/json, text/plain, */*",
};

const REQUEST_TIMEOUT_MS = 8000;

class PSXDataError extends Error {}

// Pin the last IP that actually served data, so most requests in a warm
// function instance only try once instead of re-probing every time.
let pinnedIP = null;
let pinnedAt = 0;
const PIN_TTL_MS = 5 * 60 * 1000;

/** GET https://PSX_HOST<path>, connecting directly to `ip` (or, if ip is
 * null, letting normal DNS resolve it) but keeping the correct hostname
 * for TLS SNI and the Host header. */
function httpsGetJson(path, ip) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: ip || PSX_HOST,
        servername: PSX_HOST,
        path,
        method: "GET",
        headers: { ...HEADERS, Host: PSX_HOST },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            const err = new Error(`status ${res.statusCode}`);
            err.status = res.statusCode;
            return reject(err);
          }
          try {
            resolve(JSON.parse(body));
          } catch {
            const err = new Error("response was not JSON (likely PSX's normal site page, not data)");
            reject(err);
          }
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error("request timed out")));
    req.on("error", (e) => reject(e));
    req.end();
  });
}

async function candidateIPs() {
  try {
    const resolved = await dns.resolve4(PSX_HOST);
    // Known-good hint first, then whatever DNS actually returns right now.
    return [...new Set([...KNOWN_GOOD_IP_HINTS, ...resolved])];
  } catch (e) {
    console.error(`[psxData] DNS resolve4(${PSX_HOST}) failed: ${e.message}`);
    return [...KNOWN_GOOD_IP_HINTS];
  }
}

/** Fetches a dps.psx.com.pk JSON path, trying specific IPs directly to
 * route around PSX's known broken-node issue. */
async function fetchPsxJson(path) {
  const failures = [];

  if (pinnedIP && Date.now() - pinnedAt < PIN_TTL_MS) {
    try {
      return await httpsGetJson(path, pinnedIP);
    } catch (e) {
      failures.push(`pinned ${pinnedIP} → ${e.status ? `status ${e.status}` : e.message}`);
      pinnedIP = null;
    }
  }

  const ips = await candidateIPs();
  for (const ip of ips) {
    if (ip === pinnedIP) continue; // already tried above
    try {
      const data = await httpsGetJson(path, ip);
      pinnedIP = ip;
      pinnedAt = Date.now();
      return data;
    } catch (e) {
      failures.push(`${ip} → ${e.status ? `status ${e.status}` : e.message}`);
    }
  }

  // Last resort: plain hostname request, in case none of the above IPs
  // were reachable but normal DNS resolution happens to work anyway.
  try {
    return await httpsGetJson(path, null);
  } catch (e) {
    failures.push(`plain hostname → ${e.status ? `status ${e.status}` : e.message}`);
  }

  console.error(`[psxData] ${path} — every node failed: ${failures.join("; ")}`);
  throw new Error(`no working PSX node for ${path} (${failures.join("; ")})`);
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
    throw new PSXDataError(`'${sym}' کی تاریخی قیمتیں نہیں ملیں — PSX کے کسی سرور سے جواب نہیں ملا (${e.message})`);
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
    throw new PSXDataError(`'${sym}' کا آج کا ڈیٹا نہیں ملا — PSX کے کسی سرور سے جواب نہیں ملا (${e.message})`);
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
