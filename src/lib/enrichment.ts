export const ENRICHMENT_POLL_INTERVAL_MS = 2_500;
export const ENRICHMENT_POLL_TIMEOUT_MS = 90_000;

/**
 * How long an `enriching` lead may stay un-terminal before the console treats
 * the run as abandoned.
 *
 * Mirrors STALE_ENRICHMENT_AFTER_MS in
 * supabase/functions/_shared/enrichmentBudget.ts and the 3-minute window in
 * supabase/migrations/20260915120000_opportunity_enrichment_budget_recovery.sql.
 * A contract test asserts the three stay in sync.
 *
 * Why 180s: inside the 110s pg_net envelope the function hard-stops provider
 * work at 80s, so by 180s the invocation is provably gone. A lead still marked
 * `enriching` past that point is stale — the console must stop spinning and offer
 * a retry instead of waiting forever.
 */
export const ENRICHMENT_STALE_AFTER_MS = 180_000;

const TERMINAL_ENRICHMENT_STATUSES = new Set(["enriched", "partial", "failed"]);

export function isEnrichmentRunning(status: string | null | undefined): boolean {
  return status === "enriching";
}

export function isTerminalEnrichmentStatus(
  status: string | null | undefined,
): boolean {
  return status !== null && status !== undefined && TERMINAL_ENRICHMENT_STATUSES.has(status);
}

type EnrichmentDiagnosticsLike = {
  queue_requested_at?: unknown;
  enrichment_execution?: {
    started_at?: unknown;
    finished_at?: unknown;
  } | null;
};

function parseTimestampMs(value: unknown): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * When the current enrichment run was queued (or, for direct invocations,
 * started). Null when the lead carries no run record at all.
 */
export function enrichmentRunStartedAtMs(diagnostics: unknown): number | null {
  const source: EnrichmentDiagnosticsLike = (diagnostics ?? {}) as EnrichmentDiagnosticsLike;
  const execution = source.enrichment_execution ?? null;
  return (
    parseTimestampMs(source.queue_requested_at) ??
    parseTimestampMs(execution?.started_at) ??
    null
  );
}

/**
 * True when a lead is marked `enriching` but the run can no longer be live.
 *
 * A request timeout or crash cannot run its own cleanup, so the console must
 * decide this from the data alone: a missing run record or one older than
 * ENRICHMENT_STALE_AFTER_MS is stale.
 */
export function isEnrichmentStale(
  status: string | null | undefined,
  diagnostics: unknown,
  nowMs: number = Date.now(),
): boolean {
  if (!isEnrichmentRunning(status)) return false;
  const startedAtMs = enrichmentRunStartedAtMs(diagnostics);
  if (startedAtMs === null) return true;
  return nowMs - startedAtMs >= ENRICHMENT_STALE_AFTER_MS;
}
