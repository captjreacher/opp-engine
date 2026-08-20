import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const edgeSource = readFileSync(resolve("supabase/functions/opportunities/index.ts"), "utf8");
const migration = readFileSync(resolve("supabase/migrations/20260720052820_phase_5_discovery.sql"), "utf8");
const enrichSource = readFileSync(resolve("supabase/functions/local-business-enrich/index.ts"), "utf8");

function failureBranchBlock(): string {
  const start = enrichSource.indexOf("enrichment_failure");
  if (start === -1) return "";
  const catchIdx = enrichSource.lastIndexOf("catch (error)", start);
  if (catchIdx === -1) return "";
  const end = enrichSource.indexOf("if (import.meta.main)", catchIdx);
  return end !== -1 ? enrichSource.slice(catchIdx, end) : enrichSource.slice(catchIdx);
}

function findRPCDotCatch(source: string): string[] {
  const results: string[] = [];
  let idx = 0;
  while (idx < source.length) {
    const rpcStart = source.indexOf("supabase.rpc", idx);
    if (rpcStart === -1) break;
    const tail = source.slice(rpcStart, Math.min(rpcStart + 200, source.length));
    if (tail.includes(".catch(")) {
      results.push(`line ${source.slice(0, rpcStart).split("\n").length}: ...${tail.slice(Math.max(0, tail.length - 80))}...`);
    }
    idx = rpcStart + 1;
  }
  return results;
}

describe("Phase 5 backend contract", () => {
  it("authenticates before all data routes", () => {
    expect(edgeSource.indexOf('if (!authorized(req))')).toBeLessThan(edgeSource.indexOf('if (req.method === "GET" && parts.length === 0)'));
    expect(edgeSource).toContain("if (!OPERATOR_TOKEN) return false");
  });

  it.each([
    'discovery-runs',
    'candidates" && parts[3] === "import',
    'candidates" && parts[3] === "assess',
    'candidates" && parts[3] === "audit',
    'parts[1] === "assess',
    'parts[1] === "audit',
  ])("contains route contract %s", (route) => expect(edgeSource).toContain(route));

  it("enforces duplicate-safe transactional imports and idempotent artifacts", () => {
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("if v_candidate.imported_lead_id is not null");
    expect(edgeSource).toContain('eq("assessment_id", assessment.id)');
    expect(edgeSource).toContain('eq("report_version", AUDIT_REPORT_VERSION)');
  });

  it("reports partial batches and keeps intelligence actions away from SMTP", () => {
    expect(edgeSource).toContain("partial: failed > 0");
    const phase5Block = edgeSource.slice(
      edgeSource.indexOf("Discovery / intelligence orchestration"),
      edgeSource.indexOf("Existing opportunity / outreach handlers"),
    );
    expect(phase5Block).not.toContain("sendSmtpEmail");
    expect(phase5Block).not.toContain("local_business_outreach_drafts");
  });
});

describe("edge function RPC error handling", () => {
  it("never chains .catch() directly on supabase.rpc()", () => {
    const violations = findRPCDotCatch(edgeSource);
    expect(violations).toEqual([]);
  });

  it("assessOpportunity catch block uses const { error } = await supabase.rpc(...)", () => {
    const failEventLine = edgeSource.indexOf("Failed to emit assessment_failed event for lead");
    expect(failEventLine).toBeGreaterThan(-1);

    const blockBefore = edgeSource.slice(Math.max(0, failEventLine - 300), failEventLine);
    expect(blockBefore).toContain("supabase.rpc");
    expect(blockBefore).not.toContain(".catch(");
  });

  it("emitWorkflowEvent .catch() chains on a Promise (safe pattern)", () => {
    const lines = edgeSource.split("\n");
    const safeLines = lines.filter((line) => line.includes("emitWorkflowEvent") && line.includes(".catch("));
    expect(safeLines.length).toBeGreaterThan(0);
  });
});

