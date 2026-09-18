import { describe, expect, it } from "vitest";
import {
  EnrichmentBudget,
  HARD_STOP_MARGIN_MS,
  MIN_OPERATION_MS,
  OVERALL_ENRICHMENT_BUDGET_MS,
  STALE_ENRICHMENT_AFTER_MS,
  TIER_BUDGET_MS,
  TIER_MIN_START_MS,
  partialReasonFor,
  resolveTerminalStatus,
  type TierName,
} from "../../supabase/functions/_shared/enrichmentBudget";
import { ENRICHMENT_STALE_AFTER_MS } from "./enrichment";

/** The production pg_net envelope observed when the lead got stuck in `enriching`. */
const PG_NET_ENVELOPE_MS = 110_000;
/** Room kept for lead resolution, DB writes, events and response serialization. */
const POST_PROCESSING_RESERVE_MS = 25_000;
/** Tier 3 crawl timeout, the operation the fallback crawl reuses. */
const CRAWL_TIMEOUT_MS = 3_500;

/** Tiers that perform real work (the sentinels for finalize/hard stop do not). */
const WORK_TIERS: TierName[] = [
  "google_places",
  "exa",
  "direct_fetch",
  "duckduckgo",
  "fallback_crawl",
];

function makeBudget(clock: { now: number }, totalBudgetMs = OVERALL_ENRICHMENT_BUDGET_MS) {
  return new EnrichmentBudget({
    totalBudgetMs,
    startedAt: 0,
    now: () => clock.now,
  });
}

describe("enrichment execution budget", () => {
  it("keeps provider work inside the pg_net envelope with room left to persist", () => {
    // The production failure: a 95s budget plus lead resolution, DB writes and
    // serialization landed at ~110s and pg_net abandoned the request.
    expect(POST_PROCESSING_RESERVE_MS).toBeGreaterThan(0);
    expect(OVERALL_ENRICHMENT_BUDGET_MS).toBeLessThanOrEqual(80_000);
    expect(OVERALL_ENRICHMENT_BUDGET_MS).toBeGreaterThanOrEqual(60_000);
    expect(
      OVERALL_ENRICHMENT_BUDGET_MS + HARD_STOP_MARGIN_MS + POST_PROCESSING_RESERVE_MS,
    ).toBeLessThanOrEqual(PG_NET_ENVELOPE_MS);
  });

  it("makes the overall deadline authoritative over every tier allowance", () => {
    const clock = { now: 0 };
    const budget = makeBudget(clock);

    // Ten seconds left: no tier may be granted more than the ten seconds that
    // remain, however large its own allowance is.
    clock.now = 65_000;
    expect(budget.remainingMs()).toBe(10_000);
    for (const tier of WORK_TIERS) {
      const allowance = TIER_BUDGET_MS[tier];
      const timeout = budget.tierTimeoutMs(tier, allowance);
      if (timeout === null) continue;
      expect(timeout).toBeLessThanOrEqual(budget.remainingMs());
      expect(timeout).toBeLessThanOrEqual(Math.max(allowance, MIN_OPERATION_MS));
    }

    // Past the deadline: nothing may be started at all.
    clock.now = OVERALL_ENRICHMENT_BUDGET_MS + 1;
    expect(budget.remainingMs()).toBe(0);
    expect(budget.overallBudgetExhausted()).toBe(true);
    for (const tier of WORK_TIERS) {
      expect(budget.tierTimeoutMs(tier, TIER_BUDGET_MS[tier])).toBeNull();
      expect(budget.canStartTier(tier)).toBe(false);
    }
  });

  it("refuses to start a tier without enough remaining budget", () => {
    const clock = { now: 0 };
    const budget = makeBudget(clock);

    const minimum = TIER_MIN_START_MS.google_places;
    clock.now = OVERALL_ENRICHMENT_BUDGET_MS - minimum + 1;
    // One millisecond short of the tier minimum: the tier must not start.
    expect(budget.canStartTier("google_places")).toBe(false);
    expect(budget.remainingMs()).toBe(minimum - 1);
    // Even when a caller asks anyway, the timeout cannot exceed what is left.
    expect(budget.tierTimeoutMs("google_places", 12_000)).toBe(minimum - 1);

    clock.now = OVERALL_ENRICHMENT_BUDGET_MS - minimum;
    expect(budget.canStartTier("google_places")).toBe(true);
    expect(budget.tierTimeoutMs("google_places", 12_000)).toBe(minimum);

    // Anything below one useful operation is not worth starting at all.
    clock.now = OVERALL_ENRICHMENT_BUDGET_MS - (MIN_OPERATION_MS - 1);
    expect(budget.tierTimeoutMs("google_places", 12_000)).toBeNull();
  });

  it("keeps the DuckDuckGo fallback crawl inside the overall deadline", () => {
    const clock = { now: 0 };
    const budget = makeBudget(clock);

    // Plenty of time: the crawl keeps its own (smaller) timeout.
    clock.now = 55_000;
    expect(budget.canStartTier("fallback_crawl")).toBe(true);
    expect(budget.tierTimeoutMs("fallback_crawl", CRAWL_TIMEOUT_MS)).toBe(CRAWL_TIMEOUT_MS);

    // Almost out of budget: the crawl is clamped to what is left, never to the
    // tier allowance it would have had on its own.
    clock.now = 73_000;
    expect(budget.tierTimeoutMs("fallback_crawl", CRAWL_TIMEOUT_MS)).toBe(2_000);
    expect(budget.tierTimeoutMs("fallback_crawl", TIER_BUDGET_MS.fallback_crawl)).toBe(2_000);

    // Too late to be worth starting: the caller must skip the crawl entirely,
    // which is the path that previously ran with a fresh, unguarded budget.
    clock.now = 74_000;
    expect(budget.canStartTier("fallback_crawl")).toBe(false);
    expect(budget.tierTimeoutMs("fallback_crawl", CRAWL_TIMEOUT_MS)).toBeNull();
    expect(budget.tierTimeoutMs("fallback_crawl", CRAWL_TIMEOUT_MS)).not.toBe(
      TIER_BUDGET_MS.fallback_crawl,
    );
  });

  it("ends a tier on its own allowance without marking the whole run exhausted", () => {
    const clock = { now: 0 };
    const budget = makeBudget(clock);
    budget.startTier("google_places");

    clock.now = TIER_BUDGET_MS.google_places + 1;
    // Tier allowance spent, but most of the overall budget is still available:
    // lower tiers must still run, and the run is not budget-limited.
    expect(budget.tierTimeoutMs("google_places", 12_000)).toBeNull();
    expect(budget.overallBudgetExhausted()).toBe(false);
    expect(budget.budgetExhausted).toBe(false);
    expect(budget.canStartTier("exa")).toBe(true);
    expect(budget.tierTimeoutMs("exa", 7_000)).toBe(7_000);
    expect(budget.remainingMs()).toBeGreaterThan(50_000);
  });

  it("attributes exhaustion to the first stopping tier", () => {
    const clock = { now: 0 };
    const budget = makeBudget(clock);

    expect(budget.markExhausted("duckduckgo")).toBe(true);
    expect(budget.markExhausted("fallback_crawl")).toBe(false);
    expect(budget.budgetStopTier).toBe("duckduckgo");
    expect(budget.budgetExhausted).toBe(true);

    const snapshot = budget.snapshot();
    expect(snapshot.budget_exhausted).toBe(true);
    expect(snapshot.budget_stop_tier).toBe("duckduckgo");
    expect(snapshot.total_budget_ms).toBe(OVERALL_ENRICHMENT_BUDGET_MS);
    expect(snapshot.tiers_attempted).toEqual([]);
  });

  it("records tiers attempted for diagnostics", () => {
    const clock = { now: 0 };
    const budget = makeBudget(clock);
    budget.startTier("google_places");
    budget.startTier("exa");
    budget.startTier("google_places");
    expect(budget.tiersAttempted()).toEqual(["google_places", "exa"]);
  });
});

