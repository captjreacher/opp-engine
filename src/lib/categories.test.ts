import { describe, expect, it } from "vitest";
import {
  MAX_DISCOVERY_SEARCH_TERMS,
  activeCategories,
  categoryDefaultRadius,
  categorySupportsScenario,
  expandCategorySearchTerms,
  findCategoryBySlug,
  normalizeCategory,
} from "./categories";

const electriciansRow = {
  id: "cat-1",
  slug: "electricians",
  label: "Electricians",
  description: "Registered electrical service businesses.",
  status: "active",
  search_terms: ["electrician", "electrical services"],
  google_types: ["electrician"],
  default_radius_m: 10000,
  compatible_scenarios: ["local-digital-presence"],
  sort_order: 30,
};

describe("category registry normalization", () => {
  it("normalizes a registry row returned by the API", () => {
    const category = normalizeCategory(electriciansRow);
    expect(category).toMatchObject({
      slug: "electricians",
      label: "Electricians",
      search_terms: ["electrician", "electrical services"],
      google_types: ["electrician"],
      default_radius_m: 10000,
      compatible_scenarios: ["local-digital-presence"],
    });
  });

  it("rejects rows without a usable slug or label", () => {
    expect(normalizeCategory({ slug: "", label: "Electricians" })).toBeNull();
    expect(normalizeCategory({ slug: "electricians" })).toBeNull();
    expect(normalizeCategory(null)).toBeNull();
    expect(normalizeCategory("electricians")).toBeNull();
  });

  it("excludes inactive categories from the operator selection list", () => {
    const categories = activeCategories([
      electriciansRow,
      { ...electriciansRow, slug: "retired-category", status: "inactive" },
      { slug: "hospitality", label: "Hospitality", search_terms: ["cafe"] },
      { slug: "", label: "Broken row" },
    ]);

    expect(categories.map((category) => category.slug)).toEqual([
      "electricians",
      "hospitality",
    ]);
    expect(findCategoryBySlug(categories, "retired-category")).toBeNull();
  });

  it("tolerates non-array payloads", () => {
    expect(activeCategories(undefined)).toEqual([]);
    expect(activeCategories({ categories: [] })).toEqual([]);
  });
});

describe("category defaults and scenario compatibility", () => {
  const category = normalizeCategory(electriciansRow)!;

  it("exposes the registry default radius", () => {
    expect(categoryDefaultRadius(category)).toBe(10000);
    expect(categoryDefaultRadius(null)).toBeNull();
  });

  it("treats an empty compatibility list as unrestricted", () => {
    const open = normalizeCategory({ ...electriciansRow, compatible_scenarios: [] })!;
    expect(categorySupportsScenario(open, "website-improvement")).toBe(true);
    expect(categorySupportsScenario(category, "local-digital-presence")).toBe(true);
    expect(categorySupportsScenario(category, "website-improvement")).toBe(false);
    expect(categorySupportsScenario(null, "website-improvement")).toBe(true);
  });
});

describe("category search-term expansion", () => {
  const category = normalizeCategory(electriciansRow)!;

  it("expands a selected category into its configured provider search terms", () => {
    expect(expandCategorySearchTerms(category, "")).toEqual([
      "electrician",
      "electrical services",
    ]);
  });

  it("keeps free-text keywords as an optional refinement of each base term", () => {
    expect(expandCategorySearchTerms(category, "hot water")).toEqual([
      "electrician hot water",
      "electrical services hot water",
    ]);
  });

  it("falls back to the category label when no search terms are configured", () => {
    const bare = normalizeCategory({ slug: "retail", label: "Retail", search_terms: [] })!;
    expect(expandCategorySearchTerms(bare, null)).toEqual(["Retail"]);
  });

  it("de-duplicates terms and stays within the provider query budget", () => {
    const many = normalizeCategory({
      ...electriciansRow,
      search_terms: ["electrician", "Electrician", "electrical services", "sparkie", "elec"],
    })!;
    const terms = expandCategorySearchTerms(many, null);
    expect(terms).toHaveLength(MAX_DISCOVERY_SEARCH_TERMS);
    expect(terms).toEqual(["electrician", "electrical services", "sparkie"]);
  });

  it("returns no terms without a category", () => {
    expect(expandCategorySearchTerms(null, "hot water")).toEqual([]);
  });
});
