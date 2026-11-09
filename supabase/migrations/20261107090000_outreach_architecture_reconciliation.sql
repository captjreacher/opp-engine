-- Outreach architecture reconciliation on top of PR #19.
-- Forward-only: legacy claims remain historical evidence; new sends use only
-- opportunity_outreach_send_attempts.
begin;

alter table public.local_business_outreach_drafts
  add column if not exists approval_fingerprint text,
  add column if not exists approved_audit_report_id uuid,
  add column if not exists approved_billing_offer_id text,
  add column if not exists approved_current_assessment_id uuid,
  add column if not exists approved_scenario_report_id uuid,
  add column if not exists approved_scenario_report_fingerprint text,
  add column if not exists approved_scenario_report_references jsonb,
  add column if not exists approved_audit_report_fingerprint text,
  add column if not exists approved_recipient text,
  add column if not exists approved_destination_url text,
  add column if not exists approved_commercial_reference jsonb;

alter table public.local_business_audit_reports
  add column if not exists outreach_identity_fingerprint text;
update public.local_business_audit_reports as r
set outreach_identity_fingerprint = md5((to_jsonb(r) - 'outreach_identity_fingerprint')::text)
where r.outreach_identity_fingerprint is null;

create or replace function public.set_audit_identity_fingerprint() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  new.outreach_identity_fingerprint := md5((to_jsonb(new) - 'outreach_identity_fingerprint')::text);
  return new;
end; $$;
drop trigger if exists set_audit_identity_fingerprint on public.local_business_audit_reports;
create trigger set_audit_identity_fingerprint before insert or update on public.local_business_audit_reports
for each row execute function public.set_audit_identity_fingerprint();

alter table public.opportunity_outreach_send_claims
  add column if not exists historical_classification text not null default 'legacy_unclassified',
  add column if not exists historical_metadata jsonb not null default '{}'::jsonb;
alter table public.opportunity_outreach_send_claims
  drop constraint if exists opportunity_outreach_send_claims_historical_classification_chk;
alter table public.opportunity_outreach_send_claims
  add constraint opportunity_outreach_send_claims_historical_classification_chk
  check (historical_classification in ('legacy_sent','legacy_uncertain','legacy_incomplete','legacy_unclassified'));

-- Legacy rows are never silently retryable. Classification is explicit and
-- deliberately conservative when immutable evidence is absent.
-- PR #19 installs an immutable legacy-claim trigger before this migration.
-- The classification is reconciliation metadata, not a delivery-state edit;
-- allow only this transaction-local migration setting through that trigger.
create or replace function public.guard_scenario_send_claim_history() returns trigger
language plpgsql security invoker set search_path=public as $$
begin
  if current_setting('app.outreach_reconciliation', true) = 'on' then return new; end if;
  if tg_op='DELETE' then raise exception 'send_claim_history_immutable'; end if;
  if tg_op='UPDATE' and ((to_jsonb(new)-array['state','completed_at']) is distinct from (to_jsonb(old)-array['state','completed_at']) or old.state='sent' or new.state not in ('sent','uncertain')) then
    raise exception 'send_claim_history_immutable';
  end if;
  return new;
end; $$;
select set_config('app.outreach_reconciliation', 'on', true);
update public.opportunity_outreach_send_claims
set historical_classification = case
  when state = 'sent' then 'legacy_sent'
  when state = 'uncertain' then 'legacy_uncertain'
  else 'legacy_incomplete'
end
where historical_classification = 'legacy_unclassified';
select set_config('app.outreach_reconciliation', 'off', true);

