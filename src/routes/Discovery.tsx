import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Badge, { toneForStatus } from "../components/Badge";
import {
  assessDiscoveryCandidates,
  auditDiscoveryCandidates,
  fetchDiscoveryCandidates,
  fetchDiscoveryRun,
  importDiscoveryCandidates,
  startDiscoveryRun,
} from "../lib/api";
import { isActiveDiscoveryStatus, validateDiscoveryInput } from "../lib/discovery";
import type { DiscoveryCandidate, DiscoveryRun, DiscoverySearchInput } from "../lib/types";

const initialForm: DiscoverySearchInput = {
  location: "",
  industry: "",
  keywords: "",
  radius_m: null,
  result_limit: 10,
};

const fieldClass = "mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-accent-500";
const buttonClass = "rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-medium text-slate-100 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40";

function displayError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function statusTone(status: string) {
  if (["completed", "enriched", "scored", "audited", "imported"].includes(status)) return "success" as const;
  if (["failed", "partially_completed", "incomplete"].includes(status)) return "danger" as const;
  if (["queued", "discovering", "enriching", "scoring", "auditing"].includes(status)) return "info" as const;
  if (["existing", "duplicate"].includes(status)) return "warning" as const;
  return toneForStatus(status);
}

function CandidateDrawer({ candidate, onClose }: { candidate: DiscoveryCandidate; onClose: () => void }) {
  const evidence = candidate.source_payload;
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-950/70" role="dialog" aria-modal="true" aria-label="Candidate detail">
      <div className="h-full w-full max-w-xl overflow-y-auto border-l border-slate-700 bg-slate-900 p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div><p className="text-xs uppercase tracking-wider text-accent-400">Candidate</p><h2 className="mt-1 text-xl font-semibold text-white">{candidate.business_name}</h2></div>
          <button className={buttonClass} onClick={onClose}>Close</button>
        </div>
        <dl className="mt-6 grid grid-cols-[9rem_1fr] gap-x-4 gap-y-3 text-sm">
          <dt className="text-slate-500">Address</dt><dd className="text-slate-200">{candidate.address ?? candidate.location ?? "—"}</dd>
          <dt className="text-slate-500">Category</dt><dd className="text-slate-200">{candidate.industry ?? "—"}</dd>
          <dt className="text-slate-500">Website</dt><dd>{candidate.website_url ? <a className="text-accent-400 hover:underline" href={candidate.website_url} target="_blank" rel="noreferrer">{candidate.website_url}</a> : "—"}</dd>
          <dt className="text-slate-500">Phone</dt><dd className="text-slate-200">{candidate.phone ?? "—"}</dd>
          <dt className="text-slate-500">Email</dt><dd className="text-slate-200">{candidate.email ?? "—"}</dd>
          <dt className="text-slate-500">Source</dt><dd className="text-slate-200">{candidate.source} · {candidate.source_identifier}</dd>
          <dt className="text-slate-500">Duplicate</dt><dd>{candidate.duplicate_lead_id ? <Link className="text-amber-300 hover:underline" to={`/opportunities/${candidate.duplicate_lead_id}`}>Existing opportunity</Link> : "No match"}</dd>
          <dt className="text-slate-500">Assessment</dt><dd><Badge tone={statusTone(candidate.assessment_status)}>{candidate.assessment_status}</Badge>{candidate.preliminary_score ? ` · ${candidate.preliminary_score}` : ""}</dd>
          <dt className="text-slate-500">Audit</dt><dd><Badge tone={statusTone(candidate.audit_status)}>{candidate.audit_status}</Badge></dd>
        </dl>
        <section className="mt-7"><h3 className="text-sm font-semibold text-slate-200">Provider evidence</h3><pre className="mt-2 max-h-64 overflow-auto rounded-md bg-slate-950 p-3 text-xs text-slate-400">{JSON.stringify(evidence, null, 2)}</pre></section>
        <section className="mt-7"><h3 className="text-sm font-semibold text-slate-200">Enrichment evidence</h3><pre className="mt-2 max-h-64 overflow-auto rounded-md bg-slate-950 p-3 text-xs text-slate-400">{JSON.stringify(candidate.enrichment_evidence, null, 2)}</pre></section>
        <section className="mt-7"><h3 className="text-sm font-semibold text-slate-200">Preliminary signals</h3><pre className="mt-2 max-h-48 overflow-auto rounded-md bg-slate-950 p-3 text-xs text-slate-400">{JSON.stringify(candidate.preliminary_signals, null, 2)}</pre></section>
        <section className="mt-7"><h3 className="text-sm font-semibold text-slate-200">Errors</h3><pre className="mt-2 rounded-md bg-slate-950 p-3 text-xs text-slate-400">{JSON.stringify(candidate.error_info, null, 2)}</pre></section>
        <section className="mt-7"><h3 className="text-sm font-semibold text-slate-200">Event history</h3>{candidate.events.length ? <ol className="mt-3 space-y-3">{candidate.events.map((event) => <li key={event.id} className="border-l border-slate-700 pl-3 text-sm"><p className="text-slate-200">{event.event_type}</p><p className="text-xs text-slate-500">{new Date(event.created_at).toLocaleString()} · {event.status}</p></li>)}</ol> : <p className="mt-2 text-sm text-slate-500">No candidate events yet.</p>}</section>
      </div>
    </div>
  );
}

