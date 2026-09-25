import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve("supabase/functions/opportunities/index.ts"), "utf8");

function between(start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  expect(from).toBeGreaterThanOrEqual(0);
  expect(to).toBeGreaterThan(from);
  return source.slice(from, to);
}

type Category = { slug: string; label: string; search_terms: string[] };
type SearchTerm = { term: string; category_slug: string; category_label: string };
type Expand = (categories: Category[], keywords: string | null, limit: number) => SearchTerm[];

const helper = between("function expandCategoriesSearchTerms(", "/** Registry categories");
const compiled = ts.transpileModule(helper, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const expand = new Function(
  "clampInteger",
  "expandCategorySearchTerms",
  "MAX_DISCOVERY_SEARCH_TERMS",
  `${compiled}\nreturn expandCategoriesSearchTerms;`,
)(
  (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
  (category: Category, keywords: string | null) =>
    (category.search_terms.length ? category.search_terms : [category.label]).map((term) =>
      keywords ? `${term} ${keywords}` : term,
    ),
  3,
) as Expand;

describe("multi-category Discovery backend", () => {
  it("interleaves configured terms with a global cap and case-insensitive deduplication", () => {
    const categories = [
      { slug: "electricians", label: "Electricians", search_terms: ["Electrician", "Wiring", "Lighting"] },
      { slug: "plumbers", label: "Plumbers", search_terms: ["Plumber", "electrician", "Drainage"] },
    ];
    expect(expand(categories, null, 3).map(({ term }) => term)).toEqual(["Electrician", "Plumber", "Wiring"]);
    expect(expand(categories, "Auckland", 2).map(({ term }) => term)).toEqual([
      "Electrician Auckland",
      "Plumber Auckland",
    ]);
    expect(expand(categories, null, 10).map(({ term }) => term)).toEqual([
      "Electrician", "Plumber", "Wiring",
    ]);
    expect(expand(categories.slice(0, 1), null, 3).map(({ term }) => term)).toEqual([
      "Electrician", "Wiring", "Lighting",
    ]);
    expect(expand([
      { slug: "first", label: "First", search_terms: ["Shared", "First only"] },
      { slug: "second", label: "Second", search_terms: ["shared", "Second only"] },
    ], null, 2)).toEqual([
      { term: "Shared", category_slug: "first", category_label: "First" },
      { term: "Second only", category_slug: "second", category_label: "Second" },
    ]);
  });

  it("resolves All before expansion and writes evidence from executed terms", () => {
    const run = between("async function createDiscoveryRun(", "// GET /opportunity-categories");
    const allResolution = run.indexOf("await listAllActiveCategories()");
    const scenarioFilter = run.indexOf("categorySupportsScenario(cat, scenario.slug)", allResolution);
    const termExpansion = run.indexOf("expandCategoriesSearchTerms(", scenarioFilter);
    expect(allResolution).toBeGreaterThanOrEqual(0);
    expect(scenarioFilter).toBeGreaterThan(allResolution);
    expect(termExpansion).toBeGreaterThan(scenarioFilter);
    expect(run).toContain("category_labels: []");
    expect(source).toContain(".update(discoveryExecutionEvidence(executedTerms))");
    expect(run).toContain("category_slugs: isAllCategories");
    expect(run).toContain("resolvedCategories.length === 1 ? resolvedCategories[0].slug : null");
  });

  it("creates an All search plan from active compatible categories", async () => {
    const runSource = between("async function createDiscoveryRun(", "// GET /opportunity-categories");
    const runJs = ts.transpileModule(runSource, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const inserted: Record<string, unknown>[] = [];
    const executed: Record<string, unknown>[] = [];
    const createRun = new Function(
      "deps",
      `const { cleanText, numberInRange, loadDiscoverySettings, resolveDiscoveryScenario, listAllActiveCategories, findActiveCategories, findActiveCategory, categorySupportsScenario, json, supabase, GOOGLE_PLACES_API_KEY, expandCategoriesSearchTerms, executeDiscoveryRun, formatCategorySummary, MIN_RADIUS_M, MAX_RADIUS_M } = deps;\n${runJs}\nreturn createDiscoveryRun;`,
    )({
      cleanText: (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null,
      numberInRange: (value: unknown, min: number, max: number) =>
        typeof value === "number" && value >= min && value <= max ? value : null,
      loadDiscoverySettings: async () => ({
        default_result_limit: 10,
        max_result_limit: 20,
        max_search_terms: 3,
        default_radius_m: 1000,
        location_country_bias: "nz",
      }),
      resolveDiscoveryScenario: async () => ({
        ok: true,
        scenario: { id: "scenario-1", slug: "local-digital-presence", name: "Local Digital Presence", discovery_config: {} },
      }),
      listAllActiveCategories: async () => [
        { id: "a", slug: "electricians", label: "Electricians", search_terms: ["Electrician", "Wiring"], compatible_scenarios: [], default_radius_m: null },
        { id: "b", slug: "plumbers", label: "Plumbers", search_terms: ["Plumber", "Drainage"], compatible_scenarios: [], default_radius_m: null },
        { id: "c", slug: "other", label: "Other", search_terms: ["Other"], compatible_scenarios: ["different-scenario"], default_radius_m: null },
      ],
      findActiveCategories: async () => [],
      findActiveCategory: async () => null,
      categorySupportsScenario: (category: { compatible_scenarios: string[] }, slug: string) =>
        !category.compatible_scenarios.length || category.compatible_scenarios.includes(slug),
      json: (body: unknown, status: number) => ({ body, status }),
      supabase: {
        from: () => ({
          insert: (row: Record<string, unknown>) => {
            inserted.push(row);
            return { select: () => ({ single: async () => ({ data: { id: "run-1" }, error: null }) }) };
          },
        }),
      },
      GOOGLE_PLACES_API_KEY: "test-key",
      expandCategoriesSearchTerms: expand,
      formatCategorySummary: (_labels: string[], isAll: boolean) => isAll ? "All categories" : "Selected categories",
      executeDiscoveryRun: async (_runId: string, input: Record<string, unknown>) => {
        executed.push(input);
      },
      MIN_RADIUS_M: 100,
      MAX_RADIUS_M: 50000,
    }) as (payload: Record<string, unknown>) => Promise<{ status: number }>;

    const response = await createRun({
      location: "Auckland",
      all_categories: true,
      category_slugs: [],
      location_latitude: -36.85,
      location_longitude: 174.76,
    });
    expect(response.status).toBe(202);
    expect(inserted[0]).toMatchObject({
      all_categories: true,
      category_slugs: [],
      category_labels: [],
      discovery_terms: [],
    });
    expect(executed[0].searchPlan).toEqual([
      { term: "Electrician", category_slug: "electricians", category_label: "Electricians" },
      { term: "Plumber", category_slug: "plumbers", category_label: "Plumbers" },
      { term: "Wiring", category_slug: "electricians", category_label: "Electricians" },
    ]);
    expect(executed[0]).toMatchObject({
      resultLimit: 10,
      latitude: -36.85,
      longitude: 174.76,
    });
  });

  it("sends a circular location bias with the existing centre and radius", () => {
    const request = between("const page = await searchPlacesText({", "for (const place of page)");
    expect(request).toMatch(/locationBias:\s*\{\s*circle:\s*\{/);
    expect(request).toContain("center: { latitude, longitude }");
    expect(request).toContain("radius: radiusM");
    expect(source).not.toContain("locationRestriction");
    expect(request).toContain("maxResultCount: resultLimit");
    expect(source).toContain('supabase.rpc("queue_local_business_enrichment"');
  });
});
