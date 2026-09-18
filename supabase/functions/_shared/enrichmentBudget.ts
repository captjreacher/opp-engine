// ─────────────────────────────────────────────────────────────────────────────
// Shared enrichment execution budget
// ─────────────────────────────────────────────────────────────────────────────
//
// Why this module exists
// ----------------------
// pg_net queues local-business-enrich with a hard 110s request envelope
// (see 20260822171709_queue_opportunity_enrichment_pg_net.sql). The previous
// implementation used a 95s "budget" that was only checked between tiers, so
// provider work plus lead resolution, DB writes, event creation and response
// serialization regularly blew through the envelope and left the lead stuck in
// `enriching` forever.
//
// The budget below is deliberately smaller than the envelope so there is room
// for everything that happens outside provider/search work:
//
//   provider + search work : 75s  (OVERALL_ENRICHMENT_BUDGET_MS)
//   in-flight hard stop    : +5s  (HARD_STOP_MARGIN_MS aborts open fetches)
//   post-processing reserve: ~30s (DB writes, events, serialization, overhead)
//   ------------------------------------------------------------------
//   total vs. 110s pg_net envelope: ~80s worst case
//
// Rules enforced by this module:
//   1. The overall deadline is authoritative for every tier and every fallback.
//   2. A tier cannot start unless enough budget remains to be worth starting.
//   3. An individual operation's timeout is clamped to the remaining budget, so
//      a provider can never run past the deadline just because its own tier
//      timeout has not expired yet.
//
// This module is intentionally free of Deno/runtime imports so it can be unit
// tested directly from the console test suite (vitest).
//
// Mirrored in SQL (20260915120000_opportunity_enrichment_budget_recovery.sql)
// and in the console UI (src/lib/enrichment.ts) — a contract test asserts the
// numbers stay in sync.

/** Provider + search work allowance. Must stay well below the pg_net envelope. */
export const OVERALL_ENRICHMENT_BUDGET_MS = 75_000;

/** Extra grace before open provider fetches are aborted (deadline + this). */
export const HARD_STOP_MARGIN_MS = 5_000;

/** Absolute time to wait before reclaiming an `enriching` lead (queue side). */
export const STALE_ENRICHMENT_AFTER_MS = 180_000;

/** Smallest operation worth starting (per-URL fetch, per-query search). */
export const MIN_OPERATION_MS = 1_500;

/** Fallback floor for tier entry when a tier has no specific minimum. */
export const MIN_TIER_START_REMAINING_MS = 4_000;

export type TierName =
  | "google_places"
  | "exa"
  | "direct_fetch"
  | "duckduckgo"
  | "fallback_crawl"
  | "finalize"
  | "hard_stop";

/**
 * Nominal per-tier allowances. These are ceilings, not reservations: the
 * overall deadline still clamps every operation. Sum (65s) stays under
 * OVERALL_ENRICHMENT_BUDGET_MS so a well-behaved run never reaches the ceiling.
 */
export const TIER_BUDGET_MS: Record<TierName, number> = {
  google_places: 15_000,
  exa: 15_000,
  direct_fetch: 15_000,
  duckduckgo: 10_000,
  fallback_crawl: 10_000,
  finalize: 0,
  hard_stop: 0,
};

/**
 * Minimum remaining time required before a tier may start at all. A tier that
 * starts with less than this cannot complete one useful provider operation.
 */
export const TIER_MIN_START_MS: Record<TierName, number> = {
  google_places: 8_000,
  exa: 5_000,
  direct_fetch: 3_000,
  duckduckgo: 3_000,
  fallback_crawl: 3_000,
  finalize: 0,
  hard_stop: 0,
};

export type BudgetSnapshot = {
  total_budget_ms: number;
  hard_stop_margin_ms: number;
  elapsed_ms: number;
  remaining_ms: number;
  budget_exhausted: boolean;
  budget_stop_tier: string | null;
  tiers_attempted: TierName[];
};

export type EnrichmentBudgetOptions = {
  totalBudgetMs?: number;
  startedAt?: number;
  now?: () => number;
};

/** Remaining time before an absolute deadline. */
export function budgetRemaining(deadlineMs: number, now: number = Date.now()): number {
  return Math.max(0, deadlineMs - now);
}

/** Can work start? Requires a real minimum, not merely a positive remainder. */
export function canStartTier(
  deadlineMs: number,
  minimumMs: number = MIN_TIER_START_REMAINING_MS,
  now: number = Date.now(),
): boolean {
  return budgetRemaining(deadlineMs, now) >= minimumMs;
}

/**
 * Authoritative execution budget for one enrichment invocation.
 *
 * Every tier asks this object for a timeout before doing network work; the
 * answer is already clamped by both the tier allowance and the overall
 * deadline. `null` means "do not start this work at all".
 */
export class EnrichmentBudget {
  readonly totalBudgetMs: number;
  readonly startedAt: number;
  readonly deadlineMs: number;
  readonly hardStopAtMs: number;

  /** Aborts in-flight provider fetches when the hard stop fires. */
  abortSignal: AbortSignal | null = null;

