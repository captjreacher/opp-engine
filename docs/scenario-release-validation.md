# Scenario reports coordinated release assessment

Validated locally on 21 October 2026. **Recommendation: do not release to production yet.** The combined source passes the local checks below, but commercial configuration, inherited integration rehearsal and remote branch reconciliation remain release blockers. No remote branch was changed, no PR was merged, no deployment or production migration occurred, and no outreach was executed.

## Reconciled dependencies

| Input | Reviewed commit | Disposition |
| --- | --- | --- |
| main | `5ecb21c000d90f78670efd352e1ec5bd787ff66b` | Production fixes and graphite UI treatment retained |
| PR #10 company/scenario outreach | `d7cd8588adc23382b252dd33442b25f9f905a875` | Already reconciled with main at local foundation `754593f7a0e41ceaaea1ee36cfe97320fad8842d`; reuse this result |
| PR #17 scenario reports | `a8a250343294ea5d65a32911e76db12c01474b64` | Applied above that reconciled foundation |
| PR #16 archive/restore | `37976ab344b5ad913b39f3a881ce1c607e60e795` | Committed implementation integrated locally; scenario/archive conflicts resolved |
| PR #11 batch dashboard | `59acf41e19590164dbb7d9a4c636965ece6d0fff` | Inspected, independent and conflicting with main; excluded from this release |

Final local branch: `codex/scenario-release-candidate`, in the managed `scenario-release-validation/opp-engine` worktree. The original checkout and existing scenario/archive worktrees were preserved. The archive worktree contains substantial uncommitted hardening, including a competing send-ledger approach. That uncommitted work was neither copied nor modified. Its owner must reconcile it with this single-ledger implementation before updating #16.

Remote #10 remains conflicted and #17 remains based on its foundation branch. Cloudflare PR comments establish that branch pushes upload preview deployments. Updating remote branches would therefore violate the requested no-deployment restriction; all integration changes remain local. No new merge was performed during this release-validation task; the pre-existing reconciled foundation was reused and the committed archive change was cherry-picked locally.

## Combined behaviour and fixes

- Detail workflow is Enrich → Assess → Prepare Outreach → Review/Send. Historical audit records and provenance remain; audit generation and approval are absent from new outreach.
- Every applicable assessed scenario receives a versioned structured report with its source assessment, evidence, limitations and resolved approved offer snapshot. Multiple scenarios can share one explicitly selected business email and one commercial offer block.
- Missing, withdrawn, unpublished or incomplete commercial offers block preparation/approval/sending. No local price catalogue or fabricated offer inclusions were added.
- Existing shared Billing reader configuration is reused: `BILLING_API_BASE_URL` plus `BILLING_CATALOGUE_API_KEY`, with the established `/api/v1` and `ApiKey` contract. The earlier preview bearer configuration remains compatible. Partial shared configuration fails closed. No secrets or Billing configuration were changed.
- Human edits remain saveable; approval requires an explicit review checkbox in an accessible dialog. Approval binds the reviewed draft timestamp, rejecting concurrent edits. Commercial details and evidence-derived claims remain validated.
- GuidedWorkflow's Send shortcut now navigates to the email workspace. Only Send… followed by Confirm send reaches the sending boundary. Approval, assessment, report generation, archive/restore and navigation do not send.
- Archived opportunities expose retained reports without regenerating them or reading Billing. Scenario selection, enrichment, draft editing/preparation and approval are blocked until restoration. Database parent locks serialize archive against report insertion and approval.
- The compatibility migration extends the existing company-unique send claims rather than adding a second ledger. A claim binds the exact approved draft and recipient; unresolved attempts freeze meaningful lead changes. Completion atomically records claim state, sent draft and audit/handoff event. Uncertain delivery cannot be retried automatically. Claim history cannot be deleted or reverted to sending.
- Cockpit eligibility, existing-customer/contact protections, possible-match acknowledgement, nurture/previous-contact classifications, active Batch ownership and duplicate company protection remain in the path.

The UUID defect was the obsolete audit generator's system label in the UUID `generated_by` field, already fixed on main by PR #13. The removed routes remain unavailable; real user UUID attribution and historical reads remain intact. UUID constraints were exercised against the production-derived local schema and were not weakened.

