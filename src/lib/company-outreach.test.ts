import { readFileSync } from "node:fs";
import { describe, it, expect, vi } from "vitest";
import ts from "typescript";
const source = readFileSync(
  new URL("../../supabase/functions/opportunities/index.ts", import.meta.url),
  "utf8",
);
function functionSource(name: string) {
  const file = ts.createSourceFile(
    "api.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const node = file.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === name,
  )!;
  return ts.transpileModule(node.getText(file), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
}
function harness(
  draft: Record<string, unknown> = {
    id: "draft",
    status: "approved",
    subject: "Observed",
    body: "Recorded",
    selection: {},
  },
) {
  const send = vi.fn();
  const from = vi.fn();
  const validate = vi.fn().mockResolvedValue(null);
  const eligibility = vi
    .fn()
    .mockResolvedValue({ data: { classification: "eligible" }, error: null });
  const query: any = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => ({ data: draft, error: null }),
  };
  from.mockReturnValue(query);
  const dependencies = {
    supabase: { from, rpc: eligibility },
    json: (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status }),
    checkOpportunityWorkflow: async () => null,
    getSmtpConfig: () => ({}),
    Deno: { env: { get: () => "" } },
    validateDraftSelection: validate,
    sendSmtpEmail: send,
    candidateForLead: async () => null,
    classificationAllowsProgress: (
      classification: string,
      acknowledged: boolean,
    ) =>
      classification === "eligible" ||
      (classification === "possible_match" && acknowledged),
    eligibilityClassification: () => "eligible",
  };
  const actions = new Function(
    "deps",
    `const {${Object.keys(dependencies).join(",")}}=deps;${functionSource("sendOutreach")}${functionSource("updateOutreach")}return {sendOutreach,updateOutreach};`,
  )(dependencies);
  return { ...actions, send, from, validate, eligibility };
}
describe("manual outreach gates execute before mail", () => {
  it("refuses a send request without explicit confirmation", async () => {
    const h = harness();
    expect((await h.sendOutreach("lead", "draft", {})).status).toBe(422);
    expect(h.from).not.toHaveBeenCalled();
    expect(h.send).not.toHaveBeenCalled();
  });
  it("rejects an unapproved draft", async () => {
    const h = harness({ status: "draft" });
    expect(
      (await h.sendOutreach("lead", "draft", { confirm_send: true })).status,
    ).toBe(409);
    expect(h.send).not.toHaveBeenCalled();
  });
  it("rejects a sent draft before SMTP", async () => {
    const h = harness({ status: "sent" });
    expect(
      (await h.sendOutreach("lead", "draft", { confirm_send: true })).status,
    ).toBe(409);
    expect(h.send).not.toHaveBeenCalled();
  });
  it.each([
    "existing_customer",
    "suppressed",
    "existing_lead",
    "previously_contacted",
    "possible_match",
    "unknown",
  ])(
    "rechecks current Cockpit state and blocks %s before SMTP",
    async (classification) => {
      const h = harness();
      h.eligibility.mockResolvedValue({
        data: { classification },
        error: null,
      });
      expect(
        (await h.sendOutreach("lead", "draft", { confirm_send: true })).status,
      ).toBe(422);
      expect(h.eligibility).toHaveBeenCalledWith(
        "check_prospect_eligibility",
        expect.any(Object),
      );
      expect(h.send).not.toHaveBeenCalled();
    },
  );
  it("blocks stale findings or an unverified/missing destination before sending", async () => {
    const h = harness();
    h.validate.mockResolvedValue("Destination unverified");
    expect(
      (await h.sendOutreach("lead", "draft", { confirm_send: true })).status,
    ).toBe(422);
    expect(h.send).not.toHaveBeenCalled();
  });
  it("requires explicit manual review when approving", async () => {
    const h = harness({
      status: "draft",
      subject: "Observed",
      body: "Recorded",
    });
    expect(
      (await h.updateOutreach("lead", "draft", { status: "approved" })).status,
    ).toBe(422);
    expect(h.send).not.toHaveBeenCalled();
  });
  it("rejects unrecorded custom claims instead of attributing them to a template", async () => {
    const h = harness({
      status: "draft",
      subject: "Observed",
      body: "Recorded",
    });
    expect(
      (await h.updateOutreach("lead", "draft", { body: "Guaranteed revenue" }))
        .status,
    ).toBe(422);
    expect(h.send).not.toHaveBeenCalled();
  });
  it("refuses approval when the verified mapping changes", async () => {
    const h = harness({
      status: "draft",
      subject: "Observed",
      body: "Recorded",
    });
    h.validate.mockResolvedValue("Template version changed");
    expect(
      (
        await h.updateOutreach("lead", "draft", {
          status: "approved",
          reviewed: true,
        })
      ).status,
    ).toBe(422);
    expect(h.send).not.toHaveBeenCalled();
  });
});

