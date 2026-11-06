/**
 * Runs automatically once per trading day (see schedule in netlify.toml)
 * and checks every user's portfolio holdings. Sends an email when:
 *  - a holding's profit reaches PROFIT_ALERT_PCT (default 10%), or
 *  - a holding's trend turns to Downtrend or its recommendation becomes
 *    "Don't buy" (a possible sell signal).
 *
 * To avoid repeat emails every day for the same condition, the last
 * alert state per (user, symbol) is remembered in a separate Blobs
 * store ("alert-state") and only re-fires once the condition changes.
 *
 * You can also test this manually by visiting its URL directly in a
 * browser (e.g. https://your-site.netlify.app/.netlify/functions/daily-alert-check)
 * — it isn't restricted to only running on the schedule.
 */
const { initBlobs, portfolioStore, alertStateStore } = require("./lib/blobStore");
const { fetchHistory, PSXDataError } = require("./lib/psxData");
const { computeSnapshot } = require("./lib/indicators");
const { sendEmail } = require("./lib/email");
const { fetchPayouts } = require("./lib/psxPayouts");

const DIVIDEND_ALERT_DAYS = 7; // flag payouts whose Ex Date is this close

const PROFIT_ALERT_PCT = parseFloat(process.env.PROFIT_ALERT_PCT || "10");

exports.handler = async (event) => {
  initBlobs(event);
  const pStore = portfolioStore();
  const aStore = alertStateStore();

  const { blobs } = await pStore.list();
  let emailsSent = 0;
  const errors = [];

  // Fetched once per run and reused for every user's portfolio below,
  // rather than re-fetching PSX's payouts page per user.
  let payoutsBySymbol = {};
  try {
    const now = new Date();
    const rows = await fetchPayouts();
    for (const r of rows) {
      if (!r.exDate) continue;
      const daysToExDate = Math.round((r.exDate.getTime() - now.getTime()) / 86400000);
      if (daysToExDate >= 0 && daysToExDate <= DIVIDEND_ALERT_DAYS) {
        payoutsBySymbol[r.symbol] = { ...r, daysToExDate };
      }
    }
  } catch (e) {
    errors.push(`payouts: ${e.message}`);
  }

  for (const b of blobs) {
    const portfolio = await pStore.get(b.key, { type: "json" });
    if (!portfolio || !portfolio.email || !Array.isArray(portfolio.holdings) || portfolio.holdings.length === 0) {
      continue;
    }

    const alerts = [];

    for (const h of portfolio.holdings) {
      let snapshot;
      try {
        const history = await fetchHistory(h.symbol);
        snapshot = computeSnapshot(history);
      } catch (e) {
        if (e instanceof PSXDataError) errors.push(`${h.symbol}: ${e.message}`);
        continue;
      }

      const profitPct = h.buyPrice ? Math.round((((snapshot.price - h.buyPrice) / h.buyPrice) * 1000)) / 10 : 0;
      const stateKey = `${b.key}:${h.symbol}`;
      const prevState = (await aStore.get(stateKey, { type: "json" })) || {};

      let alertType = null;
      if (profitPct >= PROFIT_ALERT_PCT) {
        alertType = "profit";
      } else if (snapshot.trendEn === "Downtrend" || snapshot.recommendationEn === "Don't buy") {
        alertType = "sell";
      }

      if (alertType && prevState.alertType !== alertType) {
        alerts.push({
          symbol: h.symbol,
          alertType,
          profitPct,
          price: snapshot.price,
          trend: snapshot.trend,
          recommendation: snapshot.recommendation,
        });
        await aStore.setJSON(stateKey, { alertType, date: new Date().toISOString() });
      } else if (!alertType && prevState.alertType) {
        // Condition cleared — reset so a future re-trigger can alert again.
        await aStore.setJSON(stateKey, {});
      }

      // Dividend/bonus/right ex-date alert — separate from the
      // profit/trend alertType above, so it fires alongside them.
      const payout = payoutsBySymbol[h.symbol];
      if (payout) {
        const divStateKey = `${b.key}:${h.symbol}:div:${payout.exDateText}`;
        const divAlreadySent = await aStore.get(divStateKey, { type: "json" });
        if (!divAlreadySent) {
          alerts.push({
            symbol: h.symbol,
            alertType: "dividend",
            exDateText: payout.exDateText,
            daysToExDate: payout.daysToExDate,
            dividend: payout.dividend,
            bonus: payout.bonus,
            right: payout.right,
          });
          await aStore.setJSON(divStateKey, { sent: true, date: new Date().toISOString() });
        }
      }
    }

    if (alerts.length > 0) {
      const rows = alerts
        .map((a) => {
          let line;
          if (a.alertType === "profit") {
            line = `منافع <b>${a.profitPct}%</b> تک پہنچ گیا — بیچنے پر غور کریں (قیمت: ${a.price})`;
          } else if (a.alertType === "dividend") {
            const parts = [a.dividend, a.bonus, a.right].filter((x) => x && x !== "-").join(" / ");
            line = `Ex Date قریب آ رہی ہے (${a.daysToExDate} دن باقی، ${a.exDateText}) — ${parts || "Payout اعلان ہوا"}`;
          } else {
            line = `فروخت کا اشارہ — پوزیشن: ${a.recommendation}, رجحان: ${a.trend} (قیمت: ${a.price})`;
          }
          return `<li><b>${a.symbol}</b> — ${line}</li>`;
        })
        .join("");

      try {
        await sendEmail(
          portfolio.email,
          "🔔 PSX پورٹ فولیو الرٹ",
          `<div dir="rtl" style="font-family:sans-serif;">
             <p>آپ کے پورٹ فولیو میں یہ تبدیلیاں آئی ہیں:</p>
             <ul>${rows}</ul>
             <p style="color:#666;font-size:12px;">⚠️ یہ AI تجزیہ صرف تکنیکی اشاروں پر مبنی ہے، سرمایہ کاری کی گارنٹی نہیں۔ حتمی فیصلہ آپ کا اپنا ہے۔</p>
           </div>`
        );
        emailsSent++;
      } catch (e) {
        errors.push(`email to ${portfolio.email}: ${e.message}`);
      }
    }
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ emailsSent, errors }),
  };
};
