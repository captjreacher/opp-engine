-- Queue enrichment requests durably from Postgres using pg_net.
-- The request is only enqueued after the transaction commits, so the API can
-- acknowledge immediately while local-business-enrich still owns execution.

create extension if not exists pg_net with schema net;

create or replace function public.queue_local_business_enrichment(
  p_lead_id uuid,
  p_project_url text,
  p_operator_token text,
  p_retry boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = public, net
as $$
declare
  v_lead record;
  v_request_id bigint;
  v_now timestamptz := now();
  v_url text;
  v_body jsonb;
begin
  if coalesce(btrim(p_project_url), '') = '' then
    return jsonb_build_object(
      'ok', false,
      'error', 'missing_project_url',
      'lead_id', p_lead_id
    );
  end if;

  if coalesce(btrim(p_operator_token), '') = '' then
    return jsonb_build_object(
      'ok', false,
      'error', 'missing_operator_token',
      'lead_id', p_lead_id
    );
  end if;

  select
    id,
    enrichment_status,
    enrichment_diagnostics
  into v_lead
  from public.local_business_leads
  where id = p_lead_id
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'error', 'not_found',
      'lead_id', p_lead_id
    );
  end if;

  if v_lead.enrichment_status = 'enriching' then
    return jsonb_build_object(
      'ok', false,
      'error', 'enrichment_in_progress',
      'lead_id', p_lead_id,
      'enrichment_status', v_lead.enrichment_status
    );
  end if;

  update public.local_business_leads
  set
    enrichment_status = 'enriching',
    enrichment_diagnostics =
      coalesce(v_lead.enrichment_diagnostics, '{}'::jsonb)
      || jsonb_build_object(
        'queue_requested_at', v_now,
        'queue_retry', p_retry,
        'queue_target', 'local-business-enrich'
      )
  where id = p_lead_id;

  insert into public.opportunity_console_audit_log (
    action,
    lead_id,
    actor,
    metadata
  ) values (
    'enrichment_requested',
    p_lead_id,
    'operator-console',
    jsonb_build_object(
      'retry', p_retry,
      'enrichment_status', 'enriching',
      'requested_at', v_now
    )
  );

  begin
    v_url := rtrim(p_project_url, '/') || '/functions/v1/local-business-enrich';
    v_body := jsonb_build_object(
      'lead_id', p_lead_id,
      'action', case when p_retry then 'reenrich' else 'enrich' end,
      'source', 'opportunity-engine',
      'retry', p_retry
    );

    v_request_id := net.http_post(
      url := v_url,
      body := v_body,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || p_operator_token
      ),
      timeout_milliseconds := 110000
    );
  exception
    when others then
      update public.local_business_leads
      set
        enrichment_status = 'failed',
        enrichment_diagnostics =
          coalesce(v_lead.enrichment_diagnostics, '{}'::jsonb)
          || jsonb_build_object(
            'queue_requested_at', v_now,
            'queue_failed_at', now(),
            'queue_retry', p_retry,
            'failure_reason', left(SQLERRM, 500)
          )
      where id = p_lead_id;

      insert into public.opportunity_console_audit_log (
        action,
        lead_id,
        actor,
        metadata
      ) values (
        'enrichment_failed',
        p_lead_id,
        'operator-console',
        jsonb_build_object(
          'retry', p_retry,
          'stage', 'queue',
          'detail', left(SQLERRM, 500)
        )
      );

      return jsonb_build_object(
        'ok', false,
        'error', 'enrichment_queue_failed',
        'detail', left(SQLERRM, 500),
        'lead_id', p_lead_id,
        'enrichment_status', 'failed'
      );
  end;

  return jsonb_build_object(
    'ok', true,
    'status', 'accepted',
    'lead_id', p_lead_id,
    'enrichment_status', 'enriching',
    'request_id', v_request_id
  );
end;
$$;

revoke all on function public.queue_local_business_enrichment(uuid, text, text, boolean) from public, anon, authenticated;
grant execute on function public.queue_local_business_enrichment(uuid, text, text, boolean) to service_role;
