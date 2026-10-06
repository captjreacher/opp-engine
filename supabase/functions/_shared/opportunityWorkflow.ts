export function enrichmentReadiness(status: unknown, diagnostics: unknown, now = Date.now()) {
  const source = (diagnostics ?? {}) as { queue_requested_at?: unknown; enrichment_execution?: { started_at?: unknown }; enrichment_result?: unknown };
  const queued = typeof source.queue_requested_at === "string" ? Date.parse(source.queue_requested_at) : NaN;
  const executionStarted = source.enrichment_execution?.started_at;
  const started = Number.isFinite(queued) ? queued : typeof executionStarted === "string" ? Date.parse(executionStarted) : NaN;
  const running = status === "enriching" && Number.isFinite(started) && now - started < 180_000;
  return { running, ready: !running && !!source.enrichment_result };
}

export function assessmentIsCurrent(assessedAt: unknown, diagnostics: unknown): boolean {
  const source = diagnostics as { enrichment_result?: { observed_at?: unknown } } | null;
  const observedAt = source?.enrichment_result?.observed_at;
  const enriched = typeof observedAt === "string" ? Date.parse(observedAt) : NaN;
  const assessed = typeof assessedAt === "string" ? Date.parse(assessedAt) : NaN;
  return !Number.isFinite(enriched) || (Number.isFinite(assessed) && assessed >= enriched);
}
