import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20261107090000_outreach_architecture_reconciliation.sql", "utf8");
const handler = readFileSync("supabase/functions/opportunities/index.ts", "utf8");

describe("authoritative outreach architecture", () => {
  it("retires legacy send RPCs without dropping historical claims", () => {
    expect(migration).toContain("legacy_send_path_disabled");
    expect(migration).toContain("historical_classification");
    expect(migration).toContain("on delete restrict");
    expect(migration).toContain("opportunity_outreach_send_attempts");
    expect(migration).toContain("historical_classification");
    expect(migration).toContain("legacy_approval_missing_or_incomplete_provenance");
    expect(migration).toContain("revoke all on public.opportunity_outreach_send_attempts from public, anon, authenticated, service_role");
  });

  it("uses the canonical claim/start/finish lifecycle in the send route", () => {
    expect(handler).toContain('rpc("opportunity_claim_outreach_send"');
    expect(handler).toContain('rpc("opportunity_start_outreach_send"');
    expect(handler).toContain('rpc("opportunity_finish_outreach_send"');
    expect(handler).not.toContain('rpc("claim_scenario_outreach_send"');
    expect(handler).not.toContain('rpc("complete_scenario_outreach_send"');
  });

  it("binds approval to immutable provenance and a fingerprint", () => {
    for (const field of ["approved_current_assessment_id", "approved_scenario_report_id", "approved_audit_report_id", "approved_recipient", "approved_destination_url", "approval_fingerprint"]) {
      expect(migration).toContain(field);
      expect(handler).toContain(field);
    }
    expect(handler).toContain("approvalProvenance");
    expect(migration).toContain("send_unknown");
    expect(migration).toContain("send_attempt_snapshot_immutable");
    expect(migration).toContain("commercial_snapshot_mismatch");
    expect(migration).toContain("outreach_send_uncertain");
    expect(migration).toContain("reconciliation_reason_required");
    expect(handler).toContain('.eq("lead_id",id)');
  });
});
