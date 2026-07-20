-- Opportunity Engine Phase 5: durable discovery orchestration.
-- Browser access is intentionally denied; the operator-authenticated Edge Function
-- is the only caller and uses the service role.

begin;

create table if not exists public.opportunity_discovery_runs (
  id uuid primary key default gen_random_uuid(),
  location text not null,
  industry text not null,
  keywords text,
  radius_m integer check (radius_m is null or radius_m between 100 and 50000),
  result_limit integer not null default 20 check (result_limit between 1 and 50),
  status text not null default 'queued' check (status in (
    'queued', 'discovering', 'enriching', 'scoring', 'auditing',
    'completed', 'partially_completed', 'failed', 'cancelled'
  )),
  current_stage text not null default 'queued',
  businesses_discovered integer not null default 0 check (businesses_discovered >= 0),
  candidates_enriched integer not null default 0 check (candidates_enriched >= 0),
  candidates_scored integer not null default 0 check (candidates_scored >= 0),
  audits_generated integer not null default 0 check (audits_generated >= 0),
  failures integer not null default 0 check (failures >= 0),
  error_summary jsonb not null default '[]'::jsonb,
  created_by text not null default 'operator-console',
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.opportunity_discovery_candidates (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.opportunity_discovery_runs(id) on delete cascade,
  source text not null default 'google_places',
  source_identifier text not null,
  business_name text not null,
  normalized_identity text not null,
  location text,
  address text,
  industry text,
  website_url text,
  phone text,
  email text,
  google_maps_url text,
  source_payload jsonb not null default '{}'::jsonb,
  enrichment_evidence jsonb not null default '[]'::jsonb,
  preliminary_signals jsonb not null default '[]'::jsonb,
  preliminary_score numeric(6,2),
  duplicate_lead_id uuid references public.local_business_leads(id) on delete set null,
  imported_lead_id uuid references public.local_business_leads(id) on delete set null,
  enrichment_status text not null default 'not_started' check (enrichment_status in ('not_started','queued','enriching','enriched','partial','failed')),
  assessment_status text not null default 'not_started' check (assessment_status in ('not_started','queued','scoring','scored','partial','failed')),
  audit_status text not null default 'not_started' check (audit_status in ('not_started','queued','auditing','audited','failed')),
  import_status text not null default 'not_imported' check (import_status in ('not_imported','imported','existing','duplicate','incomplete','failed')),
  error_info jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, source, source_identifier)
);

create index if not exists opportunity_discovery_runs_status_created_idx
  on public.opportunity_discovery_runs(status, created_at desc);
create index if not exists opportunity_discovery_candidates_run_created_idx
  on public.opportunity_discovery_candidates(run_id, created_at);
create index if not exists opportunity_discovery_candidates_duplicate_lead_idx
  on public.opportunity_discovery_candidates(duplicate_lead_id) where duplicate_lead_id is not null;
create index if not exists opportunity_discovery_candidates_imported_lead_idx
  on public.opportunity_discovery_candidates(imported_lead_id) where imported_lead_id is not null;
create index if not exists opportunity_discovery_candidates_identity_idx
  on public.opportunity_discovery_candidates(normalized_identity);

drop trigger if exists trg_opportunity_discovery_runs_updated_at on public.opportunity_discovery_runs;
create trigger trg_opportunity_discovery_runs_updated_at
  before update on public.opportunity_discovery_runs
  for each row execute function public.set_local_business_updated_at();

drop trigger if exists trg_opportunity_discovery_candidates_updated_at on public.opportunity_discovery_candidates;
create trigger trg_opportunity_discovery_candidates_updated_at
  before update on public.opportunity_discovery_candidates
  for each row execute function public.set_local_business_updated_at();

alter table public.opportunity_discovery_runs enable row level security;
alter table public.opportunity_discovery_candidates enable row level security;
revoke all on public.opportunity_discovery_runs from anon, authenticated;
revoke all on public.opportunity_discovery_candidates from anon, authenticated;
grant select, insert, update on public.opportunity_discovery_runs to service_role;
grant select, insert, update on public.opportunity_discovery_candidates to service_role;

-- Import is transactional and serialized per normalized business identity. The
-- function is security-invoker and executable only by service_role.
create or replace function public.opportunity_import_discovery_candidate(p_candidate_id uuid)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_candidate public.opportunity_discovery_candidates%rowtype;
  v_lead_id uuid;
  v_created boolean := false;
begin
  select * into v_candidate
  from public.opportunity_discovery_candidates
  where id = p_candidate_id
  for update;

  if not found then
    raise exception 'candidate_not_found' using errcode = 'P0002';
  end if;

  if v_candidate.imported_lead_id is not null then
    return jsonb_build_object('lead_id', v_candidate.imported_lead_id, 'created', false, 'idempotent', true);
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_candidate.normalized_identity, 0));

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
  set imported_lead_id = v_lead_id,
      duplicate_lead_id = case when v_created then null else v_lead_id end,
      import_status = case when v_created then 'imported' else 'existing' end,
      error_info = '{}'::jsonb
  where id = p_candidate_id;

  perform public.emit_local_business_event(
    v_lead_id,
    case when v_created then 'local_business.discovery_imported' else 'local_business.discovery_duplicate_matched' end,
    'completed',
    jsonb_build_object('candidate_id', p_candidate_id, 'run_id', v_candidate.run_id, 'created', v_created),
    v_candidate.business_name
  );

  return jsonb_build_object('lead_id', v_lead_id, 'created', v_created, 'idempotent', false);
end;
$$;

revoke all on function public.opportunity_import_discovery_candidate(uuid) from public, anon, authenticated;
grant execute on function public.opportunity_import_discovery_candidate(uuid) to service_role;

comment on table public.opportunity_discovery_runs is 'Durable standalone Opportunity Engine discovery runs.';
comment on table public.opportunity_discovery_candidates is 'Provider candidates linked to canonical local-business leads only after operator import.';

commit;
