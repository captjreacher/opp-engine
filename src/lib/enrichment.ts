export const ENRICHMENT_POLL_INTERVAL_MS = 2_500;
export const ENRICHMENT_POLL_TIMEOUT_MS = 90_000;

const TERMINAL_ENRICHMENT_STATUSES = new Set(["enriched", "partial", "failed"]);

export function isEnrichmentRunning(status: string | null | undefined): boolean {
  return status === "enriching";
}

export function isTerminalEnrichmentStatus(
  status: string | null | undefined,
): boolean {
  return status !== null && status !== undefined && TERMINAL_ENRICHMENT_STATUSES.has(status);
}
