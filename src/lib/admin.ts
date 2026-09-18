// Opportunity Engine — Admin (operator console) helpers.
//
// The console edits configuration that the `opportunities` Edge Function owns:
// the category registry, the scenario registry and the discovery-wide settings
// singleton. Everything here is pure and testable; the wire access lives in
// `api.ts` and the backend remains the enforcement point, so nothing in this
// module may be treated as a security boundary.
//
// Keep the bounds below in step with `supabase/functions/opportunities/index.ts`
// (hard ceilings) and `supabase/migrations/20260914150000_opportunity_discovery_settings.sql`.

/** Hard ceilings mirrored from the Edge Function. Operators may only narrow them. */
export const HARD_LIMITS = {
  maxResultLimit: 20,
  maxSearchTerms: 3,
  maxAutocompleteLimit: 10,
  minRadiusM: 100,
  maxRadiusM: 50000,
  allowedCountryBiases: ["nz", "au"] as const,
  maxRadiusOptions: 8,
  maxSearchTermsPerCategory: 8,
  maxGoogleTypesPerCategory: 8,
} as const;

export interface DiscoverySettings {
  default_radius_m: number | null;
  radius_options_m: number[];
  default_result_limit: number;
  max_result_limit: number;
  location_country_bias: string;
  max_search_terms: number;
  autocomplete_limit: number;
}

/** Mirrors the server fallback so a failed settings read cannot break the console. */
export const DISCOVERY_SETTINGS_FALLBACK: DiscoverySettings = {
  default_radius_m: 10000,
  radius_options_m: [1000, 5000, 10000, 20000, 50000],
  default_result_limit: 10,
  max_result_limit: HARD_LIMITS.maxResultLimit,
  location_country_bias: "nz",
  max_search_terms: HARD_LIMITS.maxSearchTerms,
  autocomplete_limit: 8,
};

export type CategoryStatus = "active" | "inactive";
export type ScenarioStatus = "draft" | "active" | "retired";

export interface AdminCategory {
  id: string;
  slug: string;
  label: string;
  description: string | null;
  status: string;
  search_terms: string[];
  google_types: string[];
  default_radius_m: number | null;
  compatible_scenarios: string[];
  sort_order: number | null;
  updated_at: string | null;
}

export interface AdminScenario {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  status: string;
  version: number;
  discovery_config: Record<string, unknown>;
  updated_at: string | null;
  /** Whether the discovery execution path implements this scenario's contract. */
  executable: boolean;
  active: boolean;
}

export interface AdminCapabilities {
  supported_scenarios: string[];
  default_scenario_slug: string;
  radius_bounds_m: { min: number; max: number };
  max_result_limit: number;
  max_search_terms: number;
  max_autocomplete_limit: number;
  allowed_country_biases: string[];
  default_radius_options_m: number[];
  effective: DiscoverySettings;
}

export interface AdminConfigResponse {
  settings: DiscoverySettings;
  categories: AdminCategory[];
  scenarios: AdminScenario[];
  capabilities: AdminCapabilities;
}

export interface AdminChange {
  field: string;
  previous: unknown;
  next: unknown;
}

export interface AdminMutationResponse<T> {
  changes: AdminChange[];
  audit_logged: boolean;
  category?: T;
  scenario?: T;
  settings?: DiscoverySettings;
}

export interface AdminDiagnosticsRun {
  id: string;
  status: string;
  current_stage: string | null;
  created_at: string;
  scenario_slug: string | null;
  scenario_version: number | null;
  category_slug: string | null;
  category_label: string | null;
  location: string | null;
  discovery_terms: string[] | null;
  result_limit: number | null;
  radius_m: number | null;
}

export interface AdminDiagnostics {
  generated_at: string;
  provider: { google_places_configured: boolean; smtp_configured: boolean };
  categories: { active: number; inactive: number; total: number };
  scenarios: {
    active: string[];
    draft: string[];
    retired: string[];
    executable: string[];
    default_scenario_slug: string;
  };
  settings: DiscoverySettings;
  capabilities: AdminCapabilities;
  recent_runs: AdminDiagnosticsRun[];
}

