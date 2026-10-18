import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { enrichmentReadiness, assessmentIsCurrent } from "../../supabase/functions/_shared/opportunityWorkflow";
import { lifecycleView, lifecycleMatches, validateLifecyclePayload, LIFECYCLE_CAPABILITIES, PERMANENT_DELETION_UNAVAILABLE } from "../../supabase/functions/_shared/opportunityLifecycle";
import { canSelectOpportunity } from "./bulk-enrichment";
import type { OppRow } from "./types";

const id = "11111111-1111-4111-8111-111111111111";
const source = readFileSync("supabase/functions/opportunities/index.ts", "utf8");
const file = ts.createSourceFile("opportunities.ts", source, ts.ScriptTarget.Latest, true);
const names = new Set(["authorized", "json", "requireActiveOpportunity", "setOpportunityLifecycle", "denyPermanentOpportunityDeletion", "listOpportunities", "latestByLead", "cleanText", "parseNumber", "getOpportunity", "projectBatchTag", "companyMatches", "outreachOptions", "prepareScenarioReports"]);
const transpile = (code: string) => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const functions = transpile(file.statements.filter(node => ts.isFunctionDeclaration(node) && names.has(node.name?.text ?? "")).map(node => node.getText(file)).join("\n"));
const serve = file.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(file) === "Deno.serve") as ts.ExpressionStatement;
const router = transpile(`const route = ${((serve.expression as ts.CallExpression).arguments[0]).getText(file)};`);
const lifecycleArgs = { lifecycleView, lifecycleMatches, validateLifecyclePayload, LIFECYCLE_CAPABILITIES, PERMANENT_DELETION_UNAVAILABLE, enrichmentReadiness, assessmentIsCurrent };

function harness(options: { archived?: boolean; exists?: boolean; rpcData?: unknown; rpcError?: unknown; tables?: Record<string, unknown[]> } = {}) {
  const lead = { id, business_name: "Retained business", status: "disqualified", archived_at: options.archived ? "2026-10-19T00:00:00Z" : null };
  const tables: Record<string, unknown[]> = { local_business_leads: options.exists === false ? [] : [lead], ...options.tables };
  const queries: { table: string; method: string; args: unknown[] }[] = [];
  const from = vi.fn((table: string) => {
    let rows = tables[table] ?? [];
    const q: Record<string, unknown> = {};
    for (const method of ["select", "order", "limit", "in", "not", "eq"]) q[method] = (...args: unknown[]) => {
      queries.push({ table, method, args });
      if (method === "eq") rows = rows.filter(row => (row as Record<string, unknown>)[String(args[0])] === args[1]);
      return q;
    };
    q.maybeSingle = async () => ({ data: rows[0] ?? null, error: null });
    q.then = (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve, reject);
    return q;
  });
  const rpc = vi.fn().mockResolvedValue({ data: options.rpcData ?? { ok: true, id, archived_at: lead.archived_at, idempotent: false }, error: options.rpcError ?? null });
  const ops = {
    requestOpportunityEnrichment: vi.fn(), runOpportunityAnalysis: vi.fn(), singleIntelligenceAction: vi.fn(),
    createOutreach: vi.fn(), sendOutreach: vi.fn(), updateOutreach: vi.fn(), setReview: vi.fn(), setOutcome: vi.fn(),
    addVisualEvidence: vi.fn(), requestVisualInspection: vi.fn(), updateOpportunityLead: vi.fn(),
  };
  const globals = { applicableCompanyScenarios:async()=>[], compatibleTemplates:()=>[], ...lifecycleArgs, ...ops, supabase: { from, rpc }, cors: {}, OPERATOR_TOKEN: "operator-test", deriveReviewState: async () => "reviewed", consoleEvents: async () => tables.opportunity_console_audit_log ?? [], resolveVisibleAssessment: (assessments: unknown[]) => assessments[0] ?? null, OUTCOME_EVENT_TO_STATE: {} };
  const api = new Function(...Object.keys(globals), `${functions}\n${router}; return {route,listOpportunities,getOpportunity,setOpportunityLifecycle};`)(...Object.values(globals));
  async function request(path: string, method = "POST", payload: unknown = { confirm: true }, token = "operator-test") {
    return api.route(new Request(`https://api.example/opportunities${path}`, { method, headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(method !== "GET" ? { body: JSON.stringify(payload) } : {}) }));
  }
  return { ...api, request, from, rpc, ops, queries };
}

