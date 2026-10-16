import { describe, expect, it } from "vitest";
import { BATCH_STAGES, batchPipeline, classifyBatch, defaultBatchStage } from "./batch-pipeline";
import type { OpportunityBatch } from "./api";
import type { OppRow } from "./types";
import { DEFAULT_BATCH_FILTER, matchesBatchFilter } from "../../supabase/functions/_shared/opportunityBatches";
import { assessmentIsCurrent } from "../../supabase/functions/_shared/opportunityWorkflow";

export const batch = (id = "a"): OpportunityBatch => ({ id, name: `Batch ${id}`, purpose: "Purpose", created_at: "", updated_at: "", record_filter: DEFAULT_BATCH_FILTER });
export const row = (overrides: Partial<OppRow> = {}): OppRow => ({ id: "lead", business_name: "Warehouse", location: "Auckland", industry: "Retail", pipeline_status: "discovered", enrichment_ready: false, enrichment_running: false, assessed_at: null, opportunity_score: null, has_audit: false, outreach_status: null, demand_signal_score: 0, trust_leakage_score: 0, conversion_maturity_score: 0, ai_readiness_score: 0, recommended_outreach_angle: null, updated_at: "", batches: [{ id: "a", name: "Batch a" }], ...overrides });

describe("batch pipeline stages", () => {
  it("follows the API assessment currency projection after newer enrichment", () => {
    const diagnostics = { enrichment_result: { observed_at: "2026-10-02T03:00:00Z" } };
    for (const [timestamp, stage] of [["2026-10-01T03:00:00Z", "Assess"], ["2026-10-02T03:05:00Z", "Outreach"]]) {
      const assessed_at = assessmentIsCurrent(timestamp, diagnostics) ? timestamp : null;
      expect(classifyBatch(batch(), [row({ enrichment_ready: true, assessed_at })]).stage).toBe(stage);
    }
  });
  it("assigns exactly one classification to every batch including empty batches", () => {
    const pipeline = batchPipeline([batch(), batch("b"), batch("c")], [row()]);
    expect(pipeline.all.map((item) => item.batch.id).sort()).toEqual(["a", "b", "c"]);
    expect(pipeline.groups.map((group) => group.stage)).toEqual(BATCH_STAGES);
  });
  it("keeps an empty batch outside the workflow", () => {
    expect(classifyBatch(batch(), [])).toMatchObject({ stage: null, state: "empty", recordCount: 0, activeCount: 0 });
  });
  it("never assigns saved batches to upstream stages and excludes inactive batches from every tile", () => {
    const pipeline = batchPipeline([batch(), batch("empty"), batch("blocked")], [row(), row({ id: "blocked-record", pipeline_status: "disqualified", batches: [{ id: "blocked", name: "Blocked" }] })]);
    expect(pipeline.all.every((item) => item.stage !== ("Discover" as string) && item.stage !== ("Import" as string))).toBe(true);
    expect(pipeline.inactive.map((item) => item.batch.id)).toEqual(["empty", "blocked"]);
    expect(pipeline.groups.reduce((sum, group) => sum + group.batchCount, 0)).toBe(1);
    expect(pipeline.groups.reduce((sum, group) => sum + group.recordCount, 0)).toBe(1);
    expect(defaultBatchStage(pipeline)).toBe("Enrich");
    expect(defaultBatchStage(batchPipeline([batch()], [row({ enrichment_ready: true })]))).toBe("Assess");
    expect(defaultBatchStage(batchPipeline([batch()], [row({ enrichment_ready: true, assessed_at: "date" })]))).toBe("Outreach");
  });
  it("does not confuse imported lead status discovered with an unimported candidate", () => {
    expect(classifyBatch(batch(), [row()]).stage).toBe("Enrich");
    const pipeline = batchPipeline([batch()], [row()]);
    expect(pipeline.groups.slice(0, 2).map((group) => group.batchCount)).toEqual([0, 0]);
  });
  it.each(["failed", "enriched", "completed", null])("uses canonical readiness rather than enrichment status %s", (status) => {
    expect(classifyBatch(batch(), [row({ enrichment_status: status })]).stage).toBe("Enrich");
  });
  it("keeps running re-enrichment at Enrich even if old readiness is true", () => {
    expect(classifyBatch(batch(), [row({ enrichment_ready: true, enrichment_running: true, assessed_at: "date" })]).stage).toBe("Enrich");
  });
  it("advances enrichment-ready but unassessed members to Assess", () => {
    expect(classifyBatch(batch(), [row({ enrichment_ready: true })]).stage).toBe("Assess");
  });
  it.each([null, "draft", "approved", "sent"])("retains assessed members in Outreach with outreach state %s", (status) => {
    expect(classifyBatch(batch(), [row({ enrichment_ready: true, assessed_at: "date", outreach_status: status })]).stage).toBe("Outreach");
  });
  it("keeps a mixed batch at the earliest incomplete stage", () => {
    const advanced = row({ enrichment_ready: true, assessed_at: "date", outreach_status: "sent" });
    expect(classifyBatch(batch(), [...Array(8).fill(advanced), row(), row()]).stage).toBe("Enrich");
    expect(classifyBatch(batch(), [advanced, row({ enrichment_ready: true })]).stage).toBe("Assess");
  });
  it("excludes unsuitable work but retains fixed member record counts", () => {
    expect(classifyBatch(batch(), [row({ pipeline_status: "disqualified" }), row({ enrichment_ready: true })])).toMatchObject({ stage: "Assess", activeCount: 1, recordCount: 2 });
    expect(classifyBatch(batch(), [row({ pipeline_status: "disqualified" })])).toMatchObject({ stage: null, state: "inactive", activeCount: 0, recordCount: 1 });
  });
  it("uses identical classification for counts and lists and counts shared members in each batch", () => {
    const records = [row({ batches: [{ id: "a", name: "a" }, { id: "b", name: "b" }, { id: "b", name: "b" }] }), row({ id: "other" })];
    const pipeline = batchPipeline([batch(), batch("b")], records);
    const enrich = pipeline.groups.find((group) => group.stage === "Enrich")!;
    expect(enrich.batchCount).toBe(2);
    expect(enrich.recordCount).toBe(3);
    for (const group of pipeline.groups) {
      expect(group.batchCount).toBe(group.items.length);
      expect(group.recordCount).toBe(group.items.reduce((sum, item) => sum + item.recordCount, 0));
    }
    expect(defaultBatchStage(pipeline)).toBe("Enrich");
    expect(defaultBatchStage(batchPipeline([], []))).toBe("Enrich");
  });
  it("does not use saved text filters to reclassify membership; existing matcher remains unchanged", () => {
    const records = [row()];
    const b = { ...batch(), record_filter: { ...DEFAULT_BATCH_FILTER, search: "no-match" } };
    expect(classifyBatch(b, records).recordCount).toBe(1);
    expect(matchesBatchFilter(records[0], b.record_filter)).toBe(false);
    expect(matchesBatchFilter(records[0], { ...DEFAULT_BATCH_FILTER, search: "WARE" })).toBe(true);
    expect(matchesBatchFilter(records[0], DEFAULT_BATCH_FILTER)).toBe(true);
    expect(records).toHaveLength(1);
  });
});
