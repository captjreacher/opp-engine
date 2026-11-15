# Round 8 verifier phase-model remediation

Date: 2026-11-15 (Pacific/Auckland)

## Provenance and scope

Remediation worktree: C:/DEV_LOCAL/opp-engine-round8-verifier-phase-remediation
Branch: codex/round8-verifier-phase-remediation
Parent candidate: 580a410c33cf4c9356a5c3a02a7964fb47b93749
Base: 1bd642786d65eb9583da461970fa8c6c8a7d868e

The governed candidate worktree and commit were not modified. No commit, push, migration, deployment, production query, or external mutation was performed in this remediation worktree.

## Root cause

The original contract used requiredReleaseIds for both release inventory completeness and already-applied database history. reconcileMigrationHistory() consequently required every Round 8 migration to be present even in the intended pre-cutover state. The authenticated captured ledger was therefore mislabeled as a post-cutover mismatch when it was consistent with a pre-cutover transition: shared prerequisites present, Round 8 migrations pending, and the superseded migration absent.

## Corrected phase contract

The contract now separates:

- requiredSharedIds: independently authorised shared history that must already exist;
- appliedReleaseIds: release migrations required at the selected checkpoint;
- pendingReleaseIds: release migrations required later but forbidden from appearing early;
- the complete release inventory, still validated independently by validateMigrationManifest();
- excludedMigrationIds, rejected in every phase.

Supported checkpoints:

- pre-cutover: three shared prerequisites applied; all 11 Round 8 migrations pending;
- intermediate-pre-p1-02: three shared prerequisites and ten release migrations applied; P1-01 pending;
- post-cutover: three shared prerequisites and all 11 release migrations applied.

The reconciler still rejects missing baseline history, unexpected observed history, duplicate IDs, excluded IDs, invalid ordering, premature application and incomplete phase definitions. It does not infer phase from observed history.

## TLS evidence capture

The existing collector already forces PGSSLMODE=verify-full, passes the authenticated project hostname explicitly, rejects PGHOSTADDR/PGSERVICE/PGSERVICEFILE and psql-prefix overrides, and binds the server address to DNS resolution. The remediation makes the evidence binding explicit by recording clientSslMode, hostnameVerification and tlsTrustSource in connectionBinding; production evidence now requires clientSslMode=verify-full, hostnameVerification=true and a non-empty trust source in addition to TLS/session and route checks. No parallel connection mechanism was introduced.

## Verification

- Focused phase/TLS suite: 51 passed.
- Full suite: 527 passed, 50 environment-gated skipped, 0 failed.
- Disposable PostgreSQL suites: 50 passed, 0 skipped.
- Build: passed.
- Node syntax and Git diff checks: passed.
- P1-01 migration SQL was not changed.

The captured authenticated ledger replays as a valid candidate pre-cutover shape only for the scoped release transition: shared prerequisites are present, all 11 release migrations are pending, and 20261113100000 is absent. It remains operationally unverified because the complete shared-service allowlist is not established and the captured SQL evidence reports encrypted TLS but does not itself prove client verify-full certificate/hostname validation.

## Operational authority gaps

The remediation does not authorize release. A named shared database-release operator must still provide the complete independently approved shared migration inventory and fresh authenticated evidence bound to the immutable candidate and inventory. The deployed-history-only exception for 20260907132500 remains preserved; no SQL or checksum was invented.

## Exact reviewed worktree inventory

Tracked modifications:

- docs/round8-p102-verification-contracts.md
- scripts/round8/authoritative-evidence.mjs
- scripts/round8/release-contract-v1.json
- src/lib/authoritative-evidence.test.ts
- src/lib/p102-verification-contracts.test.ts

Untracked implementation/documentation artifact:

- docs/round8-verifier-phase-remediation.md

External evidence is not part of this worktree inventory. No application source, migration SQL, P1-01 enforcement, or other repository/worktree was changed.

The approved migration bytes are the raw files in the preserved governed candidate worktree. Because the repository uses `core.autocrlf=true`, a Git checkout can materialize mixed line endings even when the approved manifest records exact physical bytes. A controlled release package must copy those preserved raw bytes into an external release directory and verify all 11 manifest hashes before collector execution; the verifier must continue hashing raw descriptors and must not normalize bytes.
