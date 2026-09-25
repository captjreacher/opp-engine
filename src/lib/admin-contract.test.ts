import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const edgeSource = readFileSync(
  resolve("supabase/functions/opportunities/index.ts"),
  "utf8",
);
const settingsMigration = readFileSync(
  resolve(
    "supabase/migrations/20260914150000_opportunity_discovery_settings.sql",
  ),
  "utf8",
);
const categoriesMigration = readFileSync(
  resolve(
    "supabase/migrations/20260914120000_opportunity_discovery_intake_categories.sql",
  ),
  "utf8",
);
const apiSource = readFileSync(resolve("src/lib/api.ts"), "utf8");
const adminUiSource = readFileSync(resolve("src/routes/Admin.tsx"), "utf8");

function between(source: string, start: string, end: string): string {
  const startIdx = source.indexOf(start);
  const endIdx = source.indexOf(end, startIdx);
  return startIdx === -1 || endIdx === -1 ? "" : source.slice(startIdx, endIdx);
}

/** The Admin handlers only — not the read-only discovery settings endpoint. */
function adminBlock(): string {
  return between(
    edgeSource,
    "// ---- Admin: operator-adjustable discovery configuration",
    "async function getDiscoveryRun(",
  );
}

function createDiscoveryRunBlock(): string {
  return between(
    edgeSource,
    "async function createDiscoveryRun(",
    "// GET /opportunity-categories",
  );
}

function normalizeSettingsBlock(): string {
  return between(
    edgeSource,
    "function normalizeDiscoverySettingsRow(",
    "/** Reads the settings singleton",
  );
}

function autocompleteBlock(): string {
  return between(
    edgeSource,
    "async function autocompleteLocations(",
    "const suggestions: Array<",
  );
}

/** SQL statements only: migration doc comments legitimately name what they must not touch. */
function withoutSqlComments(source: string): string {
  return source
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

function sourceFilesUnder(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...sourceFilesUnder(full));
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) files.push(full);
  }
  return files;
}

