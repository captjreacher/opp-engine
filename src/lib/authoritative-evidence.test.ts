import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
// @ts-expect-error This collector is intentionally runnable directly by Node and PowerShell.
import { buildDisposableEvidence, collectProductionEvidence, normalizePostgresHostAddress, parseVerifiedSessionIdentity, validateMigrationManifest, validateProductionConnectionConfig, verifyAuthoritativeEvidence } from "../../scripts/round8/authoritative-evidence.mjs";

const now = new Date("2026-11-13T08:00:00.000Z");
const releaseBinding = { candidateSha: "c".repeat(64), manifestSha: "m".repeat(64) };
const observations = { collector: "disposable-postgres", stateVersion: "state-1", collectedRows: ["migration-head", "quiescence"] };
const backupRestore = {
  artifactExists: true, artifactSha256: "b".repeat(64), artifactHashVerified: true, sourceIdentity: "db-disposable",
  restore: { providerVerified: true, status: "passed", targetIdentity: "db-disposable", isolated: true, schemaIntegrity: true, dataIntegrity: true, consistentWithBackup: true, evidenceId: "restore-1", completedAt: now.toISOString() },
};
const migration = { observedFromDatabase: true, targetDatabaseId: "db-disposable", observedVersions: ["20261107090000", "20261113063001"], supersededRound5Present: false, missingPrerequisites: [], unexpectedVersions: [], orderingValid: true, localHashVerification: "verified", appliedSqlContent: "verified" };
const quiescence = { observedFromAuthoritativeSources: true, legacyRoutesDisabled: true, workersStopped: true, automaticRetriesDisabled: true, activeSendClaims: 0, unresolvedUncertainAttempts: 0, outstandingClaims: 0, inFlightStateKnown: true, maxRequestLifetimeSeconds: 120, drainIntervalSeconds: 180, drainRechecked: true, recheckedAt: now.toISOString() };
const deployment = { observedFromControlPlane: true, candidateMatch: true, sendingActivationEnabled: false };
const disposable = () => buildDisposableEvidence({
  targetIdentity: { projectRef: "disposable-project", databaseId: "db-disposable" }, observations: structuredClone(observations), releaseBinding: structuredClone(releaseBinding), backupRestore: structuredClone(backupRestore), migration: structuredClone(migration), quiescence: structuredClone(quiescence), deployment: structuredClone(deployment), now,
});
const production = () => {
  const value: any = disposable();
  value.mode = "production";
  value.collection.sourceType = "direct-authenticated";
  value.collection.synthetic = false;
  value.collection.sourceEvidenceHash = value.collection.sourceEvidenceHash;
  return value;
};

