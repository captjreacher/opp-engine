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
function harness() {
  const draft = {
    id: "draft",
    status: "approved",
    subject: "Reviewed subject",
    body: "Reviewed facts and approved offer",
    selection: { report_ids: ["report"] },
    updated_at: "2026-10-21",
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
      if (name === "complete_scenario_outreach_send")
        return { data: { draft: { ...draft, status: "sent" } }, error: null };
      return { data: null, error: null };
    },
  );
  const validate = vi.fn(async () => {
    calls.push("revalidate-offer");
    return null as string | null;
  });
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
    candidateForLead: async () => null,
    classificationAllowsProgress: (c: string) => c === "eligible",
    eligibilityClassification: () => "eligible",
    isValidEmailAddress: () => true,
    esc: (s: string) => s,
    htmlFromBody: (s: string) => s,
    sendSmtpEmail: mail,
  });
  return { send, draft, calls, rpc, mail, validate };
}
describe("release manual-send boundary (mock transport only)", () => {
  it("orders commercial revalidation, fresh eligibility, atomic claim, mock transport and atomic completion", async () => {
    const h = harness();
    const response = await h.send("lead", "draft", { confirm_send: true });
    expect(response.status).toBe(200);
    expect(h.calls).toEqual([
      "revalidate-offer",
      "check_prospect_eligibility",
      "claim_scenario_outreach_send",
      "mock-transport",
      "complete_scenario_outreach_send",
    ]);
    expect(h.rpc).toHaveBeenCalledWith(
      "claim_scenario_outreach_send",
      expect.objectContaining({
        p_expected_email: "fixture@example.invalid",
        p_selection: h.draft.selection,
        p_send_metadata: expect.objectContaining({
          recipient: "sink@example.invalid",
          live: false,
        }),
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
      "complete_scenario_outreach_send",
      expect.objectContaining({ p_sent: false }),
    );
    expect(h.mail).toHaveBeenCalledTimes(1);
  });
  it("does not report success if post-transport atomic completion fails", async () => {
    const h = harness();
    h.rpc.mockImplementation(async (name: string) =>
      name === "complete_scenario_outreach_send"
        ? { data: null, error: { message: "Mock transaction failure" } }
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
