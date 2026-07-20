import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const edgeSource = readFileSync(resolve("supabase/functions/opportunities/index.ts"), "utf8");
const migration = readFileSync(resolve("supabase/migrations/20260720052820_phase_5_discovery.sql"), "utf8");

describe("Phase 5 backend contract", () => {
  it("authenticates before all data routes", () => {
    expect(edgeSource.indexOf("if (!authorized(req))")).toBeLessThan(edgeSource.indexOf("if (req.method === \"GET\" && parts.length === 0)"));
    expect(edgeSource).toContain("if (!OPERATOR_TOKEN) return false");
  });

  it.each([
    "discovery-runs", "candidates\" && parts[3] === \"import", "candidates\" && parts[3] === \"assess",
    "candidates\" && parts[3] === \"audit", "parts[1] === \"assess", "parts[1] === \"audit",
  ])("contains route contract %s", (route) => expect(edgeSource).toContain(route));

  it("enforces duplicate-safe transactional imports and idempotent artifacts", () => {
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("if v_candidate.imported_lead_id is not null");
    expect(edgeSource).toContain("eq(\"assessment_id\", assessment.id)");
    expect(edgeSource).toContain("eq(\"report_version\", AUDIT_REPORT_VERSION)");
  });

  it("reports partial batches and keeps intelligence actions away from SMTP", () => {
    expect(edgeSource).toContain("partial: failed > 0");
    const phase5Block = edgeSource.slice(edgeSource.indexOf("Discovery / intelligence orchestration"), edgeSource.indexOf("Existing opportunity / outreach handlers"));
    expect(phase5Block).not.toContain("sendSmtpEmail");
    expect(phase5Block).not.toContain("local_business_outreach_drafts");
  });
});
