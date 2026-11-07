/**
 * Fetches the full PSX market screener table from
 * https://dps.psx.com.pk/screener — this single page lists EVERY symbol
 * listed on PSX (not just the KSE-100) along with its sector, market cap,
 * price, today's % change, 1-year % change, PE ratio, dividend yield,
 * free float and 30-day average volume. It is PSX's own public page and
 * is server-rendered HTML, so it can be scraped the same way psxData.js
 * scrapes the historical-price page.
 *
 * This one page is what powers the whole-market scanner (market-scan.js):
 * one fetch covers every PSX company, instead of needing a separate
 * historical-data fetch per symbol (which would be far too slow/expensive
 * to do for 700+ symbols inside a single Netlify Function call).
 */
const cheerio = require("cheerio");

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
};

class ScreenerError extends Error {}

// Converts strings like "411.5M", "12.3B", "68.8M", "0.0" into a plain
// number expressed in millions (PKR millions for market cap / free float).
function parseToMillions(text) {
  if (!text) return 0;
  const t = text.trim().replace(/,/g, "");
  const num = parseFloat(t);
  if (Number.isNaN(num)) return 0;
  if (/B$/i.test(t)) return num * 1000;
  if (/K$/i.test(t)) return num / 1000;
  return num; // plain number or "M" suffix — already in millions
}

function parsePercent(text) {
  if (!text) return 0;
  const num = parseFloat(text.replace(/%/g, "").trim());
  return Number.isNaN(num) ? 0 : num;
}

function parseScreenerHtml(html) {
  const $ = cheerio.load(html);
  const rows = [];

  $("table tr").each((_, el) => {
    const tds = $(el).find("td");
    const cells = tds.map((__, td) => $(td).text().trim()).get();
    if (cells.length < 11) return;

    // The symbol cell can carry an ex-dividend badge glued to the symbol
    // (visible text like "EFERTXD"); the clean symbol lives in data-order
    // or in the link text.
    const firstTd = tds.first();
    const cleanSymbol =
      (firstTd.attr("data-order") || firstTd.find("a").first().text() || "").trim();

    const [
      symbolCell,
      sector,
      listedIn,
      marketCap,
      price,
      changePct,
      yearChangePct,
      peRatio,
      dividendYield,
      freeFloat,
      volume,
    ] = cells;

    // The symbol cell sometimes carries a trailing badge like "NC"/"XD"
    // (e.g. "AABS NC") — the real symbol is always the first token.
    const symbol = (cleanSymbol || symbolCell || "").split(/\s+/)[0];
    if (!symbol || !/^[A-Z0-9]+$/i.test(symbol)) return;

    rows.push({
      symbol: symbol.toUpperCase(),
      sector: sector || "",
      listedIn: listedIn || "",
      marketCapM: parseToMillions(marketCap),
      price: parseFloat((price || "").replace(/,/g, "")) || 0,
      changePct: parsePercent(changePct),
      yearChangePct: parsePercent(yearChangePct),
      peRatio: parseFloat(peRatio) || 0,
      dividendYield: parseFloat(dividendYield) || 0,
      freeFloatM: parseToMillions(freeFloat),
      volume30d: parseFloat((volume || "").replace(/,/g, "")) || 0,
    });
  });

  return rows;
}

async function fetchScreener() {
  let resp;
  try {
    resp = await fetch("https://dps.psx.com.pk/screener", { headers: HEADERS });
  } catch (e) {
    throw new ScreenerError(`PSX اسکرینر ڈیٹا نہیں ملا / network error: ${e.message}`);
  }

  if (!resp.ok) {
    throw new ScreenerError(`PSX اسکرینر سے جواب نہیں ملا (status ${resp.status})`);
  }

  const html = await resp.text();
  const rows = parseScreenerHtml(html);

  if (rows.length === 0) {
    throw new ScreenerError(
      "PSX اسکرینر سے کوئی ڈیٹا نہیں ملا — PSX کے صفحے کی ساخت بدل گئی ہو گی"
    );
  }

  return rows;
}

module.exports = { fetchScreener, ScreenerError };
