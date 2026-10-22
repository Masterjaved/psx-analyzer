-- =====================================================================
-- Indexes for the queries the app will run most.
-- (UNIQUE constraints in 001 already created indexes for profiles.user_id,
--  portfolios (user_id,name), watchlists (user_id,symbol),
--  user_preferences.user_id and stock_notes (user_id,symbol).)
-- =====================================================================

-- "all my portfolios"
create index if not exists idx_portfolios_user
  on public.portfolios (user_id);

-- load one portfolio's history, newest first / per stock
create index if not exists idx_transactions_portfolio_date
  on public.portfolio_transactions (portfolio_id, transaction_date desc);

create index if not exists idx_transactions_user_symbol
  on public.portfolio_transactions (user_id, symbol);

-- alert checks: "active alerts for a user" and "active alerts for a symbol"
create index if not exists idx_alerts_user_status
  on public.alerts (user_id, status);

create index if not exists idx_alerts_symbol_active
  on public.alerts (symbol)
  where status = 'active';

-- AI report history per user / per stock, newest first
create index if not exists idx_ai_reports_user_symbol_created
  on public.ai_reports (user_id, symbol, created_at desc);

-- admin lookups
create index if not exists idx_profiles_admins
  on public.profiles (user_id)
  where role = 'admin';
