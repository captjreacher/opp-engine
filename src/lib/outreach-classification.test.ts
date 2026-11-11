import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { GBP_OFFER_MAP } from "../../supabase/functions/_shared/gbpCommercial";
import { canonicalJson } from "../../supabase/functions/_shared/scenarioReports";

const source = ts.createSourceFile(
  "opportunities.ts",
  readFileSync("supabase/functions/opportunities/index.ts", "utf8"),
  ts.ScriptTarget.Latest,
  true,
);
const node = source.statements.find(
  (entry) => ts.isFunctionDeclaration(entry) && entry.name?.text === "classifyOutreachDraft",
)!;
function classifier(supabase: unknown) {
  return new Function(
    "deps",
    `const {supabase,canonicalJson,GBP_OFFER_MAP}=deps;${ts.transpileModule(node.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText};return classifyOutreachDraft;`,
  )({ canonicalJson, GBP_OFFER_MAP, supabase });
}

function fixture(kind: "gbp" | "website" = "gbp") {
  const code = kind === "gbp" ? "G01" : "website";
  const offer = kind === "gbp" ? GBP_OFFER_MAP.G01 : null;
  const template = {
    id: offer?.templateId ?? "website-template",
    version: 1,
    enabled: kind === "website",
    scenario_keys: [code],
    offer_id: offer?.productId ?? "website-plan",
    product_id: offer?.productId ?? "website-product",
    destination: offer?.destination ?? "https://example.invalid/website",
  };
  const report = {
    business: { id: "lead-id", name: "Fixture business" },
    scenario: { id: "scenario-id", key: code, version: 1 },
    source_scenario: { id: "scenario-id", key: code, version: 1 },
    source_template: { id: template.id, version: template.version },
    source_assessment_id: "assessment-id",
    ...(kind === "gbp" ? {} : { offer: { id: "website-plan", plan_id: "website-plan", product_id: "website-product", price_version: "price-v1", destination: "https://example.invalid/website" } }),
  };
  const row = { id: "report-id", lead_id: "lead-id", assessment_id: "assessment-id", scenario_id: "scenario-id", fingerprint: "f".repeat(64), created_at: "2026-11-01T00:00:00Z", report };
  const draft = {
    scenario_id: "scenario-id",
    scenario_version: 1,
    selection: {
      template_id: template.id,
      template_version: template.version,
      scenario_keys: [code],
      offer_id: template.offer_id,
      product_id: template.product_id,
      destination: template.destination,
      assessment_id: "assessment-id",
      report_ids: [row.id],
    },
  };
  return { template, report, row, draft };
}

function run(overrides: (value: ReturnType<typeof fixture>) => void = () => {}) {
  const value = fixture();
  overrides(value);
  const related = [(value as any).superseded ? value.row : value.row];
  if ((value as any).superseded) related.push({ ...value.row, id: "newer-report", created_at: "2026-11-02T00:00:00Z" });
  const supabase = {
    from(table: string) {
      const q: any = {
        select: () => q,
        eq: () => q,
        in(column: string) {
          if (table === "opportunity_scenario_reports" && column === "id") return Promise.resolve({ data: [value.row], error: null });
          if (table === "opportunity_scenario_reports" && column === "scenario_id") return Promise.resolve({ data: related, error: null });
          if (table === "opportunity_scenarios" && column === "id") return Promise.resolve({ data: (value as any).missingScenario ? [] : [{ id: "scenario-id", slug: value.report.scenario.key, version: 1, status: "active" }], error: null });
          return q;
        },
        maybeSingle: async () => {
          if (table === "local_business_leads") return { data: { id: "lead-id", business_name: "Fixture business" }, error: null };
          if (table === "local_business_lead_assessments") return { data: { id: "assessment-id", scenario_matches: (value as any).missingMatch ? [] : [{ scenario_id: "scenario-id", scenario_key: value.report.scenario.key, scenario_version: 1 }] }, error: null };
          return { data: value.template, error: null };
        },
      };
      return q;
    },
  };
  return classifier(supabase)("lead-id", value.draft);
}

describe("authoritative outreach classification", () => {
  it.each(["snapshot", "qualification", "both"])("classifies GBP from scenario identity with %s metadata absent", async () => {
    await expect(run()).resolves.toEqual({ kind: "gbp", scenarioCode: "G01" });
  });

  it("classifies a canonical Website report only when its commercial identity matches", async () => {
    await expect(run((value) => Object.assign(value, fixture("website")))).resolves.toEqual({ kind: "website" });
  });

  it("does not classify a Website-compatible template as GBP or a GBP template as Website", async () => {
    await expect(run((value) => {
      const website = fixture("website");
      Object.assign(value, website);
      value.draft.selection.template_id = GBP_OFFER_MAP.G01.templateId;
    })).resolves.toMatchObject({ kind: "unsupported" });
  });

  it.each([
    "missing scenario key",
    "cross-lead report",
    "superseded report",
    "draft identity changed",
    "mismatched report template",
  ])("fails closed for %s", async (caseName) => {
    await expect(run((value) => {
      if (caseName === "missing scenario key") (value.report.scenario as any).key = "";
      if (caseName === "cross-lead report") value.row.lead_id = "other-lead";
      if (caseName === "superseded report") (value as any).superseded = true;
      if (caseName === "draft identity changed") value.draft.scenario_id = "other-scenario";
      if (caseName === "mismatched report template") (value.report.source_template as any).id = "other-template";
    })).resolves.toMatchObject({ kind: "unsupported" });
  });

  it.each([
    "missing canonical scenario",
    "wrong scenario version",
    "wrong assessment",
    "scenario absent from assessment matches",
    "cross-business report identity",
    "mismatched template version",
    "substituted commercial offer",
    "wrong product or plan",
    "wrong destination",
    "ambiguous combined selection",
  ])("rejects adversarial canonical ownership case: %s", async (caseName) => {
    await expect(run((value) => {
      if (["substituted commercial offer", "wrong product or plan", "wrong price version", "wrong destination"].includes(caseName)) Object.assign(value, fixture("website"));
      if (caseName === "missing canonical scenario") (value as any).missingScenario = true;
      if (caseName === "wrong scenario version") (value.report.scenario as any).version = 2;
      if (caseName === "wrong assessment") value.row.assessment_id = "other-assessment";
      if (caseName === "scenario absent from assessment matches") (value as any).missingMatch = true;
      if (caseName === "cross-business report identity") (value.report.business as any).id = "other-lead";
      if (caseName === "mismatched template version") value.draft.selection.template_version = 99;
      if (caseName === "substituted commercial offer") (value.report as any).offer.id = "other-plan";
      if (caseName === "wrong product or plan") (value.report as any).offer.product_id = "other-product";
      if (caseName === "wrong destination") (value.report as any).offer.destination = "https://example.invalid/other";
      if (caseName === "ambiguous combined selection") {
        value.draft.selection.scenario_keys = ["G01", "G02"];
        value.draft.selection.report_ids = ["report-id", "other-report"];
      }
    })).resolves.toMatchObject({ kind: "unsupported" });
  });
});
