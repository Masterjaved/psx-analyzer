/**
 * Cloud watchlist (Supabase, RLS-protected — own rows only).
 * GET /api/watchlist            → list
 * POST /api/watchlist { symbol, company_name?, notes? } → upsert-by-symbol
 * DELETE /api/watchlist?symbol=OGDC → remove
 */
const { json, getUser, parseJsonBody } = require("./lib/http");
const { restGet, restUpsert, restDelete, SupabaseError } = require("./lib/supabase");
const { validateWatchlistEntry, normalizeSymbol } = require("./lib/validate");

exports.handler = async (event) => {
  const user = await getUser(event);
  if (!user) return json(401, { error: "پہلے لاگ ان کریں" });

  try {
    if (event.httpMethod === "GET") {
      const rows = await restGet(user.token, "watchlists", "select=*&order=created_at.desc");
      return json(200, rows);
    }

    if (event.httpMethod === "POST") {
      let body;
      try {
        body = parseJsonBody(event);
      } catch (e) {
        return json(e.code === "TOO_LARGE" ? 413 : 400, { error: e.code === "TOO_LARGE" ? "درخواست بہت بڑی ہے" : "غلط JSON" });
      }
      const checked = validateWatchlistEntry(body);
      if (!checked.ok) return json(400, { error: checked.error });

      checked.row.user_id = user.id;
      // unique(user_id, symbol) — upsert so re-adding an existing symbol
      // just updates notes/company instead of erroring.
      const inserted = await restUpsert(user.token, "watchlists", checked.row, "user_id,symbol");
      return json(200, inserted[0]);
    }

    if (event.httpMethod === "DELETE") {
      const symbol = normalizeSymbol(event.queryStringParameters?.symbol || "");
      if (!symbol) return json(400, { error: "درست سٹاک کوڈ درکار ہے" });
      const deleted = await restDelete(user.token, "watchlists", `symbol=eq.${symbol}`);
      if (!deleted.length) return json(404, { error: "واچ لسٹ میں نہیں ملا" });
      return json(200, { deleted: true });
    }

    return json(405, { error: "Method not allowed" });
  } catch (e) {
    console.error("watchlist error:", e);
    const status = e instanceof SupabaseError ? e.status : 500;
    return json(status, { error: e.message || "خرابی — دوبارہ کوشش کریں" });
  }
};