  private readonly clock: () => number;
  private readonly tierStartedAt = new Map<TierName, number>();
  private readonly attempted: TierName[] = [];
  private exhausted = false;
  private firstStopTier: string | null = null;

  constructor(options: EnrichmentBudgetOptions = {}) {
    this.clock = options.now ?? (() => Date.now());
    this.totalBudgetMs = options.totalBudgetMs ?? OVERALL_ENRICHMENT_BUDGET_MS;
    this.startedAt = options.startedAt ?? this.clock();
    this.deadlineMs = this.startedAt + this.totalBudgetMs;
    this.hardStopAtMs = this.deadlineMs + HARD_STOP_MARGIN_MS;
  }

  elapsedMs(): number {
    return Math.max(0, this.clock() - this.startedAt);
  }

  remainingMs(): number {
    return budgetRemaining(this.deadlineMs, this.clock());
  }

  /** True when at least `neededMs` of budget is still available. */
  hasTimeFor(neededMs: number): boolean {
    return this.remainingMs() >= neededMs;
  }

  get budgetExhausted(): boolean {
    return this.exhausted;
  }

  get budgetStopTier(): string | null {
    return this.firstStopTier;
  }

  /** True when the whole run has already stopped for budget reasons. */
  stopped(): boolean {
    return this.exhausted;
  }

  /** Record that a tier claimed the (single) stop reason. First tier wins. */
  markExhausted(tier: TierName | string): boolean {
    const first = !this.exhausted;
    this.exhausted = true;
    if (!this.firstStopTier) this.firstStopTier = tier;
    return first;
  }

  /** Register a tier as attempted and start its tier allowance. */
  startTier(tier: TierName): void {
    this.tierStartedAt.set(tier, this.clock());
    if (!this.attempted.includes(tier)) this.attempted.push(tier);
  }

  tiersAttempted(): TierName[] {
    return [...this.attempted];
  }

  /** Tier allowance left, already clamped by the overall deadline. */
  tierRemainingMs(tier: TierName): number {
    const tierBudget = TIER_BUDGET_MS[tier] ?? 0;
    const tierStart = this.tierStartedAt.get(tier);
    const tierLeft =
      tierStart === undefined ? tierBudget : Math.max(0, tierBudget - (this.clock() - tierStart));
    return Math.min(tierLeft, this.remainingMs());
  }

  /**
   * True when the OVERALL deadline (not a tier allowance) is what ran out.
   * Tier-allowance exhaustion ends a tier quietly; only overall exhaustion may
   * mark the whole run as budget-limited and skip lower tiers.
   */
  overallBudgetExhausted(): boolean {
    return this.remainingMs() < MIN_OPERATION_MS;
  }

  /** Enough remaining budget to make starting this tier worthwhile? */
  canStartTier(tier: TierName): boolean {
    const minimum = TIER_MIN_START_MS[tier] ?? MIN_TIER_START_REMAINING_MS;
    return this.remainingMs() >= minimum;
  }

  /**
   * Timeout for one network operation inside a tier.
   *
   * Always ≦ min(tier allowance left, overall budget left). Returns null when
   * the remaining budget is too small for the operation to be worth starting —
   * callers must stop rather than fetch.
   */
  tierTimeoutMs(tier: TierName, desiredMs: number): number | null {
    const available = this.tierRemainingMs(tier);
    if (available < MIN_OPERATION_MS) return null;
    return Math.max(MIN_OPERATION_MS, Math.min(desiredMs, available));
  }

  snapshot(): BudgetSnapshot {
    return {
      total_budget_ms: this.totalBudgetMs,
      hard_stop_margin_ms: HARD_STOP_MARGIN_MS,
      elapsed_ms: this.elapsedMs(),
      remaining_ms: this.remainingMs(),
      budget_exhausted: this.exhausted,
      budget_stop_tier: this.firstStopTier,
      tiers_attempted: this.tiersAttempted(),
    };
  }
}

export type TerminalEnrichmentStatus = "success" | "partial" | "failed";

/**
 * Terminal status for a completed (non-throwing) discovery run. Budget
 * exhaustion always resolves to `partial`, never `enriching`.
 */
export function resolveTerminalStatus(args: {
  meaningfulSignals: number;
  strongAnchorPresent: boolean;
  budgetExhausted: boolean;
}): Exclude<TerminalEnrichmentStatus, "failed"> {
  if (args.budgetExhausted) return "partial";
  return args.meaningfulSignals > 0 && args.strongAnchorPresent ? "success" : "partial";
}

/** Machine-readable reason recorded in diagnostics and completion events. */
export function partialReasonFor(args: {
  budgetExhausted: boolean;
  budgetStopTier: string | null;
  meaningfulSignals: number;
  strongAnchorPresent: boolean;
}): string {
  if (args.budgetExhausted) {
    return `execution_budget_exhausted:${args.budgetStopTier ?? "unknown"}`;
  }
  if (args.meaningfulSignals === 0) return "no_meaningful_enrichment_signal";
  if (!args.strongAnchorPresent) return "strong_anchor_required";
  return "partial";
}

