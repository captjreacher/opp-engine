import { describe, it, expect, vi } from "vitest";
import {
  buildScenarioReport,
  resolveOffer,
  reportEmail,
  validateEmailEdit,
  canonicalJson,
  billingReadConfiguration,
} from "../../supabase/functions/_shared/scenarioReports";
import type {
  ScenarioMatch,
  OutreachTemplate,
} from "../../supabase/functions/_shared/companyScenarios";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import ScenarioReportView from "../components/ScenarioReportView";

const template: OutreachTemplate & {
  approved_details: {
    approved_at: string;
    inclusions: string[];
    terms: string[];
  };
} = {
  id: "template",
  version: 2,
  name: "Reviewed",
  scenario_keys: ["website"],
  combined: false,
  enabled: true,
  subject: "Opportunity for {{business_name}}",
  body: "Hello,\nWe reviewed the recorded observations for {{business_name}}.",
  offer_id: "plan-existing",
  destination: "https://maximisedai.com/products/verified",
  destination_verified_at: "2026-10-01",
  approved_details: {
    approved_at: "2026-10-01",
    inclusions: ["Approved service page"],
    terms: ["Scope confirmation required"],
  },
};
const plan = {
  planId: template.offer_id,
  productId: "product-existing",
  name: "Approved Website",
  description: "Website scope discussion",
  isSellable: true,
  isArchived: false,
  billingType: "one-off",
};
const price = {
  planId: template.offer_id,
  planVersionId: "price-v3",
  version: 3,
  status: "published",
  effectiveFrom: "2026-10-01",
  effectiveTo: null,
  price: {
    kind: "fixed",
    currency: "NZD",
    amountMinor: 123456,
    taxTreatment: "exclusive",
    taxRate: 1500,
  },
};
const config = {
  base: "https://billing.example/api/v1",
  token: "fixture-only",
};
function billing(
  p = plan,
  pv: unknown = price,
  product = { productId: "product-existing", lifecycleStatus: "published" },
) {
  return vi.fn(
    async (url: RequestInfo | URL) =>
      new Response(
        JSON.stringify({
          data: String(url).includes("/prices/current")
            ? { current: pv }
            : String(url).includes("/products/")
              ? product
              : p,
        }),
        { status: 200 },
      ),
  ) as typeof fetch;
}
function match(key = "website"): ScenarioMatch {
  return {
    scenario_key: key,
    scenario_id: `scenario-${key}`,
    scenario_version: 2,
    state: "confirmed",
    assessed_at: "2026-10-20",
    score: 70,
    evidence: [
      {
        key: "observed",
        description: `Recorded ${key} signal`,
        source: "https://evidence.example/record",
        supported: true,
        score: 70,
        value: 42,
      },
      {
        key: "unsupported",
        description: "Guaranteed growth",
        source: "missing",
        supported: false,
        score: 0,
        value: null,
      },
    ],
  };
}
async function report(key = "website") {
  return buildScenarioReport({
    lead: { id: "lead", business_name: "Test Business", category: "Services" },
    assessment: { id: "assessment", scenario_matches: [match(key)] },
    scenario: { name: key, version: 2, report_config: {} },
    match: match(key),
    template,
    offer: await resolveOffer(template, config, billing()),
    blocked: null,
  });
}
describe("approved Billing resolution", () => {
  it("uses exact identity and current version, price, GST, components and terms", async () => {
    const request = billing();
    const offer = await resolveOffer(template, config, request);
    expect(offer).toMatchObject({
      id: template.offer_id,
      name: plan.name,
      price_version: "price-v3",
      price_text: "NZD 1234.56 · one-off · GST exclusive (15%)",
      components: template.approved_details.inclusions,
      terms: template.approved_details.terms,
    });
    expect(request).toHaveBeenCalledTimes(3);
    expect(request).toHaveBeenNthCalledWith(
      1,
      `${config.base}/catalogue/plans/${template.offer_id}`,
      expect.objectContaining({ redirect: "error" }),
    );
  });
  it.each([
    { ...plan, isSellable: false },
    { ...plan, isArchived: true },
    { ...plan, planId: "another-plan" },
  ])("blocks withdrawn, archived and mismatched offers", async (p) => {
    await expect(resolveOffer(template, config, billing(p))).rejects.toThrow();
  });
  it.each([
    null,
    { ...price, status: "draft" },
    { ...price, effectiveFrom: "2099-01-01" },
    { ...price, planId: "other" },
    { ...price, price: { ...price.price, taxTreatment: null } },
    { ...price, price: { ...price.price, amountMinor: null } },
  ])("blocks missing, stale or incomplete commercial data", async (pv) => {
    await expect(
      resolveOffer(template, config, billing(plan, pv)),
    ).rejects.toThrow();
  });
  it("does not substitute zero for published POA", async () => {
    const offer = await resolveOffer(
      template,
      config,
      billing(plan, {
        ...price,
        price: { kind: "poa", taxTreatment: "exempt", taxRate: null },
      }),
    );
    expect(offer.price_text).toContain("Price on application");
    expect(offer.price_text).not.toContain("0.00");
  });
  it("fails closed on missing approved terms, unpublished product, transport or configuration errors", async () => {
    await expect(
      resolveOffer(
        {
          ...template,
          approved_details: { ...template.approved_details, terms: [] },
        },
        config,
        billing(),
      ),
    ).rejects.toThrow();
    await expect(
      resolveOffer(
        template,
        config,
        billing(plan, price, {
          productId: "product-existing",
          lifecycleStatus: "draft",
        }),
      ),
    ).rejects.toThrow();
    await expect(
      resolveOffer(
        template,
        config,
        vi.fn().mockRejectedValue(new Error("offline")),
      ),
    ).rejects.toThrow();
    await expect(
      resolveOffer(template, { base: "", token: "" }, billing()),
    ).rejects.toThrow();
  });
});
describe("reproducible reports and one reviewed business email", () => {
  it("renders all ten report sections with source versions", async () => {
    const r = await report();
    const html = renderToStaticMarkup(
      createElement(ScenarioReportView, { report: r }),
    );
    expect(html.match(/<dt/g) ?? []).toHaveLength(10);
    expect(html).toContain("View Scenario Report");
    expect(html).toContain("price-v3");
    expect(r.source_assessment_id).toBe("assessment");
    expect(r.source_template?.version).toBe(2);
    expect(r.template_version).toBe("mgrnz-scenario-report-v1");
    expect(r.opportunity).not.toContain("Guaranteed");
    expect(r.potential_impact).toContain("not been established");
  });
  it("keeps scenario evidence separate in one business-level combined email", async () => {
    const reports = await Promise.all([report("website"), report("profile")]);
    const message = reportEmail(
      { ...template, combined: true, scenario_keys: ["website", "profile"] },
      reports,
      "Test Business",
    );
    expect(message.body).toContain("Recorded website signal");
    expect(message.body).toContain("Recorded profile signal");
    expect(message.body.match(/NZD 1234.56/g)).toHaveLength(1);
    expect(message.body).toContain(plan.name);
    expect(message.body).toContain(template.destination);
    expect(message.body).not.toContain("Guaranteed");
    expect(message.body).toContain("Would a conversation");
  });
  it("keeps explicit limitations when offer resolution fails and blocks email", async () => {
    const r = {
      ...(await report()),
      offer: null,
      commercial_block: "Offer withdrawn",
    };
    expect(() => reportEmail(template, [r], "Business")).toThrow();
    expect(() =>
      reportEmail(template, [{ ...r, confidence: "uncertain" }], "Business"),
    ).toThrow();
  });
  it("allows reviewed phrase edits and rejects fabricated claims or altered prices", async () => {
    const original = reportEmail(template, [await report()], "Test Business");
    expect(
      validateEmailEdit(
        original.subject,
        original.body.replace("Hello,", "Kia ora,"),
        original,
      ),
    ).toBeNull();
    expect(
      validateEmailEdit(
        original.subject,
        original.body.replace("Hello,", "Guaranteed revenue doubles"),
        original,
      ),
    ).toContain("unsupported");
    expect(
      validateEmailEdit(
        original.subject,
        original.body.replace("1234.56", "1.00"),
        original,
      ),
    ).toContain("commercial details");
  });
  it("compares JSONB snapshots independent of key order", () => {
    expect(canonicalJson({ b: 1, a: { y: 2, x: 3 } })).toBe(
      canonicalJson({ a: { x: 3, y: 2 }, b: 1 }),
    );
  });
});

describe("existing shared Billing configuration",()=>{
  it("reuses the existing API key and normalises the shared API base",async()=>{
    const env:Record<string,string>={BILLING_API_BASE_URL:'https://billing.example/',BILLING_CATALOGUE_API_KEY:'existing-fixture-reader'};
    const config=billingReadConfiguration(key=>env[key]);expect(config).toEqual({base:'https://billing.example/api/v1',token:'existing-fixture-reader',scheme:'ApiKey'});
    const request=billing();await resolveOffer(template,config,request);
    expect(request).toHaveBeenNthCalledWith(1,expect.any(String),expect.objectContaining({headers:expect.objectContaining({Authorization:'ApiKey existing-fixture-reader'})}));
  });
  it("does not replace partially configured shared credentials with preview credentials",()=>{
    const env:Record<string,string>={BILLING_API_BASE_URL:'https://billing.example/api/v1',BILLING_CATALOGUE_BEARER_TOKEN:'preview-only'};
    expect(billingReadConfiguration(key=>env[key])).toEqual({base:'https://billing.example/api/v1',token:'',scheme:'ApiKey'});
  });
});
