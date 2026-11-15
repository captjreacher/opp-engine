# Round 8 P1-02 verification contracts

These contracts were created from the final independent acceptance findings before remediation. They govern the local release checker only. They do not authorize production activity.

## A. Network address identity

The authenticated Supabase project record supplies the database hostname. DNS answers for that hostname and PostgreSQL's TLS-session server address are authoritative inputs. Both must parse as IP addresses using Node's runtime parser; PostgreSQL values must carry `/32` (IPv4) or `/128` (IPv6). IPv6 is canonicalized through the WHATWG URL implementation after validation. IPv4-mapped IPv6 is unsupported and rejected; no cross-family equivalence is accepted. A valid address passes only when its canonical family and canonical value appear in the independently resolved hostname answers. Missing, malformed, wrong-family, mapped, different, or contradictory values abort before evidence output. TLS verify-full, project metadata and DNS controls remain preconditions.

## B. Release completeness

The independent release contract is `scripts/round8/release-contract-v1.json`. Its source provenance is the preserved nine-migration comparison, approved P1 release runbook, and shared-prerequisite governance report. A supplied manifest must exactly reproduce the contract ID, target, shared prerequisites, release sequence and Round 5 exclusion. It cannot define requirements. All entries require a known ID, expected filename and expected SHA-256. Empty, partial, duplicate, reordered, unknown, wrong-release and wrong-hash manifests abort. Candidate identity remains independently checked by the deployment verifier; a manifest cannot assert it.

## C. Filesystem containment

Approved local artifacts are the regular files directly below `<candidate>/supabase/migrations`. The verifier rejects non-basename paths, symbolic links, junctions/reparse points and non-regular files. It resolves the artifact and root paths before opening, opens the exact artifact, hashes bytes from that descriptor, then rechecks the resolved path and file identity. Any change or indirection aborts. This applies to actual filesystem fixtures, not mocked pathname strings.

## D. Migration history reconciliation

The contract defines `pre-p1-02` and `post-p1-02` scoped release states. The direct collector requires an approved read-only migration-baseline verifier to return the exact complete history expected for the authenticated target and selected phase. The collector compares its own database observation to that baseline, then verifies every contract-required version in order and the explicit Round 5 exclusion. Missing, unexpected, duplicate, ambiguous or mismatched-phase history aborts. The baseline verifier is the trust boundary for shared infrastructure history that is not reconstructable from this standalone repository; it must not be derived from the manifest or the collector's observed history.

## Acceptance test boundary

The contract suites run the actual `round8-authoritative-preflight.ps1` production-mode entry point against a network-isolated disposable PostgreSQL container. Local adapters provide only synthetic control-plane and external-verifier outputs; they cannot be production evidence. The suites include expanded/compressed IPv6, mapped IPv6, malformed network inputs, partial manifests, P1-01 omission, unexpected history, links/junctions and path replacement checks.
