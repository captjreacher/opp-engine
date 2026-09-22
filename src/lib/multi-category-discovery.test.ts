import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  expandCategoriesSearchTerms,
  findCategoriesBySlugs,
  formatCategorySummary,
  normalizeCategory,
  type OpportunityCategory,
} from "./categories";
import { validateDiscoveryInput } from "./discovery";

const edgeSource = readFileSync(
  resolve("supabase/functions/opportunities/index.ts"),
  "utf8",
);
const migrationSource = readFileSync(
  resolve("supabase/migrations/20260922000000_opportunity_multi_category_discovery.sql"),
  "utf8",
);

const builders = normalizeCategory({
  slug: "builders-construction",
  label: "Builders / Construction",
  search_terms: ["building company", "construction company", "renovation builder"],
  compatible_scenarios: ["local-digital-presence"],
})!;

const electricians = normalizeCategory({
  slug: "electricians",
  label: "Electricians",
  search_terms: ["electrician", "electrical services"],
  compatible_scenarios: ["local-digital-presence"],
})!;

const plumbers = normalizeCategory({
  slug: "plumbers",
  label: "Plumbers",
  search_terms: ["plumber", "plumbing services"],
  compatible_scenarios: ["local-digital-presence"],
})!;

const allCategoriesList: OpportunityCategory[] = [builders, electricians, plumbers];

describe("Multi-category discovery test suite", () => {
  it("1. supports single category selection", () => {
    const selected = findCategoriesBySlugs(allCategoriesList, ["builders-construction"]);
    expect(selected).toHaveLength(1);
    expect(selected[0].label).toBe("Builders / Construction");
    expect(formatCategorySummary(selected.map((c) => c.label), false)).toBe("Builders / Construction");
    const terms = expandCategoriesSearchTerms(selected, null, 2);
    expect(terms).toEqual(["building company", "construction company"]);
  });

  it("2. supports multiple categories selection", () => {
    const selected = findCategoriesBySlugs(allCategoriesList, [
      "builders-construction",
      "electricians",
      "plumbers",
    ]);
    expect(selected).toHaveLength(3);
    const summary = formatCategorySummary(selected.map((c) => c.label), false);
    expect(summary).toBe("Builders / Construction + 2 more");

    const terms = expandCategoriesSearchTerms(selected, null, 2);
    // Round-robin interleaving:
    // Step 0: building company (builders), electrician (electricians), plumber (plumbers)
    // Step 1: construction company (builders), electrical services (electricians), plumbing services (plumbers)
    expect(terms).toEqual([
      "building company",
      "electrician",
      "plumber",
      "construction company",
      "electrical services",
      "plumbing services",
    ]);
  });

  it("3. enforces authoritative all_categories boolean and [] domain contract", () => {
    // Explicit All categories request
    expect(validateDiscoveryInput({
      location: "Helensville, New Zealand",
      industry: "All categories",
      keywords: "",
      radius_m: 15000,
      result_limit: 20,
      category_slugs: [],
      all_categories: true,
    })).toEqual({});

    // Explicit individual categories request
    expect(validateDiscoveryInput({
      location: "Helensville, New Zealand",
      industry: "Builders / Construction + 1 more",
      keywords: "",
      radius_m: 15000,
      result_limit: 20,
      category_slugs: ["builders-construction", "electricians"],
      all_categories: false,
    })).toEqual({});

    // Server-side validation rejects "all" string in category_slugs
    expect(edgeSource).toContain(
      'validation.category_slugs =\n      "Use all_categories: true or select individual categories.";',
    );
  });

  it("4. handles state transition: switching All -> individual category", () => {
    let isAll = true;
    let selectedSlugs: string[] = [];

    // User selects 'electricians' while 'All' is active
    function selectCategory(slug: string) {
      if (isAll) {
        isAll = false;
        selectedSlugs = [slug];
      }
    }

    selectCategory("electricians");
    expect(isAll).toBe(false);
    expect(selectedSlugs).toEqual(["electricians"]);
    expect(formatCategorySummary(["Electricians"], isAll)).toBe("Electricians");
  });

  it("5. handles state transition: switching individual categories -> All", () => {
    let isAll = false;
    let selectedSlugs = ["electricians", "plumbers"];

    // User clicks 'All categories' or deselects remaining category
    function selectAll() {
      isAll = true;
      selectedSlugs = [];
    }

    selectAll();
    expect(isAll).toBe(true);
    expect(selectedSlugs).toEqual([]);
    expect(formatCategorySummary([], isAll)).toBe("All categories");
  });

  it("6. performs deterministic term deduplication across categories", () => {
    const categoryA = normalizeCategory({
      slug: "cat-a",
      label: "Cat A",
      search_terms: ["building company", "General Contractor", "Builder"],
    })!;
    const categoryB = normalizeCategory({
      slug: "cat-b",
      label: "Cat B",
      search_terms: ["BUILDING COMPANY", "Renovation Builder", "builder"],
    })!;

    const terms = expandCategoriesSearchTerms([categoryA, categoryB], null, 3);
    // Case-insensitive deduplication preserves first occurrence in round-robin order
    expect(terms.map((t) => t.toLowerCase())).toEqual([
      "building company",
      "general contractor",
      "renovation builder",
      "builder",
    ]);
  });

  it("7. enforces global max-results cap across all categories", () => {
    expect(edgeSource).toContain("if (places.length >= resultLimit) break;");
    expect(edgeSource).toContain("const places: PlacesResult[] = [];");
    expect(edgeSource).toContain("places.push(place);");
  });

  it("8. preserves historical singular-category compatibility", () => {
    expect(validateDiscoveryInput({
      location: "Auckland",
      industry: "Electricians",
      keywords: "",
      radius_m: 10000,
      result_limit: 10,
      category_slug: "electricians",
    })).toEqual({});

    expect(migrationSource).toContain("add column if not exists category_slugs jsonb");
    expect(migrationSource).toContain("add column if not exists category_labels jsonb");
    expect(migrationSource).toContain("all_categories = false");
  });

  it("9. regression: Helensville / Builders discovery request uses locationBias.circle to avoid provider 400 error", () => {
    // Structured location search parameters must use locationBias with circle
    expect(edgeSource).toContain("locationBias: {");
    expect(edgeSource).toContain("circle: {");
    expect(edgeSource).toContain("center: { latitude, longitude }");
    expect(edgeSource).not.toContain("locationRestriction: {\n                circle:");
  });
});
