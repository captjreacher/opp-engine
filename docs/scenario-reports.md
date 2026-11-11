# Scenario reports and approved offer outreach

For the reconciled local release candidate, current evidence and blockers, see [release validation](scenario-release-validation.md). The original PR #17 validation below is historical; the release follow-up completes browser review and adds archive/send compatibility.

Prepared 21 October 2026. No production mutation, deployment, merge, configuration seed or real outreach was performed.

## Baseline and PR compatibility

Inspected fetched main `5ecb21c` and open drafts #10 (company scenarios and offers), #11 (batch dashboard) and #16 (archive/restore). The original dirty recovery checkout is untouched. This change uses the existing scenario assessment, compatible-template mapping, active business batch and company send-claim implementation from #10. It does not duplicate that registry or introduce another price catalogue.

The review base `codex/scenario-reports-foundation` is integration commit `754593f`: #10 at `d7cd858` plus current main. Its merge resolves three presentation conflicts while preserving main's graphite theme, #10's scenario selection and batch move/archive behaviour. The feature PR targets that base to keep unrelated foundation/theme changes out of its diff. It is stacked on draft #10, not independently deployable. After #10 and its main reconciliation are accepted, retarget to main and inspect the resulting diff. Neither prerequisite branch is merged by this task.

#11's dashboard changes are independent; this change does not import them. #16's archive guards are intentionally not copied. If #16 is accepted first, reconcile report materialisation on GET with its read-only archived-record contract before releasing: archived detail must read retained reports without preparing new snapshots. Retain its eligibility, enrichment and child-write guards.

## Behaviour

The intelligence workflow is Enrich → Assess → Prepare Outreach → Review/Send. The audit card, generation buttons, list/batch audit filter and audit milestone are removed. Old single and discovery-batch audit POST routes return authenticated HTTP 410 without invoking shared services. The retired generator and wrapper are removed. Discovery no longer waits on audit status or counts it as an active stage.

Every completed scenario assessment automatically materialises an immutable report. Detail retrieval also materialises reports for existing visible assessments, requiring no separate report approval. Unknown/missing commercial data produces a report with an explicit blocker rather than failing assessment or inventing an offer. Non-confirmed observations remain visible in report provenance but cannot supply outreach claims. Report availability is distinct from commercial/send readiness.

Each report has all ten requested sections. Supported findings come from the source scenario match; impact is explicitly unestablished unless configured. Solutions use reviewed scenario report configuration or the resolved offer description. The report retains the complete source assessment, scenario definition/version, outreach template/version, enrichment evidence and source references, commercial snapshot and Billing price version. A canonical JSON SHA-256 fingerprint makes identical regeneration idempotent; changed sources create another retained report, never overwrite one. A database trigger logs each new report atomically.

The detail page shows scenario reports, offer name and price, with expandable evidence, inclusions, GST, terms and destination. Outreach preparation displays the reports alongside one email for the selected template. A configured combined template can include several confirmed scenarios in one business email with one approved combined offer. Different offers are never silently collapsed into one: they require an explicitly reviewed compatible combined mapping. Company-level send claims continue to prevent multiple emails across separate drafts/scenarios.

The email uses the versioned reviewed template introduction plus recorded scenario opportunities, recommended solutions, the approved offer name/description/components, price/cadence/GST, terms, verified destination and a consultative CTA. Missing findings, incompatible mappings, changed assessment/price/template/destination, withdrawn offers and unresolvable Billing data block preparation/approval/sending. Existing customer, previously-contacted, nurture/suppression and possible-match acknowledgement checks remain; sending freshly queries Cockpit.

Operators can edit salutations, reorder the required paragraphs and use additional `edit_phrases` from the reviewed versioned template. Required introduction, findings, solution, price, terms, destination and CTA remain intact; arbitrary unsupported new claims and unreviewed subject changes are rejected. This is intentionally constrained human editing, not unrestricted copy authoring. Additional phrasing or a subject change must first be reviewed in the template configuration. Saving an edit resets approval. Unsaved edits disable approval/send. Approval requires explicit review; sending remains a separate confirmation. No assessment, report, selection or preparation path sends mail.

