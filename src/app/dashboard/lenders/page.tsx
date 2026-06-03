import { getDeals } from "@/lib/deals";
import { money } from "@/lib/format";

export const metadata = { title: "Lenders — Portfolio AI" };
export const dynamic = "force-dynamic";

export default async function LendersPage() {
  const deals = await getDeals();

  const byLender = new Map<string, { count: number; loan: number }>();
  for (const d of deals) {
    if (!d.lender_name) continue;
    const cur = byLender.get(d.lender_name) ?? { count: 0, loan: 0 };
    cur.count += 1;
    cur.loan += d.loan_amount ?? 0;
    byLender.set(d.lender_name, cur);
  }
  const lenders = [...byLender.entries()].sort((a, b) => b[1].loan - a[1].loan);

  return (
    <div className="mx-auto max-w-7xl px-8 py-8">
      <header className="mb-6">
        <h1 className="text-3xl tracking-tight text-primary">Lenders</h1>
        <p className="mt-2 text-[15px] italic font-light text-muted-foreground">
          Capital sources across the book.
        </p>
      </header>

      {lenders.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card py-16 text-center text-sm text-muted-foreground">
          No lenders on file yet.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[10px] uppercase tracking-widest text-muted-foreground">
                <th className="px-4 py-3 font-medium">Lender</th>
                <th className="px-4 py-3 text-right font-medium">Deals</th>
                <th className="px-4 py-3 text-right font-medium">Total Loan Volume</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {lenders.map(([name, agg]) => (
                <tr key={name} className="hover:bg-secondary/40">
                  <td className="px-4 py-3 font-medium text-primary">{name}</td>
                  <td className="data-number px-4 py-3 text-right tabular-nums text-primary">
                    {agg.count}
                  </td>
                  <td className="data-number px-4 py-3 text-right tabular-nums text-primary">
                    {money(agg.loan)}
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
