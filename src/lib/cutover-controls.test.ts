import { describe, expect, it } from "vitest";
// @ts-expect-error The executable control module is intentionally JavaScript for direct Node/PowerShell use.
import { evaluatePreflight, evaluateVerification } from "../../scripts/round8/cutover-controls.mjs";

const base = () => ({
  targetEnvironment: "production",
  backup: {
    artifactId: "backup-1", scope: "public-schema-and-data", sha256: "a".repeat(64),
    integrityVerified: true, capturedAt: "2026-11-13T00:00:00.000Z",
    restore: { status: "passed", targetEnvironment: "disposable", isolated: true, schemaChecksPassed: true, dataChecksPassed: true, evidenceId: "restore-1" },
  },
  quiescence: { legacyRoutesDisabled: true, workersStopped: true, automaticRetriesDisabled: true, v72RequestsBlocked: true, activeSendClaims: 0, unresolvedInflight: 0, stateSource: "server-catalog" },
  migration: { expectedHead: "20261113063001", observedHead: "20261113063001", prerequisitesPresent: true, supersededRound5Included: false, duplicateIds: [], orderingValid: true, approvedSequence: [{ id: "20261113063001", sha256: "b".repeat(64) }], observedSequence: [{ id: "20261113063001", sha256: "b".repeat(64) }] },
  recovery: { preStateCaptured: true, failureInjectionPassed: true, sendIsolationPreserved: true, ledgerHistoryPreserved: true, unsafeV72RollbackBlocked: true, forwardRecoveryVerified: true },
});

describe("Round 8 cutover preflight controls", () => {
  it("passes a complete independently evidenced preflight", () => expect(evaluatePreflight(base(), { now: new Date("2026-11-13T12:00:00Z") }).passed).toBe(true));
  const cases: Array<[string, (v: any) => void]> = [
    ["missing backup", v => delete v.backup],
    ["bad backup integrity", v => { v.backup.integrityVerified = false; }],
    ["failed restore", v => { v.backup.restore.status = "failed"; }],
    ["stale restore evidence", v => { v.backup.capturedAt = "2026-11-01T00:00:00Z"; }],
    ["wrong target", v => { v.targetEnvironment = "staging"; }],
    ["active legacy path", v => { v.quiescence.legacyRoutesDisabled = false; }],
    ["active in-flight send", v => { v.quiescence.activeSendClaims = 1; }],
    ["unknown in-flight state", v => { v.quiescence.stateSource = "unknown"; v.quiescence.unresolvedInflight = 1; }],
    ["automatic retries enabled", v => { v.quiescence.automaticRetriesDisabled = false; }],
    ["wrong migration head", v => { v.migration.observedHead = "old"; }],
    ["unexpected migration hash", v => { v.migration.observedSequence[0].sha256 = "c".repeat(64); }],
    ["missing shared prerequisite", v => { v.migration.prerequisitesPresent = false; }],
    ["superseded Round 5 included", v => { v.migration.supersededRound5Included = true; }],
    ["incorrect ordering", v => { v.migration.orderingValid = false; }],
    ["failed migration isolation", v => { v.recovery.sendIsolationPreserved = false; }],
    ["failed application deployment isolation", v => { v.recovery.unsafeV72RollbackBlocked = false; }],
    ["unsafe v72 rollback", v => { v.recovery.forwardRecoveryVerified = false; }],
    ["ledger history loss", v => { v.recovery.ledgerHistoryPreserved = false; }],
    ["missing pre-state", v => { v.recovery.preStateCaptured = false; }],
    ["failure injection not passed", v => { v.recovery.failureInjectionPassed = false; }],
  ];
  it.each(cases)("blocks %s", (_name, mutate) => { const value = base(); mutate(value); expect(evaluatePreflight(value, { now: new Date("2026-11-13T12:00:00Z") }).passed).toBe(false); });
});

describe("Round 8 post-deployment verification controls", () => {
  const good = { targetEnvironment: "production", deployedFunction: { version: 73, sourceSha256: "d".repeat(64), candidateMatch: true }, nonSendingSmokePassed: true, outreachActivationEnabled: false, unresolvedUncertainAttempts: 0, duplicateHandoffs: 0 };
  it("passes only with candidate match and outreach disabled", () => expect(evaluateVerification(good).passed).toBe(true));
  it("blocks a mismatched function", () => expect(evaluateVerification({ ...good, deployedFunction: { ...good.deployedFunction, candidateMatch: false } }).passed).toBe(false));
  it("blocks activation during verification", () => expect(evaluateVerification({ ...good, outreachActivationEnabled: true }).passed).toBe(false));
});
