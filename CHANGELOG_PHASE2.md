# Phase 2 — Supabase Auth + cloud portfolio (changes vs. Phase 1)

Netlify Identity + Netlify Blobs (per-user single "holdings" blob) is
replaced by Supabase (Auth + Postgres, RLS-protected). Every table read or
write uses the CALLER'S OWN access token — no Netlify Function in this app
ever uses the service-role key; an admin's read-everything access comes
entirely from the RLS policies in `supabase/migrations/002_rls_policies.sql`
(profiles/portfolios/portfolio_transactions only — never another user's
watchlist, alerts, notes, preferences or AI reports).

| Area | Files | What changed | Why |
|---|---|---|---|
| Login | `public/supabaseClient.js` (new), `public/auth.js` (rewritten) | Supabase Auth (email+password, invite-only — new sign-ups are off in the Supabase project). supabase-js handles session refresh itself, so the old manual token-refresh/retry code is gone. A real race was found and fixed here: `requireLogin()` could show a "loading" spinner *after* the auth listener had already rendered the real login form, freezing the page — fixed by never overwriting a gate that's already showing something real. | Netlify Identity is retired |
| Auth in Functions | `netlify/functions/lib/supabase.js` (new), `lib/http.js` (rewritten) | `getUser(event)`/`isAdmin(user)` are now async and verify the caller's token against Supabase Auth, then check `profiles.role`. Every existing function (`analyze`, `quotes`, `intraday`, `portfolio`, `admin-portfolios`, `debug-env`, `daily-alert-check`) was updated to `await` them. | One auth mechanism site-wide |
| Portfolio | `netlify/functions/transactions.js`, `positions.js` (new), `lib/positions.js` (new, pure), `lib/validate.js` (+`validateTransaction`/`validateWatchlistEntry`) | Full BUY/SELL/DIVIDEND/BONUS/RIGHTS/SPLIT transaction history (`portfolio_transactions` table) instead of one overwritable holdings blob. A SELL never edits or deletes the BUY rows — positions (qty, average cost, invested amount, realized P/L, dividends) are always recomputed fresh from the full history. `public/portfolio.html` rewritten around this. | Point 10 of the brief: keep full transaction history |
| Watchlist | `netlify/functions/watchlist.js` (new) | Cloud-synced, RLS-protected, unlimited entries. | Point 24 |
| Admin | `netlify/functions/admin-users.js` (new), `admin.html` updated | Shows every user's profile + computed positions, using the admin's own token (RLS grants the read). | Point 24 (old spec) — cloud-native replacement for the Blobs admin view |
| Old Blobs endpoints | `portfolio.js`, `admin-portfolios.js` | Kept working (not deleted), switched to the same Supabase auth, but no longer called by any page — `user.sub` (Netlify Identity) replaced with `user.id` (Supabase). Marked superseded in a comment. | "don't delete working code"; safe rollback reference |
| Tests | `tests/helpers/env.js` (`createFakeSupabaseBackend`), `transactions.test.js`, `positions.test.js`, `positions-function.test.js`, `watchlist.test.js`, `admin-users.test.js` (all new); `analyze/quotes/portfolio/admin/daily-alert.test.js` updated to the new auth fake | A small in-memory stand-in for Supabase Auth + PostgREST (GET/POST/DELETE, `eq.` filters, `order`, `limit`, `on_conflict` upsert) replaces the old Netlify-Identity-context mocking everywhere. | Existing suite had to move to the new auth model too |
| e2e | `tests/e2e/server.js`, `e2e.js` rewritten; `tests/e2e/supabase-shim.js` (new) | The browser now talks to Supabase via `@supabase/supabase-js`, loaded from a CDN — unavailable in this offline build environment, so a small hand-written shim (documented in the file) stands in for it, and both the browser and the Netlify Functions are routed to the SAME in-memory fake backend. 14/14 steps pass. Dropped: the token-expiry/refresh scenario and the invite/recovery email-link flow — both depend on real Supabase/supabase-js behaviour this shim doesn't reproduce. Also dropped the old "two devices, stale save is refused (409)" scenario — transactions are appended, never overwritten, so that conflict can't occur in the new model. | Supabase Auth's own client library isn't fetchable here |

## ⚠️ Honestly untested
Everything above was tested only against the fakes described. **None of
this has run against a real Supabase project, the real supabase-js
library, or real Supabase Auth** — I have no internet access in this
environment. In particular, completely unverified:
- The SQL in `supabase/migrations/001–003` (schema, RLS, indexes) — never run on a real Postgres.
- The exact request/response shape of real Supabase Auth's password grant, `/auth/v1/user`, and PostgREST's `on_conflict` upsert — the fakes are my best reading of Supabase's documented API, not a proven match.
- The invite email → "set your password" flow (`window.__authLinkType`, the `PASSWORD_RECOVERY` event) — logic is written and reviewed, but has no test coverage at all.
- Token refresh over a real expiring session.
- Loading `@supabase/supabase-js` from `cdn.jsdelivr.net` in an actual browser with internet.

The first real test will be on your live site. Please check, in order: log
in, add a BUY transaction, confirm the price/P&L look right, log in from a
second device with the same account, and open the admin view. Send me
whatever error or screenshot you get.

## Not done yet (Phases 3–6)
Candlestick chart, fundamentals, daily market scanner/summary, portfolio
AI status, extra alert types (price/support/resistance/target/volume/news),
stock comparison, risk dashboard, sector analysis, Shariah info, exports.
