import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, it, expect, vi } from "vitest";
import {
  canonicalJson,
  buildScenarioReport,
} from "../../supabase/functions/_shared/scenarioReports";
const source = readFileSync(
  "supabase/functions/opportunities/index.ts",
  "utf8",
);
function execute(name: string, deps: Record<string, unknown>) {
  const file = ts.createSourceFile(
    "api.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const node = file.statements.find(
    (n) => ts.isFunctionDeclaration(n) && n.name?.text === name,
  )!;
  const js = ts.transpileModule(node.getText(file), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function(
    "deps",
    `const {${Object.keys(deps).join(",")}}=deps;${js};return ${name};`,
  )(deps);
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
describe("scenario outreach handler boundaries", () => {
  it("creates one business draft from all selected reports and never invokes mail or audits", async () => {
    const insert = vi.fn();
    const from = vi.fn((table: string) => {
      const query: any = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({
          data: { business_name: "Business" },
          error: null,
        }),
        insert: (data: unknown) => {
          insert(table, data);
          return query;
        },
        single: async () => ({
          data: { id: "draft", status: "draft" },
          error: null,
        }),
      };
      return query;
    });
    const selection = {
      report_ids: ["website-report", "profile-report"],
      scenario_keys: ["website", "profile"],
      offer_id: "approved",
    };
    const prepare = vi.fn().mockResolvedValue({
      selection,
      rendered: {
        subject: "Subject",
        body: "Both scenarios and commercial details",
      },
    });
    const create = execute("createOutreach", {
      supabase: { from },
      json,
      candidateForLead: async () => null,
      prepareSelectedOutreach: prepare,
    });
    expect((await create("lead", { template_id: "combined" })).status).toBe(
      201,
    );
    expect(prepare).toHaveBeenCalledWith("lead", "combined");
    expect(
      insert.mock.calls.filter(
        ([table]) => table === "local_business_outreach_drafts",
      ),
    ).toEqual([
      [
        "local_business_outreach_drafts",
        expect.objectContaining({
          status: "draft",
          selection,
          body: "Both scenarios and commercial details",
        }),
      ],
    ]);
    expect(from.mock.calls.flat()).not.toContain(
      "local_business_audit_reports",
    );
  });
  it("does not write any draft if current commercial resolution fails", async () => {
    const insert = vi.fn();
    const q: any = {
      select: () => q,
      eq: () => q,
      maybeSingle: async () => ({ data: { business_name: "Business" } }),
      insert,
    };
    const create = execute("createOutreach", {
      supabase: { from: () => q },
      json,
      candidateForLead: async () => null,
      prepareSelectedOutreach: async () => {
        throw new Error("Offer withdrawn");
      },
    });
    const response = await create("lead", {});
    expect(response.status).toBe(422);
    expect(insert).not.toHaveBeenCalled();
  });
  it("rechecks current reports at review/send and blocks offer or assessment drift", async () => {
    const selection = {
      template_id: "template",
      report_ids: ["report"],
      offer_id: "plan",
      assessment_id: "assessment",
    };
    const prepare = vi.fn().mockResolvedValue({
      selection,
      rendered: { subject: "Subject", body: "Body", required_blocks: [] },
      template: {},
    });
    const validate = execute("validateDraftSelection", {
      prepareSelectedOutreach: prepare,
      canonicalJson,
      validateEmailEdit: () => null,
    });
    expect(
      await validate("lead", {
        selection: {
          assessment_id: "assessment",
          offer_id: "plan",
          report_ids: ["report"],
          template_id: "template",
        },
        subject: "Subject",
        body: "Body",
      }),
    ).toBeNull();
    prepare.mockResolvedValue({
      selection: { ...selection, report_ids: ["new-price-report"] },
      rendered: {},
      template: {},
    });
    expect(await validate("lead", { selection })).toContain("changed");
    expect(await validate("lead", { selection: null })).toContain("legacy");
  });
  it("saving reviewed edits resets approval and requires a separate human approval", async () => {
    const existing = {
      status: "approved",
      subject: "Subject",
      body: "Hello,",
      updated_at: "2026-10-20",
    };
    let fields: any;
    const update = vi.fn((next) => {
      fields = next;
      return query;
    });
    const query: any = {
      select: () => query,
      eq: () => query,
      maybeSingle: async () => ({ data: existing }),
      update,
      insert: async () => ({}),
    };
    const mutate = execute("updateOutreach", {
      supabase: { from: () => query },
      json,
      validateDraftSelection: async () => null,
    });
    expect((await mutate("lead", "draft", { body: "Kia ora," })).status).toBe(
      200,
    );
    expect(fields).toMatchObject({
      body: "Kia ora,",
      status: "draft",
      approved_at: null,
      approved_by: null,
    });
    expect(
      (
        await mutate("lead", "draft", {
          body: "Kia ora,",
          status: "approved",
          reviewed: true,
        })
      ).status,
    ).toBe(422);
  });
});

describe("automatic report persistence", () => {
  it("persists a report for every assessed scenario even when offers cannot resolve", async () => {
    const stored = new Map<string, unknown>();
    const inserts: any[] = [];
    const from = (table: string) => {
      let fingerprint = "";
      const query: any = {
        select: () => query,
        eq: (key: string, value: string) => {
          if (key === "fingerprint") fingerprint = value;
          return query;
        },
        upsert: async (row: any) => {
          inserts.push(row);
          stored.set(row.fingerprint, {
            id: row.fingerprint,
            report: row.report,
          });
          return { error: null };
        },
        single: async () => ({
          data:
            table === "opportunity_scenarios"
              ? { name: "Recorded scenario", version: 1, report_config: {} }
              : stored.get(fingerprint),
          error: null,
        }),
        then: (resolve: any) =>
          Promise.resolve({ data: [], error: null }).then(resolve),
      };
      return query;
    };
    const matches = ["confirmed", "uncertain"].map((state, i) => ({
      scenario_key: "scenario-" + i,
      scenario_id: "id-" + i,
      scenario_version: 1,
      state,
      evidence: [],
      assessed_at: "2026-10-20",
      score: null,
    }));
    const prepare = execute("prepareScenarioReports", {
      supabase: { from },
      crypto,
      canonicalJson,
      buildScenarioReport,
    });
    const result = await prepare(
      "lead",
      { id: "assessment", scenario_matches: matches },
      { id: "lead", business_name: "Recorded business" },
    );
    expect(result).toHaveLength(2);
    expect(result.map((r: any) => r.report.confidence)).toEqual([
      "confirmed",
      "uncertain",
    ]);
    expect(
      result.every(
        (r: any) =>
          r.report.commercial_block ===
          "No approved scenario-to-offer mapping.",
      ),
    ).toBe(true);
    expect(
      inserts.every(
        (r) =>
          r.assessment_id === "assessment" &&
          r.report.source_assessment.scenario_matches.length === 2,
      ),
    ).toBe(true);
  });
});
