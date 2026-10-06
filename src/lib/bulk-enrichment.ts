import type { OppRow, EnrichmentResponse } from "./types";

export function canSelectOpportunity(row: OppRow): boolean {
  return row.pipeline_status !== "disqualified" && !row.enrichment_running;
}

export function toggleOpportunitySelection(selected: ReadonlySet<string>, ids: string[], checked: boolean): Set<string> {
  const next = new Set(selected);
  for (const id of ids) {
    if (checked) next.add(id); else next.delete(id);
  }
  return next;
}

export async function enrichSelectedOpportunities(
  rows: OppRow[],
  enrich: (id: string, retry: boolean) => Promise<EnrichmentResponse>,
  onProgress: (completed: number) => void,
) {
  const started: string[] = [];
  const failures: { id: string; name: string; error: string }[] = [];
  // Queue one record at a time to avoid a burst against the enrichment service.
  for (const row of rows) {
    try {
      if (!canSelectOpportunity(row)) throw new Error("This opportunity is unsuitable or already enriching.");
      const result = await enrich(row.id, Boolean(row.enrichment_ready || row.enrichment_status === "failed" || row.enrichment_status === "enriching"));
      if (!result.ok) throw new Error(result.error ?? "Enrichment could not be started.");
      started.push(row.id);
    } catch (error) {
      failures.push({ id: row.id, name: row.business_name, error: error instanceof Error ? error.message : "Enrichment could not be started." });
    }
    onProgress(started.length + failures.length);
  }
  return { started, failures };
}
