import { createAdminClient } from "./supabase/admin";

export function fireWebhook(event: string, deal: Record<string, unknown>): void {
  const webhookUrl = process.env.MAKE_WEBHOOK_URL;
  if (!webhookUrl) return;

  fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      event,
      deal_id: deal.id,
      address: deal.address ?? deal.property_address,
      status: deal.status,
      purchase_price: deal.purchase_price,
      cashback_at_close: deal.cashback_at_close,
      acq_grade: deal.acq_grade ?? deal.acquisition_grade,
      stab_grade: deal.stab_grade ?? deal.stabilization_grade,
      deal_type: deal.deal_type ?? deal.structure_type,
      submitted_at: deal.submitted_at ?? deal.created_at,
      timestamp: new Date().toISOString(),
    }),
  }).catch((err) => console.error("Webhook failed:", err));
}

export function fireWebhookById(event: string, dealId: string): void {
  const webhookUrl = process.env.MAKE_WEBHOOK_URL;
  if (!webhookUrl) return;

  const admin = createAdminClient();
  admin
    .from("deals")
    .select(
      "id, property_address, status, purchase_price, cashback_at_close, acquisition_grade, stabilization_grade, structure_type, created_at",
    )
    .eq("id", dealId)
    .maybeSingle()
    .then(({ data }) => {
      if (data) fireWebhook(event, data as Record<string, unknown>);
    })
    .catch((err) => console.error("Webhook fetch failed:", err));
}
