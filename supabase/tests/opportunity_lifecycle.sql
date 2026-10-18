-- REVIEW-GATED integration suite. NOT executed during implementation.
-- Run only on an approved disposable database with the full schema, pgTAP and
-- the proposed lifecycle migration installed. Never point this at production.
begin;
set local search_path = public, extensions;
select no_plan();
select ok(not has_function_privilege('anon', 'public.set_opportunity_archived(uuid,boolean,text)', 'EXECUTE'), 'anon cannot archive');
select ok(not has_function_privilege('authenticated', 'public.set_opportunity_archived(uuid,boolean,text)', 'EXECUTE'), 'an ordinary JWT is not an operator credential');
select ok(has_function_privilege('service_role', 'public.set_opportunity_archived(uuid,boolean,text)', 'EXECUTE'), 'trusted API can archive');
insert into public.local_business_leads(id,business_name,status,source)
values ('f0000000-0000-4000-8000-000000000001','TEST Lifecycle retention','disqualified','lifecycle-test');
select lives_ok($$select public.set_opportunity_archived('f0000000-0000-4000-8000-000000000001',true,'No active campaign')$$, 'archive succeeds');
select ok((select archived_at is not null from public.local_business_leads where id='f0000000-0000-4000-8000-000000000001'), 'archive is separate metadata');
select is((select status from public.local_business_leads where id='f0000000-0000-4000-8000-000000000001'), 'disqualified', 'disposition survives archive');
select is((select count(*)::integer from public.opportunity_console_audit_log where lead_id='f0000000-0000-4000-8000-000000000001' and action='opportunity_archived'),1,'one archive event');
select is((public.set_opportunity_archived('f0000000-0000-4000-8000-000000000001',true)->>'idempotent')::boolean,true,'archive retry is idempotent');
select is((select count(*)::integer from public.opportunity_console_audit_log where lead_id='f0000000-0000-4000-8000-000000000001' and action='opportunity_archived'),1,'retry has no duplicate event');
select throws_ok($$insert into public.local_business_lead_assessments(lead_id) values ('f0000000-0000-4000-8000-000000000001')$$,'P0001','opportunity_archived','archived assessments are fenced before writes');
select throws_ok($$delete from public.local_business_leads where id='f0000000-0000-4000-8000-000000000001'$$,'42501','permanent_deletion_unavailable','no cascade workaround');
select throws_ok($$insert into public.opportunity_console_audit_log(action,lead_id) values ('opportunity_review_completed','f0000000-0000-4000-8000-000000000001')$$,'P0001','opportunity_archived','concurrent review state is fenced');
select throws_ok($$delete from public.opportunity_console_audit_log where lead_id='f0000000-0000-4000-8000-000000000001' and action='opportunity_archived'$$,'42501','lifecycle_history_immutable','lifecycle audit records cannot be erased');
select lives_ok($$select public.set_opportunity_archived('f0000000-0000-4000-8000-000000000001',false)$$,'restore succeeds');
select ok((select archived_at is null from public.local_business_leads where id='f0000000-0000-4000-8000-000000000001'),'restored to active');
select is((select status from public.local_business_leads where id='f0000000-0000-4000-8000-000000000001'),'disqualified','restore does not requalify');
select is((select count(*)::integer from public.opportunity_console_audit_log where lead_id='f0000000-0000-4000-8000-000000000001' and action in ('opportunity_archived','opportunity_restored')),2,'both lifecycle events remain');
select is((public.set_opportunity_archived('f0000000-0000-4000-8000-000000000001',false)->>'idempotent')::boolean,true,'restore retry is idempotent');
update public.local_business_leads set enrichment_status='enriching' where id='f0000000-0000-4000-8000-000000000001';
select throws_ok($$select public.set_opportunity_archived('f0000000-0000-4000-8000-000000000001',true)$$,'P0001','enrichment_running','running or unresolved enrichment blocks archive');
select ok((select archived_at is null from public.local_business_leads where id='f0000000-0000-4000-8000-000000000001'),'failed archive leaves state unchanged');
select is((select count(*)::integer from public.local_business_leads where id='f0000000-0000-4000-8000-000000000001'),1,'lead identity still available to discovery deduplication');
select is((select metadata->>'reason' from public.opportunity_console_audit_log where lead_id='f0000000-0000-4000-8000-000000000001' and action='opportunity_archived'),'No active campaign','reason remains in audit history after restore');
select * from finish();
rollback;
