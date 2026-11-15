import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
// @ts-expect-error This production collector intentionally remains plain Node ESM.
import { canonicalizeHostAddress, reconcileMigrationHistory, resolveVerifiedManifestFile, validateMigrationManifest } from "../../scripts/round8/authoritative-evidence.mjs";
import contract from "../../scripts/round8/release-contract-v1.json";

const projectRef = contract.targetProject;
const fullManifest = {
  manifestVersion: 2,
  contractId: contract.contractId,
  targetProject: projectRef,
  sharedPrerequisites: structuredClone(contract.sharedPrerequisites),
  approvedOppsEngineSequence: structuredClone(contract.releaseSequence),
  excludedMigrations: structuredClone(contract.excludedMigrationIds),
};

describe("P1-02 verification contracts", () => {
  it("A: canonicalizes equivalent IPv6 only within the same family and rejects mapped addresses", () => {
    expect(canonicalizeHostAddress("0:0:0:0:0:0:0:1/128")).toEqual(canonicalizeHostAddress("::1/128"));
    expect(canonicalizeHostAddress("2001:0DB8:0:0:0:0:0:1/128")).toEqual(canonicalizeHostAddress("2001:db8::1/128"));
    expect(() => canonicalizeHostAddress("::ffff:192.0.2.1/128")).toThrow("ipv4-mapped");
    for (const input of ["::::/128", "1::2::3/128", "256.0.0.1/32", "127.0.0.1/24", "::1/64", "127.0.0.1/128", "::1", "[::1]/128"]) expect(() => canonicalizeHostAddress(input)).toThrow();
  });

  it("B: requires the independently defined complete release inventory", () => {
    expect(validateMigrationManifest(fullManifest, { projectRef, contract }).approvedOppsEngineSequence).toHaveLength(11);
    for (const mutate of [
      (v: any) => { v.approvedOppsEngineSequence.pop(); },
      (v: any) => { v.approvedOppsEngineSequence = v.approvedOppsEngineSequence.filter((x: any) => x.id !== "20261113063001"); },
      (v: any) => { v.sharedPrerequisites = []; },
      (v: any) => { v.approvedOppsEngineSequence.push({ ...v.approvedOppsEngineSequence[0] }); },
      (v: any) => { v.approvedOppsEngineSequence[0].sha256 = "0".repeat(64); },
      (v: any) => { v.approvedOppsEngineSequence[0].unapproved = true; },
      (v: any) => { v.contractId = "other"; },
    ]) { const value: any = structuredClone(fullManifest); mutate(value); expect(() => validateMigrationManifest(value, { projectRef, contract })).toThrow(); }
  });

  it("D: models pending pre-cutover, intermediate and post-cutover states separately", () => {
    const shared = contract.sharedPrerequisites.map((entry) => entry.id);
    const release = contract.releaseSequence.map((entry) => entry.id);
    const intermediate = [...shared, ...release.slice(0, -1)];
    const post = [...intermediate, release.at(-1)!];
    expect(reconcileMigrationHistory({ observedVersions: shared, expectedVersions: shared, phase: "pre-cutover", contract })).toMatchObject({ passed: true, pendingReleaseIds: release });
    expect(reconcileMigrationHistory({ observedVersions: intermediate, expectedVersions: intermediate, phase: "intermediate-pre-p1-02", contract })).toMatchObject({ passed: true, pendingReleaseIds: [release.at(-1)] });
    expect(reconcileMigrationHistory({ observedVersions: post, expectedVersions: post, phase: "post-cutover", contract })).toMatchObject({ passed: true, pendingReleaseIds: [] });
    expect(reconcileMigrationHistory({ observedVersions: shared, expectedVersions: shared, phase: "post-cutover", contract }).passed).toBe(false);
    expect(reconcileMigrationHistory({ observedVersions: post, expectedVersions: post, phase: "pre-cutover", contract }).passed).toBe(false);
  });

  it("D: rejects premature, missing, unknown, excluded, duplicate and reordered history", () => {
    const shared = contract.sharedPrerequisites.map((entry) => entry.id);
    const release = contract.releaseSequence.map((entry) => entry.id);
    const post = [...shared, ...release];
    expect(reconcileMigrationHistory({ observedVersions: [...shared, release[0]], expectedVersions: [...shared, release[0]], phase: "pre-cutover", contract }).passed).toBe(false);
    expect(reconcileMigrationHistory({ observedVersions: post.slice(0, -1), expectedVersions: post, phase: "post-cutover", contract }).passed).toBe(false);
    expect(reconcileMigrationHistory({ observedVersions: [...post, "20990101000000"], expectedVersions: post, phase: "post-cutover", contract }).passed).toBe(false);
    expect(reconcileMigrationHistory({ observedVersions: [...shared, "20261113100000"], expectedVersions: [...shared, "20261113100000"], phase: "pre-cutover", contract }).passed).toBe(false);
    expect(reconcileMigrationHistory({ observedVersions: [...shared, shared[0]], expectedVersions: [...shared, shared[0]], phase: "pre-cutover", contract }).passed).toBe(false);
    expect(reconcileMigrationHistory({ observedVersions: [shared[1], shared[0], shared[2]], expectedVersions: [shared[1], shared[0], shared[2]], phase: "pre-cutover", contract }).passed).toBe(false);
  });

  it("D: rejects a phase contract that skips release checkpoints", () => {
    const invalidContract: any = structuredClone(contract);
    const release = invalidContract.releaseSequence.map((entry: any) => entry.id);
    invalidContract.phases["intermediate-pre-p1-02"].appliedReleaseIds = [release[1]];
    invalidContract.phases["intermediate-pre-p1-02"].pendingReleaseIds = [release[0], ...release.slice(2)];
    const shared = invalidContract.sharedPrerequisites.map((entry: any) => entry.id);
    expect(reconcileMigrationHistory({ observedVersions: shared, expectedVersions: shared, phase: "intermediate-pre-p1-02", contract: invalidContract }).passed).toBe(false);
  });

  it("C: resolves only regular files under the authorised migrations root", () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    const entry = contract.releaseSequence.at(-1)!;
    expect(resolveVerifiedManifestFile(root, entry).sha256).toBe(entry.sha256.toLowerCase());
  });

  it("C: rejects real file links and directory junctions escaping the authorised root", () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "p102-contract-"));
    try {
      const migrations = path.join(fixture, "supabase", "migrations");
      const outside = path.join(fixture, "outside");
      fs.mkdirSync(migrations, { recursive: true }); fs.mkdirSync(outside);
      const entry = contract.releaseSequence.at(-1)!;
      const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../supabase/migrations", entry.file);
      const escapedFile = path.join(outside, entry.file);
      fs.copyFileSync(source, escapedFile);
      fs.symlinkSync(escapedFile, path.join(migrations, entry.file), "file");
      expect(() => resolveVerifiedManifestFile(fixture, entry)).toThrow("indirection-forbidden");
      fs.unlinkSync(path.join(migrations, entry.file)); fs.rmdirSync(migrations);
      fs.symlinkSync(outside, migrations, process.platform === "win32" ? "junction" : "dir");
      expect(() => resolveVerifiedManifestFile(fixture, entry)).toThrow("indirection-forbidden");
    } finally { fs.rmSync(fixture, { recursive: true, force: true }); }
  });
});
