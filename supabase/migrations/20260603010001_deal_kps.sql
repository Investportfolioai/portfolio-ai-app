-- ===========================================================================
-- deal_kps — many-to-many link between deals and their Key Principals (KPs).
--
-- A deal can have multiple KPs attached; a KP can be on multiple deals. This
-- powers the "KP count" on the pipeline cards and the KP list in the detail
-- panel. Apply via the Supabase SQL editor or `supabase db push`.
--
-- NOTE: the RLS policies below assume `public.users.id` equals the Supabase
-- Auth `auth.uid()` (the standard Supabase pattern). If your existing `deals`
-- policies key off something else (e.g. email), align these to match before
-- relying on them.
-- ===========================================================================

create table if not exists public.deal_kps (
  deal_id    uuid not null references public.deals (id) on delete cascade,
  kp_id      uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (deal_id, kp_id)
);

create index if not exists deal_kps_deal_id_idx on public.deal_kps (deal_id);
create index if not exists deal_kps_kp_id_idx   on public.deal_kps (kp_id);

alter table public.deal_kps enable row level security;

-- Helper: is the current user an owner or partner (full access)?
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

-- owner/partner: full control over all KP links.
drop policy if exists deal_kps_admin_all on public.deal_kps;
create policy deal_kps_admin_all on public.deal_kps
  for all
  using (public.is_owner_or_partner())
  with check (public.is_owner_or_partner());

-- kp / viewer: may read links where they are the attached principal.
drop policy if exists deal_kps_self_select on public.deal_kps;
create policy deal_kps_self_select on public.deal_kps
  for select
  using (kp_id = auth.uid());
