-- Opportunity Engine Scenario Registry v1
--
-- Adds a versioned scenario definition that describes why a discovery run exists
-- and the discovery / assessment / report / outreach / commercial configuration
-- that should govern it. Existing Opportunity Engine behaviour is preserved by
-- seeding the current local digital presence workflow as the default scenario.

begin;

create table if not exists public.opportunity_scenarios (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  name text not null,
  description text,
  status text not null default 'draft' check (status in ('draft', 'active', 'retired')),
  version integer not null default 1 check (version > 0),
  discovery_config jsonb not null default '{}'::jsonb,
  assessment_config jsonb not null default '{}'::jsonb,
  report_config jsonb not null default '{}'::jsonb,
  outreach_config jsonb not null default '{}'::jsonb,
  commercial_config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (slug, version)
);

create index if not exists opportunity_scenarios_status_slug_idx
  on public.opportunity_scenarios(status, slug, version desc);

drop trigger if exists trg_opportunity_scenarios_updated_at on public.opportunity_scenarios;
create trigger trg_opportunity_scenarios_updated_at
  before update on public.opportunity_scenarios
  for each row execute function public.set_local_business_updated_at();

alter table public.opportunity_scenarios enable row level security;
revoke all on public.opportunity_scenarios from anon, authenticated;
grant select, insert, update on public.opportunity_scenarios to service_role;

insert into public.opportunity_scenarios (
  slug,
  name,
  description,
  status,
  version,
  discovery_config,
  assessment_config,
  report_config,
  outreach_config,
  commercial_config
)
values (
  'local-digital-presence',
  'Local Digital Presence',
  'Find local service businesses with visible digital-presence, trust and conversion opportunities.',
  'active',
  1,
  jsonb_build_object(
    'provider', 'google_places',
    'default_result_limit', 10,
    'max_result_limit', 20,
    'radius_m', null,
    'keywords', jsonb_build_array(),
    'exclusions', jsonb_build_array()
  ),
  jsonb_build_object(
    'profile', 'local_digital_presence_v1',
    'dimensions', jsonb_build_array(
      'demand_signal',
      'trust_leakage',
      'conversion_maturity',
      'ai_readiness'
    ),
    'minimum_score', 60,
    'required_evidence', jsonb_build_array(
      'website',
      'google_profile',
      'contact_pathway'
    ),
    'visual_assessment', true
  ),
  jsonb_build_object(
    'template', 'local_digital_presence_audit_v1',
    'customer_ready_required', true,
    'sections', jsonb_build_array(
      'summary',
      'metrics',
      'observed_evidence',
      'recommendations',
      'commercial_ctas'
    )
  ),
  jsonb_build_object(
    'subject_template', 'Quick opportunity audit for {{business_name}}',
    'message_template', 'local_digital_presence_outreach_v1',
    'minimum_score', 60,
    'requires_operator_approval', true
  ),
  jsonb_build_object(
    'ctas', jsonb_build_array(
      jsonb_build_object(
        'id', 'website_refresh',
        'label', 'Fix my website',
        'type', 'billing_offer',
        'billing_offer_id', null,
        'conditions', jsonb_build_object('trust_leakage_min', 60)
      ),
      jsonb_build_object(
        'id', 'local_visibility',
        'label', 'Improve my local visibility',
        'type', 'billing_offer',
        'billing_offer_id', null,
        'conditions', jsonb_build_object('trust_leakage_min', 60)
      ),
      jsonb_build_object(
        'id', 'discovery_session',
        'label', 'Talk through the findings',
        'type', 'cockpit_case',
        'case_type', 'discovery'
      )
    )
  )
)
on conflict (slug, version) do update
set
  name = excluded.name,
  description = excluded.description,
  status = excluded.status,
  discovery_config = excluded.discovery_config,
  assessment_config = excluded.assessment_config,
  report_config = excluded.report_config,
  outreach_config = excluded.outreach_config,
  commercial_config = excluded.commercial_config,
  updated_at = now();

alter table public.opportunity_discovery_runs
  add column if not exists scenario_id uuid references public.opportunity_scenarios(id) on delete restrict,
  add column if not exists scenario_version integer,
  add column if not exists scenario_snapshot jsonb;

alter table public.local_business_lead_assessments
  add column if not exists scenario_id uuid references public.opportunity_scenarios(id) on delete set null,
  add column if not exists scenario_version integer,
  add column if not exists assessment_profile text;

alter table public.local_business_audit_reports
  add column if not exists scenario_id uuid references public.opportunity_scenarios(id) on delete set null,
  add column if not exists scenario_version integer;

alter table public.local_business_outreach_drafts
  add column if not exists scenario_id uuid references public.opportunity_scenarios(id) on delete set null,
  add column if not exists scenario_version integer;

with default_scenario as (
  select *
  from public.opportunity_scenarios
  where slug = 'local-digital-presence'
    and version = 1
  limit 1
)
update public.opportunity_discovery_runs r
set
  scenario_id = d.id,
  scenario_version = d.version,
  scenario_snapshot = jsonb_build_object(
    'id', d.id,
    'slug', d.slug,
    'name', d.name,
    'version', d.version,
    'discovery_config', d.discovery_config,
    'assessment_config', d.assessment_config,
    'report_config', d.report_config,
    'outreach_config', d.outreach_config,
    'commercial_config', d.commercial_config
  )
from default_scenario d
where r.scenario_id is null;

with default_scenario as (
  select id, version
  from public.opportunity_scenarios
  where slug = 'local-digital-presence'
    and version = 1
  limit 1
)
update public.local_business_lead_assessments a
set
  scenario_id = d.id,
  scenario_version = d.version,
  assessment_profile = coalesce(a.assessment_profile, 'local_digital_presence_v1')
from default_scenario d
where a.scenario_id is null;

with default_scenario as (
  select id, version
  from public.opportunity_scenarios
  where slug = 'local-digital-presence'
    and version = 1
  limit 1
)
update public.local_business_audit_reports r
set
  scenario_id = d.id,
  scenario_version = d.version
from default_scenario d
where r.scenario_id is null;

with default_scenario as (
  select id, version
  from public.opportunity_scenarios
  where slug = 'local-digital-presence'
    and version = 1
  limit 1
)
update public.local_business_outreach_drafts dft
set
  scenario_id = d.id,
  scenario_version = d.version
from default_scenario d
where dft.scenario_id is null;

create index if not exists opportunity_discovery_runs_scenario_idx
  on public.opportunity_discovery_runs(scenario_id, created_at desc);
create index if not exists local_business_lead_assessments_scenario_idx
  on public.local_business_lead_assessments(scenario_id, assessed_at desc);
create index if not exists local_business_audit_reports_scenario_idx
  on public.local_business_audit_reports(scenario_id, generated_at desc);
create index if not exists local_business_outreach_drafts_scenario_idx
  on public.local_business_outreach_drafts(scenario_id, created_at desc);

comment on table public.opportunity_scenarios is
  'Versioned Opportunity Engine scenario definitions for discovery, assessment, reporting, outreach and commercial outcomes.';
comment on column public.opportunity_discovery_runs.scenario_snapshot is
  'Immutable scenario definition captured at discovery-run creation for reproducibility and auditability.';

commit;
