-- Round 8 P1-01: make the canonical send ledger a database invariant.
-- This migration is forward-only. Existing sent history is not rewritten.
begin;

create or replace function public.guard_canonical_sent_transition()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_attempt_id uuid;
  a public.opportunity_outreach_send_attempts%rowtype;
begin
  -- Already-sent rows are governed by the existing read-only guard. This guard
  -- protects every transition into sent, including direct INSERTs.
  if new.status <> 'sent' or (tg_op = 'UPDATE' and old.status = 'sent') then
    return new;
  end if;

  -- Only the canonical SECURITY DEFINER completion/reconciliation functions
  -- run as the function owner (postgres). A caller-supplied GUC alone is not
  -- authority: direct service_role/authenticated table writes remain denied.
  if current_user <> 'postgres' then
    raise exception 'canonical_send_transition_required' using errcode = '42501';
  end if;

  begin
    v_attempt_id := nullif(current_setting('app.canonical_outreach_attempt_id', true), '')::uuid;
  exception when invalid_text_representation then
    raise exception 'canonical_send_attempt_invalid' using errcode = '42501';
  end;
  if v_attempt_id is null then
    raise exception 'canonical_send_attempt_required' using errcode = '42501';
  end if;

  select * into a
  from public.opportunity_outreach_send_attempts
  where attempt_id = v_attempt_id
    and draft_id = new.id
    and lead_id = new.lead_id;
  if not found or a.state <> 'sent' or a.completed_at is null or a.smtp_accepted is not true then
    raise exception 'canonical_send_attempt_not_finalised' using errcode = '42501';
  end if;

  if a.approval_fingerprint is distinct from new.approval_fingerprint
     or a.recipient is distinct from new.approved_recipient
     or a.destination_url is distinct from new.approved_destination_url
     or a.send_snapshot->>'approval_fingerprint' is distinct from a.approval_fingerprint
     or a.send_snapshot->>'recipient' is distinct from a.recipient
     or a.send_snapshot->>'destination_url' is distinct from a.destination_url
     or a.send_snapshot->>'lead_id' is distinct from new.lead_id::text
     or a.send_snapshot->>'subject' is distinct from coalesce(new.subject, '')
     or a.send_snapshot->>'body' is distinct from coalesce(new.body, '')
  then
    raise exception 'canonical_send_snapshot_mismatch' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_canonical_sent_transition on public.local_business_outreach_drafts;
create trigger guard_canonical_sent_transition
before insert or update on public.local_business_outreach_drafts
for each row execute function public.guard_canonical_sent_transition();

-- The marker is transaction-local and is set only immediately before the
-- canonical function performs its matching draft transition. The trigger is
-- SECURITY INVOKER, so normal service_role table writes cannot impersonate it;
-- the postgres owner remains an explicit operational trust boundary.
create or replace function public.opportunity_finish_outreach_send(
  p_draft_id uuid,
  p_attempt_id uuid,
  p_state text,
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  d public.local_business_outreach_drafts%rowtype;
  previous_state text;
  now_at timestamptz := now();
  v_actor text;
begin
  if p_state not in ('sent','send_unknown','failed') then
    return jsonb_build_object('ok',false,'error','invalid_attempt_state');
  end if;
  perform set_config('app.outreach_attempt_rpc','on',true);
  select * into d from public.local_business_outreach_drafts where id=p_draft_id for update;
  if not found then return jsonb_build_object('ok',false,'error','draft_not_found'); end if;
  select state into previous_state
  from public.opportunity_outreach_send_attempts
  where draft_id=p_draft_id and attempt_id=p_attempt_id for update;
  if previous_state is distinct from 'sending' then
    return jsonb_build_object('ok',false,'error','attempt_not_active');
  end if;
  v_actor := coalesce(nullif(current_setting('request.jwt.claim.sub',true),''), nullif(current_setting('request.jwt.claim.role',true),''), session_user);
  update public.opportunity_outreach_send_attempts
  set state=p_state,
      completed_at=now(),
      smtp_accepted=case when p_state='sent' then true when p_state='failed' then false else null end,
      last_error=nullif(left(p_error,500),'')
  where draft_id=p_draft_id and attempt_id=p_attempt_id and state='sending';
  if not found then return jsonb_build_object('ok',false,'error','attempt_not_active'); end if;
  if p_state='sent' then
    perform set_config('app.canonical_outreach_attempt_id', p_attempt_id::text, true);
    update public.local_business_outreach_drafts
    set status='sent',sent_at=coalesce(sent_at,now_at),updated_at=now_at
    where id=p_draft_id returning * into d;
  end if;
  insert into public.opportunity_console_audit_log(action,lead_id,draft_id,actor,metadata)
  values (case when p_state='sent' then 'outreach_sent' when p_state='send_unknown' then 'outreach_send_uncertain' else 'outreach_send_failed' end,d.lead_id,d.id,v_actor,
    jsonb_build_object('attempt_id',p_attempt_id,'previous_state',previous_state,'new_state',p_state,'occurred_at',now_at,'reason',left(p_error,500)));
  return jsonb_build_object('ok',true,'state',p_state,'draft',to_jsonb(d));
end;
$$;

create or replace function public.opportunity_reconcile_outreach_send(
  p_draft_id uuid,
  p_attempt_id uuid,
  p_outcome text,
  p_actor text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  a public.opportunity_outreach_send_attempts%rowtype;
  d public.local_business_outreach_drafts%rowtype;
  previous_state text;
  now_at timestamptz := now();
  v_role text;
  v_actor text;
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
    update public.opportunity_outreach_send_attempts
    set state='sent',completed_at=now_at,smtp_accepted=true,reconciled_at=now_at,reconciled_by=v_actor,recovery_reason=left(btrim(p_reason),500)
    where id=a.id;
    perform set_config('app.canonical_outreach_attempt_id', p_attempt_id::text, true);
    update public.local_business_outreach_drafts
    set status='sent',sent_at=coalesce(sent_at,now_at),updated_at=now_at
    where id=p_draft_id returning * into d;
  elsif p_outcome='confirmed_not_sent' then
    update public.opportunity_outreach_send_attempts
    set state='failed',completed_at=now_at,retry_authorized=true,reconciled_at=now_at,reconciled_by=v_actor,recovery_reason=left(btrim(p_reason),500)
    where id=a.id;
  else
    update public.opportunity_outreach_send_attempts
    set reconciled_at=now_at,reconciled_by=v_actor,recovery_reason=left(btrim(p_reason),500)
    where id=a.id;
  end if;
  insert into public.opportunity_console_audit_log(action,lead_id,draft_id,actor,metadata)
  values ('outreach_send_reconciled',d.lead_id,d.id,v_actor,jsonb_build_object('attempt_id',p_attempt_id,'previous_state',previous_state,'outcome',p_outcome,'occurred_at',now_at,'reason',left(btrim(p_reason),500)));
  return jsonb_build_object('ok',true,'state',case when p_outcome='confirmed_sent' then 'sent' when p_outcome='confirmed_not_sent' then 'failed' else 'send_unknown' end);
end;
$$;

-- Pin the trusted execution boundary for the transition functions. The hosted
-- migration runner executes as postgres; a normal runtime role cannot become
-- the function owner or satisfy the trigger's SECURITY INVOKER check.
alter function public.opportunity_finish_outreach_send(uuid,uuid,text,text) owner to postgres;
alter function public.opportunity_reconcile_outreach_send(uuid,uuid,text,text,text) owner to postgres;

comment on function public.guard_canonical_sent_transition() is
  'Rejects every non-historical draft transition into sent unless canonical attempt completion authorizes it.';

commit;
