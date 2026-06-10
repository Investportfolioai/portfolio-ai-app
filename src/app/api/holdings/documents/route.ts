import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth";
import { canManage } from "@/lib/permissions";
import { POST as parseDocument } from "../parse-document/route";

export const runtime = "nodejs";
export const maxDuration = 60;

const BUCKET = "documents";

/** POST multipart { file, holding_id, doc_type } — upload, register, auto-parse. */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManage(user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data" }, { status: 400 });
  }

  const file = form.get("file");
  const holdingId = String(form.get("holding_id") ?? "");
  const docType = String(form.get("doc_type") ?? "other");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "A file is required" }, { status: 400 });
  }
  if (!holdingId) return NextResponse.json({ error: "Missing holding_id" }, { status: 400 });

  const admin = createAdminClient();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `holdings/${holdingId}/${Date.now()}-${safeName}`;

  const buffer = Buffer.from(await file.arrayBuffer());
  const up = await admin.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType: file.type || "application/octet-stream", upsert: false });
  if (up.error) return NextResponse.json({ error: up.error.message }, { status: 400 });

  const { data: doc, error: insErr } = await admin
    .from("holding_documents")
    .insert({ holding_id: holdingId, file_url: path, file_name: file.name, doc_type: docType })
    .select("id")
    .single();
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 400 });

  // Trigger the AI parse synchronously so the client can show what changed.
  let parsed: unknown = null;
  let updated: string[] = [];
  try {
    const res = await parseDocument(
      new Request("http://internal/api/holdings/parse-document", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ holding_id: holdingId, file_url: path, doc_type: docType }),
      }),
    );
    const j = await res.json();
    if (res.ok) {
      parsed = j.parsed ?? null;
      updated = j.updated ?? [];
    }
  } catch (e) {
    console.warn("[documents] auto-parse failed:", (e as Error).message);
  }

  return NextResponse.json({ success: true, file_url: path, document_id: doc?.id, parsed, updated });
}

/** GET ?holding_id= — list documents for a holding. */
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManage(user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const holdingId = new URL(req.url).searchParams.get("holding_id");
  if (!holdingId) return NextResponse.json({ error: "Missing holding_id" }, { status: 400 });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("holding_documents")
    .select("*")
    .eq("holding_id", holdingId)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ documents: data ?? [] });
}

/** DELETE ?id= — remove a document and its storage object. */
export async function DELETE(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManage(user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const admin = createAdminClient();
  const { data: doc } = await admin.from("holding_documents").select("file_url").eq("id", id).maybeSingle();
  if (doc?.file_url) await admin.storage.from(BUCKET).remove([doc.file_url]);
  const { error } = await admin.from("holding_documents").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true });
}