export default function Discovery() {
  const [form, setForm] = useState<DiscoverySearchInput>(initialForm);
  const [errors, setErrors] = useState<ReturnType<typeof validateDiscoveryInput>>({});
  const [run, setRun] = useState<DiscoveryRun | null>(null);
  const [candidates, setCandidates] = useState<DiscoveryCandidate[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [inspecting, setInspecting] = useState<DiscoveryCandidate | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (runId: string) => {
    const [runResponse, candidateResponse] = await Promise.all([fetchDiscoveryRun(runId), fetchDiscoveryCandidates(runId)]);
    setRun(runResponse.run);
    setCandidates(candidateResponse.candidates);
    setInspecting((current) => current ? candidateResponse.candidates.find((item) => item.id === current.id) ?? null : null);
  }, []);

  useEffect(() => {
    const latestRunId = window.sessionStorage.getItem("opp-engine:last-discovery-run");
    if (latestRunId) void reload(latestRunId).catch(() => window.sessionStorage.removeItem("opp-engine:last-discovery-run"));
  }, [reload]);

  useEffect(() => {
    if (!run || !isActiveDiscoveryStatus(run.status)) return;
    const timer = window.setInterval(() => void reload(run.id).catch((reason) => setError(displayError(reason))), 2500);
    return () => window.clearInterval(timer);
  }, [reload, run]);

  async function start() {
    const validation = validateDiscoveryInput(form);
    setErrors(validation);
    if (Object.keys(validation).length) return;
    setBusy("discover"); setError(null); setNotice(null); setCandidates([]); setSelected(new Set());
    try {
      const response = await startDiscoveryRun(form);
      window.sessionStorage.setItem("opp-engine:last-discovery-run", response.run.id);
      setRun(response.run);
      await reload(response.run.id);
      setNotice("Discovery run queued. You can continue using the console while it runs.");
    } catch (reason) { setError(displayError(reason)); }
    finally { setBusy(null); }
  }

  const selectedIds = useMemo(() => [...selected], [selected]);
  const eligible = candidates.filter((candidate) => !candidate.imported_lead_id && !candidate.duplicate_lead_id && candidate.import_status !== "incomplete");

  async function batch(action: "import" | "assess" | "audit", retry = false) {
    if (!run || !selectedIds.length) return;
    if (action === "import" && selectedIds.length > 10 && !window.confirm(`Import ${selectedIds.length} businesses into Opportunities?`)) return;
    setBusy(action); setError(null); setNotice(null);
    try {
      const response = action === "import"
        ? await importDiscoveryCandidates(run.id, selectedIds)
        : action === "assess"
          ? await assessDiscoveryCandidates(run.id, selectedIds, retry)
          : await auditDiscoveryCandidates(run.id, selectedIds, retry);
      setNotice(`${action === "import" ? "Import" : action === "assess" ? "Assessment" : "Audit"}: ${response.succeeded} succeeded, ${response.failed} failed.`);
      await reload(run.id);
    } catch (reason) { setError(displayError(reason)); await reload(run.id).catch(() => undefined); }
    finally { setBusy(null); }
  }

  return (
    <div className="space-y-6">
      <header><p className="text-xs font-medium uppercase tracking-[0.18em] text-accent-400">Intelligence intake</p><h1 className="mt-1 text-2xl font-semibold text-white">Discovery</h1><p className="mt-1 text-sm text-slate-400">Find businesses, review evidence, then deliberately import, score and audit them.</p></header>

      <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-5">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
          <label className="text-sm text-slate-300 lg:col-span-2">Location *<input className={fieldClass} value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} placeholder="e.g. Helensville, Auckland" />{errors.location && <span className="mt-1 block text-xs text-rose-400">{errors.location}</span>}</label>
          <label className="text-sm text-slate-300 lg:col-span-2">Industry or category *<input className={fieldClass} value={form.industry} onChange={(event) => setForm({ ...form, industry: event.target.value })} placeholder="e.g. electricians" />{errors.industry && <span className="mt-1 block text-xs text-rose-400">{errors.industry}</span>}</label>
          <label className="text-sm text-slate-300">Maximum results<input className={fieldClass} type="number" min={1} max={20} value={form.result_limit} onChange={(event) => setForm({ ...form, result_limit: Number(event.target.value) })} />{errors.result_limit && <span className="mt-1 block text-xs text-rose-400">{errors.result_limit}</span>}</label>
          <label className="text-sm text-slate-300 lg:col-span-3">Search keywords<input className={fieldClass} value={form.keywords} onChange={(event) => setForm({ ...form, keywords: event.target.value })} placeholder="Optional services or qualifiers" /></label>
          <label className="text-sm text-slate-300">Radius (metres)<input className={fieldClass} type="number" min={100} max={50000} value={form.radius_m ?? ""} onChange={(event) => setForm({ ...form, radius_m: event.target.value ? Number(event.target.value) : null })} placeholder="Optional" />{errors.radius_m && <span className="mt-1 block text-xs text-rose-400">{errors.radius_m}</span>}</label>
          <div className="flex items-end gap-2"><button className={`${buttonClass} border-accent-600 bg-accent-600 hover:bg-accent-500`} disabled={busy === "discover"} onClick={() => void start()}>{busy === "discover" ? "Discovering…" : "Start discovery"}</button><button className={buttonClass} onClick={() => { setForm(initialForm); setErrors({}); }}>Clear</button></div>
        </div>
      </section>

      {error && <div role="alert" className="rounded-md border border-rose-800 bg-rose-950/40 p-3 text-sm text-rose-300">{error}</div>}
      {notice && <div className="rounded-md border border-emerald-800 bg-emerald-950/30 p-3 text-sm text-emerald-300">{notice}</div>}

      {run && <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-semibold text-slate-200">Discovery run</h2><p className="mt-1 font-mono text-xs text-slate-500">{run.id}</p></div><Badge tone={statusTone(run.status)}>{run.status.replace(/_/g, " ")}</Badge></div>
        <div className="mt-4 h-1.5 overflow-hidden rounded bg-slate-800"><div className="h-full bg-accent-500 transition-all" style={{ width: `${Math.min(100, run.businesses_discovered ? 25 + (run.candidates_scored / run.businesses_discovered) * 45 + (run.audits_generated / run.businesses_discovered) * 30 : isActiveDiscoveryStatus(run.status) ? 12 : 100)}%` }} /></div>
        <dl className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4 lg:grid-cols-8">{[
          ["Stage", run.current_stage], ["Discovered", run.businesses_discovered], ["Enriched", run.candidates_enriched], ["Scored", run.candidates_scored], ["Audited", run.audits_generated], ["Failures", run.failures], ["Started", run.started_at ? new Date(run.started_at).toLocaleTimeString() : "—"], ["Completed", run.completed_at ? new Date(run.completed_at).toLocaleTimeString() : "—"],
        ].map(([label, value]) => <div key={String(label)}><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 text-slate-200">{value}</dd></div>)}</dl>
      </section>}

      <section className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900/60">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 p-4"><h2 className="mr-auto text-sm font-semibold text-slate-200">Candidates <span className="text-slate-500">({candidates.length})</span></h2><button className={buttonClass} disabled={!eligible.length} onClick={() => setSelected(new Set(eligible.map((item) => item.id)))}>Select all eligible</button><button className={buttonClass} disabled={!selectedIds.length || busy !== null} onClick={() => void batch("import")}>Import selected</button><button className={buttonClass} disabled={!selectedIds.length || busy !== null} onClick={() => void batch("assess")}>Score selected</button><button className={buttonClass} disabled={!selectedIds.length || busy !== null} onClick={() => void batch("audit")}>Generate audits</button></div>
        {!run ? <p className="p-8 text-center text-sm text-slate-500">Start a discovery run to find candidate businesses.</p> : candidates.length === 0 ? <p className="p-8 text-center text-sm text-slate-500">No businesses matched this search.</p> : <div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-slate-950/50 text-xs text-slate-500"><tr>{["", "Business", "Location", "Category", "Website", "Contact", "Duplicate", "Score", "Assessment", "Audit", "Import", ""].map((heading, index) => <th key={`${heading}-${index}`} className="px-3 py-2 text-left font-medium">{heading}</th>)}</tr></thead><tbody className="divide-y divide-slate-800">{candidates.map((candidate) => <tr key={candidate.id} className="hover:bg-slate-800/30">
          <td className="px-3 py-3"><input aria-label={`Select ${candidate.business_name}`} type="checkbox" checked={selected.has(candidate.id)} onChange={() => setSelected((current) => { const next = new Set(current); next.has(candidate.id) ? next.delete(candidate.id) : next.add(candidate.id); return next; })} /></td>
          <td className="whitespace-nowrap px-3 py-3 font-medium text-slate-200">{candidate.business_name}</td><td className="px-3 py-3 text-slate-400">{candidate.location ?? "—"}</td><td className="px-3 py-3 text-slate-400">{candidate.industry ?? "—"}</td>
          <td className="max-w-44 truncate px-3 py-3">{candidate.website_url ? <a className="text-accent-400 hover:underline" href={candidate.website_url} target="_blank" rel="noreferrer">Visit</a> : "—"}</td><td className="px-3 py-3 text-slate-400">{candidate.email ? "Email" : candidate.phone ? "Phone" : "None"}</td>
          <td className="px-3 py-3"><Badge tone={candidate.duplicate_lead_id ? "warning" : "success"}>{candidate.duplicate_lead_id ? "existing" : "new"}</Badge></td><td className="px-3 py-3 font-mono text-slate-300">{candidate.preliminary_score ?? "—"}</td>
          <td className="px-3 py-3"><Badge tone={statusTone(candidate.assessment_status)}>{candidate.assessment_status}</Badge></td><td className="px-3 py-3"><Badge tone={statusTone(candidate.audit_status)}>{candidate.audit_status}</Badge></td><td className="px-3 py-3"><Badge tone={statusTone(candidate.import_status)}>{candidate.import_status.replace(/_/g, " ")}</Badge></td>
          <td className="whitespace-nowrap px-3 py-3"><button className="text-accent-400 hover:underline" onClick={() => setInspecting(candidate)}>Inspect</button>{(candidate.imported_lead_id ?? candidate.duplicate_lead_id) && <Link className="ml-3 text-sky-400 hover:underline" to={`/opportunities/${candidate.imported_lead_id ?? candidate.duplicate_lead_id}`}>Open</Link>}</td>
        </tr>)}</tbody></table></div>}
      </section>
      {inspecting && <CandidateDrawer candidate={inspecting} onClose={() => setInspecting(null)} />}
    </div>
  );
}
