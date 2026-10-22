-- =====================================================================
-- Row Level Security
-- Rule of thumb: every user reads/writes ONLY their own rows.
-- Admins get READ-ONLY access to profiles, portfolios and transactions
-- (to support the admin view) — never to other users' notes, reports,
-- alerts, watchlists or preferences, and never write access.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Admin check. SECURITY DEFINER so it can read profiles without
-- tripping over profiles' own RLS (avoids infinite recursion).
-- ---------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid()
      and p.role = 'admin'
      and p.status = 'active'
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- ---------------------------------------------------------------------
-- Turn RLS on everywhere. With RLS on and no matching policy, access is
-- denied — so anything not explicitly allowed below is blocked.
-- ---------------------------------------------------------------------
alter table public.profiles                enable row level security;
alter table public.portfolios              enable row level security;
alter table public.portfolio_transactions  enable row level security;
alter table public.watchlists              enable row level security;
alter table public.alerts                  enable row level security;
alter table public.user_preferences        enable row level security;
alter table public.ai_reports              enable row level security;
alter table public.stock_notes             enable row level security;

-- Signed-out visitors (the "anon" role) get nothing at all.
revoke all on public.profiles                from anon;
revoke all on public.portfolios              from anon;
revoke all on public.portfolio_transactions  from anon;
revoke all on public.watchlists              from anon;
revoke all on public.alerts                  from anon;
revoke all on public.user_preferences        from anon;
revoke all on public.ai_reports              from anon;
revoke all on public.stock_notes             from anon;

-- ---------------------------------------------------------------------
-- profiles
--   read:   own row, or any row if admin
--   update: own row, and ONLY the full_name column (role/status/email
--           can't be self-edited; admins change role/status with the
--           service-role key from a server-side function or SQL editor)
--   insert/delete: not allowed for users (the signup trigger creates the
--           row; deleting the auth user cascades)
-- ---------------------------------------------------------------------
revoke insert, update, delete on public.profiles from authenticated;
grant update (full_name) on public.profiles to authenticated;

create policy profiles_select_own on public.profiles
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy profiles_select_admin on public.profiles
  for select to authenticated
  using ((select public.is_admin()));

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------
-- Own-rows-only tables (full read/write for the owner)
-- ---------------------------------------------------------------------
create policy portfolios_own on public.portfolios
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy portfolio_transactions_own on public.portfolio_transactions
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy watchlists_own on public.watchlists
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy alerts_own on public.alerts
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy user_preferences_own on public.user_preferences
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy ai_reports_own on public.ai_reports
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy stock_notes_own on public.stock_notes
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------
-- Admin: READ-ONLY view of portfolios and transactions
-- ---------------------------------------------------------------------
create policy portfolios_select_admin on public.portfolios
  for select to authenticated
  using ((select public.is_admin()));

create policy portfolio_transactions_select_admin on public.portfolio_transactions
  for select to authenticated
  using ((select public.is_admin()));
