begin;
-- Reconciles the preserved PR #16 owner snapshot onto the company-unique scenario ledger.
-- REVIEW ONLY: shared Cockpit retention and maintenance policy approval is still required.
create or replace function public.opportunity_guard_lead_lifecycle() returns trigger
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
  -- Preserve legacy status pending the shared Cockpit conversion decision.
  if old.status = 'archived' then
    raise exception 'legacy_archive_review_required' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.opportunity_outreach_send_claims where lead_id = old.id and state <> 'sent')
     and (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then
    raise exception 'send_in_progress' using errcode = 'P0001';
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
      -- Approval is a conservative pre-send conflict; durable claims above
      -- protect the entire external SMTP lifetime, including uncertain delivery.
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
revoke all on function public.opportunity_guard_lead_lifecycle() from public,anon,authenticated;
grant execute on function public.opportunity_guard_lead_lifecycle() to service_role;
create or replace function public.set_opportunity_archived(p_lead_id uuid, p_archived boolean, p_reason text default null)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_lead public.local_business_leads%rowtype;
begin
  if p_archived is null then raise exception 'archive_state_required' using errcode = '22023'; end if;
  select * into v_lead from public.local_business_leads where id = p_lead_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if v_lead.status = 'archived' then
    raise exception 'legacy_archive_review_required' using errcode = 'P0001';
  end if;
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
revoke all on function public.set_opportunity_archived(uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.set_opportunity_archived(uuid,boolean,text) to service_role;
create or replace function public.opportunity_evidence_owners(p_table text, p_row jsonb) returns uuid[]
language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_ids uuid[] := '{}'::uuid[]; v_row jsonb; v_id uuid;
begin
  if p_row is null then return v_ids; end if;
  v_id := (p_row->>'lead_id')::uuid;
  if v_id is not null then v_ids := array_append(v_ids, v_id); end if;
  if p_table = 'opportunity_discovery_candidates' then
    v_ids := v_ids || array[(p_row->>'imported_lead_id')::uuid, (p_row->>'duplicate_lead_id')::uuid];
  end if;
  if p_row->>'assessment_id' is not null then
    if p_table = 'local_business_visual_findings' then
      select to_jsonb(a) into v_row from public.local_business_visual_assessments a where id = (p_row->>'assessment_id')::uuid for share;
      v_ids := v_ids || public.opportunity_evidence_owners('local_business_visual_assessments', v_row);
    elsif p_table in ('local_business_audit_reports','opportunity_scenario_reports') then
      select to_jsonb(a) into v_row from public.local_business_lead_assessments a where id = (p_row->>'assessment_id')::uuid for share;
      v_ids := v_ids || public.opportunity_evidence_owners('local_business_lead_assessments', v_row);
    end if;
  end if;
  if p_table = 'local_business_visual_assessments' and p_row->>'evidence_id' is not null then
    select to_jsonb(e) into v_row from public.local_business_visual_evidence e where id = (p_row->>'evidence_id')::uuid for share;
    v_ids := v_ids || public.opportunity_evidence_owners('local_business_visual_evidence', v_row);
  end if;
  if p_row->>'candidate_id' is not null then
    select to_jsonb(c) into v_row from public.opportunity_discovery_candidates c where id = (p_row->>'candidate_id')::uuid for share;
    v_ids := v_ids || public.opportunity_evidence_owners('opportunity_discovery_candidates', v_row);
  end if;
  return array(select distinct x from unnest(v_ids) x where x is not null order by x);
end;
$$;
revoke all on function public.opportunity_evidence_owners(text,jsonb) from public,anon,authenticated;
grant execute on function public.opportunity_evidence_owners(text,jsonb) to service_role;
create or replace function public.opportunity_guard_archived_child() returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_old uuid[] := '{}'; v_new uuid[] := '{}'; v_parent record; v_claim record;
begin
  if tg_op <> 'INSERT' then v_old := public.opportunity_evidence_owners(tg_table_name, to_jsonb(old)); end if;
  if tg_op <> 'DELETE' then v_new := public.opportunity_evidence_owners(tg_table_name, to_jsonb(new)); end if;
  for v_parent in select id, archived_at, status from public.local_business_leads
    where id = any(v_old || v_new) order by id for update
  loop
    if v_parent.archived_at is not null or v_parent.status = 'archived' then
      -- Discovery may record a duplicate identity match, not start work or
      -- unlink a retained owner. This preserves the existing dedup import RPC.
      if tg_table_name = 'opportunity_discovery_candidates' and tg_op = 'UPDATE' then
        if (cardinality(v_old) = 0 or v_old = v_new)
           and (to_jsonb(new) - array['imported_lead_id','duplicate_lead_id','import_status','eligibility_status','eligibility_result','error_info','updated_at'])
             = (to_jsonb(old) - array['imported_lead_id','duplicate_lead_id','import_status','eligibility_status','eligibility_result','error_info','updated_at']) then
          continue;
        end if;
      end if;
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
  if cardinality(v_new) > 1 then
    raise exception 'evidence_owner_mismatch' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and v_old is distinct from v_new then
    if tg_table_name = 'opportunity_discovery_candidates' then
      if exists (select 1 from public.local_business_visual_evidence where candidate_id=old.id and lead_id is not null and not (lead_id=any(v_new)))
         or exists (select 1 from public.local_business_visual_assessments where candidate_id=old.id and lead_id is not null and not (lead_id=any(v_new))) then
        raise exception 'evidence_owner_mismatch' using errcode = 'P0001';
      end if;
      if cardinality(v_old)>0 and (exists(select 1 from public.local_business_visual_evidence where candidate_id=old.id)
         or exists(select 1 from public.local_business_visual_assessments where candidate_id=old.id)) then
        raise exception 'evidence_reparent_requires_review' using errcode = 'P0001';
      end if;
    elsif tg_table_name = 'local_business_visual_evidence' then
      if exists(select 1 from public.local_business_visual_assessments where evidence_id=old.id) then
        raise exception 'evidence_reparent_requires_review' using errcode = 'P0001';
      end if;
    elsif tg_table_name = 'local_business_visual_assessments' then
      if exists(select 1 from public.local_business_visual_findings where assessment_id=old.id) then
        raise exception 'evidence_reparent_requires_review' using errcode = 'P0001';
      end if;
    elsif tg_table_name = 'local_business_lead_assessments' then
      if exists(select 1 from public.local_business_audit_reports where assessment_id=old.id) or exists(select 1 from public.opportunity_scenario_reports where assessment_id=old.id) then
        raise exception 'evidence_reparent_requires_review' using errcode = 'P0001';
      end if;
    end if;
  end if;
  if tg_table_name = 'local_business_outreach_drafts' and tg_op <> 'INSERT' then
    select state into v_claim from public.opportunity_outreach_send_claims where draft_id = old.id;
    if found then
      if v_claim.state <> 'sent' or tg_op = 'DELETE' then
        raise exception 'send_in_progress' using errcode = 'P0001';
      end if;
      if (to_jsonb(new) - array['status','sent_at','cockpit_handoff_status','cockpit_contact_id','cockpit_handoff_error','cockpit_handed_off_at','updated_at'])
         is distinct from (to_jsonb(old) - array['status','sent_at','cockpit_handoff_status','cockpit_contact_id','cockpit_handoff_error','cockpit_handed_off_at','updated_at'])
         or new.status <> 'sent' or new.sent_at is null then
        raise exception 'sent_draft_immutable' using errcode = '42501';
      end if;
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.opportunity_guard_archived_child() from public,anon,authenticated;
grant execute on function public.opportunity_guard_archived_child() to service_role;
create or replace function public.opportunity_guard_lifecycle_event() returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_old uuid; v_old_action text; v_new_action text; v_new uuid; v_parent record;
  v_workflow text[] := array['opportunity_review_started','opportunity_review_completed','opportunity_contact_ready',
    'outreach_awaiting_response','outreach_replied','meeting_booked','opportunity_converted','opportunity_closed'];
begin
  if tg_op <> 'INSERT' then
    if old.action in ('opportunity_archived','opportunity_restored','outreach_send_claimed','outreach_send_uncertain','outreach_send_failed','outreach_sent') then
      raise exception 'lifecycle_history_immutable' using errcode = '42501';
    end if;
    v_old := old.lead_id;
    v_old_action := old.action;
  end if;
  if tg_op <> 'DELETE' then v_new := new.lead_id; v_new_action := new.action; end if;
  if tg_op = 'UPDATE' and new.action in ('opportunity_archived','opportunity_restored','outreach_send_claimed','outreach_send_uncertain','outreach_send_failed','outreach_sent') then
    raise exception 'lifecycle_history_immutable' using errcode = '42501';
  end if;
  if v_old_action = any(v_workflow) or v_new_action = any(v_workflow) then
    for v_parent in select id, archived_at, status from public.local_business_leads
      where id in (v_old, v_new) order by id for update
    loop
      if v_parent.archived_at is not null or v_parent.status = 'archived' then
        raise exception 'opportunity_archived' using errcode = 'P0001';
      end if;
    end loop;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.opportunity_guard_lifecycle_event() from public,anon,authenticated;
grant execute on function public.opportunity_guard_lifecycle_event() to service_role;
create or replace function public.opportunity_guard_send_claim() returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_draft public.local_business_outreach_drafts%rowtype; v_lead public.local_business_leads%rowtype;
begin
  if tg_op = 'DELETE' then raise exception 'send_claim_history_immutable' using errcode = '42501'; end if;
  if tg_op = 'UPDATE' then
    if (to_jsonb(new) - array['state','completed_at']) is distinct from
       (to_jsonb(old) - array['state','completed_at','detail'])
       or old.state = 'sent' or new.state not in ('uncertain','sent') then
      raise exception 'send_claim_history_immutable' using errcode = '42501';
    end if;
    return new;
  end if;
  -- Match the existing child-write lock order: draft, then lead. Archive never
  -- locks drafts, so it cannot form a parent/child deadlock with this order.
  select * into v_draft from public.local_business_outreach_drafts where id = new.draft_id for update;
  if not found or v_draft.lead_id <> new.lead_id or v_draft.status <> 'approved' or v_draft.sent_at is not null then
    raise exception 'not_approved' using errcode = 'P0001';
  end if;
  select * into v_lead from public.local_business_leads where id = new.lead_id for update;
  if v_lead.archived_at is not null or v_lead.status = 'archived' then raise exception 'opportunity_archived' using errcode = 'P0001'; end if;
  if v_lead.enrichment_status = 'enriching' then raise exception 'enrichment_running' using errcode = 'P0001'; end if;
  if new.state <> 'sending' or new.completed_at is not null then raise exception 'invalid_send_claim' using errcode = '22023'; end if;
  return new;
end;
$$;
revoke all on function public.opportunity_guard_send_claim() from public,anon,authenticated;
grant execute on function public.opportunity_guard_send_claim() to service_role;
create or replace function public.opportunity_guard_retained_truncate() returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if current_user <> 'postgres' then
    raise exception 'permanent_deletion_unavailable' using errcode = '42501',
      detail = 'Owner-led maintenance requires its existing separate approval and backup process.';
  end if;
  return null;
end;
$$;
revoke all on function public.opportunity_guard_retained_truncate() from public,anon,authenticated;
grant execute on function public.opportunity_guard_retained_truncate() to service_role;
grant execute on function public.opportunity_evidence_owners(text,jsonb) to authenticated;
grant select(draft_id,lead_id,state) on public.opportunity_outreach_send_claims to authenticated;
create policy opportunity_send_state_for_visible_leads on public.opportunity_outreach_send_claims for select to authenticated using (exists(select 1 from public.local_business_leads l where l.id=opportunity_outreach_send_claims.lead_id));
create trigger opportunity_guard_send_claim before insert on public.opportunity_outreach_send_claims for each row execute function public.opportunity_guard_send_claim();
create trigger opportunity_guard_archived_child before insert or update or delete on public.local_business_visual_findings for each row execute function public.opportunity_guard_archived_child();
create trigger opportunity_guard_archived_child before insert or update or delete on public.opportunity_discovery_candidates for each row execute function public.opportunity_guard_archived_child();
create trigger opportunity_guard_retained_truncate before truncate on public.local_business_leads for each statement execute function public.opportunity_guard_retained_truncate();
create trigger opportunity_guard_retained_truncate before truncate on public.local_business_lead_assessments for each statement execute function public.opportunity_guard_retained_truncate();
create trigger opportunity_guard_retained_truncate before truncate on public.local_business_audit_reports for each statement execute function public.opportunity_guard_retained_truncate();
create trigger opportunity_guard_retained_truncate before truncate on public.local_business_outreach_drafts for each statement execute function public.opportunity_guard_retained_truncate();
create trigger opportunity_guard_retained_truncate before truncate on public.local_business_visual_evidence for each statement execute function public.opportunity_guard_retained_truncate();
create trigger opportunity_guard_retained_truncate before truncate on public.local_business_visual_assessments for each statement execute function public.opportunity_guard_retained_truncate();
create trigger opportunity_guard_retained_truncate before truncate on public.local_business_visual_findings for each statement execute function public.opportunity_guard_retained_truncate();
create trigger opportunity_guard_retained_truncate before truncate on public.local_business_lead_signals for each statement execute function public.opportunity_guard_retained_truncate();
create trigger opportunity_guard_retained_truncate before truncate on public.local_business_lead_events for each statement execute function public.opportunity_guard_retained_truncate();
create trigger opportunity_guard_retained_truncate before truncate on public.opportunity_batch_members for each statement execute function public.opportunity_guard_retained_truncate();
create trigger opportunity_guard_retained_truncate before truncate on public.opportunity_discovery_candidates for each statement execute function public.opportunity_guard_retained_truncate();
create trigger opportunity_guard_retained_truncate before truncate on public.opportunity_console_audit_log for each statement execute function public.opportunity_guard_retained_truncate();
create trigger opportunity_guard_retained_truncate before truncate on public.opportunity_outreach_send_claims for each statement execute function public.opportunity_guard_retained_truncate();
create trigger opportunity_guard_retained_truncate before truncate on public.opportunity_scenario_reports for each statement execute function public.opportunity_guard_retained_truncate();
create trigger opportunity_guard_retained_truncate before truncate on public.opportunity_company_scenarios for each statement execute function public.opportunity_guard_retained_truncate();
commit;
