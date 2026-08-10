import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ── API client error-handling tests ──────────────────────────────────────────
// These test that the request() function (used by assessDiscoveryCandidates,
// importDiscoveryCandidates, auditDiscoveryCandidates) properly surfaces errors.

describe("API client error handling", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubEnv("VITE_API_BASE", "https://api.example.com");
    vi.stubEnv("VITE_OPERATOR_TOKEN", "test-operator-token");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("successful score request returns parsed data", async () => {
    const responseData = {
      results: [{ candidate_id: "1", ok: true, assessment: { opportunity_score: 85 } }],
      succeeded: 1,
      failed: 0,
    };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify(responseData)),
    });

    // Re-import to pick up stubbed env vars
    const { assessDiscoveryCandidates } = await import("./api");
    const result = await assessDiscoveryCandidates("run-1", ["c-1"]);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.results[0].ok).toBe(true);
  });

  it("RPC response containing error surfaces detail", async () => {
    const errorBody = {
      error: "candidate_not_found",
      detail: "No candidates matched the given IDs.",
    };
    const errorBodyStr = JSON.stringify(errorBody);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: () => Promise.resolve(errorBody),
      text: () => Promise.resolve(errorBodyStr),
    });

    const { assessDiscoveryCandidates, ApiError } = await import("./api");
    await expect(assessDiscoveryCandidates("run-1", ["c-1"])).rejects.toThrow(ApiError);
    await expect(assessDiscoveryCandidates("run-1", ["c-1"])).rejects.toThrow(
      "No candidates matched the given IDs.",
    );
  });

  it("RPC response containing error surfaces fallback message when detail/error absent", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({}),
      text: () => Promise.resolve("{}"),
    });

    const { assessDiscoveryCandidates, ApiError } = await import("./api");
    await expect(assessDiscoveryCandidates("run-1", ["c-1"])).rejects.toThrow(ApiError);
    await expect(assessDiscoveryCandidates("run-1", ["c-1"])).rejects.toThrow(
      "Request failed with status 500",
    );
  });

  it("RPC throwing unexpectedly surfaces network error (e.g. supabase.rpc crash)", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

    const { assessDiscoveryCandidates, ApiError } = await import("./api");
    await expect(assessDiscoveryCandidates("run-1", ["c-1"])).rejects.toThrow(ApiError);
    await expect(assessDiscoveryCandidates("run-1", ["c-1"])).rejects.toThrow(
      "Network error",
    );
    await expect(assessDiscoveryCandidates("run-1", ["c-1"])).rejects.toThrow(
      "Failed to fetch",
    );
  });
});

// ── Discovery batch function structural contract tests ──────────────────────
// These verify that the batch() function in Discovery.tsx follows the required
// state-machine pattern: loading state set, error cleared, data refreshed,
// loading state always cleaned up in finally.

describe("Discovery batch function contract", () => {
  const discoverySource = readFileSync(resolve("src/routes/Discovery.tsx"), "utf8");

  it("batch function resets loading state in finally", () => {
    // The finally block must call setBusy(null) to always clean up
    const batchBlock = discoverySource.slice(
      discoverySource.indexOf("async function batch"),
      discoverySource.indexOf("return (", discoverySource.indexOf("async function batch")),
    );
    expect(batchBlock).toContain("try {");
    expect(batchBlock).toContain("catch (reason)");
    expect(batchBlock).toContain("finally { setBusy(null); }");
  });

  it("batch function refreshes data after score success", () => {
    const batchBlock = discoverySource.slice(
      discoverySource.indexOf("async function batch"),
      discoverySource.indexOf("return (", discoverySource.indexOf("async function batch")),
    );
    // After a successful score request, reload must be called
    expect(batchBlock).toContain("reload(run.id)");
  });

  it("batch function refreshes data after score failure", () => {
    const batchBlock = discoverySource.slice(
      discoverySource.indexOf("async function batch"),
      discoverySource.indexOf("return (", discoverySource.indexOf("async function batch")),
    );
    // In the catch block, reload must also be called
    const catchBlock = batchBlock.slice(
      batchBlock.indexOf("catch (reason)"),
      batchBlock.indexOf("finally"),
    );
    expect(catchBlock).toContain("reload(run.id)");
  });

  it("buttons are disabled while request is active", () => {
    // Each batch action button uses busy !== null to disable
    const assessButtonLine = discoverySource
      .split("\n")
      .find((line) => line.includes('batch("assess")'));
    expect(assessButtonLine).toBeTruthy();
    expect(assessButtonLine).toContain("busy !== null");

    const importButtonLine = discoverySource
      .split("\n")
      .find((line) => line.includes('batch("import")'));
    expect(importButtonLine).toBeTruthy();
    expect(importButtonLine).toContain("busy !== null");

    const auditButtonLine = discoverySource
      .split("\n")
      .find((line) => line.includes('batch("audit")'));
    expect(auditButtonLine).toBeTruthy();
    expect(auditButtonLine).toContain("busy !== null");
  });

  it("batch function clears previous error and notice on start", () => {
    const batchBlock = discoverySource.slice(
      discoverySource.indexOf("async function batch"),
      discoverySource.indexOf("return (", discoverySource.indexOf("async function batch")),
    );
    // At the start, error and notice are reset
    expect(batchBlock).toContain("setError(null); setNotice(null);");
  });
});
