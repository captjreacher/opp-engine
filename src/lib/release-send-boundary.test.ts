import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, it, expect, vi } from "vitest";
const source = ts.createSourceFile(
  "api.ts",
  readFileSync("supabase/functions/opportunities/index.ts", "utf8"),
  ts.ScriptTarget.Latest,
  true,
);
function execute(name: string, deps: Record<string, unknown>) {
  const node = source.statements.find(
    (n) => ts.isFunctionDeclaration(n) && n.name?.text === name,
  )!;
  const js = ts.transpileModule(node.getText(source), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function(
    "deps",
    `const {${Object.keys(deps).join(",")}}=deps;${js};return ${name};`,
  )(deps);
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
function harness(options: { gbp?: boolean; gbpSnapshot?: boolean; gbpValidationError?: string | null; dispatch?: "website" | "gbp" | "unsupported" } = {}) {
  const draft = {
    id: "draft",
    status: "approved",
    subject: "Reviewed subject",
    body: "Reviewed facts and approved offer",
    selection: { report_ids: ["report"] },
    updated_at: "2026-10-21",
    approval_fingerprint: "a".repeat(64),
    approved_current_assessment_id: "assessment",
    approved_scenario_report_id: "report",
    approved_recipient: "sink@example.invalid",
    approved_destination_url: "https://example.invalid/offer",
    approved_commercial_reference: {},
    ...(options.gbp && options.gbpSnapshot !== false ? { gbp_commercial_snapshot: { scenarioCode: "G01" } } : {}),
  };
  const calls: string[] = [];
  const mail = vi.fn(async () => {
    calls.push("mock-transport");
  });
  const query = (table: string) => {
    const q: any = {
      select: () => q,
      eq: () => q,
      maybeSingle: async () => ({
        data:
          table === "local_business_outreach_drafts"
            ? draft
            : {
                business_name: "Fixture",
                status: "assessed",
                email: "fixture@example.invalid",
                phone: null,
              },
        error: null,
      }),
    };
    return q;
  };
  const rpc = vi.fn(
    async (
      name: string,
    ): Promise<{
      data: Record<string, unknown> | null;
      error: { message: string } | null;
    }> => {
      calls.push(name);
      if (name === "check_prospect_eligibility")
        return { data: { classification: "eligible" }, error: null };
      if (name === "opportunity_claim_outreach_send")
        return { data: { ok: true, attempt_id: "attempt" }, error: null };
      if (name === "opportunity_start_outreach_send")
        return { data: { ok: true, state: "sending", attempt_id: "attempt" }, error: null };
      if (name === "opportunity_finish_outreach_send")
        return { data: { draft: { ...draft, status: "sent" } }, error: null };
      return { data: null, error: null };
    },
  );
  const validate = vi.fn(async () => {
    calls.push("revalidate-offer");
    return null as string | null;
  });
  const validateGbp = vi.fn(async () => options.gbpValidationError ?? null);
  const classify = vi.fn(async () => ({ kind: options.dispatch ?? (options.gbp ? "gbp" : "website"), ...(options.gbp ? { scenarioCode: "G01" } : {}) }));
  const send = execute("sendOutreach", {
    supabase: { from: query, rpc },
    json,
    getSmtpConfig: () => ({}),
    Deno: {
      env: {
        get: (key: string) =>
          key === "OUTREACH_TEST_EMAIL" ? "sink@example.invalid" : "test",
      },
    },
    validateDraftSelection: validate,
    validateGbpDraft: validateGbp,
    classifyOutreachDraft: classify,
    candidateForLead: async () => null,
    classificationAllowsProgress: (c: string) => c === "eligible",
    eligibilityClassification: () => "eligible",
    isValidEmailAddress: () => true,
    esc: (s: string) => s,
    htmlFromBody: (s: string) => s,
    sendSmtpEmail: mail,
  });
  return { send, draft, calls, rpc, mail, validate, validateGbp, classify };
}
describe("release manual-send boundary (mock transport only)", () => {
  it("orders commercial revalidation, fresh eligibility, atomic claim, mock transport and atomic completion", async () => {
    const h = harness();
    const response = await h.send("lead", "draft", { confirm_send: true });
    expect(response.status).toBe(200);
    expect(h.calls).toEqual([
      "revalidate-offer",
      "check_prospect_eligibility",
      "revalidate-offer",
      "opportunity_claim_outreach_send",
      "opportunity_start_outreach_send",
      "mock-transport",
      "opportunity_finish_outreach_send",
    ]);
    expect(h.rpc).toHaveBeenCalledWith(
      "opportunity_claim_outreach_send",
      expect.objectContaining({
        p_approval_fingerprint: "a".repeat(64),
        p_recipient: "sink@example.invalid",
      }),
    );
    expect(h.mail).toHaveBeenCalledTimes(1);
  });
  it("never calls transport without manual confirmation or approval", async () => {
    const h = harness();
    expect((await h.send("lead", "draft", {})).status).toBe(422);
    h.draft.status = "draft";
    expect((await h.send("lead", "draft", { confirm_send: true })).status).toBe(
      409,
    );
    expect(h.mail).not.toHaveBeenCalled();
  });
  it("blocks changed commercial data before claim or transport", async () => {
    const h = harness();
    h.validate.mockResolvedValue("Offer withdrawn");
    expect((await h.send("lead", "draft", { confirm_send: true })).status).toBe(
      422,
    );
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.mail).not.toHaveBeenCalled();
  });
  it.each([
    "GBP template was withdrawn or changed.",
    "GBP report and commercial snapshot differ.",
    "GBP price or approved scope changed.",
  ])("revalidates GBP at send time and blocks %s before claim or transport", async (detail) => {
    const h = harness({ gbp: true, gbpValidationError: detail });
    const response = await h.send("lead", "draft", { confirm_send: true });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: "outreach_mapping_not_ready", detail });
    expect(h.validateGbp).toHaveBeenCalledWith("lead", h.draft);
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.mail).not.toHaveBeenCalled();
  });

  it("classifies a GBP draft from authoritative identity even when its snapshot is null", async () => {
    const h = harness({ gbp: true, gbpSnapshot: false, dispatch: "gbp", gbpValidationError: "GBP commercial snapshot is required." });
    const response = await h.send("lead", "draft", { confirm_send: true });
    expect(response.status).toBe(422);
    expect(h.classify).toHaveBeenCalledWith("lead", h.draft);
    expect(h.validateGbp).toHaveBeenCalledWith("lead", h.draft);
    expect(h.validate).not.toHaveBeenCalled();
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.mail).not.toHaveBeenCalled();
  });

  it("fails closed for an unsupported or ambiguous scenario before claim or SMTP", async () => {
    const h = harness({ dispatch: "unsupported" });
    const response = await h.send("lead", "draft", { confirm_send: true });
    expect(response.status).toBe(422);
    expect(h.validate).not.toHaveBeenCalled();
    expect(h.validateGbp).not.toHaveBeenCalled();
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.mail).not.toHaveBeenCalled();
  });
  it("passes a valid GBP draft through validation but preserves the unreleased send gate", async () => {
    const h = harness({ gbp: true });
    const response = await h.send("lead", "draft", { confirm_send: true });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "gbp_commercial_send_not_released" });
    expect(h.validateGbp).toHaveBeenCalledWith("lead", h.draft);
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.mail).not.toHaveBeenCalled();
  });
  it("fails closed for an unknown GBP scenario before claim or SMTP", async () => {
    const h = harness({ gbp: true, gbpValidationError: "GBP template or destination changed." });
    h.draft.gbp_commercial_snapshot = { scenarioCode: "unknown" };
    expect((await h.send("lead", "draft", { confirm_send: true })).status).toBe(422);
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.mail).not.toHaveBeenCalled();
  });
  it("retains an uncertain claim after a mock transport error and does not retry", async () => {
    const h = harness();
    h.mail.mockRejectedValue(new Error("Mock uncertainty"));
    const r = await h.send("lead", "draft", { confirm_send: true });
    expect(r.status).toBe(502);
    expect(await r.json()).toMatchObject({
      retryable: false,
      reconciliation_required: true,
    });
    expect(h.rpc).toHaveBeenCalledWith(
      "opportunity_finish_outreach_send",
      expect.objectContaining({ p_state: "send_unknown" }),
    );
    expect(h.mail).toHaveBeenCalledTimes(1);
  });
  it("does not report success if post-transport atomic completion fails", async () => {
    const h = harness();
    h.rpc.mockImplementation(async (name: string) =>
      name === "opportunity_finish_outreach_send"
        ? { data: null, error: { message: "Mock transaction failure" } }
        : name === "opportunity_claim_outreach_send"
          ? { data: { ok: true, attempt_id: "attempt" }, error: null }
          : name === "opportunity_start_outreach_send"
            ? { data: { ok: true, state: "sending", attempt_id: "attempt" }, error: null }
        : name === "check_prospect_eligibility"
          ? { data: { classification: "eligible" }, error: null }
          : { data: null, error: null },
    );
    const r = await h.send("lead", "draft", { confirm_send: true });
    expect(r.status).toBe(502);
    expect(await r.json()).toMatchObject({
      error: "send_completion_unconfirmed",
      reconciliation_required: true,
    });
    expect(h.mail).toHaveBeenCalledTimes(1);
  });
  it("refuses a changed recipient or duplicate claim before transport", async () => {
    const h = harness();
    h.rpc.mockImplementation(async (name: string) =>
      name === "check_prospect_eligibility"
        ? { data: { classification: "eligible" }, error: null }
        : { data: null, error: { message: "reviewed_draft_changed" } },
    );
    expect((await h.send("lead", "draft", { confirm_send: true })).status).toBe(
      409,
    );
    expect(h.mail).not.toHaveBeenCalled();
  });
});

