import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  INITIAL_DISCOVERY_CATEGORY_STATE,
  categorySelectionPayload,
  candidateEligibilityClassification,
  candidateEligibilityDisplay,
  candidateMayProceed,
  candidateNeedsEligibilityAcknowledgement,
  isActiveDiscoveryStatus,
  validateDiscoveryInput,
} from "./discovery";
import { formatCategorySummary, normalizeCategory } from "./categories";

type EligibilityCandidate = Parameters<typeof candidateEligibilityDisplay>[0];

function eligibilityCandidate(
  classification: string,
  acknowledged = false,
  status = classification === "eligible" ? "eligible" : "review_required",
): EligibilityCandidate {
  return {
    eligibility_status: status,
    eligibility_result: { classification },
    eligibility_acknowledged: acknowledged,
  };
}

describe("discovery form validation", () => {
  const categories = [
    normalizeCategory({ id: "1", slug: "electricians", label: "Electricians" })!,
    normalizeCategory({ id: "2", slug: "plumbers", label: "Plumbers" })!,
  ];
  const base = { location: "Auckland", industry: "", keywords: "", radius_m: null, result_limit: 10 };

  it("submits explicit All as valid with no slugs and a matching summary", () => {
    const payload = categorySelectionPayload(INITIAL_DISCOVERY_CATEGORY_STATE, categories);
    expect(payload).toMatchObject({ all_categories: true, category_slugs: [], category_label: "All categories" });
    expect(validateDiscoveryInput({ ...base, ...payload })).toEqual({});
    expect(formatCategorySummary([], payload.all_categories)).toBe(payload.category_label);
  });

  it("wires Start discovery through the explicit payload and JSON request body", () => {
    const screen = readFileSync(resolve("src/routes/Discovery.tsx"), "utf8");
    const api = readFileSync(resolve("src/lib/api.ts"), "utf8");
    expect(screen).toContain("const categoryPayload = categorySelectionPayload(form, categories)");
    expect(screen).toContain("...categoryPayload,");
    expect(screen).toContain("startDiscoveryRun(payload)");
    expect(api).toContain("body: JSON.stringify(input)");
  });

  it("submits one or multiple explicit categories with matching summaries", () => {
    for (const slugs of [["electricians"], ["electricians", "plumbers"]]) {
      const payload = categorySelectionPayload({ all_categories: false, category_slugs: slugs }, categories);
      expect(payload).toMatchObject({ all_categories: false, category_slugs: slugs });
      expect(validateDiscoveryInput({ ...base, ...payload })).toEqual({});
      expect(formatCategorySummary(payload.category_labels, payload.all_categories)).toBe(payload.category_label);
    }
  });

  it("shows a neutral summary and validation error when nothing is selected", () => {
    const payload = categorySelectionPayload({ all_categories: false, category_slugs: [] }, categories);
    expect(payload.category_label).toBe("Choose categories");
    expect(validateDiscoveryInput({ ...base, ...payload })).toMatchObject({ industry: "Choose an opportunity category." });
  });

  it("does not submit a category that is no longer present in the registry", () => {
    const payload = categorySelectionPayload({ all_categories: false, category_slugs: ["removed"] }, categories);
    expect(payload).toMatchObject({ category_slugs: [], category_label: "Choose categories" });
    expect(validateDiscoveryInput({ ...base, ...payload })).toHaveProperty("industry");
  });

  it("Clear restores the explicit valid All state", () => {
    const changed = categorySelectionPayload({ all_categories: false, category_slugs: ["electricians"] }, categories);
    expect(changed.category_label).toBe("Electricians");
    const cleared = categorySelectionPayload(INITIAL_DISCOVERY_CATEGORY_STATE, categories);
    expect(cleared).toMatchObject({ all_categories: true, category_slugs: [], category_label: "All categories" });
    expect(validateDiscoveryInput({ ...base, ...cleared })).toEqual({});
  });
  it("requires a location and industry", () => {
    expect(validateDiscoveryInput({ location: " ", industry: "", keywords: "", radius_m: null, result_limit: 10 })).toMatchObject({
      location: expect.any(String), industry: expect.any(String),
    });
  });

  it("bounds radius and result count", () => {
    expect(validateDiscoveryInput({ location: "Auckland", industry: "Builder", keywords: "", radius_m: 50, result_limit: 21 })).toMatchObject({
      radius_m: expect.any(String), result_limit: expect.any(String),
    });
  });

  it("accepts a complete request", () => {
    expect(validateDiscoveryInput({ location: "Auckland", industry: "Builder", keywords: "renovation", radius_m: 10_000, result_limit: 20 })).toEqual({});
  });

  it("honours the operator-configured maximum results", () => {
    const base = { location: "Auckland", industry: "Builder", keywords: "", radius_m: 10_000 };
    expect(
      validateDiscoveryInput({ ...base, result_limit: 8 }, { maxResultLimit: 5 }),
    ).toMatchObject({ result_limit: "Choose between 1 and 5 results." });
    expect(
      validateDiscoveryInput({ ...base, result_limit: 5 }, { maxResultLimit: 5 }),
    ).toEqual({});
  });

  it("accepts a controlled category selection without free-text keywords", () => {
    expect(
      validateDiscoveryInput({
        location: "Helensville, Auckland, New Zealand",
        industry: "Electricians",
        keywords: "",
        radius_m: 10000,
        result_limit: 10,
        location_place_id: "ChIJhelensville",
        location_latitude: -36.6769,
        location_longitude: 174.4503,
        category_slug: "electricians",
        category_label: "Electricians",
      }),
    ).toEqual({});
  });

  it("accepts a category slug when no label is supplied", () => {
    expect(
      validateDiscoveryInput({
        location: "Auckland",
        industry: "",
        keywords: "",
        radius_m: null,
        result_limit: 10,
        category_slug: "accountants",
      }),
    ).toEqual({});
  });

  it("keeps legacy free-text runs valid (location + industry label only)", () => {
    expect(
      validateDiscoveryInput({
        location: "Helensville",
        industry: "electricians",
        keywords: "",
        radius_m: null,
        result_limit: 10,
      }),
    ).toEqual({});
  });

  it("identifies every active run state", () => {
    for (const status of ["queued", "discovering", "enriching", "scoring", "auditing"]) expect(isActiveDiscoveryStatus(status)).toBe(true);
    for (const status of ["completed", "partially_completed", "failed", "cancelled"]) expect(isActiveDiscoveryStatus(status)).toBe(false);
  });
});

