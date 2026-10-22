# Preserved owner proposal — reconciled implementation notes

The following owner proposal is preserved for review. The combined candidate uses `opportunity_outreach_send_claims`, `claim_scenario_outreach_send` and `complete_scenario_outreach_send`, retaining one company-unique barrier. The proposed second ledger and alternate RPCs are not installed. See `release-blocker-review.md` for decisions and executed validation.

# Shared retention and lifecycle contract — proposed, not approved

This proposal addresses the PR #16 review at 37976ab. It is a release gate, not permission to change Cockpit or production data. The revised, unapplied migration still proposes table-wide lead DELETE denial. Do not release it until affected consumer owners accept that policy and their compatible changes are reviewed together.

## Consumer evidence

Read-only inspection of the MGRNZ snapshot at e32b61bd587596b42d365de16e00c08534855767 found:

| Consumer | Existing contract | Required agreement |
|---|---|---|
| Cockpit `apps/cockpit/src/services/leads.ts:312` / `CockpitLeads.tsx:651` | Authenticated bulk DELETE of canonical leads | Replace the visible bulk-delete operation through Cockpit's reviewed server authorization boundary; do not place the console's shared operator token in Cockpit/browser code |
| Cockpit lead projection/select lists | Status/enrichment fields, no archived_at | Expose effective archive state, retain historical views and disable operational controls for archived records |
| Canonical schema | `status='archived'` is valid; prior disposition is not represented by that value | Inventory legacy writers and decide conversion/restore semantics before backfill or prohibiting that legacy write |
| Canonical assessments, report generator, visual intelligence, enrichment worker | Direct writes with service role or authenticated canonical policies | Ship guards with the reviewed worker/API; preserve actionable conflict reporting and do not deploy an older worker over the archive guard |
| Discovery import | Candidate import/duplicate bookkeeping retains canonical identity | Continue matching archived identities and recording duplicate links; never automatically restore or queue them |
| Sent-outreach Cockpit handoff | Existing idempotent ingest RPC and contact governance | Retain the same RPC/event; allow only sent-message handoff bookkeeping after archive |
| Batch membership | Fixed membership; parent batch deletion cascades | Retain archived members. A batch containing them cannot be deleted through a cascade; agree a separate retention policy for batch removal |

This source snapshot is not proof of a complete production consumer inventory. Reconcile current schema/grants/triggers and operational consumers before release; no production inventory query or data conversion was run in this revision.

## Proposed transition

1. Agree that archive/restore changes working visibility independently of commercial disposition. Permanent deletion remains unavailable in Opportunity Engine. Accept or reject the proposed shared-table retention boundary explicitly; do not weaken it to make a failing Cockpit delete button appear functional.
2. Have Cockpit owners replace `deleteLeads` and its confirmation UI with the agreed retention operation, scoped server-side permissions and attribution. Existing broad JWT DELETE privileges are not proof of an administrator or console-operator entitlement. Preserve selection/retry behaviour and report conflicts per selected record without partial cascade deletion. This PR does not edit that repository or grant Cockpit users console privileges.
3. Use effective archive state (`archived_at IS NOT NULL OR status='archived'`) during transition. This PR implements conservative reads and mutation denial for legacy archives. It neither changes legacy status nor fabricates timestamps. Legacy restore returns `legacy_archive_review_required`; no prior disposition is guessed. Existing legacy archive writers continue to be a coordination concern, not an automatically rewritten workflow.
4. Inventory legacy archived records and their last reliable prior disposition/event. Review the mapping and audit attribution, including records with ambiguous history. Convert only under a separately approved migration; preserve original state and identity in history. Decide an explicit fallback policy with the owners instead of restoring ambiguous records to discovered.
5. After all writers adopt the shared RPC/API, retire legacy-only archive transitions through a coordinated migration. Validate both systems against the same retention fixtures before enabling the production UI.

No stages here authorize production migrations, permanent deletions, contact changes or operational retries. Until agreement and coordinated consumer delivery, release remains blocked even when disposable tests pass.

## Durable SMTP contract

The existing manual send route and SMTP transport are reused. A service-role-only `claim_opportunity_send` RPC locks the draft then its lead, validates approval, effective archive state, enrichment conflict and the actual message/email snapshot, and commits one claim per draft before SMTP. The token is server-only. A second request cannot reuse or reclaim the draft.

