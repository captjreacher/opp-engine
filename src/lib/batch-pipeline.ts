import type { OpportunityBatch } from "./api";
import type { OppRow } from "./types";

export const BATCH_STAGES = ["Discover", "Import", "Enrich", "Assess", "Outreach"] as const;
export type BatchStage = typeof BATCH_STAGES[number];
export type ActiveBatchStage = Exclude<BatchStage, "Discover" | "Import">;
export interface ClassifiedBatch {
  batch: OpportunityBatch;
  stage: ActiveBatchStage | null;
  state: "active" | "empty" | "inactive";
  recordCount: number;
  activeCount: number;
}

/** Navigation only: fixed imported members, independent of the saved record filter. */
export function classifyBatch(batch: OpportunityBatch, members: OppRow[]): ClassifiedBatch {
  const active = members.filter((row) => row.pipeline_status !== "disqualified");
  const stage: ActiveBatchStage | null = !active.length ? null
    : active.some((row) => row.enrichment_running || !row.enrichment_ready) ? "Enrich"
    // The API clears assessed_at when newer enrichment makes it stale.
    : active.some((row) => !row.assessed_at) ? "Assess" : "Outreach";
  return { batch, stage, state: !members.length ? "empty" : !active.length ? "inactive" : "active", recordCount: members.length, activeCount: active.length };
}

export function batchPipeline(batches: OpportunityBatch[], records: OppRow[]) {
  const members = new Map<string, OppRow[]>();
  for (const row of records) {
    for (const id of new Set((row.batches ?? []).map((batch) => batch.id))) {
      const group = members.get(id) ?? [];
      group.push(row);
      members.set(id, group);
    }
  }
  const classified = batches.map((batch) => classifyBatch(batch, members.get(batch.id) ?? []));
  const groups = BATCH_STAGES.map((stage) => {
    const items = classified.filter((item) => item.stage === stage);
    return { stage, items, batchCount: items.length, recordCount: items.reduce((sum, item) => sum + item.recordCount, 0) };
  });
  return { groups, inactive: classified.filter((item) => item.state !== "active"), all: classified };
}

export function defaultBatchStage(pipeline: ReturnType<typeof batchPipeline>): ActiveBatchStage {
  return (pipeline.groups.find((group) => group.batchCount)?.stage as ActiveBatchStage | undefined) ?? "Enrich";
}
