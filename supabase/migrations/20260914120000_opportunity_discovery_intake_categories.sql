-- Opportunity Engine discovery intake: structured location + controlled category registry.
--
-- Discovery previously accepted free-text `location` and `industry`. This migration
-- introduces the smallest registry required to make the category an operator-selectable,
-- provider-expandable concept, and adds structured location provenance (Google place id
-- plus coordinates) to a discovery run.
--
-- Backwards compatibility: `opportunity_discovery_runs.location` and `.industry` remain
-- the human-readable label snapshots and are still populated, so every existing run and
-- candidate stays readable. Legacy runs are backfilled with `category_label = industry`
-- and keep `category_slug = null` (meaning: free text, not a registry selection).
--
-- This migration deliberately does NOT touch Cockpit eligibility, the possible_match
-- acknowledgement contract, local duplicate detection or the send handoff.

begin;

-- ── 1. Controlled category registry ─────────────────────────────────────────

create table if not exists public.opportunity_categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  label text not null,
  description text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  -- Provider-neutral search terms the discovery provider may expand into queries.
  search_terms jsonb not null default '[]'::jsonb,
  -- Provider-native place types, retained for future provider mapping/filtering.
  google_types jsonb not null default '[]'::jsonb,
  default_radius_m integer check (default_radius_m is null or default_radius_m between 100 and 50000),
  -- Scenario slugs this category is compatible with. Empty array = unrestricted.
  compatible_scenarios jsonb not null default '[]'::jsonb,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists opportunity_categories_status_order_idx
  on public.opportunity_categories(status, sort_order, label);

drop trigger if exists trg_opportunity_categories_updated_at on public.opportunity_categories;
create trigger trg_opportunity_categories_updated_at
  before update on public.opportunity_categories
  for each row execute function public.set_local_business_updated_at();

alter table public.opportunity_categories enable row level security;
revoke all on public.opportunity_categories from anon, authenticated;
grant select, insert, update on public.opportunity_categories to service_role;

insert into public.opportunity_categories (
  slug,
  label,
  description,
  status,
  search_terms,
  google_types,
  default_radius_m,
  compatible_scenarios,
  sort_order
)
values
  (
    'commercial-interiors',
    'Commercial Interiors',
    'Commercial fitout and interior trade businesses.',
    'active',
    '["commercial interior fitout", "office fitout", "shop fitout"]'::jsonb,
    '["interior_designer", "general_contractor"]'::jsonb,
    10000,
    '["local-digital-presence"]'::jsonb,
    10
  ),
  (
    'builders-construction',
    'Builders / Construction',
    'Residential and commercial building, renovation and construction companies.',
    'active',
    '["building company", "construction company", "renovation builder"]'::jsonb,
    '["general_contractor", "roofing_contractor"]'::jsonb,
    15000,
    '["local-digital-presence"]'::jsonb,
    20
  ),
  (
    'electricians',
    'Electricians',
    'Registered electrical service businesses.',
    'active',
    '["electrician", "electrical services"]'::jsonb,
    '["electrician"]'::jsonb,
    10000,
    '["local-digital-presence"]'::jsonb,
    30
  ),
  (
    'plumbers',
    'Plumbers',
    'Plumbing, drainlaying and gasfitting businesses.',
    'active',
    '["plumber", "plumbing services", "drainlayer"]'::jsonb,
    '["plumber"]'::jsonb,
    10000,
    '["local-digital-presence"]'::jsonb,
    40
  ),
  (
    'accountants',
    'Accountants',
    'Accounting, bookkeeping and tax practices.',
    'active',
    '["accountant", "accounting firm", "chartered accountant"]'::jsonb,
    '["accounting"]'::jsonb,
    15000,
    '["local-digital-presence"]'::jsonb,
    50
  ),
  (
    'lawyers',
    'Lawyers',
    'Law firms and sole practitioner solicitors.',
    'active',
    '["lawyer", "law firm", "solicitor"]'::jsonb,
    '["lawyer"]'::jsonb,
    15000,
    '["local-digital-presence"]'::jsonb,
    60
  ),
  (
    'property-services',
    'Property Services',
    'Property management, maintenance and grounds service businesses.',
    'active',
    '["property manager", "property maintenance", "lawn mowing"]'::jsonb,
    '["real_estate_agency", "moving_company"]'::jsonb,
    10000,
    '["local-digital-presence"]'::jsonb,
    70
  ),
  (
    'health-clinics',
    'Health / Clinics',
    'Medical, dental and allied health clinics.',
    'active',
    '["medical clinic", "dental clinic", "physiotherapy"]'::jsonb,
    '["doctor", "dentist", "physiotherapist"]'::jsonb,
    10000,
    '["local-digital-presence"]'::jsonb,
    80
  ),
  (
    'automotive',
    'Automotive',
    'Vehicle repair, servicing and automotive trade businesses.',
    'active',
    '["mechanic", "auto repair", "car service"]'::jsonb,
    '["car_repair"]'::jsonb,
    15000,
    '["local-digital-presence"]'::jsonb,
    90
  ),
  (
    'hospitality',
    'Hospitality',
    'Cafes, restaurants, bars and takeaway operators.',
    'active',
    '["cafe", "restaurant", "takeaway"]'::jsonb,
    '["restaurant", "cafe"]'::jsonb,
    5000,
    '["local-digital-presence"]'::jsonb,
    100
  ),
  (
    'retail',
    'Retail',
    'Independent and specialty retail stores.',
    'active',
    '["retail store", "specialty retail"]'::jsonb,
    '["store"]'::jsonb,
    5000,
    '["local-digital-presence"]'::jsonb,
    110
  ),
  (
    'professional-services',
    'Professional Services',
    'Consulting, advisory and business service providers.',
    'active',
    '["consulting firm", "business services", "professional services"]'::jsonb,
    '[]'::jsonb,
    20000,
    '["local-digital-presence"]'::jsonb,
    120
  )
