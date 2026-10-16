import type { ReactElement, ReactNode } from "react";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0, effects: [] as (() => unknown)[] }));
vi.mock("react", async (original) => ({ ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = initial;
    return [hooks.values[index], (next: unknown) => { hooks.values[index] = next; }];
  },
  useEffect: (effect: () => unknown) => { hooks.effects.push(effect); },
  useMemo: (calculate: () => unknown) => calculate(),
}));
vi.mock("react-router-dom", async (original) => ({ ...await original<typeof import("react-router-dom")>(), useParams: () => ({ id: "a" }) }));
vi.mock("../lib/api", () => ({ fetchOpportunityBatches: vi.fn(), fetchOpportunities: vi.fn(), fetchOpportunityBatch: vi.fn(), updateOpportunityBatch: vi.fn(), analyzeOpportunity: vi.fn(), enrichOpportunity: vi.fn() }));
import BatchPipelineOverview, { BatchCard } from "./BatchPipelineOverview";
import BatchWorkspace from "./BatchWorkspace";
import Dashboard from "../routes/Dashboard";
import OpportunityList from "../routes/OpportunityList";
import OpportunityBatches from "../routes/OpportunityBatches";
import { fetchOpportunities, fetchOpportunityBatches, enrichOpportunity, analyzeOpportunity, updateOpportunityBatch } from "../lib/api";
import { DEFAULT_BATCH_FILTER } from "../../supabase/functions/_shared/opportunityBatches";
import type { OpportunityBatch } from "../lib/api";
import type { OppRow } from "../lib/types";

