/**
 * Fetches PSX's public "Payouts" page (dps.psx.com.pk/payouts) — this
 * lists every company's announced Dividend / Bonus / Right entitlement,
 * with its Ex Date and Book Closure dates, updated in real time via
 * PUCARS as companies announce them.
 *
 * NOTE: this page's exact table layout could not be fully confirmed
 * during development the way /screener's was. Parsing is written
 * defensively (tolerant column matching) so a layout change degrades to
 * "no rows found" rather than a crash — if MMM sees an empty list after
 * deploying, the page structure likely shifted and this file needs a
 * quick adjustment.
 */
const cheerio = require("cheerio");

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
};

class PayoutsError extends Error {}

// Pulls a DD-MM-YYYY / DD-MMM-YYYY style date out of free text, returns a
// Date object or null.
function parseDate(text) {
  if (!text) return null;
  const t = text.trim();
  const d = new Date(t);
  if (!Number.isNaN(d.getTime())) return d;
  return null;
}

function parseScreenerLikeTable(html) {
  const $ = cheerio.load(html);
  const rows = [];

  $("table tr").each((_, el) => {
    const cells = $(el)
      .find("td")
      .map((__, td) => $(td).text().replace(/\s+/g, " ").trim())
      .get();
    if (cells.length < 5) return;

    const symbol = (cells[0] || "").split(/\s+/)[0];
    if (!symbol || !/^[A-Z0-9]+$/i.test(symbol)) return;

    // Column order on PSX's payouts table: Symbol, Period, Dividend,
    // Bonus, Right, Ex Date, Entitlement/Book Closure — be tolerant
    // since exact column count can vary by a cell or two.
    const period = cells[1] || "";
    const dividend = cells[2] || "";
    const bonus = cells[3] || "";
    const right = cells[4] || "";
    const exDateText = cells[5] || cells[cells.length - 2] || "";
    const bookClosureText = cells[6] || cells[cells.length - 1] || "";

    rows.push({
      symbol: symbol.toUpperCase(),
      period,
      dividend,
      bonus,
      right,
      exDateText,
      exDate: parseDate(exDateText),
      bookClosureText,
    });
  });

  return rows;
}

async function fetchPayouts() {
  let resp;
  try {
    resp = await fetch("https://dps.psx.com.pk/payouts", { headers: HEADERS });
  } catch (e) {
    throw new PayoutsError(`PSX Payouts ڈیٹا نہیں ملا / network error: ${e.message}`);
  }

  if (!resp.ok) {
    throw new PayoutsError(`PSX Payouts سے جواب نہیں ملا (status ${resp.status})`);
  }

  const html = await resp.text();
  const rows = parseScreenerLikeTable(html);
  return rows; // may legitimately be empty (e.g. no announcements that day)
}

module.exports = { fetchPayouts, PayoutsError };
