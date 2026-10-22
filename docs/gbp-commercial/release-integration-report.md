# Scenario and GBP controlled release report

**Review date:** 22 October 2026  
**Decision:** GO for owner review and a controlled nonproduction release rehearsal. NO-GO for production activation, catalogue publication, payment activation, site deployment, production migrations or outreach until the separately authorised release steps below are completed.

No production action was taken during this review.

## Reconciled release candidate

The local branch `codex/scenario-gbp-release-integration` is based on the previously validated `codex/scenario-release-candidate` and combines the work represented by Opportunity Engine PRs #10, #16, #17 and #18.

| Source | Reconciliation result |
|---|---|
| PR #10 | Its conflict resolution with current `main` is retained through merge commit `754593f`. |
| PR #16 | Archive and restore behaviour is retained. Its archive migration is byte-for-byte unchanged from commit `37976ab`; the owner retention reconciliation migration remains additive. |
| PR #17 | Commit `a8a2503` is an ancestor of the candidate, preserving the Scenario Report and commercial snapshot architecture. |
| PR #18 | All three commits were applied after the scenario candidate. Conflicts retained owner approval checks, send-state protection and archive hardening while adding the GBP preparation flow. |

The candidate contains six uniquely named release migrations, including the GBP draft migration. The clean disposable-database rehearsal applies them in timestamp order. It does not delete or rewrite historical reports, outreach drafts, send claims or lifecycle events.

## Commercial dependency matrix

| Scenario | Product | Plan identity | Services | NZD ex GST | GST 15% | NZD inc GST | Template | Landing page |
|---|---|---|---:|---:|---:|---:|---|---|
| G01 | `product-maximisedai-gbp-setup` | `plan-maximisedai-gbp-setup-1-3-services` | 1–3 | $249.00 | $37.35 | $286.35 | `gbp_setup_v1` | `/products/gbp-setup/` |
| G01 | `product-maximisedai-gbp-setup` | `plan-maximisedai-gbp-setup-4-5-services` | 4–5 | $349.00 | $52.35 | $401.35 | `gbp_setup_v1` | `/products/gbp-setup/` |
| G02 | `product-maximisedai-gbp-improvement` | `plan-maximisedai-gbp-improvement-1-3-services` | 1–3 | $199.00 | $29.85 | $228.85 | `gbp_improvement_v1` | `/products/gbp-improvement/` |
| G02 | `product-maximisedai-gbp-improvement` | `plan-maximisedai-gbp-improvement-4-5-services` | 4–5 | $299.00 | $44.85 | $343.85 | `gbp_improvement_v1` | `/products/gbp-improvement/` |

Billing PR #52 defines two draft products, four non-sellable one-off plans and four draft fixed-price versions in NZD. Tax treatment is GST exclusive with a 1,500 basis-point rate. No subscription cadence is present. Existing Digital Trust Foundation and website package identities are unchanged.

Site PR #19 resolves each exact plan from Billing. It does not keep an independent price catalogue. A missing, draft, superseded, withdrawn, archived, mis-parented or otherwise unsellable exact plan suppresses the price and purchase path rather than borrowing a sibling price.

Opportunity Engine uses the same product IDs, plan IDs, service bands and destinations. G01 and G02 each have one disabled template and one product offer. The selected exact plan, current Billing price version, tax treatment, scope, exclusions, terms and destination are stored once in an immutable GBP commercial snapshot. The Scenario Report and locked email render that snapshot. Approval rechecks the report, recipient, template and current Billing value before any send state transition.

## Scope, evidence and safeguards

The approved inclusions, exclusions and one-profile service-count definition are unchanged from the owner approval pack. A customer must confirm the genuine service list before a fixed-price quote is prepared.

G01 requires evidence that the business is eligible and does not control a verified profile, including the documented search, location, candidate review and observation time. G02 requires a matching controlled verified-profile URL and a specific observable improvement finding. Unsupported assumptions do not qualify. Setup and Improvement findings remain separate.

Existing Cockpit rules still require a current assessment, contact-ready state, eligibility, no suppression and human approval. The preparation endpoint rejects an existing outreach draft, and the database partial unique index prevents more than one GBP draft per lead. GBP sending remains blocked in code while the scenarios and templates remain draft/disabled.

The copy does not promise Google verification, approval, processing time, rankings, lead outcomes or recurring SEO reporting. Profile ownership and access remain customer dependencies. Ownership disputes, suspensions, verification exceptions, more than five services and unusual remediation require separate scope.

## Payment, cancellation and refund wording review

