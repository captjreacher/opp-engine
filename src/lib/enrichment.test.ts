import { describe, expect, it } from "vitest";
import {
  ENRICHMENT_POLL_INTERVAL_MS,
  ENRICHMENT_POLL_TIMEOUT_MS,
  ENRICHMENT_STALE_AFTER_MS,
  enrichmentRunStartedAtMs,
  isEnrichmentRunning,
  isEnrichmentStale,
  isTerminalEnrichmentStatus,
} from "./enrichment";

describe("enrichment status helpers", () => {
  it("identifies in-flight enrichment state", () => {
    expect(isEnrichmentRunning("enriching")).toBe(true);
    expect(isEnrichmentRunning("enriched")).toBe(false);
    expect(isEnrichmentRunning("partial")).toBe(false);
    expect(isEnrichmentRunning("failed")).toBe(false);
  });

  it("identifies terminal enrichment states", () => {
    expect(isTerminalEnrichmentStatus("enriched")).toBe(true);
    expect(isTerminalEnrichmentStatus("partial")).toBe(true);
    expect(isTerminalEnrichmentStatus("failed")).toBe(true);
    expect(isTerminalEnrichmentStatus("enriching")).toBe(false);
    expect(isTerminalEnrichmentStatus(undefined)).toBe(false);
  });

  it("uses a conservative polling cadence and timeout", () => {
    expect(ENRICHMENT_POLL_INTERVAL_MS).toBeGreaterThanOrEqual(2_000);
    expect(ENRICHMENT_POLL_INTERVAL_MS).toBeLessThanOrEqual(3_000);
    expect(ENRICHMENT_POLL_TIMEOUT_MS).toBeGreaterThan(ENRICHMENT_POLL_INTERVAL_MS);
  });
});

describe("enrichment staleness", () => {
  const nowMs = Date.parse("2026-09-15T12:00:00.000Z");
  const iso = (msAgo: number) => new Date(nowMs - msAgo).toISOString();

  it("treats a fresh run as active so it is never retried concurrently", () => {
    const diagnostics = { queue_requested_at: iso(30_000) };
    expect(isEnrichmentStale("enriching", diagnostics, nowMs)).toBe(false);
    // One millisecond before the threshold the run is still considered live.
    expect(
      isEnrichmentStale("enriching", { queue_requested_at: iso(ENRICHMENT_STALE_AFTER_MS - 1) }, nowMs),
    ).toBe(false);
  });

  it("treats an abandoned run as stale once the threshold passes", () => {
    expect(
      isEnrichmentStale("enriching", { queue_requested_at: iso(ENRICHMENT_STALE_AFTER_MS) }, nowMs),
    ).toBe(true);
    expect(isEnrichmentStale("enriching", { queue_requested_at: iso(600_000) }, nowMs)).toBe(true);
  });

  it("treats an enriching lead with no run record as stale", () => {
    // Request timeouts and crashes cannot clean up after themselves, so a lead
    // with no run record must never spin forever.
    expect(isEnrichmentStale("enriching", null, nowMs)).toBe(true);
    expect(isEnrichmentStale("enriching", {}, nowMs)).toBe(true);
    expect(isEnrichmentStale("enriching", { queue_requested_at: "not-a-date" }, nowMs)).toBe(true);
  });

  it("falls back to the recorded execution start when queue metadata is missing", () => {
    expect(
      enrichmentRunStartedAtMs({ enrichment_execution: { started_at: iso(200_000) } }),
    ).toBe(nowMs - 200_000);
    expect(
      isEnrichmentStale("enriching", { enrichment_execution: { started_at: iso(200_000) } }, nowMs),
    ).toBe(true);
  });

  it("never reports a terminal lead as stale", () => {
    for (const status of ["enriched", "partial", "failed", null, undefined]) {
      expect(isEnrichmentStale(status, { queue_requested_at: iso(600_000) }, nowMs)).toBe(false);
    }
  });
});
