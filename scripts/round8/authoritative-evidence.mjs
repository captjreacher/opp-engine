import crypto from "node:crypto";
import dns from "node:dns/promises";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const round5Id = "20261113100000";
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultReleaseContractPath = path.join(moduleDirectory, "release-contract-v1.json");
const iso = (value) => new Date(value).toISOString();
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
};
const sha256 = (value) => crypto.createHash("sha256").update(Buffer.isBuffer(value) ? value : typeof value === "string" ? value : canonical(value)).digest("hex");
const fail = (failures, code) => failures.push(code);

export function verifyAuthoritativeEvidence(evidence, { now = new Date(), mode = "production", expectedProjectRef, expectedDatabaseId, expectedCandidateSha, expectedManifestSha } = {}) {
  const failures = [];
  if (!evidence || evidence.evidenceKind !== "authoritative-release-evidence") fail(failures, "evidence.kind:invalid");
  if (evidence?.mode !== mode) fail(failures, "evidence.mode:mismatch");
  if (mode === "production" && evidence?.collection?.sourceType !== "direct-authenticated") fail(failures, "collection.sourceType:not-direct-authenticated");
  if (mode === "production" && evidence?.collection?.synthetic === true) fail(failures, "collection.synthetic:true");
  if (evidence?.collection?.authenticated !== true) fail(failures, "collection.authenticated:false");
  if (!evidence?.collection?.collectorVersion) fail(failures, "collection.collectorVersion:missing");
  if (!evidence?.collection?.preflightId) fail(failures, "collection.preflightId:missing");
  if (!evidence?.collection?.collectedAt || !evidence?.collection?.expiresAt) fail(failures, "collection.freshness:missing");
  else if (new Date(evidence.collection.expiresAt) <= now || new Date(evidence.collection.collectedAt) > now) fail(failures, "collection.freshness:invalid");
  if (!evidence?.collection?.sourceEvidenceHash) fail(failures, "collection.sourceEvidenceHash:missing");
  if (evidence?.collection?.sourceEvidenceHash !== sha256(evidence.observations ?? {})) fail(failures, "collection.sourceEvidenceHash:mismatch");

  const target = evidence?.targetIdentity;
  if (!target?.projectRef || !target?.databaseId || target.authenticated !== true || target.boundToApprovedTarget !== true) fail(failures, "targetIdentity:unauthenticated-or-unbound");
  if (mode === "production") {
    const binding = target?.connectionBinding;
    if (!binding?.projectRef || binding.projectRef !== target.projectRef || !binding.authoritativeDatabaseHost || binding.effectiveHost !== binding.authoritativeDatabaseHost || binding.tlsMode !== "verify-full" || binding.tlsVerified !== true || binding.routeVerified !== true || binding.poolerOrProxy === true || !binding.effectiveServerAddress) fail(failures, "targetIdentity:connection-binding-unverified");
  }
  if (expectedProjectRef && target?.projectRef !== expectedProjectRef) fail(failures, "targetIdentity.projectRef:mismatch");
  if (expectedDatabaseId && target?.databaseId !== expectedDatabaseId) fail(failures, "targetIdentity.databaseId:mismatch");
  if (!evidence?.releaseBinding?.candidateSha || !evidence?.releaseBinding?.manifestSha || (mode === "production" && (!evidence?.releaseBinding?.contractId || !evidence?.releaseBinding?.contractSha))) fail(failures, "releaseBinding:missing");
  if (expectedCandidateSha && evidence.releaseBinding.candidateSha !== expectedCandidateSha) fail(failures, "releaseBinding.candidateSha:mismatch");
  if (expectedManifestSha && evidence.releaseBinding.manifestSha !== expectedManifestSha) fail(failures, "releaseBinding.manifestSha:mismatch");

  const backup = evidence?.backupRestore;
  if (!backup?.artifactExists || !backup.artifactSha256 || !backup.sourceIdentity || backup.sourceIdentity !== target?.databaseId) fail(failures, "backup.artifact:missing-or-wrong-source");
  if (backup.artifactHashVerified !== true) fail(failures, "backup.artifactHashVerified:false");
  if (backup.restore?.providerVerified !== true || backup.restore?.status !== "passed") fail(failures, "backup.restore:not-provider-verified");
  if (backup.restore?.targetIdentity !== target?.databaseId || backup.restore?.isolated !== true) fail(failures, "backup.restore:wrong-target-or-not-isolated");
  if (backup.restore?.schemaIntegrity !== true || backup.restore?.dataIntegrity !== true || backup.restore?.consistentWithBackup !== true) fail(failures, "backup.restore:integrity-mismatch");
  if (!backup.restore?.evidenceId || !backup.restore?.completedAt) fail(failures, "backup.restore:evidence-missing");

  const migration = evidence?.migration;
  if (migration?.observedFromDatabase !== true || migration?.targetDatabaseId !== target?.databaseId) fail(failures, "migration:not-observed-from-target");
  if (migration?.supersededRound5Present === true || (migration?.observedVersions ?? []).some((version) => String(version) === round5Id)) fail(failures, "migration:superseded-round5-present");
  if ((mode === "production" && (!migration?.contractId || !migration?.phase || migration?.baselineVerified !== true)) || migration?.missingPrerequisites?.length || migration?.unexpectedVersions?.length || migration?.orderingValid !== true) fail(failures, "migration:history-mismatch");
  if (migration?.localHashVerification !== "verified") fail(failures, "migration:local-hash-not-verified");
  if (migration?.appliedSqlContent !== "verified") fail(failures, "migration:applied-sql-content-unverified");

  const q = evidence?.quiescence;
  if (q?.observedFromAuthoritativeSources !== true || q?.legacyRoutesDisabled !== true || q?.workersStopped !== true || q?.automaticRetriesDisabled !== true) fail(failures, "quiescence:legacy-or-retry-path-active");
  if (q?.activeSendClaims !== 0 || q?.unresolvedUncertainAttempts !== 0 || q?.outstandingClaims !== 0) fail(failures, "quiescence:active-send-state");
  if (q?.inFlightStateKnown !== true) fail(failures, "quiescence:inflight-unknown");
  if (!Number.isFinite(q?.maxRequestLifetimeSeconds) || !Number.isFinite(q?.drainIntervalSeconds) || q.drainIntervalSeconds < q.maxRequestLifetimeSeconds) fail(failures, "quiescence:insufficient-drain-interval");
  if (q?.drainRechecked !== true || !q?.recheckedAt) fail(failures, "quiescence:drain-not-rechecked");

  const deployment = evidence?.deployment;
  if (deployment?.observedFromControlPlane !== true || deployment?.candidateMatch !== true || deployment?.sendingActivationEnabled !== false) fail(failures, "deployment:unverified-or-activation-enabled");
  if (mode === "production" && evidence?.operatorDeclarationOnly === true) fail(failures, "evidence:operator-declaration-only");
  return { passed: failures.length === 0, failures, checkedAt: now.toISOString() };
}

