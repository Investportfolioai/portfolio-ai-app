import { getDeals } from "@/lib/deals";
import { STATUS_LABELS, STRUCTURE_LABELS, equitySpread } from "@/lib/types";
import { money } from "@/lib/format";

export const metadata = { title: "Deals — Portfolio AI" };
export const dynamic = "force-dynamic";

export default async function DealsPage() {
  const deals = await getDeals();

  return (
    <div className="mx-auto max-w-7xl px-8 py-8">
      <header className="mb-6">
        <h1 className="text-3xl tracking-tight text-primary">Deals</h1>
        <p className="mt-2 text-[15px] italic font-light text-muted-foreground">
          Every deal in the book — {deals.length}{" "}
          {deals.length === 1 ? "record" : "records"}.
        </p>
      </header>

      {deals.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card py-16 text-center text-sm text-muted-foreground">
          No deals yet.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[10px] uppercase tracking-widest text-muted-foreground">
                <th className="px-4 py-3 font-medium">Property</th>
                <th className="px-4 py-3 font-medium">Structure</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Purchase</th>
                <th className="px-4 py-3 text-right font-medium">ARV</th>
                <th className="px-4 py-3 text-right font-medium">Equity Spread</th>
                <th className="px-4 py-3 text-right font-medium">ACQ</th>
                <th className="px-4 py-3 text-right font-medium">STAB</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {deals.map((d) => (
                <tr key={d.id} className="hover:bg-secondary/40">
                  <td className="px-4 py-3 font-medium text-primary">
                    {d.property_address}
                    {(d.city || d.state) && (
                      <span className="ml-1 text-xs text-muted-foreground">
                        {[d.city, d.state].filter(Boolean).join(", ")}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {STRUCTURE_LABELS[d.structure_type]}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {STATUS_LABELS[d.status]}
                  </td>
                  <td className="data-number px-4 py-3 text-right tabular-nums text-primary">
                    {money(d.purchase_price)}
                  </td>
                  <td className="data-number px-4 py-3 text-right tabular-nums text-primary">
                    {money(d.arv)}
                  </td>
                  <td className="data-number px-4 py-3 text-right tabular-nums text-accent">
                    {money(equitySpread(d))}
                  </td>
                  <td className="data-number px-4 py-3 text-right tabular-nums text-primary">
                    {d.acquisition_grade ?? "—"}
                  </td>
                  <td className="data-number px-4 py-3 text-right tabular-nums text-primary">
                    {d.stabilization_grade ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
