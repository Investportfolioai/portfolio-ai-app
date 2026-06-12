import { createAdminClient } from "./supabase/admin";

export function fireWebhook(event: string, deal: Record<string, unknown>): Promise<void> {
  const webhookUrl = process.env.MAKE_WEBHOOK_URL;
  if (!webhookUrl) return Promise.resolve();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  return fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: controller.signal,
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
  })
    .then(() => undefined)
    .finally(() => clearTimeout(timeout));
}

export function fireWebhookById(event: string, dealId: string): void {
  const webhookUrl = process.env.MAKE_WEBHOOK_URL;
  if (!webhookUrl) return;

  void (async () => {
    try {
      const admin = createAdminClient();
      const { data } = await admin
        .from("deals")
        .select(
          "id, property_address, status, purchase_price, cashback_at_close, acquisition_grade, stabilization_grade, structure_type, created_at",
        )
        .eq("id", dealId)
        .maybeSingle();
      if (data) fireWebhook(event, data as Record<string, unknown>);
    } catch (err) {
      console.error("Webhook fetch failed:", err);
    }
  })();
}
