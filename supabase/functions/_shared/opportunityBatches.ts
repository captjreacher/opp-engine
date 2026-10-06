export interface BatchRecordFilter {
  search: string;
  scoreThreshold: number;
  pipelineStatus: string;
  auditAvailability: "all" | "available" | "none";
  outreachStatus: string;
}
export const DEFAULT_BATCH_FILTER: BatchRecordFilter = { search: "", scoreThreshold: 0, pipelineStatus: "", auditAvailability: "all", outreachStatus: "" };

export function validateBatchFilter(value: unknown): BatchRecordFilter {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Record filter must be an object.");
  const filter = { ...DEFAULT_BATCH_FILTER, ...value };
  if (Object.keys(value).some((key) => !(key in DEFAULT_BATCH_FILTER))) throw new Error("Unknown record filter field.");
  if (typeof filter.scoreThreshold !== "number" || !Number.isFinite(filter.scoreThreshold) || filter.scoreThreshold < 0 || filter.scoreThreshold > 10000) throw new Error("Invalid minimum score.");
  for (const key of ["search", "pipelineStatus", "outreachStatus"] as const) {
    if (typeof filter[key] !== "string" || filter[key].length > 300) throw new Error("Invalid record filter text.");
  }
  if (!["all", "available", "none"].includes(filter.auditAvailability)) throw new Error("Invalid audit filter.");
  return filter;
}

export function matchesBatchFilter(row: { business_name: string; location: string | null; industry: string | null; opportunity_score: string | null; pipeline_status: string; has_audit: boolean; outreach_status: string | null }, filter: BatchRecordFilter): boolean {
  const search = filter.search.trim().toLowerCase();
  if (search && ![row.business_name, row.location, row.industry].some((value) => value?.toLowerCase().includes(search))) return false;
  if (filter.scoreThreshold > 0 && !(Number(row.opportunity_score) >= filter.scoreThreshold)) return false;
  if (filter.pipelineStatus && row.pipeline_status !== filter.pipelineStatus) return false;
  if (filter.auditAvailability === "available" && !row.has_audit) return false;
  if (filter.auditAvailability === "none" && row.has_audit) return false;
  return !filter.outreachStatus || (row.outreach_status ?? "None") === filter.outreachStatus;
}