describe("possible_match acknowledgement gating (mirrors backend)", () => {
  it("lets an eligible candidate proceed without acknowledgement", () => {
    const candidate = eligibilityCandidate("eligible");
    expect(candidateMayProceed(candidate)).toBe(true);
    expect(candidateNeedsEligibilityAcknowledgement(candidate)).toBe(false);
  });

  it("blocks an unacknowledged possible_match", () => {
    const candidate = eligibilityCandidate("possible_match", false, "review_required");
    expect(candidateMayProceed(candidate)).toBe(false);
    expect(candidateNeedsEligibilityAcknowledgement(candidate)).toBe(true);
    const display = candidateEligibilityDisplay(candidate);
    expect(display.tone).toBe("warning");
    expect(display.label).toContain("review required");
  });

  it("permits a possible_match once acknowledgement is persisted", () => {
    const candidate = eligibilityCandidate("possible_match", true, "review_required");
    expect(candidateMayProceed(candidate)).toBe(true);
    expect(candidateNeedsEligibilityAcknowledgement(candidate)).toBe(false);
    const display = candidateEligibilityDisplay(candidate);
    expect(display.acknowledged).toBe(true);
    expect(display.tone).toBe("warning");
  });

  it("never lets a hard-block classification be overridden by acknowledgement", () => {
    for (const classification of [
      "existing_customer",
      "previously_contacted",
      "existing_lead",
      "existing_contact",
      "nurture",
    ]) {
      expect(candidateMayProceed(eligibilityCandidate(classification, true, "blocked"))).toBe(false);
      expect(candidateNeedsEligibilityAcknowledgement(eligibilityCandidate(classification, false, "blocked"))).toBe(false);
      expect(candidateEligibilityDisplay(eligibilityCandidate(classification, false, "blocked")).tone).toBe("danger");
    }
  });

  it("keeps the possible_match classification after acknowledgement", () => {
    const candidate = eligibilityCandidate("possible_match", true, "review_required");
    expect(candidateEligibilityClassification(candidate)).toBe("possible_match");
  });

  it("shows failed distinctly from possible_match and blocked", () => {
    const failed = candidateEligibilityDisplay({
      eligibility_status: "failed",
      eligibility_result: { classification: "eligibility_check_failed" },
      eligibility_acknowledged: false,
    });
    expect(failed.tone).toBe("danger");
    expect(failed.label).toBe("failed");
  });

  it("exposes retained match metadata for review", () => {
    const candidate: EligibilityCandidate = {
      eligibility_status: "review_required",
      eligibility_result: {
        classification: "possible_match",
        match_type: "business_name",
        confidence: "possible",
        contact_id: "contact-1",
        organisation_id: "org-1",
        reason: "Business name matches an existing Cockpit contact.",
      },
      eligibility_acknowledged: false,
    };
    expect(candidateEligibilityDisplay(candidate).needsAcknowledgement).toBe(true);
    expect(candidate.eligibility_result).toMatchObject({
      match_type: "business_name",
      confidence: "possible",
      contact_id: "contact-1",
      organisation_id: "org-1",
    });
  });
});
