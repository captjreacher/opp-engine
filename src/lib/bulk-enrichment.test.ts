import { describe, expect, it, vi } from "vitest";
import { canSelectOpportunity, enrichSelectedOpportunities, toggleOpportunitySelection } from "./bulk-enrichment";
import type { OppRow } from "./types";
const row = (id: string, extra: Partial<OppRow> = {}) => ({ id, business_name: id, pipeline_status: "discovered", ...extra }) as OppRow;

describe("opportunity selection", () => {
  it("selects and deselects individual records without changing other selections", () => {
    const initial = new Set(["a", "hidden"]);
    expect([...toggleOpportunitySelection(initial, ["b"], true)]).toEqual(["a", "hidden", "b"]);
    expect([...toggleOpportunitySelection(initial, ["a"], false)]).toEqual(["hidden"]);
    expect([...initial]).toEqual(["a", "hidden"]);
  });
  it("limits select-all to supplied visible records and preserves hidden selections", () => {
    expect([...toggleOpportunitySelection(new Set(["hidden"]), ["a", "b"], true)]).toEqual(["hidden", "a", "b"]);
  });
  it("excludes running and unsuitable records", () => {
    expect(canSelectOpportunity(row("a", { enrichment_running: true }))).toBe(false);
    expect(canSelectOpportunity(row("b", { pipeline_status: "disqualified" }))).toBe(false);
    expect(canSelectOpportunity(row("c", { enrichment_status: "enriching", enrichment_running: false }))).toBe(true);
  });
});

describe("bulk enrichment", () => {
  it("queues each selected record and retries failed or previously enriched records", async () => {
    const enrich = vi.fn().mockResolvedValue({ ok: true });
    const progress = vi.fn();
    const result = await enrichSelectedOpportunities([row("a"), row("b", { enrichment_ready: true }), row("c", { enrichment_status: "failed" })], enrich, progress);
    expect(result).toEqual({ started: ["a", "b", "c"], failures: [] });
    expect(enrich.mock.calls).toEqual([["a", false], ["b", true], ["c", true]]);
    expect(progress.mock.calls).toEqual([[1], [2], [3]]);
  });
  it("continues after rejected requests and API failures, retaining failed selections", async () => {
    const enrich = vi.fn().mockRejectedValueOnce(new Error("Network unavailable")).mockResolvedValueOnce({ ok: false, error: "Queue unavailable" }).mockResolvedValueOnce({ ok: true });
    const result = await enrichSelectedOpportunities([row("a"), row("b"), row("c")], enrich, vi.fn());
    expect(result.started).toEqual(["c"]);
    expect(result.failures.map((failure) => failure.error)).toEqual(["Network unavailable", "Queue unavailable"]);
    expect([...toggleOpportunitySelection(new Set(["a", "b", "c"]), result.started, false)]).toEqual(["a", "b"]);
  });
  it("never queues running or unsuitable records", async () => {
    const enrich = vi.fn();
    const result = await enrichSelectedOpportunities([row("a", { enrichment_running: true }), row("b", { pipeline_status: "disqualified" })], enrich, vi.fn());
    expect(enrich).not.toHaveBeenCalled();
    expect(result.failures).toHaveLength(2);
  });
});