create table if not exists public.opportunity_outreach_send_attempts (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid,
  draft_id uuid not null references public.local_business_outreach_drafts(id) on delete restrict,
  attempt_id uuid not null unique,
  state text not null check (state in ('claimed','sending','sent','send_unknown','failed')),
  current_assessment_id uuid references public.local_business_lead_assessments(id) on delete restrict,
  scenario_id uuid references public.opportunity_scenarios(id) on delete restrict,
  scenario_report_id uuid references public.opportunity_scenario_reports(id) on delete restrict,
  scenario_report_fingerprint text,
  audit_report_id uuid references public.local_business_audit_reports(id) on delete restrict,
  audit_report_fingerprint text,
  approval_fingerprint text not null check (approval_fingerprint ~ '^[0-9a-f]{64}$'),
  send_snapshot jsonb not null check (jsonb_typeof(send_snapshot) = 'object'),
  recipient text not null,
  destination_url text not null,
  claimed_at timestamptz not null default now(),
  sending_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz not null,
  smtp_accepted boolean,
  last_error text,
  retry_authorized boolean not null default false,
  recovery_reason text,
  reconciled_at timestamptz,
  reconciled_by text,
  created_at timestamptz not null default now()
);
create unique index if not exists opportunity_outreach_send_attempts_active_idx
  on public.opportunity_outreach_send_attempts(draft_id)
  where state in ('claimed','sending','send_unknown');
create unique index if not exists opportunity_outreach_send_attempts_active_lead_idx
  on public.opportunity_outreach_send_attempts(lead_id)
  where state in ('claimed','sending','send_unknown');
create index if not exists opportunity_outreach_send_attempts_draft_idx
  on public.opportunity_outreach_send_attempts(draft_id, created_at desc);
create unique index if not exists local_business_outreach_drafts_id_lead_uidx
  on public.local_business_outreach_drafts(id, lead_id);
update public.opportunity_outreach_send_attempts a
set lead_id = d.lead_id
from public.local_business_outreach_drafts d
where d.id = a.draft_id and a.lead_id is null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname='opportunity_outreach_send_attempts_lead_fk') then
    alter table public.opportunity_outreach_send_attempts add constraint opportunity_outreach_send_attempts_lead_fk
      foreign key (lead_id) references public.local_business_leads(id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname='opportunity_outreach_send_attempts_lead_draft_chk') then
    alter table public.opportunity_outreach_send_attempts add constraint opportunity_outreach_send_attempts_lead_draft_chk
      check (lead_id is not null);
  end if;
  if not exists (select 1 from pg_constraint where conname='opportunity_outreach_send_attempts_draft_lead_fk') then
    alter table public.opportunity_outreach_send_attempts add constraint opportunity_outreach_send_attempts_draft_lead_fk
      foreign key (draft_id, lead_id) references public.local_business_outreach_drafts(id, lead_id) on delete restrict;
  end if;
end $$;
alter table public.opportunity_outreach_send_attempts alter column lead_id set not null;
alter table public.opportunity_outreach_send_attempts enable row level security;
revoke all on public.opportunity_outreach_send_attempts from public, anon, authenticated, service_role;

-- Existing PR #19 approvals may predate the provenance contract. Clear only
-- unverifiable approval state, retain the draft, and record the reason in the
-- same transaction. The reconciliation setting lets this migration pass the
-- older draft guard without weakening it for normal application writes.
create or replace function public.guard_claimed_scenario_draft() returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
declare claim_state text;
begin
  if current_setting('app.outreach_reconciliation', true) = 'on' then return new; end if;
  select state into claim_state from public.opportunity_outreach_send_claims where draft_id=old.id;
  if found and (new.subject is distinct from old.subject or new.body is distinct from old.body or
    new.selection is distinct from old.selection or new.status='draft' or
    (new.status='sent' and claim_state<>'sent')) then raise exception 'send_claim_requires_reconciliation'; end if;
  return new;
