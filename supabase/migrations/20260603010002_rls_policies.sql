-- ===========================================================================
-- RLS read/write policies for deals + users.
--
-- The tables have RLS enabled but shipped with NO permissive policies, so every
-- authenticated read returns empty. This migration grants access per the role
-- model:
--   owner / partner -> full access to all deals + users
--   kp              -> read deals they own/co-own or are attached to (deal_kps)
--   viewer          -> read deals they are assigned to (owner/co-owner/attached)
--   everyone        -> read their own users row
--
-- Apply AFTER 20260603010001_deal_kps.sql (deals_select references deal_kps),
-- via `supabase db push`. Assumes public.users.id = auth.uid().
-- ===========================================================================

-- is_owner_or_partner() is defined in 0001; redefine here so this file is
-- self-sufficient if applied standalone. SECURITY DEFINER bypasses RLS, which
-- also prevents the users policy below from recursing into itself.
create or replace function public.is_owner_or_partner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.role in ('owner', 'partner')
  );
$$;

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
alter table public.users enable row level security;

drop policy if exists users_select on public.users;
create policy users_select on public.users
  for select
  using (id = auth.uid() or public.is_owner_or_partner());

drop policy if exists users_admin_write on public.users;
create policy users_admin_write on public.users
  for all
  using (public.is_owner_or_partner())
  with check (public.is_owner_or_partner());

-- ---------------------------------------------------------------------------
-- deals
-- ---------------------------------------------------------------------------
alter table public.deals enable row level security;

drop policy if exists deals_select on public.deals;
create policy deals_select on public.deals
  for select
  using (
    public.is_owner_or_partner()
    or owner_id = auth.uid()
    or coowner_id = auth.uid()
    or exists (
      select 1 from public.deal_kps k
      where k.deal_id = deals.id and k.kp_id = auth.uid()
    )
  );

drop policy if exists deals_admin_write on public.deals;
create policy deals_admin_write on public.deals
  for all
  using (public.is_owner_or_partner())
  with check (public.is_owner_or_partner());
