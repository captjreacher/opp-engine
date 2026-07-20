import type { DiscoverySearchInput } from "./types";

export type DiscoveryValidationErrors = Partial<Record<keyof DiscoverySearchInput, string>>;

export function validateDiscoveryInput(input: DiscoverySearchInput): DiscoveryValidationErrors {
  const errors: DiscoveryValidationErrors = {};
  if (!input.location.trim()) errors.location = "Enter a target location.";
  if (!input.industry.trim()) errors.industry = "Enter an industry or category.";
  if (!Number.isInteger(input.result_limit) || input.result_limit < 1 || input.result_limit > 20) {
    errors.result_limit = "Choose between 1 and 20 results.";
  }
  if (input.radius_m !== null && (!Number.isInteger(input.radius_m) || input.radius_m < 100 || input.radius_m > 50_000)) {
    errors.radius_m = "Radius must be between 100 m and 50 km.";
  }
  return errors;
}

export function isActiveDiscoveryStatus(status: string): boolean {
  return ["queued", "discovering", "enriching", "scoring", "auditing"].includes(status);
}
