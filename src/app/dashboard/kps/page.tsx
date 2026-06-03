import { getKeyPrincipals } from "@/lib/deals";

export const metadata = { title: "Key Principals — Portfolio AI" };
export const dynamic = "force-dynamic";

export default async function KeyPrincipalsPage() {
  const kps = await getKeyPrincipals();

  return (
    <div className="mx-auto max-w-7xl px-8 py-8">
      <header className="mb-6">
        <h1 className="text-3xl tracking-tight text-primary">Key Principals</h1>
        <p className="mt-2 text-[15px] italic font-light text-muted-foreground">
          KP roster across the book.
        </p>
      </header>

      {kps.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card py-16 text-center">
          <p className="text-sm font-medium text-primary">No Key Principals yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            KPs added with the <span className="font-medium">kp</span> role appear here.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[10px] uppercase tracking-widest text-muted-foreground">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Entity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {kps.map((kp) => (
                <tr key={kp.id} className="hover:bg-secondary/40">
                  <td className="px-4 py-3 font-medium text-primary">
                    {kp.full_name ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{kp.email ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {kp.entity_name ?? "—"}
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