describe("enrichment assessment contract", () => {
  it("partial enrichment inserts an assessment before returning", () => {
    const partialBlock = enrichSource.slice(
      enrichSource.indexOf("Partial: create assessment so callers"),
      enrichSource.indexOf('return jsonResponse({\n        ok: true,\n        status: "partial"', enrichSource.indexOf("Partial: create assessment so callers")),
    );
    expect(partialBlock).toContain("score(effective, result)");
    expect(partialBlock).toContain("insertAssessment(supabase");
    expect(partialBlock).toContain('errorLabel: "partial_assessment_insert_failed"');
  });

  it("partial assessment insert occurs before completed and partial events", () => {
    const partialStart = enrichSource.indexOf("Partial outcome: no meaningful signals after enrichment");
    const partialEnd = enrichSource.indexOf("// ── Success outcome", partialStart);
    const partialBranch = enrichSource.slice(partialStart, partialEnd);

    const assessmentInsertIdx = partialBranch.indexOf("insertAssessment(supabase");
    const completedEventIdx = partialBranch.indexOf("local_business.enrichment.completed");
    const partialEventIdx = partialBranch.indexOf("local_business.enrichment_partial");

    expect(assessmentInsertIdx).toBeGreaterThan(-1);
    expect(completedEventIdx).toBeGreaterThan(-1);
    expect(partialEventIdx).toBeGreaterThan(-1);
    expect(assessmentInsertIdx).toBeLessThan(completedEventIdx);
    expect(assessmentInsertIdx).toBeLessThan(partialEventIdx);
  });

  it("successful enrichment inserts an assessment without writing opportunity_score", () => {
    const successBlock = enrichSource.slice(
      enrichSource.indexOf("// ── Success outcome"),
      enrichSource.indexOf("if (assessedStatusError)", enrichSource.indexOf("// ── Success outcome")),
    );
    expect(successBlock).toContain("score(effective, result)");
    expect(successBlock).toContain("insertAssessment(supabase");
    expect(successBlock).toContain('errorLabel: "assessment_insert_failed"');
    expect(successBlock).not.toContain("opportunity_score: args.scoring");
  });

  it("failed enrichment does not insert an assessment", () => {
    const failureBlock = failureBranchBlock();
    expect(failureBlock).toContain('enrichment_status: "failed"');
    expect(failureBlock).not.toContain("local_business_lead_assessments");
  });

  it("partial assessment insert failure returns a useful error", () => {
    const catchStart = enrichSource.indexOf("catch (assessmentErr)");
    const catchEnd = enrichSource.indexOf('\n      log("enrichment_partial_assessment"', catchStart);
    const catchBlock = enrichSource.slice(catchStart, catchEnd);
    expect(catchBlock).toContain("ok: false");
    expect(catchBlock).toContain("assessmentErrMsg");
    expect(catchBlock).toContain("partial_assessment_insert_failed");
  });

  it("assessment payloads and logs use the persisted database opportunity score", () => {
    expect(enrichSource).toContain("opportunity_score: assessment.opportunity_score");
    expect(enrichSource).toContain("opportunity_score: partialAssessment.opportunity_score");
    expect(enrichSource).toContain("assessment_id: assessment.id");
    expect(enrichSource).toContain('log("enrichment_partial_assessment"');
    expect(enrichSource).toContain("scoring: persistedScoring");
  });

  it("removes the duplicate in-function opportunity score formula", () => {
    const scoreBlock = enrichSource.slice(
      enrichSource.indexOf("function score("),
      enrichSource.indexOf("async function insertAssessment("),
    );
    expect(scoreBlock).not.toContain("Math.round(");
    expect(scoreBlock).not.toContain("opportunity_score:");
  });

  it("writes only component scores into assessment persistence", () => {
    const helperBlock = enrichSource.slice(
      enrichSource.indexOf("async function insertAssessment("),
      enrichSource.indexOf("// ─────────────────────────────────────────────────────────────────────────────\n// Event emission"),
    );
    expect(helperBlock).toContain("demand_signal_score: args.scoring.demand_signal_score");
    expect(helperBlock).toContain("trust_leakage_score: args.scoring.trust_leakage_score");
    expect(helperBlock).toContain("conversion_maturity_score: args.scoring.conversion_maturity_score");
    expect(helperBlock).toContain("ai_readiness_score: args.scoring.ai_readiness_score");
    expect(helperBlock).not.toContain("opportunity_score: args.scoring");
  });
});
