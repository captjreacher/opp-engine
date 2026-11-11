# Scenario release blocker review — owner decision packet

21 October 2026. Reviewed starting candidate `928252784b295666f8bb2f4f0bfc37f4b66fa434` on `codex/scenario-release-candidate`, main `5ecb21c000d90f78670efd352e1ec5bd787ff66b`, and PR #16 head `37976ab344b5ad913b39f3a881ce1c607e60e795`. **Production recommendation: NO-GO.** Local reconciliation and inherited migration testing are complete within the boundaries below. Commercial approval, the actual reader credential check and shared consumer policy decisions remain open. Stop at owner review.

No push, merge, deployment, production migration, configuration activation, outreach or production data mutation was performed. Existing worktrees and owner modifications were preserved. `codex/scenario-release-9282527` retains the original candidate. The original release assessment is [historical context](scenario-release-validation.md); this packet supersedes its blocker status and test counts.

## 1. Cloudflare branch/deployment impact matrix

Read-only GitHub API inspection: Actions enabled, zero workflow definitions, zero runs, no repository rulesets, no protected branches, and no repository webhooks returned. Draft status is therefore not a deployment gate. Checked-in `.github` contains issue templates only. `wrangler.jsonc` builds the Vite SPA in `dist` for Worker `opp-engine`; there are no environment-specific Worker names in this repository.

Wrangler's OAuth token can read Worker metadata but received HTTP 403 on the Workers Builds trigger API. The authenticated Cloudflare dashboard supplied the missing authoritative settings, without edits:

- Repository: `captjreacher/opp-engine`; production branch: `main`.
- Builds enabled; non-production branch builds enabled.
- Build: `npm run build`; production deploy: `npx wrangler deploy`; non-production version command: `npx wrangler versions upload`; root `/`.
- Watch include `*`, no excluded paths; no deploy hooks.
- Frontend builds use the production Supabase opportunities API. Preview versions do not have isolated backend data simply because their URLs differ. Build credential values are excluded from evidence.
- All 21 dashboard applications were inspected across three pages. Only `opp-engine` is linked to this repository; no second Worker target or linked Pages project for this repository was shown.

| Event / branch | Target and command | Production traffic | Decision in this task |
| --- | --- | --- | --- |
| Push/update `main` | `opp-engine`, build then `wrangler deploy` | Promotes a new active production version, including `opps.maximisedai.com` and its workers.dev route | Prohibited |
| Push #10 `codex/company-scenario-offers` | `opp-engine`, build then `versions upload` | Does not promote production; publishes a preview version | No push: preview deployment also prohibited |
| Push #16 `codex/opportunity-lifecycle-controls` | Same Worker and preview command | Same | No push |
| Push #17 `codex/scenario-reports` or foundation | Same Worker and preview command | Same; existing preview history confirms both | No push |
| Push candidate or another non-main branch | Same non-production rule; no branch exclusion shown | Preview publication, not production promotion, assuming checked-in build/deploy commands remain unchanged | No push |
| Change PR title/body/base without a branch update | No checked-in Actions/deploy hook responding to metadata found | No build expected from the inspected push rules | Possible review mechanism; no remote metadata changed here |
| Local commit, diff or patch review | No Cloudflare request | None | Used |

Production remains deployment `8cbeae81-7ab8-4175-bc1b-31ef453a95dc`, version **`2adf39b9-4376-43ee-b2a3-027e7d1be68b` at 100%**, created 18 October 2026 13:52 UTC. Dashboard and final read-only deployment-list inspection agree. #17 preview `d5a5b295` is not active production. [Deployment screenshot](evidence/release-blockers/cloudflare-active-deployment.png).

**Safe update method:** under the present restriction, review local commits/diffs and this packet, without pushing. After separate authorization to publish previews, updating only the three non-main draft heads using exact expected-head checks can preserve active production without changing Cloudflare configuration. Verify that `package.json`, Vite plugins, `wrangler.jsonc` and the Cloudflare commands remain the reviewed versions; a non-main branch running a new deploy side effect would invalidate that assessment. Do not push main or click Deploy/promote. Because previews use the production API, do not execute operational tests there. There is no proven deployment-free branch push under the current all-path rule. `[skip ci]`, draft status and a branch rename are not accepted bypasses.

