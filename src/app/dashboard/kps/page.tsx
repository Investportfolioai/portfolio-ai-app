import { getKeyPrincipals, getTransactionCoordinators, getActiveDealsForTcInvite } from "@/lib/deals";
import { ROLE_LABELS } from "@/lib/types";
import { money } from "@/lib/format";
import { AddKpButton, InviteKpButton, AddTcButton, ResendTcInviteButton } from "./add-kp";

export const metadata = { title: "Key Principals — Portfolio AI" };
export const dynamic = "force-dynamic";

export default async function KeyPrincipalsPage() {
  const [kps, tcs, activeDeals] = await Promise.all([
    getKeyPrincipals(),
    getTransactionCoordinators(),
    getActiveDealsForTcInvite(),
  ]);

  return (
    <div className="mx-auto max-w-7xl px-8 py-8">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl tracking-tight text-primary">Key Principals</h1>
          <p className="mt-2 text-[15px] italic font-light text-muted-foreground">
            KP roster, attached deals, and capital exposure.
          </p>
        </div>
        <div className="flex items-center gap-2 pt-2">
          <AddTcButton deals={activeDeals} />
          <AddKpButton />
        </div>
      </header>

      {kps.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card py-16 text-center">
          <p className="text-sm font-medium text-primary">No Key Principals yet</p>
          <p className="mt-1 text-xs text-muted-foreground">Use "Add KP" to build the roster.</p>
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
                <th className="px-4 py-3" />
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
                  <td className="px-4 py-3 text-right">
                    {kp.email && <InviteKpButton kpId={kp.id} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Transaction Coordinators section */}
      <section className="mt-10">
        <header className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl tracking-tight text-primary">Transaction Coordinators</h2>
            <p className="mt-1 text-[13px] italic font-light text-muted-foreground">
              TCs have scoped tab + deal access.
            </p>
          </div>
        </header>

        {tcs.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card py-12 text-center">
            <p className="text-sm font-medium text-primary">No Transaction Coordinators yet</p>
            <p className="mt-1 text-xs text-muted-foreground">Use "Invite TC" to add one.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[10px] uppercase tracking-widest text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Tab Access</th>
                  <th className="px-4 py-3 text-right font-medium">Deals</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {tcs.map((tc) => (
                  <tr key={tc.id} className="hover:bg-secondary/40">
                    <td className="px-4 py-3 font-medium text-primary">{tc.full_name ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{tc.email ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {tc.tabs.length
                        ? tc.tabs.map((t) => t.charAt(0).toUpperCase() + t.slice(1)).join(", ")
                        : "—"}
                    </td>
                    <td className="data-number px-4 py-3 text-right tabular-nums text-primary">{tc.deals_count}</td>
                    <td className="px-4 py-3 text-right">
                      {tc.email && <ResendTcInviteButton tcId={tc.id} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