An atomic compare-and-claim RPC locks the exact approved draft and compares subject, body, selection and updated timestamp before creating the existing unique company/draft send claim. A trigger prevents later edits or reversion to draft after a claim. Failed/ambiguous sends retain the claim and require delivery reconciliation. There is no automatic retry.

## Commercial integration and configuration

The existing `opportunity_outreach_templates.offer_id` must identify an existing Billing **plan**, not a product, display label or invented UUID. This adapter uses Billing's current read-only contracts, verified against the local Billing Kernel source:

- `GET /catalogue/plans/:planId`: identity, name, description, billing type, sellability and archive state.
- `GET /catalogue/products/:productId`: owning product must be published.
- `GET /catalogue/plans/:planId/prices/current`: effective published/superseded price version, amount/currency, GST treatment and rate. Future, expired, draft and incomplete prices are refused. Explicit published POA remains POA, never zero/free.

Server-only configuration: reuse `BILLING_API_BASE_URL` and `BILLING_CATALOGUE_API_KEY` with read-only `catalogue.read` permission, using the existing `Authorization: ApiKey` contract and `/api/v1` base normalisation. Explicit preview configurations may still use `BILLING_CATALOGUE_API_BASE_URL` and `BILLING_CATALOGUE_BEARER_TOKEN`; partial shared credentials fail closed rather than silently falling back. Never set these as `VITE_*` variables. Fetches have a ten-second timeout, do not follow redirects and never forward credentials to a client. No credentials were read or created in this task.

Billing's inspected plan model does not carry an offer's full inclusion breakdown or detailed commercial terms. The existing approved offer configuration is therefore extended with nullable `approved_details`: `{ approved_at, inclusions: string[], terms: string[] }`. Both lists and a nonfuture approval date are required. These supplement the same Billing plan identity; prices/GST are always fetched from Billing. Configure reviewed `edit_phrases: string[]` when needed. Increment the template version when commercial text or copy changes. No templates, inclusions, terms, mappings, destinations, prices or activation flags are seeded by this migration.

Scenario `report_config` may provide reviewed `category`, `potential_impact`, `recommended_solution` and `outreach_angle`. Do not put unsupported business facts, unverified service promises or quantitative benefit claims in configuration. Unset impact stays explicitly unknown. Templates require `{{business_name}}` in the introduction and support the existing business/findings/destination placeholders.

## Migration, compatibility and release

`20261020234438_scenario_reports.sql` depends on #10's `20261009145236_company_scenario_workflow.sql` and its batch foundation. It adds two configuration columns, an append-only report table, an atomic report-history trigger, a service-role-only send-claim RPC and a draft-update guard. The new table has RLS enabled, no public/authenticated privileges and only service-role SELECT/INSERT. Functions are invoker functions with a fixed search path and public/anon/authenticated execution revoked. Foreign keys retain source identity and prevent deleting referenced history. No UUID constraint is relaxed.

Historical `local_business_audit_reports`, user UUID attribution, discovery audit counters/status columns, views and shared eligibility/audit-log triggers remain. The detail API still returns retained audit history and historical PDF links. New list/batch filters use `reportAvailability` and `has_scenario_report`. Saved legacy `auditAvailability` fields are retained in storage and ignored during filter normalisation; they cannot hide otherwise valid records. Saving an edited filter writes the current normalised shape. No destructive backfill is included.

Old unsent drafts without report snapshots are blocked and must be regenerated and reviewed. Sent history remains read-only. Rollout requires coordinated API/frontend versions; legacy clients attempting audit actions receive 410. Applying the additive migration does not itself prepare reports or send messages; normal API reads/assessments materialise reports after release.

Release remains approval-gated:

1. Resolve the #10 dependency and review the combined production migration path, including its legacy active-batch overlap preflight. Run a full production-schema upgrade rehearsal in staging. The disposable test fixture is not proof of a production-schema upgrade.
2. Reconcile #16 if applicable. Verify Billing reader credentials and exact published plan IDs, approved inclusion/term configuration and dedicated destinations. Review templates and scenario claims before enabling any mapping.
3. After explicit approval, apply prerequisite migrations followed by this additive migration; release the opportunities function and matching frontend. Keep sending disabled throughout verification. Do not backfill or mutate historical audit records.
4. Exercise one/multiple scenarios, offer withdrawal/price change, human edits/approval and duplicate-contact checks with disposable staging records and a mail sink. Any real outreach needs separate approval.

