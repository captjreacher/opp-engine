import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const enrichSource = readFileSync(
  resolve("supabase/functions/local-business-enrich/index.ts"),
  "utf8",
);

const budgetSource = readFileSync(
  resolve("supabase/functions/_shared/enrichmentBudget.ts"),
  "utf8",
);

const queueMigration = readFileSync(
  resolve("supabase/migrations/20260822171709_queue_opportunity_enrichment_pg_net.sql"),
  "utf8",
);

const recoveryMigration = readFileSync(
  resolve("supabase/migrations/20260915120000_opportunity_enrichment_budget_recovery.sql"),
  "utf8",
);

const uiSource = readFileSync(resolve("src/routes/OpportunityDetail.tsx"), "utf8");

const uiHelperSource = readFileSync(resolve("src/lib/enrichment.ts"), "utf8");

function sliceBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  if (start === -1) return "";
  const end = source.indexOf(endMarker, start);
  return end === -1 ? source.slice(start) : source.slice(start, end);
}

/**
 * Slice from the LAST occurrence of a marker. Used for the handler's catch block,
 * because provider tiers also contain `catch (error)` blocks.
 */
function sliceFromLast(source: string, startMarker: string, endMarker: string): string {
  const start = source.lastIndexOf(startMarker);
  if (start === -1) return "";
  const end = source.indexOf(endMarker, start);
  return end === -1 ? source.slice(start) : source.slice(start, end);
}

describe("enrichment execution budget wiring", () => {
  it("owns one budget per request and shares it with every tier", () => {
    expect(enrichSource).toContain("const budget = new EnrichmentBudget({");
    expect(enrichSource).toContain(
      "const discovery = await runTieredDiscovery(resolved.sourcePayload, businessName, now, budget);",
    );
    expect(enrichSource).toContain("searchGooglePlaces(context, observedAt, budget, raw)");
    expect(enrichSource).toContain("searchExa(context, observedAt, budget)");
    expect(enrichSource).toContain("directFetchAndCrawl(context, allCandidates, observedAt, budget)");
    expect(enrichSource).toContain("discoverSearchCandidates(context, observedAt, budget)");
  });

  it("clamps every provider call through the shared deadline", () => {
    // Google Places: primary request plus a re-checked fallback query.
    expect(enrichSource).toContain('budget.tierTimeoutMs("google_places", GOOGLE_PLACES_TIMEOUT_MS)');
    expect(enrichSource).toContain("primaryTimeoutMs, budget.abortSignal");
    expect(enrichSource).toContain("fallbackTimeoutMs, budget.abortSignal");
    // Exa, direct fetch and DuckDuckGo all clamp their own timeouts.
    expect(enrichSource).toContain('budget.tierTimeoutMs("exa", EXA_QUERY_TIMEOUT_MS)');
    expect(enrichSource).toContain("queryTimeoutMs, budget.abortSignal");
    expect(enrichSource).toContain("budget.tierTimeoutMs(tier, DIRECT_FETCH_TIMEOUT_MS)");
    expect(enrichSource).toContain('budget.tierTimeoutMs("duckduckgo", DUCKDUCKGO_FETCH_TIMEOUT_MS)');
    expect(enrichSource).toContain("const result = await fetchText(url, timeoutMs, budget.abortSignal);");
  });

  it("guards the DuckDuckGo -> fallback crawl path with the overall deadline", () => {
    // The production failure: a fresh directFetchAndCrawl got a fresh allowance
    // with no overall-deadline check. It must now check first...
    expect(enrichSource).toContain('if (!budget.canStartTier("fallback_crawl")) {');
    expect(enrichSource).toContain('stopForBudget("fallback_crawl");');
    // ...and then run inside the SAME budget, not a new one.
    expect(enrichSource).toContain(
      'directFetchAndCrawl(context, searchDiscovery.candidates, observedAt, budget, "fallback_crawl", false)',
    );
    expect(enrichSource).toContain("budget.startTier(\"fallback_crawl\");");
    expect(enrichSource).toContain("if (fallbackCrawl.debug.budget_stopped) stopForBudget(\"fallback_crawl\");");
    // The crawl itself refuses to start without enough remaining budget.
    expect(enrichSource).toContain("if (budget.tierTimeoutMs(tier, DIRECT_FETCH_TIMEOUT_MS) === null) {");
  });

  it("aborts in-flight provider work at the hard stop", () => {
    expect(enrichSource).toContain("OVERALL_ENRICHMENT_BUDGET_MS + HARD_STOP_MARGIN_MS");
    expect(enrichSource).toContain("const hardStop = new AbortController();");
    expect(enrichSource).toContain("budget.abortSignal = hardStop.signal;");
    expect(enrichSource).toContain("hardStop.abort();");
    expect(enrichSource).toContain("clearTimeout(hardStopTimer);");
    expect(budgetSource).toContain("export const OVERALL_ENRICHMENT_BUDGET_MS = 75_000;");
    expect(budgetSource).toContain("export const HARD_STOP_MARGIN_MS = 5_000;");
  });
});