end; $$;
-- The inherited parent/child guard also treats a legacy `sending` claim as an
-- active draft lock. DDL is transactional, so suspend only that one trigger
-- for the migration's controlled invalidation update and restore it before
-- this transaction can commit.
drop trigger if exists opportunity_guard_archived_child on public.local_business_outreach_drafts;
select set_config('app.outreach_reconciliation', 'on', true);
with invalidated as (
  update public.local_business_outreach_drafts
  set status='draft', approved_by=null, approved_at=null,
      approval_fingerprint=null, approved_audit_report_id=null,
      approved_billing_offer_id=null, approved_current_assessment_id=null,
      approved_scenario_report_id=null, approved_scenario_report_fingerprint=null,
      approved_scenario_report_references=null,
      approved_audit_report_fingerprint=null, approved_recipient=null,
      approved_destination_url=null, approved_commercial_reference=null,
      updated_at=now()
  where status='approved' and (
    approval_fingerprint is null or approved_current_assessment_id is null or
    approved_scenario_report_id is null or approved_scenario_report_fingerprint is null or
    approved_scenario_report_references is null or approved_billing_offer_id is null or
    approved_recipient is null or approved_destination_url is null or
    approved_commercial_reference is null or
    not exists (select 1 from public.local_business_lead_assessments a
      where a.id=local_business_outreach_drafts.approved_current_assessment_id
        and a.lead_id=local_business_outreach_drafts.lead_id)
  )
  returning id,lead_id
)
insert into public.opportunity_console_audit_log(action,lead_id,draft_id,actor,metadata)
select 'outreach_approval_invalidated',lead_id,id,'migration',
       jsonb_build_object('reason','legacy_approval_missing_or_incomplete_provenance')
from invalidated;
select set_config('app.outreach_reconciliation', 'off', true);
create trigger opportunity_guard_archived_child before insert or update or delete on public.local_business_outreach_drafts
for each row execute function public.opportunity_guard_archived_child();

alter table public.local_business_outreach_drafts
  drop constraint if exists local_business_outreach_drafts_approval_reconciliation_chk;
alter table public.local_business_outreach_drafts
  add constraint local_business_outreach_drafts_approval_reconciliation_chk check (
    status <> 'approved' or (
      approval_fingerprint ~ '^[0-9a-f]{64}$' and
      approved_current_assessment_id is not null and
      approved_scenario_report_id is not null and
      approved_scenario_report_fingerprint is not null and
      approved_scenario_report_references is not null and
      approved_billing_offer_id is not null and
      approved_recipient is not null and
      approved_destination_url like 'https://%' and
      approved_commercial_reference is not null
    )
  );

do $$ begin
  if not exists (select 1 from pg_constraint where conname='local_business_outreach_drafts_approved_assessment_fk') then
    alter table public.local_business_outreach_drafts add constraint local_business_outreach_drafts_approved_assessment_fk
      foreign key (approved_current_assessment_id) references public.local_business_lead_assessments(id) on delete restrict;
  end if;
end $$;

create or replace function public.guard_canonical_outreach_draft_lock() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if exists (select 1 from public.opportunity_outreach_send_attempts where draft_id=old.id and state in ('claimed','sending','send_unknown')) then
    raise exception 'outreach_send_in_progress' using errcode='55006';
  end if;
  if old.status='sent' and (to_jsonb(new)-array['cockpit_handoff_status','cockpit_contact_id','cockpit_handoff_error','cockpit_handed_off_at','updated_at']) is distinct from (to_jsonb(old)-array['cockpit_handoff_status','cockpit_contact_id','cockpit_handoff_error','cockpit_handed_off_at','updated_at']) then
    raise exception 'outreach_draft_sent_read_only' using errcode='55006';
  end if;
  return new;
end; $$;
drop trigger if exists guard_canonical_outreach_draft_lock on public.local_business_outreach_drafts;
create trigger guard_canonical_outreach_draft_lock before update on public.local_business_outreach_drafts for each row execute function public.guard_canonical_outreach_draft_lock();

create or replace function public.guard_canonical_outreach_parent() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if exists (select 1 from public.opportunity_outreach_send_attempts where lead_id=old.id and state in ('claimed','sending','send_unknown'))
     and (to_jsonb(new)-'updated_at') is distinct from (to_jsonb(old)-'updated_at') then
    raise exception 'send_in_progress' using errcode='P0001';
  end if;
  return new;
end; $$;
drop trigger if exists guard_canonical_outreach_parent on public.local_business_leads;
create trigger guard_canonical_outreach_parent before update on public.local_business_leads
for each row execute function public.guard_canonical_outreach_parent();

