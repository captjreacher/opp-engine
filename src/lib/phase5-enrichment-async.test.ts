import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const opportunitiesSource = readFileSync(
  resolve("supabase/functions/opportunities/index.ts"),
  "utf8",
);

describe("async enrichment backend contract", () => {
  it("accepts enrichment requests immediately and schedules work in the background", () => {
    const routeBlock = opportunitiesSource.slice(
      opportunitiesSource.indexOf('if (req.method === "POST" && parts.length === 2 && parts[1] === "enrich")'),
      opportunitiesSource.indexOf('if (req.method === "POST" && parts.length === 2 && parts[1] === "assess")'),
    );

    expect(routeBlock).toContain("requestOpportunityEnrichment");
    expect(routeBlock).not.toContain("runOpportunityEnrichment(parts[0]");
    expect(routeBlock).not.toContain("await runOpportunityEnrichment");
    expect(routeBlock).toContain('return await requestOpportunityEnrichment(parts[0], payload.retry === true);');
    expect(opportunitiesSource).toContain("runInBackground(runOpportunityEnrichment(leadId, retry));");
    expect(opportunitiesSource).toContain("runtime.EdgeRuntime.waitUntil(work);");
    expect(opportunitiesSource).toContain('status: "accepted"');
    expect(opportunitiesSource).toContain('enrichment_status: "enriching"');
    expect(opportunitiesSource).toContain('error: "enrichment_in_progress"');
  });
});
