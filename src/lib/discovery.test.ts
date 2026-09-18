import { describe, expect, it } from "vitest";
import {
  candidateEligibilityClassification,
  candidateEligibilityDisplay,
  candidateMayProceed,
  candidateNeedsEligibilityAcknowledgement,
  isActiveDiscoveryStatus,
  validateDiscoveryInput,
} from "./discovery";

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
