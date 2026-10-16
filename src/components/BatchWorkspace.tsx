import { useEffect, useState } from "react";
import { fetchOpportunities, fetchOpportunityBatches, type OpportunityBatch } from "../lib/api";
import type { OppRow } from "../lib/types";
import { batchPipeline } from "../lib/batch-pipeline";
import BatchPipelineOverview, { BatchCard } from "./BatchPipelineOverview";
import OpportunityList from "../routes/OpportunityList";

/** Shared read-only workload surface; batch detail owns all processing actions. */
export default function BatchWorkspace({ dashboard = false }: { dashboard?: boolean }) {
  const [data, setData] = useState<{ batches: OpportunityBatch[]; records: OppRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"Pipeline" | "Individual">("Pipeline");
  const [selected, setSelected] = useState("");
  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchOpportunityBatches(), fetchOpportunities()]).then(([groups, records]) => {
      if (!cancelled) setData({ batches: groups.batches, records: records.opportunities });
    }).catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Could not load batch workload."); });
    return () => { cancelled = true; };
  }, []);
  const items = data ? batchPipeline(data.batches, data.records).all : [];
  const individual = items.find((item) => item.batch.id === selected) ?? items[0];
  return <div className="space-y-4">
    <h1 className="text-xl font-semibold text-slate-100">{dashboard ? "Dashboard" : "Opportunity batches"}</h1>
    {dashboard && <div className="flex gap-2" aria-label="Dashboard view">
      {(["Pipeline", "Individual"] as const).map((mode) => <button key={mode} type="button" aria-pressed={view === mode} onClick={() => setView(mode)} className={`rounded border px-3 py-2 text-sm ${view === mode ? "border-accent-500 text-accent-300" : "border-slate-700 text-slate-400"}`}>{mode}</button>)}
    </div>}
    {error && <p role="alert" className="text-rose-300">{error}</p>}
    {!data && !error && <p className="text-sm text-slate-400">Loading batch workload…</p>}
    {view === "Pipeline" ? data && <BatchPipelineOverview batches={data.batches} records={data.records} /> : <section className="space-y-4">
      {individual && <><label className="block text-sm text-slate-300">Select batch<select className="ml-3 rounded border border-slate-700 bg-slate-950 p-2" value={individual.batch.id} onChange={(event) => setSelected(event.target.value)}>{items.map((item) => <option key={item.batch.id} value={item.batch.id}>{item.batch.name}</option>)}</select></label><BatchCard item={individual} /></>}
      <OpportunityList />
    </section>}
    {data && !data.batches.length && <p className="text-sm text-slate-400">No batches yet. Select two or more imported opportunities and click Enrich selected to create a batch.</p>}
  </div>;
}