References: [Cloudflare build branches](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/), [Builds API contracts](https://developers.cloudflare.com/workers/ci-cd/builds/api-reference/).

## 2. Owner changes reconciled

The #16 worktree contains **14 tracked modifications and four untracked files** beyond its PR head. The original patch and complete copies were retained outside the checkout at `C:/DEV_LOCAL/opp-engine-release-blocker-evidence-20261021/owner-snapshot` and `owner-worktree.patch`. [Original file hashes](evidence/release-blockers/owner-original-hashes.json) record all 18 files. The original recovery checkout was not edited.

| Owner change | Combined disposition |
| --- | --- |
| Effective archive state includes `status='archived'` and list projection `pipeline_status` | Integrated throughout detail/list/batch selection, enrichment and API guards; legacy restoration is explicitly blocked rather than guessing prior disposition |
| Draft send-state projection and disabled editing/retry after reload | Integrated from the existing scenario claim ledger; API returns only draft ID/state, not recipient metadata or private claim details |
| SMTP accepts DATA but loses QUIT connection | Integrated; confirmed acceptance remains success; tested without network |
| Durable alternate `opportunity_send_claims` and claim/completion RPCs | Reconciled semantically into the candidate's existing **company-unique** `opportunity_outreach_send_claims`; no second ledger or alternate sender installed. Existing approved subject/body/selection/timestamp/email binding, atomic completion and nonretryable uncertainty remain |
| Indirect visual/candidate/audit evidence ownership, OLD/NEW ancestry and reparent protection | Integrated in a new additive follow-up migration; report-to-assessment ancestry also covered |
| History rewriting and runtime TRUNCATE guards | Integrated as proposed local SQL, subject to shared retention/maintenance owner review |
| Nonsecret claim-state visibility for existing authenticated canonical writers | Column-level SELECT and existing-visible-lead RLS policy preserved in proposed migration; no claim metadata/recipient access or send authority granted |
| Owner shared-contract document and integration cases | Preserved with an explicit ledger reconciliation note; adapted inherited tests execute the actual combined functions |
| Old audit-generation test expectations | Not copied over the removed workflow; candidate regression tests continue to verify historical audit retention and obsolete routes |

Migration: `20261021012142_scenario_owner_retention_reconciliation.sql`, applied **only to disposable databases** after the existing four feature migrations. The original #16 migration is unchanged. No existing migration was silently rewritten to install the owner work.

### Decisions that require owners

1. **Canonical deletion policy:** shared-table lead DELETE denial also affects Cockpit's existing bulk-delete consumer (`apps/cockpit/src/services/leads.ts`, inspected source snapshot `e32b61b`). Cockpit projections also omit archive metadata. Approve the retention boundary and coordinate that consumer's UI/server contract before production. A passing denial test proves enforcement, not consumer compatibility approval.
2. **Legacy archives:** agree prior-disposition reconstruction and ambiguous-history handling. This candidate deliberately refuses legacy restore and performs no backfill. Inventory counts and any conversion require a separate reviewed plan; do not restore them to `discovered` by assumption.
3. **Maintenance:** accept runtime TRUNCATE denial with the existing postgres owner exception and an authorized backup/audit/quiescence runbook. No new bypass role or switch was introduced.
4. **Ledger contract:** review the retained first-outreach company uniqueness and service-role completion boundary against the owner's per-draft token proposal. The second table and token API were not copied; their safety intent is provided by the existing exact-snapshot claim, company uniqueness, insert validation, immutable history and atomic completion. If owners require token-specific completion as an additional contract, add it to this ledger and rerun validation; do not deploy both ledgers.

## 3. Proposed commercial mapping matrix — NOT APPROVED OR SEEDED

Sources: [current scenario registry snapshot](evidence/release-blockers/scenario-registry.json), [read-only Billing catalogue snapshot](evidence/release-blockers/billing-catalogue.json), the existing template schema/compatibility resolver, and approved website source metadata. Prices here are evidence snapshots, not runtime price configuration. Runtime continues to resolve Billing.

Production contains seven v1 scenarios: only `local-digital-presence` is active. Its website_refresh/local_visibility CTA offer IDs are null, and discovery_session is a Cockpit case CTA. The six specific scenarios are draft with empty commercial/report/outreach configuration. The new template/report tables are not migrated in production; there is no existing approved template matrix to activate.

| Scenario / proposed template family | Proposed Billing linkage for owner consideration | Destination candidate | Required decision / current block |
| --- | --- | --- | --- |
| `local-digital-presence` website findings; `website-improvement` | Small Business Website `plan-maximisedai-small-business-website`, Tradie Website `plan-maximisedai-tradie-website`, or Landing Page `plan-maximisedai-landing-page`, selected only after scope confirmation | `https://maximisedai.com/website-packages/` | Approve scenario evidence rules, package selection, dedicated service-page scope, components, terms, destination and template text. Do not infer offer from scenario count |
| `local-digital-presence` local_visibility; `local-search-visibility` | **No approved GBP/local-visibility plan found in this brand catalogue** | Owner-approved offer journey required; `/contact/` may be reviewed as a consultation CTA | Keep blocked. Do not substitute archived Digital Trust/Website Care or invent GBP inclusions/prices |
| `reputation-trust` | No sellable dedicated reputation offer identified | Consultation destination only after owner review | No approved mapping; archived Digital Trust Foundation is not usable |
| `lead-capture-conversion` | A website package is only a possible scoped solution, not an approved default | Website packages or contact, subject to review | Confirm the observed problem is addressed by the approved package; do not add CRM/automation components by inference |
| `automation-opportunity` | AI Workflow Automation and AI Assistant/Integration plans in this catalogue are archived/not sellable | `https://maximisedai.com/contact/` for a separately approved consultation journey | No sellable approved implementation mapping; keep blocked |
| `business-systems-gap` | No approved scenario offer; hosting/setup SKUs are infrastructure, not an automatic business-systems solution | Contact, subject to review | Agree scoped offer and terms; do not substitute a hosting subscription |
| Combined scenario template | One explicitly selected compatible offer and `scenario_keys[]`; `combined=true` | Same verified approved destination as that offer | Approve the exact combination. One business email and one commercial block; no implicit multiple purchases |
| Free Digital Assessment / discovery conversation | No approved free Billing plan mapped. Current discovery CTA is `cockpit_case` | Existing contact journey may be reviewed | The candidate requires an approved resolvable offer for outreach. Owner must decide the free-offer representation through existing governance. Paid AI Readiness Assessment is not a substitute |

Verified currently sellable website prices: Small Business Website **NZD 1250.00**, Tradie Website **NZD 1250.00**, Landing Page **NZD 500.00**, each current published v2, one-off, **GST exclusive at 15%**. Website Refresh and Website Care are archived/not sellable and excluded. Other current infrastructure prices remain in the snapshot but are not proposed default scenario offers. No package inclusions or terms were inferred from the price.

Both `/website-packages/` and `/contact/` returned HTTP 200 in read-only checks. Their existence and website approval do not constitute scenario-specific commercial approval. No `destination_verified_at` was fabricated. Contact is a free introductory conversation, separate from the paid AI Readiness Assessment ([public contact page](https://maximisedai.com/contact/)).

For each approved template, the owner must supply/review: stable template ID/version; exact scenario keys; combined flag; professional subject/body and permitted edit phrases; Billing plan ID; approved inclusions and terms with approval timestamp; destination and verification timestamp. Scenario category compatibility/evidence rules must also be reviewed before activating draft scenarios. No SQL seed or activation is included in this task.

## 4. Billing reader verification

[Machine-readable result](evidence/release-blockers/billing-reader.json): Billing Worker settings were inspected read-only and show `ADMIN_AUTH_MODE=hmac+api-key` and `ADMIN_API_KEY_ROLES=runtime.viewer`. The deployed secret bindings exist, without exposing values. Unauthenticated GETs to plan and current-price routes returned **401**, confirming the HTTP authentication boundary.

The code contract requires `catalogue.read` on plan, product and current-price GET routes. `runtime.viewer` has that permission and no `catalogue.manage`. The existing consumer contract is server-side `BILLING_API_BASE_URL` normalized to `/api/v1`, plus `BILLING_CATALOGUE_API_KEY` presented as `Authorization: ApiKey`. The same provisioned names are used by the existing drive-billing-communication reader. API-key identity is derived server-side from the registered key prefix and checked against disabled identities; no new service identity or key was created. The HMAC signing key must not be copied or used to mint a replacement reader token.

**Authenticated verification remains BLOCKED:** Supabase secrets are write-only, and no existing plaintext reader key was found in the known consumer env locations. Secret names and SQL catalogue access do not prove that the actual stored key is registered, enabled and accepted. Do not recover it from digests, print it, issue a new key or broaden roles. Owner action: provide access through the existing approved secure runtime/key location, then execute only plan/product/current-price GETs with redirects rejected, an identifying User-Agent, and sanitized status/envelope results. No credential should be pasted into chat. Existing preview/send communication routes are not a substitute for an isolated credential probe.

## 5. Executed integration evidence

| Check | Result |
| --- | --- |
| Full candidate Vitest with both disposable DB suites enabled | **434 passed, 0 failed, 0 skipped**; includes 22 real PostgreSQL tests and four added owner-protection checks |
| Separate inherited lifecycle/Cockpit suite | **27 passed**, including 11 actual two-session lock races |
| Frontend TypeScript and Vite build | Passed using `npm ci` and the existing lockfile |
| Changed opportunities/enrichment Deno type checks | Passed with Deno 2.9.6, nodeModulesDir none, no lock/config changes |
| Real enrichment startup smoke, loopback only | **1 passed** |
| Full four-function Deno check | **12 pre-existing visual-assessment errors**, reproduced on pristine main |
| Deno lint on both changed entrypoints and both shared helpers | **27 findings**, exactly the same rule/message set on pristine main's two corresponding entrypoints; no new-helper findings |
| Frontend lint configuration | No lint script configured; no lint dependency/configuration introduced |

The prior report's four lint findings covered the opportunities-only subset. This task includes enrichment and records the broader, baseline-matched count of 27; it is not a newly introduced regression.

### Clean Docker inherited migration rehearsal

Dedicated PostgreSQL 17 container `opp-release-blockers-20261021`, localhost port **55486**. A fresh `opp_inherited_test_verified` database was populated from the schema-only 30 July public baseline (SHA-256 `7cfe90c762c7ccda2595a0c1eceae6416cde14c6fe6f3e0b036e145ef42517d8`), case/client relational prerequisites, visual intelligence, canonical eligibility/outbound handoff and checked-in inherited migrations, then #10 → #16 → #17 → compatibility → owner reconciliation.

[Rehearsal source hashes and migration order](evidence/release-blockers/inherited-rehearsal.json), [27 executed results](evidence/release-blockers/inherited-results.json), [live inherited function comparison](evidence/release-blockers/inherited-function-comparison.json).

Result: **145 tables, 144 triggers, 176 functions; one send ledger**. The five live definitions for eligibility, enrichment queue, candidate import, output scenario defaults and Cockpit handoff match the rehearsed definitions exactly after CRLF normalization. No live definitions were changed. Real synthetic local tests verified audit/history bytes survive archive/restore; indirect evidence and reparenting are fenced; discovered duplicates retain archived identity; handoff preserves existing customers and idempotent contact history; failed audit insertion rolls back state; runtime truncation is denied; legacy restoration is refused; and archive serializes against queue, worker claim, approval, review events and Cockpit handoff.

Baseline restoration has **48 explicitly allowlisted errors** for absent Paperclip cross-schema/dependent cockpit views; these are recorded in the manifest and do not intersect the tested lead/handoff paths. Auth roles/helpers are fixtures, Storage/platform execution is not emulated, and `net.http_post` is a verified database-only recording stub. This is broader inherited SQL testing, not a complete production clone. No production rows, SMTP calls or enrichment-provider calls were used.

Reproduce using `tests/rehearse-inherited-release.mjs` with explicit local database, schema-only baseline, shared migrations and owner fixture paths; it refuses ports other than 55486 and non-test database names. `tests/inherited-lifecycle-integration.py` is fixed to localhost:55486/opp_inherited_test_verified and requires the recording stub. Detailed commands and versions are retained in the local evidence directory.

### Browser validation

The existing local preview harness runs actual transpiled API handlers, the real candidate UI and the migrated target database, with fixture Billing/Cockpit and a refusing SMTP implementation. Final checks include retained legacy report/read-only state and disabled legacy Restore, single-scenario preparation/review, persistent uncertain-claim controls after reload, and mobile combined email/editing. Screenshots and final results are in `docs/evidence/release-blockers/`. Zero outbound messages are permitted by the harness. Existing desktop/mobile scenario, missing/withdrawn-offer and archive/restore evidence remains in `docs/evidence/scenario-release/`.

## 6. Deployment and rollback instructions — not executed

1. Owner-review this packet: retention/Cockpit consumer changes, legacy transition, maintenance, single-ledger contract, commercial matrix and baseline failure disposition. Verify the real reader key through the approved secure runtime. Do not activate configuration as part of review.
2. Recheck main and all PR heads. Original heads remain #10 `d7cd858`, #16 `37976ab`, #17 `a8a2503`; main `5ecb21c`. Retain #11 outside this release. Preserve the #16 snapshot and have its owner review the local reconciliation before any branch update.
3. After explicit authorization for preview publication, update/rebase #10 from reconciled `754593f`, place the reviewed archive/owner work above it, and put #17 plus the compatibility/owner follow-ups above that. Review exact resulting diffs and rerun the final combined branch. Do not force-update newer owner commits. No Cloudflare configuration change is needed to keep non-main pushes off production, but preview publication and production-backend exposure must be authorized.
4. Before merging, coordinate the release window: every intermediate main update deploys automatically. Either obtain separate approval to suspend production builds temporarily (a configuration change, not done here) or use an owner-reviewed atomic final integration merge strategy that only builds the final combined tree. Do not merge dependency PRs separately into auto-deploying main and hope deployment waits. Preserve the current Worker configuration.
5. With separate migration/deployment approval and paused operator sending, preflight active Batch overlaps and schema assumptions, record backups, and apply only the **pending** migrations: `20261009145236`, `20261018144011`, `20261020234438`, `20261021003415`, `20261021012142`, in that order. Already-applied inherited migrations are rehearsal inputs, not instructions to reapply production DDL. Never seed unapproved mappings or repair overlaps automatically.
6. Deploy the matching opportunities API and local-business-enrich archive guard before frontend promotion. The claim RPC signature changed; quiesce operator sending during the coordinated schema/API transition. Verify missing-offer paths fail closed. Only after reviewed commercial approval/configuration and explicit release authorization should the final Cloudflare source be promoted. Verify commit, assets, version and 100% traffic. No operational/outreach smoke action is authorized by a deployment approval.

**Rollback:** current Worker `2adf39b9-4376-43ee-b2a3-027e7d1be68b` is the recorded frontend fallback. [Backend version inventory](evidence/release-blockers/backend-rollback-versions.json) records opportunities v70, enrichment v101, scenarios v26 and visual-assess v38, including bundle SHA-256 identifiers. Securely retain/retrieve the corresponding immutable source artifacts before deployment; version metadata alone is not an executable function restore package.

Keep operator sending paused, reconcile in-flight sending/uncertain claims, and roll back the frontend only after checking backend compatibility. Retain additive schema, audit/report history and claims. Do not reintroduce the old six-argument sender or drop the single-ledger/atomic-completion protections to restore an old API. If the old backend cannot preserve the new schema/sending contract, forward-fix with sending suspended. Never clear a claim or retry delivery as a rollback step. No destructive down migration, customer/contact downgrade or history deletion is part of this plan.

## Owner review outcome required

**GO for local owner review; NO-GO for production.** Closed: branch impact discovery, local owner reconciliation, expanded inherited SQL rehearsal, critical live function comparison and combined source checks. Open: actual stored reader-key verification, commercial approvals/configuration, coordinated Cockpit retention/legacy/maintenance agreement, baseline type/lint disposition and deployment-window authorization. No owner decision has been inferred from elapsed time or from these passing tests.

## 7. Production gate closure update — 22 October 2026

This section supersedes the older blocker status above for the authorised GBP release preparation. No merge, migration, deployment, catalogue publication, payment action, operator pause or outreach occurred. Machine-readable evidence is in [gbp-gate-closure-20261022.json](evidence/release-blockers/gbp-gate-closure-20261022.json).

### Evidence matrix

| Blocker | Evidence | Pass/fail | Remaining action | Responsible party |
| --- | --- | --- | --- | --- |
| Independent legal review | Owner business approval for the revised seven paragraphs below was recorded on 22 October 2026 for GBP Setup and GBP Improvement. No independent legal review evidence has been provided. | **BLOCKED — business wording approved; independent legal review not evidenced** | Obtain and record independent legal review of this exact text before release. | Owner / legal counsel |
| Production Billing authentication | Read-only GitHub Actions run `39762857733` used the existing protected production URL/key secrets at site PR head `5cce90c`. At `2026-10-22T10:24:53.143Z`, authenticated product, plan and current-price reads for all 12 existing approved live offers succeeded. The tested base was `https://billing-api.maximisedai.com/api/v1`; sanitized paths were `/catalogue/plans/{planId}`, `/catalogue/products/{productId}` and `/catalogue/plans/{planId}/prices/current`. The run and artifact contain no credential. | **PASS** | Repeat after Billing deployment and before GBP publication, reading the four GBP plans while they are still unpublished, then again after publication. | Release engineer |
| Database recovery readiness | Authenticated Supabase dashboard inspection for production project `mgrnz-web` (`jqfodlzcsgfocyuawzyx`) shows the organization/project on the **Free** plan. Scheduled Backups states that Free does not include project backups. Point in Time states PITR is a Pro add-on. Most recent backup: **none available**. PITR: **disabled**, so retention and a recoverable timestamp are absent. No restore was started. | **FAIL** | Before migration, provide and verify a recoverable backup or enable an owner-approved scheduled-backup/PITR facility, then record the backup ID/time and authorized recovery operator. | Owner / Supabase project administrator |
| Integrated staging rehearsal | A coordinated isolated rehearsal used disposable PostgreSQL 17 database `opp_release_test_gbp_20261022`, fixture Billing/Cockpit, the existing refusing-SMTP harness and prior unchanged component evidence. Fresh targeted Opportunity Engine checks: **59 passed**; fresh PostgreSQL migration/locking checks: **11 passed**. Billing PR #52 focused evidence remains **150 passed**; website PR #19 fixture build remains **30 routes built** and current PR checks are green. | **PASS** | Preserve the evidence and rerun only if a release head or environment contract changes. | Release engineer |
| Production migration preflight | Read-only production inspection at `2026-10-22T10:32:03.004053Z` found 3 batches with 25 members and zero approved-unsent, sending, pending-review or sent drafts. The latest applied migration is `20261016010631_content_cockpit_read_contract`; none of the six release tables/columns checked is present. A linked `supabase db push --include-all --dry-run` stopped before plan generation because the checkout lacks numerous already-applied production migration files. No repair command was run. | **FAIL** | Reconcile the complete production migration history into an immutable release checkout and obtain a clean dry run. During the separately authorised window, quiesce the three batches and operator sending before applying the six migrations. | Database release engineer / Opportunity Engine operator |

### Approved GBP payment and cancellation wording

**Owner business approval:** 22 October 2026. **Scope:** GBP Setup and GBP Improvement. **Status:** Approved business wording; independent legal review not yet evidenced. Document references: [owner-approval.md](gbp-commercial/owner-approval.md), Billing PR #52 `docs/gbp-commercial-terms.md`, executable copy at `supabase/functions/_shared/gbpCommercial.ts`, and page copy at MaximisedAI PR #19 `src/data/gbp-offers.js`.

1. Payment is required in full before work begins, unless explicitly agreed otherwise in writing.
2. You may cancel your order before work begins. We will refund the amount paid, less any reasonable costs already incurred in preparing or arranging the service and any third-party costs clearly disclosed and expressly agreed to as non-refundable before purchase.
3. If you cancel after work has commenced, we may deduct reasonable charges for work already completed and any agreed, non-recoverable third-party costs. Any remaining prepaid balance will be refunded.
4. Where a refund is due, we will process it within seven calendar days of confirming the refund amount. The time taken for funds to appear in your account may depend on your payment provider.
5. Where we are unable to complete the agreed services, we will discuss an appropriate remedy, including a refund where applicable.
6. Nothing in these terms limits your rights under the New Zealand Consumer Guarantees Act 1993 or other applicable consumer protection legislation.
7. Google controls Business Profile verification, approval, suspension decisions and processing times. We cannot guarantee approval, verification or continued listing availability. We will, however, carry out the agreed services with reasonable care and skill.

**Independent legal review: NOT EVIDENCED.** Matching implementation text proves consistency; it does not constitute legal sign-off.

On 23 October 2026, the seven paragraphs were checked for exact equality across Billing PR #52 documentation, the MaximisedAI PR #19 source and both built GBP pages, Opportunity Engine PR #19 snapshot source, and this release record. The website suite passed 496/496 tests and its Billing fixture build generated both GBP pages. Opportunity Engine's focused GBP commercial test passed 5/5, its full suite passed 417 tests with 23 skipped, its production build passed, and Deno checked the opportunities Edge Function. Billing's focused catalogue seed suite passed 26/26. These are wording and build checks; they do not close the independent legal review, recovery or migration blockers.

### Staging stage results

| Stage | Result | Evidence |
| --- | --- | --- |
| Discovery | **PASS** | Recorded-source and discovery execution evidence tests passed. |
| Assessment | **PASS** | Assessment and scenario evidence paths passed against the release candidate. |
| G01 / G02 qualification | **PASS** | Separate evidence rules, customer-confirmed service count and invalid-count rejection passed. |
| Scenario Report | **PASS** | Immutable commercial snapshot and report rendering checks passed. |
| Email preparation | **PASS** | One template per scenario and report/email snapshot identity passed; GBP drafts remain send-locked. |
| Billing offer | **PASS** | All four exact amounts (24900, 34900, 19900, 29900 NZD minor units), one-off cadence, 15% GST exclusive treatment, plan/product identity, API-key header, published/missing/withdrawn fail-closed behavior passed. |
| Landing page | **PASS** | Both Billing-resolved routes and all four rendered tiers passed the existing fixture build and current site PR checks. |
| Cockpit and duplicate controls | **PASS** | Fresh eligibility-before-send, company claim, unique GBP draft, stale recipient and duplicate-claim checks passed. |
| Transport/payment isolation | **PASS** | Refusing SMTP records zero outbound messages. No payment adapter or checkout was invoked. |

The first PostgreSQL 17 command omitted Docker's stdin flag, so `psql` received an empty schema and the database-only assertions failed. That runner error was discarded, the disposable database was recreated, and the unchanged suite passed 11/11 with stdin enabled. It is a rehearsal harness diagnostic, not a release-candidate failure.

### Recovery and quiescence procedure

There is currently no valid recovery point, so this procedure cannot be executed safely yet. Once a backup facility exists, an authorized Supabase project administrator must record the pre-migration backup identifier and UTC timestamp, verify it is visible and restorable, and retain access to the Supabase dashboard plus database credentials. A recovery event should restore to a separate project first, validate row counts and release invariants, then use an owner-approved cutover. Do not test recovery by overwriting production.

At the authorised deployment window: stop new discovery/import/enrichment batch starts; let or deliberately suspend the three recorded batches; disable operator approve/send actions; recheck that approved-unsent, sending and uncertain claims are zero; record the recovery point; apply the reconciled migration plan; validate schema, counts and send invariants; then resume operations only after health checks. Production has not been paused during this review.

The migrations are additive, so application rollback retains new tables, columns, audit history and send claims. There is no destructive down migration. If an older API cannot preserve the new claim/RPC contract, keep sending suspended and forward-fix. Never delete claims, reports or history to simulate rollback.

### Current recommendation

**NO-GO — two technical/operational prerequisites and one external approval remain.**

- Technical: production has no scheduled backup or PITR recovery point.
- Technical: the release checkout cannot produce a migration dry-run plan until its history is reconciled with production.
- External approval: independent legal review evidence for the owner-approved seven paragraphs is absent.

The production Billing reader and isolated integrated rehearsal are closed. The release is **not yet READY FOR OWNER RELEASE CONFIRMATION**.
