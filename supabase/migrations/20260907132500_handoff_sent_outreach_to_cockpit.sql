-- Successful first-send handoff from Opportunity Engine to Cockpit.
--
-- DEPENDENCY: MGRNZ migration 20260907131000_opportunity_outbound_handoff.sql
-- must be applied first because this migration calls public.ingest_outbound_prospect.
--
-- The existing send flow writes `status=sent` after SMTP succeeds and then inserts
-- an `outreach_sent` row into opportunity_console_audit_log with metadata including
-- `live` and `overridden`. This migration attaches to that audit event so:
--   * test/override sends never create a contacted Cockpit lead;
--   * Cockpit failure cannot roll back sent status or cause SMTP retry;
--   * handoff can be retried independently and idempotently.

begin;

alter table public.local_business_outreach_drafts
  add column if not exists cockpit_handoff_status text not null default 'not_started',
  add column if not exists cockpit_contact_id uuid references public.contacts(id) on delete set null,
  add column if not exists cockpit_handoff_error text,
  add column if not exists cockpit_handed_off_at timestamptz;

alter table public.local_business_outreach_drafts
  drop constraint if exists local_business_outreach_drafts_cockpit_handoff_status_chk;
alter table public.local_business_outreach_drafts
  add constraint local_business_outreach_drafts_cockpit_handoff_status_chk
  check (cockpit_handoff_status in ('not_started', 'completed', 'failed', 'skipped'));

create index if not exists local_business_outreach_drafts_handoff_status_idx
  on public.local_business_outreach_drafts(cockpit_handoff_status, sent_at desc)
  where status = 'sent';

create or replace function public.opportunity_attempt_cockpit_handoff(
  p_draft_id uuid,
  p_send_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_draft public.local_business_outreach_drafts%rowtype;
  v_lead public.local_business_leads%rowtype;
  v_scenario_slug text;
  v_result jsonb;
  v_live boolean := coalesce((p_send_metadata->>'live')::boolean, false);
  v_overridden boolean := coalesce((p_send_metadata->>'overridden')::boolean, false);
  v_recipient text := nullif(btrim(p_send_metadata->>'recipient'), '');
begin
  select * into v_draft
  from public.local_business_outreach_drafts
  where id = p_draft_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'draft_not_found');
  end if;

  if v_draft.status <> 'sent' or v_draft.sent_at is null then
    return jsonb_build_object('ok', false, 'error', 'draft_not_sent');
  end if;

  if v_draft.cockpit_handoff_status = 'completed' then
    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'contact_id', v_draft.cockpit_contact_id,
      'handoff_status', 'completed'
    );
  end if;

  if not v_live or v_overridden then
    update public.local_business_outreach_drafts
    set
      cockpit_handoff_status = 'skipped',
      cockpit_handoff_error = null
    where id = p_draft_id;

    return jsonb_build_object(
      'ok', true,
      'idempotent', false,
      'handoff_status', 'skipped',
      'reason', case when v_overridden then 'test_override_send' else 'non_live_send' end
    );
  end if;

  select * into v_lead
  from public.local_business_leads
  where id = v_draft.lead_id;

  if not found then
    update public.local_business_outreach_drafts
    set
      cockpit_handoff_status = 'failed',
      cockpit_handoff_error = 'lead_not_found'
    where id = p_draft_id;
    return jsonb_build_object('ok', false, 'error', 'lead_not_found');
  end if;

  if v_draft.scenario_id is not null then
    select s.slug into v_scenario_slug
    from public.opportunity_scenarios s
    where s.id = v_draft.scenario_id;
  end if;

  begin
    v_result := public.ingest_outbound_prospect(
      p_source_lead_id => v_lead.id,
      p_source_outreach_id => v_draft.id,
      p_email => v_lead.email,
      p_business_name => v_lead.business_name,
      p_full_name => null,
      p_phone => v_lead.phone,
      p_sent_at => v_draft.sent_at,
      p_scenario_slug => v_scenario_slug,
      p_scenario_version => v_draft.scenario_version,
      p_metadata => jsonb_strip_nulls(jsonb_build_object(
        'transport', p_send_metadata->>'transport',
        'recipient', v_recipient,
        'opportunity_score_source', 'opportunity-engine'
      ))
    );

    update public.local_business_outreach_drafts
    set
      cockpit_handoff_status = 'completed',
      cockpit_contact_id = nullif(v_result->>'contact_id', '')::uuid,
      cockpit_handoff_error = null,
      cockpit_handed_off_at = now()
    where id = p_draft_id;

    return jsonb_build_object(
      'ok', true,
      'handoff_status', 'completed',
      'contact_id', v_result->>'contact_id',
      'cockpit_result', v_result
    );
  exception when others then
    update public.local_business_outreach_drafts
    set
      cockpit_handoff_status = 'failed',
      cockpit_handoff_error = left(sqlerrm, 500)
    where id = p_draft_id;

    return jsonb_build_object(
      'ok', false,
      'handoff_status', 'failed',
      'error', left(sqlerrm, 500)
    );
  end;
end;
$$;

create or replace function public.opportunity_handoff_after_sent_audit()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.action = 'outreach_sent' and new.draft_id is not null then
    -- Never raise from this trigger. The prospect email has already been sent;
    -- Cockpit handoff is an independently retryable post-send operation.
    perform public.opportunity_attempt_cockpit_handoff(new.draft_id, new.metadata);
  end if;
  return new;
exception when others then
  return new;
end;
$$;

drop trigger if exists trg_opportunity_handoff_after_sent_audit
  on public.opportunity_console_audit_log;
create trigger trg_opportunity_handoff_after_sent_audit
  after insert on public.opportunity_console_audit_log
  for each row execute function public.opportunity_handoff_after_sent_audit();

create or replace function public.opportunity_retry_cockpit_handoff(p_draft_id uuid)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_metadata jsonb;
begin
  select a.metadata into v_metadata
  from public.opportunity_console_audit_log a
  where a.draft_id = p_draft_id
    and a.action = 'outreach_sent'
  order by a.created_at desc, a.id desc
  limit 1;

  if v_metadata is null then
    return jsonb_build_object('ok', false, 'error', 'sent_audit_not_found');
  end if;

  return public.opportunity_attempt_cockpit_handoff(p_draft_id, v_metadata);
end;
$$;

revoke all on function public.opportunity_attempt_cockpit_handoff(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.opportunity_retry_cockpit_handoff(uuid) from public, anon, authenticated;
grant execute on function public.opportunity_attempt_cockpit_handoff(uuid, jsonb) to service_role;
grant execute on function public.opportunity_retry_cockpit_handoff(uuid) to service_role;

comment on function public.opportunity_retry_cockpit_handoff(uuid) is
  'Retries only the idempotent Cockpit Contact handoff for an already-sent live outreach; it never sends email.';

commit;
