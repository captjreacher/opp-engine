import { describe, expect, it } from "vitest";
import {
  DISCOVERY_SETTINGS_FALLBACK,
  HARD_LIMITS,
  categoryScenarioOptions,
  describeChange,
  discoverySelectableCategories,
  formatRadius,
  kilometresToMetres,
  metresToKilometres,
  normalizeAdminCategory,
  normalizeAdminScenario,
  normalizeDiscoverySettings,
  scenarioActivationBlocked,
  scenarioReadinessLabel,
  scenarioStatusOptions,
  splitTerms,
  validateDiscoverySettings,
  type AdminCategory,
  type AdminScenario,
  type DiscoverySettings,
} from "./admin";

const category = (overrides: Partial<AdminCategory> = {}): AdminCategory => ({
  id: "cat-1",
  slug: "electricians",
  label: "Electricians",
  description: null,
  status: "active",
  search_terms: [],
  google_types: [],
  default_radius_m: null,
  compatible_scenarios: [],
  sort_order: 10,
  updated_at: null,
  ...overrides,
});

const scenario = (overrides: Partial<AdminScenario> = {}): AdminScenario => ({
  id: "scn-1",
  slug: "local-digital-presence",
  name: "Local Digital Presence",
  description: null,
  status: "active",
  version: 1,
  discovery_config: {},
  updated_at: null,
  executable: true,
  active: true,
  ...overrides,
});

describe("discovery settings normalisation", () => {
  it("clamps every value to the hard ceilings", () => {
    const settings = normalizeDiscoverySettings({
      default_radius_m: 999_999,
      radius_options_m: [5000, 100000, 0, 10000],
      default_result_limit: 500,
      max_result_limit: 500,
      location_country_bias: "us",
      max_search_terms: 99,
      autocomplete_limit: 99,
    });

    expect(settings.default_radius_m).toBeNull();
    expect(settings.radius_options_m).toEqual([5000, 10000]);
    expect(settings.max_result_limit).toBe(HARD_LIMITS.maxResultLimit);
    expect(settings.default_result_limit).toBe(HARD_LIMITS.maxResultLimit);
    expect(settings.location_country_bias).toBe("nz");
    expect(settings.max_search_terms).toBe(HARD_LIMITS.maxSearchTerms);
    expect(settings.autocomplete_limit).toBe(HARD_LIMITS.maxAutocompleteLimit);
  });

  it("keeps a valid default radius only when it is a supported option", () => {
    const aligned = normalizeDiscoverySettings({
      default_radius_m: 10000,
      radius_options_m: [1000, 10000, 50000],
    });
    expect(aligned.default_radius_m).toBe(10000);

    const orphaned = normalizeDiscoverySettings({
      default_radius_m: 3000,
      radius_options_m: [1000, 10000, 50000],
    });
    expect(orphaned.default_radius_m).toBeNull();
  });

  it("falls back to the documented defaults for junk input", () => {
    expect(normalizeDiscoverySettings(null)).toEqual(DISCOVERY_SETTINGS_FALLBACK);
    expect(normalizeDiscoverySettings("nope")).toEqual(DISCOVERY_SETTINGS_FALLBACK);
    expect(normalizeDiscoverySettings({ max_result_limit: "abc" })).toEqual(
      DISCOVERY_SETTINGS_FALLBACK,
    );
  });

  it("allows an operator to narrow the ceilings", () => {
    const narrowed = normalizeDiscoverySettings({
      default_result_limit: 3,
      max_result_limit: 5,
      max_search_terms: 1,
      autocomplete_limit: 2,
      default_radius_m: 1000,
      radius_options_m: [1000, 2000],
      location_country_bias: "au",
    });
    expect(narrowed).toMatchObject({
      default_result_limit: 3,
      max_result_limit: 5,
      max_search_terms: 1,
      autocomplete_limit: 2,
      default_radius_m: 1000,
      location_country_bias: "au",
    });
  });
});

describe("radius conversion", () => {
  it("keeps metres as the internal unit and kilometres as the operator unit", () => {
    expect(metresToKilometres(10000)).toBe(10);
    expect(kilometresToMetres(7.5)).toBe(7500);
    expect(kilometresToMetres(null)).toBeNull();
    expect(formatRadius(null)).toBe("No radius");
    expect(formatRadius(15000)).toBe("15 km");
  });
});

describe("category console projections", () => {
  it("never offers an inactive category to Discovery", () => {
    const selectable = discoverySelectableCategories([
      category({ slug: "active-one", status: "active", sort_order: 20 }),
      category({ slug: "retired-one", status: "inactive", sort_order: 1 }),
      category({ slug: "active-two", status: "active", sort_order: 10 }),
    ]);

    expect(selectable.map((row) => row.slug)).toEqual(["active-two", "active-one"]);
    expect(selectable.every((row) => row.status === "active")).toBe(true);
  });

  it("normalises registry rows and drops unusable ones", () => {
    expect(normalizeAdminCategory(null)).toBeNull();
    expect(normalizeAdminCategory({ label: "no slug" })).toBeNull();

    const normalised = normalizeAdminCategory({
      id: "cat-9",
      slug: " plumbers ",
      label: " Plumbers ",
      status: "inactive",
      search_terms: ["plumber", "", 5],
      google_types: ["plumber"],
      default_radius_m: 999999,
      compatible_scenarios: ["local-digital-presence"],
      sort_order: "40",
    });

    expect(normalised).toMatchObject({
      slug: "plumbers",
      label: "Plumbers",
      status: "inactive",
      search_terms: ["plumber"],
      google_types: ["plumber"],
      default_radius_m: null,
      sort_order: 40,
    });
  });

  it("lists the scenarios a category may be scoped to", () => {
    expect(
      categoryScenarioOptions([
        scenario({ slug: "reputation-trust" }),
        scenario({ slug: "local-digital-presence" }),
        scenario({ slug: "local-digital-presence", version: 2 }),
      ]),
    ).toEqual(["local-digital-presence", "reputation-trust"]);
  });
});