The owner approved revised seven-paragraph business wording for GBP Setup and GBP Improvement on 22 October 2026. The exact wording is recorded in [the release blocker review](../release-blocker-review.md#approved-gbp-payment-and-cancellation-wording), Billing PR #52 `docs/gbp-commercial-terms.md`, website PR #19 `src/data/gbp-offers.js` and Opportunity Engine PR #19 `supabase/functions/_shared/gbpCommercial.ts`. The two landing pages use the same website terms array; Scenario Reports and emails use the same Opportunity Engine commercial snapshot. The revised wording addresses payment timing, reasonable preparation costs before work, deductions after work begins, a seven-calendar-day refund processing commitment, remedies if delivery cannot be completed, statutory rights and Google's decisions and processing.

**Status:** Approved business wording; independent legal review not yet evidenced. This engineering consistency check is not legal sign-off.

**23 October 2026 wording update:** The superseded six-paragraph copy was replaced with the seven owner-approved paragraphs in the website source, Opportunity Engine commercial snapshot source and Billing GBP terms document. Exact-text comparison covered both rendered landing pages and the release record. Website tests passed 496/496 and its Billing fixture build completed; Opportunity Engine's focused GBP commercial test passed 5/5, its full suite passed 417 tests with 23 skipped, its build completed and Deno checked the Edge Function; Billing's focused seed test passed 26/26. The release remains blocked by missing independent legal review evidence, a production recovery point and a reconciled migration dry run.

## Verification evidence

| Repository / gate | Result |
|---|---|
| Opportunity Engine full suite | 37 files passed, 2 skipped; 416 tests passed, 23 skipped. |
| Opportunity Engine focused clean migration rehearsal | 15/15 passed against a disposable PostgreSQL 16 database, including archive/restore retention, GBP draft mappings and duplicate-send controls. |
| Opportunity Engine build | Passed: TypeScript project build and Vite production build. |
| Opportunity Engine Edge Function check | Passed: `npx deno check supabase/functions/opportunities/index.ts`. |
| Authenticated Billing reader contract | Passed. Opportunity Engine sends `Authorization: ApiKey …` using the established `BILLING_API_BASE_URL` and `BILLING_CATALOGUE_API_KEY`; Billing authentication and catalogue route suites passed 59/59. No credential value was logged. |
| Billing changed-area suites | 150/150 passed, including seed identities, exact prices, catalogue API behaviour, GST invoice calculations and seed recovery. |
| Billing full local suite | 1,232/1,235 passed. Three timeouts occurred in unrelated existing PostgreSQL recovery/invoice tests under a highly concurrent Docker run. A one-worker rerun passed the invoice file and produced different timeouts in the unchanged runtime-store file. This is an inherited local performance diagnostic, not a GBP assertion failure. The affected GBP suites and the PR's GitHub checks pass. |
| Website suite | 496/496 passed. |
| Website Billing fixture build | Passed; 30 routes built, including both GBP pages, and the secret-leak check passed. |
| Cross-repository identity check | Passed for all four plan IDs and amounts, both product IDs, both templates and both destinations. |
| Responsive review | Passed by visual inspection at 390 px mobile and 1440 px desktop widths. Pricing remains legible and stacked on mobile; both desktop tier cards remain aligned. |

### Screenshot evidence

- [GBP Setup mobile hero](screenshots/gbp-setup-mobile.png)
- [GBP Setup mobile pricing](screenshots/gbp-setup-pricing-mobile.png)
- [GBP Setup desktop](screenshots/gbp-setup-desktop.png)
- [GBP Setup desktop pricing](screenshots/gbp-setup-pricing-desktop.png)
- [GBP Improvement mobile hero](screenshots/gbp-improvement-mobile.png)
- [GBP Improvement mobile pricing](screenshots/gbp-improvement-pricing-mobile.png)
- [GBP Improvement desktop](screenshots/gbp-improvement-desktop.png)
- [GBP Improvement desktop pricing](screenshots/gbp-improvement-pricing-desktop.png)

## Cloudflare and production traffic

The verified Cloudflare configuration treats `main` as the production branch. The MaximisedAI site has no connected production Git deployment; its production deployment is a separate Wrangler action. Billing's static project uses `main` and has preview branch builds disabled. Opportunity Engine branch builds use `wrangler versions upload`, which creates an inactive version; they do not change traffic allocation. The current production version remains the `main` version with 100% traffic.

A branch push may therefore create checks and an inactive Opportunity Engine version, but cannot promote it to production under the verified configuration. Repeat this check immediately before any future release if workflow or Cloudflare settings change.

## Dependency-aware release sequence

The following sequence requires a separate production release authorisation:

1. Merge Billing PR #52 and deploy the Billing code without running the catalogue seed or changing sellability.
2. Merge the consolidated Opportunity Engine integration PR. Apply its additive migrations with G01/G02 and both templates still draft/disabled; verify historical row counts and archive/restore invariants.
3. Run the Billing catalogue seed in a nonproduction environment, authenticate through the runtime viewer reader, and verify the four draft price versions and GST calculations again.
4. Under catalogue-publication approval, seed production as draft, review the exact records, then activate the two products, four plans and current price versions as one controlled catalogue change.
5. Merge site PR #19, build with the authenticated Billing reader, deploy the site, and smoke-test both public routes at desktop and mobile widths. Confirm there is no purchasable state unless the exact Billing plan is active and sellable.
6. Enable the two Opportunity Engine scenarios and their matching templates only after Billing and both landing pages are healthy. Re-run Cockpit eligibility, suppression, service-count, ownership, withdrawn-offer, report/email drift and duplicate-draft checks in staging.
7. Keep human approval mandatory. Any removal of the explicit GBP send block and any live outreach require their own reviewed and authorised change.

## Rollback readiness

- Billing: set the affected plans non-sellable and withdraw their current prices; retain price-version history.
- Site: move Cloudflare traffic back to the previously verified site version.
- Opportunity Engine: disable the two templates and return both scenarios to draft; move traffic back to the prior Worker version.
- Database: use forward status changes rather than destructive down migrations. Preserve reports, commercial snapshots, drafts, send claims and lifecycle audit history.

## Owner decision requested

Approve or reject progression from the reviewed draft branches to the separately controlled release sequence above. The present recommendation does not authorise or perform any merge, production migration, catalogue publication, payment activation, production deployment or outreach.
