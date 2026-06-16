import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth";
import { canManage } from "@/lib/permissions";
import { RefBoardClient, type RefFolder } from "./ref-board-client";

export const metadata = { title: "Lender Reference Docs — Portfolio AI" };
export const dynamic = "force-dynamic";

async function RefContent() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!canManage(user.role)) redirect("/dashboard/lending");

  const supabase = await createClient();

  const { data: folderRows } = await supabase
    .from("lender_ref_folders")
    .select("id, name, position, created_at")
    .order("position")
    .order("created_at");

  const folderIds = (folderRows ?? []).map((f) => f.id as string);

  const { data: docRows } = folderIds.length
    ? await supabase
        .from("lender_reference_docs")
        .select("id, folder_id, doc_name, tags, storage_path, uploaded_at")
        .in("folder_id", folderIds)
        .order("uploaded_at", { ascending: false })
    : { data: [] };

  const docsByFolder = new Map<string, typeof docRows>();
  for (const doc of (docRows ?? [])) {
    const fid = (doc as { folder_id: string }).folder_id;
    const list = docsByFolder.get(fid) ?? [];
    list.push(doc);
    docsByFolder.set(fid, list);
  }

  const folders: RefFolder[] = ((folderRows ?? []) as {
    id: string;
    name: string;
    position: number;
    created_at: string;
  }[]).map((f) => ({
    id: f.id,
    name: f.name,
    position: f.position,
    created_at: f.created_at,
    docs: ((docsByFolder.get(f.id) ?? []) as {
      id: string;
      folder_id: string;
      doc_name: string;
      tags: string[];
      storage_path: string | null;
      uploaded_at: string;
    }[]).map((d) => ({
      id: d.id,
      doc_name: d.doc_name,
      tags: d.tags ?? [],
      storage_path: d.storage_path,
      uploaded_at: d.uploaded_at,
    })),
  }));

  return <RefBoardClient folders={folders} />;
}

function RefSkeleton() {
  return (
    <div style={{ padding: "32px 24px" }}>
      {[1, 2].map((i) => (
        <div key={i} style={{ background: "rgba(255,255,255,0.04)", borderRadius: "12px", height: "80px", marginBottom: "12px", animation: "pulse 2s infinite" }} />
      ))}
    </div>
  );
}

export default function ReferencePage() {
  return (
    <Suspense fallback={<RefSkeleton />}>
      <RefContent />
    </Suspense>
  );
}