describe("authenticated lifecycle API", () => {
  it.each(["archive", "restore"])("rejects unauthenticated %s before touching data", async action => {
    const h = harness(); expect((await h.request(`/${id}/${action}`, "POST", { confirm: true }, "forged")).status).toBe(401);
    expect(h.rpc).not.toHaveBeenCalled(); expect(h.from).not.toHaveBeenCalled();
  });
  it.each([{}, { confirm: false }, { confirm: "true" }, { confirm: true, admin: true }, { confirm: true, reason: "x".repeat(501) }, null, []])("requires explicit, narrow confirmation: %j", async payload => {
    const h = harness(); expect((await h.request(`/${id}/archive`, "POST", payload)).status).toBe(400); expect(h.rpc).not.toHaveBeenCalled();
  });
  it.each(["archive", "restore"])("delegates %s to the atomic RPC, without editing disposition or related records", async action => {
    const h = harness(); const response = await h.request(`/${id}/${action}`, "POST", { confirm: true, reason: "  operator decision  " });
    expect(response.status).toBe(200); expect(h.rpc).toHaveBeenCalledExactlyOnceWith("set_opportunity_archived", { p_lead_id: id, p_archived: action === "archive", p_reason: "operator decision" });
    expect(h.from).not.toHaveBeenCalled();
  });
  it.each(["archive", "restore"])("returns the idempotent %s result without a second client-side mutation", async action => {
    const h = harness({ rpcData: { ok: true, id, idempotent: true } });
    expect((await (await h.request(`/${id}/${action}`)).json()).idempotent).toBe(true); expect(h.rpc).toHaveBeenCalledTimes(1);
  });
  it.each(["enrichment_running", "approved_outreach_conflict"])("reports a safe conflict for %s", async message => {
    const h = harness({ rpcError: { message } }); const response = await h.request(`/${id}/archive`);
    expect(response.status).toBe(409); expect((await response.json()).error).toBe(message);
  });
  it("does not report success when the transactional audit write fails", async () => {
    const h = harness({ rpcError: { message: "audit transaction failed" } }); expect((await h.request(`/${id}/archive`)).status).toBe(500);
  });
  it("reports missing opportunities", async () => {
    const h = harness({ rpcData: { ok: false, error: "not_found" } }); expect((await h.request(`/${id}/restore`)).status).toBe(404);
  });
  it("denies permanent deletion even with shared credentials and forged administrator confirmation", async () => {
    const h = harness(); const response = await h.request(`/${id}`, "DELETE", { confirm: true, role: "admin", confirmation: "PERMANENTLY DELETE" });
    expect(response.status).toBe(403); expect((await response.json()).error).toBe("permanent_deletion_unavailable");
    expect(h.rpc).not.toHaveBeenCalled(); expect(h.from).not.toHaveBeenCalled(); expect(LIFECYCLE_CAPABILITIES.can_permanently_delete).toBe(false);
  });
  it("requires authentication even for denied deletion", async () => {
    const h = harness(); expect((await h.request(`/${id}`, "DELETE", {}, "forged")).status).toBe(401);
  });
  it.each(["enrich", "assess", "audit", "outreach", "outreach/draft/send", "visual-evidence", "inspection", "review", "outcome"])("blocks archived %s before operational handlers run", async path => {
    const h = harness({ archived: true }); expect((await h.request(`/${id}/${path}`)).status).toBe(409);
    for (const op of Object.values(h.ops)) expect(op).not.toHaveBeenCalled();
  });
  it.each(["", "/outreach/draft"])("blocks archived PATCH %s", async suffix => {
    const h = harness({ archived: true }); expect((await h.request(`/${id}${suffix}`, "PATCH")).status).toBe(409);
  });
  it("leaves the active enrichment workflow available", async () => {
    const h = harness(); h.ops.requestOpportunityEnrichment.mockResolvedValue(new Response("{}"));
    expect((await h.request(`/${id}/enrich`)).status).toBe(200); expect(h.ops.requestOpportunityEnrichment).toHaveBeenCalledWith(id, false);
  });
  it("rejects unsupported list filters before querying the database", async () => {
    const h = harness(); expect((await h.request("?lifecycle=deleted", "GET")).status).toBe(400); expect(h.from).not.toHaveBeenCalled();
  });
});

describe("lifecycle reads and preserved history", () => {
  const active = { id, business_name: "Active", status: "disqualified", archived_at: null };
  const archived = { ...active, id: "22222222-2222-4222-8222-222222222222", business_name: "Archived", archived_at: "2026-10-19T00:00:00Z" };
  it.each([["active", ["Active"]], ["archived", ["Archived"]], ["all", ["Active", "Archived"]]] as const)("returns %s without conflating disposition", async (view, names) => {
    const h = harness({ tables: { local_business_leads: [active, archived] } });
    const response = await h.listOpportunities(view); const body = await response.json();
    expect(body.opportunities.map((row: OppRow) => row.business_name)).toEqual(names);
    expect(body.opportunities.every((row: OppRow) => row.pipeline_status === "disqualified")).toBe(true);
  });
  it("defaults to active records", () => { expect(lifecycleView(null)).toBe("active"); expect(lifecycleMatches(archived.archived_at, "active")).toBe(false); });
  it("retains assessments, reports, evidence, drafts and both event histories in archived detail", async () => {
    const tables = {
      local_business_lead_assessments: [{ id: "assessment", lead_id: id, assessed_at: "2026-10-18" }],
      local_business_audit_reports: [{ id: "report", lead_id: id, assessment_id: "assessment" }],
      local_business_outreach_drafts: [{ id: "draft", lead_id: id, status: "sent" }],
      local_business_visual_evidence: [{ id: "evidence", lead_id: id }],
      local_business_lead_events: [{ id: "canonical-event", lead_id: id }],
      opportunity_console_audit_log: [{ id: "archive-event", lead_id: id, action: "opportunity_archived" }],
    };
    const h = harness({ archived: true, tables }); const body = await (await h.getOpportunity(id)).json();
    expect(body.lead.archived_at).toBeTruthy(); expect(body.lead.status).toBe("disqualified");
    for (const key of ["assessments", "audit_reports", "outreach_drafts", "visual_evidence", "events", "console_events"]) expect(body[key]).toHaveLength(1);
  });
  it("never queues archived records in bulk work", () => {
    expect(canSelectOpportunity({ pipeline_status: "discovered", enrichment_running: false, archived_at: archived.archived_at } as OppRow)).toBe(false);
  });
});
