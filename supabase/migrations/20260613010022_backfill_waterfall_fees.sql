-- Backfill cashback_at_close, credit_partner_fee, portfolio_ai_fee for all
-- non-closed deals using the exact formula in src/lib/waterfall.ts.
--
-- Formula reference (waterfall.ts):
--   dscrLoan          = purchase_price * ltv_percent / 100
--   fundingGap        = purchase_price - dscrLoan
--   tlFee             = fundingGap * 0.035            ← fee on the GAP, not the loan
--   closingCosts      = purchase_price * 0.025
--   prepaidInsurance  = COALESCE(insurance_annual, purchase_price * 0.006)
--   prepaidTaxes      = COALESCE(taxes_annual,     purchase_price * 0.012)
--   dpts              = purchase_price - COALESCE(seller_note_amount, 0)
--   preCreditPartner  = dscrLoan - tlFee - closingCosts - prepaidInsurance
--                       - prepaidTaxes - dpts - assignmentFee - realtorCommission
--                       - tc_fee - attorney_fee - pm_fee
--   creditPartnerFee  = GREATEST(preCreditPartner, 0) * 0.05
--   netToBuyer        = GREATEST(preCreditPartner, 0) * 0.95
--   portfolioAIFee    = netToBuyer * 0.10

UPDATE deals
SET
  credit_partner_fee = GREATEST(
    (purchase_price * COALESCE(ltv_percent, 75) / 100)
    - ((purchase_price - purchase_price * COALESCE(ltv_percent, 75) / 100) * 0.035)
    - (purchase_price * 0.025)
    - COALESCE(insurance_annual, purchase_price * 0.006)
    - COALESCE(taxes_annual,     purchase_price * 0.012)
    - (purchase_price - COALESCE(seller_note_amount, 0))
    - COALESCE(assignment_fee,     0)
    - COALESCE(realtor_commission, 0)
    - COALESCE(tc_fee,             0)
    - COALESCE(attorney_fee,       0)
    - COALESCE(pm_fee,             0)
  , 0) * 0.05,

  cashback_at_close = GREATEST(
    (purchase_price * COALESCE(ltv_percent, 75) / 100)
    - ((purchase_price - purchase_price * COALESCE(ltv_percent, 75) / 100) * 0.035)
    - (purchase_price * 0.025)
    - COALESCE(insurance_annual, purchase_price * 0.006)
    - COALESCE(taxes_annual,     purchase_price * 0.012)
    - (purchase_price - COALESCE(seller_note_amount, 0))
    - COALESCE(assignment_fee,     0)
    - COALESCE(realtor_commission, 0)
    - COALESCE(tc_fee,             0)
    - COALESCE(attorney_fee,       0)
    - COALESCE(pm_fee,             0)
  , 0) * 0.95,

  portfolio_ai_fee = GREATEST(
    (purchase_price * COALESCE(ltv_percent, 75) / 100)
    - ((purchase_price - purchase_price * COALESCE(ltv_percent, 75) / 100) * 0.035)
    - (purchase_price * 0.025)
    - COALESCE(insurance_annual, purchase_price * 0.006)
    - COALESCE(taxes_annual,     purchase_price * 0.012)
    - (purchase_price - COALESCE(seller_note_amount, 0))
    - COALESCE(assignment_fee,     0)
    - COALESCE(realtor_commission, 0)
    - COALESCE(tc_fee,             0)
    - COALESCE(attorney_fee,       0)
    - COALESCE(pm_fee,             0)
  , 0) * 0.95 * 0.10

WHERE status != 'closed'
  AND purchase_price IS NOT NULL;
