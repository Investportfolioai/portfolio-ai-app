-- Add stage_override to deals: nullable text, constrained to the 7 lending stages.
ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS stage_override text
    CHECK (stage_override IN (
      'loi', 'purchase_contract', 'emd_setup', 'lender_submission',
      'appraisal_insurance', 'clear_to_close', 'closed'
    ));
