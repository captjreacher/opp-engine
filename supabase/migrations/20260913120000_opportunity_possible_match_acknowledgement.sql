-- Opp Engine possible_match acknowledgement flow.
--
-- DEPENDENCIES: MGRNZ migrations
--   20260907123000_opportunity_prospect_eligibility.sql   (check_prospect_eligibility)
--   20260907124500_gate_candidate_import_by_cockpit_eligibility.sql
--   20260907125500_enforce_candidate_eligibility_before_work.sql
-- must be applied first.
--
-- Cockpit classifications remain the single source of truth:
--   existing_customer, previously_contacted, existing_lead, existing_contact,
--   nurture  -> hard block, NEVER overridable.
--   eligible  -> may proceed.
--   possible_match -> may proceed ONLY once an operator acknowledgement has been
--                     persisted. The classification stays possible_match; it is
--                     never rewritten to eligible.
--
-- This migration adds the minimum persistence required (an acknowledgement flag,
-- timestamp and operator) plus a single shared gate predicate. The original
-- Cockpit evidence is retained in opportunity_discovery_candidates.eligibility_result;
-- no new risk framework is introduced.

begin;

-- ── Persistence: operator acknowledgement of a possible_match ────────────────
alter table public.opportunity_discovery_candidates
  add column if not exists eligibility_acknowledged boolean not null default false,
  add column if not exists eligibility_acknowledged_at timestamptz,
  add column if not exists eligibility_acknowledged_by text;

comment on column public.opportunity_discovery_candidates.eligibility_acknowledged is
  'True when an operator explicitly acknowledged a possible_match and may proceed under exception.';
comment on column public.opportunity_discovery_candidates.eligibility_acknowledged_at is
  'When the possible_match acknowledgement was persisted.';
comment on column public.opportunity_discovery_candidates.eligibility_acknowledged_by is
  'Operator identity that accepted the possible_match acknowledgement.';

-- ── Shared gate predicate ────────────────────────────────────────────────────
-- A) classification = eligible, OR
-- B) classification = possible_match AND acknowledged.
-- Any other classification (all Cockpit hard blocks) is non-overridable.
create or replace function public.opportunity_classification_allows_progress(
  p_classification text,
  p_possible_match_acknowledged boolean default false
)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_classification = 'eligible' then true
    when p_classification = 'possible_match' then coalesce(p_possible_match_acknowledged, false)
    else false
  end;
$$;

revoke all on function public.opportunity_classification_allows_progress(text, boolean)
  from public, anon, authenticated;
grant execute on function public.opportunity_classification_allows_progress(text, boolean)
  to service_role;

-- ── Acknowledgement RPC ──────────────────────────────────────────────────────
-- Idempotent. Only a candidate whose retained Cockpit classification is
-- possible_match may be acknowledged. Never changes the classification and never
-- emits a duplicate audit event on repeat calls.
create or replace function public.opportunity_acknowledge_possible_match(
  p_candidate_id uuid,
  p_operator text default null
)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_candidate public.opportunity_discovery_candidates%rowtype;
  v_classification text;
  v_operator text := coalesce(nullif(btrim(coalesce(p_operator, '')), ''), 'operator-console');
  v_acknowledged_at timestamptz := now();
  v_event_id uuid;
  v_source_lead_id uuid;