export function buildDisposableEvidence({ targetIdentity, observations, releaseBinding, backupRestore, migration, quiescence, deployment, now = new Date() }) {
  return {
    evidenceKind: "authoritative-release-evidence",
    mode: "disposable",
    operatorDeclarationOnly: false,
    targetIdentity: { ...targetIdentity, authenticated: true, boundToApprovedTarget: true },
    releaseBinding,
    backupRestore,
    migration,
    quiescence,
    deployment,
    observations,
    collection: {
      sourceType: "synthetic",
      synthetic: true,
      authenticated: true,
      collectorVersion: "round8-p102-1",
      preflightId: crypto.randomUUID(),
      collectedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 3600_000).toISOString(),
      sourceEvidenceHash: sha256(observations),
    },
  };
}

const run = (command, args, env = process.env) => execFileSync(command, args, { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const json = (value, label) => { try { return JSON.parse(value); } catch { throw new Error(`${label}:invalid-json`); } };

const normalizeHost = (value) => String(value ?? "").trim().toLowerCase().replace(/\.$/, "");

export function validateProductionConnectionConfig({ env = process.env, authoritativeHost } = {}) {
  const host = normalizeHost(authoritativeHost);
  if (!host) throw new Error("production-preflight:authoritative-database-host-missing");
  if (env.PGHOST && normalizeHost(env.PGHOST) !== host) throw new Error("production-preflight:pghost-does-not-match-authoritative-host");
  if (env.PGHOSTADDR) throw new Error("production-preflight:pghostaddr-override-forbidden");
  if (env.PGSERVICE) throw new Error("production-preflight:pgservice-override-forbidden");
  if (env.PGSERVICEFILE) throw new Error("production-preflight:pgservicefile-override-forbidden");
  if (env.PGSSLMODE && env.PGSSLMODE !== "verify-full") throw new Error("production-preflight:insecure-sslmode-forbidden");
  if (env.ROUND8_PSQL_PREFIX_JSON) throw new Error("production-preflight:psql-prefix-override-forbidden");
  return { host, sslmode: "verify-full" };
}

export function parseVerifiedSessionIdentity(value) {
  const [database, serverVersion, user, serverAddress, serverPort, ssl, tlsVersion, cipher] = String(value).split("\t");
  if (!database || !serverVersion || !user || !serverAddress || !serverPort || !["t", "true"].includes(ssl) || !tlsVersion || !cipher || !Number.isInteger(Number(serverPort)) || Number(serverPort) < 1 || Number(serverPort) > 65535) throw new Error("production-preflight:verified-tls-session-identity-missing");
  return { database, serverVersion, user, serverAddress, serverPort: Number(serverPort), ssl: true, tlsVersion, cipher };
}

export function canonicalizeHostAddress(value) {
  const raw = String(value ?? "").trim();
  const slash = raw.lastIndexOf("/");
  if (slash <= 0 || slash !== raw.indexOf("/")) throw new Error("production-preflight:invalid-postgresql-host-address");
  const address = raw.slice(0, slash);
  const prefix = raw.slice(slash + 1);
  const family = net.isIP(address);
  if (!family) throw new Error("production-preflight:invalid-postgresql-host-address");
  if ((family === 4 && prefix !== "32") || (family === 6 && prefix !== "128")) throw new Error("production-preflight:unsupported-postgresql-address-prefix");
  if (family === 4) return { family, value: address, prefix: 32 };
  const normalized = new URL(`http://[${address}]/`).hostname.slice(1, -1).toLowerCase();
  if (normalized.startsWith("::ffff:")) throw new Error("production-preflight:ipv4-mapped-ipv6-unsupported");
  return { family, value: normalized, prefix: 128 };
}

export function normalizePostgresHostAddress(value) { return canonicalizeHostAddress(value).value; }

const sameEntries = (actual, expected, includeFile) => Array.isArray(actual) && actual.length === expected.length && actual.every((entry, index) => {
  const source = expected[index];
  const allowed = includeFile ? ["id", "file", "sha256"] : ["id", "source", "sha256"];
  return entry && typeof entry === "object" && Object.keys(entry).every((key) => allowed.includes(key)) && String(entry.id) === String(source.id) && String(entry.sha256 ?? "").toUpperCase() === String(source.sha256).toUpperCase() && (!includeFile || entry.file === source.file) && (source.source === undefined || entry.source === source.source);
});

export function loadReleaseContract(contractPath = defaultReleaseContractPath) {
  const bytes = fs.readFileSync(contractPath);
  const contract = json(bytes.toString("utf8"), "release-contract");
  if (!contract || contract.contractVersion !== 1 || typeof contract.contractId !== "string" || !Array.isArray(contract.sharedPrerequisites) || !Array.isArray(contract.releaseSequence) || !contract.phases || !Array.isArray(contract.excludedMigrationIds)) throw new Error("production-preflight:release-contract-invalid");
  return { contract, contractPath, contractSha: sha256(bytes) };
}

const assertNoFilesystemIndirection = (candidateRoot, filePath) => {
  const root = fs.realpathSync.native(candidateRoot);
  const relative = path.relative(root, filePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("production-preflight:manifest-file-outside-authorised-root");
  let current = root;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error("production-preflight:manifest-file-indirection-forbidden");
  }
};

export function resolveVerifiedManifestFile(candidateRoot, entry) {
  if (!entry || typeof entry.file !== "string" || !/^[0-9]{14}_[a-z0-9_]+\.sql$/.test(entry.file)) throw new Error("production-preflight:manifest-file-invalid");
  const root = fs.realpathSync.native(candidateRoot);
  const migrationsRoot = path.join(root, "supabase", "migrations");
  const migrationRootReal = fs.realpathSync.native(migrationsRoot);
  const filePath = path.join(migrationsRoot, entry.file);
  assertNoFilesystemIndirection(root, filePath);
  const realFile = fs.realpathSync.native(filePath);
  const relative = path.relative(migrationRootReal, realFile);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("production-preflight:manifest-file-outside-authorised-root");
  const before = fs.lstatSync(filePath);
  if (!before.isFile()) throw new Error("production-preflight:manifest-file-not-regular");
  const fd = fs.openSync(filePath, "r");
  try {
    if (!fs.fstatSync(fd).isFile()) throw new Error("production-preflight:manifest-file-not-regular");
    const bytes = fs.readFileSync(fd);
    const after = fs.lstatSync(filePath);
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || fs.realpathSync.native(filePath) !== realFile) throw new Error("production-preflight:manifest-file-changed-during-verification");
    return { filePath, sha256: sha256(bytes), bytes };
  } finally { fs.closeSync(fd); }
}

export function validateMigrationManifest(manifest, { projectRef, contract } = {}) {
  if (!contract) throw new Error("production-preflight:release-contract-required");
  const keys = ["manifestVersion", "contractId", "targetProject", "sharedPrerequisites", "approvedOppsEngineSequence", "excludedMigrations"];
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest) || Object.keys(manifest).some((key) => !keys.includes(key)) || manifest.manifestVersion !== 2 || manifest.contractId !== contract.contractId || manifest.targetProject !== projectRef || projectRef !== contract.targetProject) throw new Error("production-preflight:manifest-identity-or-version-invalid");
  if (!sameEntries(manifest.sharedPrerequisites, contract.sharedPrerequisites, false) || !sameEntries(manifest.approvedOppsEngineSequence, contract.releaseSequence, true) || canonical(manifest.excludedMigrations) !== canonical(contract.excludedMigrationIds)) throw new Error("production-preflight:manifest-not-complete-authoritative-inventory");
  const ids = new Set();
  for (const entry of [...manifest.sharedPrerequisites, ...manifest.approvedOppsEngineSequence]) {
    if (!/^[0-9]{14}$/.test(String(entry.id)) || !/^[a-f0-9]{64}$/i.test(entry.sha256 ?? "") || ids.has(String(entry.id))) throw new Error("production-preflight:manifest-entry-invalid");
    ids.add(String(entry.id));
  }
  return manifest;
}

