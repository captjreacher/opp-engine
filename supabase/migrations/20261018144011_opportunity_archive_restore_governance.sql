-- REVIEW ONLY: do not apply until lifecycle and contact-retention governance is approved.
-- Archive is independent of commercial disposition. Identity, evidence and contact history stay intact.
begin;

alter table public.local_business_leads
  add column archived_at timestamptz,
  add column archived_by text,
  add column archive_reason text;
alter table public.local_business_leads add constraint opportunity_archive_metadata_check check (
  (archived_at is null and archived_by is null and archive_reason is null)
  or (archived_at is not null and archived_by is not null)
);
create index local_business_leads_active_updated_idx on public.local_business_leads(updated_at desc) where archived_at is null;

-- Invoker functions retain existing RLS. The API is the only shared-token boundary;
-- authenticated/anon cannot invoke the lifecycle RPC or change lifecycle metadata.
create function public.opportunity_guard_lead_lifecycle() returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'permanent_deletion_unavailable' using errcode = '42501',
      detail = 'Lead identity and related contact/evidence history must be retained.';
  end if;
  if tg_op = 'INSERT' then
    if new.archived_at is not null or new.archived_by is not null or new.archive_reason is not null then
      raise exception 'create_active_opportunity_first' using errcode = '42501';
    end if;
    return new;
  end if;
  if row(new.archived_at, new.archived_by, new.archive_reason) is distinct from
     row(old.archived_at, old.archived_by, old.archive_reason) then
    if current_user not in ('service_role', 'postgres') then
      raise exception 'lifecycle_operator_required' using errcode = '42501';
    end if;
    if (to_jsonb(new) - array['archived_at','archived_by','archive_reason','updated_at']) is distinct from
       (to_jsonb(old) - array['archived_at','archived_by','archive_reason','updated_at']) then
      raise exception 'lifecycle_only_update_required' using errcode = '22023';
    end if;
    if old.archived_at is null and new.archived_at is not null then
      -- Do not infer that a raw enriching state is safe merely because it looks stale.
      if old.enrichment_status = 'enriching' then
        raise exception 'enrichment_running' using errcode = 'P0001';
      end if;
      -- An approved draft is the existing SMTP in-flight barrier. Its approval and
      -- send completion take this same parent lock via the child-write guard.
      if exists (select 1 from public.local_business_outreach_drafts where lead_id = old.id and status = 'approved') then
        raise exception 'approved_outreach_conflict' using errcode = 'P0001';
      end if;
      new.archived_at := transaction_timestamp();
      new.archived_by := 'operator-console';
      new.archive_reason := nullif(btrim(new.archive_reason), '');
      if length(new.archive_reason) > 500 then raise exception 'archive_reason_too_long' using errcode = '22023'; end if;
    elsif old.archived_at is not null and new.archived_at is null then
      new.archived_by := null;
      new.archive_reason := null;
    else
      raise exception 'archive_metadata_immutable' using errcode = '42501';
    end if;
  elsif old.archived_at is not null and (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then
    raise exception 'opportunity_archived' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger opportunity_guard_lead_lifecycle before insert or update or delete on public.local_business_leads
for each row execute function public.opportunity_guard_lead_lifecycle();

-- Audit insertion and state mutation commit together; an audit failure rolls back the archive/restore.
create function public.opportunity_audit_lifecycle() returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if (old.archived_at is null) is distinct from (new.archived_at is null) then
    insert into public.opportunity_console_audit_log(action, lead_id, actor, metadata)
    values (case when new.archived_at is null then 'opportunity_restored' else 'opportunity_archived' end,
      new.id, 'operator-console', jsonb_build_object(
        'business_name', new.business_name, 'pipeline_status', new.status,
        'archived_at', coalesce(new.archived_at, old.archived_at),
        'reason', coalesce(new.archive_reason, old.archive_reason), 'credential_scope', 'shared_operator'));
  end if;
  return new;
end;
$$;
create trigger opportunity_audit_lifecycle after update of archived_at on public.local_business_leads
for each row execute function public.opportunity_audit_lifecycle();

create function public.set_opportunity_archived(p_lead_id uuid, p_archived boolean, p_reason text default null)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_lead public.local_business_leads%rowtype;
begin
  if p_archived is null then raise exception 'archive_state_required' using errcode = '22023'; end if;
  select * into v_lead from public.local_business_leads where id = p_lead_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if (v_lead.archived_at is not null) = p_archived then
    return jsonb_build_object('ok', true, 'id', v_lead.id, 'archived_at', v_lead.archived_at,
      'archived_by', v_lead.archived_by, 'archive_reason', v_lead.archive_reason, 'idempotent', true);
  end if;
  update public.local_business_leads set
    archived_at = case when p_archived then transaction_timestamp() else null end,
    archived_by = case when p_archived then 'operator-console' else null end,
    archive_reason = case when p_archived then nullif(btrim(p_reason), '') else null end,
    updated_at = transaction_timestamp()
  where id = p_lead_id returning * into v_lead;
  return jsonb_build_object('ok', true, 'id', v_lead.id, 'archived_at', v_lead.archived_at,
    'archived_by', v_lead.archived_by, 'archive_reason', v_lead.archive_reason, 'idempotent', false);
end;
$$;
revoke all on function public.set_opportunity_archived(uuid,boolean,text) from public, anon, authenticated;
grant execute on function public.set_opportunity_archived(uuid,boolean,text) to service_role;

-- Serialize operational writes with archive on the parent row, including direct
-- queue/worker paths. Lock both parents on reassignment so archived evidence cannot be moved out.
create function public.opportunity_guard_archived_child() returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_old uuid; v_new uuid; v_parent record;
begin
  if tg_op <> 'INSERT' then v_old := old.lead_id; end if;
  if tg_op <> 'DELETE' then v_new := new.lead_id; end if;
  for v_parent in select id, archived_at from public.local_business_leads
    where id in (v_old, v_new) order by id for update
  loop
    if v_parent.archived_at is not null then
      -- A sent message may still need its existing Cockpit handoff bookkeeping.
      -- Allow only those fields, never subject/body/status/recipient changes.
      if tg_table_name = 'local_business_outreach_drafts' and tg_op = 'UPDATE' then
        if old.status = 'sent' and current_user in ('service_role', 'postgres')
           and (to_jsonb(new) - array['cockpit_handoff_status','cockpit_contact_id','cockpit_handoff_error','cockpit_handed_off_at','updated_at'])
            = (to_jsonb(old) - array['cockpit_handoff_status','cockpit_contact_id','cockpit_handoff_error','cockpit_handed_off_at','updated_at']) then
          continue;
        end if;
      end if;
      raise exception 'opportunity_archived' using errcode = 'P0001';
    end if;
  end loop;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
do $$ declare t text; begin
  foreach t in array array['local_business_lead_assessments','local_business_audit_reports',
    'local_business_outreach_drafts','local_business_visual_evidence','local_business_visual_assessments',
    'local_business_lead_signals','opportunity_batch_members']
  loop
    if to_regclass('public.' || t) is not null then
      execute format('create trigger opportunity_guard_archived_child before insert or update or delete on public.%I for each row execute function public.opportunity_guard_archived_child()', t);
    end if;
  end loop;
end $$;
-- Lifecycle audit records are immutable. Review/outcome events also take the
-- parent lock: a pre-checked HTTP request cannot advance an archived workflow.
create function public.opportunity_guard_lifecycle_event() returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_old uuid; v_parent record;
begin
  if tg_op <> 'INSERT' then
    if old.action in ('opportunity_archived','opportunity_restored') then
      raise exception 'lifecycle_history_immutable' using errcode = '42501';
    end if;
    v_old := old.lead_id;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if tg_op = 'UPDATE' and new.action in ('opportunity_archived','opportunity_restored') then
    raise exception 'lifecycle_history_immutable' using errcode = '42501';
  end if;
  if new.action in ('opportunity_review_started','opportunity_review_completed','opportunity_contact_ready',
    'outreach_awaiting_response','outreach_replied','meeting_booked','opportunity_converted','opportunity_closed') then
    for v_parent in select id, archived_at from public.local_business_leads
      where id in (v_old, new.lead_id) order by id for update
    loop
      if v_parent.archived_at is not null then
        raise exception 'opportunity_archived' using errcode = 'P0001';
      end if;
    end loop;
  end if;
  return new;
end;
$$;
create trigger opportunity_guard_lifecycle_event before insert or update or delete on public.opportunity_console_audit_log
for each row execute function public.opportunity_guard_lifecycle_event();
revoke all on function public.opportunity_guard_lifecycle_event() from public, anon, authenticated;
grant execute on function public.opportunity_guard_lifecycle_event() to service_role;
-- Trigger functions are not callable APIs. Existing RLS policies and Cockpit tables stay unchanged.
revoke all on function public.opportunity_guard_lead_lifecycle() from public, anon, authenticated;
revoke all on function public.opportunity_audit_lifecycle() from public, anon, authenticated;
revoke all on function public.opportunity_guard_archived_child() from public, anon, authenticated;
grant execute on function public.opportunity_guard_lead_lifecycle() to service_role;
grant execute on function public.opportunity_audit_lifecycle() to service_role;
grant execute on function public.opportunity_guard_archived_child() to service_role;
commit;
