import { describe, it, expect } from "vitest";
import {
  evaluateScenarios,
  aggregateScenarios,
  compatibleTemplates,
  selectTemplate,
  renderTemplate,
  type CompanyScenario,
  type OutreachTemplate,
} from "../../supabase/functions/_shared/companyScenarios";
const scenario = (
  slug: string,
  path = "provider.website",
  key = path,
): CompanyScenario => ({
  id: slug,
  slug,
  version: 1,
  status: "active",
  assessment_config: {
    evidence_rules: [
      {
        path,
        equals: true,
        description: `Observed ${slug}`,
        score: 70,
        evidence_key: key,
      },
    ],
  },
});
const facts = { provider: { website: true, profile: true } };
const matches = evaluateScenarios(
  [scenario("website"), scenario("profile", "provider.profile")],
  facts,
  "google_places",
  "2026-10-10T00:00:00Z",
);
const template = (id = "website"): OutreachTemplate => ({
  id,
  version: 1,
  name: id,
  scenario_keys: [id],
  combined: false,
  subject: "Findings for {{business_name}}",
  body: "{{findings}}\nRequest a free assessment: {{destination}}",
  offer_id: "existing-billing-product",
  destination: "https://maximisedai.com/contact/?source=opportunity-engine",
  destination_verified_at: "2026-10-10",
  enabled: true,
});
describe("company scenario evaluation", () => {
  it("evaluates multiple supported scenarios on one company without first-match stopping", () =>
    expect(matches.map((m) => m.state)).toEqual(["confirmed", "confirmed"]));
  it("deduplicates a stable scenario tag across registry versions", () =>
    expect(
      evaluateScenarios(
        [scenario("a"), { ...scenario("a"), version: 2 }],
        facts,
        "provider",
        "date",
      ),
    ).toMatchObject([{ scenario_key: "a", scenario_version: 2 }]));
  it("keeps missing evidence unassessed", () =>
    expect(
      evaluateScenarios([scenario("a")], {}, "provider", "date")[0].state,
    ).toBe("unassessed"));
  it("keeps observed but nonmatching evidence uncertain", () =>
    expect(
      evaluateScenarios(
        [scenario("a")],
        { provider: { website: false } },
        "provider",
        "date",
      )[0].state,
    ).toBe("uncertain"));
  it("retains nonmatching observations without treating them as supported outreach claims", () => {
    const configured = {
      ...scenario("a"),
      assessment_config: {
        evidence_rules: [
          {
            path: "provider.website",
            equals: true,
            description: "Website opportunity",
            score: 70,
          },
          {
            path: "provider.profile",
            equals: false,
            description: "Missing profile",
            score: 80,
          },
        ],
      },
    };
    const evaluated = evaluateScenarios(
      [configured],
      facts,
      "provider",
      "date",
    );
    expect(evaluated[0].evidence).toHaveLength(2);
    expect(evaluated[0].evidence[1]).toMatchObject({
      value: true,
      supported: false,
      source: "provider",
    });
    expect(
      renderTemplate(
        { ...template(), scenario_keys: ["a"] },
        evaluated,
        "Company",
      ).body,
    ).not.toContain("Missing profile");
  });
  it("excludes draft and retired scenarios", () =>
    expect(
      evaluateScenarios(
        [{ ...scenario("a"), status: "draft" }],
        facts,
        "provider",
        "date",
      ),
    ).toEqual([]));
  it("retains evidence, source, time and individual score", () =>
    expect(matches[0]).toMatchObject({
      score: 70,
      assessed_at: "2026-10-10T00:00:00Z",
      evidence: [
        { source: "google_places", value: true, key: "provider.website" },
      ],
    }));
  it("assesses recorded Discovery and enrichment facts together without losing either scenario", () => {
    const result = evaluateScenarios(
      [scenario("website"), scenario("enriched-profile", "enrichment.profile")],
      { ...facts, enrichment: { profile: true } },
      "recorded_discovery_and_enrichment",
      "date",
    );
    expect(result.map((match) => match.state)).toEqual([
      "confirmed",
      "confirmed",
    ]);
  });
});
describe("explainable aggregate scoring", () => {
  it("does not add independent support again when the baseline already exceeds its combined signal", () => {
    expect(aggregateScenarios(matches, 72, 95).overall_score).toBe(203);
  });
  it("bounds malformed inputs within the established scale", () => {
    expect(aggregateScenarios(matches, 1000, 1000).overall_score).toBe(250);
    expect(aggregateScenarios([], NaN, -100).overall_score).toBe(0);
  });
  it("independent evidence can increase priority within the generated 0..250 scale", () => {
    const one = aggregateScenarios([matches[0]], 72, 60),
      many = aggregateScenarios(matches, 72, 60);
    expect(many.overall_score).toBeGreaterThan(one.overall_score);
    expect(many.overall_score).toBeLessThanOrEqual(250);
  });
  it("does not count overlapping evidence or scenario count twice", () =>
    expect(
      aggregateScenarios(
        [matches[0], { ...matches[0], scenario_key: "overlap" }],
        72,
        60,
      ).overall_score,
    ).toBe(aggregateScenarios([matches[0]], 72, 60).overall_score));
  it("does not boost unassessed scenarios and explains unique contribution", () => {
    const a = aggregateScenarios(
      evaluateScenarios([scenario("a")], {}, "provider", "date"),
      72,
      60,
    );
    expect(a.overall_score).toBe(168);
    expect(a.explanation.independent_support).toBe(0);
  });
});
describe("template to offer and manual review contract", () => {
  it("defaults only a single confirmed scenario with one compatible mapping", () =>
    expect(selectTemplate([matches[0]], [template()]).id).toBe("website"));
  it("requires explicit template selection for multiple scenarios", () =>
    expect(() =>
      selectTemplate(matches, [template(), template("profile")]),
    ).toThrow("Select"));
  it("allows selection from compatible templates", () =>
    expect(
      selectTemplate(matches, [template(), template("profile")], "profile").id,
    ).toBe("profile"));
  it("offers combined templates only when explicitly configured and all findings are confirmed", () => {
    const t = {
      ...template(),
      combined: true,
      scenario_keys: ["website", "profile"],
    };
    expect(compatibleTemplates([matches[0]], [t])).toEqual([]);
    expect(compatibleTemplates(matches, [t])).toEqual([t]);
  });
  it.each([null, ""])("blocks a missing destination: %s", (destination) =>
    expect(() =>
      selectTemplate([matches[0]], [{ ...template(), destination }]),
    ).toThrow("verified"),
  );
  it("blocks unverified and unsafe destinations", () => {
    expect(() =>
      selectTemplate(
        [matches[0]],
        [{ ...template(), destination_verified_at: null }],
      ),
    ).toThrow("verified");
    expect(() =>
      selectTemplate(
        [matches[0]],
        [
          {
            ...template(),
            destination:
              "https://maximisedai.com/contact/?email=person@example.com",
          },
        ],
      ),
    ).toThrow("Unsafe");
  });
  it("renders personalisation solely from recorded selected findings", () => {
    const result = renderTemplate(template(), matches, "Company");
    expect(result.body).toContain("Observed website");
    expect(result.body).not.toContain("Observed profile");
    expect(result.body).toContain("Request a free assessment");
  });
  it("rejects unsupported personalisation placeholders", () =>
    expect(() =>
      renderTemplate(
        { ...template(), body: "{{invented_claim}}" },
        matches,
        "Company",
      ),
    ).toThrow("Unsupported"));
});
