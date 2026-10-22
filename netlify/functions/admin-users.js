/**
 * Admin, cloud (Supabase) users: profiles + computed positions per user.
 * Uses the ADMIN'S OWN token — no service-role key involved. This works
 * because migration 002's RLS policies give an admin READ-ONLY access to
 * every row of profiles/portfolios/portfolio_transactions (never other
 * users' watchlists, alerts, notes, preferences or AI reports).
 */
const { json, getUser, isAdmin } = require("./lib/http");
const { restGet, SupabaseError } = require("./lib/supabase");
const { computePositions, splitOpenClosed } = require("./lib/positions");

exports.handler = async (event) => {
  const user = await getUser(event);
  if (!user || !(await isAdmin(user))) {
    return json(403, { error: "یہ صفحہ صرف ایڈمن کے لیے ہے" });
  }

  try {
    const [profiles, portfolios, transactions] = await Promise.all([
      restGet(user.token, "profiles", "select=user_id,email,full_name,role,status,created_at"),
      restGet(user.token, "portfolios", "select=id,user_id,name"),
      restGet(user.token, "portfolio_transactions", "select=*&limit=5000"),
    ]);

    const txByPortfolio = new Map();
    for (const t of transactions) {
      if (!txByPortfolio.has(t.portfolio_id)) txByPortfolio.set(t.portfolio_id, []);
      txByPortfolio.get(t.portfolio_id).push(t);
    }

    const result = profiles.map((p) => {
      const userPortfolios = portfolios.filter((pf) => pf.user_id === p.user_id);
      const allTx = userPortfolios.flatMap((pf) => txByPortfolio.get(pf.id) || []);
      const { open, closed } = splitOpenClosed(computePositions(allTx));
      return {
        userId: p.user_id,
        email: p.email,
        fullName: p.full_name,
        role: p.role,
        status: p.status,
        createdAt: p.created_at,
        openPositions: open,
        closedPositions: closed,
      };
    });

    return json(200, result);
  } catch (e) {
    console.error("admin-users error:", e);
    const status = e instanceof SupabaseError ? e.status : 500;
    return json(status, { error: e.message || "ڈیٹا لوڈ نہیں ہو سکا" });
  }
};
