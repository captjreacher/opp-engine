begin;
-- PR #10's scenario/template registry is a prerequisite. No catalogue prices are copied into configuration.
alter table public.opportunity_outreach_templates
  add column approved_details jsonb,
  add column edit_phrases text[] not null default '{}';
comment on column public.opportunity_outreach_templates.approved_details is
  'Reviewed non-price commercial details: approved_at, inclusions string[], terms string[]. Prices and GST resolve live from Billing Kernel.';

create table public.opportunity_scenario_reports (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.local_business_leads(id),
  assessment_id uuid not null references public.local_business_lead_assessments(id),
  scenario_id uuid not null references public.opportunity_scenarios(id),
  fingerprint text not null unique check (fingerprint ~ '^[0-9a-f]{64}$'),
  report jsonb not null check(jsonb_typeof(report)='object'),
  created_at timestamptz not null default now()
);
create index opportunity_scenario_reports_assessment on public.opportunity_scenario_reports(lead_id,assessment_id);
alter table public.opportunity_scenario_reports enable row level security;
revoke all on public.opportunity_scenario_reports from public,anon,authenticated;
grant select,insert on public.opportunity_scenario_reports to service_role;

create function public.record_scenario_report_creation() returns trigger language plpgsql security invoker set search_path=public as $$
begin
  insert into public.opportunity_console_audit_log(action,lead_id,actor,metadata)
  values('scenario_report_prepared',new.lead_id,'opportunity-engine',
    jsonb_build_object('report_id',new.id,'assessment_id',new.assessment_id,
      'scenario_id',new.scenario_id,'template_version',new.report->>'template_version',
      'offer_id',new.report->'offer'->>'id','fingerprint',new.fingerprint));
  return new;
end; $$;
revoke all on function public.record_scenario_report_creation() from public,anon,authenticated;
grant execute on function public.record_scenario_report_creation() to service_role;
create trigger record_scenario_report_creation after insert on public.opportunity_scenario_reports
for each row execute function public.record_scenario_report_creation();

-- Atomic compare-and-claim binds the exact reviewed message to the send claim.
-- Existing unique lead_id and draft_id protections serialize all scenarios for one company.
create function public.claim_scenario_outreach_send(p_draft_id uuid,p_lead_id uuid,p_subject text,p_body text,p_selection jsonb,p_updated_at timestamptz)
returns void language plpgsql security invoker set search_path=public as $$
declare d public.local_business_outreach_drafts;
begin
  select * into d from public.local_business_outreach_drafts where id=p_draft_id and lead_id=p_lead_id for update;
  if not found or d.status<>'approved' or d.sent_at is not null or
    d.subject is distinct from p_subject or d.body is distinct from p_body or
    d.selection is distinct from p_selection or d.updated_at is distinct from p_updated_at then
    raise exception 'reviewed_draft_changed';
  end if;
  if exists(select 1 from public.local_business_outreach_drafts where lead_id=p_lead_id and status='sent') then
    raise exception 'company_previously_contacted';
  end if;
  insert into public.opportunity_outreach_send_claims(draft_id,lead_id) values(p_draft_id,p_lead_id);
end; $$;
revoke all on function public.claim_scenario_outreach_send(uuid,uuid,text,text,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.claim_scenario_outreach_send(uuid,uuid,text,text,jsonb,timestamptz) to service_role;

create function public.guard_claimed_scenario_draft() returns trigger language plpgsql security invoker set search_path=public as $$
begin
  if exists(select 1 from public.opportunity_outreach_send_claims where draft_id=old.id) and
    (new.subject is distinct from old.subject or new.body is distinct from old.body or
     new.selection is distinct from old.selection or new.status='draft') then
    raise exception 'send_claim_requires_reconciliation';
  end if;
  return new;
end; $$;
revoke all on function public.guard_claimed_scenario_draft() from public,anon,authenticated;
grant execute on function public.guard_claimed_scenario_draft() to service_role;
create trigger guard_claimed_scenario_draft before update on public.local_business_outreach_drafts
for each row execute function public.guard_claimed_scenario_draft();
-- Legacy audit rows, counters, columns, shared eligibility triggers and historical views remain intact.
commit;
