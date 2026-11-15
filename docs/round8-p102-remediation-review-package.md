# P1-02 targeted remediation review package

Scope: only the Round 8 F1/F2/F3 local blockers. No production system, credential,
deployment, migration, or external service was accessed.

Changes in `scripts/round8/authoritative-evidence.mjs`:

- F1 accepts only PostgreSQL's `t` and `true` TLS boolean serializations.
- F2 normalizes only IPv4 `/32` and IPv6 `/128` host addresses before comparison
  with independently resolved authoritative DNS addresses.
- F3 hashes manifest bytes, resolves approved basenames only under
  `supabase/migrations`, and compares normalized SHA-256 values.

The collector remains fail-closed for malformed TLS/address data, invalid prefixes,
bad/missing manifest entries, traversal, missing files, and incorrect hashes.

Focused tests: 44 passed. Build/typecheck: passed. P1-01 files were not edited.
Independent acceptance is required before any production decision.
