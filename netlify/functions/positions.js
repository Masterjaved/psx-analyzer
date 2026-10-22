/**
 * Computed portfolio view: current holdings + live-ish prices, built from
 * the transaction ledger (never a separately-stored "holdings" table, so
 * it can never drift from the transaction history).
 */
const { fetchHistory, PSXDataError, DATA_SOURCE } = require("./lib/psxData");
const { json, getUser } = require("./lib/http");
const { restGet, SupabaseError } = require("./lib/supabase");
const { computePositions, splitOpenClosed } = require("./lib/positions");
const { mapLimit } = require("./lib/pool");

const CONCURRENCY = 6;

async function priceFor(symbol) {
  try {
    const history = await fetchHistory(symbol);
    const last = history[history.length - 1];
    return { price: last.close, data_as_of: last.date || null, data_source: DATA_SOURCE };
  } catch (e) {
    return { price: null, error: e instanceof PSXDataError ? e.message : "قیمت نہیں مل سکی" };
  }
}

exports.handler = async (event) => {
  const user = await getUser(event);
  if (!user) return json(401, { error: "پہلے لاگ ان کریں" });

  try {
    const portfolios = await restGet(user.token, "portfolios", "select=id,name&order=created_at.asc&limit=1");
    if (!portfolios.length) return json(200, { open: [], closed: [], totals: null });

    const transactions = await restGet(
      user.token,
      "portfolio_transactions",
      `select=*&portfolio_id=eq.${portfolios[0].id}&order=transaction_date.asc&limit=5000`
    );

    const positions = computePositions(transactions);
    const { open, closed } = splitOpenClosed(positions);

    const priced = await mapLimit(open, CONCURRENCY, async (p) => {
      const quote = await priceFor(p.symbol);
      const currentValue = quote.price != null ? Math.round(quote.price * p.qty * 100) / 100 : null;
      const unrealizedPL = quote.price != null ? Math.round((currentValue - p.investedAmount) * 100) / 100 : null;
      const unrealizedPLPct =
        quote.price != null && p.investedAmount > 0 ? Math.round((unrealizedPL / p.investedAmount) * 10000) / 100 : null;
      return { ...p, ...quote, currentValue, unrealizedPL, unrealizedPLPct };
    });

    const totalInvested = priced.reduce((s, p) => s + p.investedAmount, 0);
    const totalValue = priced.reduce((s, p) => s + (p.currentValue || 0), 0);
    const withWeight = priced.map((p) => ({
      ...p,
      weightPct: totalValue > 0 && p.currentValue != null ? Math.round((p.currentValue / totalValue) * 10000) / 100 : null,
    }));

    return json(200, {
      open: withWeight,
      closed,
      totals: {
        investedAmount: Math.round(totalInvested * 100) / 100,
        currentValue: Math.round(totalValue * 100) / 100,
        unrealizedPL: Math.round((totalValue - totalInvested) * 100) / 100,
        realizedPL: Math.round(positions.reduce((s, p) => s + p.realizedPL, 0) * 100) / 100,
      },
      fetched_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error("positions error:", e);
    const status = e instanceof SupabaseError ? e.status : 500;
    return json(status, { error: e.message || "پورٹ فولیو لوڈ نہیں ہو سکا" });
  }
};