// ---- Normalisation ----------------------------------------------------------

function toText(value: unknown, max = 200): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/\s+/g, " ");
  return cleaned ? cleaned.slice(0, max) : null;
}

function toStringArray(value: unknown, max = 160): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().replace(/\s+/g, " ").slice(0, max))
    .filter((item) => item.length > 0);
}

function toInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  return null;
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = toInt(value);
  if (parsed === null) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function radiusList(value: unknown): number[] {
  if (!Array.isArray(value)) return DISCOVERY_SETTINGS_FALLBACK.radius_options_m;
  const options = [
    ...new Set(
      value
        .map((item) => toInt(item))
        .filter((item): item is number => item !== null)
        .filter(
          (item) => item >= HARD_LIMITS.minRadiusM && item <= HARD_LIMITS.maxRadiusM,
        ),
    ),
  ].sort((a, b) => a - b);
  return options.length ? options : DISCOVERY_SETTINGS_FALLBACK.radius_options_m;
}

/**
 * Normalises a settings row (or response) and clamps it to the hard ceilings, so
 * a stale or hand-edited value can never widen what the console offers.
 */
export function normalizeDiscoverySettings(raw: unknown): DiscoverySettings {
  if (!raw || typeof raw !== "object") return { ...DISCOVERY_SETTINGS_FALLBACK };
  const row = raw as Record<string, unknown>;
  const maxResultLimit = clamp(
    row.max_result_limit,
    1,
    HARD_LIMITS.maxResultLimit,
    DISCOVERY_SETTINGS_FALLBACK.max_result_limit,
  );
  const radiusOptions = radiusList(row.radius_options_m);
  // An absent key means "use the default"; an explicit null means "no global
  // default radius". Anything out of bounds or outside the supported options is
  // dropped rather than silently offered.
  const defaultRadius = !("default_radius_m" in row)
    ? DISCOVERY_SETTINGS_FALLBACK.default_radius_m
    : row.default_radius_m == null
      ? null
      : (() => {
          const radius = toInt(row.default_radius_m);
          if (
            radius === null ||
            radius < HARD_LIMITS.minRadiusM ||
            radius > HARD_LIMITS.maxRadiusM
          )
            return null;
          return radiusOptions.includes(radius) ? radius : null;
        })();
  const bias = toText(row.location_country_bias, 8)?.toLowerCase() ?? "";
  return {
    default_radius_m: defaultRadius,
    radius_options_m: radiusOptions,
    default_result_limit: clamp(
      row.default_result_limit,
      1,
      maxResultLimit,
      Math.min(DISCOVERY_SETTINGS_FALLBACK.default_result_limit, maxResultLimit),
    ),
    max_result_limit: maxResultLimit,
    location_country_bias: (HARD_LIMITS.allowedCountryBiases as readonly string[]).includes(bias)
      ? bias
      : DISCOVERY_SETTINGS_FALLBACK.location_country_bias,
    max_search_terms: clamp(
      row.max_search_terms,
      1,
      HARD_LIMITS.maxSearchTerms,
      DISCOVERY_SETTINGS_FALLBACK.max_search_terms,
    ),
    autocomplete_limit: clamp(
      row.autocomplete_limit,
      1,
      HARD_LIMITS.maxAutocompleteLimit,
      DISCOVERY_SETTINGS_FALLBACK.autocomplete_limit,
    ),
  };
}

