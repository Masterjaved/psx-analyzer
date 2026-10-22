/**
 * SUPERSEDED in Phase 2 by transactions.js + positions.js, which store the
 * portfolio in Supabase (full transaction history, RLS) instead of one
 * "holdings" blob per user. Kept working (not deleted) as a fallback and
 * for reference — public/portfolio.html no longer calls this endpoint.
 */
const crypto = require("crypto");
const { portfolioStore } = require("./lib/blobStore");
const { json, getUser, parseJsonBody } = require("./lib/http");
const { validateHoldings } = require("./lib/validate");

exports.handler = async (event, context) => {
  const user = await getUser(event);
  if (!user) return json(401, { error: "پہلے لاگ ان کریں" });

  try {
    const store = portfolioStore();
    const key = user.id;

    if (event.httpMethod === "GET") {
      const data = await store.get(key, { type: "json" });
      if (!data) return json(200, { email: user.email, holdings: [], updatedAt: null });
      // Older saved holdings have no id yet — give them one so the page can
      // refer to a specific row (it is stored the next time the user saves).
      const holdings = (data.holdings || []).map((h) => (h && h.id ? h : { ...h, id: crypto.randomUUID() }));
      return json(200, { ...data, holdings });
    }

    if (event.httpMethod === "POST") {
      let body;
      try {
        body = parseJsonBody(event);
      } catch (e) {
        return json(e.code === "TOO_LARGE" ? 413 : 400, { error: e.code === "TOO_LARGE" ? "درخواست بہت بڑی ہے" : "غلط JSON" });
      }

      const checked = validateHoldings(body.holdings, () => crypto.randomUUID());
      if (!checked.ok) return json(400, { error: checked.error });

      // Two devices (phone + computer) can hold an older copy. If the client
      // says which version it started from and the stored one has moved on,
      // refuse instead of silently overwriting the newer data.
      const existing = await store.get(key, { type: "json" });
      if (body.baseUpdatedAt !== undefined && existing && (existing.updatedAt || null) !== (body.baseUpdatedAt || null)) {
        return json(409, {
          error: "کسی اور ڈیوائس پر پورٹ فولیو تبدیل ہو چکا ہے — تازہ ڈیٹا لوڈ کر لیا گیا ہے",
          current: existing,
        });
      }

      const record = {
        email: user.email,
        holdings: checked.holdings,
        updatedAt: new Date().toISOString(),
      };
      await store.setJSON(key, record);
      return json(200, record);
    }

    return json(405, { error: "Method not allowed" });
  } catch (e) {
    console.error("portfolio error:", e);
    return json(500, { error: "پورٹ فولیو محفوظ/لوڈ نہیں ہو سکا — دوبارہ کوشش کریں" });
  }
};
