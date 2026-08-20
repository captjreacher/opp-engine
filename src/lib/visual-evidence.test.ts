import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VisualEvidence } from "./types";
import {
  buildStreetViewUrl,
  evidenceAgeMonths,
  formatCaptureDate,
  formatEvidenceAge,
  isReferenceOnly,
  VISUAL_FINDING_CATEGORIES,
} from "./visualEvidence";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const streetViewEvidence: VisualEvidence = {
  id: "3c55d612-884c-4a62-8a63-6854fd78cf81",
  source: "google_street_view",
  media_type: "panorama",
  provider_reference: "9V15f8xRmpXBqOoJEiFYaA",
  source_url: null,
  latitude: -36.774245557787,
  longitude: 174.537471881679,
  heading: null,
  pitch: null,
  captured_at: "2025-08-01T00:00:00+00:00",
  capture_date_precision: "month",
  discovered_at: "2026-08-10T00:00:00+00:00",
  analysis_allowed: false,
  storage_mode: "reference_only",
  metadata: {},
  status: "available",
  created_at: "2026-08-10T00:00:00+00:00",
  updated_at: "2026-08-10T00:00:00+00:00",
};

const analysableEvidence: VisualEvidence = {
  ...streetViewEvidence,
  id: "b2b2b2b2-0000-4000-8000-000000000002",
  source: "operator_upload",
  media_type: "image",
  provider_reference: null,
  source_url: "https://example.com/operator/photo.jpg",
  analysis_allowed: true,
  storage_mode: "managed",
};

// ── Pure helpers: Street View deep link (no image fetch/proxy) ───────────────

describe("buildStreetViewUrl", () => {
  it("opens the exact panorama when a provider reference (panorama id) is stored", () => {
    expect(buildStreetViewUrl(streetViewEvidence)).toBe(
      "https://www.google.com/maps/@?api=1&map_action=pano&pano=9V15f8xRmpXBqOoJEiFYaA",
    );
  });

  it("opens the Street View layer at the stored coordinates when no panorama id exists", () => {
    const coordOnly: VisualEvidence = { ...streetViewEvidence, provider_reference: null };
    expect(buildStreetViewUrl(coordOnly)).toBe(
      "https://www.google.com/maps?layer=c&cbll=-36.774245557787,174.537471881679",
    );
  });

  it("returns null when neither a panorama id nor coordinates are stored (no action)", () => {
    const empty: VisualEvidence = {
      ...streetViewEvidence,
      provider_reference: null,
      latitude: null,
      longitude: null,
    };
    expect(buildStreetViewUrl(empty)).toBeNull();
  });

  it("only ever points at Google's own Maps/Street View page (never our backend)", () => {
    const url = buildStreetViewUrl(streetViewEvidence);
    expect(url).toMatch(/^https:\/\/www\.google\.com\/maps/);
    expect(url).not.toContain("streetview");
    expect(url).not.toContain("data:");
    expect(url).not.toContain("blob:");
  });
});

// ── Pure helpers: reference-only governance ──────────────────────────────────

describe("isReferenceOnly", () => {
  it("flags Google Street View evidence as reference-only", () => {
    expect(isReferenceOnly(streetViewEvidence)).toBe(true);
  });

  it("does not flag managed analysable evidence", () => {
    expect(isReferenceOnly(analysableEvidence)).toBe(false);
  });

  it("flags evidence as reference-only when only storage_mode is reference_only", () => {
    expect(
      isReferenceOnly({ ...analysableEvidence, storage_mode: "reference_only" }),
    ).toBe(true);
  });

  it("flags evidence as reference-only when only analysis is disallowed", () => {
    expect(
      isReferenceOnly({ ...analysableEvidence, analysis_allowed: false }),
    ).toBe(true);
  });
});

// ── Pure helpers: capture date / age display ─────────────────────────────────

