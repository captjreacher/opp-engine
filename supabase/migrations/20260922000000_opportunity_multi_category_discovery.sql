-- Multi-category discovery intake schema extension.
--
-- Adds category_slugs, category_labels, and all_categories to opportunity_discovery_runs.
-- Backfills existing runs to preserve historical data in plural collections.

begin;

alter table public.opportunity_discovery_runs
  add column if not exists category_slugs jsonb not null default '[]'::jsonb,
  add column if not exists category_labels jsonb not null default '[]'::jsonb,
  add column if not exists all_categories boolean not null default false;

create index if not exists opportunity_discovery_runs_category_slugs_idx
  on public.opportunity_discovery_runs using gin (category_slugs);

-- Backfill legacy single-category runs into plural collection columns without modifying historical labels.
update public.opportunity_discovery_runs
set
  category_slugs = case when category_slug is not null then jsonb_build_array(category_slug) else '[]'::jsonb end,
  category_labels = case when category_label is not null then jsonb_build_array(category_label) else '[]'::jsonb end,
  all_categories = false
where category_slugs = '[]'::jsonb and (category_slug is not null or category_label is not null);

comment on column public.opportunity_discovery_runs.category_slugs is
  'Requested registry category slugs (empty array = All categories).';
comment on column public.opportunity_discovery_runs.category_labels is
  'Labels of resolved active categories searched for this run.';
comment on column public.opportunity_discovery_runs.all_categories is
  'True if the operator requested All categories for this run.';

commit;