## Validation evidence

| Check | Result |
| --- | --- |
| Full Vitest suite, both disposable PostgreSQL database variables enabled | **430 passed, 0 failed, 0 skipped** |
| PostgreSQL integration subset included above | **22 passed**: 12 existing membership/report tests and 10 combined release migration tests |
| `npm run build` (`tsc -b` and Vite) | Passed |
| Deno check: changed opportunities and local-business-enrich entrypoints | Passed |
| Enrichment startup smoke test, loopback only | 1 passed |
| All four Edge Function entrypoints Deno check | 12 pre-existing errors in unchanged local-business-visual-assess: 11 TS2339 and 1 TS2345; reproduced from pristine main |
| Deno lint on modified production function files | 4 pre-existing findings, also reproduced on main: inline jsr import, unused runInBackground, findActiveCategory and keywords |
| Frontend lint script | None configured; no lint dependencies/configuration introduced |
| Whitespace/conflict-marker checks | Passed before local commit |

Reproduction (PowerShell, from the candidate worktree):

```powershell
$env:OPP_RELEASE_DATABASE='opp_release_test_rehearsal'
$env:OPP_TEST_DATABASE='opp_company_test_release'
$env:OPP_TEST_PSQL='C:/Program Files/PostgreSQL/17/bin/psql.exe'
$env:OPP_TEST_PGPORT='55485'
npm test -- --reporter=json --outputFile=final-combined-tests.json
npm run build
npx --yes deno check --node-modules-dir=auto supabase/functions/opportunities/index.ts supabase/functions/local-business-enrich/index.ts
npx --yes deno lint supabase/functions/opportunities/index.ts supabase/functions/_shared/scenarioReports.ts supabase/functions/local-business-enrich/index.ts
```

Docker rehearsal used a dedicated PostgreSQL 17 container `opp-release-rehearsal-20261021`, bound only to localhost:55485. The fixture contains 18 production-derived target table definitions and 104 actual constraints, including UUID attribution and the generated opportunity score. It contains no production data or credentials. New migration functions/triggers were exercised as real SQL. External auth/contact references use empty schema shells. Original external CRM/provider/event functions and all inherited policies/triggers were not cloned: this is a targeted migration rehearsal, not a full production clone.

Tests cover archive/restore idempotence and retained history; archived child writes; changed recipient, stale draft and unapproved claims; company concurrency; uncertain outcomes and immutable claims; atomic idempotent completion and handoff recording; rollback on audit failure; service-role grants; and deterministic two-session archive/report and archive/approval races in both lock orders. Handler tests exercise actual transpiled API functions with mocked transport, fresh eligibility and offer checks. No real SMTP call was made.

### Browser evidence

The real candidate React UI and transpiled API handlers were exercised against the migrated disposable database. Cockpit/Billing responses were explicit fixtures. The browser harness replaces SMTP with a refusing function and has no production credentials or external transport. These tests prove interaction and local boundaries, not live provider delivery.

| Viewport / case | Observed result |
| --- | --- |
| Desktop 1440×1000, one scenario | Report sections, evidence and resolved price/GST/terms/URL visible; preparation created one editable draft |
| Desktop edit/save/review | Edited greeting saved; unsaved approval disabled; unchecked approval confirmation disabled; cancellation and explicit approval worked |
| Desktop manual boundary | Approval did not send; workflow shortcut only navigated; separate confirmation reached only the refusing mock transport; uncertain claim retained and retry blocked |
| Mobile 390×844, multiple scenarios | Explicit combined selection; two scenario sections in one business email; shared price block appeared once |
| Mobile editing/approval | Saved human edit; review dialog fit viewport; Escape closed it and returned focus; explicit approval worked |
| Mobile archived/restore | Retained report readable, mutation controls disabled; local restoration re-enabled controls without outreach |
| Mobile missing/withdrawn offer | Report displayed blocker; prepare returned 422; no draft or automatic email |
| Responsive layout | No whole-page horizontal overflow: document widths 1432/1440 and 382/390; email and modal remained usable |

