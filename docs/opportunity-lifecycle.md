# Opportunity lifecycle controls - review proposal

Status: implementation for review only. No migration, function deployment, production mutation or operational retry has been performed.

## Existing implementation and evidence

Baseline: origin/main 5ecb21c000d90f78670efd352e1ec5bd787ff66b. The original recovery working directory is unchanged; its 80 modified/untracked files have a separate zip and SHA-256 manifest.

The API checks the existing shared OPERATOR_TOKEN before every data route and uses the service role server-side. There is no verified per-user administrator role. Existing PATCH /:id only supports status=disqualified (not suitable), with its running-enrichment guard. It is reused unchanged; disqualification is neither archive nor deletion.

Read-only production catalogue inspection confirmed RLS on the local_business tables, discovery candidates, batch membership and console audit log. Some canonical tables have broad authenticated read/update/delete policies; this proposal does not widen or replace those policies. Lifecycle changes are restricted to the service-role RPC and a trigger that rejects untrusted lifecycle metadata changes.

The lead is referenced by assessments, reports, outreach drafts, visual evidence/assessments, signals, activities, contacts, tasks and batches. Many foreign keys cascade on DELETE; discovery candidates and canonical lead events set their lead reference to null. The console audit log has soft references. Sent outreach has existing Cockpit contact/handoff fields and history.

## User experience

Actions is visible on each table row and in the detail header. It opens a native modal action list, avoiding mobile table clipping, with keyboard focus containment, Escape dismissal and explicit Archive/Restore confirmation. Archive uses neutral graphite. A disabled destructive item explains why permanent deletion is unavailable.

Active is the default; Archived and All are explicit list scopes. Search matches business, category and location. Scope/search live in the URL and survive a refresh. Archived detail remains readable, including history/evidence expansion and links, while operational controls are disabled. Restore is available in the header and on archived rows. Disposition and existing workflow history are unchanged.

Batch membership is retained and archived members remain visible in batch detail, but cannot enter new bulk enrichment/assessment. Archived leads are omitted from active pipeline buckets; historical pipeline metrics remain historical.

## Schema proposal and atomicity

Migration: 20261018144011_opportunity_archive_restore_governance.sql (created with Supabase CLI; NOT applied).

- Add nullable archived_at, archived_by and archive_reason to local_business_leads, a metadata consistency constraint and a partial active-updated index. Existing rows start active.
- Add service-role-only, SECURITY INVOKER set_opportunity_archived(uuid,boolean,text). It locks the lead FOR UPDATE, returns idempotently if already in the requested state, and modifies only lifecycle metadata and updated_at.
- BEFORE triggers reject lead DELETE, combined lifecycle/business edits, untrusted metadata edits and operational lead changes while archived.
- AFTER UPDATE writes opportunity_archived/opportunity_restored to the existing app-owned audit log in the same transaction. Audit insertion failure rolls back the state change. Retries create no duplicate lifecycle event.
- Child-write triggers on intelligence output tables and batch membership lock the same parent(s), reject archived writes, and prevent reassignment from an archived lead. They do not freeze CRM relationship tables or canonical event append operations.
- A console-log trigger makes lifecycle events immutable and locks the parent before review/outcome event insertion, closing the concurrent workflow-only mutation path. Other historical event appends and existing handoff events remain allowed.
- Existing RLS is retained. No SECURITY DEFINER function, new browser database access, credentials, or administrator claims are introduced.

The DELETE guard is table-wide, including service-role deletions: reviewers must approve this retention policy for all local_business_leads consumers, not just this UI. Trigger changes affect canonical/shared intelligence tables and require coordinated review.

## Conflicts and contact safeguards

Archive rejects any raw enrichment_status=enriching, including unresolved stale states. Resolve stale execution through the existing reviewed recovery workflow; archiving never clears/reclaims/requeues it. Queue updates take the same lead lock before pg_net is invoked. The direct enrichment worker checks archive state before provider work and checks the initial claim write for a race with archive.

Archive also rejects approved outreach, because approved is the existing SMTP in-flight barrier. Revert/cancel approved work through the existing governed draft workflow before archive. The parent lock serializes approval with archival. No SMTP or operational request is issued by archive/restore.

Previously sent outreach retains its history and Cockpit relationship. Existing service-role handoff bookkeeping may update only the four cockpit_* handoff fields and updated_at on a sent draft while archived; subject, body, recipient and send status remain protected. Archive/restore never create, modify, retry or delete Cockpit contacts or handoffs.