describe("capture date and age formatting", () => {
  it("formats a month-precision capture as month + year", () => {
    expect(formatCaptureDate(streetViewEvidence)).toBe("August 2025");
  });

  it("formats a year-precision capture as year only", () => {
    expect(
      formatCaptureDate({ ...streetViewEvidence, capture_date_precision: "year" }),
    ).toBe("2025");
  });

  it("formats an exact capture with day precision", () => {
    // Day/month ordering is locale-dependent (en-NZ renders day-first), so
    // assert on the parts rather than a single fixed string.
    const exact = formatCaptureDate({
      ...streetViewEvidence,
      captured_at: "2025-08-14T00:00:00+00:00",
      capture_date_precision: "exact",
    });
    expect(exact).toContain("August");
    expect(exact).toContain("14");
    expect(exact).toContain("2025");
  });

  it("returns Unknown for null captures", () => {
    expect(formatCaptureDate({ ...streetViewEvidence, captured_at: null })).toBe("Unknown");
  });

  it("derives evidence age in months from the capture date", () => {
    const now = new Date("2026-08-10T00:00:00+00:00");
    expect(evidenceAgeMonths(streetViewEvidence, now)).toBe(12);
    expect(formatEvidenceAge(streetViewEvidence, now)).toBe("Captured 1 year ago");
  });

  it("returns null age when no capture date exists", () => {
    expect(formatEvidenceAge({ ...streetViewEvidence, captured_at: null })).toBeNull();
  });
});

// ── API client: addAnalysableEvidence contract ───────────────────────────────

describe("addAnalysableEvidence API client", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubEnv("VITE_API_BASE", "https://api.example.com");
    vi.stubEnv("VITE_OPERATOR_TOKEN", "test-operator-token");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("POSTs to /{id}/visual-evidence with the supplied contract payload", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      text: () => Promise.resolve(JSON.stringify({ evidence: analysableEvidence })),
    });
    globalThis.fetch = mockFetch;

    const { addAnalysableEvidence } = await import("./api");
    const res = await addAnalysableEvidence("lead-1", {
      source_url: "https://example.com/operator/photo.jpg",
      source: "operator_upload",
      captured_at: "2025-08-01T00:00:00.000Z",
      capture_date_precision: "month",
      latitude: -36.774245557787,
      longitude: 174.537471881679,
    });

    expect(res.evidence.id).toBe(analysableEvidence.id);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toBe("https://api.example.com/lead-1/visual-evidence");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      source_url: "https://example.com/operator/photo.jpg",
      source: "operator_upload",
      captured_at: "2025-08-01T00:00:00.000Z",
      capture_date_precision: "month",
      latitude: -36.774245557787,
      longitude: 174.537471881679,
    });
  });
});

// ── Structural contract: Visual Evidence panel ───────────────────────────────

describe("Visual Evidence panel (component contract)", () => {
  const panelSource = readFileSync(resolve("src/components/VisualEvidencePanel.tsx"), "utf8");
  const detailSource = readFileSync(resolve("src/routes/OpportunityDetail.tsx"), "utf8");

  it("renders a clearly identifiable Visual Evidence section", () => {
    expect(panelSource).toContain("Visual Evidence");
    expect(detailSource).toContain("<VisualEvidencePanel");
    expect(detailSource).toContain("evidence={detail.visual_evidence ?? []}");
  });

  it("renders Street View evidence with source, provider, capture date, age and coordinates", () => {
    expect(panelSource).toContain("Google Street View");
    expect(panelSource).toContain("Provider reference");
    expect(panelSource).toContain("Capture date");
    expect(panelSource).toContain("Evidence age");
    expect(panelSource).toContain("Location");
  });

  it("marks reference-only evidence as visibly non-analysable", () => {
    expect(panelSource).toContain("Reference only — not available for AI analysis");
    expect(panelSource).toContain("Reference only");
    // The analysable state must be a distinct, separately rendered state
    expect(panelSource).toContain("Analysable");
  });

  it("exposes the Open Street View operator action", () => {
    expect(panelSource).toContain("Open Street View");
    // The action is only rendered for google_street_view evidence with a usable deep link
    expect(panelSource).toContain('evidence.source === "google_street_view" ? buildStreetViewUrl(evidence) : null');
  });

  it("exposes the Add analysable image operator action", () => {
    expect(panelSource).toContain("Add analysable image");
    expect(panelSource).toContain("addAnalysableEvidence(leadId, {");
  });

  it("never downloads, proxies or embeds Street View imagery in the frontend", () => {
    // No <img> element rendering evidence imagery
    expect(panelSource).not.toContain("<img");
    // No fetch of the evidence source URL
    expect(panelSource).not.toContain("fetch(");
    // No anchor with an HTML download attribute (would save image bytes locally)
    expect(panelSource).not.toMatch(/<a\b[^>]*\sdownload\s*=/);
    // No object URLs or blob/data URIs
    expect(panelSource).not.toContain("createObjectURL");
    expect(panelSource).not.toContain("blob:");
    expect(panelSource).not.toContain("data:");
    // The Street View link target is Google's own page (built by the helper),
    // never a backend proxy endpoint.
    expect(panelSource).not.toContain("streetview-proxy");
    expect(panelSource).not.toContain("proxy");
    expect(panelSource).not.toContain("VITE_API_BASE");
  });

  it("can only create NEW analysable evidence — never convert reference-only rows", () => {
    // The add form takes leadId + a fresh source_url and always calls the
    // analysable endpoint; it holds no reference to an existing evidence row.
    expect(panelSource).not.toMatch(/addAnalysableEvidence\([^)]*evidence/);
    expect(panelSource).toContain("interface AddAnalysableFormProps {\n  leadId: string;");
    // The UI copy makes the boundary explicit
    expect(panelSource).toContain("the app does not upload image files directly");
  });

  it("declares the future findings contract without hard-coding fake findings", () => {
    // The canonical category contract lives in visualEvidence.ts (mirrors the
    // shared schema CHECK constraint); the panel renders from it rather than
    // inventing its own list.
    const evidenceLib = readFileSync(resolve("src/lib/visualEvidence.ts"), "utf8");
    for (const category of VISUAL_FINDING_CATEGORIES) {
      expect(evidenceLib).toContain(category);
    }
    expect(panelSource).toContain("VISUAL_FINDING_CATEGORIES");
    expect(panelSource).toContain("No findings are generated yet");
    expect(panelSource).not.toContain("finding: {");
    expect(panelSource).not.toContain("fencing: true");
  });
});

