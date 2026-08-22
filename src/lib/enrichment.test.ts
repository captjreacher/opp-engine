import { describe, expect, it } from "vitest";
import {
  ENRICHMENT_POLL_INTERVAL_MS,
  ENRICHMENT_POLL_TIMEOUT_MS,
  isEnrichmentRunning,
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
