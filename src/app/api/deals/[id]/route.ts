import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth";
import { canManage } from "@/lib/permissions";

export const runtime = "nodejs";

/** DELETE /api/deals/[id] — hard-deletes a deal and all related records. */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManage(user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const admin = createAdminClient();

  // Delete child records first to avoid FK constraint errors.
  await admin.from("deal_milestones").delete().eq("deal_id", id);
  await admin.from("deal_kp_assignments").delete().eq("deal_id", id);
  await admin.from("deal_kps").delete().eq("deal_id", id);
  await admin.from("deal_lenders").delete().eq("deal_id", id);
  await admin.from("deal_documents").delete().eq("deal_id", id);
  await admin.from("deal_activity").delete().eq("deal_id", id);
  // Unlink any holdings that reference this deal (do not delete the holding).
  await admin.from("holdings").update({ linked_deal_id: null }).eq("linked_deal_id", id);

  const { error } = await admin.from("deals").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}
