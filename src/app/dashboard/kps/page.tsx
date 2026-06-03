import { getKeyPrincipals } from "@/lib/deals";
import { ROLE_LABELS } from "@/lib/types";
import { money } from "@/lib/format";
import { AddKpButton } from "./add-kp";

export const metadata = { title: "Key Principals — Portfolio AI" };
export const dynamic = "force-dynamic";

export default async function KeyPrincipalsPage() {
  const kps = await getKeyPrincipals();

  return (
    <div className="mx-auto max-w-7xl px-8 py-8">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl tracking-tight text-primary">Key Principals</h1>
          <p className="mt-2 text-[15px] italic font-light text-muted-foreground">
            KP roster, attached deals, and capital exposure.
          </p>
        </div>
        <div className="pt-2">
          <AddKpButton />
        </div>
      </header>

      {kps.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card py-16 text-center">
          <p className="text-sm font-medium text-primary">No Key Principals yet</p>
          <p className="mt-1 text-xs text-muted-foreground">Use “Add KP” to build the roster.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[10px] uppercase tracking-widest text-muted-foreground">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 text-right font-medium">Deals</th>
                <th className="px-4 py-3 text-right font-medium">Capital Exposure</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {kps.map((kp) => (
                <tr key={kp.id} className="hover:bg-secondary/40">
                  <td className="px-4 py-3 font-medium text-primary">{kp.full_name ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{kp.email ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{ROLE_LABELS[kp.role]}</td>
                  <td className="data-number px-4 py-3 text-right tabular-nums text-primary">{kp.deals_count}</td>
                  <td className="data-number px-4 py-3 text-right tabular-nums text-accent">{money(kp.capital_exposure)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
