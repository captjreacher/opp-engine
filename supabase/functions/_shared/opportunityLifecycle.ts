export type OpportunityLifecycleView = "active" | "archived" | "all";
export const PERMANENT_DELETION_UNAVAILABLE = "Permanent deletion is unavailable. Verified administrator access and a reviewed retention policy are required to protect evidence, history and contact safeguards. Archive this opportunity instead.";
export const LIFECYCLE_CAPABILITIES = {
  can_archive: true,
  can_restore: true,
  can_permanently_delete: false,
  permanent_delete_reason: PERMANENT_DELETION_UNAVAILABLE,
} as const;
export function lifecycleView(value: string | null): OpportunityLifecycleView | null {
  return value === null ? "active" : value === "active" || value === "archived" || value === "all" ? value : null;
}
export function isOpportunityArchived(lead: { archived_at?: unknown; status?: unknown; pipeline_status?: unknown }): boolean {
  return Boolean(lead.archived_at) || lead.status === "archived" || lead.pipeline_status === "archived";
}
export function lifecycleMatches(archivedAt: unknown, view: OpportunityLifecycleView, status?: unknown): boolean {
  const archived = isOpportunityArchived({ archived_at: archivedAt, status });
  return view === "all" || (view === "archived" ? archived : !archived);
}
export function validateLifecyclePayload(payload: unknown): { valid: true; reason: string | null } | { valid: false } {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { valid: false };
  const input = payload as Record<string, unknown>;
  if (input.confirm !== true || Object.keys(input).some(key => !["confirm", "reason"].includes(key)) ||
    (input.reason !== undefined && (typeof input.reason !== "string" || input.reason.length > 500))) return { valid: false };
  return { valid: true, reason: typeof input.reason === "string" ? input.reason.trim() || null : null };
}
