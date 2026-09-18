import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationSource = readFileSync(
  resolve(
    "supabase/migrations/20260913120000_opportunity_possible_match_acknowledgement.sql",
  ),
  "utf8",
).replace(/\r\n/g, "\n");

const edgeSource = readFileSync(
  resolve("supabase/functions/opportunities/index.ts"),
  "utf8",
).replace(/\r\n/g, "\n");

function acknowledgementRpcBlock(): string {
  const start = migrationSource.indexOf(
    "function public.opportunity_acknowledge_possible_match",
  );
  const end = migrationSource.indexOf(
    "-- ── Candidate import gate",
    start,
  );
  return start === -1 ? "" : migrationSource.slice(start, end === -1 ? undefined : end);
}

function countOccurrences(source: string, needle: string): number {
  let count = 0;
  let index = source.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = source.indexOf(needle, index + needle.length);
  }
  return count;
}

describe("possible_match acknowledgement persistence", () => {
  it("adds only the minimum acknowledgement fields", () => {
    expect(migrationSource).toContain(
      "eligibility_acknowledged boolean not null default false",
    );
    expect(migrationSource).toContain("eligibility_acknowledged_at timestamptz");
    expect(migrationSource).toContain("eligibility_acknowledged_by text");
    expect(migrationSource).toContain(
      "alter table public.opportunity_discovery_candidates",
    );
  });

  it("does not introduce a generic risk framework or Cockpit RiskRegister", () => {
    expect(migrationSource).not.toContain("risk_register");
    expect(migrationSource).not.toContain("RiskRegister");
    expect(edgeSource).not.toContain("RiskRegister");
  });

  it("encodes the gate as eligible OR acknowledged possible_match with hard blocks immutable", () => {
    expect(migrationSource).toContain(
      "public.opportunity_classification_allows_progress",
    );
    expect(migrationSource).toMatch(
      /when p_classification = 'eligible' then true/,
    );
    expect(migrationSource).toMatch(
      /when p_classification = 'possible_match' then coalesce\(p_possible_match_acknowledged, false\)/,
    );
    expect(migrationSource).toMatch(/\n\s*else false\n\s*end;/);
  });

  it("acknowledges idempotently without duplicating the audit event", () => {
    const block = acknowledgementRpcBlock();
    expect(block).not.toBe("");
    expect(block).toContain("if v_candidate.eligibility_acknowledged then");
    expect(block).toContain("'idempotent', true");
    const guard = block.indexOf("if v_candidate.eligibility_acknowledged then");
    const eventInsert = block.indexOf("insert into public.events");
    expect(guard).toBeGreaterThan(-1);
    expect(eventInsert).toBeGreaterThan(guard);
  });

  it("keeps the possible_match classification and never rewrites it to eligible", () => {
    const block = acknowledgementRpcBlock();
    expect(block).toContain("'classification', 'possible_match'");
    expect(block).not.toContain("'eligible'");
    expect(block).not.toContain("eligibility_result =");
  });

  it("records an immutable acknowledgement event with match identity metadata", () => {
    expect(migrationSource).toContain(
      "opportunity.prospect_possible_match_acknowledged",
    );
    const block = acknowledgementRpcBlock();
    for (const key of [
      "'candidate_id'",
      "'run_id'",
      "'source_lead_id'",
      "'contact_id'",
      "'organisation_id'",
      "'classification'",
      "'match_type'",
      "'confidence'",
      "'reason'",
      "'acknowledged_at'",
      "'acknowledged_by'",
    ]) {
      expect(block).toContain(key);
    }
    expect(block).toContain("'opportunity_discovery_candidate'");
  });

  it("keeps the possible_match status as review_required while allowing progress", () => {
    expect(migrationSource).toMatch(
      /when v_classification = 'possible_match' then 'review_required'/,
    );
  });
});

describe("possible_match acknowledgement gating", () => {
  it("applies the shared predicate to import, scoring/audit and outreach", () => {
    expect(
      countOccurrences(migrationSource, "opportunity_classification_allows_progress("),
    ).toBeGreaterThanOrEqual(3);
  });

  it("requires acknowledgement before candidate import", () => {
    expect(migrationSource).toContain(
      "candidate_requires_possible_match_acknowledgement",
    );
    expect(migrationSource).toContain("'requires_acknowledgement'");
  });

  it("requires acknowledgement before scoring/assessment and audit", () => {
    const workGate = migrationSource.slice(
      migrationSource.indexOf(
        "function public.opportunity_require_candidate_eligibility_before_work",
      ),
      migrationSource.indexOf(
        "── Outreach draft gate",
      ),
    );
    expect(workGate).toContain(
      "candidate_requires_possible_match_acknowledgement",
    );
    expect(workGate).toContain("new.eligibility_acknowledged");
  });

  it("requires acknowledgement before outreach draft creation", () => {
    const outreachGate = migrationSource.slice(
      migrationSource.indexOf(
        "function public.opportunity_require_lead_eligibility_before_outreach",
      ),
    );
    expect(outreachGate).toContain(
      "outreach_requires_possible_match_acknowledgement",
    );
    expect(outreachGate).toContain("c.eligibility_acknowledged");
  });

  it("keeps hard-block classifications non-overridable in every gate", () => {
    expect(migrationSource).toContain(
      "candidate_not_commercially_eligible",
    );
    expect(migrationSource).toContain("outreach_not_commercially_eligible");
    expect(migrationSource).toContain("else 'blocked'");
  });

  it("never treats possible_match as eligible in the API gate", () => {
    expect(edgeSource).toContain("function classificationAllowsProgress(");
    expect(edgeSource).toMatch(
      /if \(classification === "possible_match"\) return acknowledged === true;/,
    );
    expect(edgeSource).toContain("function candidateNeedsAcknowledgement(");
  });

  it("persists the acknowledgement through a service-role RPC, not the UI", () => {
    expect(edgeSource).toContain(
      'supabase.rpc(\n    "opportunity_acknowledge_possible_match"',
    );
    expect(edgeSource).toContain('parts[0] === "discovery-candidates"');
    expect(edgeSource).toContain('parts[2] === "acknowledge"');
    expect(edgeSource).toContain("async function acknowledgeCandidate(");
    expect(migrationSource).toContain(
      "revoke all on function public.opportunity_acknowledge_possible_match",
    );
  });

  it("rejects unacknowledged possible_match in discovery batch work and outreach", () => {
    expect(edgeSource).toContain(
      '"candidate_requires_possible_match_acknowledgement"',
    );
    expect(edgeSource).toContain(
      '"outreach_requires_possible_match_acknowledgement"',
    );
  });

  it("does not alter live-send Cockpit handoff behaviour", () => {
    expect(edgeSource).not.toContain("ingest_outbound_prospect");
    expect(migrationSource).not.toContain("opportunity_attempt_cockpit_handoff");
    expect(migrationSource).not.toContain("ingest_outbound_prospect");
  });
});
