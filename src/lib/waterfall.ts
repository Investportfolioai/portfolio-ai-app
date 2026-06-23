import type { WaterfallInput, WaterfallResult, CashflowInput, CashflowResult } from "./types";

export function calculateMorbyWaterfall(input: WaterfallInput): WaterfallResult {
  const contractPrice = input.purchase_price;
  const ltv = (input.ltv_percent ?? 75) / 100;
  const dscrLoan = contractPrice * ltv;
  const fundingGap = contractPrice - dscrLoan; // TL funds this as a pass-through; only the fee is a real cost
  const tlFee = fundingGap * 0.035;

  const closingCosts = contractPrice * 0.025;
  const prepaidInsurance = input.insurance_annual ?? contractPrice * 0.006;
  const prepaidTaxes = input.taxes_annual ?? contractPrice * 0.012;
  const realtorCommission = input.realtor_commission ?? 0;
  const sellerNoteBalance = input.seller_note_amount ?? 0;
  const dpts = input.dpts_override != null ? input.dpts_override : contractPrice - sellerNoteBalance;
  const assignmentFee = input.assignment_fee ?? 0;

  const tcFee = input.tc_fee ?? 0;
  const attorneyFee = input.attorney_fee ?? 0;
  const pmFee = input.pm_fee ?? 0;

  const lenderOriginationFee = dscrLoan * 0.02;
  const brokerFee = dscrLoan * 0.02;
  const underwritingFee = 2500;

  const preCreditPartner = dscrLoan - tlFee - closingCosts - prepaidInsurance - prepaidTaxes - realtorCommission - dpts - assignmentFee - tcFee - attorneyFee - pmFee - lenderOriginationFee - brokerFee - underwritingFee;
  const creditPartnerFee = preCreditPartner > 0 ? preCreditPartner * 0.05 : 0;
  const netToBuyer = preCreditPartner - creditPartnerFee;
  const portfolioAIFee = netToBuyer > 0 ? netToBuyer * 0.10 : 0;

  return {
    dscrLoan,
    fundingGap,
    tlFee,
    closingCosts,
    lenderOriginationFee,
    brokerFee,
    underwritingFee,
    prepaidInsurance,
    prepaidTaxes,
    realtorCommission,
    dpts,
    assignmentFee,
    tcFee,
    attorneyFee,
    pmFee,
    creditPartnerFee,
    netToBuyer,
    portfolioAIFee,
    cashbackPct: contractPrice > 0 ? (netToBuyer / contractPrice) * 100 : 0,
  };
}

export function calculateCashflow(input: CashflowInput, monthlyRent: number): CashflowResult {
  const grossAnnualRent = monthlyRent * 12;
  const vacancy = grossAnnualRent * 0.08;
  const capex = grossAnnualRent * 0.2;
  const management = grossAnnualRent * 0.08;
  const insurance = input.insurance_annual ?? input.purchase_price * 0.006;
  const taxes = input.taxes_annual ?? input.purchase_price * 0.012;
  const hoa = (input.hoa_monthly ?? 0) * 12;

  const totalOpEx = vacancy + capex + management + insurance + taxes + hoa;
  const noi = grossAnnualRent - totalOpEx;

  const annualDebtService = ((input.first_lien_monthly ?? 0) + (input.seller_carry_monthly ?? 0)) * 12;
  const annualCashflow = noi - annualDebtService;
  const monthlyCashflow = annualCashflow / 12;
  const dscr = annualDebtService > 0 ? noi / annualDebtService : null;

  return {
    grossAnnualRent,
    vacancy,
    capex,
    management,
    insurance,
    taxes,
    hoa,
    totalOpEx,
    noi,
    annualDebtService,
    annualCashflow,
    monthlyCashflow,
    dscr,
  };
}