export function reconcileMigrationHistory({ observedVersions, expectedVersions, phase, contract }) {
  const failures = [];
  const phaseDefinition = contract?.phases?.[phase];
  if (!phaseDefinition || !Array.isArray(observedVersions) || !Array.isArray(expectedVersions) || new Set(observedVersions).size !== observedVersions.length || new Set(expectedVersions).size !== expectedVersions.length) failures.push("migration:history-input-invalid");
  const required = [...(contract?.sharedPrerequisites ?? []).map((entry) => String(entry.id)), ...(phaseDefinition?.requiredReleaseIds ?? []).map(String)];
  const missing = required.filter((id) => !expectedVersions.includes(id) || !observedVersions.includes(id));
  const unexpected = observedVersions.filter((id) => !expectedVersions.includes(id));
  const baselineMissing = expectedVersions.filter((id) => !observedVersions.includes(id));
  const positions = required.map((id) => observedVersions.indexOf(id));
  const orderingValid = positions.every((position, index) => position >= 0 && (index === 0 || position > positions[index - 1]));
  const excluded = (contract?.excludedMigrationIds ?? []).filter((id) => observedVersions.includes(id) || expectedVersions.includes(id));
  if (missing.length || unexpected.length || baselineMissing.length || excluded.length || !orderingValid) failures.push("migration:history-mismatch");
  return { passed: failures.length === 0, failures, missing, unexpected: [...unexpected, ...baselineMissing], excluded, orderingValid, required };
}

