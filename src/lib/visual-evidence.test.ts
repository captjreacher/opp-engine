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

describe("Visual evidence helpers", () => {
  it("opens the exact panorama when provider_reference exists", () => {
    expect(buildStreetViewUrl(streetViewEvidence)).toBe(
      "https://www.google.com/maps/@?api=1&map_action=pano&pano=9V15f8xRmpXBqOoJEiFYaA",
    );
  });

  it("falls back to a coordinates Street View URL when no panorama id exists", () => {
    expect(
      buildStreetViewUrl({
        ...streetViewEvidence,
        provider_reference: null,
      }),
    ).toBe("https://www.google.com/maps?layer=c&cbll=-36.774245557787,174.537471881679");
  });

  it("never builds a proxy or image URL", () => {
    const url = buildStreetViewUrl(streetViewEvidence);
    expect(url).toMatch(/^https:\/\/www\.google\.com\/maps/);
    expect(url).not.toContain("streetview");
    expect(url).not.toContain("blob:");
    expect(url).not.toContain("data:");
  });

  it("formats capture precision and evidence age correctly", () => {
    expect(formatCaptureDate(streetViewEvidence)).toBe("August 2025");
    expect(
      formatCaptureDate({
        ...streetViewEvidence,
        capture_date_precision: "year",
      }),
    ).toBe("2025");

    const exact = formatCaptureDate({
      ...streetViewEvidence,
      captured_at: "2025-08-14T00:00:00+00:00",
      capture_date_precision: "exact",
    });
    expect(exact).toContain("August");
    expect(exact).toContain("14");
    expect(exact).toContain("2025");

    const now = new Date("2026-08-10T00:00:00+00:00");
    expect(evidenceAgeMonths(streetViewEvidence, now)).toBe(12);
    expect(formatEvidenceAge(streetViewEvidence, now)).toBe("Captured 1 year ago");
  });

  it("treats analysis-disallowed rows as reference-only", () => {
    expect(isReferenceOnly(streetViewEvidence)).toBe(true);
    expect(isReferenceOnly(analysableEvidence)).toBe(false);
    expect(
      isReferenceOnly({ ...analysableEvidence, analysis_allowed: false }),
    ).toBe(true);
  });
});

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

  it("POSTs the explicit analysable-evidence payload to /visual-evidence", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      text: () =>
        Promise.resolve(JSON.stringify({ evidence: analysableEvidence })),
    });

    globalThis.fetch = mockFetch;

    const { addAnalysableEvidence } = await import("./api");
    const res = await addAnalysableEvidence("lead-1", {
      source_url: "https://example.com/operator/photo.jpg",
      source: "operator_upload",
      captured_at: "2025-08-01T00:00:00.000Z",
      capture_date_precision: "exact",
      latitude: -36.774245557787,
      longitude: 174.537471881679,
    });

    expect(res.evidence.id).toBe(analysableEvidence.id);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toBe("https://api.example.com/lead-1/visual-evidence");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      source_url: "https://example.com/operator/photo.jpg",
      source: "operator_upload",
      captured_at: "2025-08-01T00:00:00.000Z",
      capture_date_precision: "exact",
      latitude: -36.774245557787,
      longitude: 174.537471881679,
    });
  });
});

