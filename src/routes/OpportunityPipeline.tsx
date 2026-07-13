import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, ApiNotConfiguredError, fetchPipeline, isApiConfigured } from "../lib/api";
import type { OutcomeState, PipelineMetrics, PipelineOpportunity } from "../lib/types";

function errorMessage(err: unknown): string {
  if (err instanceof ApiNotConfiguredError) return err.message;
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Unknown error.";
}

// 5 Kanban columns. "Sent" holds both sent + awaiting_response (post-send, pre-reply);
// the precise sub-state is shown on the card.
const COLUMNS: { key: string; label: string; states: OutcomeState[] }[] = [
  { key: "sent", label: "Sent", states: ["sent", "awaiting_response"] },
  { key: "replied", label: "Replied", states: ["replied"] },
  { key: "meetings", label: "Meetings", states: ["meeting_booked"] },
  { key: "converted", label: "Converted", states: ["converted"] },
  { key: "closed", label: "Closed", states: ["closed"] },
];

const METRICS: { key: keyof PipelineMetrics; label: string }[] = [
  { key: "total_opportunities", label: "Opportunities" },
  { key: "audited_opportunities", label: "Audited" },
  { key: "drafts_created", label: "Drafts" },
  { key: "emails_sent", label: "Emails sent" },
  { key: "replies", label: "Replies" },
  { key: "meetings", label: "Meetings" },
  { key: "conversions", label: "Conversions" },
];

function scoreLabel(v: string | null): string {
  if (v === null) return "—";
  const n = parseFloat(v);
  return Number.isFinite(n) ? String(Math.round(n)) : "—";
}

export default function OpportunityPipeline() {
  const [metrics, setMetrics] = useState<PipelineMetrics | null>(null);
  const [rows, setRows] = useState<PipelineOpportunity[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!isApiConfigured) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchPipeline();
      setMetrics(res.metrics);
      setRows(res.opportunities);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const byColumn = useMemo(() => {
    const map: Record<string, PipelineOpportunity[]> = {};
    for (const col of COLUMNS) map[col.key] = [];
    for (const row of rows) {
      const col = COLUMNS.find((c) => c.states.includes(row.outcome_state));
      if (col) map[col.key].push(row);
    }
    return map;
  }, [rows]);

  if (!isApiConfigured) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-8 text-center text-slate-400">
        API is not configured. See the banner above.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-100">Pipeline</h1>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="rounded border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-accent-500 hover:text-accent-300 disabled:opacity-50"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {/* Summary metrics */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {METRICS.map((m) => (
          <div key={m.key} className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
            <div className="text-2xl font-bold text-slate-100">{metrics ? metrics[m.key] : "—"}</div>
            <div className="text-xs text-slate-500">{m.label}</div>
          </div>
        ))}
      </div>

      {/* Kanban */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {COLUMNS.map((col) => {
          const cards = byColumn[col.key] ?? [];
          return (
            <div key={col.key} className="rounded-lg border border-slate-800 bg-slate-900/40">
              <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
                <span className="text-sm font-semibold text-slate-200">{col.label}</span>
                <span className="rounded bg-slate-800 px-1.5 text-xs text-slate-400">{cards.length}</span>
              </div>
              <div className="space-y-2 p-2">
                {cards.length === 0 ? (
                  <p className="px-1 py-4 text-center text-xs text-slate-600">—</p>
                ) : (
                  cards.map((card) => (
                    <Link
                      key={card.id}
                      to={`/opportunities/${card.id}`}
                      className="block rounded border border-slate-800 bg-slate-950/60 p-2.5 transition-colors hover:border-accent-500/60"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-sm font-medium text-slate-100">{card.business_name}</span>
                        <span className="shrink-0 rounded bg-accent-500/15 px-1.5 text-xs font-semibold text-accent-300">
                          {scoreLabel(card.opportunity_score)}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-2 text-xs text-slate-500">
                        <span className="truncate">{card.industry ?? "—"}</span>
                        {card.outcome_state !== col.states[0] && (
                          <span className="shrink-0 text-amber-400">
                            {card.outcome_state.replace(/_/g, " ")}
                          </span>
                        )}
                      </div>
                    </Link>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      {!loading && rows.length === 0 && (
        <p className="text-sm text-slate-500">
          No opportunities have entered the pipeline yet. Send an approved outreach to place an opportunity here.
        </p>
      )}
    </div>
  );
}