For rollback, disable sending before rolling back application code and retain report/history tables and configuration columns. Do not restore the old sender over report-era approved drafts while leaving live sending enabled. No down migration or report deletion is proposed.

## UUID investigation

Main PR #13 (`b8942a0`, merged by `a93d52a`) already corrected the obsolete audit generator's `generated_by: "opportunity-engine"`. That column represents an `auth.users` UUID. Main omits system labels from that UUID field and preserves real user attribution on regeneration. The system label belongs in metadata, not the UUID identity. This work removes that generator and both executable routes; shared assessment, event and eligibility services remain. No replacement auth user, coercion or weakened UUID constraint is introduced. Regression tests verify the obsolete write is absent, historical reads remain and both audit routes return 410. No production error was deliberately reproduced.

## Verification

- Focused suite: 72 passing tests across six files, including all 12 real PostgreSQL integration tests. A dedicated disposable `postgres:17` container and `opp_company_test_reports` database on loopback port 55484 were used. The suite tests the prerequisite migrations plus this migration, report insert idempotency/history/RLS and concurrent send claims.
- Full Vitest suite: 361 passed, zero failed/skipped. Covers existing assessment, enrichment, eligibility, acknowledgement, discovery, batch and visual-evidence contracts as well as reports/commercial edits.
- Production TypeScript/Vite build and modified opportunities Edge Function Deno check pass. Full four-function Deno checking reports the same 12 pre-existing visual-assessment type errors on pristine fetched main and this branch. The unchanged enrichment worker runtime smoke passes (one test, loopback-only, no credentials/provider/database access).
- Browser fixture: single-scenario report expansion, all ten sections, offer details, draft preparation, salutation editing and save-before-approval protection observed. Multi-scenario report display and explicit template selection observed. Browser automation stalled at the native review confirmation dialog; full confirmation/send was not completed in the browser. Server-side review and send gates are tested; the fixture send endpoint refuses mail and no SMTP transport was invoked. Responsive/mobile QA and a production-connected end-to-end test remain release checks.
- `git diff --check` passes. No dependency/lockfile or production configuration change.

Commands: `npm test`; `npm run build`; `npx --yes deno check --no-config --no-lock supabase/functions/opportunities/index.ts`; `npx --yes deno test --no-config --no-lock --no-check --allow-net=127.0.0.1 tests/enrichment-handler.smoke.ts`. To execute PostgreSQL tests, set `OPP_TEST_DATABASE` to a disposable `opp_company_test*` database, `OPP_TEST_PSQL` to psql, and `OPP_TEST_PGPORT` to its loopback port. That suite recreates only the explicitly selected disposable test database schema.

Changed files are listed in the focused draft PR diff. The feature touches report/Billing helpers, the opportunities API, one additive migration, detail/preparation/list/filter/timeline components and their regression tests. Foundation changes are excluded by the integration base.

## Feature file inventory

- `docs/scenario-reports.md`
- `src/components/CompanyScenarioPanel.tsx`
- `src/components/DraftEditor.tsx`
- `src/components/EventTimeline.tsx`
- `src/components/ExecutiveSummary.tsx`
- `src/components/Filters.tsx`
- `src/components/ScenarioReportView.tsx`
- `src/lib/api.test.ts`
- `src/lib/api.ts`
- `src/lib/audit-generator-identity.test.ts`
- `src/lib/company-membership.integration.test.ts`
- `src/lib/company-outreach.test.ts`
- `src/lib/discovery.test.ts`
- `src/lib/discovery.ts`
- `src/lib/opportunity-batches.test.ts`
- `src/lib/phase5-contract.test.ts`
- `src/lib/scenario-outreach-handlers.test.ts`
- `src/lib/scenario-reports.test.ts`
- `src/lib/types.ts`
- `src/routes/Discovery.tsx`
- `src/routes/OpportunityBatches.tsx`
- `src/routes/OpportunityDetail.tsx`
- `src/routes/OpportunityList.tsx`
- `supabase/functions/_shared/companyScenarios.ts`
- `supabase/functions/_shared/opportunityBatches.ts`
- `supabase/functions/_shared/scenarioReports.ts`
- `supabase/functions/opportunities/index.ts`
- `supabase/migrations/20261020234438_scenario_reports.sql`
