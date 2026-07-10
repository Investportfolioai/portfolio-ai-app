-- ===========================================================================
-- Manager role — deal-side access (Option B).
--
-- Adds is_deal_manager() = owner | partner | manager, and repoints every
-- DEAL-SIDE RLS policy to it so managers get full deal read/write parity with
-- owner/partner. USER/ACCESS-ADMIN surfaces stay on is_owner_or_partner()
-- (managers cannot invite people, edit user records, manage the lender
-- directory, or grant TC tab access). Portfolio policies are untouched
-- (holdings/holding_* remain owner/partner, matching canManagePortfolio).
--
-- Apply in the Supabase SQL editor (project ref zpzeylfiojsjuhhnujet).
-- ===========================================================================

-- Helper: owner/partner/manager. SECURITY DEFINER + fixed search_path so it
-- can read users without tripping the users RLS policy (same pattern as
-- is_owner_or_partner()).
create or replace function public.is_deal_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.role in ('owner', 'partner', 'manager')
  );
$$;

-- ---------------------------------------------------------------------------
-- users — managers may read the team (needed to resolve KP/co-owner names in
-- the dashboard, which reads via the session client). Writing user records
-- stays owner/partner (users_admin_write is left unchanged).
-- ---------------------------------------------------------------------------
drop policy if exists users_select on public.users;
create policy users_select on public.users
  for select
  using (id = auth.uid() or public.is_deal_manager());

-- ---------------------------------------------------------------------------
-- deals — read (owner/partner/manager, plus each deal's own owner/coowner/KP/TC)
-- and full write for owner/partner/manager.
-- ---------------------------------------------------------------------------
drop policy if exists deals_select on public.deals;
create policy deals_select on public.deals
  for select
  using (
    public.is_deal_manager()
    or owner_id = auth.uid()
    or coowner_id = auth.uid()
    or exists (
      select 1 from public.deal_kps k
      where k.deal_id = deals.id and k.kp_id = auth.uid()
    )
    or exists (
      select 1 from public.deal_tcs t
      where t.deal_id = deals.id and t.tc_id = auth.uid()
    )
  );

drop policy if exists deals_admin_write on public.deals;
create policy deals_admin_write on public.deals
  for all
  using (public.is_deal_manager())
  with check (public.is_deal_manager());

-- ---------------------------------------------------------------------------
-- deal composition — assigning EXISTING people to deals (not inviting).
-- ---------------------------------------------------------------------------
drop policy if exists deal_kps_admin_all on public.deal_kps;
create policy deal_kps_admin_all on public.deal_kps
  for all
  using (public.is_deal_manager())
  with check (public.is_deal_manager());

drop policy if exists deal_tcs_admin on public.deal_tcs;
create policy deal_tcs_admin on public.deal_tcs
  for all
  using (public.is_deal_manager())
  with check (public.is_deal_manager());

-- ---------------------------------------------------------------------------
-- deal workflow data
-- ---------------------------------------------------------------------------
drop policy if exists deal_activity_rw on public.deal_activity;
create policy deal_activity_rw on public.deal_activity for all
  using (public.is_deal_manager()) with check (public.is_deal_manager());

drop policy if exists deal_documents_rw on public.deal_documents;
create policy deal_documents_rw on public.deal_documents for all
  using (public.is_deal_manager()) with check (public.is_deal_manager());

drop policy if exists milestones_admin_rw on public.deal_milestones;
create policy milestones_admin_rw on public.deal_milestones
  for all
  using (public.is_deal_manager())
  with check (public.is_deal_manager());

-- KP schedule of real estate owned — managers review KP financials on deals.
drop policy if exists kp_sreo_owner on public.kp_sreo;
create policy kp_sreo_owner on public.kp_sreo for all
  using (kp_id = auth.uid() or public.is_deal_manager())
  with check (kp_id = auth.uid() or public.is_deal_manager());

-- ---------------------------------------------------------------------------
-- lending data (deal-scoped)
-- ---------------------------------------------------------------------------
drop policy if exists lending_checklist_admin on public.lending_checklist_items;
create policy lending_checklist_admin on public.lending_checklist_items
  for all
  using (public.is_deal_manager())
  with check (public.is_deal_manager());

drop policy if exists lender_readiness_docs_admin on public.lender_readiness_docs;
create policy lender_readiness_docs_admin on public.lender_readiness_docs
  for all
  using (public.is_deal_manager())
  with check (public.is_deal_manager());

drop policy if exists addendum_drafts_admin on public.addendum_drafts;
create policy addendum_drafts_admin on public.addendum_drafts
  for all
  using (public.is_deal_manager())
  with check (public.is_deal_manager());

-- Lender reference library — managers curate deal reference material.
drop policy if exists lender_ref_folders_admin on public.lender_ref_folders;
create policy lender_ref_folders_admin on public.lender_ref_folders
  for all
  using (public.is_deal_manager())
  with check (public.is_deal_manager());

drop policy if exists lender_reference_docs_admin on public.lender_reference_docs;
create policy lender_reference_docs_admin on public.lender_reference_docs
  for all
  using (
    exists (
      select 1 from public.lender_ref_folders f
      where f.id = lender_reference_docs.folder_id and public.is_deal_manager()
    )
  )
  with check (
    exists (
      select 1 from public.lender_ref_folders f
      where f.id = lender_reference_docs.folder_id and public.is_deal_manager()
    )
  );

-- ---------------------------------------------------------------------------
-- WhatsApp messages (matched to deals, surfaced in the Lending view)
-- ---------------------------------------------------------------------------
drop policy if exists whatsapp_messages_admin on public.whatsapp_messages;
create policy whatsapp_messages_admin on public.whatsapp_messages
  for all
  using (public.is_deal_manager())
  with check (public.is_deal_manager());

-- ---------------------------------------------------------------------------
-- kp-documents storage bucket — managers manage deal-related KP uploads.
-- ---------------------------------------------------------------------------
drop policy if exists "owner_partner_manage_kp_docs" on storage.objects;
create policy "owner_partner_manage_kp_docs" on storage.objects
  for all to authenticated
  using (
    bucket_id = 'kp-documents'
    and public.is_deal_manager()
  )
  with check (
    bucket_id = 'kp-documents'
    and public.is_deal_manager()
  );

-- ===========================================================================
-- Deliberately NOT changed (remain owner/partner via is_owner_or_partner):
--   users_admin_write, lenders_admin_write, lenders_select write,
--   tc_tab_grants_admin, and the invite/createLender server-action gates.
-- Portfolio policies (holdings, holding_documents, holding_snapshots,
--   holding_financials) remain owner/partner (match canManagePortfolio).
-- ===========================================================================