describe("Visual evidence UI contract", () => {
  const panelSource = readFileSync(
    resolve("src/components/VisualEvidencePanel.tsx"),
    "utf8",
  );
  const detailSource = readFileSync(
    resolve("src/routes/OpportunityDetail.tsx"),
    "utf8",
  );
  const evidenceLib = readFileSync(resolve("src/lib/visualEvidence.ts"), "utf8");

  it("renders the VisualEvidencePanel on the opportunity detail page", () => {
    expect(detailSource).toContain("<VisualEvidencePanel");
    expect(detailSource).toContain("evidence={detail.visual_evidence ?? []}");
  });

  it("keeps Street View evidence reference-only and deep-linked", () => {
    expect(panelSource).toContain("Reference only — not available for AI analysis");
    expect(panelSource).toContain("Open Street View");
    expect(panelSource).toMatch(
      /evidence\.source === "google_street_view"\s*\?\s*buildStreetViewUrl\(evidence\)\s*:\s*null/,
    );
  });

  it("exposes the Add analysable image operator action", () => {
    expect(panelSource).toContain("Add analysable image");
    expect(panelSource).toContain("addAnalysableEvidence(leadId, {");
  });

  it("never downloads, proxies, or embeds Street View imagery", () => {
    expect(panelSource).not.toContain("<img");
    expect(panelSource).not.toContain("fetch(");
    expect(panelSource).not.toMatch(/<a\b[^>]*\sdownload\s*=/);
    expect(panelSource).not.toContain("createObjectURL");
    expect(panelSource).not.toContain("blob:");
    expect(panelSource).not.toContain("data:");
    expect(panelSource).not.toContain("streetview-proxy");
    expect(panelSource).not.toContain("VITE_API_BASE");
  });

  it("can only create NEW analysable evidence rows", () => {
    expect(panelSource).not.toMatch(/addAnalysableEvidence\([^)]*evidence/);
    expect(panelSource).toMatch(
      /interface AddAnalysableFormProps\s*\{\s*leadId: string;/,
    );
    expect(panelSource).toContain("the app does not upload image files directly");
  });

  it("declares the future findings contract without inventing fake findings", () => {
    for (const category of VISUAL_FINDING_CATEGORIES) {
      expect(evidenceLib).toContain(category);
    }

    expect(panelSource).toContain("VISUAL_FINDING_CATEGORIES");
    expect(panelSource).toContain("No findings are generated yet");
    expect(panelSource).not.toContain("finding: {");
    expect(panelSource).not.toContain("fencing: true");
  });
});

describe("Visual evidence backend contract", () => {
  const edgeSource = readFileSync(
    resolve("supabase/functions/opportunities/index.ts"),
    "utf8",
  );
  const assessSource = readFileSync(
    resolve("supabase/functions/local-business-visual-assess/index.ts"),
    "utf8",
  );

  it("GET /:id includes visual_evidence rows in the detail response", () => {
    expect(edgeSource).toContain('.from("local_business_visual_evidence")');
    expect(edgeSource).toContain("visual_evidence: visualEvidence.data ?? []");
  });

  it("routes POST /:id/visual-evidence to addVisualEvidence", () => {
    expect(edgeSource).toMatch(/parts\[1\]\s*===\s*"visual-evidence"/);
    expect(edgeSource).toMatch(
      /return await addVisualEvidence\([\s\S]{0,120}parts\[0\][\s\S]{0,200}req\.json\(\)\.catch\(\(\)\s*=>\s*\(\{\}\)\)/,
    );
  });

  it("creates analysable evidence only as NEW managed rows", () => {
    const handler = edgeSource.slice(
      edgeSource.indexOf("async function addVisualEvidence"),
      edgeSource.indexOf("// ---- Router"),
    );

    expect(handler).toContain("analysis_allowed: true");
    expect(handler).toContain('storage_mode: "managed"');
    expect(handler).toMatch(
      /payload\.source === "licensed_external"[\s\S]{0,80}\?\s*"licensed_external"[\s\S]{0,80}:\s*"operator_upload"/,
    );
    expect(handler).not.toContain(".update(");
    expect(handler).not.toContain("fetch(");
    expect(handler).not.toContain("storage.from");
    expect(handler).not.toContain("storage.upload");
    expect(handler).not.toContain(".upload(");
    expect(handler).not.toContain("createBucket");
  });

  it("keeps Google Street View evidence reference-only in the assess function", () => {
    expect(assessSource).toContain("analysis_allowed: false,");
    expect(assessSource).toContain('storage_mode: "reference_only",');
    expect(assessSource).toContain("places.googleapis.com/v1/places:searchText");
    expect(assessSource).toContain(
      "maps.googleapis.com/maps/api/streetview/metadata",
    );
    expect(assessSource).not.toContain("streetview?");
    expect(assessSource).not.toContain("storage.from");
    expect(assessSource).not.toContain("createObjectURL");
  });
});
