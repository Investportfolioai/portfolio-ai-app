-- KP assignment flow + KP-owned real estate (SREO).
-- Apply in the Supabase SQL editor (DDL can't be run from the app).

-- deal_kps: assignment response status + a stable id for email response links.
alter table public.deal_kps add column if not exists id uuid not null default gen_random_uuid();
alter table public.deal_kps add column if not exists status text not null default 'pending'
  check (status in ('pending','accepted','declined'));
alter table public.deal_kps add column if not exists responded_at timestamptz;
alter table public.deal_kps add column if not exists assigned_at timestamptz not null default now();
create unique index if not exists deal_kps_id_key on public.deal_kps(id);

-- kp_sreo: external real estate owned by a KP.
create table if not exists public.kp_sreo (
  id uuid primary key default gen_random_uuid(),
  kp_id uuid not null references public.users(id) on delete cascade,
  property_name text not null,
  property_type text,
  address text,
  value numeric,
  mortgage_balance numeric,
  monthly_payment numeric,
  created_at timestamptz not null default now()
);
create index if not exists kp_sreo_kp_id_idx on public.kp_sreo(kp_id);

alter table public.kp_sreo enable row level security;
drop policy if exists kp_sreo_owner on public.kp_sreo;
create policy kp_sreo_owner on public.kp_sreo for all
  using (kp_id = auth.uid() or public.is_owner_or_partner())
  with check (kp_id = auth.uid() or public.is_owner_or_partner());
