import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { analyzeOpportunity, enrichOpportunity, fetchOpportunityBatch, fetchOpportunityBatches, updateOpportunityBatch, type OpportunityBatch } from "../lib/api";
import type { OppRow } from "../lib/types";
import Filters from "../components/Filters";
import { canSelectOpportunity, enrichSelectedOpportunities } from "../lib/bulk-enrichment";
import { DEFAULT_BATCH_FILTER, matchesBatchFilter, type BatchRecordFilter } from "../../supabase/functions/_shared/opportunityBatches";

const button = "rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50";
const input = "w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100";

export default function OpportunityBatches() {
  const { id } = useParams();
  const [batches, setBatches] = useState<OpportunityBatch[]>([]);
  const [batch, setBatch] = useState<OpportunityBatch | null>(null);
  const [rows, setRows] = useState<OppRow[]>([]);
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [filter, setFilter] = useState<BatchRecordFilter>(DEFAULT_BATCH_FILTER);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [failures, setFailures] = useState<string[]>([]);
  const [progress, setProgress] = useState("");

  async function refreshRecords() {
    if (id) setRows((await fetchOpportunityBatch(id)).opportunities);
  }
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null); setNotice(null); setFailures([]);
    (async () => {
      try {
        if (id) {
          const result = await fetchOpportunityBatch(id);
          if (cancelled) return;
          setBatch(result.batch); setRows(result.opportunities);
          setName(result.batch.name); setPurpose(result.batch.purpose);
          setFilter({ ...DEFAULT_BATCH_FILTER, ...result.batch.record_filter });
        } else {
          const result = await fetchOpportunityBatches();
          if (!cancelled) setBatches(result.batches);
        }
      } catch (err) { if (!cancelled) setError(err instanceof Error ? err.message : "Could not load batches."); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [id]);

  const running = rows.some((row) => row.enrichment_running);
  useEffect(() => {
    if (!id || !running || busy) return;
    const timer = setInterval(() => { void refreshRecords().catch(() => {}); }, 5_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, running, busy]);

  const matching = useMemo(() => rows.filter((row) => matchesBatchFilter(row, filter)), [rows, filter]);
  const enrichTargets = matching.filter((row) => canSelectOpportunity(row) && !row.enrichment_ready);
  const assessTargets = matching.filter((row) => canSelectOpportunity(row) && row.enrichment_ready && !row.assessed_at);
  const dirty = !!batch && (name !== batch.name || purpose !== batch.purpose || JSON.stringify(filter) !== JSON.stringify({ ...DEFAULT_BATCH_FILTER, ...batch.record_filter }));

  async function save() {
    if (!id || busy) return;
    setBusy(true); setError(null);
    try {
      const result = await updateOpportunityBatch(id, { name, purpose, record_filter: filter });
      setBatch(result.batch); setName(result.batch.name); setPurpose(result.batch.purpose); setNotice("Batch details saved.");
    } catch (err) { setError(err instanceof Error ? err.message : "Could not save batch."); }
    finally { setBusy(false); }
  }

  async function process(action: "enrich" | "assess") {
    if (busy || dirty) return;
    const targets = action === "enrich" ? enrichTargets : assessTargets;
    if (!targets.length) return;
    setBusy(true); setError(null); setNotice(null); setFailures([]);
    let succeeded = 0;
    const errors: string[] = [];
    try {
      if (action === "enrich") {
        const result = await enrichSelectedOpportunities(targets, enrichOpportunity, (count) => setProgress(`Queuing ${count} of ${targets.length}…`));
        succeeded = result.started.length;
        errors.push(...result.failures.map((failure) => `${failure.name}: ${failure.error}`));
      } else {
        for (const [index, row] of targets.entries()) {
          setProgress(`Assessing ${index + 1} of ${targets.length}…`);
          try {
            const result = await analyzeOpportunity(row.id);
            if (!result.ok) throw new Error(result.error ?? "Assessment failed.");
            succeeded++;
          } catch (err) { errors.push(`${row.business_name}: ${err instanceof Error ? err.message : "Assessment failed."}`); }
        }
      }
      setFailures(errors);
      setNotice(`${succeeded} of ${targets.length} ${action === "enrich" ? "queued for enrichment" : "assessed"}.${errors.length ? ` ${errors.length} failed; retry the same batch after reviewing the errors.` : ""}`);
      await refreshRecords();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not refresh batch records."); }
    finally { setBusy(false); setProgress(""); }
  }

  if (loading) return <p className="text-sm text-slate-400">Loading batches…</p>;
  if (!id) return <div className="space-y-4">
    <h1 className="text-xl font-semibold text-slate-100">Opportunity batches</h1>
    <p className="text-sm text-slate-400">Select two or more opportunities and click Enrich selected to create a batch.</p>
    {error && <p role="alert" className="text-rose-300">{error}</p>}
    {!batches.length && !error && <p className="text-slate-500">No batches yet.</p>}
    {batches.map((item) => <Link key={item.id} to={`/batches/${item.id}`} className="block rounded-lg border border-slate-800 bg-slate-900/60 p-4 hover:border-slate-600">
      <p className="font-medium text-accent-400">{item.name}</p>
      <p className="mt-1 text-sm text-slate-400">{item.member_count ?? 0} records · {new Date(item.created_at).toLocaleString()}</p>
      {item.purpose && <p className="mt-2 text-sm text-slate-300">{item.purpose}</p>}
    </Link>)}
  </div>;
  if (!batch) return <p role="alert" className="text-rose-300">{error ?? "Batch not found."}</p>;
  return <div className="space-y-4">
    <Link className="text-sm text-accent-400" to="/batches">← All batches</Link>
    <h1 className="text-xl font-semibold text-slate-100">{batch.name}</h1>
    <section className="space-y-3 rounded-lg border border-slate-800 bg-slate-900/60 p-4">
      <label className="block text-sm text-slate-300">Name<input className={`${input} mt-1`} value={name} maxLength={120} disabled={busy} onChange={(event) => setName(event.target.value)} /></label>
      <label className="block text-sm text-slate-300">Purpose<textarea className={`${input} mt-1`} value={purpose} maxLength={2000} rows={2} disabled={busy} onChange={(event) => setPurpose(event.target.value)} /></label>
      <h2 className="text-sm font-semibold text-slate-200">Record filter</h2>
      <p className="text-xs text-slate-400">Filters control which tagged records are shown and processed. Batch membership stays fixed.</p>
      <label className="block text-sm text-slate-300">Business, location or industry<input className={`${input} mt-1`} value={filter.search} maxLength={300} disabled={busy} onChange={(event) => setFilter({ ...filter, search: event.target.value })} /></label>
      <fieldset disabled={busy}><Filters state={filter} onChange={(next) => setFilter({ ...filter, ...next })} pipelineStatusOptions={[...new Set(rows.map((row) => row.pipeline_status))]} outreachStatusOptions={[...new Set(rows.map((row) => row.outreach_status ?? "None"))]} maxScore={Math.max(1, ...rows.map((row) => Number(row.opportunity_score) || 0))} /></fieldset>
      <button className={button} type="button" disabled={busy || !dirty || !name.trim()} onClick={() => void save()}>Save batch details</button>
      {dirty && <span className="ml-3 text-xs text-amber-300">Save changes before processing records.</span>}
    </section>
    {notice && <p role="status" className="text-sm text-emerald-300">{notice}</p>}
    {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
    {!!failures.length && <ul role="alert" className="text-sm text-rose-300">{failures.map((failure, index) => <li key={index}>{failure}</li>)}</ul>}
    <div className="flex flex-wrap items-center gap-3">
      <p className="mr-auto text-sm text-slate-400">{matching.length} of {rows.length} batch records · {rows.filter((row) => row.enrichment_running).length} enriching · {rows.filter((row) => row.enrichment_ready).length} enriched · {rows.filter((row) => row.assessed_at).length} assessed</p>
      <button className={button} disabled={busy || dirty || !enrichTargets.length} onClick={() => void process("enrich")}>Enrich matching records ({enrichTargets.length})</button>
      <button className={button} disabled={busy || dirty || !assessTargets.length} onClick={() => void process("assess")}>Assess enriched records ({assessTargets.length})</button>
      <button className={button} disabled={busy} onClick={() => void refreshRecords().catch((err) => setError(err.message))}>Refresh</button>
    </div>
    {busy && progress && <p role="status" className="text-sm text-sky-300">{progress}</p>}
    <div className="overflow-x-auto rounded-lg border border-slate-800"><table className="w-full text-left text-sm text-slate-300">
      <thead className="bg-slate-900"><tr><th className="p-3">Business</th><th className="p-3">Enrichment</th><th className="p-3">Assessment</th><th className="p-3">Pipeline status</th></tr></thead>
      <tbody>{matching.map((row) => <tr key={row.id} className="border-t border-slate-800"><td className="p-3"><Link to={`/opportunities/${row.id}`} className="text-accent-400 hover:underline">{row.business_name}</Link></td><td className="p-3">{row.enrichment_running ? "Running…" : row.enrichment_ready ? "Enriched" : row.enrichment_status ?? "Not started"}</td><td className="p-3">{row.assessed_at ? "Assessed" : "Not assessed"}</td><td className="p-3">{row.pipeline_status === "disqualified" ? "Not suitable" : row.pipeline_status}</td></tr>)}</tbody>
    </table>{!matching.length && <p className="p-4 text-sm text-slate-500">No batch records match this filter.</p>}</div>
  </div>;
}
