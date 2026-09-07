-- Enforce fresh Cockpit commercial eligibility before Opportunity Engine work.
--
-- DEPENDENCY: MGRNZ migration 20260907123000_opportunity_prospect_eligibility.sql
-- must be applied first.
--
-- Candidate import is already gated in 20260907124500. These triggers close the
-- existing duplicate-lead path that could otherwise enter scoring/auditing
-- without import, and recheck before outreach drafting.

begin;

create or replace function public.opportunity_apply_candidate_eligibility()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
  v_eligible boolean;
  v_classification text;
begin
  begin
    v_result := public.check_prospect_eligibility(
      p_business_name => new.business_name,
      p_email => new.email,
      p_phone => new.phone
    );
  exception when others then
    new.eligibility_status := 'failed';
    new.eligibility_result := jsonb_build_object(
      'eligible', false,
      'classification', 'eligibility_check_failed',
      'reason', sqlerrm
    );
    new.error_info := jsonb_build_object('stage', 'eligibility', 'detail', sqlerrm);
    return new;
  end;

  v_eligible := coalesce((v_result->>'eligible')::boolean, false);
  v_classification := coalesce(v_result->>'classification', 'unknown');
  new.eligibility_result := v_result;
  new.eligibility_status := case
    when v_eligible then 'eligible'
    when v_classification = 'possible_match' then 'review_required'
    else 'blocked'
  end;

  if not v_eligible then
    new.import_status := case
      when v_classification = 'possible_match' then 'incomplete'
      else 'existing'
    end;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_opportunity_candidate_initial_eligibility
  on public.opportunity_discovery_candidates;
create trigger trg_opportunity_candidate_initial_eligibility
  before insert on public.opportunity_discovery_candidates
  for each row execute function public.opportunity_apply_candidate_eligibility();

create or replace function public.opportunity_require_candidate_eligibility_before_work()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
  v_eligible boolean;
  v_classification text;
begin
  if not (
    (new.assessment_status = 'scoring' and old.assessment_status is distinct from new.assessment_status)
    or (new.audit_status = 'auditing' and old.audit_status is distinct from new.audit_status)
  ) then
    return new;
  end if;

  v_result := public.check_prospect_eligibility(
    p_business_name => new.business_name,
    p_email => new.email,
    p_phone => new.phone
  );
  v_eligible := coalesce((v_result->>'eligible')::boolean, false);
  v_classification := coalesce(v_result->>'classification', 'unknown');

  if not v_eligible then
    raise exception 'candidate_not_commercially_eligible: %', v_classification
      using errcode = 'P0001',
            detail = coalesce(v_result->>'reason', 'Cockpit commercial eligibility gate blocked processing.');
  end if;

  new.eligibility_status := 'eligible';
  new.eligibility_result := v_result;
  return new;
end;
$$;

drop trigger if exists trg_opportunity_candidate_require_eligibility_before_work
  on public.opportunity_discovery_candidates;
create trigger trg_opportunity_candidate_require_eligibility_before_work
  before update of assessment_status, audit_status
  on public.opportunity_discovery_candidates
  for each row execute function public.opportunity_require_candidate_eligibility_before_work();

create or replace function public.opportunity_require_lead_eligibility_before_outreach()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_lead public.local_business_leads%rowtype;
  v_result jsonb;
  v_eligible boolean;
  v_classification text;
begin
  select * into v_lead
  from public.local_business_leads
  where id = new.lead_id;

  if not found then
    raise exception 'opportunity_lead_not_found' using errcode = 'P0002';
  end if;

  v_result := public.check_prospect_eligibility(
    p_business_name => v_lead.business_name,
    p_email => v_lead.email,
    p_phone => v_lead.phone
  );
  v_eligible := coalesce((v_result->>'eligible')::boolean, false);
  v_classification := coalesce(v_result->>'classification', 'unknown');

  if not v_eligible then
    raise exception 'outreach_not_commercially_eligible: %', v_classification
      using errcode = 'P0001',
            detail = coalesce(v_result->>'reason', 'Cockpit commercial eligibility gate blocked outreach.');
  end if;

  return new;
end;
$$;

drop trigger if exists trg_local_business_outreach_require_eligibility
  on public.local_business_outreach_drafts;
create trigger trg_local_business_outreach_require_eligibility
  before insert on public.local_business_outreach_drafts
  for each row execute function public.opportunity_require_lead_eligibility_before_outreach();

comment on function public.opportunity_require_candidate_eligibility_before_work() is
  'Rechecks Cockpit commercial state immediately before scoring/audit work and blocks known or ambiguous relationships.';
comment on function public.opportunity_require_lead_eligibility_before_outreach() is
  'Rechecks Cockpit commercial state immediately before creating an outreach draft.';

commit;
