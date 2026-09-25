import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve("supabase/functions/opportunities/index.ts"), "utf8");

function sourceBetween(start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  expect(from).toBeGreaterThanOrEqual(0);
  expect(to).toBeGreaterThan(from);
  return source.slice(from, to);
}

function compile(section: string): string {
  return ts.transpileModule(section, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

const cleanText = (value: unknown, max = 160): string | null =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
const clampInteger = (value: number, min: number, max: number, fallback: number): number =>
  Number.isInteger(value) ? Math.min(max, Math.max(min, value)) : fallback;

type Category = {
  id: string;
  slug: string;
  label: string;
  search_terms: string[];
  compatible_scenarios: string[];
  default_radius_m: number | null;
  status: "active" | "inactive";
};

const helperSource = compile(sourceBetween("function expandCategorySearchTerms(", "/** Registry categories"));
const helpers = new Function(
  "deps",
  `const { cleanText, clampInteger, stringList, MAX_DISCOVERY_SEARCH_TERMS } = deps;\n${helperSource}\nreturn { expandCategoriesSearchTerms, discoveryExecutionEvidence };`,
)({
  cleanText,
  clampInteger,
  stringList: (value: unknown, max: number) =>
    Array.isArray(value) ? value.map((item) => cleanText(item, max)).filter(Boolean) : [],
  MAX_DISCOVERY_SEARCH_TERMS: 3,
}) as {
  expandCategoriesSearchTerms: (categories: Category[], keywords: string | null, limit: number) => unknown[];
  discoveryExecutionEvidence: (terms: unknown[]) => Record<string, unknown>;
};

const executeSource = compile(sourceBetween("async function executeDiscoveryRun(", "async function createDiscoveryRun("));
const createSource = compile(sourceBetween("async function createDiscoveryRun(", "// GET /opportunity-categories"));

function category(number: number, searchTerms = [`term-${number}`]): Category {
  return {
    id: `id-${number}`,
    slug: `category-${number}`,
    label: `Category ${number}`,
    search_terms: searchTerms,
    compatible_scenarios: [],
    default_radius_m: null,
    status: "active",
  };
}

function harness(
  categories: Category[],
  options: { maxSearchTerms?: number; pages?: Array<Array<{ id: string }>> } = {},
) {
  const row: Record<string, unknown> = {};
  const queries: string[] = [];
  const updates: Record<string, unknown>[] = [];
  let inserted: Record<string, unknown> = {};
  const supabase = {
    from: (table: string) => {
      if (table !== "opportunity_discovery_runs") throw new Error(`Unexpected table: ${table}`);
      return {
        insert: (record: Record<string, unknown>) => {
          inserted = { ...record };
          Object.assign(row, record);
          return { select: () => ({ single: async () => ({ data: { id: "run-1" }, error: null }) }) };
        },
        update: (patch: Record<string, unknown>) => ({
          eq: async () => {
            updates.push(patch);
            Object.assign(row, patch);
            return { error: null };
          },
        }),
      };
    },
  };
  const execute = new Function(
    "deps",
    `const { cleanText, supabase, emitWorkflowEvent, searchPlacesText, findDuplicateLead, normalizeBusinessIdentity, discoveryExecutionEvidence, DEFAULT_LOCATION_COUNTRY_BIAS } = deps;\n${executeSource}\nreturn executeDiscoveryRun;`,
  )({
    cleanText,
    supabase,
    emitWorkflowEvent: async () => undefined,
    searchPlacesText: async (body: { textQuery: string }) => {
      queries.push(body.textQuery);
      return options.pages?.[queries.length - 1] ?? [];
    },
    findDuplicateLead: async () => null,
    normalizeBusinessIdentity: () => "identity",
    discoveryExecutionEvidence: helpers.discoveryExecutionEvidence,
    DEFAULT_LOCATION_COUNTRY_BIAS: "nz",
  });
  const createRun = new Function(
    "deps",
    `const { cleanText, numberInRange, loadDiscoverySettings, resolveDiscoveryScenario, listAllActiveCategories, findActiveCategories, findActiveCategory, categorySupportsScenario, json, supabase, GOOGLE_PLACES_API_KEY, expandCategoriesSearchTerms, executeDiscoveryRun, formatCategorySummary, MIN_RADIUS_M, MAX_RADIUS_M } = deps;\n${createSource}\nreturn createDiscoveryRun;`,
  )({
    cleanText,
    numberInRange: (value: unknown, min: number, max: number) => {
      const number = Number(value);
      return value == null || !Number.isFinite(number) || number < min || number > max ? null : number;
    },
    loadDiscoverySettings: async () => ({
      default_result_limit: 10,
      max_result_limit: 20,
      max_search_terms: options.maxSearchTerms ?? 3,
      default_radius_m: 1000,
      location_country_bias: "nz",
    }),
    resolveDiscoveryScenario: async () => ({
      ok: true,
      scenario: { id: "scenario-1", slug: "local-digital-presence", name: "Local Digital Presence", discovery_config: {} },
    }),
    listAllActiveCategories: async () => categories.filter((item) => item.status === "active"),
    findActiveCategories: async (slugs: string[]) => slugs
      .map((slug) => categories.find((item) => item.slug === slug && item.status === "active"))
      .filter(Boolean),
    findActiveCategory: async (slug: string) =>
      categories.find((item) => item.slug === slug && item.status === "active") ?? null,
    categorySupportsScenario: (item: Category, slug: string) =>
      !item.compatible_scenarios.length || item.compatible_scenarios.includes(slug),
    json: (body: unknown, status: number) => ({ body, status }),
    supabase,
    GOOGLE_PLACES_API_KEY: "test-key",
    expandCategoriesSearchTerms: helpers.expandCategoriesSearchTerms,
    executeDiscoveryRun: execute,
    formatCategorySummary: (labels: string[], isAll: boolean) => isAll ? "All categories" : labels.join(", "),
    MIN_RADIUS_M: 100,
    MAX_RADIUS_M: 50000,
  }) as (payload: Record<string, unknown>) => Promise<{ status: number }>;

  return {
    row,
    queries,
    updates,
    get inserted() { return inserted; },
    createRun: (payload: Record<string, unknown>) => createRun({ location: "Auckland", ...payload }),
  };
}

describe("Discovery execution evidence", () => {
  it("records only three of five requested All categories under the global term cap", async () => {
    const run = harness([1, 2, 3, 4, 5].map((number) => category(number)));
    expect((await run.createRun({ all_categories: true, category_slugs: [] })).status).toBe(202);
    expect(run.inserted).toMatchObject({ all_categories: true, category_slugs: [], category_labels: [], discovery_terms: [] });
    expect(run.row).toMatchObject({
      status: "completed",
      all_categories: true,
      category_slugs: [],
      category_labels: ["Category 1", "Category 2", "Category 3"],
      discovery_terms: ["term-1", "term-2", "term-3"],
    });
    expect(run.queries).toEqual(["term-1 Auckland", "term-2 Auckland", "term-3 Auckland"]);
  });

  it("evidences every compatible category when All fits within the term budget", async () => {
    const incompatible = category(3);
    incompatible.compatible_scenarios = ["another-scenario"];
    const inactive = category(4);
    inactive.status = "inactive";
    const run = harness([category(1), category(2), incompatible, inactive]);
    await run.createRun({ all_categories: true, category_slugs: [] });
    expect(run.row.category_labels).toEqual(["Category 1", "Category 2"]);
    expect(run.row.discovery_terms).toEqual(["term-1", "term-2"]);
    expect(run.queries).toHaveLength(2);
  });

  it("keeps requested slugs but omits unqueried labels for explicit multi-select", async () => {
    const run = harness([1, 2, 3, 4, 5].map((number) => category(number)));
    await run.createRun({
      all_categories: false,
      category_slugs: ["category-1", "category-2", "category-3", "category-4", "category-5"],
    });
    expect(run.row.all_categories).toBe(false);
    expect(run.row.category_slugs).toEqual(["category-1", "category-2", "category-3", "category-4", "category-5"]);
    expect(run.row.category_labels).toEqual(["Category 1", "Category 2", "Category 3"]);
    expect(run.row.discovery_terms).toEqual(["term-1", "term-2", "term-3"]);
  });

  it("deduplicates shared terms by case and gives evidence to the deterministic owner", async () => {
    const run = harness([
      category(1, ["Shared", "First only"]),
      category(2, ["shared", "Second only"]),
      category(3, ["Third only"]),
    ]);
    await run.createRun({ all_categories: true, category_slugs: [] });
    expect(run.row.discovery_terms).toEqual(["Shared", "Second only", "Third only"]);
    expect(run.row.category_labels).toEqual(["Category 1", "Category 2", "Category 3"]);
    expect(run.queries).toEqual(["Shared Auckland", "Second only Auckland", "Third only Auckland"]);

    const duplicateOnly = harness([
      category(1, ["Shared", "First only"]),
      category(2, ["shared"]),
      category(3, ["Third only"]),
    ]);
    await duplicateOnly.createRun({ all_categories: true, category_slugs: [] });
    expect(duplicateOnly.row.discovery_terms).toEqual(["Shared", "Third only", "First only"]);
    expect(duplicateOnly.row.category_labels).toEqual(["Category 1", "Category 3"]);
  });

  it("preserves the legacy single-category slug path", async () => {
    const run = harness([category(1, ["First", "Second"])]);
    await run.createRun({ category_slug: "category-1", keywords: "nearby" });
    expect(run.row).toMatchObject({
      all_categories: false,
      category_slug: "category-1",
      category_slugs: ["category-1"],
      category_labels: ["Category 1"],
      discovery_terms: ["First nearby", "Second nearby"],
    });
  });

  it("drops planned terms that the global result limit prevents from being queried", async () => {
    const run = harness([category(1), category(2), category(3)], {
      pages: [[{ id: "place-1" }]],
    });
    await run.createRun({ all_categories: true, category_slugs: [], result_limit: 1 });
    expect(run.row.status).toBe("completed");
    expect(run.row.discovery_terms).toEqual(["term-1"]);
    expect(run.row.category_labels).toEqual(["Category 1"]);
    expect(run.queries).toEqual(["term-1 Auckland"]);
    expect(run.updates.some((update) => "category_labels" in update)).toBe(true);
  });
});
