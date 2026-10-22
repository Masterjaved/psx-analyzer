-- =====================================================================
-- PSX Analyzer — Phase 2 database schema (Supabase / PostgreSQL)
-- Run order: 001_initial_schema.sql → 002_rls_policies.sql → 003_indexes.sql
-- Nothing in the live app reads or writes these tables yet (Phase 1 keeps
-- Netlify Blobs + Netlify Identity working). See README_URDU.md.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Shared trigger: keep updated_at current
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- profiles — one row per Supabase Auth user
-- role can only be changed with the service-role key / SQL editor (see
-- 002_rls_policies.sql), never by the user themself.
-- ---------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null unique references auth.users (id) on delete cascade,
  full_name   text,
  email       text,
  role        text not null default 'user' check (role in ('user', 'admin')),
  status      text not null default 'active' check (status in ('active', 'disabled')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- portfolios — a user may have several (e.g. "Main", "Long term")
-- ---------------------------------------------------------------------
create table public.portfolios (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 80),
  description  text check (description is null or char_length(description) <= 500),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, name),
  -- lets transactions prove they belong to the SAME user as their portfolio
  unique (id, user_id)
);

-- ---------------------------------------------------------------------
-- portfolio_transactions — the full history; holdings, average cost and
-- realised/unrealised P/L are CALCULATED from these rows (a SELL never
-- deletes or edits the original BUY).
--   BUY / RIGHTS : quantity = shares bought, price = price per share
--   SELL         : quantity = shares sold,   price = sale price per share
--   DIVIDEND     : quantity = shares held,   price = cash dividend per share
--   BONUS / SPLIT: quantity = extra shares received, price = 0
-- ---------------------------------------------------------------------
create table public.portfolio_transactions (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  portfolio_id      uuid not null,
  symbol            text not null check (symbol ~ '^[A-Z0-9][A-Z0-9-]{0,14}$'),
  company_name      text,
  transaction_type  text not null
                    check (transaction_type in ('BUY', 'SELL', 'DIVIDEND', 'BONUS', 'RIGHTS', 'SPLIT')),
  quantity          numeric(18, 4) not null check (quantity > 0),
  price             numeric(18, 4) not null default 0 check (price >= 0),
  transaction_date  date not null,
  strategy          text check (strategy is null or strategy in ('SHORT_TERM', 'SWING', 'HOLD', 'LONG_TERM', 'WATCHLIST')),
  notes             text check (notes is null or char_length(notes) <= 500),
  created_at        timestamptz not null default now(),
  -- composite FK: the portfolio must belong to this same user
  foreign key (portfolio_id, user_id) references public.portfolios (id, user_id) on delete cascade
);

-- ---------------------------------------------------------------------
-- watchlists
-- ---------------------------------------------------------------------
create table public.watchlists (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  symbol        text not null check (symbol ~ '^[A-Z0-9][A-Z0-9-]{0,14}$'),
  company_name  text,
  notes         text check (notes is null or char_length(notes) <= 500),
  created_at    timestamptz not null default now(),
  unique (user_id, symbol)
);

-- ---------------------------------------------------------------------
-- alerts
-- ---------------------------------------------------------------------
create table public.alerts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  symbol        text not null check (symbol ~ '^[A-Z0-9][A-Z0-9-]{0,14}$'),
  alert_type    text not null check (alert_type in (
                  'PRICE_ABOVE', 'PRICE_BELOW', 'SUPPORT_BREAK', 'RESISTANCE_BREAK',
                  'TARGET_REACHED', 'LARGE_MOVE', 'UNUSUAL_VOLUME', 'ANNOUNCEMENT',
                  'DIVIDEND', 'FINANCIAL_RESULT', 'AI_STATUS_CHANGE', 'RISK_CHANGE')),
  target_value  numeric(18, 4),
  status        text not null default 'active' check (status in ('active', 'triggered', 'disabled')),
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- user_preferences — exactly one row per user
-- ---------------------------------------------------------------------
create table public.user_preferences (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null unique references auth.users (id) on delete cascade,
  currency          text not null default 'PKR',
  language          text not null default 'ur' check (language in ('ur', 'en')),
  risk_level        text not null default 'medium' check (risk_level in ('low', 'medium', 'high')),
  default_strategy  text check (default_strategy is null or default_strategy in ('SHORT_TERM', 'SWING', 'HOLD', 'LONG_TERM', 'WATCHLIST')),
  email_alerts      boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- ai_reports — history of AI analyses a user asked for
-- ---------------------------------------------------------------------
create table public.ai_reports (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  symbol       text not null check (symbol ~ '^[A-Z0-9][A-Z0-9-]{0,14}$'),
  report_type  text not null,
  provider     text,
  analysis     text not null,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- stock_notes — one private note per user per stock
-- ---------------------------------------------------------------------
create table public.stock_notes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  symbol      text not null check (symbol ~ '^[A-Z0-9][A-Z0-9-]{0,14}$'),
  notes       text not null check (char_length(notes) <= 5000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, symbol)
);

-- ---------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------
create trigger trg_profiles_updated_at         before update on public.profiles         for each row execute function public.set_updated_at();
create trigger trg_portfolios_updated_at       before update on public.portfolios       for each row execute function public.set_updated_at();
create trigger trg_user_preferences_updated_at before update on public.user_preferences for each row execute function public.set_updated_at();
create trigger trg_stock_notes_updated_at      before update on public.stock_notes      for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- New Supabase Auth user  →  profile + preferences + a default portfolio.
-- Always role = 'user'. Promote an admin manually (see README_URDU.md).
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', ''));

  insert into public.user_preferences (user_id) values (new.id);

  insert into public.portfolios (user_id, name) values (new.id, 'Main');

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