export async function collectProductionEvidence({ env = process.env, exec = run, now = new Date() } = {}) {
  const projectRef = env.ROUND8_EXPECTED_PROJECT_REF;
  const databaseId = env.ROUND8_EXPECTED_DATABASE_ID;
  const candidateSha = env.ROUND8_CANDIDATE_SHA;
  const manifestPath = env.ROUND8_MANIFEST_PATH;
  const backupVerifier = env.ROUND8_BACKUP_PROVIDER_VERIFIER;
  const schemaVerifier = env.ROUND8_SCHEMA_FINGERPRINT_VERIFIER;
  const quiescenceVerifier = env.ROUND8_QUIESCENCE_VERIFIER;
  const deploymentVerifier = env.ROUND8_DEPLOYMENT_VERIFIER;
  const migrationBaselineVerifier = env.ROUND8_MIGRATION_BASELINE_VERIFIER;
  const releaseContractPath = env.ROUND8_RELEASE_CONTRACT_PATH ?? defaultReleaseContractPath;
  if (!projectRef || !databaseId || !candidateSha || !manifestPath) throw new Error("production-preflight:approved-target-and-release-binding-required");
  if (!backupVerifier) throw new Error("production-preflight:authenticated-backup-provider-verifier-required");
  if (!schemaVerifier || !quiescenceVerifier || !deploymentVerifier || !migrationBaselineVerifier) throw new Error("production-preflight:authenticated-schema-quiescence-deployment-and-migration-baseline-verifiers-required");
  if (!fs.existsSync(manifestPath)) throw new Error("production-preflight:manifest-not-found");
  const { contract, contractSha } = loadReleaseContract(releaseContractPath);
  const manifestSha = sha256(fs.readFileSync(manifestPath));
  const projects = json(exec("supabase", ["projects", "list", "--output", "json"], env), "supabase-projects");
  const project = (Array.isArray(projects) ? projects : projects.projects ?? []).find((item) => item.ref === projectRef);
  if (!project || project.ref !== projectRef) throw new Error("production-preflight:project-ref-not-authenticated");
  const connectionConfig = validateProductionConnectionConfig({ env, authoritativeHost: project.database?.host });
  const resolvedAddresses = (await dns.lookup(connectionConfig.host, { all: true })).map(({ address }) => canonicalizeHostAddress(`${address}/${net.isIP(address) === 4 ? "32" : "128"}`));
  if (!resolvedAddresses.length) throw new Error("production-preflight:authoritative-host-did-not-resolve");
  const functionList = json(exec("supabase", ["functions", "list", "--project-ref", projectRef, "--output", "json"], env), "supabase-functions");
  const functions = Array.isArray(functionList) ? functionList : functionList.functions ?? [];
  const opportunities = functions.find((item) => item.name === "opportunities");
  if (!opportunities) throw new Error("production-preflight:opportunities-function-not-observed");

  const psql = env.ROUND8_PSQL ?? "psql";
  const psqlEnv = { ...env, PGHOST: connectionConfig.host, PGSSLMODE: connectionConfig.sslmode, PGHOSTADDR: undefined, PGSERVICE: undefined, PGSERVICEFILE: undefined, PGAPPNAME: "round8-authoritative-preflight" };
  const query = (sql) => exec(psql, ["-X", "-h", connectionConfig.host, "-At", "-v", "ON_ERROR_STOP=1", "-c", sql], psqlEnv);
  const identitySql = "select current_database() || E'\\t' || current_setting('server_version_num') || E'\\t' || current_user || E'\\t' || coalesce(inet_server_addr()::text,'') || E'\\t' || coalesce(inet_server_port()::text,'') || E'\\t' || coalesce((select ssl::text from pg_stat_ssl where pid=pg_backend_pid()),'') || E'\\t' || coalesce((select version from pg_stat_ssl where pid=pg_backend_pid()),'') || E'\\t' || coalesce((select cipher from pg_stat_ssl where pid=pg_backend_pid()),'')";
  const identity = parseVerifiedSessionIdentity(query(identitySql));
  if (identity.database !== databaseId) throw new Error("production-preflight:database-identity-mismatch");
  const effectiveServerAddress = canonicalizeHostAddress(identity.serverAddress);
  if (!resolvedAddresses.some((address) => address.family === effectiveServerAddress.family && address.value === effectiveServerAddress.value)) throw new Error("production-preflight:database-route-not-bound-to-authoritative-host");
  const observedVersions = query("select version from supabase_migrations.schema_migrations order by version").split(/\r?\n/).filter(Boolean);
  const quiescenceRows = query("select coalesce((select count(*) from public.opportunity_outreach_send_attempts where state in ('claimed','sending')),0) || E'\\t' || coalesce((select count(*) from public.opportunity_outreach_send_attempts where state='send_unknown' and reconciled_at is null),0)").split("\t");
  const backupRestore = json(exec(backupVerifier, ["--read-only", "--project-ref", projectRef, "--database-id", databaseId], env), "backup-provider-verifier");
  const manifest = validateMigrationManifest(json(fs.readFileSync(manifestPath, "utf8"), "manifest"), { projectRef, contract });
  const candidateRoot = path.resolve(path.dirname(manifestPath), "..", "..");
  const localHashVerification = manifest.approvedOppsEngineSequence.every((entry) => resolveVerifiedManifestFile(candidateRoot, entry).sha256.toUpperCase() === entry.sha256.toUpperCase()) ? "verified" : "mismatch";
  const baseline = json(exec(migrationBaselineVerifier, ["--read-only", "--project-ref", projectRef, "--database-id", databaseId, "--contract-id", contract.contractId], env), "migration-baseline-verifier");
  if (baseline?.verified !== true || baseline?.contractId !== contract.contractId || baseline?.projectRef !== projectRef || baseline?.databaseId !== databaseId || !Array.isArray(baseline?.expectedVersions)) throw new Error("production-preflight:migration-baseline-not-authenticated");
  const history = reconcileMigrationHistory({ observedVersions, expectedVersions: baseline.expectedVersions.map(String), phase: baseline.phase, contract });
  const appliedSql = json(exec(schemaVerifier, ["--read-only", "--project-ref", projectRef, "--database-id", databaseId], env), "schema-fingerprint-verifier");
  const observedQuiescence = json(exec(quiescenceVerifier, ["--read-only", "--project-ref", projectRef, "--database-id", databaseId], env), "quiescence-verifier");
  const observedDeployment = json(exec(deploymentVerifier, ["--read-only", "--project-ref", projectRef, "--candidate-sha", candidateSha], env), "deployment-verifier");
  const connectionBinding = { projectRef, authoritativeDatabaseHost: connectionConfig.host, effectiveHost: connectionConfig.host, resolvedAddresses, effectiveServerAddress, effectiveServerPort: identity.serverPort, tlsMode: connectionConfig.sslmode, tlsVerified: true, routeVerified: true, poolerOrProxy: false };
  const observations = { project, opportunities, identity, connectionBinding, observedVersions, quiescenceRows, backupRestore, appliedSql, observedQuiescence, observedDeployment };
  const evidence = {
    evidenceKind: "authoritative-release-evidence", mode: "production", operatorDeclarationOnly: false,
    targetIdentity: { projectRef, databaseId, authenticated: true, boundToApprovedTarget: true, databaseServerVersion: identity.serverVersion, databaseHost: connectionConfig.host, connectionBinding },
    releaseBinding: { candidateSha, manifestSha, contractId: contract.contractId, contractSha },
    backupRestore,
    migration: { observedFromDatabase: true, targetDatabaseId: databaseId, observedVersions, contractId: contract.contractId, phase: baseline.phase, baselineVerified: baseline.verified === true, supersededRound5Present: history.excluded.includes(round5Id), missingPrerequisites: history.missing, unexpectedVersions: history.unexpected, orderingValid: history.orderingValid, localHashVerification, appliedSqlContent: appliedSql.appliedSqlContent === "verified" ? "verified" : "unverified", manifestVersion: manifest.manifestVersion },
    quiescence: { ...observedQuiescence, observedFromAuthoritativeSources: observedQuiescence.observedFromAuthoritativeSources === true, activeSendClaims: Number(quiescenceRows[0]), unresolvedUncertainAttempts: Number(quiescenceRows[1]), outstandingClaims: Number(quiescenceRows[0]) },
    deployment: { ...observedDeployment, observedFromControlPlane: observedDeployment.observedFromControlPlane === true },
    observations,
    collection: { sourceType: "direct-authenticated", synthetic: false, authenticated: true, collectorVersion: "round8-p102-1", preflightId: crypto.randomUUID(), collectedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString(), sourceEvidenceHash: sha256(observations) },
  };
  return { evidence, verification: verifyAuthoritativeEvidence(evidence, { now, expectedProjectRef: projectRef, expectedDatabaseId: databaseId, expectedCandidateSha: candidateSha, expectedManifestSha: manifestSha }) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const mode = process.argv[2];
  const outputPath = process.argv[3];
  if (!mode || !outputPath) { console.error("usage: node authoritative-evidence.mjs <production|disposable> <output.json>"); process.exit(2); }
  if (mode === "production") {
    if (process.argv[4]) { console.error("production-preflight:input-json-is-not-accepted"); process.exit(2); }
    try {
      const result = await collectProductionEvidence();
      fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
      console.log(JSON.stringify(result.verification));
      process.exit(result.verification.passed ? 0 : 1);
    } catch (error) { console.error(String(error.message ?? error)); process.exit(1); }
  }
  console.error("disposable mode requires the test harness; it cannot be used as production evidence");
  process.exit(2);
}