function nodes(node: ReactNode): ReactElement<Record<string, any>>[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Record<string, any>>;
  return [element, ...nodes(element.props.children)];
}
const batch = (id: string): OpportunityBatch => ({ id, name: id, purpose: "", created_at: "", updated_at: "", record_filter: DEFAULT_BATCH_FILTER });
const records = [{ id: "1", pipeline_status: "discovered", enrichment_ready: false, batches: [{ id: "a" }] }, { id: "2", pipeline_status: "discovered", enrichment_ready: true, assessed_at: null, batches: [{ id: "b" }] }] as OppRow[];
const render = () => { hooks.cursor = 0; return BatchPipelineOverview({ batches: [batch("a"), batch("b")], records }); };
beforeEach(() => { hooks.values = []; hooks.cursor = 0; hooks.effects = []; vi.clearAllMocks(); });
describe("batch navigation UI", () => {
  it("clears only search text and leaves processing and fixed membership untouched", () => {
    const filter = { ...DEFAULT_BATCH_FILTER, search: "Warehouse", scoreThreshold: 50, pipelineStatus: "discovered", auditAvailability: "available", outreachStatus: "sent" };
    hooks.values = [[], batch("a"), records, "a", "", filter, false, false, null, null, [], ""];
    const detail = () => { hooks.cursor = 0; return nodes(OpportunityBatches()); };
    let tree = detail();
    expect(tree.find((node) => node.type === "input" && node.props.placeholder === "Search business, location or industry…")?.props.value).toBe("Warehouse");
    tree.find((node) => node.type === "button" && node.props.children === "Clear text filter")!.props.onClick();
    expect(hooks.values[5]).toEqual({ ...filter, search: "" });
    expect(hooks.values[2]).toBe(records);
    tree = detail();
    expect(tree.some((node) => node.props.children === "Clear text filter")).toBe(false);
    expect(enrichOpportunity).not.toHaveBeenCalled();
    expect(analyzeOpportunity).not.toHaveBeenCalled();
    expect(updateOpportunityBatch).not.toHaveBeenCalled();
  });
  it("clicking stage immediately filters the list using the same counted groups", () => {
    let tree = nodes(render());
    expect(tree.filter((node) => node.type === BatchCard).map((node) => node.props.item.batch.id)).toEqual(["a"]);
    const assess = tree.find((node) => node.type === "button" && nodes(node.props.children).some((child) => child.props.children === "Assess"))!;
    expect(nodes(assess).some((node) => JSON.stringify(node.props.children) === '[1," ","batch"]')).toBe(true);
    assess.props.onClick();
    tree = nodes(render());
    expect(tree.filter((node) => node.type === BatchCard).map((node) => node.props.item.batch.id)).toEqual(["b"]);
    expect(tree.find((node) => node.type === "h2")?.props.children).toEqual(["Assess", " batches"]);
  });
  it("batch cards retain existing detail links", () => {
    const card = nodes(render()).find((node) => node.type === BatchCard)!;
    expect(BatchCard(card.props as any).props.to).toBe("/batches/a");
  });
  it("renders upstream context without selectable tiles or batch counts", () => {
    const tree = nodes(render());
    const upstream = tree.filter((node) => node.type === "div" && node.props.title === "Upstream opportunity stage, before saved batch creation");
    expect(upstream).toHaveLength(2);
    for (const tile of upstream) {
      expect(nodes(tile).some((node) => node.props.children === "Upstream")).toBe(true);
      expect(tile.props.onClick).toBeUndefined();
      expect(JSON.stringify(tile.props.children)).not.toContain("batches");
      expect(JSON.stringify(tile.props.children)).not.toContain("records");
    }
    expect(tree.filter((node) => node.type === "button")).toHaveLength(3);
  });
  it("keeps empty and blocked batches accessible in a separate section", () => {
    const tree = nodes(BatchPipelineOverview({ batches: [batch("empty"), batch("blocked")], records: [{ ...records[0], pipeline_status: "disqualified", batches: [{ id: "blocked", name: "blocked" }] }] as OppRow[] }));
    const section = tree.find((node) => node.props["aria-label"] === "Inactive / blocked batches")!;
    const cards = nodes(section).filter((node) => node.type === BatchCard);
    expect(cards.map((card) => BatchCard(card.props as any).props.to)).toEqual(["/batches/empty", "/batches/blocked"]);
    expect(cards.map((card) => card.props.item.state)).toEqual(["empty", "inactive"]);
    expect(tree.find((node) => node.type === "h2")?.props.children).toEqual(["Enrich", " batches"]);
  });
  it("uses neutral Outreach wording without claiming readiness, sending or completion", () => {
    hooks.values = ["Outreach"];
    const tree = nodes(BatchPipelineOverview({ batches: [batch("a")], records: [{ ...records[0], enrichment_ready: true, assessed_at: "date" }] }));
    expect(tree.some((node) => node.props.children === "Assessment complete; outreach work is next or underway.")).toBe(true);
    const source = readFileSync("src/components/BatchPipelineOverview.tsx", "utf8");
    expect(source).not.toMatch(/Ready for outreach|Outreach completed|Handoff completed|Outreach sent/);
  });
  it("Dashboard uses the same workspace, defaults to Pipeline, and Individual selects existing batch links", async () => {
    expect(Dashboard().type).toBe(BatchWorkspace);
    vi.mocked(fetchOpportunityBatches).mockResolvedValue({ batches: [batch("a"), batch("b")] });
    vi.mocked(fetchOpportunities).mockResolvedValue({ opportunities: [records[0]] });
    const workspace = () => { hooks.cursor = 0; return BatchWorkspace({ dashboard: true }); };
    workspace();
    hooks.effects[0]();
    await vi.waitFor(() => expect(hooks.values[0]).not.toBeNull());
    let tree = nodes(workspace());
    expect(tree.some((node) => node.type === BatchPipelineOverview)).toBe(true);
    tree.find((node) => node.type === "button" && node.props.children === "Individual")!.props.onClick();
    tree = nodes(workspace());
    expect(tree.some((node) => node.type === OpportunityList)).toBe(true);
    tree.find((node) => node.type === "select")!.props.onChange({ target: { value: "b" } });
    const card = nodes(workspace()).find((node) => node.type === BatchCard)!;
    expect(card.props.item.state).toBe("empty");
    expect(BatchCard(card.props as any).props.to).toBe("/batches/b");
    expect(fetchOpportunityBatches).toHaveBeenCalledTimes(1);
    expect(fetchOpportunities).toHaveBeenCalledTimes(1);
  });
  it("preserves the validated detail search UX and original processing selectors", () => {
    const source = readFileSync("src/routes/OpportunityBatches.tsx", "utf8");
    expect(source).toContain('placeholder="Search business, location or industry…"');
    expect(source).toContain('{filter.search && <button');
    expect(source).toContain('setFilter({ ...filter, search: "" })');
    expect(source).toContain('const matching = useMemo(() => rows.filter((row) => matchesBatchFilter(row, filter)), [rows, filter]);');
    expect(source).toContain('const enrichTargets = matching.filter((row) => canSelectOpportunity(row) && !row.enrichment_ready);');
    expect(source).toContain('const assessTargets = matching.filter((row) => canSelectOpportunity(row) && row.enrichment_ready && !row.assessed_at);');
    expect(source).not.toContain("batch-record-filter");
    const app = readFileSync("src/App.tsx", "utf8");
    expect(app).toContain('path="/batches" element={<BatchWorkspace />}');
    expect(app).toContain('path="/batches/:id" element={<OpportunityBatches />}');
  });
});
