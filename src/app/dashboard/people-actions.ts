"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { LenderType, UserRole } from "@/lib/types";

export type Result = { ok: true } | { ok: false; error: string };

export interface NewKp {
  name: string;
  email: string;
  phone: string;
  role: UserRole;
}

/** Add a Key Principal to the users roster (no auth identity is created). */
export async function createKp(input: NewKp): Promise<Result> {
  const name = input.name.trim();
  const email = input.email.trim();
  if (!name) return { ok: false, error: "Name is required." };

  // Authorize via the SECURITY DEFINER role check, then write with the service
  // role (the users_admin_write RLS policy isn't applied in this project).
  const session = await createClient();
  const { data: allowed } = await session.rpc("is_owner_or_partner");
  if (!allowed) return { ok: false, error: "Not authorized." };

  const admin = createAdminClient();
  const { error } = await admin.from("users").insert({
    full_name: name,
    email: email || null,
    phone: input.phone.trim() || null,
    role: input.role || "kp",
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/kps");
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
  const supabase = await createClient();
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