Screenshots: [desktop review](evidence/scenario-release/desktop-review.png), [manual send boundary](evidence/scenario-release/desktop-send-boundary.png), [mobile review](evidence/scenario-release/mobile-review.png), [mobile preparation](evidence/scenario-release/mobile-preparation.png), [mobile email](evidence/scenario-release/mobile-email.png), [archived report](evidence/scenario-release/mobile-archived-report.png), [withdrawn offer](evidence/scenario-release/mobile-withdrawn-offer.png).

The final shared-API-key configuration path was rechecked in desktop preparation/approval after the full suite. Earlier desktop/mobile captures exercised the same combined UI. Browser transport counters and fixture claims are recorded in the evidence manifest. Delivery success and failure persistence are additionally exercised by mocked handler tests and real SQL integration tests.

## Read-only Billing and production findings

Billing was inspected read-only; no changes were made. Current published version 2 for Small Business Website and Tradie Website is NZD 1250.00, GST exclusive at 15%, effective 19 October 2026. Both plans are sellable and their products are published. Website Care and Website Refresh are archived and not sellable; they must not be selected despite historical price records. These observations verify Billing data, not approval to offer either plan for a scenario.

Production's website_refresh/local_visibility commercial configuration has no approved Billing offer identifier; the general discovery-session mapping does not supply these missing approved scenario offers. Only the general digital-presence scenario is active; six specific scenarios remain draft. Approved inclusions, commercial terms and destination mapping for the new workflow must be supplied through the existing approved configuration. The paid AI-readiness plan must not be substituted for a free assessment. New report/template migrations have not been applied in production. No approved mapping was invented or enabled.

Existing shared reader secret names were verified without reading values. Live catalogue HTTP permissions with that key remain to be verified in an isolated authorized staging environment; the local request format was verified against the existing Billing reader/router source and tested with fixtures.

## Existing Cloudflare architecture

Production is Worker `opp-engine` at `https://opp-engine.mike-f16.workers.dev/`, serving Vite static assets directly with SPA fallback, compatibility date 2026-08-20 and no Worker bindings. Build is `npm run build`; no GitHub Actions deployment workflow exists in this repository. Supabase functions/database are a separate deployment boundary.

Read-only Wrangler inspection found deployment `8cbeae81-7ab8-4175-bc1b-31ef453a95dc` (18 October 2026, 13:52 UTC) serving Worker version **`2adf39b9-4376-43ee-b2a3-027e7d1be68b` (67) at 100%**. Production GET returned 200 with `/assets/index-51o-Udiw.js` and `/assets/index-C6yLB_qe.css`. Version `d5a5b295-058c-49d2-b406-fde3488f2edc` (70) is the #17 preview, not production. Re-read deployment state immediately before an authorized release.

Cloudflare Git integration can build branches on push; the project's PR comments confirm preview uploads. The production branch promotion policy was not fully exposed by these CLI reads. Treat main updates as deployment-capable until an operator verifies the dashboard policy. See [Cloudflare Git integration](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/) and [version rollback behaviour](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/).

## Ordered release plan — future authorized actions only

