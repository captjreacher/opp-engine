import fs from "node:fs";
import { fileURLToPath } from "node:url";

const required = (value, path, failures) => {
  if (value === undefined || value === null || value === "") failures.push(`${path}:missing`);
};

export function evaluatePreflight(input, { now = new Date(), maxEvidenceAgeHours = 24, expectedEnvironment = "production" } = {}) {
  const failures = [];
  required(input?.targetEnvironment, "targetEnvironment", failures);
  if (input?.targetEnvironment !== expectedEnvironment) failures.push(`targetEnvironment:not-${expectedEnvironment}`);

  const backup = input?.backup;
  required(backup?.artifactId, "backup.artifactId", failures);
  required(backup?.scope, "backup.scope", failures);
  required(backup?.sha256, "backup.sha256", failures);
  if (backup?.integrityVerified !== true) failures.push("backup.integrityVerified:false");
  const backupAge = backup?.capturedAt ? now - new Date(backup.capturedAt) : Infinity;
  if (!Number.isFinite(backupAge) || backupAge < 0 || backupAge > maxEvidenceAgeHours * 3600_000) failures.push("backup.capturedAt:stale-or-invalid");
  const restore = backup?.restore;
  if (restore?.status !== "passed") failures.push("backup.restore.status:not-passed");
  if (restore?.targetEnvironment !== "disposable") failures.push("backup.restore.targetEnvironment:not-disposable");
  if (restore?.isolated !== true) failures.push("backup.restore.isolated:false");
  if (restore?.schemaChecksPassed !== true || restore?.dataChecksPassed !== true) failures.push("backup.restore.integrity-checks:failed");
  required(restore?.evidenceId, "backup.restore.evidenceId", failures);

  const q = input?.quiescence;
  if (q?.legacyRoutesDisabled !== true) failures.push("quiescence.legacyRoutesDisabled:false");
  if (q?.workersStopped !== true) failures.push("quiescence.workersStopped:false");
  if (q?.automaticRetriesDisabled !== true) failures.push("quiescence.automaticRetriesDisabled:false");
  if (q?.v72RequestsBlocked !== true) failures.push("quiescence.v72RequestsBlocked:false");
  if (q?.activeSendClaims !== 0) failures.push("quiescence.activeSendClaims:not-zero");
  if (q?.unresolvedInflight !== 0) failures.push("quiescence.unresolvedInflight:not-zero");
  required(q?.stateSource, "quiescence.stateSource", failures);

  const m = input?.migration;
  required(m?.expectedHead, "migration.expectedHead", failures);
  required(m?.observedHead, "migration.observedHead", failures);
  if (m?.expectedHead !== m?.observedHead) failures.push("migration.head:mismatch");
  if (m?.prerequisitesPresent !== true) failures.push("migration.prerequisitesPresent:false");
  if (m?.supersededRound5Included === true) failures.push("migration.supersededRound5Included:true");
  if ((m?.observedSequence ?? []).some((entry) => String(entry?.id ?? "") === "20261113100000" || String(entry?.file ?? "").includes("cockpit_outbound_contact_identity_remediation"))) failures.push("migration.supersededRound5Observed:true");
  if (!Array.isArray(m?.duplicateIds) || m.duplicateIds.length !== 0) failures.push("migration.duplicateIds:not-empty");
  if (m?.orderingValid !== true) failures.push("migration.orderingValid:false");
  if (!Array.isArray(m?.approvedSequence) || m.approvedSequence.length === 0) failures.push("migration.approvedSequence:missing");
  const approvedSequence = (m?.approvedSequence ?? []).map((entry) => ({ id: entry?.id, sha256: entry?.sha256 }));
  const observedSequence = (m?.observedSequence ?? []).map((entry) => ({ id: entry?.id, sha256: entry?.sha256 }));
  if (!Array.isArray(m?.observedSequence) || JSON.stringify(observedSequence) !== JSON.stringify(approvedSequence)) failures.push("migration.sequence:mismatch");
  for (const [index, entry] of (m?.observedSequence ?? []).entries()) {
    required(entry?.id, `migration.observedSequence[${index}].id`, failures);
    required(entry?.sha256, `migration.observedSequence[${index}].sha256`, failures);
  }

  const recovery = input?.recovery;
  if (recovery?.preStateCaptured !== true) failures.push("recovery.preStateCaptured:false");
  if (recovery?.failureInjectionPassed !== true) failures.push("recovery.failureInjectionPassed:false");
  if (recovery?.sendIsolationPreserved !== true) failures.push("recovery.sendIsolationPreserved:false");
  if (recovery?.ledgerHistoryPreserved !== true) failures.push("recovery.ledgerHistoryPreserved:false");
  if (recovery?.unsafeV72RollbackBlocked !== true) failures.push("recovery.unsafeV72RollbackBlocked:false");
  if (recovery?.forwardRecoveryVerified !== true) failures.push("recovery.forwardRecoveryVerified:false");

  return { passed: failures.length === 0, failures, checkedAt: now.toISOString() };
}

export function evaluateVerification(input) {
  const failures = [];
  required(input?.targetEnvironment, "targetEnvironment", failures);
  required(input?.deployedFunction?.version, "deployedFunction.version", failures);
  required(input?.deployedFunction?.sourceSha256, "deployedFunction.sourceSha256", failures);
  if (input?.deployedFunction?.candidateMatch !== true) failures.push("deployedFunction.candidateMatch:false");
  if (input?.nonSendingSmokePassed !== true) failures.push("nonSendingSmokePassed:false");
  if (input?.outreachActivationEnabled === true) failures.push("outreachActivationEnabled:true");
  if (input?.unresolvedUncertainAttempts !== 0) failures.push("unresolvedUncertainAttempts:not-zero");
  if (input?.duplicateHandoffs !== 0) failures.push("duplicateHandoffs:not-zero");
  return { passed: failures.length === 0, failures, checkedAt: new Date().toISOString() };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const mode = process.argv[2];
  const inputPath = process.argv[3];
  const outputPath = process.argv[4];
  const expectedEnvironment = process.argv[5] ?? "production";
  const manifestPath = process.argv[6];
  if (!mode || !inputPath || !outputPath) {
    console.error("usage: node cutover-controls.mjs <preflight|verify> <input.json> <output.json>");
    process.exit(2);
  }
  const input = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  if (mode === "preflight" && manifestPath) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    input.migration ??= {};
    input.migration.approvedSequence = manifest.approvedOppsEngineSequence;
    input.migration.supersededRound5Included = (input.migration.observedSequence ?? []).some((entry) => String(entry?.id ?? "") === "20261113100000");
  }
  const result = mode === "preflight" ? evaluatePreflight(input, { expectedEnvironment }) : evaluateVerification(input);
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(result));
  process.exit(result.passed ? 0 : 1);
}
