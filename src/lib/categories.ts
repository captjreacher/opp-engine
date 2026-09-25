// Controlled Opportunity Engine discovery categories.
//
// The registry lives in Postgres (`opportunity_categories`) and is served read-only
// through the `opportunities` Edge Function. This module holds the pure helpers the
// Discovery form needs; the API wire access lives in `api.ts`.
//
// `expandCategorySearchTerms` intentionally mirrors the backend implementation in
// `supabase/functions/opportunities/index.ts` — the operator sees the same terms the
// provider is asked for. Keep both in step.

/** The maximum number of provider queries one category may expand into. */
export const MAX_DISCOVERY_SEARCH_TERMS = 3;

export interface OpportunityCategory {
  id: string;
  slug: string;
  label: string;
  description: string | null;
  /** Provider-neutral terms the discovery provider may expand into queries. */
  search_terms: string[];
  /** Provider-native place types, retained for future provider mapping. */
  google_types: string[];
  default_radius_m: number | null;
  /** Scenario slugs this category is compatible with. Empty = unrestricted. */
  compatible_scenarios: string[];
  sort_order: number | null;
}

function toStringArray(value: unknown, max = 120): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().replace(/\s+/g, " ").slice(0, max))
    .filter((item) => item.length > 0);
}

function toText(value: unknown, max = 200): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/\s+/g, " ");
  return cleaned ? cleaned.slice(0, max) : null;
}

function toRadius(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

/** Tolerates the raw PostgREST/jsonb row shape and returns null for unusable rows. */
export function normalizeCategory(raw: unknown): OpportunityCategory | null {
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
    search_terms: toStringArray(row.search_terms),
    google_types: toStringArray(row.google_types),
    default_radius_m: toRadius(row.default_radius_m),
    compatible_scenarios: toStringArray(row.compatible_scenarios, 80),
    sort_order: typeof row.sort_order === "number" ? row.sort_order : null,
  };
}

/**
 * The operator may only select active categories. The API already filters by
 * status, but the client must never offer an inactive registry entry even if one
 * is returned (e.g. a stale cache or a mis-scoped query).
 */
export function activeCategories(raw: unknown): OpportunityCategory[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((row) => {
      if (!row || typeof row !== "object") return false;
      const status = (row as Record<string, unknown>).status;
      // Rows without an explicit status are treated as active; an explicit
      // non-active status is never offered to the operator.
      return status === undefined || status === null || status === "active";
    })
    .map(normalizeCategory)
    .filter((category): category is OpportunityCategory => category !== null);
}

export function findCategoryBySlug(
  categories: OpportunityCategory[],
  slug: string | null | undefined,
): OpportunityCategory | null {
  if (!slug) return null;
  return categories.find((category) => category.slug === slug) ?? null;
}

export function categoryDefaultRadius(
  category: OpportunityCategory | null,
): number | null {
  return category?.default_radius_m ?? null;
}

/** An empty compatible_scenarios list means the category is not restricted. */
export function categorySupportsScenario(
  category: OpportunityCategory | null,
  scenarioSlug: string | null | undefined,
): boolean {
  if (!category) return true;
  if (category.compatible_scenarios.length === 0) return true;
  if (!scenarioSlug) return true;
  return category.compatible_scenarios.includes(scenarioSlug);
}

/**
 * Registry search terms (or the category label when none are configured) are the
 * base provider queries; free-text keywords are an optional refinement appended to
 * each base term. De-duplicated and bounded by MAX_DISCOVERY_SEARCH_TERMS.
 */
export function expandCategorySearchTerms(
  category: Pick<OpportunityCategory, "label" | "search_terms"> | null,
  keywords: string | null | undefined,
  limit: number = MAX_DISCOVERY_SEARCH_TERMS,
): string[] {
  if (!category) return [];
  const max = Math.max(1, limit);
  const refinement = toText(keywords, 200);
  const base = category.search_terms.length
    ? category.search_terms
    : [category.label];
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const raw of base) {
    const term = toText(raw, 160);
    if (!term) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(refinement ? `${term} ${refinement}` : term);
    if (terms.length >= max) break;
  }
  return terms;
}

/**
 * Formats a collapsed category label summary for the UI.
 * - Explicit All selection -> "All categories"
 * - No selection -> "Choose categories"
 * - Single category -> "Commercial Interiors"
 * - Multiple categories -> "Commercial Interiors + 2 more"
 */
export function formatCategorySummary(
  labels: string[],
  isAll = false,
): string {
  if (isAll) return "All categories";
  if (labels.length === 0) return "Choose categories";
  if (labels.length === 1) return labels[0];
  return `${labels[0]} + ${labels.length - 1} more`;
}

export function findCategoriesBySlugs(
  categories: OpportunityCategory[],
  slugs: string[],
): OpportunityCategory[] {
  if (!slugs.length) return [];
  const set = new Set(slugs);
  return categories.filter((cat) => set.has(cat.slug));
}

/**
 * Expands search terms for multiple categories.
 * Each category expands its configured search terms (or fallback label) refined with optional keywords.
 * Terms are interleaved round-robin across categories to distribute discovery, then deduplicated deterministically.
 */
export function expandCategoriesSearchTerms(
  categories: Pick<OpportunityCategory, "label" | "search_terms">[],
  keywords: string | null | undefined,
  limitPerCategory: number = MAX_DISCOVERY_SEARCH_TERMS,
): string[] {
  if (!categories.length) return [];

  const perCategoryTerms: string[][] = categories.map((category) =>
    expandCategorySearchTerms(category, keywords, limitPerCategory),
  );

  const seen = new Set<string>();
  const combined: string[] = [];

  let maxTerms = 0;
  for (const terms of perCategoryTerms) {
    if (terms.length > maxTerms) maxTerms = terms.length;
  }

  // Interleave round-robin across categories
  for (let step = 0; step < maxTerms; step++) {
    for (const terms of perCategoryTerms) {
      if (step < terms.length) {
        const term = terms[step];
        const key = term.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          combined.push(term);
        }
      }
    }
  }

  return combined;
}
