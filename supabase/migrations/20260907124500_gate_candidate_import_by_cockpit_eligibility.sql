-- Gate Opportunity Engine candidate import against Cockpit commercial state.
--
-- DEPENDENCY: MGRNZ migration 20260907123000_opportunity_prospect_eligibility.sql
-- must be applied first because this migration calls public.check_prospect_eligibility.
--
-- Assessment already requires an imported/matched local_business_lead, so blocking
-- import also blocks enrichment/assessment for known Cockpit relationships.

begin;

alter table public.opportunity_discovery_candidates
  add column if not exists eligibility_status text not null default 'not_checked',
  add column if not exists eligibility_result jsonb not null default '{}'::jsonb;

alter table public.opportunity_discovery_candidates
  drop constraint if exists opportunity_discovery_candidates_eligibility_status_chk;

alter table public.opportunity_discovery_candidates
  add constraint opportunity_discovery_candidates_eligibility_status_chk
  check (eligibility_status in ('not_checked', 'eligible', 'blocked', 'review_required', 'failed'));

create index if not exists opportunity_discovery_candidates_eligibility_idx
  on public.opportunity_discovery_candidates(run_id, eligibility_status, created_at);

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
      'eligibility', v_candidate.eligibility_result
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

  if not v_eligible then
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
      'error', 'candidate_not_commercially_eligible',
      'eligibility', v_eligibility
    );
  end if;

  update public.opportunity_discovery_candidates
  set
    eligibility_status = 'eligible',
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
      'cockpit_eligibility', v_eligibility
    ),
    v_candidate.business_name
  );

  return jsonb_build_object(
    'ok', true,
    'lead_id', v_lead_id,
    'created', v_created,
    'idempotent', false,
    'eligible', true,
    'classification', 'eligible',
    'eligibility', v_eligibility
  );
end;
$$;

revoke all on function public.opportunity_import_discovery_candidate(uuid) from public, anon, authenticated;
grant execute on function public.opportunity_import_discovery_candidate(uuid) to service_role;

comment on column public.opportunity_discovery_candidates.eligibility_status is
  'Cockpit commercial eligibility state evaluated before candidate import.';
comment on column public.opportunity_discovery_candidates.eligibility_result is
  'Full read-only result from Cockpit check_prospect_eligibility for operator evidence and auditability.';

commit;
