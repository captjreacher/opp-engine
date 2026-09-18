import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const edgeSource = readFileSync(
  resolve("supabase/functions/opportunities/index.ts"),
  "utf8",
);
const migrationSource = readFileSync(
  resolve(
    "supabase/migrations/20260914120000_opportunity_discovery_intake_categories.sql",
  ),
  "utf8",
);
const apiSource = readFileSync(resolve("src/lib/api.ts"), "utf8");
const discoveryUiSource = readFileSync(resolve("src/routes/Discovery.tsx"), "utf8");

/** Runtime app sources only — this contract test itself names the provider key. */
function sourceFilesUnder(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...sourceFilesUnder(full));
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) files.push(full);
  }
  return files;
}

function createDiscoveryRunBlock(): string {
  const start = edgeSource.indexOf("async function createDiscoveryRun(");
  const end = edgeSource.indexOf("// GET /opportunity-categories");
  return start === -1 || end === -1 ? "" : edgeSource.slice(start, end);
}

describe("discovery location autocomplete contract", () => {
  it("serves autocomplete and location details through the API", () => {
    expect(edgeSource).toMatch(
      /parts\[0\]\s*===\s*"places"[\s\S]{0,160}autocompleteLocations\(/,
    );
    expect(edgeSource).toMatch(
      /parts\[0\]\s*===\s*"places"[\s\S]{0,160}resolvePlaceLocation\(/,
    );
    expect(edgeSource).toContain("places:autocomplete");
    // The bias is now an operator setting; NZ remains the code default.
    expect(edgeSource).toContain('DEFAULT_LOCATION_COUNTRY_BIAS = "nz"');
    expect(edgeSource).toContain("includedRegionCodes: [countryBias]");
  });

  it("never exposes the Google provider credential to the browser", () => {
    for (const file of sourceFilesUnder(resolve("src"))) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toContain("GOOGLE_PLACES_API_KEY");
      expect(source, file).not.toContain("X-Goog-Api-Key");
      expect(source, file).not.toContain("places.googleapis.com");
    }

    // The client only ever calls our own proxy endpoints.
    expect(apiSource).toContain("/places/autocomplete?query=");
    expect(apiSource).toContain("/places/location?place_id=");
  });

  it("persists a structured location alongside the human-readable label", () => {
    const block = createDiscoveryRunBlock();
    expect(block).toContain("location_place_id: locationPlaceId");
    expect(block).toContain("location_latitude: latitude");
    expect(block).toContain("location_longitude: longitude");
    // The legacy human-readable label column is still written.
    expect(block).toContain("location,");
  });
});

describe("controlled category contract", () => {
  it("resolves the operator's category from the registry by slug", () => {
    expect(edgeSource).toContain("opportunity_list_active_categories");
    expect(edgeSource).toContain("findActiveCategory");
    expect(migrationSource).toContain(
      "create table if not exists public.opportunity_categories",
    );
    expect(migrationSource).toContain("where c.status = 'active'");
  });

  it("seeds the practical starter categories", () => {
    for (const slug of [
      "commercial-interiors",
      "builders-construction",
      "electricians",
      "plumbers",
      "accountants",
      "lawyers",
      "property-services",
      "health-clinics",
      "automotive",
      "hospitality",
      "retail",
      "professional-services",
    ]) {
      expect(migrationSource, slug).toContain(`'${slug}',`);
    }
  });

  it("expands the selected category into configured provider search terms", () => {
    // The bound is now an operator setting, itself clamped to MAX_DISCOVERY_SEARCH_TERMS.
    expect(edgeSource).toContain(
      "expandCategorySearchTerms(category, keywords, settings.max_search_terms)",
    );
    expect(edgeSource).toContain("MAX_DISCOVERY_SEARCH_TERMS");
    expect(edgeSource).toContain("const terms = category");
    expect(createDiscoveryRunBlock()).toContain("discovery_terms: terms");
  });

  it("keeps free-text keywords optional and the legacy free-text category alive", () => {
    expect(edgeSource).toContain("cleanText(payload.industry ?? payload.category, 120)");
    expect(edgeSource).not.toMatch(/validation\.keywords/);
  });

  it("stores the category on the run by stable slug, never by free text alone", () => {
    const block = createDiscoveryRunBlock();
    expect(block).toContain("category_slug: category?.slug ?? null");
    expect(block).toContain("category_label: categoryLabel");
  });
});

describe("scenario readiness contract", () => {
  it("validates that the requested scenario is active", () => {
    expect(edgeSource).toContain("scenario_not_active");
    expect(createDiscoveryRunBlock()).toContain("resolveDiscoveryScenario(scenarioId)");
  });

  it("fails closed for scenarios the execution path cannot support", () => {
    expect(edgeSource).toContain("scenario_not_executable");

    const allowListStart = edgeSource.indexOf("const SUPPORTED_DISCOVERY_SCENARIO_SLUGS");
    const allowList = edgeSource.slice(allowListStart, allowListStart + 200);
    expect(allowList).toContain("DEFAULT_DISCOVERY_SCENARIO_SLUG");
    expect(allowList).not.toContain("website-improvement");
    expect(allowList).not.toContain("reputation-trust");
  });

  it("seeds the future scenarios as drafts so they cannot be selected yet", () => {
    const draftSeeds = migrationSource.match(/'draft', 1,/g) ?? [];
    expect(draftSeeds).toHaveLength(6);
    for (const slug of [
      "website-improvement",
      "local-search-visibility",
      "reputation-trust",
      "lead-capture-conversion",
      "automation-opportunity",
      "business-systems-gap",
    ]) {
      expect(migrationSource, slug).toContain(`'${slug}',`);
    }
    // Drafts stay invisible to the operator selector.
    expect(migrationSource).not.toMatch(/'(website-improvement|reputation-trust)[^\n]*'active'/);
  });

  it("persists the selected scenario explicitly on the run", () => {
    expect(createDiscoveryRunBlock()).toContain("scenario_id: scenario.id");
  });
});

describe("discovery intake does not disturb existing contracts", () => {
  it("leaves the Cockpit eligibility gates untouched", () => {
    expect(edgeSource).toContain("function classificationAllowsProgress(");
    expect(edgeSource).toMatch(/eligibilityClassification\(candidateRecord\)/);
    expect(edgeSource).toMatch(/eligibilityClassification\(outreachCandidate/);
    expect(edgeSource).toContain("eligibility_gate_blocked");
    // Creating a run never inspects Cockpit eligibility.
    expect(createDiscoveryRunBlock()).not.toContain("eligibility");
  });

  it("keeps local duplicate state separate from Cockpit classification", () => {
    const block = createDiscoveryRunBlock();
    expect(block).not.toContain("possible_match");
    expect(block).not.toContain("duplicate_lead_id");
    expect(edgeSource).toContain("findDuplicateLead");
    expect(edgeSource).toContain(
      'import_status: duplicateLeadId ? "existing" : "not_imported"',
    );
  });

  it("keeps the possible_match acknowledgement flow in the UI", () => {
    expect(discoveryUiSource).toContain(
      "I have reviewed this possible match and want to continue.",
    );
    expect(discoveryUiSource).toContain("candidateMayProceed(candidate)");
    expect(discoveryUiSource).toContain(
      "possible Cockpit matches awaiting acknowledgement",
    );
  });

  it("adds schema additively so existing discovery runs remain readable", () => {
    expect(migrationSource).toContain("add column if not exists location_place_id text");
    expect(migrationSource).toContain("add column if not exists category_slug text");
    expect(migrationSource).toContain("add column if not exists discovery_terms jsonb");
    expect(migrationSource).toContain("set category_label = industry");
    expect(migrationSource).not.toMatch(/drop column/i);
    expect(migrationSource).not.toMatch(/alter column\s+(location|industry)\b/i);
    // The acknowledgement contract is owned by its own migration.
    expect(migrationSource).not.toContain("eligibility_acknowledged");
  });
});
