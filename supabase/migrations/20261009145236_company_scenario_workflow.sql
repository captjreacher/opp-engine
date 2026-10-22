begin;

alter table public.opportunity_discovery_runs add column scenario_set jsonb not null default '[]';
alter table public.opportunity_discovery_candidates add column scenario_matches jsonb not null default '[]';
alter table public.local_business_lead_assessments add column scenario_matches jsonb not null default '[]', add column score_explanation jsonb not null default '{}';
create table public.opportunity_company_scenarios (
  lead_id uuid not null references public.local_business_leads(id) on delete cascade,
  scenario_key text not null,
  scenario_id uuid not null references public.opportunity_scenarios(id),
  scenario_version integer not null,
  state text not null check (state in ('confirmed','uncertain','unassessed')),
  evidence jsonb not null default '[]', assessed_at timestamptz not null,
  score numeric check (score between 0 and 100),
  primary key (lead_id,scenario_key)
);
alter table public.opportunity_company_scenarios enable row level security;
revoke all on public.opportunity_company_scenarios from public,anon,authenticated;
grant all on public.opportunity_company_scenarios to service_role;

alter table public.opportunity_batches add column archived_at timestamptz;
alter table public.opportunity_batch_members add column released_at timestamptz;
-- Never choose a company's batch implicitly. Resolve legacy overlaps through an
-- explicit reviewed membership decision before applying this migration.
do $$ begin
  if exists(select lead_id from public.opportunity_batch_members group by lead_id having count(*)>1) then
    raise exception 'legacy_batch_overlap_requires_manual_resolution';
  end if;
end; $$;
create unique index opportunity_one_active_batch on public.opportunity_batch_members(lead_id) where released_at is null;
-- Reuse the foundation transaction, but lock company rows in deterministic order
-- and reject retries against archived batches.
create or replace function public.create_opportunity_batch(p_batch_id uuid,p_name text,p_lead_ids uuid[],p_record_filter jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare v_count integer; v_existing public.opportunity_batches;
begin
  if p_batch_id is null or p_name is null or char_length(trim(p_name)) not between 1 and 120
    or p_record_filter is null or jsonb_typeof(p_record_filter)<>'object' then raise exception 'invalid_batch_details'; end if;
  select count(distinct x) into v_count from unnest(p_lead_ids) x;
  if v_count<2 or v_count>500 or array_position(p_lead_ids,null) is not null then raise exception 'select_between_2_and_500_opportunities'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_batch_id::text,0));
  select * into v_existing from public.opportunity_batches where id=p_batch_id;
  if found then
    if v_existing.archived_at is not null then raise exception 'batch_archived'; end if;
    if (select array_agg(lead_id order by lead_id) from public.opportunity_batch_members where batch_id=p_batch_id)
      is distinct from (select array_agg(distinct x order by x) from unnest(p_lead_ids) x) then raise exception 'batch_identifier_conflict'; end if;
    return to_jsonb(v_existing);
  end if;
  perform id from public.local_business_leads where id=any(p_lead_ids) order by id for update;
  if (select count(*) from public.local_business_leads where id=any(p_lead_ids) and status<>'disqualified')<>v_count then raise exception 'opportunity_missing_or_not_suitable'; end if;
  if exists(select 1 from public.opportunity_batch_members where lead_id=any(p_lead_ids) and released_at is null) then raise exception 'company_already_in_active_batch'; end if;
  insert into public.opportunity_batches(id,name,record_filter) values(p_batch_id,trim(p_name),p_record_filter);
  insert into public.opportunity_batch_members(batch_id,lead_id) select p_batch_id,x from (select distinct unnest(p_lead_ids) x) ids;
  select * into v_existing from public.opportunity_batches where id=p_batch_id;
  return to_jsonb(v_existing);
end; $$;
create function public.guard_active_batch_member() returns trigger language plpgsql security invoker set search_path=public as $$
begin
  perform id from public.local_business_leads where id=new.lead_id for update;
  perform id from public.opportunity_batches where id=new.batch_id for share;
  if new.released_at is null and exists(select 1 from public.opportunity_batches where id=new.batch_id and archived_at is not null) then
    raise exception 'batch_archived';
  end if;
  return new;
end; $$;
create trigger guard_active_batch_member before insert or update on public.opportunity_batch_members for each row execute function public.guard_active_batch_member();
revoke all on function public.guard_active_batch_member() from public,anon,authenticated;
grant execute on function public.guard_active_batch_member() to service_role;

