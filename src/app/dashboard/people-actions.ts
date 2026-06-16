"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendKpInvite, sendTcInvite } from "@/lib/email";
import type { LenderType, UserRole } from "@/lib/types";

export type Result = { ok: true } | { ok: false; error: string };

export interface NewKp {
  name: string;
  email: string;
  phone: string;
  role: UserRole;
}

/**
 * Add a Key Principal: create their Supabase Auth identity, insert the profile
 * row using that auth UUID, and send a branded invite email via Resend.
 */
export async function createKp(input: NewKp): Promise<Result> {
  const name = input.name.trim();
  const email = input.email.trim();
  if (!name) return { ok: false, error: "Name is required." };
  if (!email) return { ok: false, error: "Email is required to invite a KP." };

  const session = await createClient();
  const { data: allowed } = await session.rpc("is_owner_or_partner");
  if (!allowed) return { ok: false, error: "Not authorized." };

  const admin = createAdminClient();
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");

  // generateLink creates the auth.users record and returns a one-time invite
  // URL without sending Supabase's own email (we send via Resend instead).
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: "invite",
    email,
    options: {
      data: { role: input.role || "kp", full_name: name },
      redirectTo: `${base}/kp/setup`,
    },
  });

  if (linkError || !linkData?.user) {
    return { ok: false, error: linkError?.message ?? "Could not create auth account." };
  }

  // Profile row uses the auth UUID so getSessionUser() can join on user.id.
  const { error: insertError } = await admin.from("users").insert({
    id: linkData.user.id,
    full_name: name,
    email,
    phone: input.phone.trim() || null,
    role: input.role || "kp",
  });
  if (insertError) return { ok: false, error: insertError.message };

  try {
    await sendKpInvite({ email, name, inviteUrl: linkData.properties.action_link });
  } catch (e) {
    console.error("sendKpInvite failed:", e);
    // Non-fatal — KP is created even if email fails.
  }

  revalidatePath("/dashboard/kps");
  return { ok: true };
}

/** Re-send an invite (magic link) to an existing KP who already has an auth account. */
export async function resendKpInvite(kpId: string): Promise<Result> {
  const session = await createClient();
  const { data: allowed } = await session.rpc("is_owner_or_partner");
  if (!allowed) return { ok: false, error: "Not authorized." };

  const admin = createAdminClient();
  const { data: kp } = await admin
    .from("users")
    .select("email, full_name")
    .eq("id", kpId)
    .maybeSingle();

  if (!kp?.email) return { ok: false, error: "KP has no email on file." };

  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: kp.email,
    options: { redirectTo: `${base}/kp/setup` },
  });

  if (linkError || !linkData?.properties?.action_link) {
    return { ok: false, error: linkError?.message ?? "Could not generate invite link." };
  }

  try {
    await sendKpInvite({ email: kp.email, name: kp.full_name, inviteUrl: linkData.properties.action_link });
  } catch (e) {
    console.error("resendKpInvite email failed:", e);
    return { ok: false, error: "Could not send invite email." };
  }

  return { ok: true };
}

export interface NewTc {
  name: string;
  email: string;
  phone: string;
  tabs: Array<"lending" | "documents">;
  dealIds: string[];
}

/**
 * Invite a Transaction Coordinator: same auth flow as createKp but redirects
 * to /tc/setup and seeds tc_tab_grants + deal_tcs on creation.
 */
