import { getLenders } from "@/lib/deals";
import { LENDER_TYPE_LABELS } from "@/lib/types";
import { AddLenderButton } from "./add-lender";

export const metadata = { title: "Lenders — Portfolio AI" };
export const dynamic = "force-dynamic";

const pct = (n: number | null) => (n == null ? "—" : `${n}%`);

export default async function LendersPage() {
  const lenders = await getLenders();

  return (
    <div className="mx-auto max-w-7xl px-8 py-8">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl tracking-tight text-primary">Lenders</h1>
          <p className="mt-2 text-[15px] italic font-light text-muted-foreground">
            Capital sources, terms, and contacts.
          </p>
        </div>
        <div className="pt-2">
          <AddLenderButton />
        </div>
      </header>

      {lenders.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card py-16 text-center">
          <p className="text-sm font-medium text-primary">No lenders yet</p>
          <p className="mt-1 text-xs text-muted-foreground">Use “Add Lender” to build the list.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[10px] uppercase tracking-widest text-muted-foreground">
                <th className="px-4 py-3 font-medium">Lender</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 text-right font-medium">Rate</th>
                <th className="px-4 py-3 text-right font-medium">Max LTV</th>
                <th className="px-4 py-3 font-medium">Contact</th>
                <th className="px-4 py-3 font-medium">Phone</th>
                <th className="px-4 py-3 font-medium">Email</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {lenders.map((l) => (
                <tr key={l.id} className="hover:bg-secondary/40">
                  <td className="px-4 py-3 font-medium text-primary">{l.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {l.type ? LENDER_TYPE_LABELS[l.type] : "—"}
                  </td>
                  <td className="data-number px-4 py-3 text-right tabular-nums text-primary">{pct(l.rate)}</td>
                  <td className="data-number px-4 py-3 text-right tabular-nums text-primary">{pct(l.max_ltv)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{l.contact_name ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{l.phone ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{l.email ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