describe("enrichment terminal status", () => {
  it("always resolves budget exhaustion to partial, never to a running state", () => {
    expect(
      resolveTerminalStatus({
        meaningfulSignals: 5,
        strongAnchorPresent: true,
        budgetExhausted: true,
      }),
    ).toBe("partial");
    expect(
      resolveTerminalStatus({
        meaningfulSignals: 5,
        strongAnchorPresent: true,
        budgetExhausted: false,
      }),
    ).toBe("success");
    expect(
      resolveTerminalStatus({
        meaningfulSignals: 0,
        strongAnchorPresent: true,
        budgetExhausted: false,
      }),
    ).toBe("partial");
    expect(
      resolveTerminalStatus({
        meaningfulSignals: 5,
        strongAnchorPresent: false,
        budgetExhausted: false,
      }),
    ).toBe("partial");

    const statuses = [
      resolveTerminalStatus({
        meaningfulSignals: 5,
        strongAnchorPresent: true,
        budgetExhausted: true,
      }),
      resolveTerminalStatus({
        meaningfulSignals: 0,
        strongAnchorPresent: false,
        budgetExhausted: false,
      }),
    ];
    expect(statuses.every((status) => status === "partial" || status === "success")).toBe(true);
    expect(statuses).not.toContain("enriching");
  });

  it("names the stopping tier in the partial reason", () => {
    expect(
      partialReasonFor({
        budgetExhausted: true,
        budgetStopTier: "duckduckgo",
        meaningfulSignals: 3,
        strongAnchorPresent: true,
      }),
    ).toBe("execution_budget_exhausted:duckduckgo");

    expect(
      partialReasonFor({
        budgetExhausted: true,
        budgetStopTier: null,
        meaningfulSignals: 3,
        strongAnchorPresent: true,
      }),
    ).toBe("execution_budget_exhausted:unknown");

    expect(
      partialReasonFor({
        budgetExhausted: false,
        budgetStopTier: null,
        meaningfulSignals: 0,
        strongAnchorPresent: true,
      }),
    ).toBe("no_meaningful_enrichment_signal");

    expect(
      partialReasonFor({
        budgetExhausted: false,
        budgetStopTier: null,
        meaningfulSignals: 3,
        strongAnchorPresent: false,
      }),
    ).toBe("strong_anchor_required");
  });
});

describe("stale enrichment threshold", () => {
  it("cannot overlap a live invocation", () => {
    // 180s > 110s request envelope > 80s hard stop, so reclaiming a stale lead
    // can never race a run that is still executing.
    expect(STALE_ENRICHMENT_AFTER_MS).toBeGreaterThan(PG_NET_ENVELOPE_MS);
    expect(PG_NET_ENVELOPE_MS).toBeGreaterThan(
      OVERALL_ENRICHMENT_BUDGET_MS + HARD_STOP_MARGIN_MS,
    );
    expect(STALE_ENRICHMENT_AFTER_MS).toBe(ENRICHMENT_STALE_AFTER_MS);
  });
});
