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
        <h1 className="text-2xl font-semibold tracking-tight text-navy-900">
          Deal Pipeline
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {deals.length} {deals.length === 1 ? "deal" : "deals"} in the book.
          The person who controls the structure controls the outcome.
        </p>
      </header>

      <PipelineBoard deals={deals} />
    </div>
  );
}
