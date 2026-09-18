-- Opportunity Engine — discovery-wide settings (operator-adjustable).
--
-- Scope: the smallest durable configuration for defaults that genuinely do not
-- belong to a single category or scenario. Categories and scenarios already own
-- their own tuning (`opportunity_categories`, `opportunity_scenarios`), so this
-- is a single-row singleton, not a configuration platform.
--
-- The Edge Function treats the code constants as HARD CEILINGS and clamps every
-- value read from this table: an operator may narrow provider usage, never widen
-- it past what the discovery path was validated against. The column checks below
-- are the database backstop for the same rule.
--
-- This migration deliberately does NOT touch Cockpit eligibility, the
-- possible_match acknowledgement contract, duplicate detection, outreach/send or
-- the RiskRegister.

begin;

create table if not exists public.opportunity_discovery_settings (
  -- Singleton: one operator-editable settings row for the whole engine.
  id text primary key default 'global' check (id = 'global'),
  -- Fallback radius for runs where neither the request, the scenario nor the
  -- category supplies one. Null = no global radius restriction.
  default_radius_m integer
    check (default_radius_m is null or default_radius_m between 100 and 50000),
  -- Operator-facing radius choices. Internally always metres; the console
  -- displays kilometres.
  radius_options_m jsonb not null
    default '[1000, 5000, 10000, 20000, 50000]'::jsonb,
  default_result_limit integer not null default 10
    check (default_result_limit between 1 and 20),
  max_result_limit integer not null default 20
    check (max_result_limit between 1 and 20),
  -- Google Places region/locale bias for location search.
  location_country_bias text not null default 'nz'
    check (location_country_bias in ('nz', 'au')),
  -- Maximum provider queries one category may expand into.
  max_search_terms integer not null default 3
    check (max_search_terms between 1 and 3),
  autocomplete_limit integer not null default 8
    check (autocomplete_limit between 1 and 10),
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint opportunity_discovery_settings_limit_order
    check (default_result_limit <= max_result_limit)
);

drop trigger if exists trg_opportunity_discovery_settings_updated_at
  on public.opportunity_discovery_settings;
create trigger trg_opportunity_discovery_settings_updated_at
  before update on public.opportunity_discovery_settings
  for each row execute function public.set_local_business_updated_at();

-- Service-role only: the browser never reaches this table, and a mutation is
-- only possible through the operator-authenticated Edge Function.
alter table public.opportunity_discovery_settings enable row level security;
revoke all on public.opportunity_discovery_settings from anon, authenticated;
grant select, insert, update on public.opportunity_discovery_settings to service_role;

-- Seed the singleton with the values the discovery path already used, so
-- enabling the console changes no behaviour until an operator edits a setting.
insert into public.opportunity_discovery_settings (id)
values ('global')
on conflict (id) do nothing;

comment on table public.opportunity_discovery_settings is
  'Singleton discovery-wide defaults for the Opportunity Engine. Code constants remain hard ceilings; values here are clamped on read.';
comment on column public.opportunity_discovery_settings.radius_options_m is
  'Operator-facing radius choices in metres (the console displays kilometres).';
comment on column public.opportunity_discovery_settings.location_country_bias is
  'Google Places region/component bias applied to location autocomplete and text search.';

commit;