While a claim is sending or uncertain, the database rejects archive, lead changes, draft edits, demotion and deletion. Claims never expire or become retryable because time passed. `complete_opportunity_send` records sent state plus the existing outreach_sent/handoff event in one transaction. Completion retries use the same token and emit one event; they never send SMTP. Confirmed SMTP DATA acceptance remains success even if QUIT fails.

A transport exception may occur after remote acceptance: it records uncertain, and the API says retryable=false. If completion persistence fails or the process dies, the existing sending claim remains the barrier. No new retry/recovery endpoint, scheduler, automatic reconciliation or resend mechanism is introduced. An operator must reconcile transport evidence under a separately reviewed procedure. A confirmed delivery can be finalized using the existing token; confirmed non-delivery/ambiguous crash recovery requires a separately reviewed claim-resolution policy. Creating another draft is not a safe substitute for resolving an uncertain delivery.

The new claims table has RLS. Only service_role can execute claim/completion and access tokens or SMTP metadata. Existing authenticated canonical writers receive SELECT of draft_id, lead_id and state only, restricted to leads visible to them under existing lead RLS. This lets invoker triggers check the fence without a SECURITY DEFINER bypass. It does not grant send authority or expose claim_id, recipient metadata or diagnostic details.

## Evidence and history contract

The existing child trigger now resolves both OLD and NEW ancestry through visual finding -> visual assessment -> evidence -> candidate -> imported/duplicate lead, and audit report -> canonical assessment. Ancestors are SHARE-locked before resolved lead locks; lead locks are ordered by ID. Candidate-only pre-import evidence remains valid. Inconsistent multi-owner associations fail closed. Reparenting populated ancestors requires review, so a later parent edit cannot detach existing children from their retention boundary.

Archived evidence writes, reassignment and cascade deletes fail closed; explicit restore re-enables legitimate review. Discovery may still record a duplicate match to an archived identity without starting intelligence work. Console history protects OLD and NEW workflow actions/lead IDs on UPDATE/DELETE as well as INSERT. Lifecycle and send audit events are immutable. Canonical event append and existing sent-message Cockpit bookkeeping remain available.

## TRUNCATE and maintenance

The historical schema gives runtime roles TRUNCATE privileges. Rather than revoke unknown maintenance grants globally, the proposal installs BEFORE TRUNCATE statement triggers on protected lead/evidence/history/batch/candidate/claim tables. Runtime service_role and JWT roles are denied even when table grants would otherwise allow TRUNCATE CASCADE. A session using SET ROLE service_role cannot use a postgres session as a bypass.

The existing database owner role postgres retains owner-level TRUNCATE capability; there is no new role, browser switch, environment variable, configurable SQL bypass flag or privileged maintenance RPC. A local rollback-only owner test verifies this capability remains available. This is a technical owner exception, not evidence that a particular production maintenance procedure is approved. Owner-led maintenance must use the owners' separate authorization, backup and audit process, quiesce writers/SMTP, and reconcile unresolved claims first. Confirm those runbooks/roles before release. Ordinary runtime cleanup, permanent opportunity deletion and automatic database resets are not maintenance authorization.

## Validation and release checklist

- Run both pgTAP files on a disposable schema: `supabase/tests/opportunity_lifecycle.sql` and `supabase/tests/opportunity_send_claim.sql`.
- `tests/lifecycle-integration.py <evidence-directory>` requires psycopg 3.2.10 and deliberately accepts only database lifecycle_revision on 127.0.0.1:55416 with a non-networked net.http_post recording stub. It extends the original 24 review cases; the two shared-policy cases verify conservative denial, not Cockpit compatibility approval. Never point fixtures at production.
- Reuse/reconcile a schema-only baseline and checked-in dependencies. The native review fixture excludes Paperclip cross-schema views and Supabase Auth/Storage/platform behaviour; do not claim a full-stack production-equivalence check.
- Validate the API with a fake transport, including rejection before SMTP, uncertain outcomes, post-acceptance persistence failure and QUIT failure. Race claims with archive, draft demotion and duplicate send requests in addition to enrichment, approval, history and handoff races.
- Require full tests/build/type/Deno checks with baseline failure comparison, shared-owner policy approval, Cockpit consumer changes and current-schema reconciliation. Deploy only through the existing reviewed schema/API/worker/frontend process after explicit release authorization. Do not merge or deploy as part of this work.