export function normalizeAdminCategory(raw: unknown): AdminCategory | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const slug = toText(row.slug, 80);
  const label = toText(row.label, 160);
  if (!slug || !label) return null;
  return {
    id: toText(row.id, 80) ?? slug,
    slug,
    label,
    description: toText(row.description, 400),
    status: toText(row.status, 20) ?? "active",
    search_terms: toStringArray(row.search_terms),
    google_types: toStringArray(row.google_types, 60),
    default_radius_m: (() => {
      const radius = toInt(row.default_radius_m);
      return radius !== null &&
        radius >= HARD_LIMITS.minRadiusM &&
        radius <= HARD_LIMITS.maxRadiusM
        ? radius
        : null;
    })(),
    compatible_scenarios: toStringArray(row.compatible_scenarios, 80),
    sort_order: toInt(row.sort_order),
    updated_at: toText(row.updated_at, 60),
  };
}

export function normalizeAdminScenario(raw: unknown): AdminScenario | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const slug = toText(row.slug, 120);
  const name = toText(row.name, 160);
  if (!slug || !name) return null;
  const status = toText(row.status, 20) ?? "draft";
  const config =
    row.discovery_config && typeof row.discovery_config === "object"
      ? (row.discovery_config as Record<string, unknown>)
      : {};
  return {
    id: toText(row.id, 80) ?? slug,
    slug,
    name,
    description: toText(row.description, 600),
    status,
    version: clamp(row.version, 1, 100000, 1),
    discovery_config: config,
    updated_at: toText(row.updated_at, 60),
    executable: row.executable === true,
    active: status === "active",
  };
}

// ---- Discovery-facing projections ------------------------------------------

/**
 * Only active categories may be offered in the Discovery form. An inactive row is
 * still returned to the Admin console (so it can be reactivated) but must never
 * leak back into intake.
 */
export function discoverySelectableCategories(
  categories: AdminCategory[],
): AdminCategory[] {
  return categories
    .filter((category) => category.status === "active")
    .sort((a, b) => (a.sort_order ?? 100) - (b.sort_order ?? 100));
}

/** Scenario slugs an operator may pick when configuring a category. */
export function categoryScenarioOptions(scenarios: AdminScenario[]): string[] {
  return [...new Set(scenarios.map((scenario) => scenario.slug))].sort();
}

// ---- Radius (metres internally, kilometres for the operator) ----------------

export function metresToKilometres(metres: number | null): number | null {
  if (metres === null || !Number.isFinite(metres)) return null;
  return Math.round((metres / 1000) * 100) / 100;
}

export function kilometresToMetres(kilometres: number | null): number | null {
  if (kilometres === null || !Number.isFinite(kilometres)) return null;
  return Math.round(kilometres * 1000);
}

export function formatRadius(meters: number | null): string {
  const km = metresToKilometres(meters);
  return km === null ? "No radius" : `${km} km`;
}

// ---- Validation ------------------------------------------------------------

export interface SettingsValidation {
  errors: Partial<Record<keyof DiscoverySettings, string>>;
  /** Non-blocking advisories for changes that materially alter discovery volume. */
  warnings: string[];
}

