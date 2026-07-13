import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, ApiNotConfiguredError, fetchOpportunities, isApiConfigured } from "../lib/api";
import type { OppRow } from "../lib/types";
import Badge, { toneForStatus } from "../components/Badge";
import ScoreBar from "../components/ScoreBar";
import Filters, { DEFAULT_FILTER_STATE, type FilterState } from "../components/Filters";

function parseOpportunityScore(row: OppRow): number {
  const parsed = row.opportunity_score !== null ? parseFloat(row.opportunity_score) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function assessmentStatus(row: OppRow): "Assessed" | "Pending" {
  return row.assessed_at ? "Assessed" : "Pending";
}

function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export default function OpportunityList() {
  const [rows, setRows] = useState<OppRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTER_STATE);

  async function load() {
    if (!isApiConfigured) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchOpportunities();
      setRows(res.opportunities);
    } catch (err) {
      if (err instanceof ApiNotConfiguredError) {
        setError(err.message);
      } else if (err instanceof ApiError) {
        setError(`Failed to load opportunities: ${err.message}`);
      } else {
        setError("Failed to load opportunities: unknown error.");
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pipelineStatusOptions = useMemo(
    () => Array.from(new Set(rows.map((r) => r.pipeline_status))).sort(),
    [rows],
  );
  const outreachStatusOptions = useMemo(
    () =>
      Array.from(new Set(rows.map((r) => r.outreach_status ?? "None"))).sort((a, b) =>
        a === "None" ? -1 : b === "None" ? 1 : a.localeCompare(b),
      ),
    [rows],
  );
  const maxScore = useMemo(
    () => rows.reduce((max, r) => Math.max(max, parseOpportunityScore(r)), 0),
    [rows],
  );

  const filteredSortedRows = useMemo(() => {
    return rows
      .filter((row) => parseOpportunityScore(row) >= filters.scoreThreshold)
      .filter((row) =>
        filters.pipelineStatus ? row.pipeline_status === filters.pipelineStatus : true,
      )
      .filter((row) => {
        if (filters.auditAvailability === "available") return row.has_audit;
        if (filters.auditAvailability === "none") return !row.has_audit;
        return true;
      })
      .filter((row) => {
        if (!filters.outreachStatus) return true;
        const outreach = row.outreach_status ?? "None";
        return outreach === filters.outreachStatus;
      })
      .sort((a, b) => parseOpportunityScore(b) - parseOpportunityScore(a));
  }, [rows, filters]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">Opportunities</h1>
          <p className="text-sm text-slate-500">
            {loading
              ? "Loading…"
              : `${filteredSortedRows.length} of ${rows.length} opportunit${rows.length === 1 ? "y" : "ies"}`}
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading || !isApiConfigured}
          className="flex items-center gap-1.5 rounded border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
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

      <div className="overflow-x-auto rounded-lg border border-slate-800">
        <table className="min-w-full divide-y divide-slate-800 text-sm">
          <thead className="bg-slate-900/80">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-slate-400">Business</th>
              <th className="px-3 py-2 text-left font-medium text-slate-400">Location</th>
              <th className="px-3 py-2 text-left font-medium text-slate-400">Industry</th>
              <th className="px-3 py-2 text-left font-medium text-slate-400">
                Opportunity Score
              </th>
              <th className="px-3 py-2 text-left font-medium text-slate-400">
                Pipeline Status
              </th>
              <th className="px-3 py-2 text-left font-medium text-slate-400">
                Assessment
              </th>
              <th className="px-3 py-2 text-left font-medium text-slate-400">Audit</th>
              <th className="px-3 py-2 text-left font-medium text-slate-400">Outreach</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/70 bg-slate-950/40">
            {filteredSortedRows.map((row) => {
              const score = parseOpportunityScore(row);
              const status = assessmentStatus(row);
              return (
                <tr key={row.id} className="hover:bg-slate-900/50">
                  <td className="px-3 py-2.5">
                    <Link
                      to={`/opportunities/${row.id}`}
                      className="font-medium text-slate-100 hover:text-accent-400 hover:underline"
                    >
                      {row.business_name}
                    </Link>
                    <div className="text-xs text-slate-500">
                      updated {formatTimestamp(row.updated_at)}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-slate-300">{row.location ?? "—"}</td>
                  <td className="px-3 py-2.5 text-slate-300">{row.industry ?? "—"}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="w-14 font-mono text-sm font-semibold text-slate-100">
                        {score.toFixed(2)}
                      </span>
                      <ScoreBar
                        value={score}
                        max={Math.max(maxScore, 1)}
                        compact
                        showValue={false}
                      />
                    </div>
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
                    <Badge tone={row.has_audit ? "info" : "neutral"}>
                      {row.has_audit ? "Available" : "—"}
                    </Badge>
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge tone={toneForStatus(row.outreach_status)}>
                      {row.outreach_status ?? "None"}
                    </Badge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {!loading && rows.length === 0 && !error && (
          <div className="p-8 text-center text-sm text-slate-500">
            No opportunities found.
          </div>
        )}
        {!loading && rows.length > 0 && filteredSortedRows.length === 0 && (
          <div className="p-8 text-center text-sm text-slate-500">
            No opportunities match the current filters.
          </div>
        )}
      </div>
    </div>
  );
}
