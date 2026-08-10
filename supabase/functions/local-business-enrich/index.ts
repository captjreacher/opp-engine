import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  nameSignature,
  nameAlignmentCheck,
  evaluateCandidate,
  localityAlignmentCheck,
  inferCanonicalCategory,
  LEAD_CATEGORY_OPTIONS,
  type NameSignature,
  type CandidateDecision,
} from "../_shared/nameMatch.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Type definitions
// ─────────────────────────────────────────────────────────────────────────────

type Json = Record<string, unknown>;
type SupabaseClientLike = ReturnType<typeof createClient<any>>;
type EnrichmentStatus = "success" | "partial" | "failed";
type FieldKey = "website_url" | "facebook_url" | "google_maps_url" | "social_url" | "phone" | "email" | "suburb" | "country" | "category" | "address";
type PatchableFieldKey = Exclude<FieldKey, "social_url"> | "opening_hours";

type DiscoveryContext = {
  businessName: string;
  normalizedName: string;
  strippedName: string;
  tokens: string[];
  suburb: string | null;
  region: string | null;
  country: string | null;
  category: string | null;
};

type FieldCandidate = {
  field: FieldKey;
  value: string;
  confidence: number;
  source: string;
  sourceUrl?: string;
  reason: string;
};

type EvidenceClass = "canonical" | "supporting" | "citation" | "rejected";
type IdentityAlignment = "strong_alignment" | "moderate_alignment" | "review_required";

type Evidence = {
  source_url: string;
  source_type: string;
  source_provider: string;
  evidence_class: EvidenceClass;
  field_name: string;
  field_value: string;
  confidence: number;
  observed_at: string;
  identity_alignment?: IdentityAlignment;
  identity_reason?: string;
  rejection_reason?: string;
};

type SourceUrl = {
  url: string;
  source_type: string;
  evidence_class: EvidenceClass;
  fields: string[];
  confidence: number;
};

type RejectedUrl = {
  url: string;
  field: FieldKey | "unknown";
  source_type: string;
  reason: string;
  observed_at: string;
};

type EnrichmentResult = {
  business_name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  social_links: Json[];
  service_areas: string[];
  categories: string[];
  review_signals: Json[];
  trust_signals: string[];
  risk_flags: string[];
  source_urls: SourceUrl[];
  confidence_score: number;
  trust_score: number;
  trust_summary: string;
  data_alignment_status: "strong_alignment" | "partial_alignment" | "conflicting" | "insufficient_evidence";
  identity_alignment: {
    facebook: {
      status: IdentityAlignment;
      url: string | null;
      reason: string;
    };
  };
  evidence: Evidence[];
  rejected_urls: RejectedUrl[];
};

type TierDebug = {
  attempted: boolean;
  skip_reason: string | null;
  queries?: string[];
  candidates_found?: number;
  wall_clock_ms: number;
  provider_error?: string | null;
  place_ids?: string[];
  urls_probed?: string[];
  pages_reached?: number;
};

type EnrichmentDebug = {
  schema_version: string;
  observed_at: string;
  identity: {
    business_name: string;
    normalized_name: string;
    tokens: string[];
    suburb: string | null;
    category_hint: string | null;
  };
  tiers: {
    google_places: TierDebug;
    exa: TierDebug;
    direct_fetch: TierDebug;
    duckduckgo: TierDebug;
  };
  all_candidates: FieldCandidate[];
  rejected_candidates: FieldCandidate[];
  selected_fields: Json;
  persistence_result: { fields_updated: string[]; fields_skipped: string[] };
  search_tier_reached: string;
  total_wall_clock_ms: number;
  status: string;
};

