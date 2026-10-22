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
 * Who may run it:
 *  - Netlify's scheduler (its request body carries `next_run`), or
 *  - a logged-in admin calling it by hand (the admin page has buttons for
 *    this). Add ?dryRun=1 to see what WOULD be sent without sending any
 *    email or changing alert state.
 * Anyone else gets 403 — previously anybody who knew the URL could
 * trigger a full run.
 */
const { getStore } = require("@netlify/blobs");
const { portfolioStore } = require("./lib/blobStore");
const { fetchHistory, PSXDataError } = require("./lib/psxData");
const { computeSnapshot } = require("./lib/indicators");
const { sendEmail } = require("./lib/email");
const { json, getUser, isAdmin } = require("./lib/http");
const { escapeHtml } = require("./lib/html");
const { mapLimit } = require("./lib/pool");

function alertStateStore() {
  return getStore("alert-state");
}

const PROFIT_ALERT_PCT = parseFloat(process.env.PROFIT_ALERT_PCT || "10");
const MIN_DATA_POINTS = 30;

function isScheduledInvocation(event) {
  try {
    const body = JSON.parse(event.body || "{}");
    return Boolean(body && body.next_run);
  } catch {
    return false;
  }
}

exports.handler = async (event, context) => {
  const user = await getUser(event);
  const scheduled = isScheduledInvocation(event);
  if (!scheduled && !(user && (await isAdmin(user)))) {
    return json(403, { error: "یہ فنکشن صرف شیڈیولر یا ایڈمن چلا سکتا ہے" });
  }
  const dryRun = !scheduled && event.queryStringParameters?.dryRun === "1";

  const pStore = portfolioStore();
  const aStore = alertStateStore();

  const { blobs } = await pStore.list();
  let emailsSent = 0;
  const errors = [];
  const wouldSend = [];

  // One snapshot per symbol per run, shared by every user who owns it.
  const snapshotCache = new Map();
  function snapshotFor(symbol) {
    if (!snapshotCache.has(symbol)) {
      snapshotCache.set(
        symbol,
        (async () => {
          try {
            const history = await fetchHistory(symbol);
            if (history.length < MIN_DATA_POINTS) {
              errors.push(`${symbol}: ڈیٹا ناکافی (${history.length} دن)`);
              return null;
            }
            return computeSnapshot(history);
          } catch (e) {
            errors.push(`${symbol}: ${e instanceof PSXDataError ? e.message : e.message}`);
            return null;
          }
        })()
      );
    }
    return snapshotCache.get(symbol);
  }

  // Users are processed a few at a time; a failure for one user never
  // stops the others.
  await mapLimit(blobs, 3, async (b) => {
    try {
      const portfolio = await pStore.get(b.key, { type: "json" });
      if (!portfolio || !portfolio.email || !Array.isArray(portfolio.holdings) || portfolio.holdings.length === 0) {
        return;
      }

      const alerts = [];
      const stateUpdates = [];

      for (const h of portfolio.holdings) {
        const snapshot = await snapshotFor(h.symbol);
        if (!snapshot) continue;

        const profitPct = h.buyPrice ? Math.round(((snapshot.price - h.buyPrice) / h.buyPrice) * 1000) / 10 : 0;
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
          stateUpdates.push([stateKey, { alertType, date: new Date().toISOString() }]);
        } else if (!alertType && prevState.alertType) {
          // Condition cleared — reset so a future re-trigger can alert again.
          stateUpdates.push([stateKey, {}]);
        }
      }

      if (alerts.length === 0) {
        if (!dryRun) for (const [k, v] of stateUpdates) await aStore.setJSON(k, v);
        return;
      }

      if (dryRun) {
        wouldSend.push({ to: portfolio.email, alerts });
        return;
      }

      const rows = alerts
        .map((a) => {
          const line =
            a.alertType === "profit"
              ? `منافع <b>${escapeHtml(a.profitPct)}%</b> تک پہنچ گیا — بیچنے پر غور کریں`
              : `فروخت کا اشارہ — پوزیشن: ${escapeHtml(a.recommendation)}, رجحان: ${escapeHtml(a.trend)}`;
          return `<li><b>${escapeHtml(a.symbol)}</b> — ${line} (قیمت: ${escapeHtml(a.price)})</li>`;
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
        // Only remember the alert as "sent" once the email really went out,
        // so a failed email is retried on the next run instead of being lost.
        for (const [k, v] of stateUpdates) await aStore.setJSON(k, v);
      } catch (e) {
        errors.push(`email to ${portfolio.email}: ${e.message}`);
      }
    } catch (e) {
      errors.push(`user ${b.key}: ${e.message}`);
    }
  });

  return json(200, dryRun ? { dryRun: true, wouldSend, errors } : { emailsSent, errors });
};
