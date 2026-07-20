import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const edgeSource = readFileSync(resolve("supabase/functions/opportunities/index.ts"), "utf8");
const migration = readFileSync(resolve("supabase/migrations/20260720052820_phase_5_discovery.sql"), "utf8");
const enrichSource = readFileSync(resolve("supabase/functions/local-business-enrich/index.ts"), "utf8");

/** Extract the failure branch block from the enrich source (the catch block in handler). */
function failureBranchBlock(): string {
  const start = enrichSource.indexOf("enrichment_failure");
  if (start === -1) return "";
  // go back to find the start of the catch block
  const catchIdx = enrichSource.lastIndexOf("catch (error)", start);
  if (catchIdx === -1) return "";
  // find the end — the next top-level `}` which closes the catch (heuristic: next `if (import.meta.main)` or end)
  const end = enrichSource.indexOf("if (import.meta.main)", catchIdx);
  return end !== -1 ? enrichSource.slice(catchIdx, end) : enrichSource.slice(catchIdx);
}

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

describe("enrichment assessment contract", () => {
  it("partial enrichment inserts an assessment before returning", () => {
    // The partial branch must call score() and insert into local_business_lead_assessments
    const partialBlock = enrichSource.slice(
      enrichSource.indexOf("Partial: create assessment so callers"),
      enrichSource.indexOf("return jsonResponse({\n        ok: true,\n        status: \"partial\"", enrichSource.indexOf("Partial: create assessment so callers")),
    );
    expect(partialBlock).toContain("score(effective, result)");
    expect(partialBlock).toContain("local_business_lead_assessments");
    expect(partialBlock).toContain("...partialScoring");
  });

  it("partial assessment insert occurs before completed and partial events", () => {
    // The assessment insert must appear before both event insertions in the partial branch
    const partialStart = enrichSource.indexOf("Partial outcome: no meaningful signals after enrichment");
    const partialEnd = enrichSource.indexOf("// ── Success outcome", partialStart);
    const partialBranch = enrichSource.slice(partialStart, partialEnd);

    const assessmentInsertIdx = partialBranch.indexOf('local_business_lead_assessments").insert(');
    const completedEventIdx = partialBranch.indexOf('local_business.enrichment.completed');
    const partialEventIdx = partialBranch.indexOf('local_business.enrichment_partial');

    expect(assessmentInsertIdx).toBeGreaterThan(-1);
    expect(completedEventIdx).toBeGreaterThan(-1);
    expect(partialEventIdx).toBeGreaterThan(-1);
    expect(assessmentInsertIdx).toBeLessThan(completedEventIdx);
    expect(assessmentInsertIdx).toBeLessThan(partialEventIdx);
  });

  it("successful enrichment inserts an assessment with opportunity_score included", () => {
    // The success branch must NOT destructure out opportunity_score
    const successBlock = enrichSource.slice(
      enrichSource.indexOf("const completedEventId = await insertEvent(supabase, {"),
      enrichSource.indexOf("if (assessedStatusError)", enrichSource.indexOf("const completedEventId = await insertEvent(supabase, {")),
    );
    expect(successBlock).toContain("score(effective, result)");
    expect(successBlock).toContain("local_business_lead_assessments");
    expect(successBlock).toContain("...scoring");
    // Must NOT destructure out opportunity_score
    expect(successBlock).not.toContain("opportunity_score: _opportunityScore");
  });

  it("failed enrichment does not insert an assessment", () => {
    const failureBlock = failureBranchBlock();
    expect(failureBlock).toContain('enrichment_status: "failed"');
    expect(failureBlock).not.toContain("local_business_lead_assessments");
  });

  it("partial assessment insert failure returns a useful error", () => {
    // The catch block after assessment insert must return ok:false with the error
    const catchStart = enrichSource.indexOf("catch (assessmentErr)");
    const catchEnd = enrichSource.indexOf("\n      return jsonResponse({\n        ok: true,", catchStart);
    const catchBlock = enrichSource.slice(catchStart, catchEnd !== -1 ? catchEnd : enrichSource.indexOf("if (import.meta.main)", catchStart));
    expect(catchBlock).toContain("ok: false");
    expect(catchBlock).toContain("assessmentErrMsg");
    expect(catchBlock).toContain("partial_assessment_insert_failed");
  });

  it("enrichment logging includes assessment_id and opportunity_score", () => {
    // Success log
    expect(enrichSource).toContain("assessment_id: assessmentData.id");
    expect(enrichSource).toContain("opportunity_score: scoring.opportunity_score");
    // Partial assessment log
    expect(enrichSource).toContain('log("enrichment_partial_assessment"');
    expect(enrichSource).toContain("opportunity_score: partialScoring.opportunity_score");
  });
});
