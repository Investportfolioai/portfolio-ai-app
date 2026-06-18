-- Backfill lending checklist items for deals already in escrow that were never seeded.
-- LOI and Purchase Contract items are pre-marked complete (they were done to reach escrow).
INSERT INTO public.lending_checklist_items (deal_id, stage, position, item_text, completed, completed_at)
SELECT
  d.id,
  t.stage,
  t.position,
  t.item_text,
  (t.stage IN ('loi', 'purchase_contract')),
  CASE WHEN t.stage IN ('loi', 'purchase_contract') THEN now() ELSE NULL END
FROM public.deals d
CROSS JOIN public.lending_checklist_templates t
WHERE d.escrow_date IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.lending_checklist_items lci WHERE lci.deal_id = d.id
  );

-- Backfill lender readiness docs for deals already in escrow that were never seeded.
-- Asset class is derived from the ai_analysis JSONB; defaults to 'residential' when absent.
INSERT INTO public.lender_readiness_docs (deal_id, doc_name, asset_class, position)
SELECT
  d.id,
  t.doc_name,
  t.asset_class,
  t.position
FROM public.deals d
CROSS JOIN public.lender_readiness_templates t
WHERE d.escrow_date IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.lender_readiness_docs lrd WHERE lrd.deal_id = d.id
  )
  AND t.asset_class = (
    CASE
      WHEN lower(d.ai_analysis->'extracted_deal_data'->>'property_type') = 'commercial'
        THEN 'commercial'
      ELSE 'residential'
    END
  );