/** Client-side mirror of the server rules; the server remains authoritative. */
export function validateDiscoverySettings(
  values: DiscoverySettings,
): SettingsValidation {
  const errors: SettingsValidation["errors"] = {};
  const warnings: string[] = [];

  if (values.radius_options_m.length === 0)
    errors.radius_options_m = "Provide at least one radius option.";
  if (values.radius_options_m.length > HARD_LIMITS.maxRadiusOptions)
    errors.radius_options_m = `Use at most ${HARD_LIMITS.maxRadiusOptions} radius options.`;
  for (const option of values.radius_options_m) {
    if (option < HARD_LIMITS.minRadiusM || option > HARD_LIMITS.maxRadiusM) {
      errors.radius_options_m = "Every radius option must be between 0.1 and 50 km.";
      break;
    }
  }
  if (
    values.default_radius_m !== null &&
    !values.radius_options_m.includes(values.default_radius_m)
  )
    errors.default_radius_m = "Default radius must be one of the supported options.";
  if (
    values.default_radius_m !== null &&
    (values.default_radius_m < HARD_LIMITS.minRadiusM ||
      values.default_radius_m > HARD_LIMITS.maxRadiusM)
  )
    errors.default_radius_m = "Default radius must be between 0.1 and 50 km.";

  if (values.max_result_limit < 1 || values.max_result_limit > HARD_LIMITS.maxResultLimit)
    errors.max_result_limit = `Maximum allowed results must be between 1 and ${HARD_LIMITS.maxResultLimit}.`;
  if (values.default_result_limit < 1)
    errors.default_result_limit = "Default results must be at least 1.";
  if (values.default_result_limit > values.max_result_limit)
    errors.default_result_limit = "Default results cannot exceed the maximum allowed results.";

  if (
    !(HARD_LIMITS.allowedCountryBiases as readonly string[]).includes(
      values.location_country_bias,
    )
  )
    errors.location_country_bias = `Country bias must be ${HARD_LIMITS.allowedCountryBiases.join(" or ")}.`;

  if (
    values.max_search_terms < 1 ||
    values.max_search_terms > HARD_LIMITS.maxSearchTerms
  )
    errors.max_search_terms = `Search-term expansion must be between 1 and ${HARD_LIMITS.maxSearchTerms}.`;

  if (
    values.autocomplete_limit < 1 ||
    values.autocomplete_limit > HARD_LIMITS.maxAutocompleteLimit
  )
    errors.autocomplete_limit = `Autocomplete limit must be between 1 and ${HARD_LIMITS.maxAutocompleteLimit}.`;

  if (values.max_result_limit > 10)
    warnings.push(
      "Raising the maximum results increases provider requests per run and discovery cost.",
    );
  if (values.default_result_limit >= values.max_result_limit)
    warnings.push(
      "Default results equal the maximum allowed results, so every run fetches the largest page.",
    );
  if (values.max_search_terms > 1)
    warnings.push(
      `Each run issues up to ${values.max_search_terms} provider queries per category.`,
    );
  if (values.default_radius_m !== null && values.default_radius_m <= 2000)
    warnings.push(
      "A small default radius can sharply reduce the businesses a run discovers.",
    );

  return { errors, warnings };
}

// ---- Scenario safety -------------------------------------------------------

/** A scenario may be activated only when the execution path supports it. */
export function scenarioActivationBlocked(
  scenario: Pick<AdminScenario, "slug" | "executable">,
): boolean {
  return !scenario.executable;
}

/** Status transitions offered in the console, minus ones the backend refuses. */
export function scenarioStatusOptions(
  scenario: Pick<AdminScenario, "executable" | "slug">,
  defaultScenarioSlug: string,
): Array<{ value: ScenarioStatus; label: string; disabled: boolean }> {
  const isDefault = scenario.slug === defaultScenarioSlug;
  return [
    {
      value: "draft",
      label: "Draft (not selectable)",
      disabled: isDefault,
    },
    {
      value: "active",
      label: "Active (selectable)",
      disabled: scenarioActivationBlocked(scenario),
    },
    {
      value: "retired",
      label: "Retired",
      disabled: isDefault,
    },
  ];
}

export function scenarioReadinessLabel(
  scenario: Pick<AdminScenario, "status" | "executable">,
): string {
  if (scenario.executable && scenario.status === "active") return "Executable · active";
  if (scenario.executable) return "Executable · not active";
  return "Not yet executable";
}

// ---- Structured term editing ----------------------------------------------

/** Splits a comma/newline separated operator input into de-duplicated terms. */
export function splitTerms(input: string): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const raw of input.split(/[\n,]+/)) {
    const term = raw.trim().replace(/\s+/g, " ");
    if (!term) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(term);
  }
  return terms;
}

export function joinTerms(terms: string[]): string {
  return terms.join(", ");
}

// ---- Change presentation ---------------------------------------------------

export function describeChangeValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "(none)";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function describeChange(change: AdminChange): string {
  return `${change.field}: ${describeChangeValue(change.previous)} → ${describeChangeValue(change.next)}`;
}
