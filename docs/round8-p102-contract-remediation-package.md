# P1-02 contract-driven remediation package

This package resolves the four defects recorded in `p102-final-independent-20261114`. It is a local implementation package only. It does not authorize production access, migration, deployment or outreach.

## Authoritative inputs

The release contract is [release-contract-v1.json](../scripts/round8/release-contract-v1.json). It records the preserved provenance for the three shared prerequisites, the original nine reviewed Opps Engine migrations, the approved draft-scenario migration and the accepted P1-01 enforcement migration. It explicitly excludes Round 5 migration `20261113100000`.

The contract defines two supported release phases: `pre-p1-02`, before the P1-01 enforcement migration is applied, and `post-p1-02`, after it is applied. A production collection requires `ROUND8_MIGRATION_BASELINE_VERIFIER`. That verifier is an operational trust boundary: it must return the independently approved complete history for the authenticated target and phase. The collector compares its own database observation against that returned baseline; it does not derive completeness from the manifest or observed history.

## Changed verification behavior

- Address identity validates with Node's IP parser and canonicalizes IPv6 with the runtime URL implementation. IPv4-mapped IPv6 is explicitly unsupported and rejected.
- A manifest is now an exact representation of the contract inventory. It cannot omit P1-01, drop prerequisites, replace a file, reorder entries, add entries, or identify a different release.
- Artifact verification resolves real filesystem paths, forbids symbolic links and junctions, accepts only regular migration files below the approved root, and hashes bytes from a checked file descriptor.
- History reconciliation rejects missing, duplicate, unexpected, excluded and phase-incompatible versions. It requires the separate authenticated baseline verifier.

## Independent-review instructions

Run `src/lib/p102-verification-contracts.test.ts`, then execute the production-mode entry point against newly created disposable PostgreSQL infrastructure using synthetic local control-plane/verifier adapters. Verify an expanded IPv6 positive path and each rejection case in [round8-p102-verification-contracts.md](round8-p102-verification-contracts.md). Then run the full test suite, the three opt-in PostgreSQL suites, build/typecheck and whitespace checks.

The independent reviewer must confirm the final source provenance, the release-contract provenance, the production-wrapper outputs and preservation of P1-01. Production remains dependent on approved credentials, the authenticated migration-baseline verifier, and the other existing external verifiers.
