// Pure display/contract helpers for visual evidence (Phase 5.1).
//
// Governance invariant: Google Street View evidence is REFERENCE-ONLY
// (analysis_allowed = false, storage_mode = "reference_only"). This module
// never fetches, downloads, proxies or persists Street View imagery — it only
// derives a deep link so the operator can open Google's own Street View
// experience in a new tab.

import type { VisualEvidence } from "./types";

/**
 * Build a deep link into Google Maps' Street View experience for the stored
 * panorama/location evidence. No imagery is fetched or proxied by us — the
 * browser opens Google's own page directly.
 *
 * - With a Google panorama id (provider_reference): open that exact panorama.
 * - Otherwise with coordinates: open the Street View layer at that location.
 * - With neither: null (no street-view action available).
 */
export function buildStreetViewUrl(evidence: VisualEvidence): string | null {
  const pano = evidence.provider_reference?.trim();
  if (pano) {
    return `https://www.google.com/maps/@?api=1&map_action=pano&pano=${encodeURIComponent(pano)}`;
  }
  if (
    evidence.latitude !== null &&
    evidence.latitude !== undefined &&
    evidence.longitude !== null &&
    evidence.longitude !== undefined
  ) {
    return `https://www.google.com/maps?layer=c&cbll=${evidence.latitude},${evidence.longitude}`;
  }
  return null;
}

/** Human label for the capture date, honouring the stored precision. */
export function formatCaptureDate(evidence: VisualEvidence): string {
  if (!evidence.captured_at) return "Unknown";
  const captured = new Date(evidence.captured_at);
  if (Number.isNaN(captured.getTime())) return "Unknown";

  switch (evidence.capture_date_precision) {
    case "month":
      return captured.toLocaleDateString(undefined, { year: "numeric", month: "long" });
    case "year":
      return String(captured.getFullYear());
    case "exact":
      return captured.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
    default:
      return "Unknown";
  }
}

/**
 * Whole months between the capture date and `now` (defaults to the current
 * time). Month/year-precision captures are stored as first-of-month/first-of-
 * year so this is an approximation — deliberately so; capture age is
 * commercially material but never falsely precise.
 */
export function evidenceAgeMonths(evidence: VisualEvidence, now: Date = new Date()): number | null {
  if (!evidence.captured_at) return null;
  const captured = new Date(evidence.captured_at);
  if (Number.isNaN(captured.getTime())) return null;
  const msPerMonth = 1000 * 60 * 60 * 24 * 30.44;
  return Math.max(0, Math.floor((now.getTime() - captured.getTime()) / msPerMonth));
}

/** Human evidence-age string derived from the capture date, or null if unknown. */
export function formatEvidenceAge(evidence: VisualEvidence, now: Date = new Date()): string | null {
  const months = evidenceAgeMonths(evidence, now);
  if (months === null) return null;
  if (months < 1) return "Captured less than a month ago";
  if (months < 12) return `Captured ${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.floor(months / 12);
  return `Captured ${years} year${years === 1 ? "" : "s"} ago`;
}

/**
 * True when the evidence must NOT be submitted to automated vision analysis:
 * either analysis is explicitly disallowed, or it is only referenced remotely
 * (never persisted as managed evidence).
 */
export function isReferenceOnly(evidence: VisualEvidence): boolean {
  return !evidence.analysis_allowed || evidence.storage_mode === "reference_only";
}

/**
 * Canonical categories for future visual-condition findings. Mirrors the CHECK
 * constraint on `local_business_visual_findings.category` in the shared MGRNZ
 * schema. Not yet produced by any classifier — this is the contract the later
 * visual analysis stage will write into, with provenance back to an evidence id.
 */
export const VISUAL_FINDING_CATEGORIES = [
  "fencing",
  "gates",
  "letterbox",
  "mowing",
  "gardening",
  "landscaping",
  "concreting",
  "waterblasting",
  "exterior_paint",
  "windows",
  "exterior_cleaning",
] as const;

export type VisualFindingCategory = (typeof VISUAL_FINDING_CATEGORIES)[number];

/** Operator-facing labels for the finding categories (used by future UI). */
export const VISUAL_FINDING_CATEGORY_LABELS: Record<VisualFindingCategory, string> = {
  fencing: "Fencing",
  gates: "Gates",
  letterbox: "Letterbox",
  mowing: "Mowing",
  gardening: "Gardening",
  landscaping: "Landscaping",
  concreting: "Concreting",
  waterblasting: "Waterblasting",
  exterior_paint: "Exterior house painting",
  windows: "Window repair / replacement",
  exterior_cleaning: "Exterior cleaning",
};
