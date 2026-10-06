create table public.opportunity_batches (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  purpose text not null default '' check (char_length(purpose) <= 2000),
  record_filter jsonb not null default '{}'::jsonb check (jsonb_typeof(record_filter) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.opportunity_batch_members (
  batch_id uuid not null references public.opportunity_batches(id) on delete cascade,
  lead_id uuid not null references public.local_business_leads(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (batch_id, lead_id)
);
create index opportunity_batch_members_lead_idx on public.opportunity_batch_members(lead_id);
alter table public.opportunity_batches enable row level security;
alter table public.opportunity_batch_members enable row level security;
revoke all on public.opportunity_batches, public.opportunity_batch_members from public, anon, authenticated;
grant all on public.opportunity_batches, public.opportunity_batch_members to service_role;

-- Batch creation and tagging are atomic and retryable. Browser access stays
-- behind the operator-authenticated Edge Function.
create function public.create_opportunity_batch(p_batch_id uuid, p_name text, p_lead_ids uuid[], p_record_filter jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare v_count integer; v_existing public.opportunity_batches;
begin
  if p_batch_id is null or p_name is null or char_length(trim(p_name)) not between 1 and 120
    or p_record_filter is null or jsonb_typeof(p_record_filter) <> 'object' then
    raise exception 'invalid_batch_details';
  end if;
  select count(distinct x) into v_count from unnest(p_lead_ids) x;
  if v_count < 2 or v_count > 500 or array_position(p_lead_ids, null) is not null then
    raise exception 'select_between_2_and_500_opportunities';
  end if;
  -- Serialize retries of the same batch identifier.
  perform pg_advisory_xact_lock(hashtextextended(p_batch_id::text, 0));
  select * into v_existing from public.opportunity_batches where id = p_batch_id;
  if found then
    if (select array_agg(lead_id order by lead_id) from public.opportunity_batch_members where batch_id = p_batch_id)
      is distinct from (select array_agg(distinct x order by x) from unnest(p_lead_ids) x) then
      raise exception 'batch_identifier_conflict';
    end if;
    return to_jsonb(v_existing);
  end if;
  perform id from public.local_business_leads where id = any(p_lead_ids) for update;
  if (select count(*) from public.local_business_leads where id = any(p_lead_ids) and status <> 'disqualified') <> v_count then
    raise exception 'opportunity_missing_or_not_suitable';
  end if;
  insert into public.opportunity_batches(id, name, record_filter) values (p_batch_id, trim(p_name), p_record_filter);
  insert into public.opportunity_batch_members(batch_id, lead_id) select p_batch_id, x from (select distinct unnest(p_lead_ids) x) ids;
  select * into v_existing from public.opportunity_batches where id = p_batch_id;
  return to_jsonb(v_existing);
end;
$$;
revoke all on function public.create_opportunity_batch(uuid,text,uuid[],jsonb) from public, anon, authenticated;
grant execute on function public.create_opportunity_batch(uuid,text,uuid[],jsonb) to service_role;