Discovery matching remains unchanged and includes archived lead identities. Candidate duplicates still resolve to the retained lead. Both single-record operations and candidate assessment/audit paths reject archived work; restoring does not rerun discovery, clear possible-match acknowledgement, requalify the lead or send anything.

## Permanent deletion: intentionally unavailable

No role can permanently delete through this release. DELETE /:id returns 403 after authentication, even if a caller supplies an administrator claim or typed confirmation. The database rejects lead DELETE before cascade relationships are touched.

The shared operator credential cannot prove administrator identity, and the current schema has no approved tombstone/identity-suppression retention model. A destructive implementation would erase evidence and duplicate/contact governance. A future deletion design needs verified administrator identity, a scoped retention policy, an explicit typed confirmation, durable non-reversible audit attribution, dependency/tombstone handling, and a reviewed Cockpit/contact suppression contract. No destructive workaround is provided.

## API and deployment requirements (after review only)

- GET /opportunities?lifecycle=active|archived|all; omitted means active. Invalid scopes return 400. List/detail expose archive metadata and explicit lifecycle capabilities.
- POST /:id/archive or /:id/restore with {confirm:true,reason?:string}. Extra fields/forged roles are rejected; reason is at most 500 characters. Known conflicts return 409; missing records return 404.
- All existing mutation routes fail closed on archived records. Reads remain available behind existing authentication.

Do not merge this PR or enable the production lifecycle UI before schema/governance review. After approval: validate the migration and integration suite on an approved disposable database; verify RLS/RPC grants and the two-session races below; deploy the schema, opportunities API and local-business-enrich guard together, then the frontend through its existing release workflow. Existing secrets and deployment targets stay unchanged. A frontend-only release cannot satisfy archive/restore.

No automated rollback may DELETE records. Before removing lifecycle guards or fields, restore/archive state and retained events must receive a separate retention review.

## Validation and review gates

The Vitest suite covers real router auth/denial paths, confirmation payloads, RPC result/error/idempotency handling, related-record reads, list scopes, bulk exclusions and discovery/SQL safety contracts. Local desktop/mobile checks use tests/lifecycle-preview.mjs only: its in-memory API has no Supabase/provider access and rejects all operational actions. Browser checks cover archive -> Archived/search -> read-only detail -> restore -> Active, preserved fixture history, cancellation and running-enrichment denial.

Prepared but NOT run: supabase/tests/opportunity_lifecycle.sql (pgTAP, transaction/rollback, disposable database only). No database migration or SQL mutation was run. Local Docker's database engine was unavailable, and user authorisation explicitly reserves migrations for review.

Required integration review on a disposable database:

1. Run the prepared suite and verify archive/restore, idempotent event counts, service-role grants, direct JWT denial and audit-insert failure rollback.
2. In two sessions, race archive against queue/worker claim and draft approval in both lock orders; the loser must either wait and fail closed or report conflict, never enqueue/send after archival.
3. Verify approved outreach prevents archive; sent handoff metadata can complete without changing message content/status or Cockpit suppression rules.
4. Match an archived business through discovery import and verify the retained ID is reused and cannot enter assessment/audit until explicitly restored.
5. Compare every evidence/history/contact reference before archive and after restore; verify no physical rows are removed.

Baseline validation already has four unrelated Vitest contract failures (two Admin, two enrichment recovery). The all-function Deno check also reports 12 pre-existing generic-type errors in unchanged local-business-visual-assess under the currently resolved Supabase client types. Modified functions are checked separately. These are documented, not hidden by skipping tests or changing unrelated production logic.


### Recorded implementation validation (19 October 2026)

- Full Vitest suite: 334 passed / 4 failed (338 total). All 48 added lifecycle tests pass. The pristine selected baseline is 286 passed / the same 4 failures; no new failure is present.
- Production build, explicit TypeScript build and git diff --check: pass.
- Deno 2.5.4 check --no-lock --node-modules-dir=none on opportunities and local-business-enrich: pass. Full four-function check and the pristine baseline both report the same 12 unchanged visual-assessment type errors.
- Existing enrichment-handler startup smoke: 1 passed, with loopback-only network permission. Run with --no-check because Deno 2.5.4's test type resolver errors on the local @types/node constraint; modified production functions were separately type checked above.
- Browser fixture at 1440px and 390px: archive/restore, Active/Archived/search, cancellation, Escape/focus return, raw-enrichment denial and retained detail/history verified. Two successful lifecycle mutations produced three events including the original, with the assessment, report and draft retained. No production API or database was used by the UI fixture.
- The PostgreSQL suite and two-session concurrency matrix remain NOT RUN and required after review. SQL safety tests in Vitest are contract checks, not a substitute for database integration verification.