export async function createTc(input: NewTc): Promise<Result> {
  const name = input.name.trim();
  const email = input.email.trim();
  if (!name) return { ok: false, error: "Name is required." };
  if (!email) return { ok: false, error: "Email is required to invite a TC." };
  if (!input.tabs.length) return { ok: false, error: "Grant at least one tab." };

  const session = await createClient();
  const { data: allowed } = await session.rpc("is_owner_or_partner");
  if (!allowed) return { ok: false, error: "Not authorized." };

  const admin = createAdminClient();
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");

  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: "invite",
    email,
    options: {
      data: { role: "tc", full_name: name },
      redirectTo: `${base}/tc/setup`,
    },
  });
  if (linkError || !linkData?.user) {
    return { ok: false, error: linkError?.message ?? "Could not create auth account." };
  }

  const tcId = linkData.user.id;

  const { error: insertError } = await admin.from("users").insert({
    id: tcId,
    full_name: name,
    email,
    phone: input.phone.trim() || null,
    role: "tc",
  });
  if (insertError) return { ok: false, error: insertError.message };

  if (input.tabs.length) {
    const { error: tabError } = await admin.from("tc_tab_grants").insert(
      input.tabs.map((tab) => ({ tc_id: tcId, tab })),
    );
    if (tabError) return { ok: false, error: tabError.message };
  }

  if (input.dealIds.length) {
    const { error: dealError } = await admin.from("deal_tcs").insert(
      input.dealIds.map((deal_id) => ({ deal_id, tc_id: tcId })),
    );
    if (dealError) return { ok: false, error: dealError.message };
  }

  // Fetch deal addresses for the invite email
  let dealAddresses: string[] = [];
  if (input.dealIds.length) {
    const { data: dealRows } = await admin
      .from("deals")
      .select("property_address")
      .in("id", input.dealIds);
    dealAddresses = (dealRows ?? []).map((d) => d.property_address);
  }

  try {
    await sendTcInvite({
      email,
      name,
      inviteUrl: linkData.properties.action_link,
      tabs: input.tabs,
      dealAddresses,
    });
  } catch (e) {
    console.error("sendTcInvite failed:", e);
  }

  revalidatePath("/dashboard/kps");
  return { ok: true };
}

/** Re-send a magic link to an existing TC. */
export async function resendTcInvite(tcId: string): Promise<Result> {
  const session = await createClient();
  const { data: allowed } = await session.rpc("is_owner_or_partner");
  if (!allowed) return { ok: false, error: "Not authorized." };

  const admin = createAdminClient();
  const { data: tc } = await admin
    .from("users")
    .select("email, full_name")
    .eq("id", tcId)
    .maybeSingle();
  if (!tc?.email) return { ok: false, error: "TC has no email on file." };

  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: tc.email,
    options: { redirectTo: `${base}/tc/setup` },
  });
  if (linkError || !linkData?.properties?.action_link) {
    return { ok: false, error: linkError?.message ?? "Could not generate invite link." };
  }

  try {
    await sendTcInvite({
      email: tc.email,
      name: tc.full_name,
      inviteUrl: linkData.properties.action_link,
      tabs: [],
      dealAddresses: [],
    });
  } catch (e) {
    console.error("resendTcInvite email failed:", e);
    return { ok: false, error: "Could not send invite email." };
  }

  return { ok: true };
}

export interface NewLender {
  name: string;
  type: LenderType | "";
  rate: number | null;
  max_ltv: number | null;
  contact_name: string;
  phone: string;
  email: string;
}

/** Add a lender to the lenders table. */
export async function createLender(input: NewLender): Promise<Result> {
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Lender name is required." };
  if (input.rate !== null && (!Number.isFinite(input.rate) || input.rate < 0 || input.rate > 100)) {
    return { ok: false, error: "Rate must be a number between 0 and 100." };
  }
  if (input.max_ltv !== null && (!Number.isFinite(input.max_ltv) || input.max_ltv < 0 || input.max_ltv > 100)) {
    return { ok: false, error: "Max LTV must be a number between 0 and 100." };
  }
  const supabase = await createClient();
  const { data: allowed } = await supabase.rpc("is_owner_or_partner");
  if (!allowed) return { ok: false, error: "Not authorized." };
  const { error } = await supabase.from("lenders").insert({
    name,
    type: input.type || null,
    rate: input.rate,
    max_ltv: input.max_ltv,
    contact_name: input.contact_name.trim() || null,
    phone: input.phone.trim() || null,
    email: input.email.trim() || null,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/lenders");
  return { ok: true };
}