describe("scenario execution safety", () => {
  it("blocks activation for a scenario the backend cannot execute", () => {
    const draft = scenario({ slug: "website-improvement", status: "draft", executable: false, active: false });
    const options = scenarioStatusOptions(draft, "local-digital-presence");

    expect(scenarioActivationBlocked(draft)).toBe(true);
    expect(options.find((option) => option.value === "active")?.disabled).toBe(true);
    expect(options.find((option) => option.value === "draft")?.disabled).toBe(false);
  });

  it("allows activation once a scenario is executable", () => {
    const executable = scenario({ slug: "local-digital-presence", executable: true });
    expect(scenarioActivationBlocked(executable)).toBe(false);
    expect(
      scenarioStatusOptions(executable, "local-digital-presence").find(
        (option) => option.value === "active",
      )?.disabled,
    ).toBe(false);
  });

  it("never lets the default scenario be moved off active", () => {
    const defaults = scenarioStatusOptions(
      scenario({ slug: "local-digital-presence", executable: true }),
      "local-digital-presence",
    );
    expect(defaults.find((option) => option.value === "draft")?.disabled).toBe(true);
    expect(defaults.find((option) => option.value === "retired")?.disabled).toBe(true);
  });

  it("labels readiness distinctly from status", () => {
    expect(scenarioReadinessLabel({ status: "active", executable: true })).toBe("Executable · active");
    expect(scenarioReadinessLabel({ status: "draft", executable: true })).toBe("Executable · not active");
    expect(scenarioReadinessLabel({ status: "active", executable: false })).toBe("Not yet executable");
  });

  it("normalises scenario rows including the executable flag", () => {
    expect(normalizeAdminScenario({ slug: "x", name: "X", executable: true, status: "active" })).toMatchObject({
      executable: true,
      active: true,
    });
    expect(normalizeAdminScenario({ slug: "x", name: "X" })?.executable).toBe(false);
  });
});

describe("settings validation", () => {
  const base = (overrides: Partial<DiscoverySettings> = {}): DiscoverySettings => ({
    ...DISCOVERY_SETTINGS_FALLBACK,
    ...overrides,
  });

  it("accepts the seeded defaults without errors", () => {
    const { errors } = validateDiscoverySettings(base());
    expect(errors).toEqual({});
  });

  it("rejects a default outside the supported radius options", () => {
    const { errors } = validateDiscoverySettings(
      base({ default_radius_m: 3000, radius_options_m: [1000, 10000] }),
    );
    expect(errors.default_radius_m).toMatch(/supported options/);
  });

  it("rejects a default above the maximum allowed results", () => {
    const { errors } = validateDiscoverySettings(
      base({ default_result_limit: 15, max_result_limit: 5 }),
    );
    expect(errors.default_result_limit).toMatch(/cannot exceed/);
  });

  it("rejects values above the hard ceilings", () => {
    const { errors } = validateDiscoverySettings(
      base({ max_result_limit: 50, max_search_terms: 9, autocomplete_limit: 25 }),
    );
    expect(errors.max_result_limit).toBeTruthy();
    expect(errors.max_search_terms).toBeTruthy();
    expect(errors.autocomplete_limit).toBeTruthy();
  });

  it("warns about changes that materially raise discovery volume", () => {
    const { warnings } = validateDiscoverySettings(
      base({ max_result_limit: 20, default_result_limit: 20, max_search_terms: 3, default_radius_m: 1000 }),
    );
    expect(warnings.join(" ")).toMatch(/provider requests/);
    expect(warnings.join(" ")).toMatch(/provider queries/);
    expect(warnings.join(" ")).toMatch(/small default radius/);
  });
});

describe("structured term editing and change presentation", () => {
  it("parses operator input, de-duplicating case-insensitively", () => {
    expect(splitTerms("plumber, Plumbing services\nplumber")).toEqual([
      "plumber",
      "Plumbing services",
    ]);
    expect(splitTerms("   ")).toEqual([]);
  });

  it("describes a change with previous and next values", () => {
    expect(describeChange({ field: "status", previous: "draft", next: "inactive" })).toBe(
      "status: draft → inactive",
    );
    expect(describeChange({ field: "search_terms", previous: [], next: ["plumber"] })).toBe(
      "search_terms: (none) → plumber",
    );
    expect(describeChange({ field: "default_radius_m", previous: 10000, next: null })).toBe(
      "default_radius_m: 10000 → —",
    );
  });
});
