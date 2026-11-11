begin;
-- Apply after the reviewed #10, #16 and #17 migrations. Retain their identifiers and history.
create trigger opportunity_guard_archived_child before insert or update or delete on public.opportunity_scenario_reports
for each row execute function public.opportunity_guard_archived_child();
create trigger opportunity_guard_archived_child before insert or update or delete on public.opportunity_company_scenarios
for each row execute function public.opportunity_guard_archived_child();

alter table public.opportunity_outreach_send_claims
  add column state text not null default 'uncertain' check(state in ('sending','uncertain','sent')),
  add column send_metadata jsonb not null default '{}',
  add column completed_at timestamptz;
-- Historical attempts are never made retryable. Only a recorded sent draft establishes delivery.
update public.opportunity_outreach_send_claims c set state='sent',completed_at=d.sent_at
from public.local_business_outreach_drafts d where d.id=c.draft_id and d.status='sent';

create function public.guard_scenario_send_claim_history() returns trigger language plpgsql security invoker set search_path=public as $$
begin
  if tg_op='DELETE' then raise exception 'send_claim_history_immutable'; end if;
  if tg_op='UPDATE' and ((to_jsonb(new)-array['state','completed_at']) is distinct from (to_jsonb(old)-array['state','completed_at']) or old.state='sent' or new.state not in ('sent','uncertain')) then
    raise exception 'send_claim_history_immutable';
  end if;
  return new;
end; $$;
revoke all on function public.guard_scenario_send_claim_history() from public,anon,authenticated;
grant execute on function public.guard_scenario_send_claim_history() to service_role;
create trigger guard_scenario_send_claim_history before update or delete on public.opportunity_outreach_send_claims
for each row execute function public.guard_scenario_send_claim_history();

create function public.guard_scenario_send_parent() returns trigger language plpgsql security invoker set search_path=public as $$
begin
  if exists(select 1 from public.opportunity_outreach_send_claims where lead_id=old.id and state<>'sent') and
    (to_jsonb(new)-'updated_at') is distinct from (to_jsonb(old)-'updated_at') then raise exception 'send_in_progress'; end if;
  return new;
end; $$;
revoke all on function public.guard_scenario_send_parent() from public,anon,authenticated;
grant execute on function public.guard_scenario_send_parent() to service_role;
create trigger guard_scenario_send_parent before update on public.local_business_leads
for each row execute function public.guard_scenario_send_parent();

create or replace function public.guard_claimed_scenario_draft() returns trigger language plpgsql security invoker set search_path=public as $$
declare claim_state text;
begin
  select state into claim_state from public.opportunity_outreach_send_claims where draft_id=old.id;
  if found and (new.subject is distinct from old.subject or new.body is distinct from old.body or
    new.selection is distinct from old.selection or new.status='draft' or
    (new.status='sent' and claim_state<>'sent')) then raise exception 'send_claim_requires_reconciliation'; end if;
  return new;
end; $$;

-- A legacy caller cannot send without binding the recipient and durable metadata.
drop function public.claim_scenario_outreach_send(uuid,uuid,text,text,jsonb,timestamptz);
create function public.claim_scenario_outreach_send(p_draft_id uuid,p_lead_id uuid,p_subject text,p_body text,p_selection jsonb,p_updated_at timestamptz,p_expected_email text,p_send_metadata jsonb)
returns void language plpgsql security invoker set search_path=public as $$
declare d public.local_business_outreach_drafts; l public.local_business_leads;
begin
  select * into d from public.local_business_outreach_drafts where id=p_draft_id and lead_id=p_lead_id for update;
  if not found then raise exception 'reviewed_draft_changed'; end if;
  select * into l from public.local_business_leads where id=p_lead_id for update;
  if not found or l.archived_at is not null or l.status in ('archived','disqualified') or l.enrichment_status='enriching' then raise exception 'opportunity_unavailable'; end if;
  if d.status<>'approved' or d.sent_at is not null or d.subject is distinct from p_subject or d.body is distinct from p_body or
    d.selection is distinct from p_selection or d.updated_at is distinct from p_updated_at or l.email is distinct from p_expected_email then
    raise exception 'reviewed_draft_changed';
  end if;
  if jsonb_typeof(p_send_metadata) is distinct from 'object' or nullif(p_send_metadata->>'recipient','') is null or
    jsonb_typeof(p_send_metadata->'live') is distinct from 'boolean' or jsonb_typeof(p_send_metadata->'overridden') is distinct from 'boolean' then raise exception 'send_metadata_required'; end if;
  if exists(select 1 from public.local_business_outreach_drafts where lead_id=p_lead_id and status='sent') then raise exception 'company_previously_contacted'; end if;
  insert into public.opportunity_outreach_send_claims(draft_id,lead_id,state,send_metadata)
    values(p_draft_id,p_lead_id,'sending',p_send_metadata);
  insert into public.opportunity_console_audit_log(action,lead_id,draft_id,actor,metadata)
    values('outreach_send_claimed',p_lead_id,p_draft_id,'operator-console',p_send_metadata);
end; $$;
revoke all on function public.claim_scenario_outreach_send(uuid,uuid,text,text,jsonb,timestamptz,text,jsonb) from public,anon,authenticated;
grant execute on function public.claim_scenario_outreach_send(uuid,uuid,text,text,jsonb,timestamptz,text,jsonb) to service_role;

create function public.complete_scenario_outreach_send(p_lead_id uuid,p_draft_id uuid,p_sent boolean,p_detail text default null)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare d public.local_business_outreach_drafts; c public.opportunity_outreach_send_claims;
begin
  if p_sent is null then raise exception 'send_outcome_required'; end if;
  select * into d from public.local_business_outreach_drafts where id=p_draft_id and lead_id=p_lead_id for update;
  perform id from public.local_business_leads where id=p_lead_id for update;
  select * into c from public.opportunity_outreach_send_claims where draft_id=p_draft_id and lead_id=p_lead_id for update;
  if not found then raise exception 'send_claim_required'; end if;
  if c.state='sent' or (c.state='uncertain' and not p_sent) then return jsonb_build_object('draft',to_jsonb(d),'state',c.state,'idempotent',true); end if;
  update public.opportunity_outreach_send_claims set state=case when p_sent then 'sent' else 'uncertain' end,
    completed_at=case when p_sent then now() else null end where draft_id=p_draft_id;
  if p_sent then update public.local_business_outreach_drafts set status='sent',sent_at=now() where id=p_draft_id returning * into d; end if;
  insert into public.opportunity_console_audit_log(action,lead_id,draft_id,actor,metadata)
    values(case when p_sent then 'outreach_sent' else 'outreach_send_failed' end,p_lead_id,p_draft_id,'operator-console',c.send_metadata || jsonb_build_object('detail',left(p_detail,500)));
  return jsonb_build_object('draft',to_jsonb(d),'state',case when p_sent then 'sent' else 'uncertain' end,'idempotent',false);
end; $$;
revoke all on function public.complete_scenario_outreach_send(uuid,uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.complete_scenario_outreach_send(uuid,uuid,boolean,text) to service_role;
commit;
