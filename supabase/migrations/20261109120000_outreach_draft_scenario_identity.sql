-- Preserve explicit multi-scenario Website draft identity instead of applying
-- the single generic output-scenario default to a combined selection.
begin;

create or replace function public.opportunity_apply_default_output_scenario()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_version integer;
begin
  if tg_table_name = 'local_business_outreach_drafts' then
    if jsonb_typeof(new.selection->'scenario_identities') = 'array'
       and jsonb_array_length(new.selection->'scenario_identities') > 1 then
      if new.scenario_id is not null or new.scenario_version is not null then
        raise exception 'combined_outreach_scenario_identity_ambiguous' using errcode = '22023';
      end if;
      return new;
    end if;
  end if;

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
  where slug = 'local-digital-presence'
    and status = 'active'
  order by version desc
  limit 1;

  if v_id is null then
    raise exception 'default_opportunity_scenario_missing' using errcode = 'P0002';
  end if;

  new.scenario_id := v_id;
  new.scenario_version := v_version;
  return new;
end;
$$;

commit;
