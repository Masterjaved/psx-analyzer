const { fetchPayouts } = require("./lib/psxPayouts");
const { initBlobs, portfolioStore } = require("./lib/blobStore");

exports.handler = async (event, context) => {
  initBlobs(event);
  const user = context.clientContext && context.clientContext.user;
  if (!user) {
    return { statusCode: 401, body: JSON.stringify({ error: "لاگ ان درکار ہے" }) };
  }

  try {
    const rows = await fetchPayouts();
    const rowsFound = rows.length;
    const now = new Date();

    const withDays = rows
      .filter((r) => r.exDate)
      .map((r) => ({
        ...r,
        daysToExDate: Math.round((r.exDate.getTime() - now.getTime()) / 86400000),
      }))
      .filter((r) => r.daysToExDate >= -3) // drop stale/already-passed entries
      .sort((a, b) => a.daysToExDate - b.daysToExDate);

    const oneMonth = withDays.filter((r) => r.daysToExDate <= 30);
    const twoMonth = withDays.filter((r) => r.daysToExDate <= 60);
    const sixMonth = withDays.filter((r) => r.daysToExDate <= 180);

    // Cross-reference against this user's own portfolio so their holdings'
    // upcoming payouts are flagged separately.
    let portfolioSymbols = [];
    try {
      const store = portfolioStore();
      const data = await store.get(user.sub, { type: "json" });
      portfolioSymbols = (data?.holdings || []).map((h) => h.symbol.toUpperCase());
    } catch {
      // Portfolio lookup is a nice-to-have here; ignore failures.
    }

    const myHoldingsPayouts = withDays.filter((r) => portfolioSymbols.includes(r.symbol));

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        asOf: now.toISOString(),
        rowsFound,
        oneMonth,
        twoMonth,
        sixMonth,
        myHoldingsPayouts,
      }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: e.message }),
    };
  }
};
