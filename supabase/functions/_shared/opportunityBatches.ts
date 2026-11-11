export interface BatchRecordFilter {
  search: string;
  scoreThreshold: number;
  pipelineStatus: string;
  reportAvailability: "all" | "available" | "none";
  outreachStatus: string;
}
export const DEFAULT_BATCH_FILTER: BatchRecordFilter = { search: "", scoreThreshold: 0, pipelineStatus: "", reportAvailability: "all", outreachStatus: "" };

export function validateBatchFilter(value: unknown): BatchRecordFilter {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Record filter must be an object.");
  // Historical audit filters are retained in storage but no longer constrain outreach work.
  const {auditAvailability: _legacyAudit, ...current} = value as Record<string,unknown>;
  const filter = { ...DEFAULT_BATCH_FILTER, ...current };
  if (Object.keys(current).some((key) => !(key in DEFAULT_BATCH_FILTER))) throw new Error("Unknown record filter field.");
  if (typeof filter.scoreThreshold !== "number" || !Number.isFinite(filter.scoreThreshold) || filter.scoreThreshold < 0 || filter.scoreThreshold > 10000) throw new Error("Invalid minimum score.");
  for (const key of ["search", "pipelineStatus", "outreachStatus"] as const) {
    if (typeof filter[key] !== "string" || filter[key].length > 300) throw new Error("Invalid record filter text.");
  }
  if (!["all", "available", "none"].includes(filter.reportAvailability)) throw new Error("Invalid scenario report filter.");
  return filter;
}

export function matchesBatchFilter(row: { business_name: string; location: string | null; industry: string | null; opportunity_score: string | null; pipeline_status: string; has_scenario_report?: boolean; outreach_status: string | null }, filter: BatchRecordFilter): boolean {
  const search = filter.search.trim().toLowerCase();
  if (search && ![row.business_name, row.location, row.industry].some((value) => value?.toLowerCase().includes(search))) return false;
  if (filter.scoreThreshold > 0 && !(Number(row.opportunity_score) >= filter.scoreThreshold)) return false;
  if (filter.pipelineStatus && row.pipeline_status !== filter.pipelineStatus) return false;
  if (filter.reportAvailability === "available" && !row.has_scenario_report) return false;
  if (filter.reportAvailability === "none" && row.has_scenario_report) return false;
  return !filter.outreachStatus || (row.outreach_status ?? "None") === filter.outreachStatus;
}
