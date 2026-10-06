import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_BATCH_FILTER } from "../../supabase/functions/_shared/opportunityBatches";
const hooks = vi.hoisted(() => ({ values: [] as any[], cursor: 0, id: "batch" as string | undefined }));
vi.mock("react", async (original) => ({ ...await original<typeof import("react")>(),
  useState: (initial: unknown) => { const index = hooks.cursor++; if (!(index in hooks.values)) hooks.values[index] = initial; return [hooks.values[index], (value: any) => { hooks.values[index] = typeof value === "function" ? value(hooks.values[index]) : value; }]; },
  useMemo: (compute: () => unknown) => compute(), useEffect: () => {},
}));
vi.mock("react-router-dom", async (original) => ({ ...await original<typeof import("react-router-dom")>(), useParams: () => ({ id: hooks.id }) }));
vi.mock("../lib/api", () => ({ analyzeOpportunity: vi.fn(), enrichOpportunity: vi.fn(), fetchOpportunityBatch: vi.fn(), fetchOpportunityBatches: vi.fn(), updateOpportunityBatch: vi.fn() }));
import OpportunityBatches from "./OpportunityBatches";
import { analyzeOpportunity, enrichOpportunity, fetchOpportunityBatch, updateOpportunityBatch } from "../lib/api";
import { Link } from "react-router-dom";
function nodes(node: ReactNode): ReactElement<Record<string, any>>[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Record<string, any>>;
  return [element, ...nodes(element.props.children)];
}
const batch = { id: "batch", name: "Builders", purpose: "Purpose", record_filter: DEFAULT_BATCH_FILTER };
const member = (id: string, fields = {}) => ({ id, business_name: `Warehouse ${id}`, location: "Auckland", industry: "Construction", opportunity_score: "70", pipeline_status: "discovered", enrichment_ready: false, enrichment_running: false, assessed_at: null, outreach_status: null, ...fields });
const records = [member("a"), member("b", { enrichment_ready: true }), member("other", { business_name: "Unmatched", enrichment_ready: true }), member("running", { enrichment_running: true }), member("unsuitable", { pipeline_status: "disqualified" }), member("assessed", { enrichment_ready: true, assessed_at: "date" })];
function render() { hooks.cursor = 0; return nodes(OpportunityBatches()); }
function action(tree: ReturnType<typeof render>, prefix: string) { return tree.find((node) => node.type === "button" && JSON.stringify(node.props.children).includes(prefix))!; }
beforeEach(() => {
  vi.clearAllMocks(); hooks.id = "batch";
  hooks.values = [[batch], batch, records, batch.name, batch.purpose, DEFAULT_BATCH_FILTER, false, false, null, null, [], ""];
  vi.mocked(fetchOpportunityBatch).mockResolvedValue({ batch, opportunities: records } as any);
  vi.mocked(enrichOpportunity).mockResolvedValue({ ok: true });
  vi.mocked(analyzeOpportunity).mockResolvedValue({ ok: true });
  vi.mocked(updateOpportunityBatch).mockResolvedValue({ batch } as any);
});
describe("isolated Batch workspace contracts", () => {
  it("lists batches with links to their existing detail routes", () => {
    hooks.id = undefined;
    expect(render().filter((node) => node.type === Link).map((node) => node.props.to)).toContain("/batches/batch");
  });
  it("blank search displays all fixed members; clearing only search restores them", () => {
    expect(render().filter((node) => node.type === Link && node.props.to.startsWith("/opportunities/"))).toHaveLength(6);
    hooks.values[5] = { ...DEFAULT_BATCH_FILTER, search: "unmatched" };
    let tree = render();
    expect(tree.filter((node) => node.type === Link && node.props.to.startsWith("/opportunities/")).map((node) => node.props.to)).toEqual(["/opportunities/other"]);
    tree.find((node) => node.type === "input" && node.props.maxLength === 300)!.props.onChange({ target: { value: "" } });
    expect(render().filter((node) => node.type === Link && node.props.to.startsWith("/opportunities/"))).toHaveLength(6);
    expect(hooks.values[2]).toBe(records);
  });
  it("enrichment targets only matching members that are neither ready, running nor unsuitable", async () => {
    const filter = { ...DEFAULT_BATCH_FILTER, search: "warehouse" };
    hooks.values[1] = { ...batch, record_filter: filter }; hooks.values[5] = filter;
    action(render(), "Enrich matching records").props.onClick();
    await vi.waitFor(() => expect(hooks.values[6]).toBe(false));
    expect(vi.mocked(enrichOpportunity).mock.calls.map(([id]) => id)).toEqual(["a"]);
  });
  it("assessment targets only matching enriched unassessed selectable members", async () => {
    const filter = { ...DEFAULT_BATCH_FILTER, search: "warehouse" };
    hooks.values[1] = { ...batch, record_filter: filter }; hooks.values[5] = filter;
    action(render(), "Assess enriched records").props.onClick();
    await vi.waitFor(() => expect(hooks.values[6]).toBe(false));
    expect(vi.mocked(analyzeOpportunity).mock.calls).toEqual([["b"]]);
  });
  it("requires saving filter changes before processing and saves no membership fields", async () => {
    hooks.values[5] = { ...DEFAULT_BATCH_FILTER, search: "warehouse" };
    const tree = render(); const enrich = action(tree, "Enrich matching records");
    expect(enrich.props.disabled).toBe(true); enrich.props.onClick(); expect(enrichOpportunity).not.toHaveBeenCalled();
    action(tree, "Save batch details").props.onClick();
    expect(updateOpportunityBatch).toHaveBeenCalledWith("batch", { name: batch.name, purpose: batch.purpose, record_filter: hooks.values[5] });
  });
});