-- Retire every known legacy entry point. Keeping the signatures but failing
-- closed protects deployment ordering and prevents an old worker from sending.
create or replace function public.claim_scenario_outreach_send(p_draft_id uuid,p_lead_id uuid,p_subject text,p_body text,p_selection jsonb,p_updated_at timestamptz,p_expected_email text,p_send_metadata jsonb)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin raise exception 'legacy_send_path_disabled'; end; $$;
create or replace function public.complete_scenario_outreach_send(p_lead_id uuid,p_draft_id uuid,p_sent boolean,p_detail text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin raise exception 'legacy_send_path_disabled'; end; $$;
revoke all on function public.claim_scenario_outreach_send(uuid,uuid,text,text,jsonb,timestamptz,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.complete_scenario_outreach_send(uuid,uuid,boolean,text) from public,anon,authenticated,service_role;

create or replace function public.opportunity_claim_outreach_send(
  p_draft_id uuid, p_attempt_id uuid, p_approval_fingerprint text,
  p_current_assessment_id uuid, p_scenario_id uuid, p_scenario_report_id uuid,
  p_scenario_report_fingerprint text, p_audit_report_id uuid,
  p_audit_report_fingerprint text, p_recipient text, p_destination_url text,
  p_snapshot jsonb, p_claim_ttl_seconds integer default 120
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  d public.local_business_outreach_drafts%rowtype;
  a public.opportunity_outreach_send_attempts%rowtype;
  ar public.opportunity_scenario_reports%rowtype;
  audit_row public.local_business_audit_reports%rowtype;
  latest_assessment uuid;
  template_offer text;
  template_destination text;
  report_ref record;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_draft_id::text,0));
  select * into d from public.local_business_outreach_drafts where id=p_draft_id for update;
  if not found then return jsonb_build_object('ok',false,'error','draft_not_found'); end if;
  if d.status='sent' or d.sent_at is not null then return jsonb_build_object('ok',false,'error','already_sent'); end if;
  if d.status<>'approved' then return jsonb_build_object('ok',false,'error','not_approved'); end if;
  if d.lead_id is distinct from (p_snapshot->>'lead_id')::uuid
     or p_snapshot->>'approval_fingerprint' is distinct from p_approval_fingerprint
     or p_snapshot->>'recipient' is distinct from p_recipient
     or p_snapshot->>'destination_url' is distinct from p_destination_url
     or p_snapshot->>'subject' is distinct from coalesce(d.subject,'')
     or p_snapshot->>'body' is distinct from coalesce(d.body,'')
     or p_snapshot->'billing' is distinct from d.approved_commercial_reference
     or p_snapshot->'scenario_report_references' is distinct from coalesce(d.approved_scenario_report_references,'[]'::jsonb)
  then return jsonb_build_object('ok',false,'error','approval_snapshot_stale'); end if;
  if d.approval_fingerprint is distinct from p_approval_fingerprint
     or d.approved_current_assessment_id is distinct from p_current_assessment_id
     or d.approved_scenario_report_id is distinct from p_scenario_report_id
     or d.approved_scenario_report_fingerprint is distinct from p_scenario_report_fingerprint
     or d.approved_audit_report_id is distinct from p_audit_report_id
     or d.approved_audit_report_fingerprint is distinct from p_audit_report_fingerprint
     or d.approved_recipient is distinct from p_recipient
     or d.approved_destination_url is distinct from p_destination_url
     or p_snapshot is null
     or p_snapshot->>'subject' is distinct from coalesce(d.subject,'')
     or p_snapshot->>'body' is distinct from coalesce(d.body,'')
  then return jsonb_build_object('ok',false,'error','approval_snapshot_stale'); end if;
  select id into latest_assessment from public.local_business_lead_assessments
  where lead_id=d.lead_id order by assessed_at desc limit 1;
  if latest_assessment is distinct from p_current_assessment_id then return jsonb_build_object('ok',false,'error','assessment_stale'); end if;
  if p_scenario_report_id is null or p_scenario_report_fingerprint is null then return jsonb_build_object('ok',false,'error','scenario_report_required'); end if;
  select * into ar from public.opportunity_scenario_reports
  where id=p_scenario_report_id and lead_id=d.lead_id and assessment_id=p_current_assessment_id
    and scenario_id=p_scenario_id and fingerprint=p_scenario_report_fingerprint;
  if not found then return jsonb_build_object('ok',false,'error','scenario_report_identity_mismatch'); end if;
  if p_snapshot->'billing'->'catalogue'->0->>'id' is distinct from ar.report->'offer'->>'id'
     or p_snapshot->'billing'->'catalogue'->0->>'price_version' is distinct from ar.report->'offer'->>'price_version'
     or p_snapshot->'billing'->'catalogue'->0->>'destination' is distinct from ar.report->'offer'->>'destination' then
    return jsonb_build_object('ok',false,'error','commercial_snapshot_mismatch');
  end if;
  if exists (select 1 from public.opportunity_scenario_reports newer
    where newer.lead_id=ar.lead_id and newer.assessment_id=ar.assessment_id
      and newer.scenario_id=ar.scenario_id and newer.created_at>ar.created_at) then
    return jsonb_build_object('ok',false,'error','scenario_report_superseded');
  end if;
  if jsonb_typeof(p_snapshot->'scenario_report_references') <> 'array' or jsonb_array_length(p_snapshot->'scenario_report_references') = 0 then
    return jsonb_build_object('ok',false,'error','scenario_report_references_required');
  end if;
  for report_ref in select * from jsonb_to_recordset(p_snapshot->'scenario_report_references') as refs(id uuid,scenario_id uuid,fingerprint text) loop
    if not exists (select 1 from public.opportunity_scenario_reports r
      where r.id=report_ref.id and r.lead_id=d.lead_id and r.assessment_id=p_current_assessment_id
        and r.scenario_id=report_ref.scenario_id and r.fingerprint=report_ref.fingerprint) then
      return jsonb_build_object('ok',false,'error','scenario_report_identity_mismatch');
    end if;
    if exists (select 1 from public.opportunity_scenario_reports newer
      where newer.lead_id=d.lead_id and newer.assessment_id=p_current_assessment_id
        and newer.scenario_id=report_ref.scenario_id and newer.created_at >
          (select r.created_at from public.opportunity_scenario_reports r where r.id=report_ref.id)) then
      return jsonb_build_object('ok',false,'error','scenario_report_superseded');
    end if;
  end loop;
  if p_audit_report_id is not null then
    select * into audit_row from public.local_business_audit_reports
    where id=p_audit_report_id and lead_id=d.lead_id and assessment_id=p_current_assessment_id
      and outreach_identity_fingerprint=p_audit_report_fingerprint;
    if not found then return jsonb_build_object('ok',false,'error','audit_report_identity_mismatch'); end if;
  elsif d.approved_audit_report_id is not null then
    return jsonb_build_object('ok',false,'error','audit_report_required');
  end if;
  begin
    select offer_id,destination into template_offer,template_destination
    from public.opportunity_outreach_templates where id=(d.selection->>'template_id')::uuid and enabled=true;
  exception when invalid_text_representation then
    return jsonb_build_object('ok',false,'error','commercial_reference_invalid');
  end;
  if template_offer is null or template_offer is distinct from d.approved_billing_offer_id
     or template_destination is distinct from p_destination_url
     or d.selection->>'offer_id' is distinct from template_offer
     or d.selection->>'destination' is distinct from template_destination then
    return jsonb_build_object('ok',false,'error','commercial_reference_invalid');
  end if;
  perform set_config('app.outreach_attempt_rpc','on',true);
  select * into a from public.opportunity_outreach_send_attempts where draft_id=p_draft_id and state in ('claimed','sending','send_unknown') order by created_at desc limit 1 for update;
  if found then return jsonb_build_object('ok',false,'error',case when a.state='send_unknown' then 'send_unknown' else 'send_in_progress' end,'attempt_id',a.attempt_id); end if;
  insert into public.opportunity_outreach_send_attempts(
    lead_id,draft_id,attempt_id,state,current_assessment_id,scenario_id,scenario_report_id,
    scenario_report_fingerprint,audit_report_id,audit_report_fingerprint,
    approval_fingerprint,send_snapshot,recipient,destination_url,expires_at)
  values (d.lead_id,p_draft_id,p_attempt_id,'claimed',p_current_assessment_id,p_scenario_id,p_scenario_report_id,
    p_scenario_report_fingerprint,p_audit_report_id,p_audit_report_fingerprint,p_approval_fingerprint,
    p_snapshot,p_recipient,p_destination_url,now()+make_interval(secs=>greatest(30,least(p_claim_ttl_seconds,900))));
  return jsonb_build_object('ok',true,'state','claimed','attempt_id',p_attempt_id);
exception when unique_violation then return jsonb_build_object('ok',false,'error','send_in_progress');
end; $$;

create or replace function public.opportunity_start_outreach_send(p_draft_id uuid,p_attempt_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform set_config('app.outreach_attempt_rpc','on',true);
  update public.opportunity_outreach_send_attempts set state='sending',sending_at=now(),expires_at=now()
  where draft_id=p_draft_id and attempt_id=p_attempt_id and state='claimed' and expires_at>now();
  if not found then return jsonb_build_object('ok',false,'error','claim_not_available'); end if;
  return jsonb_build_object('ok',true,'state','sending','attempt_id',p_attempt_id);
end; $$;

create or replace function public.opportunity_finish_outreach_send(p_draft_id uuid,p_attempt_id uuid,p_state text,p_error text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.local_business_outreach_drafts%rowtype; previous_state text; now_at timestamptz := now(); v_actor text;
begin
  if p_state not in ('sent','send_unknown','failed') then return jsonb_build_object('ok',false,'error','invalid_attempt_state'); end if;
  perform set_config('app.outreach_attempt_rpc','on',true);
  select * into d from public.local_business_outreach_drafts where id=p_draft_id for update;
  if not found then return jsonb_build_object('ok',false,'error','draft_not_found'); end if;
  select state into previous_state from public.opportunity_outreach_send_attempts where draft_id=p_draft_id and attempt_id=p_attempt_id for update;
  if previous_state is distinct from 'sending' then return jsonb_build_object('ok',false,'error','attempt_not_active'); end if;
  v_actor := coalesce(nullif(current_setting('request.jwt.claim.sub',true),''), nullif(current_setting('request.jwt.claim.role',true),''), session_user);
  update public.opportunity_outreach_send_attempts set state=p_state,completed_at=now(),smtp_accepted=case when p_state='sent' then true when p_state='failed' then false else null end,last_error=nullif(left(p_error,500),'')
  where draft_id=p_draft_id and attempt_id=p_attempt_id and state='sending';
  if not found then return jsonb_build_object('ok',false,'error','attempt_not_active'); end if;
  if p_state='sent' then update public.local_business_outreach_drafts set status='sent',sent_at=coalesce(sent_at,now_at),updated_at=now_at where id=p_draft_id returning * into d; end if;
  insert into public.opportunity_console_audit_log(action,lead_id,draft_id,actor,metadata)
  values (case when p_state='sent' then 'outreach_sent' when p_state='send_unknown' then 'outreach_send_uncertain' else 'outreach_send_failed' end,d.lead_id,d.id,v_actor,
    jsonb_build_object('attempt_id',p_attempt_id,'previous_state',previous_state,'new_state',p_state,'occurred_at',now_at,'reason',left(p_error,500)));
  return jsonb_build_object('ok',true,'state',p_state,'draft',to_jsonb(d));
end; $$;

create or replace function public.opportunity_recover_outreach_send(p_draft_id uuid,p_attempt_id uuid,p_lease_seconds integer default 300)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.opportunity_outreach_send_attempts%rowtype; d public.local_business_outreach_drafts%rowtype; previous_state text; now_at timestamptz := now(); v_role text; v_actor text;
begin
  v_role := coalesce(nullif(current_setting('request.jwt.claim.role',true),''), session_user);
  v_actor := coalesce(nullif(current_setting('request.jwt.claim.sub',true),''), v_role);
  if v_role not in ('service_role','postgres') then return jsonb_build_object('ok',false,'error','unauthorized'); end if;
  perform set_config('app.outreach_attempt_rpc','on',true);
  perform pg_advisory_xact_lock(hashtextextended(p_draft_id::text,0));
  select * into a from public.opportunity_outreach_send_attempts where draft_id=p_draft_id and attempt_id=p_attempt_id for update;
  if not found then return jsonb_build_object('ok',false,'error','attempt_not_found'); end if;
  if a.state='claimed' and a.expires_at<=now() then
    previous_state := a.state;
    select * into d from public.local_business_outreach_drafts where id=p_draft_id for update;
    update public.opportunity_outreach_send_attempts set state='failed',completed_at=now(),recovery_reason='claim_expired_before_transport',last_error='Claim expired before SMTP transport started.' where id=a.id;
    insert into public.opportunity_console_audit_log(action,lead_id,draft_id,actor,metadata) values ('outreach_send_recovered',d.lead_id,d.id,v_actor,jsonb_build_object('attempt_id',p_attempt_id,'previous_state',previous_state,'new_state','failed','occurred_at',now_at,'reason','claim_expired_before_transport'));
    return jsonb_build_object('ok',true,'state','failed','retry_requires_new_attempt',true);
  end if;
  if a.state='sending' and coalesce(a.sending_at,a.claimed_at)<now()-make_interval(secs=>greatest(60,least(p_lease_seconds,86400))) then
    previous_state := a.state;
    select * into d from public.local_business_outreach_drafts where id=p_draft_id for update;
    update public.opportunity_outreach_send_attempts set state='send_unknown',completed_at=now(),recovery_reason='transport_lease_expired',last_error='Transport lease expired; SMTP outcome is unknown.' where id=a.id and state='sending';
    insert into public.opportunity_console_audit_log(action,lead_id,draft_id,actor,metadata) values ('outreach_send_recovered',d.lead_id,d.id,v_actor,jsonb_build_object('attempt_id',p_attempt_id,'previous_state',previous_state,'new_state','send_unknown','occurred_at',now_at,'reason','transport_lease_expired'));
    return jsonb_build_object('ok',true,'state','send_unknown','retryable',false);
  end if;
  return jsonb_build_object('ok',false,'error','attempt_not_expired');
end; $$;

create or replace function public.opportunity_reconcile_outreach_send(p_draft_id uuid,p_attempt_id uuid,p_outcome text,p_actor text,p_reason text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.opportunity_outreach_send_attempts%rowtype; d public.local_business_outreach_drafts%rowtype; previous_state text; now_at timestamptz := now(); v_role text; v_actor text;
begin
  v_role := coalesce(nullif(current_setting('request.jwt.claim.role',true),''), session_user);
  v_actor := coalesce(nullif(current_setting('request.jwt.claim.sub',true),''), v_role);
  if v_role not in ('service_role','postgres') then return jsonb_build_object('ok',false,'error','unauthorized'); end if;
  if nullif(btrim(p_actor),'') is not null and btrim(p_actor) <> v_actor then return jsonb_build_object('ok',false,'error','actor_mismatch'); end if;
  if nullif(btrim(p_reason),'') is null or length(btrim(p_reason))>500 then return jsonb_build_object('ok',false,'error','reconciliation_reason_required'); end if;
  if p_outcome not in ('confirmed_sent','confirmed_not_sent','still_unknown') then return jsonb_build_object('ok',false,'error','invalid_reconciliation_outcome'); end if;
  perform pg_advisory_xact_lock(hashtextextended(p_draft_id::text,0));
  select * into a from public.opportunity_outreach_send_attempts where draft_id=p_draft_id and attempt_id=p_attempt_id for update;
  if not found or a.state<>'send_unknown' then return jsonb_build_object('ok',false,'error','attempt_not_reconcilable'); end if;
  if a.reconciled_at is not null and p_outcome='still_unknown' then return jsonb_build_object('ok',false,'error','reconciliation_already_recorded'); end if;
  previous_state := a.state;
  select * into d from public.local_business_outreach_drafts where id=p_draft_id for update;
  perform set_config('app.outreach_attempt_rpc','on',true);
  if p_outcome='confirmed_sent' then
    update public.opportunity_outreach_send_attempts set state='sent',completed_at=now_at,smtp_accepted=true,reconciled_at=now_at,reconciled_by=v_actor,recovery_reason=left(btrim(p_reason),500) where id=a.id;
    update public.local_business_outreach_drafts set status='sent',sent_at=coalesce(sent_at,now_at),updated_at=now_at where id=p_draft_id returning * into d;
  elsif p_outcome='confirmed_not_sent' then
    update public.opportunity_outreach_send_attempts set state='failed',completed_at=now_at,retry_authorized=true,reconciled_at=now_at,reconciled_by=v_actor,recovery_reason=left(btrim(p_reason),500) where id=a.id;
  else
    update public.opportunity_outreach_send_attempts set reconciled_at=now_at,reconciled_by=v_actor,recovery_reason=left(btrim(p_reason),500) where id=a.id;
  end if;
  insert into public.opportunity_console_audit_log(action,lead_id,draft_id,actor,metadata)
  values ('outreach_send_reconciled',d.lead_id,d.id,v_actor,jsonb_build_object('attempt_id',p_attempt_id,'previous_state',previous_state,'outcome',p_outcome,'occurred_at',now_at,'reason',left(btrim(p_reason),500)));
  return jsonb_build_object('ok',true,'state',case when p_outcome='confirmed_sent' then 'sent' when p_outcome='confirmed_not_sent' then 'failed' else 'send_unknown' end);
end; $$;

create or replace function public.guard_outreach_attempt_history() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if current_setting('app.outreach_attempt_rpc', true) <> 'on' then raise exception 'send_attempt_direct_mutation_disabled' using errcode='42501'; end if;
  if tg_op='DELETE' then raise exception 'send_attempt_history_immutable' using errcode='42501'; end if;
  if tg_op='UPDATE' and (to_jsonb(new)-array['state','sending_at','completed_at','expires_at','smtp_accepted','last_error','retry_authorized','recovery_reason','reconciled_at','reconciled_by']) is distinct from (to_jsonb(old)-array['state','sending_at','completed_at','expires_at','smtp_accepted','last_error','retry_authorized','recovery_reason','reconciled_at','reconciled_by']) then raise exception 'send_attempt_snapshot_immutable' using errcode='42501'; end if;
  return new;
end; $$;
drop trigger if exists opportunity_guard_attempt_history on public.opportunity_outreach_send_attempts;
create trigger opportunity_guard_attempt_history before insert or update or delete on public.opportunity_outreach_send_attempts for each row execute function public.guard_outreach_attempt_history();
drop trigger if exists opportunity_guard_attempt_retained_truncate on public.opportunity_outreach_send_attempts;
create trigger opportunity_guard_attempt_retained_truncate before truncate on public.opportunity_outreach_send_attempts for each statement execute function public.opportunity_guard_retained_truncate();

revoke all on function public.opportunity_claim_outreach_send(uuid,uuid,text,uuid,uuid,uuid,text,uuid,text,text,text,jsonb,integer) from public,anon,authenticated;
revoke all on function public.opportunity_start_outreach_send(uuid,uuid) from public,anon,authenticated;
revoke all on function public.opportunity_finish_outreach_send(uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.opportunity_recover_outreach_send(uuid,uuid,integer) from public,anon,authenticated;
revoke all on function public.opportunity_reconcile_outreach_send(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.opportunity_claim_outreach_send(uuid,uuid,text,uuid,uuid,uuid,text,uuid,text,text,text,jsonb,integer) to service_role;
grant execute on function public.opportunity_start_outreach_send(uuid,uuid) to service_role;
grant execute on function public.opportunity_finish_outreach_send(uuid,uuid,text,text) to service_role;
grant execute on function public.opportunity_recover_outreach_send(uuid,uuid,integer) to service_role;
grant execute on function public.opportunity_reconcile_outreach_send(uuid,uuid,text,text,text) to service_role;

commit;

-- No rollback is supplied: clearing approval provenance or deleting either
-- ledger would destroy accountability and cannot be reconstructed.
