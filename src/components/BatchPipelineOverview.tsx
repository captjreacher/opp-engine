import { useState } from "react";
import { Link } from "react-router-dom";
import { batchPipeline, defaultBatchStage, type ActiveBatchStage, type ClassifiedBatch } from "../lib/batch-pipeline";
import type { OpportunityBatch } from "../lib/api";
import type { OppRow } from "../lib/types";

export function BatchCard({ item }: { item: ClassifiedBatch }) {
  return <Link to={`/batches/${item.batch.id}`} className="block rounded-lg border border-slate-800 bg-slate-900/60 p-4 hover:border-slate-600">
    <p className="font-medium text-accent-400">{item.batch.name}</p>
    <p className="mt-1 text-sm text-slate-400">{item.recordCount} records · {item.stage ?? (item.state === "empty" ? "Empty" : "Inactive / blocked")}</p>
    {item.batch.purpose && <p className="mt-2 text-sm text-slate-300">{item.batch.purpose}</p>}
  </Link>;
}

export default function BatchPipelineOverview({ batches, records }: { batches: OpportunityBatch[]; records: OppRow[] }) {
  const pipeline = batchPipeline(batches, records);
  const { groups, inactive } = pipeline;
  const [selected, setSelected] = useState<ActiveBatchStage | null>(null);
  const active = selected ?? defaultBatchStage(pipeline);
  const group = groups.find((item) => item.stage === active)!;
  return <section className="space-y-4" aria-label="Batch pipeline">
    <div className="flex items-stretch gap-2 overflow-x-auto pb-2">
      {groups.map((item, index) => <div key={item.stage} className="flex min-w-32 flex-1 items-center gap-2">
        {index > 0 && <span className="text-slate-500" aria-hidden="true">→</span>}
        {item.stage === "Discover" || item.stage === "Import" ? <div title="Upstream opportunity stage, before saved batch creation" className="w-full rounded-lg border border-dashed border-slate-800 bg-slate-900/30 p-4 text-left">
          <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">{item.stage}</span>
          <span className="mt-2 block text-sm text-slate-500">Upstream</span>
        </div> : <button type="button" aria-pressed={active === item.stage} onClick={() => setSelected(item.stage as ActiveBatchStage)} className={`w-full rounded-lg border p-4 text-left ${active === item.stage ? "border-accent-500 bg-accent-500/10" : "border-slate-800 bg-slate-900/60 hover:border-slate-600"}`}>
          <span className="block text-xs font-semibold uppercase tracking-wide text-slate-300">{item.stage}</span>
          <span className="mt-2 block text-lg font-semibold text-slate-100">{item.batchCount} {item.batchCount === 1 ? "batch" : "batches"}</span>
          <span className="block text-xs text-slate-400">{item.recordCount} records</span>
        </button>}
      </div>)}
    </div>
    <h2 className="text-lg font-semibold text-slate-100">{active} batches</h2>
    {active === "Outreach" && <p className="text-sm text-slate-400">Assessment complete; outreach work is next or underway.</p>}
    {group.items.map((item) => <BatchCard key={item.batch.id} item={item} />)}
    {!group.items.length && <p className="text-sm text-slate-400">No batches at this stage.</p>}
    <p className="text-xs text-slate-500">Discover and Import occur before batch creation. Batch workflow starts at Enrich; record counts include all fixed members.</p>
    <section className="space-y-3" aria-label="Inactive / blocked batches">
      <h2 className="text-lg font-semibold text-slate-100">Inactive / blocked batches ({inactive.length})</h2>
      {inactive.map((item) => <BatchCard key={item.batch.id} item={item} />)}
      {!inactive.length && <p className="text-sm text-slate-500">No inactive or empty batches.</p>}
    </section>
  </section>;
}