// ── Structural contract: backend (opportunities + visual-assess) ─────────────

describe("visual evidence backend contract", () => {
  const edgeSource = readFileSync(resolve("supabase/functions/opportunities/index.ts"), "utf8");
  const assessSource = readFileSync(resolve("supabase/functions/local-business-visual-assess/index.ts"), "utf8");

  it("GET /:id includes visual_evidence rows", () => {
    expect(edgeSource).toContain('supabase.from("local_business_visual_evidence")');
    expect(edgeSource).toContain("visual_evidence: visualEvidence.data ?? []");
  });

  it("routes POST /:id/visual-evidence to the analysable-evidence handler", () => {
    expect(edgeSource).toContain('parts[1] === "visual-evidence"');
    expect(edgeSource).toContain("addVisualEvidence(parts[0]");
  });

  it("creates analysable evidence only as NEW managed rows, never converting reference-only rows", () => {
    const handler = edgeSource.slice(
      edgeSource.indexOf("async function addVisualEvidence"),
      edgeSource.indexOf("// ---- Router"),
    );
    expect(handler).toContain("analysis_allowed: true");
    expect(handler).toContain('storage_mode: "managed"');
    // The source is restricted to operator/licensed inputs
    expect(handler).toContain('"licensed_external" ? "licensed_external" : "operator_upload"');
    // No UPDATE on existing evidence anywhere in the handler (no conversion path)
    expect(handler).not.toContain(".update(");
    // No image bytes are fetched, uploaded or proxied (note: "operator_upload"
    // and "licensed_external" are provenance literals, not upload mechanics)
    expect(handler).not.toContain("fetch(");
    expect(handler).not.toContain("storage.from");
    expect(handler).not.toContain("storage.upload");
    expect(handler).not.toContain(".upload(");
    expect(handler).not.toContain("createBucket");
  });

  it("Google Street View evidence is always written reference-only by the assess function", () => {
    // Both insert branches of the assess function must set the governance flags
    expect(assessSource).toContain("analysis_allowed: false,");
    expect(assessSource).toContain('storage_mode: "reference_only",');
    // The function only calls Google's Places + Street View METADATA APIs — no image bytes
    expect(assessSource).toContain("places.googleapis.com/v1/places:searchText");
    expect(assessSource).toContain("maps.googleapis.com/maps/api/streetview/metadata");
    expect(assessSource).not.toContain("streetview?");
    expect(assessSource).not.toContain("storage.from");
    expect(assessSource).not.toContain("createObjectURL");
  });
});
