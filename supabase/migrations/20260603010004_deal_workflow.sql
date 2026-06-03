-- ===========================================================================
-- Part 7 — deal workflow: status, activity log, documents.
-- Adds an ai_analysis jsonb column too, so the AI Underwriting tab can show the
-- full Claude output stored from the submit flow (ai_summary alone is just text).
-- Apply via `supabase db push` or the Supabase SQL editor (project zpzeylfiojsjuhhnujet).
-- ===========================================================================

-- status: pending | active | passed (default pending)
do $$ begin
  create type public.deal_status as enum ('pending', 'active', 'passed');
exception when duplicate_object then null; end $$;

alter table public.deals
  add column if not exists status public.deal_status not null default 'pending',
  add column if not exists ai_analysis jsonb;

-- activity log
create table if not exists public.deal_activity (
  id          uuid primary key default gen_random_uuid(),
  deal_id     uuid not null references public.deals (id) on delete cascade,
  action      text not null,
  note        text,
  created_by  uuid references public.users (id),
  created_at  timestamptz not null default now()
);
create index if not exists deal_activity_deal_id_idx
  on public.deal_activity (deal_id, created_at desc);

-- documents (file_url points at the deal-documents storage bucket)
create table if not exists public.deal_documents (
  id          uuid primary key default gen_random_uuid(),
  deal_id     uuid not null references public.deals (id) on delete cascade,
  file_name   text not null,
  file_url    text not null,
  file_type   text,
  uploaded_at timestamptz not null default now()
);
create index if not exists deal_documents_deal_id_idx
  on public.deal_documents (deal_id, uploaded_at desc);

-- RLS — mirrors the role model (owner/partner full access). Tighten for kp/viewer
-- later if those roles get dashboard access.
create or replace function public.is_owner_or_partner()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.role in ('owner', 'partner')
  );
$$;

alter table public.deal_activity enable row level security;
drop policy if exists deal_activity_rw on public.deal_activity;
create policy deal_activity_rw on public.deal_activity for all
  using (public.is_owner_or_partner()) with check (public.is_owner_or_partner());

alter table public.deal_documents enable row level security;
drop policy if exists deal_documents_rw on public.deal_documents;
create policy deal_documents_rw on public.deal_documents for all
  using (public.is_owner_or_partner()) with check (public.is_owner_or_partner());
