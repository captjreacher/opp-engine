-- Opportunity Engine Scenario Registry v1 compatibility layer.
--
-- Existing application code does not yet send scenario provenance explicitly.
-- These triggers preserve current behaviour by applying the seeded default
-- scenario until the API/UI begins selecting scenarios directly.

begin;

create or replace function public.opportunity_default_scenario_snapshot()
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', s.id,
    'slug', s.slug,
    'name', s.name,
    'version', s.version,
    'discovery_config', s.discovery_config,
    'assessment_config', s.assessment_config,
    'report_config', s.report_config,
    'outreach_config', s.outreach_config,
    'commercial_config', s.commercial_config
  )
  from public.opportunity_scenarios s
  where s.slug = 'local-digital-presence-v1'
    and s.status = 'active'
  limit 1;
$$;

create or replace function public.opportunity_apply_default_discovery_scenario()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_scenario public.opportunity_scenarios%rowtype;
begin
  if new.scenario_id is not null then
    if new.scenario_version is null or new.scenario_snapshot is null then
      select * into v_scenario
      from public.opportunity_scenarios
      where id = new.scenario_id;

      if not found then
        raise exception 'scenario_not_found' using errcode = 'P0002';
      end if;

      new.scenario_version := coalesce(new.scenario_version, v_scenario.version);
      new.scenario_snapshot := coalesce(
        new.scenario_snapshot,
        jsonb_build_object(
          'id', v_scenario.id,
          'slug', v_scenario.slug,
          'name', v_scenario.name,
          'version', v_scenario.version,
          'discovery_config', v_scenario.discovery_config,
          'assessment_config', v_scenario.assessment_config,
          'report_config', v_scenario.report_config,
          'outreach_config', v_scenario.outreach_config,
          'commercial_config', v_scenario.commercial_config
        )
      );
    end if;
    return new;
  end if;

  select * into v_scenario
  from public.opportunity_scenarios
  where slug = 'local-digital-presence-v1'
    and status = 'active'
  limit 1;

  if not found then
    raise exception 'default_opportunity_scenario_missing' using errcode = 'P0002';
  end if;

  new.scenario_id := v_scenario.id;
  new.scenario_version := v_scenario.version;
  new.scenario_snapshot := jsonb_build_object(
    'id', v_scenario.id,
    'slug', v_scenario.slug,
    'name', v_scenario.name,
    'version', v_scenario.version,
    'discovery_config', v_scenario.discovery_config,
    'assessment_config', v_scenario.assessment_config,
    'report_config', v_scenario.report_config,
    'outreach_config', v_scenario.outreach_config,
    'commercial_config', v_scenario.commercial_config
  );

  return new;
end;
$$;

drop trigger if exists trg_opportunity_discovery_runs_default_scenario on public.opportunity_discovery_runs;
create trigger trg_opportunity_discovery_runs_default_scenario
  before insert on public.opportunity_discovery_runs
  for each row execute function public.opportunity_apply_default_discovery_scenario();

create or replace function public.opportunity_apply_default_output_scenario()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_version integer;
begin
  if new.scenario_id is not null then
    if new.scenario_version is null then
      select version into v_version
      from public.opportunity_scenarios
      where id = new.scenario_id;
      if v_version is null then
        raise exception 'scenario_not_found' using errcode = 'P0002';
      end if;
      new.scenario_version := v_version;
    end if;
    return new;
  end if;

  select id, version into v_id, v_version
  from public.opportunity_scenarios
  where slug = 'local-digital-presence-v1'
    and status = 'active'
  limit 1;

  if v_id is null then
    raise exception 'default_opportunity_scenario_missing' using errcode = 'P0002';
  end if;

  new.scenario_id := v_id;
  new.scenario_version := v_version;

  return new;
end;
$$;

drop trigger if exists trg_local_business_assessments_default_scenario on public.local_business_lead_assessments;
create trigger trg_local_business_assessments_default_scenario
  before insert on public.local_business_lead_assessments
  for each row execute function public.opportunity_apply_default_output_scenario();

drop trigger if exists trg_local_business_audits_default_scenario on public.local_business_audit_reports;
create trigger trg_local_business_audits_default_scenario
  before insert on public.local_business_audit_reports
  for each row execute function public.opportunity_apply_default_output_scenario();

drop trigger if exists trg_local_business_outreach_default_scenario on public.local_business_outreach_drafts;
create trigger trg_local_business_outreach_default_scenario
  before insert on public.local_business_outreach_drafts
  for each row execute function public.opportunity_apply_default_output_scenario();

create or replace function public.opportunity_list_active_scenarios()
returns table (
  id uuid,
  slug text,
  name text,
  description text,
  version integer,
  discovery_config jsonb,
  assessment_config jsonb,
  report_config jsonb,
  outreach_config jsonb,
  commercial_config jsonb
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    s.id,
    s.slug,
    s.name,
    s.description,
    s.version,
    s.discovery_config,
    s.assessment_config,
    s.report_config,
    s.outreach_config,
    s.commercial_config
  from public.opportunity_scenarios s
  where s.status = 'active'
  order by s.name, s.version desc;
$$;

revoke all on function public.opportunity_default_scenario_snapshot() from public, anon, authenticated;
revoke all on function public.opportunity_list_active_scenarios() from public, anon, authenticated;
grant execute on function public.opportunity_default_scenario_snapshot() to service_role;
grant execute on function public.opportunity_list_active_scenarios() to service_role;

commit;
