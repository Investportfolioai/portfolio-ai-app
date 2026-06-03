import { getDeals } from "@/lib/deals";
import { PipelineBoard } from "./pipeline-board";

export const metadata = { title: "Pipeline — Portfolio AI" };

// Deals change as the team works them; always render fresh.
export const dynamic = "force-dynamic";

export default async function PipelinePage() {
  const deals = await getDeals();

  return (
    <div className="mx-auto max-w-7xl px-8 py-8">
      <header className="mb-6">
        <h1 className="text-3xl tracking-tight text-primary">Deal Pipeline</h1>
        <p className="mt-2 text-[15px] italic font-light text-muted-foreground">
          The person who controls the structure controls the money, the equity,
          and the outcome.
        </p>
        <p className="mt-1 text-xs uppercase tracking-widest text-muted-foreground/70">
          {deals.length} {deals.length === 1 ? "deal" : "deals"} in the book
        </p>
      </header>

      <PipelineBoard deals={deals} />
    </div>
  );
}
