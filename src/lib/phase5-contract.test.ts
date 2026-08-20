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
  return end !== -1
    ? enrichSource.slice(catchIdx, end)
    : enrichSource.slice(catchIdx);
}

function findRPCDotCatch(source: string): string[] {
  const matches: string[] = [];
  let idx = 0;

  while (idx < source.length) {
    const rpcStart = source.indexOf("supabase.rpc", idx);
    if (rpcStart === -1) break;

    const tail = source.slice(rpcStart, Math.min(rpcStart + 240, source.length));
    if (tail.includes(".catch(")) {
      matches.push(tail);
    }

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

  it("routes discovery candidate imports to importCandidates", () => {
    expect(edgeSource).toMatch(
      /parts\[3\]\s*===\s*"import"[\s\S]{0,400}importCandidates\(/,
    );
  });

  it.each(["assess", "audit"])(
    "contains discovery candidate batch route contract for %s",
    (operation) => {
      expect(edgeSource).toMatch(
        new RegExp(
          `parts\\[3\\]\\s*===\\s*"${operation}"[\\s\\S]{0,400}processCandidateBatch\\([\\s\\S]{0,220}"${operation}"`,
        ),
      );
    },
  );

  it("keeps discovery workflow free of SMTP and outreach draft side effects", () => {
    const discoveryBlock = edgeSource.slice(
      edgeSource.indexOf("// ---- Discovery / intelligence orchestration"),
      edgeSource.indexOf("async function listOpportunities"),
    );

    expect(discoveryBlock).not.toContain("sendSmtpEmail");
    expect(discoveryBlock).not.toContain("local_business_outreach_drafts");
  });

  it("never chains .catch directly on supabase.rpc() calls", () => {
    expect(findRPCDotCatch(edgeSource)).toEqual([]);
  });

  it("assessment failure event uses awaited rpc destructuring instead of inline catch", () => {
    expect(edgeSource).toMatch(
      /const\s*\{\s*error:\s*\w+\s*\}\s*=\s*await\s*supabase\.rpc\(\s*"emit_local_business_event"/,
    );
  });

  it("emitWorkflowEvent calls are explicitly swallowed at the callsite", () => {
    expect(edgeSource).toMatch(
      /emitWorkflowEvent\(\{[\s\S]{0,500}\}\)\.catch\(\(\)\s*=>\s*undefined\)/,
    );
  });
});

describe("Enrichment assessment contract", () => {
  it("partial enrichment inserts an assessment before returning", () => {
    const partialBlock = enrichSource.slice(
      enrichSource.indexOf("Partial: create assessment so callers"),
      enrichSource.indexOf(
        'return jsonResponse({\n      ok: true,\n      status: "partial"',
        enrichSource.indexOf("Partial: create assessment so callers"),
      ),
    );

    expect(partialBlock).toContain("score(effective, result)");
    expect(partialBlock).toContain("insertAssessment(supabase");
    expect(partialBlock).toContain('errorLabel: "partial_assessment_insert_failed"');
  });

  it("partial assessment insert occurs before completed and partial events", () => {
    const partialStart = enrichSource.indexOf(
      "Partial outcome: no meaningful signals after enrichment",
    );
    const partialEnd = enrichSource.indexOf("// ── Success outcome", partialStart);
    const partialBranch = enrichSource.slice(partialStart, partialEnd);

    const assessmentInsertIdx = partialBranch.indexOf("insertAssessment(supabase");
    const completedEventIdx = partialBranch.indexOf(
      "local_business.enrichment.completed",
    );
    const partialEventIdx = partialBranch.indexOf("local_business.enrichment_partial");

    expect(assessmentInsertIdx).toBeGreaterThan(-1);
    expect(completedEventIdx).toBeGreaterThan(-1);
    expect(partialEventIdx).toBeGreaterThan(-1);
    expect(assessmentInsertIdx).toBeLessThan(completedEventIdx);
    expect(assessmentInsertIdx).toBeLessThan(partialEventIdx);
  });

  it("successful enrichment inserts assessment metrics without writing opportunity_score", () => {
    const successBlock = enrichSource.slice(
      enrichSource.indexOf("// ── Success outcome"),
      enrichSource.indexOf(
        "if (assessedStatusError)",
        enrichSource.indexOf("// ── Success outcome"),
      ),
    );

    expect(successBlock).toContain("score(effective, result)");
    expect(successBlock).not.toContain("opportunity_score: args.scoring");
  });

  it("failure branch does not write lead assessments", () => {
    expect(failureBranchBlock()).not.toContain("local_business_lead_assessments");
  });

  it("assessment helper preserves decimal opportunity_score values", () => {
    const scoreBlock = enrichSource.slice(
      enrichSource.indexOf("function score("),
      enrichSource.indexOf("async function insertAssessment"),
    );

    expect(scoreBlock).not.toContain("Math.round(");
    expect(scoreBlock).not.toContain("opportunity_score:");
  });

  it("insertAssessment persists only canonical component scores", () => {
    const helperStart = enrichSource.indexOf("async function insertAssessment");
    const helperEnd = enrichSource.indexOf("async function emit", helperStart);
    const helperBlock =
      helperEnd > helperStart
        ? enrichSource.slice(helperStart, helperEnd)
        : enrichSource.slice(helperStart);
    const insertBlock = helperBlock.slice(
      helperBlock.indexOf(".insert({"),
      helperBlock.indexOf("})", helperBlock.indexOf(".insert({")) + 2,
    );

    expect(insertBlock).toContain("args.scoring.demand_signal_score");
    expect(insertBlock).toContain("args.scoring.trust_leakage_score");
    expect(insertBlock).toContain("args.scoring.conversion_maturity_score");
    expect(insertBlock).toContain("args.scoring.ai_readiness_score");
    expect(insertBlock).not.toContain("opportunity_score:");
  });
});