type OpeningHours = {
  weekday_descriptions?: string[];
  periods?: Json[];
  source?: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const meaningfulFields: (Exclude<PatchableFieldKey, "opening_hours">)[] = ["website_url", "facebook_url", "google_maps_url", "phone", "email"];
const patchableFields: PatchableFieldKey[] = ["website_url", "facebook_url", "google_maps_url", "phone", "email", "address", "suburb", "country", "category", "opening_hours"];
const fieldThresholds: Record<FieldKey, number> = {
  website_url: 0.72,
  facebook_url: 0.74,
  google_maps_url: 0.72,
  social_url: 0.74,
  phone: 0.76,
  email: 0.76,
  suburb: 0.78,
  country: 0.78,
  category: 0.72,
  address: 0.74,
};

const directoryHosts = [
  "yellow.co.nz",
  "finda.co.nz",
  "cylex.co.nz",
  "neighbourly.co.nz",
  "nocowboys.co.nz",
  "builderscrack.co.nz",
  "zenbu.co.nz",
  "businesscheck.co.nz",
  "opendi.co.nz",
  "localist.co.nz",
  "hotfrog.co.nz",
  "nzlbusiness.com",
  "kompass.com",
  "cybo.com",
  "fyple.co.nz",
  "infobel.co.nz",
  "chamberofcommerce.co.nz",
  "northwestcountry.co.nz",
  "mappaus.com",
  "placedigger.com",
  "nz.placedigger.com",
  "newzealand-company.com",
  "nzwao.com",
  "dnb.com",
  "servicefinder.co.nz",
  "findglocal.com",
  "foodbevg.com",
  "thefamilycompany.co.nz",
  "sur.ly",
];

const reviewHosts = ["yelp.com", "nocowboys.co.nz", "scamadviser.com", "tripadvisor.co.nz", "tripadvisor.com"];
const marketplaceHosts = ["builderscrack.co.nz", "servicefinder.co.nz", "oneflare.co.nz"];
const citationPathPatterns = [/\/listing\//i, /\/business-directory\//i, /\/company\//i, /\/companies\//i, /\/biz\//i, /\/profile\//i, /\/co\//i];
const trackingParamPattern = /^(utm_|fbclid$|gclid$|gbraid$|wbraid$|mc_|yclid$|msclkid$|ref$|ref_src$|spm$|igshid$)/i;

const GOOGLE_PLACES_FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.nationalPhoneNumber",
  "places.internationalPhoneNumber",
  "places.websiteUri",
  "places.googleMapsUri",
  "places.types",
  "places.regularOpeningHours",
  "places.primaryType",
  "places.primaryTypeDisplayName",
  "places.shortFormattedAddress",
  "places.addressComponents",
].join(",");

// Minimum number of meaningful fields before we skip lower tiers.
const SUFFICIENT_CANDIDATE_THRESHOLD = 2;

// ─────────────────────────────────────────────────────────────────────────────
// Primitive helpers
// ─────────────────────────────────────────────────────────────────────────────

const asString = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const round2 = (n: number) => Number(n.toFixed(2));
const dedupe = <T>(items: T[]) => [...new Set(items)];
export const dedupeStrings = (items: string[]) => {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.trim().toLocaleLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};
const dedupeRejectedUrls = (items: RejectedUrl[]) => [
  ...new Map(items.map((item) => [`${item.field}:${item.url}:${item.reason}`, item])).values(),
];

function log(event: string, payload: Json = {}) {
  console.log(JSON.stringify({ component: "local-business-enrich", event, ...payload }));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function jsonResponse(body: Json, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getRequiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`missing_required_env:${name}`);
  return value;
}

function createSupabaseAdmin() {
  // Canonical service-role secret name. Keep service role usage inside Edge Functions only; never expose it to Cockpit.
  return createClient(getRequiredEnv("SUPABASE_URL"), getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY"));
}

// ─────────────────────────────────────────────────────────────────────────────
// Business-name normalization
// ─────────────────────────────────────────────────────────────────────────────

function normalizeBusinessName(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(limited|ltd|company|co|nz|new zealand)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(value: string) {
  return normalizeBusinessName(value).replace(/\s+/g, "-");
}

function compactSlug(value: string) {
  return normalizeBusinessName(value).replace(/\s+/g, "");
}

function tokensFromName(value: string) {
  return normalizeBusinessName(value)
    .split(" ")
    .filter((token) => token.length >= 3);
}

// ─────────────────────────────────────────────────────────────────────────────
// Name-alignment bridge (delegates to ../_shared/nameMatch.ts)
// ─────────────────────────────────────────────────────────────────────────────

/** Bridge DiscoveryContext → nameSignature from the shared module. */
function nameSignatureFromContext(context: DiscoveryContext): NameSignature {
  return nameSignature(context.businessName, {
    localityTokens: [context.suburb ?? "", context.region ?? "", context.country ?? ""],
  });
}

// ── REMOVED: inline copies of STOP_TOKENS, GENERIC_CATEGORY_TOKENS,
// ── NameSignature, NameAlignment, CandidateDecision, nameSignatureFromContext,
// ── nameAlignmentCheck, localityAlignmentCheck, evaluateCandidate,
// ── LEAD_CATEGORY_OPTIONS, CATEGORY_RULES, inferCanonicalCategory.
// ── All now imported from ../_shared/nameMatch.ts.
// ── (placeholder marker for edit — do not remove the line below)
const _NAME_MATCH_REMOVED = true; // eslint-disable-line @typescript-eslint/no-unused-vars

// ─────────────────────────────────────────────────────────────────────────────
// Category inference and discovery context
// ─────────────────────────────────────────────────────────────────────────────

function inferCategory(name: string, raw: Json) {
  const rawCategory = asString(raw.category);
  if (rawCategory) return rawCategory;
  return inferCanonicalCategory(name) ?? null;
}

function contextFrom(raw: Json, businessName: string): DiscoveryContext {
  const normalizedName = normalizeBusinessName(businessName);
  const strippedName = normalizedName || businessName;
  const suburb = asString(raw.suburb) ?? asString(raw.location) ?? asString(raw.city);
  const region = asString(raw.region) ?? asString(raw.state) ?? asString(raw.province);
  const country = asString(raw.country) ?? "NZ";

  return {
    businessName,
    normalizedName,
    strippedName,
    tokens: tokensFromName(strippedName),
    suburb,
    region,
    country,
    category: inferCategory(businessName, raw),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// URL cleaning and classification
// ─────────────────────────────────────────────────────────────────────────────

function cleanUrl(rawUrl: string | null) {
  if (!rawUrl) return null;
  const candidate = rawUrl.trim().replace(/&amp;/g, "&");
  if (!candidate) return null;
  const withProtocol = /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`;
  try {
    const url = new URL(withProtocol);
    url.protocol = "https:";
    url.hostname = url.hostname.toLowerCase();
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (trackingParamPattern.test(key)) url.searchParams.delete(key);
    }
    if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
    if (url.pathname === "/" && !url.search) return `${url.protocol}//${url.hostname}`;
    return url.toString();
  } catch {
    return null;
  }
}

function normalizedHost(rawUrl: string | null) {
  try {
    return rawUrl ? new URL(rawUrl).hostname.replace(/^www\./, "").toLowerCase() : null;
  } catch {
    return null;
  }
}

function isDirectoryHost(rawUrl: string) {
  const host = normalizedHost(cleanUrl(rawUrl));
  if (!host) return true;
  return directoryHosts.some((directory) => host === directory || host.endsWith(`.${directory}`));
}

function hostMatches(rawUrl: string | null, hosts: string[]) {
  const host = normalizedHost(cleanUrl(rawUrl));
  if (!host) return false;
  return hosts.some((candidate) => host === candidate || host.endsWith(`.${candidate}`));
}

function hasCitationPath(rawUrl: string | null) {
  const cleaned = cleanUrl(rawUrl);
  if (!cleaned) return false;
  try {
    const url = new URL(cleaned);
    return citationPathPatterns.some((pattern) => pattern.test(url.pathname));
  } catch {
    return false;
  }
}

export function sourceTypeForUrl(rawUrl: string | null, fallback = "payload") {
  const cleaned = cleanUrl(rawUrl);
  const host = normalizedHost(cleaned);
  if (!host || !cleaned) return fallback;
  if (host.includes("facebook.com") && isCanonicalFacebookPageUrl(cleaned)) return "official_facebook_page";
  if (isCanonicalSocialProfileUrl(cleaned)) return "official_social_profile";
  if (isSupportedSocialHost(host)) return "social_citation";
  if ((host.includes("google.") && new URL(cleaned).pathname.includes("/maps")) || host === "maps.app.goo.gl") return "google_business_profile";
  if (hostMatches(cleaned, reviewHosts)) return "review_source";
  if (hostMatches(cleaned, marketplaceHosts)) return "marketplace_source";
  if (isDirectoryHost(cleaned) || hasCitationPath(cleaned)) return "directory_citation";
  return "official_website";
}

function isSearchEngineInternalUrl(rawUrl: string) {
  const cleaned = cleanUrl(rawUrl);
  const host = normalizedHost(cleaned);
  if (!cleaned || !host) return true;
  if (host !== "duckduckgo.com" && host !== "html.duckduckgo.com") return false;
  try {
    const path = new URL(cleaned).pathname.toLowerCase();
    return !path.startsWith("/l/");
  } catch {
    return true;
  }
}

function classifySourceType(rawUrl: string | null, fallback = "payload") {
  return sourceTypeForUrl(rawUrl, fallback);
}

function classifyUrl(rawUrl: string): FieldKey | null {
  const cleaned = cleanUrl(rawUrl);
  if (!cleaned) return null;
  const host = normalizedHost(cleaned);
  if (!host) return null;
  if (host.includes("facebook.com")) return "facebook_url";
  if (isSupportedSocialHost(host)) return "social_url";
  if ((host.includes("google.") && new URL(cleaned).pathname.includes("/maps")) || host === "maps.app.goo.gl") return "google_maps_url";
  return "website_url";
}

function isGenericGoogleMapsUrl(rawUrl: string, _context?: DiscoveryContext) {
  const cleaned = cleanUrl(rawUrl);
  if (!cleaned) return true;
  try {
    const url = new URL(cleaned);
    const host = url.hostname.toLowerCase();
    if (!host.includes("google.") && host !== "maps.app.goo.gl") return false;
    return !url.pathname.includes("/place/") && !url.searchParams.has("cid") && !url.searchParams.has("query_place_id");
  } catch {
    return true;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Social URL classification
// ─────────────────────────────────────────────────────────────────────────────

function isSupportedSocialHost(host: string) {
  return (
    host.includes("facebook.com") ||
    host.includes("instagram.com") ||
    host.includes("linkedin.com") ||
    host.includes("tiktok.com") ||
    host.includes("youtube.com") ||
    host === "youtu.be"
  );
}

function isCanonicalFacebookPageUrl(rawUrl: string, context?: DiscoveryContext) {
  const cleaned = cleanUrl(rawUrl);
  if (!cleaned) return false;
  try {
    const url = new URL(cleaned);
    if (!url.hostname.toLowerCase().includes("facebook.com")) return false;
    if (url.search && [...url.searchParams.keys()].length > 0) return false;
    const path = url.pathname.toLowerCase().replace(/^\/+|\/+$/g, "");
    if (
      !path ||
      path.includes("/") ||
      path === "search" ||
      path.startsWith("search/") ||
      path.includes("posts") ||
      path.includes("videos") ||
      path.includes("reels") ||
      path.includes("photos") ||
      path.includes("photo") ||
      path.includes("share") ||
      path.includes("groups") ||
      path.includes("watch")
    ) return false;
    if (context && tokenCoverage(path, context.tokens) < 0.35) return false;
    return true;
  } catch {
    return false;
  }
}

function isCanonicalSocialProfileUrl(rawUrl: string, context?: DiscoveryContext) {
  const cleaned = cleanUrl(rawUrl);
  if (!cleaned) return false;
  try {
    const url = new URL(cleaned);
    const host = url.hostname.toLowerCase();
    const path = url.pathname.replace(/^\/+|\/+$/g, "");
    const lowerPath = path.toLowerCase();
    if (host.includes("facebook.com")) return isCanonicalFacebookPageUrl(cleaned, context);
    if (url.search && [...url.searchParams.keys()].length > 0) return false;
    if (!path) return false;
    if (host.includes("instagram.com")) {
      if (lowerPath.includes("/") || ["p", "reel", "stories", "explore"].some((part) => lowerPath === part || lowerPath.startsWith(`${part}/`))) return false;
      return !context || tokenCoverage(path, context.tokens) >= 0.25;
    }
    if (host.includes("linkedin.com")) {
      if (!lowerPath.startsWith("company/")) return false;
      return path.split("/").length === 2 && (!context || tokenCoverage(path, context.tokens) >= 0.25);
    }
    if (host.includes("tiktok.com")) {
      if (!lowerPath.startsWith("@") || lowerPath.includes("/")) return false;
      return !context || tokenCoverage(path, context.tokens) >= 0.25;
    }
    if (host.includes("youtube.com")) {
      if (!(lowerPath.startsWith("@") || lowerPath.startsWith("channel/") || lowerPath.startsWith("c/"))) return false;
      return lowerPath.startsWith("@") ? !lowerPath.includes("/") : path.split("/").length === 2;
    }
    return false;
  } catch {
    return false;
  }
}

function canonicalSocialPlatform(rawUrl: string) {
  const host = normalizedHost(cleanUrl(rawUrl)) ?? "";
  if (host.includes("facebook.com")) return "facebook";
  if (host.includes("instagram.com")) return "instagram";
  if (host.includes("linkedin.com")) return "linkedin_company";
  if (host.includes("tiktok.com")) return "tiktok";
  if (host.includes("youtube.com") || host === "youtu.be") return "youtube";
  return "social";
}

function canonicalUrlRejectionReason(rawUrl: string, field: FieldKey, context: DiscoveryContext) {
  const cleaned = cleanUrl(rawUrl);
  if (!cleaned) return "invalid_url";
  const sourceType = sourceTypeForUrl(cleaned);
  if (field === "website_url") {
    if (sourceType !== "official_website") return `${sourceType}_not_business_controlled`;
    if (!isCanonicalWebsiteUrl(cleaned, context)) return "not_clean_business_controlled_base_domain";
    const coverage = tokenCoverage(`${normalizedHost(cleaned) ?? ""} ${new URL(cleaned).pathname}`, context.tokens);
    if (coverage < 0.67) return "domain_does_not_match_business_name";
  }
  if (field === "facebook_url" && !isCanonicalFacebookPageUrl(cleaned, context)) return "not_clean_facebook_page_url";
  if (field === "social_url" && !isCanonicalSocialProfileUrl(cleaned, context)) return "not_clean_supported_social_profile";
  if (field === "google_maps_url" && isGenericGoogleMapsUrl(cleaned, context)) return "generic_google_maps_url";
  return null;
}

function isCanonicalWebsiteUrl(rawUrl: string, context: DiscoveryContext) {
  const cleaned = cleanUrl(rawUrl);
  if (!cleaned) return false;
  if (sourceTypeForUrl(cleaned) !== "official_website") return false;
  try {
    const url = new URL(cleaned);
    const path = url.pathname.replace(/^\/+|\/+$/g, "");
    if (path && path.split("/").length > 1) return false;
    if (path && !/^(home|about|contact|contact-us)$/i.test(path)) return false;
    return tokenCoverage(`${url.hostname} ${path}`, context.tokens) >= 0.67;
  } catch {
    return false;
  }
}

function canonicalWebsiteValue(rawUrl: string) {
  const cleaned = cleanUrl(rawUrl);
  if (!cleaned) return rawUrl;
  const url = new URL(cleaned);
  return `${url.protocol}//${url.hostname}`;
}

function rejectedUrl(rawUrl: string, field: FieldKey | "unknown", reason: string, observedAt: string): RejectedUrl | null {
  const cleaned = cleanUrl(decodeDuckDuckGoUrl(rawUrl));
  if (!cleaned) return null;
  return {
    url: cleaned,
    field,
    source_type: sourceTypeForUrl(cleaned),
    reason,
    observed_at: observedAt,
  };
}

function decodeDuckDuckGoUrl(rawUrl: string) {
  try {
    const expanded = rawUrl.replace(/&amp;/g, "&");
    const url = new URL(expanded, "https://duckduckgo.com");
    const redirected = url.searchParams.get("uddg");
    return redirected ? decodeURIComponent(redirected) : rawUrl;
  } catch {
    return rawUrl;
  }
}

function urlsFromHtml(text: string) {
  return dedupe(
    [...text.matchAll(/href=["']([^"']+)["']/gi)]
      .map((match) => match[1])
      .map((href) => href.replace(/\\\//g, "/"))
      .map(cleanUrl)
      .filter((url): url is string => Boolean(url)),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Text extraction: phone, email, address, opening hours
// ─────────────────────────────────────────────────────────────────────────────

function isLikelyPhone(value: string) {
  return /(?:\+?64|0)[\d\s().-]{7,}/.test(value);
}

function phoneFromText(text: string) {
  const cleaned = text.replace(/&nbsp;/g, " ");
  const match = cleaned.match(/(?:\+64\s?|0)\d{1,2}[\s().-]?\d{3,4}[\s().-]?\d{3,4}/);
  return match ? match[0].replace(/\s+/g, " ").trim() : null;
}

function isLikelyEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function emailFromText(text: string) {
  const match = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  return match ? match[0].toLowerCase() : null;
}

function addressFromText(text: string) {
  const plain = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const match = plain.match(/\b\d{1,5}\s+[A-Z][A-Za-z0-9' -]+?\s(?:Road|Rd|Street|St|Avenue|Ave|Drive|Dr|Lane|Ln|Place|Pl|Way|Highway|Hwy|Terrace|Tce|Crescent|Cres)\b(?:,\s*)?(?:[A-Z][A-Za-z' -]{2,40})?/);
  return match ? match[0].trim() : null;
}

/**
 * Extract opening hours from free-form text. Looks for common patterns like
 * "Mon-Fri 8am-5pm", "Monday to Friday: 8:00am - 5:00pm", etc.
 */
function openingHoursFromText(text: string): OpeningHours | null {
  const plain = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  // Match patterns like "Mon-Fri 8am-5pm" or "Monday - Friday: 8:00 AM - 5:00 PM"
  const dayPattern = /\b(Mon(?:day)?|Tue(?:sday)?|Wed(?:nesday)?|Thu(?:rsday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)/gi;
  const hourPattern = /\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM)/g;
  const rangePattern = new RegExp(
    `((?:Mon(?:day)?|Tue(?:sday)?|Wed(?:nesday)?|Thu(?:rsday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)` +
    `(?:\\s*[-–to]+\\s*` +
    `(?:Mon(?:day)?|Tue(?:sday)?|Wed(?:nesday)?|Thu(?:rsday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?))?` +
    `\\s*[:;]?\\s*` +
    `\\d{1,2}(?::\\d{2})?\\s*(?:am|pm|AM|PM)` +
    `\\s*[-–to]+\\s*` +
    `\\d{1,2}(?::\\d{2})?\\s*(?:am|pm|AM|PM))`,
    "gi"
  );

  const matches = [...plain.matchAll(rangePattern)].map((m) => m[0].trim());
  if (matches.length === 0) return null;

  return {
    weekday_descriptions: matches,
    source: "website_html",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Token coverage
// ─────────────────────────────────────────────────────────────────────────────

function tokenCoverage(text: string, tokens: string[]) {
  if (tokens.length === 0) return 0;
  const normalizedText = normalizeBusinessName(text);
  const matched = tokens.filter((token) => normalizedText.includes(token));
  return matched.length / tokens.length;
}

// ─────────────────────────────────────────────────────────────────────────────
// Candidate generators (direct from payload, generated slugs)
// ─────────────────────────────────────────────────────────────────────────────

function directCandidates(raw: Json, context: DiscoveryContext): FieldCandidate[] {
  const candidates: FieldCandidate[] = [];
  const add = (field: FieldKey, value: string | null, confidence: number, source: string, reason: string, sourceUrl?: string) => {
    if (!value) return;
    candidates.push({ field, value, confidence, source, sourceUrl, reason });
  };

  const websiteRaw = cleanUrl(asString(raw.website_url) ?? asString(raw.website) ?? asString(raw.url));
  const website = websiteRaw && isCanonicalWebsiteUrl(websiteRaw, context) ? canonicalWebsiteValue(websiteRaw) : null;
  const facebook = cleanUrl(asString(raw.facebook_url) ?? asString(raw.facebook));
  const googleMaps = cleanUrl(asString(raw.google_maps_url) ?? asString(raw.google_maps) ?? asString(raw.google_business_profile_url));
  const phone = asString(raw.phone) ?? asString(raw.phone_number) ?? asString(raw.contact_phone);
  const email = asString(raw.email) ?? asString(raw.contact_email) ?? asString(raw.email_address);
  const address = asString(raw.address) ?? asString(raw.street_address);
  const country = asString(raw.country);

  add("website_url", website, 0.98, "payload", "explicit website field", website ?? undefined);
  add("facebook_url", facebook && isCanonicalFacebookPageUrl(facebook, context) ? facebook : null, 0.98, "payload", "explicit Facebook field", facebook ?? undefined);
  add("google_maps_url", googleMaps && !isGenericGoogleMapsUrl(googleMaps, context) ? googleMaps : null, 0.98, "payload", "explicit Google Maps field", googleMaps ?? undefined);
  add("phone", phone && isLikelyPhone(phone) ? phone : null, 0.96, "payload", "explicit phone field");
  add("email", email && isLikelyEmail(email) ? email.toLowerCase() : null, 0.96, "payload", "explicit email field");
  add("address", address, 0.94, "payload", "explicit address field");
  add("suburb", context.suburb, 0.84, "payload", "location field");
  add("country", country, 0.96, "payload", "explicit country field");
  add("category", context.category, 0.82, "heuristic", "business-name category inference");

  return candidates;
}

function generatedWebsiteUrls(context: DiscoveryContext) {
  const names = dedupe([context.strippedName, context.normalizedName, context.businessName].map(normalizeBusinessName).filter(Boolean));
  const slugs = dedupe(names.flatMap((name) => [compactSlug(name), slugify(name)]).filter((slug) => slug.length >= 4));
  const hostnames = slugs.flatMap((slug) => [`${slug}.co.nz`, `${slug}.nz`, `${slug}.com`]);
  return dedupe(hostnames.flatMap((host) => [`https://${host}`, `https://www.${host}`])).slice(0, 18);
}

function generatedLookupCandidates(context: DiscoveryContext): FieldCandidate[] {
  const queryParts = [context.strippedName, context.suburb, context.region, context.country].filter(Boolean);
  const searchQuery = encodeURIComponent(queryParts.join(" "));
  const facebookSlugs = dedupe([slugify(context.strippedName), compactSlug(context.strippedName)].filter((slug) => slug.length >= 4));

  return [
    {
      field: "google_maps_url",
      value: `https://www.google.com/maps/search/?api=1&query=${searchQuery}`,
      confidence: 0.5,
      source: "generated_search_url",
      sourceUrl: `https://www.google.com/maps/search/?api=1&query=${searchQuery}`,
      reason: "Google Maps search URL, not a verified business profile",
    },
    ...facebookSlugs.map((slug) => ({
      field: "facebook_url" as const,
      value: `https://www.facebook.com/${slug}`,
      confidence: 0.48,
      source: "generated_social_slug",
      sourceUrl: `https://www.facebook.com/${slug}`,
      reason: "generated Facebook slug requires external confirmation",
    })),
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP fetch helper
// ─────────────────────────────────────────────────────────────────────────────

async function fetchText(url: string, timeoutMs = 4500) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 local-business-enrich/2.0",
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.5",
      },
    });
    if (!response.ok) return { ok: false, finalUrl: response.url, text: "", status: response.status };
    return { ok: true, finalUrl: response.url, text: (await response.text()).slice(0, 160_000), status: response.status };
  } catch {
    return { ok: false, finalUrl: url, text: "", status: 0 };
  } finally {
    clearTimeout(timeout);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Content extraction from fetched pages
// ─────────────────────────────────────────────────────────────────────────────

function extractReviewSignals(text: string, sourceUrl: string) {
  const plain = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const signals: Json[] = [];
  const rating = plain.match(/\b([1-5](?:\.\d)?)\s*(?:stars?|rating)\b/i);
  const reviews = plain.match(/\b(\d{1,4})\s+reviews?\b/i);
  if (rating || reviews) {
    signals.push({
      source_url: sourceUrl,
      rating: rating ? Number(rating[1]) : null,
      review_count: reviews ? Number(reviews[1]) : null,
    });
  }
  return signals;
}

function detectOperatingHistory(text: string) {
  const plain = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const since = plain.match(/\b(?:since|established|est\.?)\s+(19\d{2}|20\d{2})\b/i);
  return since ? { since_year: Number(since[1]) } : null;
}

function detectContactPathway(text: string) {
  const normalized = text.toLowerCase();
  return ["contact us", "request a quote", "get a quote", "free quote", "enquiry", "call us"].filter((needle) => normalized.includes(needle));
}

// ─────────────────────────────────────────────────────────────────────────────
// Tier 1: Google Places API (NEW)
// ─────────────────────────────────────────────────────────────────────────────

type GooglePlacesResult = {
  candidates: FieldCandidate[];
  openingHours: OpeningHours | null;
  gbpCategory: string | null;
  placeIds: string[];
  query: string;
};

async function searchGooglePlaces(
  context: DiscoveryContext,
  observedAt: string,
  raw?: Json,
): Promise<{ result: GooglePlacesResult | null; debug: TierDebug }> {
  const apiKey = Deno.env.get("GOOGLE_PLACES_API_KEY");
  if (!apiKey) {
    return {
      result: null,
      debug: { attempted: false, skip_reason: "api_key_missing", wall_clock_ms: 0 },
    };
  }

  // Build targeted queries per spec:
  //   1. "{name}" "{suburb}" "{country}"
  //   2. "{name}" "{address}" (if address exists)
  //   3. "{name}" "{phone}" (if phone exists)
  //   4. "{name}" "Google Maps" "{suburb}" "{country}"
  const locationQuery = [context.suburb, context.region, context.country].filter(Boolean).join(" ");
  const primaryQuery = [context.businessName, locationQuery].filter(Boolean).join(" ");
  const fallbackQueries: string[] = [];
  const address = raw ? asString(raw.address) : null;
  const phone = raw ? (asString(raw.phone) ?? asString(raw.phone_number)) : null;
  if (address) fallbackQueries.push(`"${context.businessName}" "${address}"`);
  if (phone) fallbackQueries.push(`"${context.businessName}" "${phone}"`);
  if (locationQuery) fallbackQueries.push(`"${context.businessName}" "Google Maps" "${locationQuery}"`);

  const query = primaryQuery;
  const startMs = Date.now();

  try {
    const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": GOOGLE_PLACES_FIELD_MASK,
      },
      body: JSON.stringify({ textQuery: query }),
    });

    const wallClockMs = Date.now() - startMs;

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      log("google_places_error", { status: response.status, body: errorBody.slice(0, 500) });
      return {
        result: null,
        debug: {
          attempted: true,
          skip_reason: null,
          queries: [query],
          candidates_found: 0,
          wall_clock_ms: wallClockMs,
          provider_error: `HTTP ${response.status}: ${errorBody.slice(0, 200)}`,
          place_ids: [],
        },
      };
    }

    const data = await response.json();
    const places: Json[] = data.places ?? [];
    const candidates: FieldCandidate[] = [];
    const placeIds: string[] = [];
    let openingHours: OpeningHours | null = null;
    let gbpCategory: string | null = null;

    for (const place of places) {
      const placeId = asString(place.id as unknown);
      if (placeId) placeIds.push(placeId);

      const displayName = (place.displayName as Json)?.text as string | undefined;

      const formattedAddress = asString(place.formattedAddress as unknown);
      const shortAddress = asString(place.shortFormattedAddress as unknown);
      const nationalPhone = asString(place.nationalPhoneNumber as unknown);
      const intlPhone = asString(place.internationalPhoneNumber as unknown);
      const websiteUri = asString(place.websiteUri as unknown);
      const mapsUri = asString(place.googleMapsUri as unknown);
      const primaryType = asString(place.primaryType as unknown);
      const primaryTypeDisplay = (place.primaryTypeDisplayName as Json)?.text as string | undefined;
      const addressComponents = (place.addressComponents as Json[] | undefined) ?? [];

      // ── Strict name gate (replaces legacy tokenCoverage threshold) ──
      const sig = nameSignatureFromContext(context);
      const localityText = formattedAddress ?? shortAddress ?? "";
      const locality = localityAlignmentCheck(localityText, context);
      const decision = evaluateCandidate(displayName ?? "", sig, {
        localityMatch: locality,
        hasCorroboration: Boolean(nationalPhone || intlPhone || websiteUri),
      });
      if (!decision.accept) {
        log("gbp_candidate_rejected", {
          display_name: displayName,
          reason: decision.reason,
          tier: decision.tier,
          lead: context.businessName,
        });
        continue;
      }

      const nameCoverage = displayName ? tokenCoverage(displayName, context.tokens) : 0;

      // Phone — highest confidence from GBP
      const phone = nationalPhone ?? intlPhone;
      if (phone && isLikelyPhone(phone)) {
        candidates.push({
          field: "phone",
          value: phone,
          confidence: clamp(0.92 + nameCoverage * 0.06, 0.92, 0.98),
          source: "google_places",
          sourceUrl: mapsUri ?? undefined,
          reason: `GBP phone for "${displayName ?? context.businessName}" (${Math.round(nameCoverage * 100)}% name match)`,
        });
      }

      // Address
      const address = formattedAddress ?? shortAddress;
      if (address) {
        candidates.push({
          field: "address",
          value: address,
          confidence: clamp(0.92 + nameCoverage * 0.06, 0.92, 0.98),
          source: "google_places",
          sourceUrl: mapsUri ?? undefined,
          reason: `GBP address for "${displayName ?? context.businessName}"`,
        });
      }

      const componentValue = (wanted: string[]) => {
        for (const component of addressComponents) {
          const types = (component.types as string[] | undefined) ?? [];
          if (wanted.some((type) => types.includes(type))) {
            return asString(component.longText as unknown) ?? asString(component.shortText as unknown);
          }
        }
        return null;
      };

      const suburb = componentValue(["sublocality_level_1", "sublocality", "locality"]);
      if (suburb) {
        candidates.push({
          field: "suburb",
          value: suburb,
          confidence: 0.94,
          source: "google_places",
          sourceUrl: mapsUri ?? undefined,
          reason: `suburb from GBP address components for "${displayName ?? context.businessName}"`,
        });
      }

      const country = componentValue(["country"]);
      if (country) {
        candidates.push({
          field: "country",
          value: country,
          confidence: 0.96,
          source: "google_places",
          sourceUrl: mapsUri ?? undefined,
          reason: `country from GBP address components for "${displayName ?? context.businessName}"`,
        });
      }

      // Website
      if (websiteUri) {
        const cleaned = cleanUrl(websiteUri);
        if (cleaned && isCanonicalWebsiteUrl(cleaned, context)) {
          candidates.push({
            field: "website_url",
            value: canonicalWebsiteValue(cleaned),
            confidence: 0.85,
            source: "google_places",
            sourceUrl: mapsUri ?? undefined,
            reason: `website from GBP listing for "${displayName ?? context.businessName}"`,
          });
        } else if (cleaned) {
          // Even if the URL does not pass canonical checks, record it at lower confidence
          // so direct_fetch (Tier 3) can crawl it.
          candidates.push({
            field: "website_url",
            value: canonicalWebsiteValue(cleaned),
            confidence: 0.68,
            source: "google_places",
            sourceUrl: mapsUri ?? undefined,
            reason: `website from GBP (does not pass canonical hostname check)`,
          });
        }
      }

      // Google Maps URL
      if (mapsUri && !isGenericGoogleMapsUrl(mapsUri, context)) {
        candidates.push({
          field: "google_maps_url",
          value: mapsUri,
          confidence: clamp(0.94 + nameCoverage * 0.04, 0.94, 0.98),
          source: "google_places",
          sourceUrl: mapsUri,
          reason: `GBP listing URL for "${displayName ?? context.businessName}"`,
        });
      }

      // Category from GBP
      if (!gbpCategory) {
        gbpCategory = primaryTypeDisplay ?? primaryType ?? null;
      }

      // Opening hours from GBP
      if (!openingHours && place.regularOpeningHours) {
        const hours = place.regularOpeningHours as Json;
        const weekdayDescriptions = hours.weekdayDescriptions as string[] | undefined;
        const periods = hours.periods as Json[] | undefined;
        if (weekdayDescriptions || periods) {
          openingHours = {
            weekday_descriptions: weekdayDescriptions ?? [],
            periods: periods ?? [],
            source: "google_places",
          };
        }
      }
    }

    // Category suggestion: use canonical inference combining name + GBP type
    if (!context.category) {
      const suggested = inferCanonicalCategory(context.businessName, gbpCategory);
      if (suggested) {
        candidates.push({
          field: "category",
          value: suggested,
          confidence: 0.88,
          source: "google_places",
          reason: `canonical category inferred from name + GBP type: ${gbpCategory}`,
        });
      }
    }

    // Fallback suburb extraction for providers that omit addressComponents.
    if (!candidates.some((candidate) => candidate.field === "suburb") && formattedAddressHasSuburb(places, context)) {
      const suburb = extractSuburbFromPlaces(places, context);
      if (suburb) {
        candidates.push({
          field: "suburb",
          value: suburb,
          confidence: 0.90,
          source: "google_places",
          reason: "suburb extracted from GBP formatted address",
        });
      }
    }

    // If primary query found no accepted candidates, try fallback queries
    const executedQueries = [query];
    if (candidates.length === 0 && fallbackQueries.length > 0) {
      for (const fbQuery of fallbackQueries.slice(0, 2)) {
        try {
          log("google_places_fallback_query", { query: fbQuery });
          const fbResponse = await fetch("https://places.googleapis.com/v1/places:searchText", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Goog-Api-Key": apiKey,
              "X-Goog-FieldMask": GOOGLE_PLACES_FIELD_MASK,
            },
            body: JSON.stringify({ textQuery: fbQuery }),
          });
          executedQueries.push(fbQuery);
          if (!fbResponse.ok) continue;
          const fbData = await fbResponse.json();
          const fbPlaces: Json[] = fbData.places ?? [];
          // Re-run the same candidate extraction loop for fallback results
          // (the name gate above will still reject non-matching results)
          for (const place of fbPlaces) {
            const fbPlaceId = asString(place.id as unknown);
            if (fbPlaceId && !placeIds.includes(fbPlaceId)) {
              placeIds.push(fbPlaceId);
              // Emit the place into the outer `places` array for suburb extraction
              places.push(place);
            }
            const fbDisplayName = (place.displayName as Json)?.text as string | undefined;
            const fbSig = nameSignatureFromContext(context);
            const fbAddr = asString(place.formattedAddress as unknown) ?? "";
            const fbLocality = localityAlignmentCheck(fbAddr, context);
            const fbPhone = asString(place.nationalPhoneNumber as unknown) ?? asString(place.internationalPhoneNumber as unknown);
            const fbDecision = evaluateCandidate(fbDisplayName ?? "", fbSig, {
              localityMatch: fbLocality,
              hasCorroboration: Boolean(fbPhone || asString(place.websiteUri as unknown)),
            });
            if (!fbDecision.accept) continue;
            const fbNameCoverage = fbDisplayName ? tokenCoverage(fbDisplayName, context.tokens) : 0;
            const fbMapsUri = asString(place.googleMapsUri as unknown);
            if (fbPhone && isLikelyPhone(fbPhone)) {
              candidates.push({ field: "phone", value: fbPhone, confidence: clamp(0.92 + fbNameCoverage * 0.06, 0.92, 0.98), source: "google_places", sourceUrl: fbMapsUri ?? undefined, reason: `GBP phone (fallback query) for "${fbDisplayName}"` });
            }
            if (fbAddr) {
              candidates.push({ field: "address", value: fbAddr, confidence: clamp(0.92 + fbNameCoverage * 0.06, 0.92, 0.98), source: "google_places", sourceUrl: fbMapsUri ?? undefined, reason: `GBP address (fallback query) for "${fbDisplayName}"` });
            }
            const fbWebsite = asString(place.websiteUri as unknown);
            if (fbWebsite) {
              const cleaned = cleanUrl(fbWebsite);
              if (cleaned && isCanonicalWebsiteUrl(cleaned, context)) {
                candidates.push({ field: "website_url", value: canonicalWebsiteValue(cleaned), confidence: 0.85, source: "google_places", sourceUrl: fbMapsUri ?? undefined, reason: `website from GBP fallback for "${fbDisplayName}"` });
              }
            }
            if (fbMapsUri && !isGenericGoogleMapsUrl(fbMapsUri, context)) {
              candidates.push({ field: "google_maps_url", value: fbMapsUri, confidence: clamp(0.94 + fbNameCoverage * 0.04, 0.94, 0.98), source: "google_places", sourceUrl: fbMapsUri, reason: `GBP listing URL (fallback) for "${fbDisplayName}"` });
            }
          }
          if (candidates.length > 0) break; // stop trying fallbacks once we have something
        } catch { /* non-fatal — primary result stands */ }
      }
    }

    const totalWallClockMs = Date.now() - startMs;

    return {
      result: { candidates, openingHours, gbpCategory, placeIds, query: executedQueries.join(" | ") },
      debug: {
        attempted: true,
        skip_reason: null,
        queries: executedQueries,
        candidates_found: candidates.length,
        wall_clock_ms: totalWallClockMs,
        provider_error: null,
        place_ids: placeIds,
      },
    };
  } catch (error) {
    const wallClockMs = Date.now() - startMs;
    return {
      result: null,
      debug: {
        attempted: true,
        skip_reason: null,
        queries: [query],
        candidates_found: 0,
        wall_clock_ms: wallClockMs,
        provider_error: errorMessage(error),
        place_ids: [],
      },
    };
  }
}

/** Check if any place result has an address containing recognized suburb/locality info. */
function formattedAddressHasSuburb(places: Json[], _context: DiscoveryContext): boolean {
  return places.some((p) => asString(p.formattedAddress as unknown) !== null);
}

/** Try to extract a suburb or locality name from the first Google Places result address. */
function extractSuburbFromPlaces(places: Json[], context: DiscoveryContext): string | null {
  for (const place of places) {
    const addr = asString(place.formattedAddress as unknown);
    if (!addr) continue;
    // Google formats NZ addresses as "123 Street, Suburb, City 0800, New Zealand"
    // Try to pick the second-to-last comma-separated segment (often the suburb/city).
    const parts = addr.split(",").map((s) => s.trim());
    if (parts.length >= 3) {
      // Remove country and postcode parts
      const withoutCountry = parts.filter(
        (p) => !/\bnew\s*zealand\b/i.test(p) && !/^\d{4}$/.test(p.trim()),
      );
      if (withoutCountry.length >= 2) {
        // The last meaningful part after removing number-prefixed street is often the locality.
        const candidate = withoutCountry[withoutCountry.length - 1];
        // Strip trailing postcode if present
        const clean = candidate.replace(/\s*\d{4}\s*$/, "").trim();
        if (clean.length >= 3) return clean;
      }
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tier 2: Exa Search API (NEW)
// ─────────────────────────────────────────────────────────────────────────────

type ExaSearchResult = {
  candidates: FieldCandidate[];
  reviewSignals: Json[];
  rejectedUrls: RejectedUrl[];
  queries: string[];
};

async function searchExa(
  context: DiscoveryContext,
  observedAt: string,
): Promise<{ result: ExaSearchResult | null; debug: TierDebug }> {
  const apiKey = Deno.env.get("EXA_API_KEY");
  if (!apiKey) {
    return {
      result: null,
      debug: { attempted: false, skip_reason: "api_key_missing", wall_clock_ms: 0 },
    };
  }

  const location = [context.suburb, context.region, context.country].filter(Boolean).join(" ");
  const queries = [
    `"${context.businessName}" ${location} official website`,
    `"${context.businessName}" ${location} official Facebook`,
    `"${context.businessName}" ${location} Google Maps`,
    `"${context.businessName}" ${location} contact phone email address`,
    `"${context.businessName}" ${location} reviews`,
  ];

  const startMs = Date.now();
  const candidates: FieldCandidate[] = [];
  const reviewSignals: Json[] = [];
  const rejectedUrls: RejectedUrl[] = [];
  const executedQueries: string[] = [];

  try {
    for (const query of queries) {
      executedQueries.push(query);

      const response = await fetch("https://api.exa.ai/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify({
          query,
          contents: {
            text: { maxCharacters: 8000 },
            highlights: { numSentences: 5 },
          },
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => "");
        log("exa_search_error", { query, status: response.status, body: errorBody.slice(0, 500) });
        continue;
      }

      const data = await response.json();
      const results: Json[] = data.results ?? [];

      for (const item of results) {
        const url = asString(item.url as unknown);
        const title = asString(item.title as unknown);
        const text = asString(item.text as unknown) ?? "";
        const highlights: string[] = (item.highlights as string[] | undefined) ?? [];
        const combinedText = [text, ...highlights].join(" ");

        if (!url) continue;
        const cleaned = cleanUrl(url);
        if (!cleaned) continue;

        // Classify the URL
        const field = classifyUrl(cleaned);
        if (!field) continue;

        const coverage = tokenCoverage(`${cleaned} ${title ?? ""} ${combinedText}`, context.tokens);
        const sourceType = sourceTypeForUrl(cleaned);
        const weakCitationSource = ["directory_citation", "marketplace_source", "review_source", "social_citation"].includes(sourceType);

        // Website candidates from Exa
        if (field === "website_url") {
          const rejection = canonicalUrlRejectionReason(cleaned, field, context);
          if (rejection) {
            const rej = rejectedUrl(cleaned, field, rejection, observedAt);
            if (rej) rejectedUrls.push(rej);
          } else {
            candidates.push({
              field: "website_url",
              value: canonicalWebsiteValue(cleaned),
              confidence: clamp(0.80 + coverage * 0.08, 0.80, 0.88),
              source: "exa_search",
              sourceUrl: cleaned,
              reason: `Exa result for "${query}" with ${Math.round(coverage * 100)}% token coverage`,
            });
          }
        }

        // Facebook candidates from Exa
        if (field === "facebook_url") {
          const facebookNameDecision = evaluateCandidate(`${title ?? ""} ${combinedText}`, nameSignatureFromContext(context), {
            localityMatch: localityAlignmentCheck(combinedText, context),
            hasCorroboration: Boolean(phoneFromText(combinedText) || addressFromText(combinedText)),
          });
          if (isCanonicalFacebookPageUrl(cleaned, context) || (isCanonicalFacebookPageUrl(cleaned) && facebookNameDecision.accept)) {
            candidates.push({
              field: "facebook_url",
              value: cleaned,
              confidence: clamp(0.75 + coverage * 0.10, 0.75, 0.85),
              source: "exa_search",
              sourceUrl: cleaned,
              reason: `Facebook page from Exa search with ${Math.round(coverage * 100)}% token coverage`,
            });
          } else {
            const rej = rejectedUrl(cleaned, field, "not_clean_facebook_page_url", observedAt);
            if (rej) rejectedUrls.push(rej);
          }
        }

        // Google Maps candidates from Exa
        if (field === "google_maps_url") {
          if (!isGenericGoogleMapsUrl(cleaned, context)) {
            candidates.push({
              field: "google_maps_url",
              value: cleaned,
              confidence: clamp(0.78 + coverage * 0.10, 0.78, 0.88),
              source: "exa_search",
              sourceUrl: cleaned,
              reason: `Google Maps result from Exa with ${Math.round(coverage * 100)}% token coverage`,
            });
          }
        }

        // Social URL candidates
        if (field === "social_url") {
          if (isCanonicalSocialProfileUrl(cleaned, context)) {
            candidates.push({
              field: "social_url",
              value: cleaned,
              confidence: clamp(0.75 + coverage * 0.10, 0.75, 0.85),
              source: "exa_search",
              sourceUrl: cleaned,
              reason: `social profile from Exa with ${Math.round(coverage * 100)}% token coverage`,
            });
          }
        }

        // Extract phone/email from Exa text content
        const phone = phoneFromText(combinedText);
        if (phone && isLikelyPhone(phone)) {
          candidates.push({
            field: "phone",
            value: phone,
            confidence: weakCitationSource ? clamp(0.64 + coverage * 0.08, 0.64, 0.72) : clamp(0.74 + coverage * 0.10, 0.74, 0.84),
            source: "exa_search",
            sourceUrl: cleaned,
            reason: `phone extracted from Exa result text (${title ?? cleaned})`,
          });
        }

        const email = emailFromText(combinedText);
        if (email && isLikelyEmail(email)) {
          candidates.push({
            field: "email",
            value: email,
            confidence: weakCitationSource ? clamp(0.64 + coverage * 0.08, 0.64, 0.72) : clamp(0.74 + coverage * 0.10, 0.74, 0.84),
            source: "exa_search",
            sourceUrl: cleaned,
            reason: `email extracted from Exa result text (${title ?? cleaned})`,
          });
        }

        // Extract address from Exa text
        const address = addressFromText(combinedText);
        if (address) {
          candidates.push({
            field: "address",
            value: address,
            confidence: weakCitationSource ? clamp(0.62 + coverage * 0.08, 0.62, 0.70) : clamp(0.72 + coverage * 0.08, 0.72, 0.80),
            source: "exa_search",
            sourceUrl: cleaned,
            reason: `address extracted from Exa result text`,
          });
        }

        if (sourceType === "review_source" || sourceType === "marketplace_source") {
          const signals = extractReviewSignals(combinedText, cleaned);
          for (const signal of signals) {
            (signal as Json).source_type = sourceType;
          }
          reviewSignals.push(...signals);
        }
      }
    }

    const wallClockMs = Date.now() - startMs;
    return {
      result: { candidates, reviewSignals, rejectedUrls: dedupeRejectedUrls(rejectedUrls), queries: executedQueries },
      debug: {
        attempted: true,
        skip_reason: null,
        queries: executedQueries,
        candidates_found: candidates.length,
        wall_clock_ms: wallClockMs,
        provider_error: null,
      },
    };
  } catch (error) {
    const wallClockMs = Date.now() - startMs;
    return {
      result: null,
      debug: {
        attempted: true,
        skip_reason: null,
        queries: executedQueries,
        candidates_found: candidates.length,
        wall_clock_ms: wallClockMs,
        provider_error: errorMessage(error),
      },
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tier 3: Direct Fetch + Crawl
// ─────────────────────────────────────────────────────────────────────────────

type DirectFetchResult = {
  candidates: FieldCandidate[];
  reviewSignals: Json[];
  operatingHistory: Json[];
  contactPathways: string[];
  rejectedUrls: RejectedUrl[];
  urlsProbed: string[];
  pagesReached: number;
  openingHours: OpeningHours | null;
};

/**
 * Tier 3: Given website URLs discovered by earlier tiers (or generated from
 * business name slugs), fetch the root page plus common contact subpages and
 * extract phone, email, address, social links, and opening hours from the HTML.
 */
async function directFetchAndCrawl(
  context: DiscoveryContext,
  existingCandidates: FieldCandidate[],
  observedAt: string,
  includeGeneratedUrls = true,
): Promise<{ result: DirectFetchResult; debug: TierDebug }> {
  const startMs = Date.now();

  // Gather website URLs from earlier tiers
  const websitesFromTiers = existingCandidates
    .filter((c) => c.field === "website_url" && c.confidence >= 0.60)
    .map((c) => c.value)
    .filter(Boolean);

  // Also generate domain name probes
  const generatedUrls = includeGeneratedUrls ? generatedWebsiteUrls(context) : [];

  // Combine, preferring tier-sourced URLs first, then generated
  const allBaseUrls = dedupe([...websitesFromTiers, ...generatedUrls]);

  // For each base URL, also try /contact, /about, /contact-us
  const contactSubpages = ["/contact", "/about", "/contact-us"];
  const urlsToProbe: string[] = [];

  for (const baseUrl of allBaseUrls.slice(0, 10)) {
    urlsToProbe.push(baseUrl);
    try {
      const parsed = new URL(baseUrl);
      for (const subpage of contactSubpages) {
        urlsToProbe.push(`${parsed.protocol}//${parsed.hostname}${subpage}`);
      }
    } catch {
      // invalid URL, skip subpages
    }
  }

  const deduped = dedupe(urlsToProbe).slice(0, 30);
  const candidates: FieldCandidate[] = [];
  const reviewSignals: Json[] = [];
  const operatingHistory: Json[] = [];
  const contactPathways: string[] = [];
  const rejectedUrls: RejectedUrl[] = [];
  let pagesReached = 0;
  let openingHours: OpeningHours | null = null;

  await Promise.all(
    deduped.map(async (url) => {
      const result = await fetchText(url);
      if (!result.ok) return;
      pagesReached++;

      const coverage = tokenCoverage(`${result.finalUrl} ${result.text}`, context.tokens);
      const hostCoverage = tokenCoverage(normalizedHost(result.finalUrl) ?? "", context.tokens);
      const confidence = clamp(0.68 + coverage * 0.18 + hostCoverage * 0.18, 0, 0.95);
      const sourceUrl = cleanUrl(result.finalUrl) ?? url;
      const websiteRejection = canonicalUrlRejectionReason(sourceUrl, "website_url", context);

      // Only add as a website candidate if this is a root page (not subpage)
      const isRootPage = (() => {
        try {
          const p = new URL(sourceUrl).pathname.replace(/\/+$/, "");
          return !p || p === "/";
        } catch { return false; }
      })();

      if (websiteRejection) {
        const rejected = rejectedUrl(sourceUrl, "website_url", websiteRejection, observedAt);
        if (rejected) rejectedUrls.push(rejected);
      } else if (confidence >= 0.72 && isRootPage) {
        candidates.push({
          field: "website_url",
          value: canonicalWebsiteValue(sourceUrl),
          confidence: clamp(confidence, 0.82, 0.90),
          source: "direct_fetch",
          sourceUrl,
          reason: `reachable site with ${Math.round(coverage * 100)}% page token coverage and ${Math.round(hostCoverage * 100)}% domain token coverage`,
        });
      }

      // Extract phone
      const phone = phoneFromText(result.text);
      if (phone) {
        candidates.push({
          field: "phone",
          value: phone,
          confidence: clamp(0.72 + coverage * 0.14, 0.72, 0.90),
          source: "website_html",
          sourceUrl,
          reason: `phone found on ${isRootPage ? "validated website" : "subpage"} (${sourceUrl})`,
        });
      }

      // Extract email
      const email = emailFromText(result.text);
      if (email) {
        candidates.push({
          field: "email",
          value: email,
          confidence: clamp(0.74 + coverage * 0.14, 0.74, 0.90),
          source: "website_html",
          sourceUrl,
          reason: `email found on ${isRootPage ? "validated website" : "subpage"} (${sourceUrl})`,
        });
      }

      // Extract address
      const address = addressFromText(result.text);
      if (address) {
        candidates.push({
          field: "address",
          value: address,
          confidence: clamp(0.72 + coverage * 0.12, 0.72, 0.88),
          source: "website_html",
          sourceUrl,
          reason: `address found on ${isRootPage ? "validated website" : "subpage"}`,
        });
      }

      // Extract Facebook and other social links from HTML
      for (const linkedUrl of urlsFromHtml(result.text)) {
        const field = classifyUrl(linkedUrl);
        if (!field || field === "website_url") continue;
        const rejection =
          field === "facebook_url" && isCanonicalFacebookPageUrl(linkedUrl)
            ? null
            : field === "social_url" && isCanonicalSocialProfileUrl(linkedUrl)
              ? null
              : canonicalUrlRejectionReason(linkedUrl, field, context);
        if (rejection) {
          const rejected = rejectedUrl(linkedUrl, field, rejection, observedAt);
          if (rejected) rejectedUrls.push(rejected);
          continue;
        }
        const linkedCoverage = tokenCoverage(linkedUrl, context.tokens);
        const linkedConfidence = clamp(0.7 + coverage * 0.08 + linkedCoverage * 0.1, 0, 0.90);
        const linkedHost = normalizedHost(linkedUrl) ?? "";
        candidates.push({
          field,
          value: linkedUrl,
          confidence: linkedConfidence,
          source: "website_link",
          sourceUrl: linkedUrl,
          reason: `${field.replace("_url", "")} URL linked from website${linkedHost ? ` (${linkedHost})` : ""}`,
        });
      }

      // Extract opening hours from HTML
      if (!openingHours) {
        openingHours = openingHoursFromText(result.text);
      }

      // Review signals, operating history, contact pathways
      reviewSignals.push(...extractReviewSignals(result.text, sourceUrl));
      const history = detectOperatingHistory(result.text);
      if (history) operatingHistory.push({ source_url: sourceUrl, ...history });
      contactPathways.push(...detectContactPathway(result.text));
    }),
  );

  const wallClockMs = Date.now() - startMs;

  return {
    result: {
      candidates,
      reviewSignals,
      operatingHistory,
      contactPathways: dedupe(contactPathways),
      rejectedUrls: dedupeRejectedUrls(rejectedUrls),
      urlsProbed: deduped,
      pagesReached,
      openingHours,
    },
    debug: {
      attempted: true,
      skip_reason: null,
      urls_probed: deduped,
      pages_reached: pagesReached,
      wall_clock_ms: wallClockMs,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tier 4: DuckDuckGo HTML (existing logic, preserved)
// ─────────────────────────────────────────────────────────────────────────────

async function discoverSearchCandidates(
  context: DiscoveryContext,
  observedAt: string,
): Promise<{ candidates: FieldCandidate[]; attempted: string[]; reviewSignals: Json[]; rejectedUrls: RejectedUrl[] }> {
  const queries = dedupe([
    [context.strippedName, context.suburb, context.region, context.country].filter(Boolean).join(" "),
    [context.strippedName, context.category, context.suburb, context.country].filter(Boolean).join(" "),
    [context.strippedName, "facebook", context.suburb, context.country].filter(Boolean).join(" "),
    [context.strippedName, "google maps", context.suburb, context.country].filter(Boolean).join(" "),
    [context.strippedName, "reviews", context.suburb, context.country].filter(Boolean).join(" "),
  ]).filter(Boolean);

  const attempted = queries.map((query) => `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`);
  const candidates: FieldCandidate[] = [];
  const reviewSignals: Json[] = [];
  const rejectedUrls: RejectedUrl[] = [];

  await Promise.all(
    attempted.map(async (url) => {
      const result = await fetchText(url);
      if (!result.ok) return;
      reviewSignals.push(...extractReviewSignals(result.text, result.finalUrl));

      const hrefMatches = [...result.text.matchAll(/href="([^"]+)"/gi)].map((match) => decodeDuckDuckGoUrl(match[1]));
      for (const href of dedupe(hrefMatches).slice(0, 30)) {
        const cleaned = cleanUrl(href);
        const field = cleaned ? classifyUrl(cleaned) : null;
        if (!field || !cleaned) continue;
        if (isSearchEngineInternalUrl(cleaned)) continue;

        const directory = isDirectoryHost(cleaned);
        const coverage = tokenCoverage(cleaned, context.tokens);
        const rejection = canonicalUrlRejectionReason(cleaned, field, context);
        if (rejection) {
          const rejected = rejectedUrl(cleaned, field, rejection, observedAt);
          if (rejected) rejectedUrls.push(rejected);
          continue;
        }
        if ((field === "facebook_url" || field === "google_maps_url" || field === "social_url") && coverage < 0.35) {
          const rejected = rejectedUrl(cleaned, field, "insufficient_business_name_match", observedAt);
          if (rejected) rejectedUrls.push(rejected);
          continue;
        }

        const base = field === "google_maps_url" ? 0.8 : field === "facebook_url" || field === "social_url" ? 0.78 : 0.7;
        const sourceType = sourceTypeForUrl(cleaned);
        const confidence = clamp(base + coverage * 0.2 - (["directory_citation", "social_citation", "marketplace_source", "review_source"].includes(sourceType) ? 0.18 : 0), 0, 0.95);
        candidates.push({
          field,
          value: field === "website_url" ? canonicalWebsiteValue(cleaned) : cleaned,
          confidence,
          source: ["official_website", "official_facebook_page", "official_social_profile", "google_business_profile"].includes(sourceType) ? "search_result" : sourceType,
          sourceUrl: cleaned,
          reason: `search result URL with ${Math.round(coverage * 100)}% token coverage${directory ? "; directory result discounted" : ""}`,
        });
      }
    }),
  );

  return { candidates, attempted, reviewSignals, rejectedUrls: dedupeRejectedUrls(rejectedUrls) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Candidate selection and field acceptance
// ─────────────────────────────────────────────────────────────────────────────

function bestCandidates(candidates: FieldCandidate[]) {
  const best: Partial<Record<FieldKey, FieldCandidate>> = {};
  for (const candidate of candidates) {
    const current = best[candidate.field];
    if (!current || candidate.confidence > current.confidence) best[candidate.field] = candidate;
  }
  return best;
}

function acceptedFieldsFrom(candidates: FieldCandidate[]) {
  const best = bestCandidates(candidates);
  const accepted: Partial<Record<FieldKey, string>> = {};
  const confidence: Json = {};
  const rejected: FieldCandidate[] = [];

  for (const candidate of candidates) {
    const threshold = fieldThresholds[candidate.field];
    if (best[candidate.field] === candidate && candidate.confidence >= threshold) {
      accepted[candidate.field] = candidate.value;
      confidence[candidate.field] = {
        score: round2(candidate.confidence),
        source: candidate.source,
        source_url: candidate.sourceUrl ?? null,
        reason: candidate.reason,
      };
    } else {
      rejected.push(candidate);
    }
  }

  return { accepted, confidence, rejected };
}

function hasCanonicalValue(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (typeof v === "number") return Number.isFinite(v);
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

export function effectiveFields(currentLead: Json, accepted: Partial<Record<FieldKey, string>>, _context: DiscoveryContext) {
  const acceptedFacebook = asString(accepted.facebook_url);
  const currentFacebook = asString(currentLead.facebook_url);
  const acceptedGoogleMaps = asString(accepted.google_maps_url);
  const currentGoogleMaps = asString(currentLead.google_maps_url);
  const effective: Record<Exclude<PatchableFieldKey, "opening_hours">, string | null> = {
    website_url: asString(accepted.website_url) ?? asString(currentLead.website_url),
    facebook_url: acceptedFacebook ?? currentFacebook,
    google_maps_url: acceptedGoogleMaps ?? currentGoogleMaps,
    phone: asString(accepted.phone) ?? asString(currentLead.phone),
    email: asString(accepted.email) ?? asString(currentLead.email),
    address: asString(accepted.address) ?? asString(currentLead.address),
    suburb: asString(accepted.suburb) ?? asString(currentLead.suburb),
    country: asString(accepted.country) ?? asString(currentLead.country),
    category: asString(accepted.category) ?? asString(currentLead.category),
  };
  return effective;
}

function meaningfulSignalCount(fields: Record<Exclude<PatchableFieldKey, "opening_hours">, string | null>) {
  return meaningfulFields.filter((field) => hasCanonicalValue(fields[field])).length;
}

// ─────────────────────────────────────────────────────────────────────────────
// Evidence, trust, confidence
// ─────────────────────────────────────────────────────────────────────────────

function evidenceClassFor(candidate: FieldCandidate, effective: Record<Exclude<PatchableFieldKey, "opening_hours">, string | null>): EvidenceClass {
  const weakSourceTypes = new Set(["directory_citation", "social_citation", "marketplace_source", "review_source"]);
  const candidateSourceType = classifySourceType(
    ["website_url", "facebook_url", "google_maps_url", "social_url"].includes(candidate.field)
      ? candidate.value
      : candidate.sourceUrl ?? null,
    candidate.source,
  );
  if (weakSourceTypes.has(candidateSourceType)) return "citation";
  if (candidate.field === "social_url") return "supporting";
  return asString(effective[candidate.field as Exclude<PatchableFieldKey, "opening_hours">])?.toLocaleLowerCase() === candidate.value.toLocaleLowerCase()
    ? "canonical"
    : "supporting";
}

function identityAlignmentFor(candidate: FieldCandidate, evidenceClass: EvidenceClass): Pick<Evidence, "identity_alignment" | "identity_reason"> {
  if (candidate.field !== "facebook_url" && candidate.field !== "social_url") return {};
  if (evidenceClass !== "canonical") {
    return {
      identity_alignment: "review_required",
      identity_reason: `Non-canonical social candidate retained as ${evidenceClass} evidence: ${candidate.reason}`,
    };
  }
  return candidate.confidence >= 0.82
    ? { identity_alignment: "strong_alignment", identity_reason: `Accepted canonical profile with high confidence: ${candidate.reason}` }
    : { identity_alignment: "moderate_alignment", identity_reason: `Accepted canonical profile above threshold: ${candidate.reason}` };
}

export function evidenceFrom(
  candidates: FieldCandidate[],
  rejectedUrls: RejectedUrl[],
  effective: Record<Exclude<PatchableFieldKey, "opening_hours">, string | null>,
  observedAt: string,
) {
  const candidateRows = candidates
    .filter((candidate) => candidate.confidence >= 0.7 || candidate.source === "payload")
    .sort((a, b) => b.confidence - a.confidence)
    .map((candidate): Evidence => {
      const sourceUrl = candidate.sourceUrl ?? (candidate.value.startsWith("http") ? candidate.value : "payload");
      const classifiedUrl = ["website_url", "facebook_url", "google_maps_url", "social_url"].includes(candidate.field)
        ? candidate.value
        : sourceUrl;
      const evidenceClass = evidenceClassFor(candidate, effective);
      return {
        source_url: sourceUrl,
        source_type: classifySourceType(classifiedUrl === "payload" ? null : classifiedUrl, candidate.source),
        source_provider: candidate.source,
        evidence_class: evidenceClass,
        field_name: candidate.field,
        field_value: candidate.value,
        confidence: round2(candidate.confidence),
        observed_at: observedAt,
        ...identityAlignmentFor(candidate, evidenceClass),
      };
    });

  const rejectedRows = rejectedUrls.map((item): Evidence => ({
    source_url: item.url,
    source_type: item.source_type,
    source_provider: "rejected_candidate",
    evidence_class: "rejected",
    field_name: item.field,
    field_value: item.url,
    confidence: 0.35,
    observed_at: item.observed_at,
    rejection_reason: item.reason,
    ...(item.field === "facebook_url" || item.field === "social_url"
      ? { identity_alignment: "review_required" as const, identity_reason: `Rejected social identity candidate: ${item.reason}` }
      : {}),
  }));

  return [...new Map(
    [
      ...candidateRows.slice(0, 60),
      ...rejectedRows.slice(0, 20),
    ]
      .map((row) => {
        const canonicalKey = row.evidence_class === "canonical"
          ? `${row.evidence_class}:${row.field_name}:${row.field_value.toLocaleLowerCase()}`
          : `${row.evidence_class}:${row.field_name}:${row.field_value.toLocaleLowerCase()}:${row.source_url.toLocaleLowerCase()}`;
        return [canonicalKey, row];
      }),
  ).values()];
}

function inferAlignmentStatus(evidence: Evidence[], riskFlags: string[]): EnrichmentResult["data_alignment_status"] {
  if (riskFlags.some((flag) => flag.startsWith("conflicting_"))) return "conflicting";
  const highConfidenceFields = new Set(evidence.filter((item) => item.confidence >= 0.82).map((item) => item.field_name));
  if (!hasStrongAnchorEvidence(evidence)) return "insufficient_evidence";
  if (highConfidenceFields.has("website_url") && highConfidenceFields.has("phone") && (highConfidenceFields.has("address") || highConfidenceFields.has("google_maps_url"))) return "strong_alignment";
  if (highConfidenceFields.size >= 2) return "partial_alignment";
  return "insufficient_evidence";
}

function assessTrust(args: {
  businessName: string;
  effective: Record<Exclude<PatchableFieldKey, "opening_hours">, string | null>;
  accepted: Partial<Record<FieldKey, string>>;
  evidence: Evidence[];
  reviewSignals: Json[];
  operatingHistory: Json[];
  contactPathways: string[];
}) {
  const trustSignals: string[] = [];
  const riskFlags: string[] = [];
  let score = 35;

  const website = args.effective.website_url;
  const email = args.effective.email;
  const websiteHost = normalizedHost(website);
  const emailHost = email?.split("@")[1]?.toLowerCase() ?? null;
  const hasOfficialWebsiteEvidence = args.evidence.some((item) =>
    item.field_name === "website_url" &&
    item.evidence_class === "canonical" &&
    item.source_type === "official_website" &&
    item.confidence >= 0.72
  );

  // GBP-verified signals boost trust
  const hasGbpEvidence = args.evidence.some((item) => item.source_type === "google_business_profile" || item.source_provider === "google_places");
  if (hasGbpEvidence) {
    score += 10;
    trustSignals.push("gbp_verified");
  }

  if (website) {
    score += hasOfficialWebsiteEvidence ? 18 : 12;
    trustSignals.push(hasOfficialWebsiteEvidence ? "official_website" : "website_present");
    if (website.startsWith("https://")) {
      score += 5;
      trustSignals.push("secure_website");
    } else {
      riskFlags.push("missing_https");
      score -= 3;
    }
  } else {
    riskFlags.push("missing_website");
    score -= 12;
  }

  if (args.effective.phone) {
    score += 10;
    trustSignals.push("phone_present");
  } else {
    riskFlags.push("missing_phone");
    score -= 5;
  }

  if (args.effective.address) {
    score += 9;
    trustSignals.push("address_present");
  }

  if (args.effective.google_maps_url) {
    score += 12;
    trustSignals.push("google_business_presence");
  } else {
    riskFlags.push("missing_google_profile");
  }

  if (args.effective.facebook_url) {
    score += 5;
    trustSignals.push("facebook_presence");
  } else {
    riskFlags.push("missing_facebook_page");
  }

  if (email) {
    score += 6;
    if (websiteHost && emailHost && (emailHost === websiteHost || emailHost.endsWith(`.${websiteHost}`))) {
      score += 7;
      trustSignals.push("domain_email");
    } else if (/gmail\.com|hotmail\.com|outlook\.com|yahoo\.com|xtra\.co\.nz/i.test(emailHost ?? "")) {
      riskFlags.push("free_or_legacy_email");
      score -= 3;
    }
  } else {
    riskFlags.push("missing_email");
  }

  if (args.reviewSignals.length > 0) {
    score += 8;
    trustSignals.push("review_presence");
  } else {
    riskFlags.push("weak_review_profile");
  }

  if (args.operatingHistory.length > 0) {
    score += 6;
    trustSignals.push("operating_history");
  }

  if (args.contactPathways.length > 0) {
    score += 5;
    trustSignals.push("clear_contact_pathway");
  } else if (website) {
    riskFlags.push("weak_contact_pathway");
  }

  const dataAlignmentStatus = inferAlignmentStatus(args.evidence, riskFlags);
  if (dataAlignmentStatus === "strong_alignment") score += 8;
  if (dataAlignmentStatus === "insufficient_evidence") score -= 8;

  const trustScore = clamp(Math.round(score), 0, 100);
  const trustSummary =
    dataAlignmentStatus === "strong_alignment"
      ? "Strong real-world business credibility from corroborated identity/contact signals; digital maturity depends on website, review, and conversion-path depth."
      : dataAlignmentStatus === "partial_alignment"
        ? "Partial business identity alignment. Enough signal for operational review, but missing or weak fields should be verified before outreach."
        : dataAlignmentStatus === "conflicting"
          ? "Conflicting deterministic signals detected; manual verification recommended before promotion or outreach."
          : "Insufficient deterministic evidence. Treat this lead as unverified until official sources or contact pathways are confirmed.";

  return { trustScore, trustSummary, trustSignals: dedupe(trustSignals), riskFlags: dedupe(riskFlags), dataAlignmentStatus };
}

function confidenceScoreFrom(confidence: Json) {
  const scores = Object.values(confidence)
    .map((value) => (value && typeof value === "object" && "score" in value ? Number((value as { score?: unknown }).score) : NaN))
    .filter(Number.isFinite);
  if (scores.length === 0) return 0;
  return Math.round((scores.reduce((sum, score) => sum + score, 0) / scores.length) * 100);
}

function evidenceClassRank(value: EvidenceClass) {
  return { canonical: 4, supporting: 3, citation: 2, rejected: 1 }[value];
}

export function sourceUrlsFrom(evidence: Evidence[]): SourceUrl[] {
  const byUrl = new Map<string, SourceUrl>();

  for (const item of evidence) {
    const evidenceUrl = ["website_url", "facebook_url", "google_maps_url", "social_url"].includes(item.field_name)
      ? item.field_value
      : item.source_url;
    const decoded = decodeDuckDuckGoUrl(evidenceUrl);
    if (!decoded || decoded === "payload") continue;
    const cleaned = cleanUrl(decoded);
    if (!cleaned) continue;
    const key = cleaned.toLocaleLowerCase();
    const existing = byUrl.get(key);
    if (existing) {
      existing.fields = dedupeStrings([...existing.fields, item.field_name]);
      existing.confidence = Math.max(existing.confidence, item.confidence);
      if (evidenceClassRank(item.evidence_class) > evidenceClassRank(existing.evidence_class)) {
        existing.evidence_class = item.evidence_class;
      }
    } else {
      byUrl.set(key, {
        url: cleaned,
        source_type: classifySourceType(cleaned, item.source_type),
        evidence_class: item.evidence_class,
        fields: [item.field_name],
        confidence: item.confidence,
      });
    }
  }

  return [...byUrl.values()].sort((a, b) =>
    evidenceClassRank(b.evidence_class) - evidenceClassRank(a.evidence_class) ||
    b.confidence - a.confidence
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Enrichment result builder
// ─────────────────────────────────────────────────────────────────────────────

function buildEnrichmentResult(args: {
  businessName: string;
  effective: Record<Exclude<PatchableFieldKey, "opening_hours">, string | null>;
  accepted: Partial<Record<FieldKey, string>>;
  confidence: Json;
  candidates: FieldCandidate[];
  reviewSignals: Json[];
  operatingHistory: Json[];
  contactPathways: string[];
  rejectedUrls: RejectedUrl[];
  observedAt: string;
}): EnrichmentResult {
  const evidence = evidenceFrom(args.candidates, args.rejectedUrls, args.effective, args.observedAt);
  const trust = assessTrust({ ...args, evidence });
  const sourceUrls = sourceUrlsFrom(evidence);
  const categories = dedupeStrings([args.effective.category].filter((value): value is string => Boolean(value)));
  const serviceAreas = dedupeStrings([args.effective.suburb].filter((value): value is string => Boolean(value)));
  const acceptedSocialEvidence = evidence.filter((item) =>
    item.evidence_class === "canonical" &&
    ["official_social_profile", "official_facebook_page"].includes(item.source_type) &&
    item.confidence >= fieldThresholds.social_url
  );
  const facebookEvidence = evidence.find((item) => item.field_name === "facebook_url" && item.evidence_class === "canonical");
  const socialLinks: Json[] = [
    args.effective.facebook_url
      ? {
          platform: "facebook",
          url: args.effective.facebook_url,
          source_url: evidence.find((item) => item.field_name === "facebook_url" && item.field_value === args.effective.facebook_url)?.source_url ?? args.effective.facebook_url,
        }
      : null,
    args.effective.google_maps_url
      ? {
          platform: "google_business_profile",
          url: args.effective.google_maps_url,
          source_url: evidence.find((item) => item.field_name === "google_maps_url" && item.field_value === args.effective.google_maps_url)?.source_url ?? args.effective.google_maps_url,
        }
      : null,
    ...acceptedSocialEvidence
      .filter((item) => item.field_name === "social_url" || item.field_name === "facebook_url")
      .map((item) => ({
        platform: canonicalSocialPlatform(item.field_value),
        url: item.field_value,
        source_url: item.source_url,
      })),
  ]
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .map((item) => item as Json);

  return {
    business_name: args.businessName,
    address: args.effective.address,
    phone: args.effective.phone,
    email: args.effective.email,
    website: args.effective.website_url,
    social_links: [...new Map(socialLinks.map((item) => [String(item.url).toLocaleLowerCase(), item])).values()],
    service_areas: serviceAreas,
    categories,
    review_signals: [...new Map(args.reviewSignals.map((item) => [JSON.stringify(item).toLocaleLowerCase(), item])).values()],
    trust_signals: dedupeStrings(trust.trustSignals),
    risk_flags: dedupeStrings(trust.riskFlags),
    source_urls: sourceUrls,
    confidence_score: confidenceScoreFrom(args.confidence),
    trust_score: trust.trustScore,
    trust_summary: trust.trustSummary,
    data_alignment_status: trust.dataAlignmentStatus,
    identity_alignment: {
      facebook: {
        status: facebookEvidence?.identity_alignment ?? (args.effective.facebook_url ? "review_required" : "review_required"),
        url: args.effective.facebook_url,
        reason: facebookEvidence?.identity_reason ?? (args.effective.facebook_url
          ? "Facebook URL is present but canonical identity evidence was not retained."
          : "No accepted Facebook identity is available."),
      },
    },
    evidence,
    rejected_urls: args.rejectedUrls,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Scoring
// ─────────────────────────────────────────────────────────────────────────────

function score(fields: Record<Exclude<PatchableFieldKey, "opening_hours">, string | null>, result: EnrichmentResult) {
  const signals = meaningfulSignalCount(fields);
  const demand = fields.category ? 72 : 52;
  const trustLeakage = clamp(100 - result.trust_score + (fields.website_url?.startsWith("https://") ? 0 : 6), 10, 90);
  const conversion = fields.website_url ? (result.trust_signals.includes("clear_contact_pathway") ? 74 : 62) : fields.facebook_url || fields.google_maps_url ? 48 : 34;
  const aiReadiness = fields.website_url && result.confidence_score >= 75 ? 70 : fields.website_url ? 60 : fields.facebook_url || fields.google_maps_url ? 48 : 32;
  const opportunity = Math.round((demand + (100 - trustLeakage) + conversion + aiReadiness) / 4);

  return {
    demand_signal_score: demand,
    trust_leakage_score: trustLeakage,
    conversion_maturity_score: conversion,
    ai_readiness_score: aiReadiness,
    opportunity_score: opportunity,
    recommended_outreach_angle:
      trustLeakage > 50 ? "Fix trust leakage: profile + proof + conversion path" : "Scale demand capture from current trust base",
    assessment_summary: `Assessed after enrichment found ${signals} operational signal(s). Alignment ${result.data_alignment_status}; trust ${result.trust_score}; website ${
      fields.website_url ? "present" : "missing"
    }; maps ${fields.google_maps_url ? "present" : "missing"}.`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Event emission
// ─────────────────────────────────────────────────────────────────────────────

async function insertEvent(
  supabase: SupabaseClientLike,
  args: {
    eventType: string;
    leadId: string;
    businessName: string;
    payload?: Json;
    status?: string;
  },
) {
  log("event_insert_attempt", { event_type: args.eventType, lead_id: args.leadId });
  const riskAssertions =
    args.eventType.endsWith(".failed") || args.eventType.endsWith("_failed") ? ["rejection", "processing"] :
    args.eventType.endsWith(".started") || args.eventType.endsWith(".requested") ? ["input"] :
    args.eventType.includes("trust_assessed") || args.eventType.endsWith(".assessed") ? ["processing"] :
    ["input", "processing"];

  const { data, error } = await supabase
    .from("events")
    .insert({
      event_type: args.eventType,
      source_system: "local-business-enrich",
      entity_type: "local_business",
      entity_id: args.leadId,
      entity_ref: args.businessName,
      status: args.status ?? "created",
      payload: args.payload ?? {},
      risk_category: "business_process",
      risk_assertions: riskAssertions,
      risk_version: "risk-map-v1",
      created_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) throw new Error(`${args.eventType} insert failed: ${error.message}`);
  return data.id as string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth and lead resolution
// ─────────────────────────────────────────────────────────────────────────────

async function getAuthContext(supabase: SupabaseClientLike, req: Request) {
  const authHeader = req.headers.get("Authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "");

  if (!token) return { has_authorization_header: false, user_id: null, auth_error: null };

  const { data, error } = await supabase.auth.getUser(token);
  return {
    has_authorization_header: true,
    user_id: data.user?.id ?? null,
    auth_error: error?.message ?? null,
  };
}

async function resolveLead(supabase: SupabaseClientLike, body: Json) {
  const sourceEventId = asString(body.event_id) ?? asString(body.source_event_id);
  let leadId = asString(body.lead_id);
  let sourcePayload: Json = {};
  let sourceMetadata: Json = {};

  if (sourceEventId) {
    const { data: eventRow, error } = await supabase
      .from("events")
      .select("id,event_type,entity_id,entity_ref,payload,metadata")
      .eq("id", sourceEventId)
      .single();

    if (error || !eventRow) throw new Error(`source_event_not_found: ${error?.message ?? sourceEventId}`);

    sourcePayload = ((eventRow.payload as Json | null) ?? {}) as Json;
    sourceMetadata = ((eventRow.metadata as Json | null) ?? {}) as Json;
    const businessName = asString(sourcePayload.business_name) ?? asString(sourcePayload.name) ?? asString(eventRow.entity_ref) ?? "Unknown Business";

    leadId = leadId ?? asString(eventRow.entity_id);
    if (!leadId) {
      const { data: existing, error: existingError } = await supabase.from("local_business_leads").select("id").eq("business_name", businessName).maybeSingle();
      if (existingError) throw new Error(`lead_lookup_failed: ${existingError.message}`);
      if (existing?.id) leadId = existing.id;
    }

    if (!leadId) {
      const { data: inserted, error: insertError } = await supabase
        .from("local_business_leads")
        .insert({ business_name: businessName, status: "discovered", source: "local_business.discovered" })
        .select("id")
        .single();
      if (insertError || !inserted) throw new Error(`lead_create_failed: ${insertError?.message ?? "no inserted row"}`);
      leadId = inserted.id;
    }
  }

  if (!leadId) throw new Error("missing_lead_id");

  const { data: lead, error: leadError } = await supabase
    .from("local_business_leads")
    .select(
      "id,business_name,category,suburb,region,country,address,phone,email,website_url,facebook_url,google_maps_url,social_links,service_areas,categories,review_signals,trust_signals,risk_flags,source_urls,confidence_score,trust_score,trust_signal_score,trust_summary,trust_flags,data_alignment_status,enrichment_status,enrichment_confidence,enrichment_diagnostics,status,source,notes,opening_hours",
    )
    .eq("id", leadId)
    .single();

  if (leadError || !lead) throw new Error(`lead_not_found: ${leadError?.message ?? leadId}`);

  const sourceData = { ...sourceMetadata, ...sourcePayload } as Json;
  for (const [key, value] of Object.entries(lead as Json)) {
    if (hasCanonicalValue(value)) sourceData[key] = value;
  }

  return {
    leadId,
    businessName: lead.business_name as string,
    lead: lead as Json,
    sourceEventId,
    sourcePayload: sourceData,
    sourceMetadata,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tiered discovery pipeline (NEW — replaces old runDiscovery)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Count the number of distinct meaningful field keys among candidates that
 * meet minimum confidence thresholds.
 */
function countMeaningfulCandidateFields(candidates: FieldCandidate[]): number {
  const found = new Set<string>();
  for (const c of candidates) {
    if (meaningfulFields.includes(c.field as any) && c.confidence >= (fieldThresholds[c.field] ?? 0.70)) {
      found.add(c.field);
    }
  }
  return found.size;
}

export function hasStrongAnchorEvidence(evidence: Evidence[]) {
  return evidence.some((item) =>
    item.evidence_class === "canonical" &&
    item.confidence >= 0.82 &&
    (
      item.field_name === "address" ||
      (item.field_name === "website_url" && ["official_website", "payload"].includes(item.source_type)) ||
      (item.field_name === "facebook_url" && ["official_facebook_page", "payload"].includes(item.source_type))
    )
  );
}

function missingCoverageFields(candidates: FieldCandidate[]) {
  const accepted = acceptedFieldsFrom(candidates).accepted;
  const coverageFields: FieldKey[] = [
    "address",
    "suburb",
    "country",
    "category",
    "website_url",
    "facebook_url",
    "google_maps_url",
    "phone",
    "email",
  ];
  return coverageFields.filter((field) => !hasCanonicalValue(accepted[field]));
}

async function runTieredDiscovery(raw: Json, businessName: string, observedAt: string) {
  const context = contextFrom(raw, businessName);
  const direct = directCandidates(raw, context);
  const generated = generatedLookupCandidates(context);

  // Running tallies across tiers
  let allCandidates: FieldCandidate[] = [...direct];
  let allReviewSignals: Json[] = [];
  let allOperatingHistory: Json[] = [];
  let allContactPathways: string[] = [];
  let allRejectedUrls: RejectedUrl[] = [];
  let openingHours: OpeningHours | null = null;
  let searchTierReached = "payload";
  const totalStartMs = Date.now();

  // Tier debug accumulators
  const tierDebug: EnrichmentDebug["tiers"] = {
    google_places: { attempted: false, skip_reason: "not_reached", wall_clock_ms: 0 },
    exa: { attempted: false, skip_reason: "not_reached", wall_clock_ms: 0 },
    direct_fetch: { attempted: false, skip_reason: "not_reached", wall_clock_ms: 0 },
    duckduckgo: { attempted: false, skip_reason: "not_reached", wall_clock_ms: 0 },
  };

  // ── Tier 1: Google Places ──────────────────────────────────────────────
  log("tier_start", { tier: "google_places", business_name: businessName });
  const googleResult = await searchGooglePlaces(context, observedAt, raw);
  tierDebug.google_places = googleResult.debug;

  if (googleResult.result) {
    allCandidates.push(...googleResult.result.candidates);
    if (googleResult.result.openingHours) openingHours = googleResult.result.openingHours;
    searchTierReached = "google_places";
    log("tier_complete", {
      tier: "google_places",
      candidates: googleResult.result.candidates.length,
      place_ids: googleResult.result.placeIds,
    });
  }

  // ── Tier 2: Exa Search ────────────────────────────────────────────────
  // Keep searching while priority audit fields are missing. Two fields are not
  // enough coverage for a credible trust audit.
  if (missingCoverageFields(allCandidates).some((field) => ["website_url", "facebook_url", "email", "address"].includes(field))) {
    log("tier_start", { tier: "exa", business_name: businessName });
    const exaResult = await searchExa(context, observedAt);
    tierDebug.exa = exaResult.debug;

    if (exaResult.result) {
      allCandidates.push(...exaResult.result.candidates);
      allReviewSignals.push(...exaResult.result.reviewSignals);
      allRejectedUrls.push(...exaResult.result.rejectedUrls);
      if (!searchTierReached || searchTierReached === "payload") searchTierReached = "exa";
      log("tier_complete", {
        tier: "exa",
        candidates: exaResult.result.candidates.length,
        queries: exaResult.result.queries,
      });
    }
  } else {
    tierDebug.exa = { attempted: false, skip_reason: "sufficient_candidates_from_earlier_tiers", wall_clock_ms: 0 };
  }

  // ── Tier 3: Direct Fetch + Crawl ──────────────────────────────────────
  // Always run this tier to extract phone/email/hours from discovered websites
  log("tier_start", { tier: "direct_fetch", business_name: businessName });
  const directFetchResult = await directFetchAndCrawl(context, allCandidates, observedAt);
  tierDebug.direct_fetch = directFetchResult.debug;

  allCandidates.push(...directFetchResult.result.candidates);
  allReviewSignals.push(...directFetchResult.result.reviewSignals);
  allOperatingHistory.push(...directFetchResult.result.operatingHistory);
  allContactPathways.push(...directFetchResult.result.contactPathways);
  allRejectedUrls.push(...directFetchResult.result.rejectedUrls);
  if (!openingHours && directFetchResult.result.openingHours) {
    openingHours = directFetchResult.result.openingHours;
  }
  if (directFetchResult.result.pagesReached > 0 && (!searchTierReached || searchTierReached === "payload")) {
    searchTierReached = "direct_fetch";
  }
  log("tier_complete", {
    tier: "direct_fetch",
    candidates: directFetchResult.result.candidates.length,
    pages_reached: directFetchResult.result.pagesReached,
  });

  // ── Tier 4: DuckDuckGo HTML (FALLBACK) ────────────────────────────────
  // Search for remaining canonical/contact gaps even when GBP already supplied
  // phone + Maps. This is the common path for finding Facebook and email.
  if (missingCoverageFields(allCandidates).some((field) => ["website_url", "facebook_url", "google_maps_url", "phone", "email", "address"].includes(field))) {
    log("tier_start", { tier: "duckduckgo", business_name: businessName });
    const ddgStartMs = Date.now();
    const searchDiscovery = await discoverSearchCandidates(context, observedAt);
    const ddgWallClockMs = Date.now() - ddgStartMs;

    tierDebug.duckduckgo = {
      attempted: true,
      skip_reason: null,
      queries: searchDiscovery.attempted,
      candidates_found: searchDiscovery.candidates.length,
      wall_clock_ms: ddgWallClockMs,
      provider_error: null,
    };

    allCandidates.push(...searchDiscovery.candidates);
    allReviewSignals.push(...searchDiscovery.reviewSignals);
    allRejectedUrls.push(...searchDiscovery.rejectedUrls);
    if (!searchTierReached || searchTierReached === "payload") searchTierReached = "duckduckgo";

    log("tier_complete", {
      tier: "duckduckgo",
      candidates: searchDiscovery.candidates.length,
    });

    // Websites first discovered by fallback search must be crawled in the same
    // run so contact details and linked official profiles are not deferred.
    if (searchDiscovery.candidates.some((candidate) => candidate.field === "website_url")) {
      const fallbackCrawl = await directFetchAndCrawl(context, searchDiscovery.candidates, observedAt, false);
      allCandidates.push(...fallbackCrawl.result.candidates);
      allReviewSignals.push(...fallbackCrawl.result.reviewSignals);
      allOperatingHistory.push(...fallbackCrawl.result.operatingHistory);
      allContactPathways.push(...fallbackCrawl.result.contactPathways);
      allRejectedUrls.push(...fallbackCrawl.result.rejectedUrls);
      if (!openingHours && fallbackCrawl.result.openingHours) openingHours = fallbackCrawl.result.openingHours;
      tierDebug.direct_fetch = {
        ...tierDebug.direct_fetch,
        urls_probed: dedupe([...(tierDebug.direct_fetch.urls_probed ?? []), ...(fallbackCrawl.debug.urls_probed ?? [])]),
        pages_reached: (tierDebug.direct_fetch.pages_reached ?? 0) + (fallbackCrawl.debug.pages_reached ?? 0),
        wall_clock_ms: tierDebug.direct_fetch.wall_clock_ms + fallbackCrawl.debug.wall_clock_ms,
      };
    }
  } else {
    tierDebug.duckduckgo = { attempted: false, skip_reason: "sufficient_candidates_from_earlier_tiers", wall_clock_ms: 0 };
  }

  // Always append generated lookup candidates (low-confidence fallbacks)
  allCandidates.push(...generated);

  // Deduplicate rejected URLs
  allRejectedUrls = dedupeRejectedUrls(allRejectedUrls);
  allContactPathways = dedupe(allContactPathways);

  const { accepted, confidence, rejected } = acceptedFieldsFrom(allCandidates);

  const totalWallClockMs = Date.now() - totalStartMs;

  // Build the enrichment_debug JSON
  const selectedFields: Json = {};
  for (const [field, value] of Object.entries(accepted)) {
    const conf = confidence[field] as Json | undefined;
    selectedFields[field] = {
      value,
      confidence: conf ? (conf as any).score : null,
      source: conf ? (conf as any).source : null,
      source_url: conf ? (conf as any).source_url : null,
      reason: conf ? (conf as any).reason : null,
    };
  }

  const enrichmentDebugCore: Omit<EnrichmentDebug, "persistence_result"> = {
    schema_version: "enrichment-v2",
    observed_at: observedAt,
    identity: {
      business_name: businessName,
      normalized_name: context.normalizedName,
      tokens: context.tokens,
      suburb: context.suburb,
      category_hint: context.category,
    },
    tiers: tierDebug,
    all_candidates: allCandidates.map((c) => ({ ...c, confidence: round2(c.confidence) })),
    rejected_candidates: rejected
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 20)
      .map((c) => ({ ...c, confidence: round2(c.confidence) })),
    selected_fields: selectedFields,
    search_tier_reached: searchTierReached,
    total_wall_clock_ms: totalWallClockMs,
    status: "pending",
  };

  // Legacy diagnostics shape (for backward compatibility with existing lead column)
  const diagnostics: Json = {
    schema_version: "enrichment-v2",
    observed_at: observedAt,
    fields_attempted: [...meaningfulFields, "address", "opening_hours"],
    fields_found: Object.keys(accepted),
    confidence,
    lookup_candidates: {
      normalized_name: context.normalizedName,
      stripped_name: context.strippedName,
      tokens: context.tokens,
      search_tier_reached: searchTierReached,
      tier_debug: tierDebug,
      generated_lookup_urls: generated.map((candidate) => candidate.value),
    },
    accepted_candidates: Object.fromEntries(
      Object.entries(bestCandidates(allCandidates))
        .filter(([field, candidate]) => candidate.confidence >= fieldThresholds[field as FieldKey])
        .map(([field, candidate]) => [field, { ...candidate, confidence: round2(candidate.confidence) }]),
    ),
    rejected_candidates: rejected
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 12)
      .map((candidate) => ({ ...candidate, confidence: round2(candidate.confidence) })),
    rejected_urls: allRejectedUrls.slice(0, 80),
    review_signals: allReviewSignals,
    operating_history: allOperatingHistory,
    contact_pathways: allContactPathways,
  };

  return {
    context,
    candidates: allCandidates,
    accepted,
    confidence,
    rejected,
    reviewSignals: allReviewSignals,
    operatingHistory: allOperatingHistory,
    contactPathways: allContactPathways,
    diagnostics,
    rejectedUrls: allRejectedUrls,
    openingHours,
    searchTierReached,
    enrichmentDebugCore,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Soft-fail handler: emit failure event without touching canonical fields
// ─────────────────────────────────────────────────────────────────────────────

async function handleSearchFailure(
  supabase: SupabaseClientLike,
  leadId: string,
  businessName: string,
  status: "search_unavailable" | "search_blocked" | "zero_candidates",
  enrichmentDebug: Json,
  startedEventId: string | null,
  sourceEventId: string | null,
) {
  const retryable = status !== "zero_candidates";

  // Do NOT touch canonical fields. Only update enrichment_status and diagnostics.
  await supabase
    .from("local_business_leads")
    .update({
      enrichment_status: "failed",
      enrichment_diagnostics: enrichmentDebug,
    })
    .eq("id", leadId);

  const failurePayload: Json = {
    status,
    retryable,
    enrichment_debug: enrichmentDebug,
    lead_id: leadId,
    started_event_id: startedEventId,
    source_event_id: sourceEventId,
  };

  let failureEventId: string | null = null;
  try {
    failureEventId = await insertEvent(supabase, {
      eventType: "local_business.enrichment_failed",
      leadId,
      businessName,
      status: "failed",
      payload: failurePayload,
    });
  } catch (err) {
    log("failure_event_insert_failed", { lead_id: leadId, error: errorMessage(err) });
  }

  return failureEventId;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main request handler
// ─────────────────────────────────────────────────────────────────────────────

export async function handler(req: Request) {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ ok: false, status: "failed", error: "method_not_allowed" }, 405);

  const supabase = createSupabaseAdmin();
  const body = (await req.json().catch(() => ({}))) as Json;
  const authContext = await getAuthContext(supabase, req);
  let leadId: string | null = null;
  let businessName = "Unknown Business";
  let startedEventId: string | null = null;

  log("request_received", {
    lead_id: asString(body.lead_id),
    source_event_id: asString(body.event_id) ?? asString(body.source_event_id),
    auth: authContext,
  });

  try {
    const resolved = await resolveLead(supabase, body);
    leadId = resolved.leadId;
    businessName = resolved.businessName;

    await supabase.from("local_business_leads").update({ enrichment_status: "enriching" }).eq("id", leadId);

    const startedPayload = {
      lead_id: leadId,
      source_event_id: resolved.sourceEventId ?? null,
      action: asString(body.action) ?? asString(body.mode) ?? "enrich",
      auth_user_id: authContext.user_id,
    };

    startedEventId = await insertEvent(supabase, {
      eventType: "local_business.enrichment.started",
      leadId,
      businessName,
      status: "started",
      payload: startedPayload,
    });

    await insertEvent(supabase, {
      eventType: "local_business.enrich.requested",
      leadId,
      businessName,
      status: "requested",
      payload: { ...startedPayload, canonical_event_id: startedEventId },
    });

    const now = new Date().toISOString();

    // ── Run tiered discovery pipeline ────────────────────────────────────
    const discovery = await runTieredDiscovery(resolved.sourcePayload, businessName, now);

    // Check for soft-fail conditions:
    // If all tiers were skipped (no API keys, no search) or blocked
    const googleAttempted = discovery.enrichmentDebugCore.tiers.google_places.attempted;
    const exaAttempted = discovery.enrichmentDebugCore.tiers.exa.attempted;
    const ddgAttempted = discovery.enrichmentDebugCore.tiers.duckduckgo.attempted;
    const directAttempted = discovery.enrichmentDebugCore.tiers.direct_fetch.attempted;

    const googleError = discovery.enrichmentDebugCore.tiers.google_places.provider_error;
    const exaError = discovery.enrichmentDebugCore.tiers.exa.provider_error;

    // Determine if this is a search infrastructure failure
    const noTierAttempted = !googleAttempted && !exaAttempted && !ddgAttempted;
    const allAttemptedFailed = (
      (googleAttempted && googleError) &&
      (exaAttempted && exaError) &&
      (!ddgAttempted || discovery.enrichmentDebugCore.tiers.duckduckgo.candidates_found === 0)
    );

    // Count meaningful candidates from search tiers (excluding payload/generated)
    const searchCandidateCount = discovery.candidates.filter(
      (c) => c.source !== "payload" && c.source !== "heuristic" && c.source !== "generated_search_url" && c.source !== "generated_social_slug",
    ).length;

    const directPayloadFields = countMeaningfulCandidateFields(
      discovery.candidates.filter((c) => c.source === "payload"),
    );

    // Build enrichment debug for failure case
    const failureDebug: Json = {
      ...discovery.enrichmentDebugCore,
      persistence_result: { fields_updated: [], fields_skipped: [] },
      status: "failed",
    };

    if (noTierAttempted && directPayloadFields < SUFFICIENT_CANDIDATE_THRESHOLD) {
      // No search tier had an API key and payload is insufficient
      const failureEventId = await handleSearchFailure(
        supabase, leadId, businessName, "search_unavailable",
        failureDebug, startedEventId, resolved.sourceEventId ?? null,
      );
      log("enrichment_soft_fail", { lead_id: leadId, status: "search_unavailable" });
      return jsonResponse({
        ok: false,
        status: "search_unavailable",
        lead_id: leadId,
        requested_event_id: startedEventId,
        failure_event_id: failureEventId,
        retryable: true,
        details: failureDebug,
      });
    }

    if (allAttemptedFailed && searchCandidateCount === 0 && directPayloadFields < SUFFICIENT_CANDIDATE_THRESHOLD) {
      // All attempted tiers returned errors
      const failureEventId = await handleSearchFailure(
        supabase, leadId, businessName, "search_blocked",
        failureDebug, startedEventId, resolved.sourceEventId ?? null,
      );
      log("enrichment_soft_fail", { lead_id: leadId, status: "search_blocked" });
      return jsonResponse({
        ok: false,
        status: "search_blocked",
        lead_id: leadId,
        requested_event_id: startedEventId,
        failure_event_id: failureEventId,
        retryable: true,
        details: failureDebug,
      });
    }

    // ── Auto-demotion: clear enrichment-sourced canonical fields that fail the
    // ── new strict name gate. Only demotes values with clear enrichment provenance
    // ── (source !== "payload"); NEVER touches operator-entered values.
    const demotionSig = nameSignatureFromContext(discovery.context);
    const demotableFields: FieldKey[] = ["website_url", "facebook_url", "google_maps_url"];
    const demotedFields: string[] = [];
    for (const field of demotableFields) {
      const currentValue = asString(resolved.lead[field]);
      if (!currentValue) continue;
      // Check provenance: was this value put there by enrichment (not operator)?
      const priorDiag = resolved.lead.enrichment_diagnostics as Json | null;
      const priorConf = (priorDiag as Json)?.[`confidence`] as Json | undefined;
      const fieldConf = priorConf?.[field] as Json | undefined;
      const priorSource = fieldConf?.source as string | undefined;
      // If no provenance or source is "payload", this is operator/seed — never demote.
      if (!priorSource || priorSource === "payload") continue;
      // Does the current canonical value fail the strict name gate?
      const candidateText = field === "google_maps_url" ? currentValue : (normalizedHost(currentValue) ?? currentValue);
      const decision = evaluateCandidate(candidateText, demotionSig, {
        localityMatch: "unknown",
        hasCorroboration: false,
      });
      if (!decision.accept) {
        log("auto_demotion", {
          lead_id: resolved.leadId,
          field,
          demoted_value: currentValue,
          reason: decision.reason,
          prior_source: priorSource,
        });
        // Null the field in the source payload so directCandidates cannot re-promote it
        (resolved.sourcePayload as Record<string, unknown>)[field] = null;
        // Mark for nulling in the lead patch (applied later)
        demotedFields.push(field);
        // Record as rejected URL
        const rej = rejectedUrl(currentValue, field, decision.reason ?? "name_mismatch_despite_locality_match", now);
        if (rej) discovery.rejectedUrls.push(rej);
      }
    }

    // Continue with field acceptance
    const effective = effectiveFields(resolved.lead, discovery.accepted, discovery.context);

    // Apply demotions to effective fields
    for (const field of demotedFields) {
      (effective as Record<string, unknown>)[field] = null;
    }

    const result = buildEnrichmentResult({
      businessName,
      effective,
      accepted: discovery.accepted,
      confidence: discovery.confidence,
      candidates: discovery.candidates,
      reviewSignals: discovery.reviewSignals,
      operatingHistory: discovery.operatingHistory,
      contactPathways: discovery.contactPathways,
      rejectedUrls: discovery.rejectedUrls,
      observedAt: now,
    });
    // Gate missing_google_profile: only flag when GBP search was actually attempted
    const googlePlacesAttempted = discovery.enrichmentDebugCore.tiers.google_places.attempted;
    if (!googlePlacesAttempted && result.risk_flags.includes("missing_google_profile")) {
      result.risk_flags = result.risk_flags.filter((f: string) => f !== "missing_google_profile");
      result.risk_flags.push("google_profile_not_searched");
    }

    const meaningfulSignals = meaningfulSignalCount(effective);
    const strongAnchorPresent = hasStrongAnchorEvidence(result.evidence);
    const foundNow = meaningfulFields.filter((field) => hasCanonicalValue(discovery.accepted[field]));

    // If all tiers ran but we found zero candidates after all tiers
    if (meaningfulSignals === 0 && searchCandidateCount === 0 && directPayloadFields === 0) {
      const zeroDebug: Json = {
        ...discovery.enrichmentDebugCore,
        persistence_result: { fields_updated: [], fields_skipped: meaningfulFields },
        status: "zero_candidates",
      };
      const failureEventId = await handleSearchFailure(
        supabase, leadId, businessName, "zero_candidates",
        zeroDebug, startedEventId, resolved.sourceEventId ?? null,
      );
      log("enrichment_soft_fail", { lead_id: leadId, status: "zero_candidates" });
      return jsonResponse({
        ok: false,
        status: "zero_candidates",
        lead_id: leadId,
        requested_event_id: startedEventId,
        failure_event_id: failureEventId,
        retryable: false,
        details: zeroDebug,
      });
    }

    const confidenceScores = Object.values(discovery.confidence ?? {})
      .map((item: any) => item?.score)
      .filter((score: unknown): score is number => typeof score === "number");

    const enrichmentConfidence =
      confidenceScores.length > 0
        ? Number((confidenceScores.reduce((sum, score) => sum + score, 0) / confidenceScores.length).toFixed(2))
        : null;

    // Build persistence result for enrichment_debug
    const fieldsUpdated: string[] = [];
    const fieldsSkipped: string[] = [];

    const leadPatch: Record<string, unknown> = {
      enrichment_confidence: enrichmentConfidence,
      confidence_score: result.confidence_score,
    };

    // Apply auto-demotion nulls for enrichment-sourced name mismatches
    for (const field of demotedFields) {
      leadPatch[field] = null;
      fieldsUpdated.push(`${field}:demoted`);
    }

    // Patch patchable fields (excluding opening_hours, handled separately)
    for (const field of patchableFields) {
      if (field === "opening_hours") continue;
      const value = discovery.accepted[field as FieldKey];
      if (hasCanonicalValue(value)) {
        if (!hasCanonicalValue(resolved.lead[field])) {
          leadPatch[field] = value;
          fieldsUpdated.push(field);
        } else {
          fieldsSkipped.push(field);
        }
      }
    }
    // Opening hours (jsonb) — patch if we found them and lead does not have them
    if (discovery.openingHours && !hasCanonicalValue(resolved.lead.opening_hours)) {
      leadPatch.opening_hours = discovery.openingHours;
      fieldsUpdated.push("opening_hours");
    } else if (discovery.openingHours) {
      fieldsSkipped.push("opening_hours");
    }

    // Build final enrichment_debug with persistence_result
    const finalEnrichmentDebug: Json = {
      ...discovery.enrichmentDebugCore,
      persistence_result: { fields_updated: fieldsUpdated, fields_skipped: fieldsSkipped },
      status: meaningfulSignals > 0 && strongAnchorPresent ? "success" : "partial",
    };

    leadPatch.enrichment_diagnostics = {
      ...discovery.diagnostics,
      confidence: discovery.confidence,
      meaningful_signal_count: meaningfulSignals,
      fields_found_now: foundNow,
      enrichment_result: result,
      enrichment_debug: finalEnrichmentDebug,
    };

    if (result.social_links.length > 0 || leadPatch.facebook_url === null || leadPatch.google_maps_url === null) leadPatch.social_links = result.social_links;
    if (result.service_areas.length > 0) leadPatch.service_areas = result.service_areas;
    if (result.categories.length > 0) leadPatch.categories = result.categories;
    if (result.review_signals.length > 0) leadPatch.review_signals = result.review_signals;
    if (result.trust_signals.length > 0) leadPatch.trust_signals = result.trust_signals;
    if (result.risk_flags.length > 0) leadPatch.risk_flags = result.risk_flags;
    if (result.source_urls.length > 0) leadPatch.source_urls = result.source_urls;
    leadPatch.trust_score = result.trust_score;
    leadPatch.data_alignment_status = result.confidence_score > 0 && result.confidence_score < 65 ? "low_confidence" : result.data_alignment_status;

    // ── Partial outcome: no meaningful signals after enrichment ──────────
    if (meaningfulSignals === 0 || !strongAnchorPresent) {
      leadPatch.enrichment_status = "partial";
      if (resolved.lead.status === "discovered") leadPatch.status = "review_required";
      const partialReason = meaningfulSignals === 0 ? "no_meaningful_enrichment_signal" : "strong_anchor_required";

      // ── Partial: create assessment so callers (opportunities engine) can discover it ──
const partialScoring = score(effective, result);

const {
  opportunity_score: _generatedOpportunityScore,
  ...partialAssessmentInsert
} = partialScoring;

let partialAssessmentId: string | null = null;
let partialOpportunityScore: number | null = null;

try {
  const { error: paError, data: paData } = await supabase
    .from("local_business_lead_assessments")
    .insert({
      lead_id: leadId,
      ...partialAssessmentInsert,
      assessed_by: "local-business-enrich",
      assessed_at: now,
    })
    .select("id, opportunity_score")
    .single();

  if (paError || !paData) {
    throw new Error(
      `partial_assessment_insert_failed: ${paError?.message ?? "no inserted row"}`
    );
  }

  partialAssessmentId = paData.id as string;
  partialOpportunityScore =
    typeof paData.opportunity_score === "number"
      ? paData.opportunity_score
      : null;
   const assessmentErrMsg = errorMessage(assessmentErr);

  log("partial_assessment_insert_failed", {
    lead_id: leadId,
    enrichment_outcome: "partial",
    error: assessmentErrMsg,
  });

  return jsonResponse(
    {
      ok: false,
      status: "partial",
      lead_id: leadId,
      requested_event_id: startedEventId,
      error: assessmentErrMsg,
    },
    500,
  );
}
      const { error: partialUpdateError } = await supabase.from("local_business_leads").update(leadPatch).eq("id", leadId);
      if (partialUpdateError) throw new Error(`partial_update_failed: ${partialUpdateError.message}`);

      const { error: partialAssessedStatusError } = await supabase
        .from("local_business_leads")
        .update({ enrichment_status: "assessed" })
        .eq("id", leadId);
      if (partialAssessedStatusError) log("partial_assessed_status_update_failed", { lead_id: leadId, error: partialAssessedStatusError.message });

      const completedEventId = await insertEvent(supabase, {
        eventType: "local_business.enrichment.completed",
        leadId,
        businessName,
        status: "partial",
        payload: {
          status: "partial",
          result,
          accepted_fields: discovery.accepted,
          diagnostics: leadPatch.enrichment_diagnostics as Json,
          enrichment_debug: finalEnrichmentDebug,
          reason: partialReason,
          started_event_id: startedEventId,
          source_event_id: resolved.sourceEventId ?? null,
        },
      });

      const partialEventId = await insertEvent(supabase, {
        eventType: "local_business.enrichment_partial",
        leadId,
        businessName,
        status: "partial",
        payload: {
          canonical_event_id: completedEventId,
          accepted_fields: discovery.accepted,
          diagnostics: leadPatch.enrichment_diagnostics as Json,
          enrichment_debug: finalEnrichmentDebug,
          reason: partialReason,
          requested_event_id: startedEventId,
          source_event_id: resolved.sourceEventId ?? null,
        },
      });

      log("enrichment_partial", { lead_id: leadId, started_event_id: startedEventId, partial_event_id: partialEventId, reason: partialReason, search_tier_reached: discovery.searchTierReached });

      return jsonResponse({
        ok: true,
        status: "partial" satisfies EnrichmentStatus,
        lead_id: leadId,
        requested_event_id: startedEventId,
        enriched_event_id: completedEventId,
        partial_event_id: partialEventId,
        assessment_id: partialAssessmentId,
        search_tier_reached: discovery.searchTierReached,
        details: {
          meaningful_signal_count: meaningfulSignals,
          fields_found_now: foundNow,
          data_alignment_status: result.data_alignment_status,
          identity_alignment: result.identity_alignment,
          evidence_counts: Object.fromEntries(
            ["canonical", "supporting", "citation", "rejected"].map((evidenceClass) => [
              evidenceClass,
              result.evidence.filter((item) => item.evidence_class === evidenceClass).length,
            ]),
          ),
        },
      });
    }

    // ── Success outcome ─────────────────────────────────────────────────
    Object.assign(leadPatch, {
      trust_signal_score: result.trust_score,
      trust_summary: result.trust_summary,
      trust_flags: [...result.trust_signals, ...result.risk_flags],
      enrichment_status: "enriched",
      status: resolved.lead.status === "discovered" ? "enriched" : resolved.lead.status,
      enriched_at: now,
    });

    const { error: updateError, count } = await supabase.from("local_business_leads").update(leadPatch, { count: "exact" }).eq("id", leadId).select("id");
    if (updateError) throw new Error(`canonical_update_failed: ${updateError.message}`);
    log("canonical_update_result", { lead_id: leadId, updated_count: count ?? null, patched_fields: Object.keys(leadPatch) });

    const completedEventId = await insertEvent(supabase, {
      eventType: "local_business.enrichment.completed",
      leadId,
      businessName,
      status: "completed",
      payload: {
        result,
        accepted_fields: discovery.accepted,
        confidence: discovery.confidence,
        diagnostics: leadPatch.enrichment_diagnostics as Json,
        enrichment_debug: finalEnrichmentDebug,
        started_event_id: startedEventId,
        source_event_id: resolved.sourceEventId ?? null,
      },
    });

    await insertEvent(supabase, {
      eventType: "local_business.enriched",
      leadId,
      businessName,
      status: "completed",
      payload: {
        ...effective,
        opening_hours: discovery.openingHours,
        trust_signal_score: result.trust_score,
        trust_summary: result.trust_summary,
        trust_flags: [...result.trust_signals, ...result.risk_flags],
        confidence: discovery.confidence,
        diagnostics: leadPatch.enrichment_diagnostics as Json,
        enrichment_debug: finalEnrichmentDebug,
        canonical_event_id: completedEventId,
        requested_event_id: startedEventId,
        source_event_id: resolved.sourceEventId ?? null,
      },
    });

const scoring = score(effective, result);

const {
  opportunity_score: _generatedOpportunityScore,
  ...assessmentInsert
} = scoring;

const { error: assessmentError, data: assessmentData } = await supabase
  .from("local_business_lead_assessments")
  .insert({
    lead_id: leadId,
    ...assessmentInsert,
    assessed_by: "local-business-enrich",
    assessed_at: now,
  })
  .select("id, opportunity_score")
  .single();

if (assessmentError || !assessmentData) {
  throw new Error(
    `assessment_insert_failed: ${assessmentError?.message ?? "no inserted row"}`,
  );
}
    const { error: assessedStatusError } = await supabase
      .from("local_business_leads")
      .update({ enrichment_status: "assessed", status: resolved.lead.status === "discovered" || resolved.lead.status === "enriched" ? "assessed" : resolved.lead.status })
      .eq("id", leadId);
    if (assessedStatusError) throw new Error(`assessed_status_update_failed: ${assessedStatusError.message}`);

    const trustAssessedEventId = await insertEvent(supabase, {
      eventType: "local_business.trust_assessed",
      leadId,
      businessName,
      status: "completed",
      payload: {
        trust_score: result.trust_score,
        trust_summary: result.trust_summary,
        trust_signals: result.trust_signals,
        risk_flags: result.risk_flags,
        data_alignment_status: result.data_alignment_status,
        scoring,
        meaningful_signal_count: meaningfulSignals,
        search_tier_reached: discovery.searchTierReached,
        started_event_id: startedEventId,
        completed_event_id: completedEventId,
        source_event_id: resolved.sourceEventId ?? null,
      },
    });

    await insertEvent(supabase, {
      eventType: "local_business.assessed",
      leadId,
      businessName,
      status: "completed",
      payload: {
        ...scoring,
        meaningful_signal_count: meaningfulSignals,
        trust_assessed_event_id: trustAssessedEventId,
        requested_event_id: startedEventId,
        source_event_id: resolved.sourceEventId ?? null,
      },
    });

    log("enrichment_success", {
      lead_id: leadId,
      started_event_id: startedEventId,
      completed_event_id: completedEventId,
      trust_assessed_event_id: trustAssessedEventId,
      assessment_id: assessmentData.id,
      opportunity_score: scoring.opportunity_score,
      search_tier_reached: discovery.searchTierReached,
      fields_updated: fieldsUpdated,
    });

    return jsonResponse({
      ok: true,
      status: "success" satisfies EnrichmentStatus,
      lead_id: leadId,
      requested_event_id: startedEventId,
      enriched_event_id: completedEventId,
      assessed_event_id: trustAssessedEventId,
      search_tier_reached: discovery.searchTierReached,
      details: {
        meaningful_signal_count: meaningfulSignals,
        fields_found_now: foundNow,
        data_alignment_status: result.data_alignment_status,
        identity_alignment: result.identity_alignment,
        evidence_counts: Object.fromEntries(
          ["canonical", "supporting", "citation", "rejected"].map((evidenceClass) => [
            evidenceClass,
            result.evidence.filter((item) => item.evidence_class === evidenceClass).length,
          ]),
        ),
      },
    });
  } catch (error) {
    const message = errorMessage(error);
    log("enrichment_failure", { lead_id: leadId, started_event_id: startedEventId, error: message });

    let failureEventId: string | null = null;
    if (leadId) {
      await supabase
        .from("local_business_leads")
        .update({
          enrichment_status: "failed",
          enrichment_diagnostics: {
            schema_version: "enrichment-v2",
            failure_reason: message,
            started_event_id: startedEventId,
            failed_at: new Date().toISOString(),
          },
        })
        .eq("id", leadId);

      try {
        failureEventId = await insertEvent(supabase, {
          eventType: "local_business.enrichment.failed",
          leadId,
          businessName,
          status: "failed",
          payload: {
            lead_id: leadId,
            started_event_id: startedEventId,
            error: message,
          },
        });

        await insertEvent(supabase, {
          eventType: "local_business.enrichment_failed",
          leadId,
          businessName,
          status: "failed",
          payload: {
            canonical_event_id: failureEventId,
            lead_id: leadId,
            requested_event_id: startedEventId,
            error: message,
          },
        });
      } catch (failureInsertError) {
        log("failure_event_insert_failed", { lead_id: leadId, error: errorMessage(failureInsertError) });
      }
    }

    return jsonResponse(
      {
        ok: false,
        status: "failed" satisfies EnrichmentStatus,
        lead_id: leadId ?? undefined,
        requested_event_id: startedEventId ?? undefined,
        failure_event_id: failureEventId ?? undefined,
        error: message,
      },
      500,
    );
  }
}

if (import.meta.main) Deno.serve(handler);
