import { readFileSync } from "node:fs";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";

const source = readFileSync(new URL("../../supabase/functions/opportunities/index.ts", import.meta.url), "utf8");
const file = ts.createSourceFile("opportunities.ts", source, ts.ScriptTarget.Latest, true);
const names = new Set(["updateOpportunityLead", "recordUnavailable", "recordMutationFilter"]);
const handlers = ts.transpileModule(file.statements.filter(node =>
  ts.isFunctionDeclaration(node) && names.has(node.name?.text ?? ""),
).map(node => node.getText(file)).join("\n"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

function harness(results: { data: unknown; error: unknown }[] = []) {
  const query = {
    update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(),
  };
  for (const result of results) query.maybeSingle.mockResolvedValueOnce(result);
  const from = vi.fn(() => query);
  const actions = new Function("supabase", "json", `${handlers}; return {updateOpportunityLead,recordMutationFilter};`)(
    { from }, (body: unknown, status = 200) => new Response(JSON.stringify(body), { status }),
  );
  return { ...actions, query, from };
}

afterEach(() => vi.useRealTimers());

describe("supported opportunity PATCH disposition", () => {
  it.each([{}, null, "disqualified", { status: "converted" }, { status: "disqualified", business_name: "changed" }])(
    "rejects unsupported payload %j before touching the database", async payload => {
      const h = harness();
      expect((await h.updateOpportunityLead("lead", payload)).status).toBe(400);
      expect(h.from).not.toHaveBeenCalled();
    },
  );
  it("marks only the selected lead not suitable and returns its canonical status", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-10T00:05:00Z"));
    const h = harness([{ data: { id: "lead", status: "disqualified" }, error: null }]);
    const response = await h.updateOpportunityLead("lead", { status: "disqualified" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: "lead", status: "disqualified" });
    expect(h.from).toHaveBeenCalledWith("local_business_leads");
    expect(h.query.eq).toHaveBeenCalledWith("id", "lead");
    expect(h.query.update).toHaveBeenCalledWith({ status: "disqualified", updated_at: expect.any(String) });
    expect(h.query.or).toHaveBeenCalledWith(h.recordMutationFilter());
  });
  it("applies queue-first enrichment freshness and the execution timestamp fallback atomically", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-10T00:05:00Z"));
    const filter = harness().recordMutationFilter();
    expect(filter).toContain("enrichment_status.is.null,enrichment_status.neq.enriching");
    expect(filter).toContain("enrichment_diagnostics->>queue_requested_at.lte.2026-10-10T00:02:00.000Z");
    expect(filter).toContain("and(enrichment_diagnostics->>queue_requested_at.is.null,enrichment_diagnostics->enrichment_execution->>started_at.lte.2026-10-10T00:02:00.000Z)");
  });
  it("returns a conflict for a record excluded by the running-enrichment guard", async () => {
    const h = harness([{ data: null, error: null }, { data: { id: "lead" }, error: null }]);
    const response = await h.updateOpportunityLead("lead", { status: "disqualified" });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("enrichment_running");
    expect(h.query.update).toHaveBeenCalledTimes(1);
  });
  it("distinguishes a missing record from running enrichment", async () => {
    const h = harness([{ data: null, error: null }, { data: null, error: null }]);
    const response = await h.updateOpportunityLead("lead", { status: "disqualified" });
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("not_found");
  });
  it("propagates update errors instead of reporting success", async () => {
    const error = new Error("write failed");
    const h = harness([{ data: null, error }]);
    await expect(h.updateOpportunityLead("lead", { status: "disqualified" })).rejects.toBe(error);
  });
  it("propagates lookup errors rather than treating them as a missing record", async () => {
    const error = new Error("lookup failed");
    const h = harness([{ data: null, error: null }, { data: null, error }]);
    await expect(h.updateOpportunityLead("lead", { status: "disqualified" })).rejects.toBe(error);
  });
});
