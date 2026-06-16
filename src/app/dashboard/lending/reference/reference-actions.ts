"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth";
import { canManage } from "@/lib/permissions";

export type RefResult = { ok: true } | { ok: false; error: string };

const BUCKET = "lender-reference-docs";

export async function createRefFolder(name: string): Promise<RefResult> {
  const user = await getSessionUser();
  if (!user || !canManage(user.role)) return { ok: false, error: "Not authorized." };
  if (!name.trim()) return { ok: false, error: "Folder name is required." };

  const supabase = await createClient();
  const { error } = await supabase.from("lender_ref_folders").insert({
    owner_id: user.id,
    name: name.trim(),
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/lending/reference");
  return { ok: true };
}

export async function deleteRefFolder(folderId: string): Promise<RefResult> {
  const user = await getSessionUser();
  if (!user || !canManage(user.role)) return { ok: false, error: "Not authorized." };

  const supabase = await createClient();
  const { error } = await supabase.from("lender_ref_folders").delete().eq("id", folderId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/lending/reference");
  return { ok: true };
}

export async function uploadRefDoc(
  folderId: string,
  formData: FormData,
): Promise<RefResult> {
  const user = await getSessionUser();
  if (!user || !canManage(user.role)) return { ok: false, error: "Not authorized." };

  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { ok: false, error: "No file selected." };

  const ext = file.name.split(".").pop() ?? "";
  const storagePath = `${folderId}/${Date.now()}_${file.name}`;

  const admin = createAdminClient();
  const bytes = await file.arrayBuffer();

  const { error: uploadError } = await admin.storage
    .from(BUCKET)
    .upload(storagePath, bytes, { contentType: file.type || "application/octet-stream" });

  if (uploadError) return { ok: false, error: uploadError.message };

  const tagsRaw = (formData.get("tags") as string | null) ?? "";
  const tags = tagsRaw.split(",").map((t) => t.trim()).filter(Boolean);

  const { error: insertError } = await admin.from("lender_reference_docs").insert({
    folder_id: folderId,
    doc_name: file.name,
    storage_path: storagePath,
    tags,
    uploaded_by: user.id,
  });

  if (insertError) return { ok: false, error: insertError.message };
  revalidatePath("/dashboard/lending/reference");
  return { ok: true };
}

export async function deleteRefDoc(docId: string, storagePath: string | null): Promise<RefResult> {
  const user = await getSessionUser();
  if (!user || !canManage(user.role)) return { ok: false, error: "Not authorized." };

  const admin = createAdminClient();

  if (storagePath) {
    await admin.storage.from(BUCKET).remove([storagePath]);
  }

  const { error } = await admin.from("lender_reference_docs").delete().eq("id", docId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/lending/reference");
  return { ok: true };
}
