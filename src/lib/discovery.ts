import type { DiscoveryCandidate, DiscoverySearchInput } from "./types";
import { findCategoriesBySlugs, formatCategorySummary, type OpportunityCategory } from "./categories";

export const INITIAL_DISCOVERY_CATEGORY_STATE = {
  all_categories: true,
  category_slugs: [] as string[],
};

export function categorySelectionPayload(
  selection: Pick<DiscoverySearchInput, "all_categories" | "category_slugs">,
  categories: OpportunityCategory[],
) {
  const allCategories = selection.all_categories === true;
  const selected = allCategories ? [] : findCategoriesBySlugs(categories, selection.category_slugs ?? []);
  const slugs = selected.map((category) => category.slug);
  const labels = allCategories ? [] : selected.map((category) => category.label);
  const summary = formatCategorySummary(labels, allCategories);
  return {
    all_categories: allCategories,
    category_slugs: slugs,
    category_labels: labels,
    category_slug: !allCategories && selected.length === 1 ? selected[0].slug : null,
    category_label: summary,
    industry: summary,
  };
}

export type DiscoveryValidationErrors = Partial<Record<keyof DiscoverySearchInput, string>>;

/** Cockpit classifications that block progress no matter what the operator does. */
export const HARD_BLOCK_ELIGIBILITY_CLASSIFICATIONS = [
  "existing_customer",
  "previously_contacted",
  "existing_lead",
  "existing_contact",
  "nurture",
] as const;

/** The only classification that may proceed under an operator-acknowledged exception. */
export const POSSIBLE_MATCH_CLASSIFICATION = "possible_match";

export type CandidateEligibilityTone =
  | "success"
  | "warning"
  | "danger"
  | "neutral";

export interface CandidateEligibilityDisplay {
  /** Retained Cockpit classification, falling back to the eligibility status. */
  classification: string;
  label: string;
  tone: CandidateEligibilityTone;
  /** True when the candidate is a possible_match still awaiting acknowledgement. */
  needsAcknowledgement: boolean;
  /** True when a possible_match has a persisted acknowledgement. */
  acknowledged: boolean;
  /** Mirrors the backend gate: eligible OR (possible_match AND acknowledged). */
  mayProceed: boolean;
}

/**
 * The retained Cockpit classification for a candidate. `eligibility_result` is
 * the source of truth; `eligibility_status` is only a fallback for older rows.
 */
export function candidateEligibilityClassification(
  candidate: Pick<DiscoveryCandidate, "eligibility_status" | "eligibility_result">,
): string {
  const classification = candidate.eligibility_result?.classification;
  if (typeof classification === "string" && classification.length > 0) {
    return classification;
  }
  return candidate.eligibility_status || "unknown";
}

export function isHardBlockEligibilityClassification(
  classification: string,
): boolean {
  return (HARD_BLOCK_ELIGIBILITY_CLASSIFICATIONS as readonly string[]).includes(
    classification,
  );
}

export function candidateNeedsEligibilityAcknowledgement(
  candidate: Pick<
    DiscoveryCandidate,
    "eligibility_status" | "eligibility_result" | "eligibility_acknowledged"
  >,
): boolean {
  return (
    candidateEligibilityClassification(candidate) ===
      POSSIBLE_MATCH_CLASSIFICATION &&
    candidate.eligibility_acknowledged !== true
  );
}

/** Mirrors the SQL predicate `opportunity_classification_allows_progress`. */
export function candidateMayProceed(
  candidate: Pick<
    DiscoveryCandidate,
    "eligibility_status" | "eligibility_result" | "eligibility_acknowledged"
  >,
): boolean {
  const classification = candidateEligibilityClassification(candidate);
  if (classification === "eligible") return true;
  if (classification === POSSIBLE_MATCH_CLASSIFICATION) {
    return candidate.eligibility_acknowledged === true;
  }
  return false;
}

export function candidateEligibilityDisplay(
  candidate: Pick<
    DiscoveryCandidate,
    "eligibility_status" | "eligibility_result" | "eligibility_acknowledged"
  >,
): CandidateEligibilityDisplay {
  const classification = candidateEligibilityClassification(candidate);
  const acknowledged = candidate.eligibility_acknowledged === true;

  if (classification === "eligible") {
    return {
      classification,
      label: "eligible",
      tone: "success",
      needsAcknowledgement: false,
      acknowledged: false,
      mayProceed: true,
    };
  }

  if (classification === POSSIBLE_MATCH_CLASSIFICATION) {
    return {
      classification,
      label: acknowledged
        ? "possible match · acknowledged"
        : "possible match · review required",
      tone: "warning",
      needsAcknowledgement: !acknowledged,
      acknowledged,
      mayProceed: acknowledged,
    };
  }

  if (
    classification === "eligibility_check_failed" ||
    candidate.eligibility_status === "failed"
  ) {
    return {
      classification,
      label: "failed",
      tone: "danger",
      needsAcknowledgement: false,
      acknowledged: false,
      mayProceed: false,
    };
  }

  if (
    isHardBlockEligibilityClassification(classification) ||
    candidate.eligibility_status === "blocked"
  ) {
    return {
      classification,
      label: "blocked",
      tone: "danger",
      needsAcknowledgement: false,
      acknowledged: false,
      mayProceed: false,
    };
  }

  return {
    classification,
    label: candidate.eligibility_status || "not checked",
    tone: "neutral",
    needsAcknowledgement: false,
    acknowledged: false,
    mayProceed: false,
  };
}

/**
 * Client-side mirror of the server's discovery validation. The operator-configured
 * maximum results is passed in so the form cannot offer more than the backend will
 * accept; it defaults to the hard ceiling for callers that do not know the setting.
 */
export function validateDiscoveryInput(
  input: DiscoverySearchInput,
  options: { maxResultLimit?: number } = {},
): DiscoveryValidationErrors {
  const maxResultLimit = options.maxResultLimit ?? 20;
  const errors: DiscoveryValidationErrors = {};
  if (!input.location.trim()) errors.location = "Choose a search location.";
  const categorySelected = input.all_categories === true ||
    (Array.isArray(input.category_slugs)
      ? input.category_slugs.length > 0
      : Boolean(input.category_slug?.trim()) || Boolean(input.industry?.trim()));
  if (!categorySelected)
    errors.industry = "Choose an opportunity category.";
  if (
    !Number.isInteger(input.result_limit) ||
    input.result_limit < 1 ||
    input.result_limit > maxResultLimit
  ) {
    errors.result_limit = `Choose between 1 and ${maxResultLimit} results.`;
  }
  if (input.radius_m !== null && (!Number.isInteger(input.radius_m) || input.radius_m < 100 || input.radius_m > 50_000)) {
    errors.radius_m = "Radius must be between 100 m and 50 km.";
  }
  return errors;
}

export function isActiveDiscoveryStatus(status: string): boolean {
  return ["queued", "discovering", "enriching", "scoring", "auditing"].includes(status);
}
