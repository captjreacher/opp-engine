# Outreach send consistency — remediation round 2

## Billing contract and residual race

The repository's Billing adapter exposes read-only HTTPS reads for a plan, its
product, and the plan's current price. The current-price response provides an
immutable price identity (`planVersionId`), but the inspected contract does not
provide a catalogue revision token, conditional-read/ETag contract, or atomic
validation/reservation operation that can be bound to the send transaction.

The implementation therefore binds approval and the canonical claim to the
authoritative product ID, plan ID, price-version ID, destination, report
fingerprint, and approval fingerprint. Website sending performs a fresh Billing
read immediately before the claim. The database claim rechecks the persisted
commercial identity against the approved scenario report and template while
holding the draft claim lock.

This is fail-closed identity consistency, but it does not eliminate the
external Billing TOCTOU: Billing may change after the final read and before the
claim transaction. No code in this repository represents that race as closed.
Closing it requires a Billing-side immutable catalogue revision binding or an
atomic validation/reservation primitive, verified against the real Billing
service contract before implementation.

## Classification boundary

`classifyOutreachDraft` derives GBP versus Website from persisted scenario
identity (`scenario.key`, scenario IDs/versions, report ownership and
assessment, report source template, and the configured template mapping).
Nullable `gbp_qualification` and `gbp_commercial_snapshot` fields are only
validated after classification and cannot turn a Website-compatible draft into
GBP or vice versa. Unknown, missing, mismatched, superseded, or cross-lead
identities fail closed before edit, approval, claim, or SMTP paths.

GBP remains commercially unreleased: report/snapshot validation is retained,
but the send endpoint continues to reject GBP after validation and before claim.