begin
  select * into v_candidate
  from public.opportunity_discovery_candidates
  where id = p_candidate_id
  for update;

  if not found then
    raise exception 'candidate_not_found' using errcode = 'P0002';
  end if;

  v_classification := coalesce(v_candidate.eligibility_result->>'classification', 'unknown');

  if v_classification <> 'possible_match' then
    return jsonb_build_object(
      'ok', false,
      'error', 'candidate_not_possible_match',
      'classification', v_classification
    );
  end if;

  -- Idempotent: acknowledgement is immutable once accepted; do not re-audit.
  if v_candidate.eligibility_acknowledged then
    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'classification', v_classification,
      'contact_id', v_candidate.eligibility_result->>'contact_id',
      'organisation_id', v_candidate.eligibility_result->>'organisation_id',
      'match_type', v_candidate.eligibility_result->>'match_type',
      'confidence', v_candidate.eligibility_result->>'confidence',
      'acknowledged_at', v_candidate.eligibility_acknowledged_at,
      'acknowledged_by', v_candidate.eligibility_acknowledged_by,
      'event_id', null
    );
  end if;

  update public.opportunity_discovery_candidates
  set
    eligibility_acknowledged = true,
    eligibility_acknowledged_at = v_acknowledged_at,
    eligibility_acknowledged_by = v_operator
  where id = p_candidate_id;

  v_source_lead_id := coalesce(v_candidate.imported_lead_id, v_candidate.duplicate_lead_id);

  insert into public.events (
    source_system,
    event_type,
    entity_type,
    entity_id,
    entity_ref,
    status,
    payload,
    risk_category,
    risk_assertions,
    risk_version,
    correlation_id,
    actor
  ) values (
    'opportunity-engine',
    'opportunity.prospect_possible_match_acknowledged',
    'opportunity_discovery_candidate',
    v_candidate.id,
    v_candidate.business_name,
    'acknowledged',
    jsonb_strip_nulls(jsonb_build_object(
      'candidate_id', v_candidate.id,
      'run_id', v_candidate.run_id,
      'source_lead_id', v_source_lead_id,
      'contact_id', v_candidate.eligibility_result->>'contact_id',
      'organisation_id', v_candidate.eligibility_result->>'organisation_id',
      'classification', 'possible_match',
      'match_type', v_candidate.eligibility_result->>'match_type',
      'confidence', v_candidate.eligibility_result->>'confidence',
      'reason', v_candidate.eligibility_result->>'reason',
      'acknowledged_at', v_acknowledged_at,
      'acknowledged_by', v_operator
    )),
    'business_process',
    array['review'],
    'risk-map-v1',
    v_candidate.run_id::text,
    v_operator
  ) returning id into v_event_id;

  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'classification', 'possible_match',
    'contact_id', v_candidate.eligibility_result->>'contact_id',
    'organisation_id', v_candidate.eligibility_result->>'organisation_id',
    'match_type', v_candidate.eligibility_result->>'match_type',
    'confidence', v_candidate.eligibility_result->>'confidence',
    'acknowledged_at', v_acknowledged_at,
    'acknowledged_by', v_operator,
    'event_id', v_event_id
  );
end;
$$;

revoke all on function public.opportunity_acknowledge_possible_match(uuid, text)
  from public, anon, authenticated;
grant execute on function public.opportunity_acknowledge_possible_match(uuid, text)
  to service_role;

comment on function public.opportunity_acknowledge_possible_match(uuid, text) is
  'Persists an operator acknowledgement for a possible_match discovery candidate and records an immutable event. Idempotent; never rewrites the classification to eligible.';

-- ── Candidate import gate: allow acknowledged possible_match ─────────────────
create or replace function public.opportunity_import_discovery_candidate(p_candidate_id uuid)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_candidate public.opportunity_discovery_candidates%rowtype;
  v_lead_id uuid;
  v_created boolean := false;
  v_eligibility jsonb;
  v_classification text;
  v_eligible boolean;
  v_allowed boolean;
  v_requires_ack boolean;
