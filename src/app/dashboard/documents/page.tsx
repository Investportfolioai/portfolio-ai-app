import { getAllDocuments } from "@/lib/deals";

export const metadata = { title: "Documents — Portfolio AI" };
export const dynamic = "force-dynamic";

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export default async function DocumentsPage() {
  const docs = await getAllDocuments();

  return (
    <div className="mx-auto max-w-7xl px-8 py-8">
      <header className="mb-6">
        <h1 className="text-3xl tracking-tight text-primary">Documents</h1>
        <p className="mt-2 text-[15px] italic font-light text-muted-foreground">
          Deal files across the book — {docs.length}{" "}
          {docs.length === 1 ? "file" : "files"}.
        </p>
      </header>

      {docs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card py-16 text-center text-sm text-muted-foreground">
          No documents uploaded yet.
        </div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
          {docs.map((doc) => (
            <li key={doc.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-primary">
                  {doc.file_name}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {doc.deal_address} · {fmtDate(doc.uploaded_at)}
                </div>
              </div>
              {doc.url ? (
                <a
                  href={doc.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground hover:bg-secondary/70"
                >
                  Download
                </a>
              ) : (
                <span className="text-xs text-muted-foreground">Unavailable</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
