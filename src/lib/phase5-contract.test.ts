import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const edgeSource = readFileSync(
  resolve("supabase/functions/opportunities/index.ts"),
  "utf8",
);

const enrichSource = readFileSync(
  resolve("supabase/functions/local-business-enrich/index.ts"),
  "utf8",
);

function failureBranchBlock(): string {
  const start = enrichSource.indexOf("enrichment_failure");
  if (start === -1) return "";

  const catchIdx = enrichSource.lastIndexOf("catch (error)", start);
  if (catchIdx === -1) return "";

  const end = enrichSource.indexOf("if (import.meta.main)", catchIdx);
  return end !== -1 ? enrichSource.slice(catchIdx, end) : enrichSource.slice(catchIdx);
}

function findRPCDotCatch(source: string): string[] {
  const matches: string[] = [];
  let idx = 0;

  while (idx < source.length) {
    const rpcStart = source.indexOf("supabase.rpc", idx);
    if (rpcStart === -1) break;

    const tail = source.slice(rpcStart, Math.min(rpcStart + 240, source.length));
    if (tail.includes(".catch(")) matches.push(tail);
    idx = rpcStart + 1;
  }

  return matches;
}

describe("Phase 5 backend contract", () => {
  it("authenticates before all data routes", () => {
    expect(edgeSource.indexOf("if (!authorized(req))")).toBeLessThan(
      edgeSource.indexOf('if (req.method === "GET" && parts.length === 0)'),
    );
    expect(edgeSource).toContain("if (!OPERATOR_TOKEN) return false");
  });

  it("routes discovery candidate imports importCandidates", () => {
    expect(edgeSource).toMatch(
      /parts\[3\]\s*===\s*"import"[\s\S]{0,400}importCandidates\(/,
    );
  });

  it.each(["assess", "audit"])(
    "contains discovery candidate batch route contract %s",
    (operation) => {
      expect(edgeSource).toMatch(
        new RegExp(
          `parts\\[3\\]\\s*===\\s*"${operation}"[\\s\\S]{0,400}processCandidateBatch\\([\\s\\S]{0,220}"${operation}"`,
        ),
      );
    },
  );

  it("keeps discovery workflow free of SMTP outreach draft side effects", () => {
    const discoveryBlock = edgeSource.slice(
      edgeSource.indexOf("// POST /opportunities/discovery-runs/:runId/candidates"),
      edgeSource.indexOf("async function processCandidateBatch"),
    );

    expect(discoveryBlock).not.toContain("sendSmtpEmail");
    expect(discoveryBlock).not.toContain("local_business_outreach_drafts");
  });

  it("never chains .catch directly on supabase.rpc() calls", () => {
    expect(findRPCDotCatch(edgeSource)).toEqual([]);
  });

  it("assessment failure event uses awaited rpc destructuring instead inline catch", () => {
    expect(edgeSource).toMatch(
      /const\s*\{\s*error:\s*\w+\s*\}\s*=\s*await\s*supabase\.rpc\(\s*"emit_local_business_event"/,
    );
  });

  it("emitWorkflowEvent calls explicitly swallowed at callsite", () => {
    expect(edgeSource).toMatch(
      /emitWorkflowEvent\(\{[\s\S]{0,500}\}\)\.catch\(\(\)\s*=>\s*undefined\)/,
    );
  });
});

describe("Enrichment contract", () => {
  it("keeps enrichment bounded and can return partial without completing every tier", () => {
    expect(enrichSource).toContain("OVERALL_ENRICHMENT_BUDGET_MS");
    expect(enrichSource).toContain("budgetExhausted");
    expect(enrichSource).toContain("budgetStopTier");
    expect(enrichSource).toContain('status: budgetExhausted ? "partial_budget_exhausted" : "pending"');
    expect(enrichSource).toContain('stopForBudget("google_places")');
    expect(enrichSource).toContain('stopForBudget("exa")');
    expect(enrichSource).toContain('stopForBudget("duckduckgo")');
    expect(enrichSource).toContain('skip_reason: "sufficient_candidates_from_earlier_tiers"');
    expect(enrichSource).toContain('status: "partial"');
  });

  it("does not own assessment persistence or implicit analysis", () => {
    expect(enrichSource).not.toContain("score(effective, result)");
    expect(enrichSource).not.toContain("insertAssessment(");
    expect(enrichSource).not.toContain('from("local_business_lead_assessments")');
    expect(enrichSource).not.toContain('eventType: "local_business.assessed"');
    expect(enrichSource).not.toContain("local_business.assessed");
    expect(enrichSource).not.toContain("analysis_completed");
    expect(enrichSource).not.toContain("assessment_requested");
    expect(enrichSource).not.toContain("assessment_completed");
  });

  it("persists enrichment state, evidence, diagnostics, and partial completion events", () => {
    const partialStart = enrichSource.indexOf(
      "Partial outcome: no meaningful signals after enrichment",
    );
    const partialEnd = enrichSource.indexOf("// ── Success outcome", partialStart);
    const partialBranch = enrichSource.slice(partialStart, partialEnd);

    expect(partialBranch).toContain('leadPatch.enrichment_status = "partial"');
    expect(partialBranch).toContain("leadPatch.enrichment_diagnostics");
    expect(partialBranch).toContain('eventType: "local_business.enrichment.completed"');
    expect(partialBranch).toContain('eventType: "local_business.enrichment_partial"');
    expect(partialBranch).not.toContain("local_business_lead_assessments");
    expect(partialBranch).not.toContain("analysis_completed");
  });

  it("never emits assessment-related side effects from enrichment", () => {
    expect(failureBranchBlock()).not.toContain("local_business_lead_assessments");
    expect(enrichSource).not.toContain("local_business.assessed");
    expect(enrichSource).not.toContain("local_business.assessment_requested");
    expect(enrichSource).not.toContain("local_business.assessment_completed");
  });
});

describe("Analysis contract", () => {
  it("explicitly owns assessment persistence in POST /:id/assess", () => {
    const assessStart = edgeSource.indexOf("async function runOpportunityAnalysis(");
    const assessEnd = edgeSource.indexOf("function reportBand(", assessStart);
    const assessBlock =
      assessEnd > assessStart ? edgeSource.slice(assessStart, assessEnd) : edgeSource.slice(assessStart);

    expect(assessBlock).toContain('p_event_type: "local_business.assessment_requested"');
    expect(assessBlock).toContain("buildAnalysisScoring(");
    expect(assessBlock).toContain('from("local_business_lead_assessments")');
    expect(assessBlock).toContain(".insert({");
    expect(assessBlock).toContain('action: "analysis_completed"');
    expect(assessBlock).toContain('p_event_type: "local_business.assessment_completed"');
    expect(assessBlock).not.toContain("local_business.assessed");
  });

  it("does not depend on enrichment creating an assessment", () => {
    const assessStart = edgeSource.indexOf("async function runOpportunityAnalysis(");
    const assessEnd = edgeSource.indexOf("function reportBand(", assessStart);
    const assessBlock =
      assessEnd > assessStart ? edgeSource.slice(assessStart, assessEnd) : edgeSource.slice(assessStart);

    expect(assessBlock).toContain('if (!enrichmentResult) {');
    expect(assessBlock).toContain('return { ok: false, error: "enrichment_required" };');
    expect(assessBlock).toContain('assessment_id: assessment?.id ?? null');
    expect(assessBlock).toContain('local_business.assessment_completed');
    expect(assessBlock).not.toContain("canonical_assessment_missing_after_enrichment");
  });
});
