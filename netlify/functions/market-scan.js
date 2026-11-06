/**
 * Whole-market scan across EVERY PSX-listed symbol (not just a
 * user-picked list), using the PSX screener page (lib/psxScreener.js).
 *
 * 1) "ڈاؤ تھیوری" buy/sell zones — approximated from each stock's 1-year
 *    % change, which the screener already provides for every symbol: a
 *    stock deeply down from a year ago is classed as being in the
 *    "buying range" (closer to its low); a stock sharply up is classed
 *    as being in the "selling range" (closer to its high). This is a
 *    market-wide approximation that works off one single page fetch —
 *    doing the exact 3-month/1-year high/low math (like analyze.js does
 *    per-symbol) for all ~700 PSX symbols in one request would be far
 *    too slow for a Netlify Function's execution limit.
 *
 * 2) Market-cap screener — symbols with Market Cap < 10,000 Million PKR.
 *    NOTE: Promoter Holding % and FII Holding % were also requested, but
 *    PSX does not publish those figures anywhere in a single, structured,
 *    scrapable source across all companies (each company files its own
 *    quarterly "Pattern of Shareholding" as an individual PDF, in
 *    inconsistent formats) — so only the Market Cap leg of that filter
 *    is implemented here.
 */
const { fetchScreener } = require("./lib/psxScreener");

const BUY_THRESHOLD_PCT = -20; // 1-year change <= this => "buying range"
const SELL_THRESHOLD_PCT = 20; // 1-year change >= this => "selling range"
const MAX_ROWS = 60;

exports.handler = async (event, context) => {
  const user = context.clientContext && context.clientContext.user;
  if (!user) {
    return { statusCode: 401, body: JSON.stringify({ error: "لاگ ان درکار ہے" }) };
  }

  try {
    const rows = await fetchScreener();

    // Ignore inactive/junk rows (zero price or zero market cap — usually
    // suspended, delisted, or otherwise non-tradeable entries).
    const active = rows.filter((r) => r.price > 0 && r.marketCapM > 0);

    const buyZone = active
      .filter((r) => r.yearChangePct <= BUY_THRESHOLD_PCT)
      .sort((a, b) => a.yearChangePct - b.yearChangePct)
      .slice(0, MAX_ROWS);

    const sellZone = active
      .filter((r) => r.yearChangePct >= SELL_THRESHOLD_PCT)
      .sort((a, b) => b.yearChangePct - a.yearChangePct)
      .slice(0, MAX_ROWS);

    const capScreener = active
      .filter((r) => r.marketCapM < 10000)
      .sort((a, b) => a.marketCapM - b.marketCapM)
      .slice(0, 100);

    const dividendYieldTop = active
      .filter((r) => r.dividendYield > 0)
      .sort((a, b) => b.dividendYield - a.dividendYield)
      .slice(0, 40);

    // Sector-level averages, for comparing one sector against another —
    // computed from the full scan, not just the slices above.
    const sectorMap = {};
    for (const r of active) {
      const key = r.sector || "دیگر";
      if (!sectorMap[key]) {
        sectorMap[key] = { sector: key, count: 0, peSum: 0, peCount: 0, divSum: 0, divCount: 0, changeSum: 0 };
      }
      const s = sectorMap[key];
      s.count++;
      s.changeSum += r.yearChangePct;
      if (r.peRatio > 0) {
        s.peSum += r.peRatio;
        s.peCount++;
      }
      if (r.dividendYield > 0) {
        s.divSum += r.dividendYield;
        s.divCount++;
      }
    }
    const sectorSummary = Object.values(sectorMap)
      .map((s) => ({
        sector: s.sector,
        count: s.count,
        avgPe: s.peCount ? Math.round((s.peSum / s.peCount) * 10) / 10 : null,
        avgDividendYield: s.divCount ? Math.round((s.divSum / s.divCount) * 10) / 10 : null,
        avgYearChangePct: Math.round((s.changeSum / s.count) * 10) / 10,
      }))
      .sort((a, b) => b.avgYearChangePct - a.avgYearChangePct);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        asOf: new Date().toISOString(),
        totalScanned: active.length,
        buyZone,
        sellZone,
        capScreener,
        dividendYieldTop,
        sectorSummary,
      }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: `اسکین خرابی: ${e.message}` }),
    };
  }
};