describe("outreach uses current assessment findings", () => {
  async function options(scenarioMatches: Record<string, unknown>[]) {
    const assessmentQuery: any = {
      select: () => assessmentQuery,
      eq: () => assessmentQuery,
      order: () => assessmentQuery,
      limit: () => assessmentQuery,
      maybeSingle: async () => ({
        data: { scenario_matches: scenarioMatches },
        error: null,
      }),
    };
    const templateQuery: any = {
      select: () => templateQuery,
      eq: async () => ({ data: [{ id: "mapped" }], error: null }),
    };
    const from = vi.fn((table: string) =>
      table === "local_business_lead_assessments"
        ? assessmentQuery
        : templateQuery,
    );
    const dependencies = {
      supabase: { from },
      applicableCompanyScenarios: async () => [{ id: "active", version: 2 }],
      compatibleTemplates: (matches: unknown[], templates: unknown[]) =>
        matches.length ? templates : [],
    };
    const get = new Function(
      "deps",
      `const {${Object.keys(dependencies).join(",")}}=deps;${functionSource("outreachOptions")}return outreachOptions;`,
    )(dependencies);
    return { result: await get("lead"), from };
  }
  it("does not use Discovery tags as a completed assessment", async () => {
    const { result, from } = await options([]);
    expect(result.templates).toEqual([]);
    expect(from.mock.calls.map(([table]) => table)).toEqual([
      "local_business_lead_assessments",
      "opportunity_outreach_templates",
    ]);
  });
  it("excludes retired or superseded scenario versions from outreach", async () => {
    const current = { scenario_id: "active", scenario_version: 2 };
    const { result } = await options([
      current,
      { scenario_id: "active", scenario_version: 1 },
      { scenario_id: "retired", scenario_version: 2 },
    ]);
    expect(result.matches).toEqual([current]);
  });
});

describe("assessment and outreach scenario applicability", () => {
  it("keeps every enabled category-compatible scenario, excluding irrelevant scenarios", async () => {
    const active = [
      { id: "website", slug: "website" },
      { id: "profile", slug: "profile" },
      { id: "irrelevant", slug: "irrelevant" },
    ];
    const runQuery: any = {
      select: () => runQuery,
      eq: () => runQuery,
      single: async () => ({
        data: { category_slugs: ["tradie"], all_categories: false },
        error: null,
      }),
    };
    const categoryQuery: any = {
      select: () => categoryQuery,
      in: async () => ({
        data: [{ compatible_scenarios: ["website", "profile"] }],
        error: null,
      }),
    };
    const dependencies = {
      supabase: {
        from: (table: string) =>
          table === "opportunity_discovery_runs" ? runQuery : categoryQuery,
      },
      enabledCompanyScenarios: async () => active,
      candidateForLead: async () => ({ run_id: "run" }),
      categorySupportsScenario: (
        category: { compatible_scenarios: string[] },
        slug: string,
      ) => category.compatible_scenarios.includes(slug),
    };
    const applicable = new Function(
      "deps",
      `const {${Object.keys(dependencies).join(",")}}=deps;${functionSource("applicableCompanyScenarios")}return applicableCompanyScenarios;`,
    )(dependencies);
    expect(await applicable("lead")).toEqual(active.slice(0, 2));
  });
});
