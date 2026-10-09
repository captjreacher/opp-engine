# Company scenarios and reviewed offer outreach

This change is prepared in `C:\DEV_LOCAL\opp-engine-company-scenarios` on
`codex/company-scenario-offers`, isolated from the recovery changes in the original
`C:\DEV_LOCAL\opp-engine` checkout. It has not been deployed.

## Existing behaviour and configuration

Read-only inspection found one active scenario: `local-digital-presence`, version
1. Its Google Places search already supports multiple selected categories and
category search terms. The search profile remains responsible for provider query
defaults; each resulting company now receives evaluations of every active
scenario relevant to those categories. A run snapshots that scenario set.

The six more specific scenarios are drafts, not enabled: website-improvement,
local-search-visibility, reputation-trust, lead-capture-conversion,
business-systems-gap and automation-opportunity. This PR does not activate them.
Their evidence rules and offer mappings require configuration review first.
Category compatibility is reapplied during assessment and outreach, so an enabled
scenario unrelated to the company's discovery categories cannot supply outreach.

Existing canonical import deduplication is reused. Tags are unique by canonical
lead and scenario slug; slug is stable across registry versions, while version,
evidence, source and evaluation date remain recorded. Confirmed requires observed
support; uncertain means observed values without support; unassessed means no
usable evidence. Missing fields never prove absence. Reimporting does not
downgrade existing confirmed findings; a fresh assessment can update them.

## Assessment and score

Assessment evaluates active scenario evidence rules against recorded lead and
enrichment facts and stores per-scenario results and an explanation. Configured
rules use a fact path and equality, numeric threshold or array membership, plus a
description, bounded score and optional shared evidence key. Without configured
rules the existing umbrella scenario uses recorded enrichment trust signals;
other scenarios remain unassessed rather than gaining fabricated findings.

The existing generated score is `1.5 * demand_signal_score + trust_leakage_score`
(0–250). Demand retains its existing calculation. Supported scenario evidence uses
the strongest finding plus one twentieth of each other independent finding's
score, capped at ten extra points. Trust takes the greater of this combined signal
and the existing trust score, capped at 100; support is not added again on top of
the baseline. Evidence keys are deduplicated, taking the strongest score for a shared
key. Configure the same key for the same underlying observation across scenarios.
Scenario count alone adds nothing and does not indicate buying readiness.

## Active Batch membership

The existing Batch foundation remains the source of membership. A partial unique
index permits at most one unreleased membership per lead. Lead locks and Batch
locks protect concurrent creation, explicit moves and archive operations. A move
releases the former membership and retains historical rows and an audit event.
Archiving releases active members without deleting history. Historical members
remain visible but are excluded from processing in their former Batch. The Batch
record filter and text-search UX remain intact.

The migration stops if legacy overlap rows exist. It never silently chooses an
active Batch or deletes historical membership. Before applying it, inspect
`select lead_id, array_agg(batch_id) from opportunity_batch_members group by
lead_id having count(*) > 1`. If overlaps exist, prepare an explicitly reviewed
resolution retaining history as part of the upgrade; this is a release prerequisite.
No production migration or history repair has been performed. Canonical-company
locks also serialize discovery tag persistence so incomplete reimports cannot
overwrite confirmed assessment findings.

## Templates, review and send

`opportunity_outreach_templates` is the shared scenario-to-template-to-offer-to-
destination registry. It is deliberately empty in this migration. An enabled
template requires a verified destination; runtime validation also restricts URLs
to HTTPS on maximisedai.com, without credentials, fragments or unknown attribution
parameter names. Existing `source` and UTM attribution names are supported. Values
are static reviewed configuration, never generated from personal/company facts;
configuration reviewers must exclude personal data from those values.

One confirmed scenario and one compatible template default automatically. Several
confirmed scenarios require an explicit compatible selection. A combined
template is eligible only when explicitly configured and every required scenario
is confirmed. Missing/disabled/unverified mappings block draft generation and
sending. Old drafts must be regenerated using a verified mapping.

The UI shows recorded findings, scenario scores, template/version, offer ID,
destination and rendered message. Templates may interpolate only business name,
recorded findings and verified destination. Ad-hoc message edits are rejected so
they cannot introduce unrecorded claims. Template authors must independently
review fixed copy, including the free Digital Assessment CTA. Approval requires
explicit manual review; sending requires a separate confirmation. Neither
discovery nor assessment nor selection sends anything. Send-time validation
rechecks the mapping/render and assessment currency, and preserves the existing
eligibility/suppression/possible-match rules and sent-state protections.

An atomic send claim unique by both company and draft prevents concurrent attempts,
including attempts using different drafts for the same company. Cockpit eligibility
is freshly checked before SMTP; unknown or failed checks block sending. Failed or ambiguous
delivery retains the claim and requires explicit delivery reconciliation; no
automatic retry or claim-reset endpoint is introduced. Selection, scenario keys,
template version, offer, destination, findings and send outcome are retained.

## Related website and Billing inspection

Read-only checkouts:

- `C:\Users\user\Local Sites\maximisedai-site`
- `C:\DEV_LOCAL\BILLING-KERNEL`
- `C:\DEV_LOCAL\hermes-marketing-platform`

Existing identities and proposed mapping, all currently blocked for outreach:

