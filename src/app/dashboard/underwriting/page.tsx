import { getDeals } from "@/lib/deals";
import { RECOMMENDATION_LABELS } from "@/lib/types";

export const metadata = { title: "Underwriting — Portfolio AI" };
export const dynamic = "force-dynamic";

export default async function UnderwritingPage() {
  const deals = await getDeals();
  const underwritten = deals.filter((d) => d.ai_analysis?.underwriting);
  const pending = deals.filter((d) => !d.ai_analysis?.underwriting);

  return (
    <div className="mx-auto max-w-7xl px-8 py-8">
      <header className="mb-6">
        <h1 className="text-3xl tracking-tight text-primary">Underwriting</h1>
        <p className="mt-2 text-[15px] italic font-light text-muted-foreground">
          AI deal analysis and acquisition grading. Run underwriting from a
          deal&apos;s detail panel on the Pipeline.
        </p>
      </header>

      <Section title={`Needs underwriting · ${pending.length}`}>
        {pending.length === 0 ? (
          <Empty>Every deal has been underwritten.</Empty>
        ) : (
          <ul className="divide-y divide-border">
            {pending.map((d) => (
              <li key={d.id} className="flex items-center justify-between px-4 py-3">
                <span className="text-sm font-medium text-primary">
                  {d.property_address}
                </span>
                <span className="rounded-full bg-secondary px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                  Not yet run
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={`Underwritten · ${underwritten.length}`}>
        {underwritten.length === 0 ? (
          <Empty>No deals underwritten yet.</Empty>
        ) : (
          <ul className="divide-y divide-border">
            {underwritten.map((d) => {
              const u = d.ai_analysis!.underwriting!;
              return (
                <li key={d.id} className="flex items-center justify-between gap-4 px-4 py-3">
                  <span className="min-w-0 truncate text-sm font-medium text-primary">
                    {d.property_address}
                  </span>
                  <div className="flex shrink-0 items-center gap-4">
                    <span className="data-number text-sm tabular-nums text-primary">
                      ACQ {d.acquisition_grade ?? "—"}
                    </span>
                    <span className="data-number text-sm tabular-nums text-primary">
                      STAB {d.stabilization_grade ?? "—"}
                    </span>
                    <span className="rounded-full bg-accent/15 px-2.5 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-accent/30">
                      {RECOMMENDATION_LABELS[u.recommendation]}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <div className="mb-2 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
        {title}
      </div>
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        {children}
      </div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-8 text-center text-sm text-muted-foreground">{children}</p>;
}