describe("admin authority", () => {
  it("authenticates before any admin route is reachable", () => {
    const authIndex = edgeSource.indexOf("if (!authorized(req))");
    expect(authIndex).toBeGreaterThan(-1);
    expect(authIndex).toBeLessThan(edgeSource.indexOf('parts[0] === "admin"'));
    expect(edgeSource).toContain("if (!OPERATOR_TOKEN) return false");
  });

  it("exposes admin mutations only as PATCH and keeps reads GET-only", () => {
    expect(edgeSource).toMatch(
      /req\.method === "GET"[\s\S]{0,120}parts\[1\] === "config"[\s\S]{0,80}adminConfig\(\)/,
    );
    expect(edgeSource).toMatch(
      /req\.method === "GET"[\s\S]{0,120}parts\[1\] === "diagnostics"[\s\S]{0,80}adminDiagnostics\(\)/,
    );
    expect(edgeSource).toMatch(
      /req\.method === "PATCH"[\s\S]{0,140}parts\[1\] === "settings"[\s\S]{0,80}updateAdminDiscoverySettings\(/,
    );
    expect(edgeSource).toMatch(
      /req\.method === "PATCH"[\s\S]{0,140}parts\[1\] === "categories"[\s\S]{0,80}updateAdminCategory\(/,
    );
    expect(edgeSource).toMatch(
      /req\.method === "PATCH"[\s\S]{0,140}parts\[1\] === "scenarios"[\s\S]{0,80}updateAdminScenario\(/,
    );
  });

  it("keeps the configuration tables service-role only", () => {
    expect(settingsMigration).toContain(
      "revoke all on public.opportunity_discovery_settings from anon, authenticated",
    );
    expect(settingsMigration).toContain(
      "grant select, insert, update on public.opportunity_discovery_settings to service_role",
    );
    expect(categoriesMigration).toContain(
      "revoke all on public.opportunity_categories from anon, authenticated",
    );
    // No client-side database access exists to bypass the backend.
    for (const file of sourceFilesUnder(resolve("src"))) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toContain("createClient");
      expect(source, file).not.toContain("supabase-js");
    }
  });

  it("sends every admin call through the operator-authenticated API client", () => {
    for (const call of [
      "fetchAdminConfig",
      "fetchAdminDiagnostics",
      "updateAdminCategory",
      "updateAdminScenario",
      "updateAdminSettings",
    ]) {
      expect(apiSource, call).toContain(`export function ${call}(`);
    }
    expect(apiSource).toContain("/admin/config");
    expect(apiSource).toContain("/admin/diagnostics");
    expect(apiSource).toContain("/admin/settings");
    expect(apiSource).toContain("/admin/categories/");
    expect(apiSource).toContain("/admin/scenarios/");
  });
});

describe("admin category contract", () => {
  it("reads every category, including inactive ones, for the console", () => {
    const block = adminBlock();
    expect(block).toContain('.from("opportunity_categories")');
    expect(block).toContain("CATEGORY_FIELDS");
    expect(block).not.toMatch(/opportunity_categories[\s\S]{0,200}eq\("status", "active"\)/);
  });

  it("deactivates instead of deleting, and never exposes a delete route", () => {
    expect(edgeSource).not.toMatch(/req\.method === "DELETE"/);
    expect(edgeSource).not.toMatch(/\.delete\(\)/);
    expect(settingsMigration + categoriesMigration).not.toMatch(/drop table/i);
    expect(adminBlock()).toContain('CATEGORY_STATUSES = ["active", "inactive"]');
  });

  it("applies category edits to future runs only", () => {
    // A run resolves the category from the registry at creation time and stores
    // its own snapshot, so editing a category cannot rewrite history.
    const runBlock = createDiscoveryRunBlock();
    expect(runBlock).toContain("findActiveCategories");
    expect(runBlock).toContain("category_slugs:");
    expect(runBlock).toContain("category_label: categoryLabelSummary");
    expect(runBlock).toContain("discovery_terms: []");
    expect(edgeSource).toContain(".update(discoveryExecutionEvidence(executedTerms))");
    // No admin mutation writes back into an existing run.
    expect(adminBlock()).not.toMatch(
      /opportunity_discovery_runs[\s\S]{0,400}?\.update\(/,
    );
    // A category must be active to be selectable at run time.
    expect(edgeSource).toMatch(/findActiveCategory[\s\S]{0,600}status === "active"/);
  });

  it("keeps inactive categories out of the Discovery read path", () => {
    expect(categoriesMigration).toContain("where c.status = 'active'");
    expect(edgeSource).toContain("opportunity_list_active_categories");
  });
});

describe("admin scenario contract", () => {
  it("refuses to activate a scenario the execution path cannot run", () => {
    const block = adminBlock();
    expect(block).toContain("scenario_not_executable");
    expect(block).toContain("!scenarioIsExecutable(previous.slug)");
    expect(block).toContain("nextStatus === \"active\"");
  });

  it("cannot widen the executable allow-list through Admin", () => {
    const allowListStart = edgeSource.indexOf("const SUPPORTED_DISCOVERY_SCENARIO_SLUGS");
    const allowList = edgeSource.slice(allowListStart, allowListStart + 220);
    expect(allowList).toContain("DEFAULT_DISCOVERY_SCENARIO_SLUG");
    expect(allowList).not.toContain("website-improvement");
    expect(allowList).not.toContain("reputation-trust");
    // Admin writes status/name/description/discovery config only.
    const block = adminBlock();
    expect(block).not.toContain("SUPPORTED_DISCOVERY_SCENARIO_SLUGS.add");
    expect(block).not.toContain("SUPPORTED_DISCOVERY_SCENARIO_SLUGS =");
  });

  it("keeps the default scenario active", () => {
    expect(adminBlock()).toContain("default_scenario_required");
    expect(adminBlock()).toContain("last_executable_scenario");
  });

  it("still fails closed for a draft scenario at run time", () => {
    expect(edgeSource).toContain("scenario_not_active");
    expect(edgeSource).toContain("scenario_not_executable");
    expect(createDiscoveryRunBlock()).toContain("resolveDiscoveryScenario(scenarioId)");
  });

  it("only edits discovery defaults the scenario config already represents", () => {
    const block = adminBlock();
    expect(block).toContain('"default_result_limit"');
    expect(block).toContain('"radius_m"');
    expect(block).not.toContain("assessment_config");
    expect(block).not.toContain("outreach_config");
    expect(block).not.toContain("commercial_config");
  });
});

describe("discovery settings are respected", () => {
  it("clamps a stored row to the code ceilings", () => {
    const block = normalizeSettingsBlock();
    expect(block).toContain("MAX_DISCOVERY_RESULTS");
    expect(block).toContain("MAX_DISCOVERY_SEARCH_TERMS");
    expect(block).toContain("MAX_PLACES_AUTOCOMPLETE_LIMIT");
    expect(block).toContain("ALLOWED_LOCATION_COUNTRY_BIASES");
    expect(block).toContain("MIN_RADIUS_M");
    expect(block).toContain("MAX_RADIUS_M");
  });

  it("applies the settings to every new discovery run", () => {
    const block = createDiscoveryRunBlock();
    expect(block).toContain("await loadDiscoverySettings()");
    expect(block).toContain("settings.default_result_limit");
    expect(block).toContain("settings.max_result_limit");
    expect(block).toContain("settings.max_search_terms");
    expect(block).toContain("settings.location_country_bias");
    expect(block).toContain("expandCategoriesSearchTerms(");
  });

  it("applies the autocomplete limit and country bias to location search", () => {
    const block = autocompleteBlock();
    expect(block).toContain("await loadDiscoverySettings()");
    expect(block).toContain("includedRegionCodes: [countryBias]");
    expect(block).toContain("regionCode: countryBias");
    expect(edgeSource).toContain("settings.autocomplete_limit");
    // The provider text search honours the same bias.
    expect(
      between(edgeSource, "async function executeDiscoveryRun(", "const candidates = [];"),
    ).toContain("regionCode: countryBias");
  });

  it("fails safe to the code defaults when the settings row is unavailable", () => {
    expect(edgeSource).toContain("DISCOVERY_SETTINGS_FALLBACK");
    expect(edgeSource).toMatch(
      /async function loadDiscoverySettings[\s\S]{0,700}return DISCOVERY_SETTINGS_FALLBACK/,
    );
  });

  it("Exposes an operator-facing read without secrets", () => {
    expect(edgeSource).toMatch(
      /async function getDiscoverySettings[\s\S]{0,200}json\(\{ settings \}\)/,
    );
  });

  it("feeds the configured defaults into the Discovery form", () => {
    const discoveryUiSource = readFileSync(resolve("src/routes/Discovery.tsx"), "utf8");
    expect(discoveryUiSource).toContain("fetchDiscoverySettings()");
    expect(discoveryUiSource).toContain("normalizeDiscoverySettings(");
    // Radius options come from the setting; the result ceiling is the setting too.
    expect(discoveryUiSource).toContain("settings.radius_options_m");
    expect(discoveryUiSource).toContain("max={settings.max_result_limit}");
    expect(discoveryUiSource).toContain("maxResultLimit: settings.max_result_limit");
    expect(discoveryUiSource).not.toContain("Radius (metres)");
  });
});

describe("configuration changes are auditable", () => {
  it("records each mutation on the shared event store", () => {
    const block = adminBlock();
    for (const eventType of [
      "opportunity.admin.category_updated",
      "opportunity.admin.scenario_updated",
      "opportunity.admin.discovery_settings_updated",
    ]) {
      expect(block, eventType).toContain(eventType);
    }
    expect(block).toContain("await emitWorkflowEvent(");
  });

  it("records previous value, new value and the operator", () => {
    const block = adminBlock();
    expect(block).toContain("function changeSet(");
    expect(block).toContain("changes.push({ field, previous: previous[field] ?? null, next: next[field] ?? null })");
    expect(block).toContain("payload: { operator: args.operator, changes: args.changes }");
    expect(block).toContain("function adminOperator(");
    // Event rows are uuid-keyed, so the text-keyed settings singleton maps to a
    // stable placeholder identity rather than a bare string.
    expect(block).toContain("DISCOVERY_SETTINGS_ENTITY_ID");
    expect(block).toMatch(
      /DISCOVERY_SETTINGS_ENTITY_ID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"/,
    );
  });

  it("does not write an audit event when nothing changed", () => {
    expect(adminBlock()).toContain("if (!args.changes.length) return false;");
    expect(adminBlock()).toMatch(/changes: \[\], audit_logged: false/);
  });
});

describe("admin never exposes secrets", () => {
  it("reports provider readiness as booleans only", () => {
    const block = adminBlock();
    expect(block).toContain(
      "google_places_configured: Boolean(GOOGLE_PLACES_API_KEY)",
    );
    expect(block).toContain(
      "smtp_configured: Boolean(smtpHost && smtpUser && smtpPassword)",
    );
    // Credential identifiers must never be emitted as a response value.
    expect(block).not.toMatch(
      /\b(GOOGLE_PLACES_API_KEY|SERVICE_ROLE_KEY|OPERATOR_TOKEN|MGRNZ_SMTP_PASSWORD|MGRNZ_SMTP_USERNAME|SUPABASE_URL)\s*[,}]/,
    );
    expect(block).not.toMatch(/api_?key\s*:/i);
  });

  it("never returns an env value from the diagnostics endpoint", () => {
    const block = between(
      edgeSource,
      "async function adminDiagnostics(",
      "async function getDiscoveryRun(",
    );
    expect(block).not.toContain("Deno.env.get(\"OPERATOR_TOKEN\")");
    expect(block).not.toContain("SERVICE_ROLE_KEY");
    expect(block).toContain("smtp_configured");
  });

  it("shows the operator console no credentials either", () => {
    expect(adminUiSource).not.toContain("GOOGLE_PLACES_API_KEY");
    expect(adminUiSource).not.toContain("SUPABASE");
    expect(adminUiSource).not.toContain("VITE_OPERATOR_TOKEN");
    expect(adminUiSource).toContain("Credentials are never returned by this endpoint");
  });
});

describe("admin surface stays narrow", () => {
  it("adds one singleton settings table and nothing else", () => {
    expect(settingsMigration).toContain(
      "create table if not exists public.opportunity_discovery_settings",
    );
    expect(settingsMigration).toContain("check (id = 'global')");
    expect((settingsMigration.match(/create table/gi) ?? []).length).toBe(1);
    const sql = withoutSqlComments(settingsMigration);
    expect(sql).not.toMatch(/drop table/i);
    expect(sql).not.toMatch(/alter table public\.opportunity_discovery_runs/i);
    expect(sql).not.toMatch(/eligibility/i);
    expect(sql).not.toMatch(/feature_flag/i);
  });

  it("keeps the operator-tunable values inside the database ceilings", () => {
    expect(settingsMigration).toContain("check (max_result_limit between 1 and 20)");
    expect(settingsMigration).toContain("check (max_search_terms between 1 and 3)");
    expect(settingsMigration).toContain("check (autocomplete_limit between 1 and 10)");
    expect(settingsMigration).toContain("check (location_country_bias in ('nz', 'au'))");
    expect(settingsMigration).toContain(
      "check (default_radius_m is null or default_radius_m between 100 and 50000)",
    );
  });

  it("seeds the singleton so enabling the console changes nothing by itself", () => {
    expect(settingsMigration).toContain("insert into public.opportunity_discovery_settings (id)");
    expect(settingsMigration).toContain("on conflict (id) do nothing");
  });

  it("does not disturb eligibility, outreach or the send handoff", () => {
    const block = adminBlock() + withoutSqlComments(settingsMigration) + adminUiSource;
    expect(block).not.toContain("possible_match");
    expect(block).not.toContain("eligibility_acknowledged");
    expect(block).not.toContain("ingest_outbound_prospect");
    expect(block).not.toContain("RiskRegister");
  });
});