describe("enrichment terminal paths", () => {
  it("persists a partial result when the budget runs out", () => {
    const partialBranch = sliceBetween(
      enrichSource,
      "Partial outcome: no meaningful signals after enrichment",
      "// ── Success outcome",
    );
    expect(
      enrichSource,
    ).toContain("if (meaningfulSignals === 0 || !strongAnchorPresent || discovery.budgetExhausted) {");
    expect(partialBranch).toContain('leadPatch.enrichment_status = "partial";');
    // Evidence collected before the stop is persisted, not discarded.
    expect(partialBranch).toContain("leadPatch.enrichment_diagnostics");
    expect(partialBranch).toContain("update(leadPatch)");
    expect(partialBranch).toContain("execution_budget_exhausted");
    expect(partialBranch).toContain("budget_stop_tier");
    expect(partialBranch).toContain("tiers_attempted");
    expect(enrichSource).toContain("const partialReason = partialReasonFor({");
  });

  it("terminates enrichment on a partial outcome instead of leaving it enriching", () => {
    const partialBranch = sliceBetween(
      enrichSource,
      "Partial outcome: no meaningful signals after enrichment",
      "// ── Success outcome",
    );
    expect(partialBranch).toContain('eventType: "local_business.enrichment.completed"');
    expect(partialBranch).toContain('eventType: "local_business.enrichment_partial"');
    expect(partialBranch).toContain('status: "partial" satisfies EnrichmentStatus');
    expect(partialBranch).not.toContain('enrichment_status: "enriching"');
  });

  it("terminates enrichment on a provider error", () => {
    const softFailHandler = sliceBetween(
      enrichSource,
      "async function handleSearchFailure(",
      "// ──",
    );
    expect(softFailHandler).toContain('enrichment_status: "failed"');
    expect(softFailHandler).toContain('eventType: "local_business.enrichment_failed"');
    expect(enrichSource).toContain('provider_error: errorMessage(error)');
    expect(enrichSource).toContain('provider_error: `HTTP ${response.status}');

    const failureBranch = sliceFromLast(enrichSource, 'log("enrichment_failure"', "if (import.meta.main)");
    expect(failureBranch).toContain('enrichment_status: "failed"');
    expect(failureBranch).toContain('finalizeExecution("failed")');
  });

  it("sets a terminal status on every outcome and writes `enriching` only at the start", () => {
    expect(enrichSource).toContain('leadPatch.enrichment_status = "partial";');
    expect(enrichSource).toContain('enrichment_status: "enriched",');
    const terminalFailures = enrichSource.split('enrichment_status: "failed"').length - 1;
    expect(terminalFailures).toBeGreaterThanOrEqual(2);
    // `enriching` appears only in the fenced-out response body and the start write.
    const runningWrites = enrichSource.split('enrichment_status: "enriching"').length - 1;
    expect(runningWrites).toBe(2);
    expect(enrichSource).toContain("enrichment_diagnostics: buildDiagnostics({})");
  });

  it("records observability for the run in diagnostics", () => {
    expect(enrichSource).toContain("type EnrichmentExecution = {");
    for (const field of [
      "claim_id",
      "queued_at",
      "started_at",
      "finished_at",
      "total_wall_clock_ms",
      "budget_exhausted",
      "budget_stop_tier",
      "tiers_attempted",
      "terminal_status",
      "stale_after_ms",
    ]) {
      expect(enrichSource).toContain(`${field}:`);
    }
    // Terminal writes merge over the queued diagnostics (keeping
    // queue_requested_at) instead of replacing them.
    expect(enrichSource).toContain("function mergeEnrichmentDiagnostics(");
    const failureBranch = sliceFromLast(enrichSource, 'log("enrichment_failure"', "if (import.meta.main)");
    expect(failureBranch).toContain("enrichment_diagnostics: buildDiagnostics({");
    // The previous implementation replaced diagnostics wholesale, erasing
    // queue_requested_at; a bare object literal must not come back.
    expect(failureBranch).not.toMatch(/enrichment_diagnostics:\s*\{\s*schema_version/);
  });
});

describe("concurrency and stale recovery", () => {
  it("refuses to duplicate an active enrichment run", () => {
    // Edge function: a fresh claim owned by someone else is fenced out.
    expect(enrichSource).toContain('error: "enrichment_already_in_progress"');
    expect(enrichSource).toContain("function resolveEnrichmentClaim(");
    expect(enrichSource).toContain("allowed: !(isActive && args.requestedClaim !== priorClaim),");
    // Queue RPC: active (non-stale) runs are still refused.
    expect(recoveryMigration).toContain("'error', 'enrichment_in_progress'");
    expect(recoveryMigration).toContain("v_now - v_prior_queued_at < c_stale_after");
  });

  it("allows a stale enriching job to be retried safely", () => {
    expect(recoveryMigration).toContain("c_stale_after constant interval := interval '3 minutes';");
    expect(recoveryMigration).toContain("v_stale := true;");
    expect(recoveryMigration).toContain("'stale_reclaimed', v_stale,");
    expect(recoveryMigration).toContain("public.reclaim_stale_enrichments(");
    expect(recoveryMigration).toContain("for update skip locked");
    expect(recoveryMigration).toContain("'failure_reason', 'stale_enrichment_reclaimed'");
    // A reclaim can never race a live invocation: the sweep's minimum window is
    // the same 180s safety invariant as the queue RPC and the edge function.
    expect(recoveryMigration).toContain("c_min_stale_after constant interval := interval '3 minutes';");
    expect(recoveryMigration).not.toContain("interval '2 minutes'");
    expect(recoveryMigration).toContain("'enrichment_terminal_status', 'failed'");
    expect(uiHelperSource).toContain("export function isEnrichmentStale(");
  });

  it("keeps the queued run record when enqueueing fails", () => {
    // The previous implementation rebuilt diagnostics from `v_lead` -- the
    // PRE-queue snapshot -- so a failed net.http_post erased queue_requested_at,
    // queue_generation, enrichment_claim_id, the stale-reclaim metadata and the
    // execution budget the same call had just written. The failure must merge
    // into the CURRENT row instead.
    const failureHandler = sliceBetween(
      recoveryMigration,
      "  exception\n    when others then",
      "      return jsonb_build_object(",
    );
    expect(failureHandler).not.toBe("");
    // Merge over the current row...
    expect(failureHandler).toContain("coalesce(enrichment_diagnostics, '{}'::jsonb)");
    // ...and never over the stale pre-queue snapshot.
    expect(failureHandler).not.toContain("v_lead.enrichment_diagnostics");
    expect(failureHandler).toContain("'queue_failed_at', now(),");
    expect(failureHandler).toContain("'enrichment_terminal_status', 'failed',");
    expect(failureHandler).toContain("'failure_reason', left(SQLERRM, 500)");

    // Every field the failure path must preserve is written before the request.
    expect(recoveryMigration).toContain("'queue_requested_at', v_now,");
    expect(recoveryMigration).toContain("'queue_generation', v_generation,");
    expect(recoveryMigration).toContain("'enrichment_claim_id', v_claim_id,");
    expect(recoveryMigration).toContain("'stale_reclaimed', v_stale,");
    expect(recoveryMigration).toContain("'stale_reclaimed_prior_run_at', case when v_stale then v_prior_queued_at else null end,");
    expect(recoveryMigration).toContain("'execution_budget_ms', 75000,");

    // Generation is only ever derived from a well-formed prior generation.
    const generationBlock = sliceBetween(recoveryMigration, "  v_generation := case", "  end;");
    expect(generationBlock).not.toBe("");
    expect(generationBlock).toContain(
      "(v_lead.enrichment_diagnostics ->> 'queue_generation')::integer + 1",
    );
    expect(generationBlock).not.toContain("...");
  });

  it("records the superseded attempt when reclaiming a stale run", () => {
    // The sweep records the prior claim id and generation on both the reclaimed
    // lead's diagnostics and the audit entry, so an operator can trace which
    // attempt was abandoned.
    const sweep = sliceBetween(
      recoveryMigration,
      "create or replace function public.reclaim_stale_enrichments(",
      "comment on function public.reclaim_stale_enrichments",
    );
    expect(sweep).not.toBe("");
    expect(sweep).toContain("l.enrichment_diagnostics ->> 'enrichment_claim_id' as prior_claim_id");
    expect(sweep).toContain("l.enrichment_diagnostics ->> 'queue_generation' as prior_queue_generation");
    expect(sweep).toContain("'prior_enrichment_claim_id', v_row.prior_claim_id,");
    expect(sweep).toContain("'prior_queue_generation', v_row.prior_queue_generation,");
    // Null when the abandoned run never recorded them: "where available".
    expect(sweep).toContain("'stale_reclaimed_prior_claim_id', v_row.prior_claim_id,");

    // The queue RPC also audits an in-line stale reclaim; that entry carries the
    // same trace fields.
    const inlineReclaimAudit = sliceBetween(
      recoveryMigration,
      "        'stage', 'stale_reclaim',\n        'retry', p_retry,",
      "'detail', 'stale enriching run reclaimed by queue_local_business_enrichment'",
    );
    expect(inlineReclaimAudit).not.toBe("");
    expect(inlineReclaimAudit).toContain(
      "'prior_enrichment_claim_id', v_lead.enrichment_diagnostics ->> 'enrichment_claim_id',",
    );
    expect(inlineReclaimAudit).toContain(
      "'prior_queue_generation', v_lead.enrichment_diagnostics ->> 'queue_generation',",
    );
  });

  it("never lets a retry overwrite operator-entered canonical values", () => {
    // Only fields that are still empty are patched, so operator data wins.
    const patchLoop = sliceBetween(
      enrichSource,
      "for (const field of patchableFields) {",
      "// Opening hours (jsonb)",
    );
    expect(patchLoop).toContain("if (!hasCanonicalValue(resolved.lead[field])) {");
    expect(patchLoop).toContain("leadPatch[field] = value;");
    expect(patchLoop.indexOf("if (!hasCanonicalValue(resolved.lead[field]))")).toBeLessThan(
      patchLoop.indexOf("leadPatch[field] = value;"),
    );

    // Recovery SQL only ever writes status and diagnostics.
    const reclaimFunction = sliceBetween(
      recoveryMigration,
      "create or replace function public.reclaim_stale_enrichments(",
      "comment on function public.reclaim_stale_enrichments",
    );
    expect(reclaimFunction).toContain("enrichment_status = 'failed',");
    expect(reclaimFunction).not.toMatch(
      /(website_url|facebook_url|google_maps_url|phone|email|address)\s*=/,
    );
  });

  it("keeps the durable pg_net queue architecture intact", () => {
    // The original queue contract still holds: mark enriching, enqueue, return.
    expect(queueMigration).toContain("net.http_post");
    expect(queueMigration).toContain("enrichment_status = 'enriching'");
    expect(queueMigration).toContain("'status', 'accepted',");
    expect(recoveryMigration).toContain("net.http_post");
    expect(recoveryMigration).toContain("'status', 'accepted',");
    expect(recoveryMigration).toContain("timeout_milliseconds := 110000");
    // No waiting for completion anywhere in the queue path.
    expect(queueMigration).not.toContain("net.http_get");
    expect(recoveryMigration).not.toContain("net.http_get");
    expect(recoveryMigration).not.toContain("pg_sleep");
  });

  it("does not create a new job framework", () => {
    expect(recoveryMigration).not.toContain("pg_cron");
    expect(recoveryMigration).not.toContain("create table");
    expect(recoveryMigration).not.toContain("create extension");
    // Grants stay service-role only.
    expect(recoveryMigration).toContain(
      "grant execute on function public.queue_local_business_enrichment(uuid, text, text, boolean) to service_role;",
    );
    expect(recoveryMigration).toContain(
      "grant execute on function public.reclaim_stale_enrichments(interval, integer) to service_role;",
    );
  });
});

describe("enrichment console staleness", () => {
  it("stops spinning on a stale run and offers a retry", () => {
    expect(uiSource).toContain("isEnrichmentStale");
    expect(uiSource).toContain("const enrichmentStale = isEnrichmentStale(");
    expect(uiSource).toContain("enrichmentRunning = isEnrichmentRunning(enrichmentStatus) && !enrichmentStale");
    expect(uiSource).toContain("Retry enrichment");
    expect(uiSource).toContain("handleEnrich(enrichmentStale)");
    expect(uiSource).toContain("if (isEnrichmentStale(detail.lead.enrichment_status, detail.lead.enrichment_diagnostics)) {");
  });

  it("keeps the stale threshold in sync across edge, SQL and console", () => {
    expect(budgetSource).toContain("export const STALE_ENRICHMENT_AFTER_MS = 180_000;");
    expect(uiHelperSource).toContain("export const ENRICHMENT_STALE_AFTER_MS = 180_000;");
    expect(recoveryMigration).toContain("interval '3 minutes'");
    expect(budgetSource).toContain("export const OVERALL_ENRICHMENT_BUDGET_MS = 75_000;");
    expect(recoveryMigration).toContain("'execution_budget_ms', 75000,");
  });
});