1. Resolve #16's uncommitted competing ledger work with its owner. Preserve one authoritative claim ledger. Review the candidate compatibility migration and approval/recipient binding changes. Recheck all branch heads and main; rerun combined validation if source changes.
2. Obtain authorization for remote branch updates and their preview deployments. Reuse #10's reconciled `754593f` result. Rebase/update #16 above reconciled #10, then update #17 above #16 with reports and the compatibility changes. Retarget dependencies accordingly. Keep #11 outside this release. Never overwrite a branch containing newer owner work; use exact-head checks and reviewed diffs.
3. Revalidate the exact final combined remote commit, including desktop/mobile preview QA. Complete a full isolated staging rehearsal with inherited CRM/event/provider triggers and policies, service-role API execution and live read-only Billing permissions. Confirm approved offer inclusions, terms, destinations and price mappings. Have an operator decide how to resolve baseline visual-assessment type/lint failures before the release gate.
4. Before any merge, verify Cloudflare production build/promotion settings and agree a release window that prevents intermediate frontend promotion. Do not assume separately merging dependencies is inert. Record current Worker/API versions, migration ledger, backups and rollback ownership. Configuration/promotion changes require separate authorization.
5. With migration approval, apply in order: existing batch foundation (already present), `20261009145236_company_scenario_workflow.sql`, `20261018144011_opportunity_archive_restore_governance.sql`, `20261020234438_scenario_reports.sql`, `20261021003415_scenario_archive_release_compatibility.sql`. Preflight duplicate company/active Batch membership and foreign-key assumptions; stop on conflicts rather than repairing production automatically. Retain all historic audit/report/claim rows.
6. Deploy matching Supabase opportunities and local-business-enrich functions before promoting the new frontend. The compatibility RPC signature changes, so avoid a mixed sender rollout: suspend operator sending for the release window, deploy schema and matching API together, and verify old callers fail closed. Confirm existing reader configuration without modifying Billing. Keep unapproved mappings inactive.
7. Merge only the reviewed dependency order (#10 → #16 → #17) under the agreed promotion controls, or a reviewed equivalent that promotes only the final combined source. Build and promote the final Cloudflare artifact with explicit deployment approval. Verify exact commit/version, SPA routing, assets, read-only detail/report display and disabled missing-offer paths. Re-run eligibility/review checks. Sending requires separate human authorization; a deployment is not outreach permission.

## Rollback plan

- Stop operator sending and assess in-flight claims first. Never retry an uncertain SMTP result; reconcile against provider evidence manually.
- Roll back Cloudflare to recorded production version `2adf39b9-4376-43ee-b2a3-027e7d1be68b` only after checking current deployment state. Verify SPA/static assets and API compatibility. Record the corresponding Supabase function versions before release; those version identifiers still need to be captured for an executable backend rollback.
- Retain additive schema, immutable reports, audit history and send claims. Do not run destructive down migrations or delete claims to make retry possible. The old six-argument claim RPC is intentionally removed; old sender code must fail closed. Do not restore a sender lacking the atomic claim/completion protections while sending is enabled.
- If backend rollback cannot retain these guarantees, keep sending suspended and forward-fix the API. Reconcile sent/uncertain claims and downstream handoff state before reopening operator access.

## Remaining blockers

1. Remote #10/#16/#17 heads are not yet updated; updates trigger deployments and were withheld under the restriction. #16's uncommitted owner work needs reconciliation.
2. Approved scenario-to-offer mappings, reviewed inclusions/terms/destinations and scenario activation are missing in production. Fail-closed behaviour is correct but operators cannot yet prepare the intended outreach.
3. Full inherited-integration staging rehearsal, live read-only Billing permission check, exact backend rollback versions and Cloudflare promotion policy verification remain outstanding.
4. The existing 12 visual-assessment type errors and four lint findings remain; they are distinguished from the passing changed-function checks and require an explicit release disposition.

The local combined code is validated within the documented fixture boundaries. This evidence does not authorize release, configuration changes, migrations or outreach.

## Changed file guide

The complete scenario feature inventory is in [scenario-reports.md](scenario-reports.md). This release integration additionally changes:

- Detail/list/batch routes, CompanyScenarioPanel, DraftEditor, OpportunityActions, EventHistory, VisualEvidencePanel and index.css for archive compatibility and explicit review/send controls.
- `src/lib/api.ts`, `types.ts`, `bulk-enrichment.ts`, both opportunities/enrichment Edge Functions and `_shared/opportunityLifecycle.ts` / `scenarioReports.ts` for lifecycle guards, reviewed draft identity, Billing reader reuse and atomic completion.
- Archive and compatibility migrations plus `supabase/tests/opportunity_lifecycle.sql` for retained lifecycle history and serialized send/report protection.
- Lifecycle, scenario-report, release-handler and migration integration tests; `tests/fixtures/opportunity-release-schema.sql`; and local preview harnesses for reproducible validation.
- This release assessment and `docs/evidence/scenario-release/` screenshots/manifest. Raw CLI output remains local under ignored `node_modules/.cache/release-validation-raw`; secret metadata and provider account metadata are excluded from committed evidence.
