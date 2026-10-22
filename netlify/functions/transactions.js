/**
 * Cloud portfolio transactions (Supabase, RLS-protected — every request
 * uses the caller's OWN access token, never a service-role key, so a user
 * can only ever see/change their own rows no matter what this code does).
 *
 * GET    /api/transactions                 → { portfolio, transactions }
 * POST   /api/transactions   { ...fields } → the inserted row
 * DELETE /api/transactions?id=<uuid>       → { deleted: true }
 */
const { json, getUser, parseJsonBody } = require("./lib/http");
const { restGet, restPost, restDelete, SupabaseError } = require("./lib/supabase");
const { validateTransaction } = require("./lib/validate");

const MAX_LIST = 1000;

/** Every user gets a "Main" portfolio automatically (see migration 001's
 * handle_new_user trigger). Falls back to creating one if it is somehow
 * missing (e.g. a user created before the trigger existed). */
async function getOrCreateMainPortfolio(token) {
  const existing = await restGet(token, "portfolios", "select=id,name&order=created_at.asc&limit=1");
  if (existing.length) return existing[0];
  const created = await restPost(token, "portfolios", { name: "Main" });
  return created[0];
}

exports.handler = async (event) => {
  const user = await getUser(event);
  if (!user) return json(401, { error: "پہلے لاگ ان کریں" });

  try {
    if (event.httpMethod === "GET") {
      const portfolio = await getOrCreateMainPortfolio(user.token);
      const transactions = await restGet(
        user.token,
        "portfolio_transactions",
        `select=*&portfolio_id=eq.${portfolio.id}&order=transaction_date.desc,created_at.desc&limit=${MAX_LIST}`
      );
      return json(200, { portfolio, transactions });
    }

    if (event.httpMethod === "POST") {
      let body;
      try {
        body = parseJsonBody(event);
      } catch (e) {
        return json(e.code === "TOO_LARGE" ? 413 : 400, { error: e.code === "TOO_LARGE" ? "درخواست بہت بڑی ہے" : "غلط JSON" });
      }

      const checked = validateTransaction(body);
      if (!checked.ok) return json(400, { error: checked.error });

      if (!checked.row.portfolio_id) {
        const portfolio = await getOrCreateMainPortfolio(user.token);
        checked.row.portfolio_id = portfolio.id;
      }
      checked.row.user_id = user.id;

      const inserted = await restPost(user.token, "portfolio_transactions", checked.row);
      return json(200, inserted[0]);
    }

    if (event.httpMethod === "DELETE") {
      const id = event.queryStringParameters?.id;
      if (!id || typeof id !== "string" || id.length > 64) return json(400, { error: "id درکار ہے" });
      const deleted = await restDelete(user.token, "portfolio_transactions", `id=eq.${id}`);
      if (!deleted.length) return json(404, { error: "transaction نہیں ملی" });
      return json(200, { deleted: true });
    }

    return json(405, { error: "Method not allowed" });
  } catch (e) {
    console.error("transactions error:", e);
    const status = e instanceof SupabaseError ? e.status : 500;
    return json(status, { error: e.message || "خرابی — دوبارہ کوشش کریں" });
  }
};