-- Serialize discovery imports and assessments for each canonical company.
-- Reimporting incomplete evidence cannot overwrite confirmed assessment findings.
create function public.persist_opportunity_company_scenarios(p_lead_id uuid,p_matches jsonb,p_replace boolean default false)
returns void language plpgsql security invoker set search_path=public as $$
begin
  perform id from public.local_business_leads where id=p_lead_id for update;
  if not found then raise exception 'company_missing'; end if;
  insert into public.opportunity_company_scenarios
    (lead_id,scenario_key,scenario_id,scenario_version,state,evidence,assessed_at,score)
  select p_lead_id,m.scenario_key,m.scenario_id,m.scenario_version,m.state,m.evidence,m.assessed_at,m.score
  from jsonb_to_recordset(p_matches) m(scenario_key text,scenario_id uuid,scenario_version integer,state text,evidence jsonb,assessed_at timestamptz,score numeric)
  on conflict(lead_id,scenario_key) do update set
    scenario_id=excluded.scenario_id,scenario_version=excluded.scenario_version,
    state=excluded.state,evidence=excluded.evidence,assessed_at=excluded.assessed_at,score=excluded.score
  where p_replace or opportunity_company_scenarios.state<>'confirmed';
end; $$;
revoke all on function public.persist_opportunity_company_scenarios(uuid,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.persist_opportunity_company_scenarios(uuid,jsonb,boolean) to service_role;

create function public.move_opportunity_batch_member(p_lead_id uuid,p_from uuid,p_to uuid) returns void language plpgsql security invoker set search_path=public as $$
begin
  if p_from=p_to then raise exception 'same_batch'; end if;
  perform id from public.local_business_leads where id=p_lead_id for update;
  perform id from public.opportunity_batches where id in (p_from,p_to) order by id for update;
  if not exists(select 1 from public.opportunity_batches where id=p_to and archived_at is null) then raise exception 'destination_batch_not_active'; end if;
  update public.opportunity_batch_members set released_at=now() where lead_id=p_lead_id and batch_id=p_from and released_at is null;
  if not found then raise exception 'membership_changed'; end if;
  insert into public.opportunity_batch_members(batch_id,lead_id) values(p_to,p_lead_id)
  on conflict(batch_id,lead_id) do update set released_at=null;
  insert into public.opportunity_console_audit_log(action,lead_id,actor,metadata)
  values('batch_member_moved',p_lead_id,'operator-console',jsonb_build_object('from',p_from,'to',p_to));
end; $$;
revoke all on function public.move_opportunity_batch_member(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.move_opportunity_batch_member(uuid,uuid,uuid) to service_role;

create function public.archive_opportunity_batch(p_batch_id uuid) returns void language plpgsql security invoker set search_path=public as $$
begin
  perform l.id from public.local_business_leads l join public.opportunity_batch_members m on m.lead_id=l.id where m.batch_id=p_batch_id order by l.id for update of l;
  update public.opportunity_batches set archived_at=now() where id=p_batch_id and archived_at is null;
  if not found then raise exception 'batch_missing_or_archived'; end if;
  update public.opportunity_batch_members set released_at=now() where batch_id=p_batch_id and released_at is null;
end; $$;
revoke all on function public.archive_opportunity_batch(uuid) from public,anon,authenticated;
grant execute on function public.archive_opportunity_batch(uuid) to service_role;

-- Shared mapping configuration, deliberately empty: Billing identities and dedicated
-- landing pages must be verified before an operator enables a template. No prices.
create table public.opportunity_outreach_templates (
  id uuid primary key default gen_random_uuid(), version integer not null check(version>0),
  name text not null, scenario_keys text[] not null check(cardinality(scenario_keys)>0),
  combined boolean not null default false, subject text not null, body text not null,
  offer_id text not null, destination text, destination_verified_at timestamptz,
  enabled boolean not null default false,
  check(not enabled or (destination is not null and destination like 'https://%' and destination_verified_at is not null)),
  check(combined or cardinality(scenario_keys)=1)
);
alter table public.opportunity_outreach_templates enable row level security;
revoke all on public.opportunity_outreach_templates from public,anon,authenticated;
grant all on public.opportunity_outreach_templates to service_role;
alter table public.local_business_outreach_drafts add column selection jsonb;
-- Claiming a send serializes concurrent requests. A failed/ambiguous SMTP request
-- keeps its claim for explicit reconciliation rather than risking a duplicate send.
create table public.opportunity_outreach_send_claims (
  draft_id uuid primary key references public.local_business_outreach_drafts(id),
  lead_id uuid not null unique references public.local_business_leads(id),
  claimed_at timestamptz not null default now()
);
alter table public.opportunity_outreach_send_claims enable row level security;
revoke all on public.opportunity_outreach_send_claims from public,anon,authenticated;
grant all on public.opportunity_outreach_send_claims to service_role;
commit;
