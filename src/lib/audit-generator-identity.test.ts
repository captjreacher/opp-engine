import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

const source = ts.createSourceFile("opportunities.ts",
  readFileSync("supabase/functions/opportunities/index.ts", "utf8"), ts.ScriptTarget.Latest, true);
const functions = source.statements.filter((node) => ts.isFunctionDeclaration(node)
  && ["reportBand", "auditOpportunity"].includes(node.name?.text ?? ""));
const compiled = ts.transpileModule(functions.map((node) => node.getText(source)).join("\n"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

const leadId = "56466543-2f64-4d1a-92bc-136e0b39b3a1";
const assessmentId = "d2641d7a-1d22-4c89-b279-fdf4eac4f57a";
const userId = "1b2319d3-bb42-487b-b5df-ce60868243bb";
const reportId = "21a8de76-4041-4ea1-9d3c-c6de6df4059e";

function harness(existing: Record<string, unknown> | null = null, writeError?: string) {
  const assessment = { id: assessmentId, lead_id: leadId, opportunity_score: 118,
    assessed_by: "opportunity-engine-analysis", assessment_summary: "Existing assessment" };
  const lead = { id: leadId, business_name: "Coldicutt Blackman", source: "opportunity-discovery",
    enrichment_diagnostics: { enrichment_result: { evidence: [{ source_url: "https://example.com" }] } } };
  const writes: { operation: string; value: Record<string, any> }[] = [];
  const rpc = vi.fn().mockResolvedValue({ error: null });
  const from = vi.fn((table: string) => {
    let operation = "read";
    let value: Record<string, any> = {};
    const query: any = {
      select: () => query, eq: () => query, order: () => query, limit: () => query,
      insert: (next: typeof value) => { operation = "insert"; value = next; return query; },
      update: (next: typeof value) => { operation = "update"; value = next; return query; },
      maybeSingle: async () => ({ data: table === "local_business_leads" ? lead
        : table === "local_business_lead_assessments" ? assessment : existing }),
      single: async () => {
        writes.push({ operation, value });
        // Live schema: nullable UUID FK to auth.users(id), not an application label.
        if (value.generated_by != null && !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value.generated_by)) {
          return { data: null, error: new Error(`invalid input syntax for type uuid: "${value.generated_by}"`) };
        }
        if (writeError) return { data: null, error: new Error(writeError) };
        return { data: { id: reportId, generated_by: null, ...existing, ...value }, error: null };
      },
    };
    return query;
  });
  const audit = new Function("supabase", "AUDIT_REPORT_VERSION", `${compiled}; return auditOpportunity;`)(
    { from, rpc }, "opportunity-engine-v1",
  );
  return { audit, writes, rpc, from, lead, assessment };
}

describe("audit generator identity contract", () => {
  it("creates a system-generated report without casting the application label to a user UUID", async () => {
    const h = harness();
    const result = await h.audit(leadId);
    expect(result.error).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(result.audit.generated_by).toBeNull();
    expect(h.writes).toHaveLength(1);
    const write = h.writes[0];
    expect(write.operation).toBe("insert");
    expect(write.value).not.toHaveProperty("generated_by");
    expect(write.value).toMatchObject({ lead_id: leadId, assessment_id: assessmentId,
      metadata_json: { report_model: { business: { source: "opportunity-discovery" },
        metadata: { generatedBy: "opportunity-engine", assessmentId, scoringSource: "opportunity-engine-analysis" },
        sections: [{ items: h.lead.enrichment_diagnostics.enrichment_result.evidence }] } } });
    expect(h.rpc.mock.calls.map((call) => call[1].p_event_type)).toEqual([
      "local_business.audit_generation_started", "local_business.audit_generated",
    ]);
    expect(h.from.mock.calls.map((call) => call[0])).not.toContain("auth.users");
  });

  it("preserves an existing real user attribution and report identity when regenerating", async () => {
    const h = harness({ id: reportId, generated_by: userId });
    const result = await h.audit(leadId, true);
    expect(result.error).toBeUndefined();
    expect(result.audit).toMatchObject({ id: reportId, generated_by: userId, assessment_id: assessmentId });
    expect(h.writes).toHaveLength(1);
    expect(h.writes[0].operation).toBe("update");
    expect(h.writes[0].value).not.toHaveProperty("generated_by");
  });

  it("reuses an existing report without writing or emitting new events", async () => {
    const report = { id: reportId, generated_by: userId };
    const h = harness(report);
    expect(await h.audit(leadId)).toEqual({ ok: true, audit: report });
    expect(h.writes).toHaveLength(0);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("retains terminal failure reporting when report persistence fails", async () => {
    const h = harness(null, "persistence unavailable");
    expect(await h.audit(leadId)).toEqual({ ok: false, error: "persistence unavailable" });
    expect(h.rpc).toHaveBeenLastCalledWith("emit_local_business_event", {
      p_lead_id: leadId, p_event_type: "local_business.audit_generation_failed", p_status: "failed",
      p_payload: { assessment_id: assessmentId, detail: "persistence unavailable" },
    });
  });
});
