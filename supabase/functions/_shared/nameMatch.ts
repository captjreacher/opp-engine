/**
 * Business-name alignment + lead-category vocabulary.
 *
 * Pure, runtime-agnostic helpers (no Deno / DOM / network APIs) shared by:
 *   - supabase/functions/local-business-enrich/index.ts
 *   - supabase/functions/_shared/nameMatch.test.mjs (Node test harness)
 *
 * WHY THIS EXISTS
 * ---------------
 * Live testing of "HP Fitness" (Helensville) promoted "Forge Fitness" assets as
 * canonical evidence. Root cause: the legacy matcher dropped distinctive tokens
 * shorter than 3 chars ("HP") and scored name similarity by raw substring, so
 * the generic category word "fitness" (a substring of "forgefitness") produced a
 * false 100% match.  This module makes identity (distinctive tokens) the gate
 * and treats category words as NON-identifying.
 *
 * DESIGN RULES (decision-grade)
 *   - Locality/suburb match alone is NEVER sufficient to accept a candidate.
 *   - A candidate must align on the DISTINCTIVE part of the business name.
 *   - Single-token / generic-only names require a hard corroborating signal.
 *   - A hard country/locality conflict rejects regardless of name similarity.
 *   - Category words and the lead's own locality words are demoted to "generic"
 *     so they cannot, on their own, establish identity.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Normalization (mirrors index.ts normalizeBusinessName — kept byte-identical)
// ─────────────────────────────────────────────────────────────────────────────

export function normalizeBusinessName(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(limited|ltd|company|co|nz|new zealand)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const STOP_TOKENS = new Set([
  "the", "and", "of", "for", "to", "a", "an", "at", "by", "on", "in",
  "your", "our", "we", "is", "are",
]);

export const GENERIC_CATEGORY_TOKENS = new Set([
  "fitness", "gym", "gyms", "crossfit", "pilates", "yoga", "health", "wellness",
  "physio", "physiotherapy", "chiro", "chiropractic", "massage", "medical",
  "clinic", "dental", "dentist", "dentistry", "osteopath", "podiatry",
  "law", "legal", "lawyer", "lawyers", "solicitor", "solicitors", "barrister",
  "barristers", "conveyancing", "notary",
  "build", "builds", "building", "builder", "builders", "construction",
  "constructions", "carpentry", "joinery", "renovation", "renovations",
  "roofing", "roofers", "painting", "painters", "decorators", "tiling",
  "plastering", "scaffolding", "fencing", "concrete", "landscaping",
  "landscapes", "gardening", "paving",
  "electric", "electrical", "electricians", "electrician", "sparky", "sparkies",
  "plumb", "plumbing", "plumber", "plumbers", "drain", "drains", "drainage",
  "gas", "gasfitting", "gasfitter",
  "earth", "earthworks", "earthmoving", "earthmovers", "excavation",
  "excavations", "excavator", "excavators", "civil", "digger", "diggers",
  "contracting", "contractors", "contractor", "cartage", "haulage",
  "realty", "real", "estate", "estates", "property", "properties",
  "cafe", "cafes", "restaurant", "restaurants", "bar", "bistro", "eatery",
  "takeaway", "takeaways", "catering", "hospitality", "kitchen", "coffee",
  "bakery", "butchery", "meats", "meat", "deli",
  "retail", "store", "stores", "shop", "shops", "boutique", "mart", "market",
  "supplies", "supply", "wholesale",
  "beauty", "salon", "salons", "spa", "hair", "barber", "barbers", "nails",
  "cosmetic", "cosmetics", "skincare", "aesthetics",
  "auto", "automotive", "motors", "motor", "mechanic", "mechanical",
  "mechanics", "panelbeaters", "panelbeater", "tyre", "tyres", "vehicle",
  "vehicles", "car", "cars", "autos", "wof",
  "consulting", "consultants", "consultancy", "accounting", "accountants",
  "accountant", "bookkeeping", "marketing", "advisory", "advisors", "agency",
  "services", "service", "solutions", "systems", "technologies", "technology",
  "digital", "media", "design", "designs",
  "community", "charity", "charitable", "trust", "nonprofit", "incorporated",
  "society", "church", "club", "foundation",
  "group", "holdings", "enterprises", "enterprise", "international", "global",
  "industries", "works", "studio", "studios", "centre", "center", "co",
]);

// ─────────────────────────────────────────────────────────────────────────────
// Name signature
// ─────────────────────────────────────────────────────────────────────────────

export type NameSignature = {
  raw: string;
  normalized: string;
  tokens: string[];
  distinctive: string[];
  generic: string[];
  hasOnlyGeneric: boolean;
};

export function nameSignature(
  businessName: string,
  opts: { localityTokens?: string[] } = {},
): NameSignature {
  const normalized = normalizeBusinessName(businessName);
  const tokens = normalized.split(" ").filter(Boolean);
  const locality = new Set(
    (opts.localityTokens ?? [])
      .map((t) => normalizeBusinessName(t))
      .flatMap((t) => t.split(" "))
      .filter(Boolean),
  );

  const distinctive: string[] = [];
  const generic: string[] = [];
  for (const token of tokens) {
    if (STOP_TOKENS.has(token)) continue;
    if (locality.has(token)) { generic.push(token); continue; }
    if (GENERIC_CATEGORY_TOKENS.has(token)) { generic.push(token); continue; }
    distinctive.push(token);
  }
  return {
    raw: businessName,
    normalized,
    tokens,
    distinctive: [...new Set(distinctive)],
    generic: [...new Set(generic)],
    hasOnlyGeneric: distinctive.length === 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Token matching + alignment
// ─────────────────────────────────────────────────────────────────────────────

export function tokenMatchesStrict(
  token: string,
  candSpaced: string,
  candCompact: string,
): boolean {
  if (!token) return false;
  if (candSpaced.includes(` ${token} `)) return true;
  if (token.length >= 4 && candCompact.includes(token)) return true;
  if (token.length < 4 && candCompact.startsWith(token)) return true;
  return false;
}

export type NameAlignment = {
  distinctiveCoverage: number;
  genericCoverage: number;
  matchedDistinctive: string[];
  matchedGeneric: string[];
  hasSubstantialDistinctiveMatch: boolean;
  hasForeignContent: boolean;
  tier: "exact" | "strong" | "partial" | "none";
};

export function nameAlignmentCheck(
  candidateText: string,
  sig: NameSignature,
): NameAlignment {
  const norm = normalizeBusinessName(candidateText);
  const candSpaced = ` ${norm} `;
  const candCompact = norm.replace(/\s+/g, "");

  let matchedDistinctive = sig.distinctive.filter((t) =>
    tokenMatchesStrict(t, candSpaced, candCompact),
  );
  const matchedGeneric = sig.generic.filter((t) =>
    tokenMatchesStrict(t, candSpaced, candCompact),
  );

  // Contiguous-sequence fallback for short tokens in the middle of concatenated
  // domains (e.g. "all" in "wireallelectrical" for sig ["wire","all"]).
  if (matchedDistinctive.length < sig.distinctive.length && sig.distinctive.length > 1) {
    const sequence = sig.distinctive.join("");
    if (candCompact.includes(sequence)) {
      matchedDistinctive = [...sig.distinctive];
    }
  }

  const distinctiveCoverage = sig.distinctive.length
    ? matchedDistinctive.length / sig.distinctive.length
    : 0;
  const genericCoverage = sig.generic.length
    ? matchedGeneric.length / sig.generic.length
    : 0;
  const hasSubstantialDistinctiveMatch = matchedDistinctive.some((t) => t.length >= 4);

  // Residual-character check: strip all matched tokens from the compact form.
  // If >= 3 alpha chars remain, the candidate carries foreign identity content.
  let residual = candCompact;
  const toStrip = [...matchedDistinctive, ...matchedGeneric].sort(
    (a, b) => b.length - a.length,
  );
  for (const t of toStrip) {
    residual = residual.replace(t, "");
  }
  residual = residual.replace(/[^a-z]/g, "");
  const hasForeignContent = residual.length >= 3;

  let tier: NameAlignment["tier"];
  if (matchedDistinctive.length === 0) tier = "none";
  else if (distinctiveCoverage === 1 && !hasForeignContent) tier = "exact";
  else if (distinctiveCoverage === 1) tier = "strong";
  else tier = "partial";

  return {
    distinctiveCoverage,
    genericCoverage,
    matchedDistinctive,
    matchedGeneric,
    hasSubstantialDistinctiveMatch,
    hasForeignContent,
    tier,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Locality / country alignment
// ─────────────────────────────────────────────────────────────────────────────

const FOREIGN_LOCALITY_TOKENS = new Set([
  "canada", "winnipeg", "toronto", "ontario", "quebec", "alberta", "manitoba",
  "australia", "sydney", "melbourne", "brisbane", "perth", "adelaide", "queensland",
  "united states", "usa", "california", "texas", "florida", "york", "chicago",
  "united kingdom", "england", "london", "scotland", "ireland", "dublin",
  "singapore", "india", "philippines", "malaysia", "africa", "dubai", "germany",
]);

export type LocalityResult = "match" | "conflict" | "unknown";

export function localityAlignmentCheck(
  candidateText: string,
  context: { suburb?: string | null; region?: string | null; country?: string | null },
): LocalityResult {
  const lower = ` ${String(candidateText).toLowerCase()} `;
  const mentionsNz = /\b(new zealand|nz|aotearoa)\b/.test(lower);
  for (const foreign of FOREIGN_LOCALITY_TOKENS) {
    if (lower.includes(` ${foreign} `) && !mentionsNz) return "conflict";
  }
  const localityWords = [context.suburb, context.region]
    .filter(Boolean)
    .flatMap((v) => normalizeBusinessName(v as string).split(" "))
    .filter((w) => w.length >= 3);
  const norm = normalizeBusinessName(candidateText);
  const spaced = ` ${norm} `;
  for (const w of localityWords) {
    if (spaced.includes(` ${w} `)) return "match";
  }
  return "unknown";
}

// ─────────────────────────────────────────────────────────────────────────────
// Candidate acceptance ladder
// ─────────────────────────────────────────────────────────────────────────────

export type CandidateDecision = {
  accept: boolean;
  tier: "exact" | "strong" | "partial" | "none" | "generic_corroborated";
  reason: string | null;
  alignment: NameAlignment;
};

export function evaluateCandidate(
  candidateText: string,
  sig: NameSignature,
  opts: { localityMatch?: LocalityResult; hasCorroboration?: boolean } = {},
): CandidateDecision {
  const localityMatch = opts.localityMatch ?? "unknown";
  const hasCorroboration = Boolean(opts.hasCorroboration);
  const alignment = nameAlignmentCheck(candidateText, sig);

  if (localityMatch === "conflict") {
    return { accept: false, tier: "none", reason: "locality_or_country_mismatch", alignment };
  }

  if (sig.hasOnlyGeneric) {
    if (alignment.genericCoverage >= 0.5 && hasCorroboration && localityMatch === "match") {
      return { accept: true, tier: "generic_corroborated", reason: null, alignment };
    }
    return { accept: false, tier: "none", reason: "generic_name_requires_corroboration", alignment };
  }

  if (alignment.tier === "none") {
    return {
      accept: false,
      tier: "none",
      reason: localityMatch === "match" ? "name_mismatch_despite_locality_match" : "name_mismatch",
      alignment,
    };
  }

  if (alignment.tier === "exact") {
    if (alignment.hasSubstantialDistinctiveMatch) {
      return { accept: true, tier: "exact", reason: null, alignment };
    }
    if (localityMatch === "match" || hasCorroboration) {
      return { accept: true, tier: "exact", reason: null, alignment };
    }
    return { accept: false, tier: "exact", reason: "short_distinctive_token_requires_corroboration", alignment };
  }

  if (alignment.tier === "strong") {
    if (localityMatch === "match" || hasCorroboration) {
      return { accept: true, tier: "strong", reason: null, alignment };
    }
    return { accept: false, tier: "strong", reason: "different_entity_structure_requires_corroboration", alignment };
  }

  // partial
  if (hasCorroboration) {
    return { accept: true, tier: "partial", reason: null, alignment };
  }
  return { accept: false, tier: "partial", reason: "insufficient_business_name_match", alignment };
}

// ─────────────────────────────────────────────────────────────────────────────
// Lead category vocabulary
// ─────────────────────────────────────────────────────────────────────────────

export const LEAD_CATEGORY_OPTIONS = [
  "Fitness / Gym",
  "Law / Legal Services",
  "Trades / Construction",
  "Electrical",
  "Plumbing / Drainage",
  "Earthworks / Civil",
  "Real Estate",
  "Hospitality",
  "Retail",
  "Health / Wellness",
  "Beauty / Personal Care",
  "Automotive",
  "Professional Services",
  "Community / Non-profit",
  "Other",
] as const;

export type LeadCategory = (typeof LEAD_CATEGORY_OPTIONS)[number];

const CATEGORY_RULES: { label: LeadCategory; needles: string[] }[] = [
  { label: "Fitness / Gym", needles: ["fitness", "gym", "crossfit", "pilates", "yoga", "f45", "strength", "barre"] },
  { label: "Law / Legal Services", needles: ["law", "legal", "lawyer", "solicitor", "barrister", "conveyanc", "notary"] },
  { label: "Earthworks / Civil", needles: ["earth", "excavat", "earthmov", "civil", "digger", "cartage", "haulage", "drainage and civil"] },
  { label: "Plumbing / Drainage", needles: ["plumb", "drainage", "drainlay", "gasfit", " drain"] },
  { label: "Electrical", needles: ["electric", "sparky", "electrician"] },
  { label: "Real Estate", needles: ["real estate", "realty", "harcourts", "ray white", "barfoot", "property management", "bayleys"] },
  { label: "Automotive", needles: ["automotive", "mechanic", "panelbeat", "tyre", "auto ", "motors", "vehicle", "wof", "car service"] },
  { label: "Beauty / Personal Care", needles: ["beauty", "salon", " spa", "hair", "barber", "nails", "skincare", "cosmetic", "aesthetic"] },
  { label: "Hospitality", needles: ["cafe", "restaurant", " bar", "bistro", "eatery", "takeaway", "catering", "coffee", "bakery", "butcher", "meats", "hospitality"] },
  { label: "Health / Wellness", needles: ["physio", "chiro", "massage", "dental", "dentist", "medical", "clinic", "wellness", "osteopath", "podiatry", "health"] },
  { label: "Trades / Construction", needles: ["build", "construct", "carpentry", "joinery", "roofing", "painting", "painter", "plaster", "concrete", "fencing", "landscap", "renovation", "tiling", "scaffold"] },
  { label: "Retail", needles: ["retail", "store", "shop", "boutique", "wholesale", "supplies", "mart"] },
  { label: "Community / Non-profit", needles: ["charit", "nonprofit", "non-profit", "incorporated society", "church", "foundation", " trust", "community"] },
  { label: "Professional Services", needles: ["consult", "account", "bookkeep", "marketing", "advisory", "agency", "solutions", "it services", "design", "media"] },
];

export function inferCanonicalCategory(
  businessName: string,
  extraHint?: string | null,
): string | null {
  const haystack = ` ${businessName.toLowerCase()} ${(extraHint ?? "").toLowerCase()} `;
  for (const rule of CATEGORY_RULES) {
    if (rule.needles.some((n) => haystack.includes(n))) return rule.label;
  }
  return null;
}

export function isCanonicalCategory(value: unknown): value is LeadCategory {
  return typeof value === "string" && (LEAD_CATEGORY_OPTIONS as readonly string[]).includes(value);
}
