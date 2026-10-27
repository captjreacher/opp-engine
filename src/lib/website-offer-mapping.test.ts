import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  "supabase/migrations/20261027090000_website_scenario_offer_mappings.sql",
  "utf8",
);

describe("approved website scenario mappings", () => {
  it("maps each approved New Website offer to its dedicated MaximisedAI route", () => {
    for (const [product, plan, route] of [
      ["product-maximisedai-landing-page", "plan-maximisedai-landing-page", "https://maximisedai.com/products/website-packages/landing-page/"],
      ["product-maximisedai-small-business-website", "plan-maximisedai-small-business-website", "https://maximisedai.com/products/website-packages/small-business/"],
      ["product-maximisedai-tradie-website", "plan-maximisedai-tradie-website", "https://maximisedai.com/products/website-packages/tradie/"],
    ] as const) {
      expect(migration).toContain(product);
      expect(migration).toContain(plan);
      expect(migration).toContain(route);
    }
  });

  it("does not configure the unavailable Website Refresh identity for outreach", () => {
    expect(migration).toContain("Website Replacement");
    expect(migration).toContain("status', 'blocked'");
    expect(migration).toContain("plan-maximisedai-website-refresh");
  });

  it("keeps GBP out of the website migration", () => {
    expect(migration.toLowerCase()).not.toContain("gbp");
  });
});