begin
  select * into v_candidate
  from public.opportunity_discovery_candidates
  where id = p_candidate_id
  for update;

  if not found then
    raise exception 'candidate_not_found' using errcode = 'P0002';
  end if;

  if v_candidate.imported_lead_id is not null then
    return jsonb_build_object(
      'ok', true,
      'lead_id', v_candidate.imported_lead_id,
      'created', false,
      'idempotent', true,
      'eligibility', v_candidate.eligibility_result,
      'classification', coalesce(v_candidate.eligibility_result->>'classification', 'eligible'),
      'eligibility_acknowledged', v_candidate.eligibility_acknowledged
    );
  end if;

  -- Cockpit owns canonical relationship/commercial state. Check it before we
  -- spend work or create a canonical local-business opportunity record.
  begin
    v_eligibility := public.check_prospect_eligibility(
      p_business_name => v_candidate.business_name,
      p_email => v_candidate.email,
      p_phone => v_candidate.phone
    );
  exception when others then
    update public.opportunity_discovery_candidates
    set
      eligibility_status = 'failed',
      eligibility_result = jsonb_build_object(
        'eligible', false,
        'classification', 'eligibility_check_failed',
        'reason', sqlerrm
      ),
      error_info = jsonb_build_object('stage', 'eligibility', 'detail', sqlerrm)
    where id = p_candidate_id;

    raise exception 'prospect_eligibility_check_failed: %', sqlerrm;
  end;

  v_eligible := coalesce((v_eligibility->>'eligible')::boolean, false);
  v_classification := coalesce(v_eligibility->>'classification', 'unknown');
  v_allowed := public.opportunity_classification_allows_progress(
    v_classification,
    v_candidate.eligibility_acknowledged
  );
  v_requires_ack := v_classification = 'possible_match' and not v_candidate.eligibility_acknowledged;

  if not v_allowed then
    update public.opportunity_discovery_candidates
    set
      eligibility_status = case
        when v_classification = 'possible_match' then 'review_required'
        else 'blocked'
      end,
      eligibility_result = v_eligibility,
      import_status = case
        when v_classification = 'possible_match' then 'incomplete'
        else 'existing'
      end,
      error_info = '{}'::jsonb
    where id = p_candidate_id;

    return jsonb_build_object(
      'ok', false,
      'lead_id', null,
      'created', false,
      'idempotent', false,
      'eligible', false,
      'classification', v_classification,
      'requires_acknowledgement', v_requires_ack,
      'error', case
        when v_classification = 'possible_match'
          then 'candidate_requires_possible_match_acknowledgement'
        else 'candidate_not_commercially_eligible'
      end,
      'eligibility', v_eligibility
    );
  end if;

  -- Keep possible_match as possible_match. An acknowledged possible_match
  -- proceeds under exception and is never relabelled eligible.
  update public.opportunity_discovery_candidates
  set
    eligibility_status = case
      when v_classification = 'possible_match' then 'review_required'
      else 'eligible'
    end,
    eligibility_result = v_eligibility,
    error_info = '{}'::jsonb
  where id = p_candidate_id;

  perform pg_advisory_xact_lock(hashtextextended(v_candidate.normalized_identity, 0));

  -- Preserve the existing local-business duplicate gate. Cockpit eligibility
  -- answers commercial relationship state; this answers whether the business
  -- already exists in the Opportunity Engine intelligence layer.
  select l.id into v_lead_id
  from public.local_business_leads l
  where (v_candidate.google_maps_url is not null and l.google_maps_url = v_candidate.google_maps_url)
     or (v_candidate.website_url is not null and lower(regexp_replace(l.website_url, '/+$', '')) = lower(regexp_replace(v_candidate.website_url, '/+$', '')))
     or (
       regexp_replace(lower(l.business_name), '[^a-z0-9]+', '', 'g') = split_part(v_candidate.normalized_identity, '|', 1)
       and lower(coalesce(l.suburb, l.region, '')) = lower(coalesce(v_candidate.location, ''))
     )
  order by l.created_at
  limit 1;

  if v_lead_id is null then
    insert into public.local_business_leads (
      business_name, category, suburb, region, country, phone, email,
      website_url, google_maps_url, address, status, source, notes
    ) values (
      v_candidate.business_name, v_candidate.industry, v_candidate.location,
      v_candidate.location, 'NZ', v_candidate.phone, v_candidate.email,
      v_candidate.website_url, v_candidate.google_maps_url, v_candidate.address,
      'discovered', 'opportunity-discovery',
      'Imported from discovery run ' || v_candidate.run_id::text
    ) returning id into v_lead_id;
    v_created := true;
  end if;

  update public.opportunity_discovery_candidates
  set
    imported_lead_id = v_lead_id,
    duplicate_lead_id = case when v_created then null else v_lead_id end,
    import_status = case when v_created then 'imported' else 'existing' end,
    error_info = '{}'::jsonb
  where id = p_candidate_id;

  perform public.emit_local_business_event(
    v_lead_id,
    case when v_created then 'local_business.discovery_imported' else 'local_business.discovery_duplicate_matched' end,
    'completed',
    jsonb_build_object(
      'candidate_id', p_candidate_id,
      'run_id', v_candidate.run_id,
      'created', v_created,
      'classification', v_classification,
      'eligibility_acknowledged', v_candidate.eligibility_acknowledged,
      'cockpit_eligibility', v_eligibility
    ),
    v_candidate.business_name
  );

  return jsonb_build_object(
    'ok', true,
    'lead_id', v_lead_id,
    'created', v_created,
    'idempotent', false,
    'eligible', v_eligible,
    'classification', v_classification,
    'acknowledged_exception', v_classification = 'possible_match',
    'eligibility_acknowledged', v_candidate.eligibility_acknowledged,
    'eligibility', v_eligibility
  );
