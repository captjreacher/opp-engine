import { isOpportunityArchived } from "../../supabase/functions/_shared/opportunityLifecycle";
import OpportunityActions from "../components/OpportunityActions";
import { lifecycleView, lifecycleMatches } from "../../supabase/functions/_shared/opportunityLifecycle";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ApiError,
  ApiNotConfiguredError,
  fetchOpportunities,
  isApiConfigured,
  enrichOpportunity,
  createOpportunityBatch,
} from "../lib/api";
import type { OppRow } from "../lib/types";
import { canSelectOpportunity, enrichSelectedOpportunities, toggleOpportunitySelection } from "../lib/bulk-enrichment";
import Badge, { toneForStatus } from "../components/Badge";
import ScoreBar from "../components/ScoreBar";
import Filters, {
  DEFAULT_FILTER_STATE,
  type FilterState,
} from "../components/Filters";

function parseOpportunityScore(row: OppRow): number | null {
  const parsed =
    row.opportunity_score !== null ? parseFloat(row.opportunity_score) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function assessmentStatus(row: OppRow): "Assessed" | "Not assessed" {
  return row.assessed_at ? "Assessed" : "Not assessed";
}

function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function OpportunityList() {
  const [params, setParams] = useSearchParams();
  const view = lifecycleView(params.get("lifecycle")) ?? "active";
  const search = params.get("search") ?? "";
  const loadVersion = useRef(0);
  function changeQuery(key: string, value: string) {
    const next = new URLSearchParams(params); value ? next.set(key, value) : next.delete(key);
    setParams(next, { replace: true });
  }
  const [rows, setRows] = useState<OppRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkPending, setBulkPending] = useState(false);
  const [bulkProgress, setBulkProgress] = useState(0);
  const [bulkTotal, setBulkTotal] = useState(0);
  const [bulkFailures, setBulkFailures] = useState<{ id: string; name: string; error: string }[]>([]);
  const [createdBatch, setCreatedBatch] = useState<{ id: string; name: string } | null>(null);
  const pendingBatch = useRef<{ key: string; id: string; name: string } | null>(null);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTER_STATE);

  async function load() {
    if (!isApiConfigured) return;

    const version = ++loadVersion.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchOpportunities(view);
      if (version !== loadVersion.current) return;
      setRows(res.opportunities);
      setSelected((current) => new Set([...current].filter((id) => res.opportunities.some((row) => row.id === id && canSelectOpportunity(row)))));
    } catch (err) {
      if (version !== loadVersion.current) return;
      if (err instanceof ApiNotConfiguredError) {
        setError(err.message);
      } else if (err instanceof ApiError) {
        setError(`Failed to load opportunities: ${err.message}`);
      } else {
        setError("Failed to load opportunities: unknown error.");
      }
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }

  useEffect(() => {
    setSelected(new Set());
    void load();
    return () => { loadVersion.current += 1; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  useEffect(() => {
    if (!rows.some((row) => row.enrichment_running)) return;
    const timer = setInterval(() => void load(), 5_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.some((row) => row.enrichment_running), view]);

  async function runBulkEnrichment() {
    if (bulkPending) return;
    const targets = rows.filter((row) => selected.has(row.id));
    if (!targets.length) return;
    setBulkPending(true);
    setBulkProgress(0);
    setBulkTotal(targets.length);
    setBulkFailures([]);
    setNotice(null);
    setError(null);
    try {
      if (targets.length > 1) {
        const key = targets.map((row) => row.id).sort().join(",");
        if (pendingBatch.current?.key !== key) pendingBatch.current = { key, id: crypto.randomUUID(), name: `Batch ${new Date().toLocaleString()}` };
        const result = await createOpportunityBatch({ id: pendingBatch.current.id, name: pendingBatch.current.name, lead_ids: targets.map((row) => row.id), record_filter: { search: "", ...filters } });
        setCreatedBatch(result.batch);
        pendingBatch.current = null;
      }
      const result = await enrichSelectedOpportunities(targets, enrichOpportunity, setBulkProgress);
      setSelected((current) => toggleOpportunitySelection(current, result.started, false));
      setBulkFailures(result.failures);
      setNotice(`${result.started.length} of ${targets.length} selected opportunities queued for enrichment.${result.failures.length ? ` ${result.failures.length} failed to start; details below.` : " Status will refresh automatically."}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Batch creation failed. Enrichment was not started.");
    } finally {
      setBulkPending(false);
    }
  }

  const pipelineStatusOptions = useMemo(
    () => Array.from(new Set(rows.map((r) => r.pipeline_status))).sort(),
    [rows],
  );

  const outreachStatusOptions = useMemo(
    () =>
      Array.from(new Set(rows.map((r) => r.outreach_status ?? "None"))).sort(
        (a, b) =>
          a === "None" ? -1 : b === "None" ? 1 : a.localeCompare(b),
      ),
    [rows],
  );

  const maxScore = useMemo(
    () =>
      rows.reduce(
        (max, row) => Math.max(max, parseOpportunityScore(row) ?? 0),
        0,
      ),
    [rows],
  );

  const filteredSortedRows = useMemo(() => {
    return rows
      .filter((row) => lifecycleMatches(row.archived_at, view, row.pipeline_status))
      .filter((row) => !search.trim() || [row.business_name, row.location, row.industry].some(value => value?.toLowerCase().includes(search.trim().toLowerCase())))
.filter((row) => {
  const score = parseOpportunityScore(row);

  // A zero threshold means "no minimum score filter".
  // Unassessed opportunities therefore remain visible.
  if (filters.scoreThreshold <= 0) {
    return true;
  }

  // When a real minimum is selected, only assessed
  // opportunities meeting that threshold qualify.
  return score !== null && score >= filters.scoreThreshold;
})
      .filter((row) =>
        filters.pipelineStatus
          ? row.pipeline_status === filters.pipelineStatus
          : true,
      )
      .filter((row) => {
        if (filters.reportAvailability === "available") return row.has_scenario_report;
        if (filters.reportAvailability === "none") return !row.has_scenario_report;
        return true;
      })
      .filter((row) => {
        if (!filters.outreachStatus) return true;
        const outreach = row.outreach_status ?? "None";
        return outreach === filters.outreachStatus;
      })
      .sort(
        (a, b) =>
          (parseOpportunityScore(b) ?? Number.NEGATIVE_INFINITY) -
          (parseOpportunityScore(a) ?? Number.NEGATIVE_INFINITY),
      );
  }, [rows, filters, view, search]);

  const selectableVisible = filteredSortedRows.filter(canSelectOpportunity);
  const visibleSelectedCount = filteredSortedRows.filter((row) => selected.has(row.id)).length;
  const allVisibleSelected = selectableVisible.length > 0 && selectableVisible.every((row) => selected.has(row.id));
  const selectionBusy = bulkPending;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-graphite-100">
            Opportunities
          </h1>
          <p className="text-sm text-graphite-500">
            {loading
              ? "Loading…"
              : `${filteredSortedRows.length} of ${rows.length} opportunit${rows.length === 1 ? "y" : "ies"}`}
          </p>
        </div>

        <button
          type="button"
          onClick={() => void load()}
          disabled={loading || !isApiConfigured}
          className="flex items-center gap-1.5 rounded border border-graphite-700 bg-graphite-900 px-3 py-1.5 text-sm font-medium text-graphite-200 transition-colors hover:bg-graphite-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
            aria-hidden="true"
          >
            <path
              d="M4 4v6h6M20 20v-6h-6M4.5 15a8 8 0 0014.9 2.5M19.5 9A8 8 0 004.6 6.5"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Refresh
        </button>
      </div>

      <div className="grid gap-3 rounded-lg border border-graphite-800 bg-graphite-900/60 p-3 sm:grid-cols-2">
        <div>
          <label htmlFor="lifecycle-view" className="text-xs text-graphite-400">Opportunity lifecycle</label>
          <select id="lifecycle-view" className="mt-1 block min-h-9 w-full rounded border border-graphite-700 bg-graphite-950 px-2 text-sm text-graphite-100" value={view} onChange={(event) => changeQuery("lifecycle", event.target.value)}>
            <option value="active">Active opportunities</option><option value="archived">Archived opportunities</option><option value="all">All opportunities</option>
          </select>
        </div>
        <label className="text-xs text-graphite-400">Search opportunities
          <input type="search" placeholder="Business, location or category" value={search} onChange={(event) => changeQuery("search", event.target.value)} className="mt-1 block min-h-9 w-full rounded border border-graphite-700 bg-graphite-950 px-2 text-sm text-graphite-100" />
        </label>
      </div>

      {notice && <p role="status" className="text-sm text-emerald-300">{notice}</p>}
      {createdBatch && <Link className="block text-sm text-accent-400 hover:underline" to={`/batches/${createdBatch.id}`}>Open {createdBatch.name} — edit details and assess enriched records</Link>}
      {bulkFailures.length > 0 && <ul role="alert" className="rounded border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">
        {bulkFailures.map((failure) => <li key={failure.id}>{failure.name}: {failure.error}</li>)}
      </ul>}
      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {rows.length > 0 && (
        <Filters
          state={filters}
          onChange={setFilters}
          pipelineStatusOptions={pipelineStatusOptions}
          outreachStatusOptions={outreachStatusOptions}
          maxScore={maxScore}
        />
      )}

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-graphite-800 bg-graphite-900/60 p-3">
        <span className="mr-auto text-sm text-graphite-300">{selected.size} selected{selected.size > visibleSelectedCount ? ` (${selected.size - visibleSelectedCount} hidden by filters)` : ""}</span>
        {selected.size > 1 && <span className="text-xs text-graphite-400">Enriching this selection creates a batch.</span>}
        <button type="button" disabled={selectionBusy || !selected.size} onClick={() => setSelected(new Set())}
          className="rounded border border-graphite-600 px-3 py-1.5 text-sm text-graphite-200 disabled:opacity-50">Clear selection</button>
        <button type="button" onClick={() => void runBulkEnrichment()} disabled={selectionBusy || loading || !selected.size}
          className="oe-primary rounded bg-accent-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-500 disabled:opacity-50">
          {bulkPending ? `Queuing ${bulkProgress} of ${bulkTotal}…` : `Enrich selected (${selected.size})`}
        </button>
      </div>
      <div className="overflow-x-auto rounded-lg border border-graphite-800">
        <table className="min-w-full divide-y divide-graphite-800 text-sm">
          <thead className="bg-graphite-900/80">
            <tr>
              <th className="px-3 py-2">
                <input type="checkbox" aria-label="Select all visible eligible opportunities" checked={allVisibleSelected}
                  ref={(input) => { if (input) input.indeterminate = !allVisibleSelected && selectableVisible.some((row) => selected.has(row.id)); }}
                  disabled={selectionBusy || !selectableVisible.length}
                  onChange={(event) => setSelected((current) => toggleOpportunitySelection(current, selectableVisible.map((row) => row.id), event.target.checked))}
                  className="h-4 w-4 accent-sky-500" />
              </th>
              <th className="px-3 py-2 text-left font-medium text-graphite-400">
                Business
              </th>
              <th className="px-3 py-2 text-left font-medium text-graphite-400">
                Location
              </th>
              <th className="px-3 py-2 text-left font-medium text-graphite-400">
                Industry
              </th>
              <th className="px-3 py-2 text-left font-medium text-graphite-400">
                Opportunity Score
              </th>
              <th className="px-3 py-2 text-left font-medium text-graphite-400">
                Pipeline Status
              </th>
              <th className="px-3 py-2 text-left font-medium text-graphite-400">
                Assessment
              </th>
              <th className="px-3 py-2 text-left font-medium text-graphite-400">
                Reports
              </th>
              <th className="px-3 py-2 text-left font-medium text-graphite-400">
                Outreach
              </th>
              <th className="px-3 py-2 text-left text-graphite-400">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-graphite-800/70 bg-graphite-950/40">
            {filteredSortedRows.map((row) => {
              const score = parseOpportunityScore(row);
              const status = assessmentStatus(row);

              return (
                <tr key={row.id} className={selected.has(row.id) ? "oe-selected bg-accent-500/10 hover:bg-accent-500/15" : "hover:bg-graphite-900/50"}>
                  <td className="px-3 py-2.5">
                    <input type="checkbox" aria-label={`Select ${row.business_name}`} checked={selected.has(row.id)}
                      disabled={selectionBusy || !canSelectOpportunity(row)}
                      title={row.batches?.some(batch=>batch.active) ? `Already in active batch: ${row.batches.filter(batch=>batch.active).map(batch=>batch.name).join(", ")}. Open the record to move it explicitly.` : !canSelectOpportunity(row) ? "Archived, already enriching or marked not suitable" : undefined}
                      onChange={(event) => setSelected((current) => toggleOpportunitySelection(current, [row.id], event.target.checked))}
                      className="h-4 w-4 accent-sky-500" />
                  </td>
                  <td className="px-3 py-2.5">
                    <Link
                      to={`/opportunities/${row.id}`}
                      className="inline-block font-medium text-graphite-100 hover:text-accent-400 hover:underline"
                    >
                      {row.business_name}
                    </Link>
                    {row.company_scenarios?.map(match=><span key={match.scenario_key} className="mr-2 text-xs text-slate-400">{match.scenario_key}: {match.state}</span>)}
                    {isOpportunityArchived(row) && <span className="ml-2"><Badge>Archived</Badge></span>}
                    {row.batches?.map((batch) => <Link key={batch.id} to={`/batches/${batch.id}`} className="mt-1 mr-2 inline-block rounded bg-violet-500/15 px-2 py-0.5 text-xs text-violet-300 hover:underline">{batch.name}</Link>)}
                    <div className="text-xs text-graphite-500">
                      updated {formatTimestamp(row.updated_at)}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-graphite-300">
                    {row.location ?? "—"}
                  </td>
                  <td className="px-3 py-2.5 text-graphite-300">
                    {row.industry ?? "—"}
                  </td>
                  <td className="px-3 py-2.5">
                    {score !== null ? (
                      <div className="flex items-center gap-2">
                        <span className="w-14 font-mono text-sm font-semibold text-graphite-100">
                          {score.toFixed(2)}
                        </span>
                        <ScoreBar
                          value={score}
                          max={Math.max(maxScore, 1)}
                          compact
                          showValue={false}
                        />
                      </div>
                    ) : (
                      <span className="text-sm text-graphite-500">
                        Not assessed
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge tone={toneForStatus(row.pipeline_status)}>
                      {row.pipeline_status}
                    </Badge>
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge tone={status === "Assessed" ? "success" : "warning"}>
                      {status}
                    </Badge>
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge tone={row.has_scenario_report ? "info" : "neutral"}>
                      {row.has_scenario_report ? "Available" : "—"}
                    </Badge>
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge tone={toneForStatus(row.outreach_status)}>
                      {row.outreach_status ?? "None"}
                    </Badge>
                  </td>
                  <td className="px-3 py-2.5"><OpportunityActions opportunity={row} disabled={selectionBusy} onChanged={async () => { await load(); setNotice(isOpportunityArchived(row) ? "Opportunity restored." : "Opportunity archived."); }} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {!loading && rows.length === 0 && !error && (
          <div className="p-8 text-center text-sm text-graphite-500">
            No opportunities found.
          </div>
        )}

        {!loading && rows.length > 0 && filteredSortedRows.length === 0 && (
          <div className="p-8 text-center text-sm text-graphite-500">
            No opportunities match current filters.
          </div>
        )}
      </div>
    </div>
  );
}