on conflict (slug) do update
set
  label = excluded.label,
  description = excluded.description,
  search_terms = excluded.search_terms,
  google_types = excluded.google_types,
  default_radius_m = excluded.default_radius_m,
  compatible_scenarios = excluded.compatible_scenarios,
  sort_order = excluded.sort_order,
  updated_at = now();

-- ── 2. Structured location + category provenance on discovery runs ──────────

alter table public.opportunity_discovery_runs
  add column if not exists location_place_id text,
  add column if not exists location_latitude double precision,
  add column if not exists location_longitude double precision,
  add column if not exists category_id uuid references public.opportunity_categories(id) on delete set null,
  add column if not exists category_slug text,
  add column if not exists category_label text,
  add column if not exists discovery_terms jsonb not null default '[]'::jsonb;

create index if not exists opportunity_discovery_runs_category_idx
  on public.opportunity_discovery_runs(category_slug, created_at desc);

-- Legacy free-text runs keep their snapshot; they are not rewritten into registry slugs.
update public.opportunity_discovery_runs
set category_label = industry
where category_label is null;

comment on table public.opportunity_categories is
  'Controlled Opportunity Engine discovery categories. Operationally selected by slug; search terms expand into provider queries.';
comment on column public.opportunity_discovery_runs.location_place_id is
  'Stable Google place id for the selected search location (null for legacy free-text runs).';
comment on column public.opportunity_discovery_runs.category_slug is
  'Registry slug selected by the operator (null for legacy free-text runs).';
comment on column public.opportunity_discovery_runs.discovery_terms is
  'Expanded provider search terms actually used for this run, for auditability.';

-- ── 3. Read path for the operator console ──────────────────────────────────

create or replace function public.opportunity_list_active_categories()
returns table (
  id uuid,
  slug text,
  label text,
  description text,
  search_terms jsonb,
  google_types jsonb,
  default_radius_m integer,
  compatible_scenarios jsonb,
  sort_order integer
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    c.id,
    c.slug,
    c.label,
    c.description,
    c.search_terms,
    c.google_types,
    c.default_radius_m,
    c.compatible_scenarios,
    c.sort_order
  from public.opportunity_categories c
  where c.status = 'active'
  order by c.sort_order, c.label;
$$;

revoke all on function public.opportunity_list_active_categories() from public, anon, authenticated;
grant execute on function public.opportunity_list_active_categories() to service_role;

-- ── 4. Future scenarios are registered but NOT activated ───────────────────
--
-- The discovery execution path is still hard-wired to the Local Digital Presence
-- orchestration (Google Places text search -> canonical enrichment scoring).
-- These rows are seeded as `draft` so they are invisible to the operator selector
-- until scenario-aware execution is wired. The opportunities Edge Function keeps an
-- explicit executable-scenario allow-list that must be extended deliberately.

insert into public.opportunity_scenarios (slug, name, description, status, version, discovery_config)
values
  ('website-improvement', 'Website Improvement', 'Find businesses whose website quality is the primary opportunity.', 'draft', 1, '{"provider": "google_places", "execution_supported": false}'::jsonb),
  ('local-search-visibility', 'Local Search Visibility', 'Find businesses missing or under-represented in local search results.', 'draft', 1, '{"provider": "google_places", "execution_supported": false}'::jsonb),
  ('reputation-trust', 'Reputation & Trust', 'Find businesses with visible review or trust-signal weaknesses.', 'draft', 1, '{"provider": "google_places", "execution_supported": false}'::jsonb),
  ('lead-capture-conversion', 'Lead Capture & Conversion', 'Find businesses whose enquiry capture and conversion path is weak.', 'draft', 1, '{"provider": "google_places", "execution_supported": false}'::jsonb),
  ('automation-opportunity', 'Automation Opportunity', 'Find businesses with manual, repeatable processes worth automating.', 'draft', 1, '{"provider": "google_places", "execution_supported": false}'::jsonb),
  ('business-systems-gap', 'Business Systems Gap', 'Find businesses missing core operating systems and integrations.', 'draft', 1, '{"provider": "google_places", "execution_supported": false}'::jsonb)
on conflict (slug, version) do nothing;

commit;