end;
$$;

revoke all on function public.opportunity_import_discovery_candidate(uuid) from public, anon, authenticated;
grant execute on function public.opportunity_import_discovery_candidate(uuid) to service_role;

-- ── Scoring/assessment + audit gate ─────────────────────────────────────────
create or replace function public.opportunity_require_candidate_eligibility_before_work()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
  v_classification text;
begin
  if not (
    (new.assessment_status = 'scoring' and old.assessment_status is distinct from new.assessment_status)
    or (new.audit_status = 'auditing' and old.audit_status is distinct from new.audit_status)
  ) then
    return new;
  end if;

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

  v_classification := coalesce(v_result->>'classification', 'unknown');

  if not public.opportunity_classification_allows_progress(
    v_classification,
    new.eligibility_acknowledged
  ) then
    if v_classification = 'possible_match' then
      raise exception 'candidate_requires_possible_match_acknowledgement'
        using errcode = 'P0001',
              detail = 'Acknowledge the possible Cockpit match before scoring or auditing this candidate.';
    end if;

    raise exception 'candidate_not_commercially_eligible: %', v_classification
      using errcode = 'P0001',
            detail = coalesce(v_result->>'reason', 'Cockpit commercial eligibility gate blocked processing.');
  end if;

  -- Preserve possible_match: an acknowledged exception proceeds without being
  -- relabelled eligible.
  if v_classification = 'possible_match' then
    new.eligibility_status := 'review_required';
  else
    new.eligibility_status := 'eligible';
  end if;
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

-- ── Outreach draft gate ─────────────────────────────────────────────────────
create or replace function public.opportunity_require_lead_eligibility_before_outreach()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_lead public.local_business_leads%rowtype;
  v_result jsonb;
  v_classification text;
  v_acknowledged boolean := false;
begin
  select * into v_lead
  from public.local_business_leads
  where id = new.lead_id;

  if not found then
    raise exception 'opportunity_lead_not_found' using errcode = 'P0002';
  end if;

  begin
    v_result := public.check_prospect_eligibility(
      p_business_name => v_lead.business_name,
      p_email => v_lead.email,
      p_phone => v_lead.phone
    );
  exception when others then
    raise exception 'prospect_eligibility_check_failed: %', sqlerrm
      using errcode = 'P0001';
  end;

  v_classification := coalesce(v_result->>'classification', 'unknown');

  -- A possible_match may create an outreach draft only when the originating
  -- discovery candidate has a persisted acknowledgement.
  if v_classification = 'possible_match' then
    select exists (
      select 1
      from public.opportunity_discovery_candidates c
      where (c.imported_lead_id = new.lead_id or c.duplicate_lead_id = new.lead_id)
        and c.eligibility_acknowledged
        and coalesce(c.eligibility_result->>'classification', '') = 'possible_match'
    ) into v_acknowledged;
  end if;

  if not public.opportunity_classification_allows_progress(v_classification, v_acknowledged) then
    if v_classification = 'possible_match' then
      raise exception 'outreach_requires_possible_match_acknowledgement'
        using errcode = 'P0001',
              detail = 'Acknowledge the possible Cockpit match before creating outreach for this prospect.';
    end if;

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
  'Rechecks Cockpit commercial state before scoring/audit. Hard blocks stay blocked; possible_match requires a persisted acknowledgement.';
comment on function public.opportunity_require_lead_eligibility_before_outreach() is
  'Rechecks Cockpit commercial state before creating an outreach draft. Hard blocks stay blocked; possible_match requires a persisted acknowledgement.';

commit;
