import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_BATCH_FILTER, matchesBatchFilter, validateBatchFilter } from "../../supabase/functions/_shared/opportunityBatches";

const row = { business_name: "Example Builder", location: "Auckland", industry: "Construction", opportunity_score: null, pipeline_status: "discovered", has_audit: false, outreach_status: null };
describe("saved dashboard filters", () => {
  it.each(["EXAMPLE", "auck", "struct"])("matches business/location/industry partial text case-insensitively: %s", (search) => {
    expect(matchesBatchFilter(row, { ...DEFAULT_BATCH_FILTER, search })).toBe(true);
  });
  it("combines text with pipeline/score filters and treats whitespace as blank", () => {
    expect(matchesBatchFilter(row, { ...DEFAULT_BATCH_FILTER, search: "  " })).toBe(true);
    expect(matchesBatchFilter(row, { ...DEFAULT_BATCH_FILTER, search: "missing" })).toBe(false);
    expect(matchesBatchFilter(row, { ...DEFAULT_BATCH_FILTER, search: "builder", pipelineStatus: "enriched" })).toBe(false);
    expect(matchesBatchFilter(row, { ...DEFAULT_BATCH_FILTER, search: "builder", scoreThreshold: 1 })).toBe(false);
  });
  it("round-trips the actual filters captured from the dashboard", () => {
    const filter = { search: "", scoreThreshold: 60, pipelineStatus: "discovered", auditAvailability: "none" as const, outreachStatus: "None" };
    expect(validateBatchFilter(filter)).toEqual(filter);
    expect(matchesBatchFilter({ ...row, opportunity_score: "80.0" }, filter)).toBe(true);
    expect(matchesBatchFilter({ ...row, opportunity_score: "80.0", pipeline_status: "enriched" }, filter)).toBe(false);
  });
  it("keeps unassessed records visible when there is no minimum score", () => {
    expect(matchesBatchFilter(row, DEFAULT_BATCH_FILTER)).toBe(true);
    expect(matchesBatchFilter(row, { ...DEFAULT_BATCH_FILTER, scoreThreshold: 1 })).toBe(false);
  });
  it.each([{ scoreThreshold: -1 }, { scoreThreshold: "60" }, { auditAvailability: "bad" }, { search: 12 }, { sql: "any" }])("rejects unsupported filters: %j", (filter) => {
    expect(() => validateBatchFilter(filter)).toThrow();
  });
  it("filters audit and outreach status with the dashboard's None convention", () => {
    expect(matchesBatchFilter(row, { ...DEFAULT_BATCH_FILTER, outreachStatus: "None" })).toBe(true);
    expect(matchesBatchFilter(row, { ...DEFAULT_BATCH_FILTER, auditAvailability: "available" })).toBe(false);
  });
});

const source = readFileSync(new URL("../../supabase/functions/opportunities/index.ts", import.meta.url), "utf8");
const handlersSource = source.slice(source.indexOf("async function listOpportunityBatches("), source.indexOf("// ---- Batch handlers end"));
function handlers() {
  const query = { update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: { id: "batch", name: "Edited", purpose: "Purpose" }, error: null }) };
  const rpc = vi.fn().mockResolvedValue({ data: { id: "batch" }, error: null });
  const from = vi.fn().mockReturnValue(query);
  const compiled = ts.transpileModule(handlersSource, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const actions = new Function("supabase", "json", "validateBatchFilter", "cleanText", `${compiled}; return {createOpportunityBatch,updateOpportunityBatch};`)(
    { rpc, from }, (value: unknown, status = 200) => new Response(JSON.stringify(value), { status }), validateBatchFilter,
    (value: unknown, limit: number) => typeof value === "string" ? value.trim().slice(0, limit) || null : null,
  );
  return { ...actions, rpc, from, query };
}
describe("batch API validation and persistence", () => {
  it("lists persisted batches with database membership counts", async () => {
    const order = vi.fn().mockResolvedValue({ data: [{ id: "batch", opportunity_batch_members: [{ count: 2 }] }], error: null });
    const from = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ order }) });
    const compiled = ts.transpileModule(handlersSource, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    const list = new Function("supabase", "json", `${compiled}; return listOpportunityBatches;`)({ from }, (body: unknown) => new Response(JSON.stringify(body)));
    expect(await (await list()).json()).toMatchObject({ batches: [{ id: "batch", member_count: 2 }] });
    expect(from).toHaveBeenCalledWith("opportunity_batches");
  });
  it("detail returns only fixed member IDs and ignores display filters for membership", async () => {
    const from = vi.fn((table: string) => {
      const result = { data: table === "opportunity_batches" ? { id: "batch", record_filter: { search: "nothing" } } : [{ lead_id: "a" }, { lead_id: "b" }], error: null };
      const query: any = { select: () => query, eq: () => query, maybeSingle: async () => result, then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve) };
      return query;
    });
    const compiled = ts.transpileModule(handlersSource, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    const get = new Function("supabase", "json", "listOpportunities", `${compiled}; return getOpportunityBatch;`)({ from }, (body: unknown) => new Response(JSON.stringify(body)), async () => new Response(JSON.stringify({ opportunities: [{ id: "a" }, { id: "b" }, { id: "outside" }] })));
    expect((await (await get("batch")).json()).opportunities).toEqual([{ id: "a",batch_member_active:true }, { id: "b",batch_member_active:true }]);
    expect(from.mock.calls.map(([table]) => table)).toEqual(["opportunity_batches", "opportunity_batch_members"]);
  });
  it("requires at least two distinct opportunity records", async () => {
    const h = handlers();
    expect((await h.createOpportunityBatch({ id: crypto.randomUUID(), name: "Batch", lead_ids: [crypto.randomUUID()] })).status).toBe(400);
    expect(h.rpc).not.toHaveBeenCalled();
  });
  it("saves the group and tags in one database transaction before enrichment", async () => {
    const h = handlers();
    const input = { id: crypto.randomUUID(), name: "Builders", lead_ids: [crypto.randomUUID(), crypto.randomUUID()], record_filter: { ...DEFAULT_BATCH_FILTER, pipelineStatus: "discovered" } };
    expect((await h.createOpportunityBatch(input)).status).toBe(201);
    expect(h.rpc).toHaveBeenCalledWith("create_opportunity_batch", { p_batch_id: input.id, p_name: input.name, p_lead_ids: input.lead_ids, p_record_filter: input.record_filter });
  });
  it("updates name, purpose and dashboard filters without changing memberships", async () => {
    const h = handlers();
    const patch = { name: "Edited", purpose: "Purpose", record_filter: { ...DEFAULT_BATCH_FILTER, pipelineStatus: "enriched" } };
    expect((await h.updateOpportunityBatch("batch", patch)).status).toBe(200);
    expect(h.from).toHaveBeenCalledWith("opportunity_batches");
    expect(h.query.update).toHaveBeenCalledWith(expect.objectContaining(patch));
  });
  it("rejects unsupported membership writes through the details endpoint", async () => {
    const h = handlers();
    expect((await h.updateOpportunityBatch("batch", { lead_ids: [] })).status).toBe(400);
    expect(h.from).not.toHaveBeenCalled();
  });
});