describe("read-only archived report materialisation", () => {
  it("reads retained reports without Billing, scenario lookup or writes", async () => {
    const from = vi.fn();
    const q: any = {
      select: () => q,
      eq: () => q,
      order: async () => ({
        data: [
          { id: "retained", report: { source_assessment_id: "assessment" } },
        ],
        error: null,
      }),
    };
    from.mockReturnValue(q);
    const prepare = execute("prepareScenarioReports", { supabase: { from } });
    const reports = await prepare(
      "lead",
      { id: "assessment" },
      { archived_at: "2026-10-21" },
    );
    expect(reports).toEqual([
      { id: "retained", report: { source_assessment_id: "assessment" } },
    ]);
    expect(from).toHaveBeenCalledExactlyOnceWith(
      "opportunity_scenario_reports",
    );
  });
});

describe("human review snapshot and shortcut", () => {
  it("does not approve a GBP draft with missing provenance through Website validation", async () => {
    const existing = {
      id: "draft",
      status: "draft",
      subject: "GBP review",
      body: "Body",
      updated_at: "2026-10-21T01:00:00Z",
      selection: { scenario_keys: ["G01"], report_ids: ["report"] },
    };
    const q: any = {
      select: () => q,
      eq: () => q,
      maybeSingle: async () => ({ data: existing, error: null }),
      update: vi.fn(),
    };
    const validateWebsite = vi.fn(async () => null);
    const validateGbp = vi.fn(async () => "GBP commercial snapshot is required.");
    const approve = execute("updateOutreach", {
      supabase: { from: () => q },
      json,
      classifyOutreachDraft: async () => ({ kind: "gbp", scenarioCode: "G01" }),
      validateDraftSelection: validateWebsite,
      validateGbpDraft: validateGbp,
    });
    const response = await approve("lead", "draft", {
      status: "approved",
      reviewed: true,
      expected_updated_at: existing.updated_at,
    });
    expect(response.status).toBe(422);
    expect(validateGbp).toHaveBeenCalledWith("lead", existing);
    expect(validateWebsite).not.toHaveBeenCalled();
    expect(q.update).not.toHaveBeenCalled();
  });

  it("refuses approval when another operator has changed the saved draft", async () => {
    const existing = {
      id: "draft",
      status: "draft",
      subject: "Reviewed subject",
      body: "Body",
      updated_at: "2026-10-21T01:00:00Z",
    };
    const update = vi.fn();
    const q: any = {
      select: () => q,
      eq: () => q,
      maybeSingle: async () => ({ data: existing, error: null }),
      update,
    };
    const approve = execute("updateOutreach", {
      supabase: { from: () => q },
      json,
      validateDraftSelection: async () => null,
      classifyOutreachDraft: async () => ({ kind: "website" }),
    });
    expect(
      (
        await approve("lead", "draft", {
          status: "approved",
          reviewed: true,
          expected_updated_at: "2026-10-21T00:00:00Z",
        })
      ).status,
    ).toBe(409);
    expect(update).not.toHaveBeenCalled();
  });
  it("the workflow send shortcut cannot call the mail handler", () => {
    const detail = readFileSync("src/routes/OpportunityDetail.tsx", "utf8");
    const start = detail.indexOf(
      'case "sent":',
      detail.indexOf("function handleWorkflowStep"),
    );
    const block = detail.slice(start, detail.indexOf("break;", start));
    expect(block).toContain("scrollIntoView");
    expect(block).not.toContain("handleSendDraft");
  });
});