describe("authoritative release evidence", () => {
  it("accepts a complete disposable rehearsal envelope only in disposable mode", () => expect(verifyAuthoritativeEvidence(disposable(), { now, mode: "disposable" }).passed).toBe(true));
  it("rejects a wrong target", () => expect(verifyAuthoritativeEvidence(production(), { now, expectedProjectRef: "other-project", expectedDatabaseId: "db-disposable" }).passed).toBe(false));
  it("rejects missing target identity", () => { const v: any = production(); delete v.targetIdentity; expect(verifyAuthoritativeEvidence(v, { now }).passed).toBe(false); });
  it("rejects a forged project reference", () => { const v: any = production(); v.targetIdentity.projectRef = "forged"; expect(verifyAuthoritativeEvidence(v, { now, expectedProjectRef: "approved-project" }).passed).toBe(false); });
  it("rejects edited observations", () => { const v: any = production(); v.observations.stateVersion = "edited"; expect(verifyAuthoritativeEvidence(v, { now }).passed).toBe(false); });
  it("rejects replayed evidence after expiry", () => expect(verifyAuthoritativeEvidence(production(), { now: new Date("2026-11-13T10:00:00Z") }).passed).toBe(false));
  it("rejects stale evidence", () => { const v: any = production(); v.collection.expiresAt = "2026-11-13T07:59:00Z"; expect(verifyAuthoritativeEvidence(v, { now }).passed).toBe(false); });
  it("rejects a wrong release hash", () => expect(verifyAuthoritativeEvidence(production(), { now, expectedCandidateSha: "wrong" }).passed).toBe(false));
  it("rejects a wrong migration manifest hash", () => expect(verifyAuthoritativeEvidence(production(), { now, expectedManifestSha: "wrong" }).passed).toBe(false));
  it("rejects synthetic evidence in production mode", () => expect(verifyAuthoritativeEvidence(disposable(), { now, mode: "production" }).passed).toBe(false));
  it("rejects a backup artifact hash mismatch", () => { const v: any = production(); v.backupRestore.artifactHashVerified = false; expect(verifyAuthoritativeEvidence(v, { now }).passed).toBe(false); });
  it("rejects a missing backup", () => { const v: any = production(); v.backupRestore.artifactExists = false; expect(verifyAuthoritativeEvidence(v, { now }).passed).toBe(false); });
  it("rejects a failed restore", () => { const v: any = production(); v.backupRestore.restore.status = "failed"; expect(verifyAuthoritativeEvidence(v, { now }).passed).toBe(false); });
  it("rejects restore from the wrong artifact source", () => { const v: any = production(); v.backupRestore.sourceIdentity = "other-db"; expect(verifyAuthoritativeEvidence(v, { now }).passed).toBe(false); });
  it("rejects restore into the wrong target", () => { const v: any = production(); v.backupRestore.restore.targetIdentity = "other-db"; expect(verifyAuthoritativeEvidence(v, { now }).passed).toBe(false); });
  it("rejects restore integrity mismatch", () => { const v: any = production(); v.backupRestore.restore.dataIntegrity = false; expect(verifyAuthoritativeEvidence(v, { now }).passed).toBe(false); });
  it("rejects migration-history mismatch", () => { const v: any = production(); v.migration.unexpectedVersions = ["unexpected"]; expect(verifyAuthoritativeEvidence(v, { now }).passed).toBe(false); });
  it("rejects a missing shared prerequisite", () => { const v: any = production(); v.migration.missingPrerequisites = ["20260907131000"]; expect(verifyAuthoritativeEvidence(v, { now }).passed).toBe(false); });
  it("rejects the superseded Round 5 migration", () => { const v: any = production(); v.migration.observedVersions.push("20261113100000"); expect(verifyAuthoritativeEvidence(v, { now }).passed).toBe(false); });
  it("rejects a local migration hash mismatch", () => { const v: any = production(); v.migration.localHashVerification = "mismatch"; expect(verifyAuthoritativeEvidence(v, { now }).passed).toBe(false); });
  it("reports applied SQL content uncertainty", () => { const v: any = production(); v.migration.appliedSqlContent = "unverified"; expect(verifyAuthoritativeEvidence(v, { now }).passed).toBe(false); expect(verifyAuthoritativeEvidence(v, { now }).failures).toContain("migration:applied-sql-content-unverified"); });
  it("blocks an active send claim", () => { const v: any = production(); v.quiescence.activeSendClaims = 1; expect(verifyAuthoritativeEvidence(v, { now }).passed).toBe(false); });
  it("blocks an unresolved uncertain SMTP state", () => { const v: any = production(); v.quiescence.unresolvedUncertainAttempts = 1; expect(verifyAuthoritativeEvidence(v, { now }).passed).toBe(false); });
  it("blocks enabled retries", () => { const v: any = production(); v.quiescence.automaticRetriesDisabled = false; expect(verifyAuthoritativeEvidence(v, { now }).passed).toBe(false); });
  it("blocks an active legacy route", () => { const v: any = production(); v.quiescence.legacyRoutesDisabled = false; expect(verifyAuthoritativeEvidence(v, { now }).passed).toBe(false); });
  it("blocks unknown in-flight state", () => { const v: any = production(); v.quiescence.inFlightStateKnown = false; expect(verifyAuthoritativeEvidence(v, { now }).passed).toBe(false); });
  it("blocks an insufficient drain interval", () => { const v: any = production(); v.quiescence.drainIntervalSeconds = 60; expect(verifyAuthoritativeEvidence(v, { now }).passed).toBe(false); });
  it("invalidates evidence after a state-change recheck is absent", () => { const v: any = production(); v.quiescence.drainRechecked = false; expect(verifyAuthoritativeEvidence(v, { now }).passed).toBe(false); });
  it("allows safe repeated disposable verification", () => { const v = disposable(); expect(verifyAuthoritativeEvidence(v, { now, mode: "disposable" }).passed).toBe(true); expect(verifyAuthoritativeEvidence(v, { now, mode: "disposable" }).passed).toBe(true); });
  it("rejects production CLI input JSON instead of treating it as authoritative", () => {
    const script = "scripts/round8/authoritative-evidence.mjs";
    expect(() => execFileSync("node", [script, "production", "C:\\DEV_LOCAL\\round8-forged-output.json", "C:\\DEV_LOCAL\\round8-forged-input.json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })).toThrow();
  });
  it("blocks the production collector when the approved authenticated sources are unavailable", async () => {
    await expect(collectProductionEvidence({ env: {} })).rejects.toThrow("approved-target-and-release-binding-required");
  });
  it("accepts an authoritative direct host with verified TLS configuration", () => {
    expect(validateProductionConnectionConfig({ env: {}, authoritativeHost: "db.jqfodlzcsgfocyuawzyx.supabase.co" })).toEqual({ host: "db.jqfodlzcsgfocyuawzyx.supabase.co", sslmode: "verify-full" });
  });
  it("rejects a caller supplied host that differs from project metadata", () => expect(() => validateProductionConnectionConfig({ env: { PGHOST: "wrong.example" }, authoritativeHost: "db.jqfodlzcsgfocyuawzyx.supabase.co" })).toThrow("pghost-does-not-match-authoritative-host"));
  it("rejects PGHOSTADDR redirection", () => expect(() => validateProductionConnectionConfig({ env: { PGHOSTADDR: "203.0.113.10" }, authoritativeHost: "db.jqfodlzcsgfocyuawzyx.supabase.co" })).toThrow("pghostaddr-override-forbidden"));
  it("rejects PostgreSQL service-file redirection", () => expect(() => validateProductionConnectionConfig({ env: { PGSERVICE: "wrong-service" }, authoritativeHost: "db.jqfodlzcsgfocyuawzyx.supabase.co" })).toThrow("pgservice-override-forbidden"));
  it("rejects a caller supplied service file", () => expect(() => validateProductionConnectionConfig({ env: { PGSERVICEFILE: "C:\\wrong\\pg_service.conf" }, authoritativeHost: "db.jqfodlzcsgfocyuawzyx.supabase.co" })).toThrow("pgservicefile-override-forbidden"));
  it("rejects insecure TLS modes", () => expect(() => validateProductionConnectionConfig({ env: { PGSSLMODE: "prefer" }, authoritativeHost: "db.jqfodlzcsgfocyuawzyx.supabase.co" })).toThrow("insecure-sslmode-forbidden"));
  it("rejects psql connection argument overrides", () => expect(() => validateProductionConnectionConfig({ env: { ROUND8_PSQL_PREFIX_JSON: '["-h","wrong.example"]' }, authoritativeHost: "db.jqfodlzcsgfocyuawzyx.supabase.co" })).toThrow("psql-prefix-override-forbidden"));
  it("rejects missing authoritative endpoint metadata", () => expect(() => validateProductionConnectionConfig({ env: {}, authoritativeHost: undefined })).toThrow("authoritative-database-host-missing"));
  it("rejects an unverified TLS session", () => expect(() => parseVerifiedSessionIdentity("db\t170000\tpostgres\t203.0.113.10\t5432\tf\t\t")).toThrow("verified-tls-session-identity-missing"));
  it("accepts a verified TLS session observation", () => expect(parseVerifiedSessionIdentity("db\t170000\tpostgres\t203.0.113.10\t5432\tt\tTLSv1.3\tTLS_AES_256_GCM_SHA384").serverAddress).toBe("203.0.113.10"));
  it("accepts PostgreSQL true TLS serialization and host address CIDRs", () => { expect(parseVerifiedSessionIdentity("db\t170000\tpostgres\t::1/128\t5432\ttrue\tTLSv1.3\tcipher").ssl).toBe(true); expect(normalizePostgresHostAddress("127.0.0.1/32")).toBe("127.0.0.1"); expect(normalizePostgresHostAddress("::1/128")).toBe("::1"); });
  it("rejects malformed TLS and non-host PostgreSQL addresses", () => { expect(() => parseVerifiedSessionIdentity("db\t1\tu\t1.2.3.4/32\t5432\ttrueish\tTLS\tc")).toThrow(); expect(() => normalizePostgresHostAddress("127.0.0.1/24")).toThrow(); expect(() => normalizePostgresHostAddress("not-an-ip/32")).toThrow(); expect(() => normalizePostgresHostAddress("::1/32")).toThrow(); });
  it("rejects malformed IPv6 and manifests without an independent contract", () => { expect(() => normalizePostgresHostAddress("::::/128")).toThrow(); expect(() => validateMigrationManifest({ manifestVersion: 1, targetProject: "p", sharedPrerequisites: [], approvedOppsEngineSequence: [] }, { projectRef: "p" })).toThrow("release-contract-required"); });
  it("rejects production evidence without endpoint and TLS binding", () => {
    const v: any = production();
    expect(verifyAuthoritativeEvidence(v, { now }).failures).toContain("targetIdentity:connection-binding-unverified");
  });
});