| Finding/offer family | Existing/proposed Billing identity | Destination state |
| --- | --- | --- |
| Small Business website | `product-maximisedai-small-business-website`; plans `plan-maximisedai-small-business-website`, `plan-maximisedai-small-business-website-1-service`, `plan-maximisedai-small-business-website-3-services` | No verified dedicated offer destination identified |
| Tradie website | `product-maximisedai-tradie-website`; `plan-maximisedai-tradie-website` | No verified dedicated offer destination identified |
| Website refresh | Existing `product-maximisedai-website-refresh` | Preserve existing identity; do not substitute a generic route for a dedicated offer |
| GBP creation plus optimisation | No identity found in inspected catalogue, drafts/history; propose one-off creation/optimisation offer plus recurring reporting plan for Billing review | Separate GBP offer page required; no route invented |
| Existing GBP optimisation | No identity found; propose a separate one-off optimisation offer using the reviewed recurring reporting plans | Separate GBP offer page required |
| Digital Assessment | Free CTA; no paid product created | Verify the assessment request destination before enabling a template |

Proposed compatible templates for `website-improvement` are Small Business Single
Service (`plan-maximisedai-small-business-website-1-service`), Small Business
Multi-Service (`plan-maximisedai-small-business-website-3-services`) and Tradie
(`plan-maximisedai-tradie-website`), selected through explicit business/service-count
review. For `local-search-visibility`, propose separate GBP creation/optimisation
and existing-profile optimisation templates; their Billing IDs remain unresolved.
The umbrella scenario may use a free Digital Assessment template once its request
destination is approved. These are mapping proposals, not enabled records. No
combined template is implied or automatically synthesized.

HTTP checks returned 200 for `https://maximisedai.com/products/` and
`https://maximisedai.com/contact/`. These are generic pages, not verified dedicated
offer destinations, and are not enabled as mappings. No approved template or
dedicated landing-page mapping has been seeded.

The inspected Billing seed uses POA website prices and exclusive tax treatment;
it does not establish the requested final package/hosting prices or approve tax
treatment for GBP. No numeric prices are embedded in Opp Engine. Catalogue IDs,
prices, tax and cadence remain Billing-owned. Searches of available local
catalogue/history are not proof that no identity exists in an inaccessible live
catalogue.

Hermes contains generic scheduling infrastructure and documentation. That alone
does not verify a functioning GBP optimisation job, weekly schedule, tenant
integration or results delivery. Those capabilities remain unverified and must
not appear as functioning promises in templates or offer pages.

## Smallest follow-up

1. Billing: reconcile the existing Small Business and Tradie identities with the
   requested website package/additional service-page/hosting terms; confirm GST
   for hosting. Review proposed GBP one-off and recurring identities after a live
   catalogue search, then confirm GBP GST and billing cadence. Do not duplicate
   existing products.
2. Website: implement/verify the Small Business offer on the existing catalogue
   pattern, then reuse it for Tradie. Distinguish one summary service page versus
   three dedicated service pages; allow at most five service pages, not five total
   pages. Establish service count through an explicit customer-confirmed intake.
   Above five requires manual review; no additional tier is invented. Add a
   separate GBP offer journey and retain the free Digital Assessment CTA.
3. Hermes: verify a real weekly GBP job and results-delivery contract end to end
   before promising it. Confirm 1–3 versus 4–5 service reporting bands through
   Billing; above five remains unresolved/manual review.
4. Configure reviewed evidence rules and templates, referencing Billing IDs and
   verified destinations with static attribution. Review fixed claims and render
   previews before enabling. No production configuration is included in this PR.

Growth Readiness Assessment is excluded.

## Validation and release limits

The local PostgreSQL integration suite executes the Batch foundation migration
and this migration against a minimal disposable fixture, including concurrent
membership and send-claim requests. It does not validate a full production schema
upgrade. Set `OPP_TEST_DATABASE` to a disposable `opp_company_test*` database and
`OPP_TEST_PSQL` to psql; localhost port defaults to 55482. The suite recreates that
database's public schema. Without these variables the eight integration tests skip.

PR #10 contains 25 changed files against main. This follow-up changes only the
Edge Function, this report and the new disposition-handler regression tests.
The four formerly uncommitted edits are incorporated in `65a26cb`; that was a
clean, synchronized starting point, with no unrelated local edits to stage.

Final validation: 85 focused tests across seven files pass; all 331 full-suite
tests across 29 files pass with zero skipped tests. All eight PostgreSQL
integration tests execute on the disposable `opp_company_test` database at
`127.0.0.1:55482`, including during the full suite. Frontend build/typecheck,
the full Edge Function Deno check and `git diff --check` pass.

The duplicate event payload keys were removed because the existing diagnostics
object already carries the same run/lead IDs. The missing `PATCH /:id` handler is
restored to its intended narrow contract: only `{status: "disqualified"}` is
accepted, and an atomic enrichment-freshness predicate prevents changing a record
while enrichment runs. Missing records return 404; active enrichment returns
409; database errors propagate. No arbitrary lead-edit or delete endpoint is
added. Eleven handler regression tests cover these boundaries.

The four Windows CRLF-sensitive tests were corrected in the earlier hardening
commit. No Deno/typecheck or test failures remain. Release still requires verified
Billing/website/scenario/template configuration, a full production-schema upgrade
review and explicit resolution of any legacy overlapping memberships. Hermes
weekly GBP jobs/results delivery remain unverified. PR #10 remains draft. No real
email, credential change, production seed/migration, merge or deployment occurred.
