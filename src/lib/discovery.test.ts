import { describe, expect, it } from "vitest";
import { isActiveDiscoveryStatus, validateDiscoveryInput } from "./discovery";

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
