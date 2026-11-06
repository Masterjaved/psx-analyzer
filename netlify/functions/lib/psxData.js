/**
 * Fetches PSX (Pakistan Stock Exchange) price history from the PSX Data
 * Portal Services (DPS) site — https://dps.psx.com.pk
 *
 * This is PSX's own public data site; there is no official free real-time
 * API, so this scrapes the DPS "historical" page. If PSX changes their
 * page layout, the table-parsing logic below (parseHistoryHtml) is the
 * part that needs updating.
 */

const cheerio = require("cheerio");

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
};

class PSXDataError extends Error {}

function parseHistoryHtml(html) {
  const $ = cheerio.load(html);
  const rows = [];

  $("table tr").each((_, el) => {
    const cells = $(el)
      .find("td")
      .map((__, td) => $(td).text().trim())
      .get();
    if (cells.length >= 5) {
      const [date, open, high, low, close, volume] = cells;
      const closeNum = parseFloat(close.replace(/,/g, ""));
      if (!Number.isNaN(closeNum)) {
        rows.push({
          date,
          open: parseFloat(open.replace(/,/g, "")) || null,
          high: parseFloat(high.replace(/,/g, "")) || null,
          low: parseFloat(low.replace(/,/g, "")) || null,
          close: closeNum,
          volume: volume ? parseFloat(volume.replace(/,/g, "")) || null : null,
        });
      }
    }
  });

  // DPS lists most recent first — we want oldest-first for indicator math.
  return rows.reverse();
}

async function fetchHistory(symbol, days = 400) {
  const sym = symbol.trim().toUpperCase();
  const dateTo = new Date();
  const dateFrom = new Date(dateTo);
  dateFrom.setDate(dateFrom.getDate() - days);

  const fmt = (d) => d.toISOString().slice(0, 10);

  const params = new URLSearchParams({
    symbol: sym,
    dateFrom: fmt(dateFrom),
    dateTo: fmt(dateTo),
  });

  let resp;
  try {
    resp = await fetch("https://dps.psx.com.pk/historical", {
      method: "POST",
      headers: { ...HEADERS, "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
  } catch (e) {
    throw new PSXDataError(`'${sym}' کی تاریخی قیمتیں نہیں ملیں / network error: ${e.message}`);
  }

  if (!resp.ok) {
    throw new PSXDataError(`'${sym}' کے لیے PSX سے جواب نہیں ملا (status ${resp.status})`);
  }

  const html = await resp.text();
  const rows = parseHistoryHtml(html);

  if (rows.length === 0) {
    throw new PSXDataError(
      `'${sym}' کے لیے کوئی ڈیٹا نہیں ملا — یا تو کوڈ غلط ہے یا PSX کے صفحے کی ساخت بدل گئی ہے`
    );
  }

  return rows;
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

  return points.map(([ts, price]) => ({
    time: new Date(ts * 1000).toISOString(),
    price: Number(price),
  }));
}

module.exports = { fetchHistory, fetchIntraday, PSXDataError };
