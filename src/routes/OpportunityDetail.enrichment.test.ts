import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve("src/routes/OpportunityDetail.tsx"),
  "utf8",
);

describe("OpportunityDetail enrichment polling contract", () => {
  it("shows running state and conservative polling controls", () => {
    expect(source).toContain("Enrichment running…");
    expect(source).toContain("Refresh status");
    expect(source).toContain(
      "Enrichment is still processing. Refresh to check status.",
    );
    expect(source).toContain("ENRICHMENT_POLL_INTERVAL_MS");
    expect(source).toContain("ENRICHMENT_POLL_TIMEOUT_MS");
    expect(source).toContain("setInterval(");
    expect(source).toContain("setTimeout(");
    expect(source).toContain('enrichment_status === "enriching"');
  });

  it("refreshes detail silently while enrichment is in flight and stops on terminal states", () => {
    expect(source).toContain("load({ silent: true })");
    expect(source).toContain("isEnrichmentRunning");
    expect(source).toContain(
      'enrichmentRunning ? "Enrichment running…" : hasEnrichment ? "Ready" : "Not enriched"',
    );
    expect(source).toMatch(/enrichmentRunning\s*\?\s*"Refresh status"/);
    expect(source).toContain('enrichmentStatus === "enriched"');
    expect(source).toContain('enrichmentStatus === "partial"');
    expect(source).toContain("hasEnrichmentDiagnostics(detail)");
  });
});
