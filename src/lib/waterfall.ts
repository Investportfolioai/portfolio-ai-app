import type { WaterfallInput, WaterfallResult, CashflowInput, CashflowResult } from "./types";

export function calculateMorbyWaterfall(input: WaterfallInput): WaterfallResult {
  const contractPrice = input.purchase_price;
  const ltv = (input.ltv_percent ?? 75) / 100;
  const dscrLoan = contractPrice * ltv;
  const sellerNote = input.seller_note_amount ?? 0;
  const dpts = contractPrice - sellerNote; // cash to seller at close
  const assignmentFee = input.assignment_fee ?? 0;
  const realtorCommission = input.realtor_commission ?? 0;

  const closingCosts = contractPrice * 0.025;
  const prepaidInsurance = input.insurance_annual ?? contractPrice * 0.006;
  const prepaidTaxes = input.taxes_annual ?? contractPrice * 0.012;

  const totalTLAdvance =
    contractPrice - dscrLoan + closingCosts + prepaidInsurance + prepaidTaxes + realtorCommission;
  const tlFee = totalTLAdvance * 0.035;
  const tlRepayment = totalTLAdvance + tlFee;

  const afterTL = dscrLoan - tlRepayment;
  const afterDPTS = afterTL - dpts;
  const afterAssignment = afterDPTS - assignmentFee;
  const creditPartnerFee = Math.max(0, afterAssignment) * 0.05;
  const netToBuyer = afterAssignment - creditPartnerFee;
  const portfolioAIFee = Math.max(0, netToBuyer) * 0.1;

  return {
    dscrLoan,
    totalTLAdvance,
    tlFee,
    tlRepayment,
    closingCosts,
    prepaidInsurance,
    prepaidTaxes,
    dpts,
    assignmentFee,
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
