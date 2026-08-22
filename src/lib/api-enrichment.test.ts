import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("enrichment API contract", () => {
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

  it("treats 202 Accepted as a successful enrichment request", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            ok: true,
            status: "accepted",
            lead_id: "lead-1",
            enrichment_status: "enriching",
          }),
        ),
    });

    const { enrichOpportunity } = await import("./api");
    await expect(enrichOpportunity("lead-1")).resolves.toEqual({
      ok: true,
      status: "accepted",
      lead_id: "lead-1",
      enrichment_status: "enriching",
    });
  });
});
