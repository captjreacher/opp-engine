-- Enrichment execution-budget recovery.
--
-- WHY
-- ---
-- local-business-enrich is queued through pg_net with a hard 110s request
-- envelope, but the function's own budget was larger than the envelope and was
-- only enforced between tiers. A slow tier (or the unguarded DuckDuckGo
-- fallback crawl) therefore ran past the envelope, pg_net abandoned the request,
-- and NOTHING could move the lead out of `enriching` -- a dead invocation cannot
-- clean up after itself.
--
-- WHAT
-- ----
-- 1. queue_local_business_enrichment() now distinguishes an ACTIVE run from a
--    STALE one. Active runs are still refused (no concurrent enrichment of the
--    same lead); stale runs may be reclaimed and re-queued.
-- 2. Each queued run carries an enrichment_claim_id. The edge function records
--    the same claim and refuses to act when a different, fresh claim already
--    owns the lead, so a superseded run cannot write canonical fields or create
--    duplicate completion events.
-- 3. reclaim_stale_enrichments() sweeps abandoned `enriching` leads for
--    operators (and any scheduled caller) without touching canonical fields.
--
-- The architecture is unchanged: still one call into local-business-enrich, still
-- pg_net, still no job framework. These are additive safety rules.
--
-- INVARIANT (mirrored from supabase/functions/_shared/enrichmentBudget.ts):
--   provider/search budget  = 75s   (OVERALL_ENRICHMENT_BUDGET_MS)
--   in-flight watchdog stop = 80s   (+ HARD_STOP_MARGIN_MS = 5s)
--   pg_net request envelope = 110s
--   stale reclaim threshold = 180s  (STALE_ENRICHMENT_AFTER_MS)
-- Because 180s > 110s, reclaiming can never overlap a live invocation, so a
-- stale retry is always safe.

-- ─────────────────────────────────────────────────────────────────────────────
-- Helpers
-- ─────────────────────────────────────────────────────────────────────────────

-- Read the queue timestamp out of enrichment_diagnostics without ever throwing
-- on hand-edited or legacy diagnostics payloads.
create or replace function public.opportunity_enrichment_queued_at(
  p_diagnostics jsonb
)
returns timestamptz
language sql
stable
set search_path = public
as $$
  select case
    when p_diagnostics is null then null
    when coalesce(p_diagnostics ->> 'queue_requested_at', '') ~ '^\d{4}-\d{2}-\d{2}'
      then (p_diagnostics ->> 'queue_requested_at')::timestamptz
    else null
  end;
$$;

comment on function public.opportunity_enrichment_queued_at(jsonb) is
  'Queue timestamp recorded by queue_local_business_enrichment; null when absent or malformed.';

-- Only enrich `enriching` leads when there is no live run, so the sweep can use a
-- partial index instead of scanning every lead.
create index if not exists local_business_leads_enriching_idx
  on public.local_business_leads (enrichment_status)
  where enrichment_status = 'enriching';

-- ─────────────────────────────────────────────────────────────────────────────
-- Queue RPC (signature unchanged; stale-aware and claim-scoped)
-- ─────────────────────────────────────────────────────────────────────────────

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
  c_stale_after constant interval := interval '3 minutes';
  v_lead record;
  v_request_id bigint;
  v_now timestamptz := now();
  v_url text;
  v_body jsonb;
  v_claim_id uuid := gen_random_uuid();
  v_generation integer := 1;
  v_stale boolean := false;
  v_prior_queued_at timestamptz;
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

  v_prior_queued_at := public.opportunity_enrichment_queued_at(v_lead.enrichment_diagnostics);

  -- Generation increments on every re-queue so an earlier (superseded) attempt
  -- can always be traced back from the claim it owned.
  v_generation := case
    when (v_lead.enrichment_diagnostics ->> 'queue_generation') ~ '^[0-9]+$'
      then (v_lead.enrichment_diagnostics ->> 'queue_generation')::integer + 1
    else 1
  end;

  if v_lead.enrichment_status = 'enriching' then
    if v_prior_queued_at is not null and v_now - v_prior_queued_at < c_stale_after then
      -- ACTIVE run: refuse. The same lead is never enriched concurrently.
      return jsonb_build_object(
        'ok', false,
        'error', 'enrichment_in_progress',
        'lead_id', p_lead_id,
        'enrichment_status', v_lead.enrichment_status,
        'queue_requested_at', v_prior_queued_at,
        'enrichment_claim_id', v_lead.enrichment_diagnostics ->> 'enrichment_claim_id',
        'stale_after_ms', (extract(epoch from c_stale_after) * 1000)::bigint,
        'retryable', true
      );
    end if;

    -- STALE run: the invocation that owned this lead is gone (it hard-stops at
    -- 80s and pg_net abandons it at 110s, both far below this threshold). It
    -- cannot clean up after itself, so reclaim it here and re-queue. Canonical
    -- lead fields are never modified -- only status, diagnostics and the log.
    v_stale := true;

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
        'stage', 'stale_reclaim',
        'retry', p_retry,
        'prior_queue_requested_at', v_prior_queued_at,
        -- Trace the attempt being superseded: which claim owned it and which
        -- generation it belonged to.
        'prior_enrichment_claim_id', v_lead.enrichment_diagnostics ->> 'enrichment_claim_id',
        'prior_queue_generation', v_lead.enrichment_diagnostics ->> 'queue_generation',
        'stale_after_ms', (extract(epoch from c_stale_after) * 1000)::bigint,
        'detail', 'stale enriching run reclaimed by queue_local_business_enrichment'
      )
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
        'queue_target', 'local-business-enrich',
        'queue_generation', v_generation,
        'enrichment_claim_id', v_claim_id,
        'enrichment_terminal_status', 'enriching',
        'execution_budget_ms', 75000,
        'stale_after_ms', (extract(epoch from c_stale_after) * 1000)::bigint,
        'stale_reclaimed', v_stale,
        'stale_reclaimed_prior_run_at', case when v_stale then v_prior_queued_at else null end,
        'stale_reclaimed_prior_claim_id',
          case when v_stale then v_lead.enrichment_diagnostics ->> 'enrichment_claim_id' else null end,
        'stale_reclaimed_prior_queue_generation',
          case when v_stale then v_lead.enrichment_diagnostics ->> 'queue_generation' else null end,
        'budget_exhausted', false,
        'budget_stop_tier', null
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
      'requested_at', v_now,
      'queue_generation', v_generation,
      'stale_reclaimed', v_stale
    )
  );

  begin
    v_url := rtrim(p_project_url, '/') || '/functions/v1/local-business-enrich';
    v_body := jsonb_build_object(
      'lead_id', p_lead_id,
      'action', case when p_retry then 'reenrich' else 'enrich' end,
      'source', 'opportunity-engine',
      'retry', p_retry,
      -- Claim fence: the function refuses to act if a different, fresh claim
      -- already owns this lead, so a superseded request is inert.
      'claim_id', v_claim_id,
      'generation', v_generation
    );

    v_request_id := net.http_post(
      url := v_url,
      body := v_body,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || p_operator_token
      ),
      -- pg_net envelope. The function itself stops provider work at 80s and
      -- leaves the remainder for lead resolution, DB writes, events and
      -- response serialization.
      timeout_milliseconds := 110000
    );
  exception
    when others then
      -- Merge the failure into the CURRENT row's diagnostics. `v_lead` is the
      -- PRE-queue snapshot, so rebuilding from it would erase the run record
      -- this call just wrote: queue_requested_at, queue_generation,
      -- enrichment_claim_id, the stale-reclaim metadata and the execution
      -- budget. Only the terminal failure fields are added here.
      update public.local_business_leads
      set
        enrichment_status = 'failed',
        enrichment_diagnostics =
          coalesce(enrichment_diagnostics, '{}'::jsonb)
          || jsonb_build_object(
            'queue_failed_at', now(),
            'enrichment_terminal_status', 'failed',
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
    'request_id', v_request_id,
    'enrichment_claim_id', v_claim_id,
    'queue_generation', v_generation,
    'stale_reclaimed', v_stale,
    'stale_after_ms', (extract(epoch from c_stale_after) * 1000)::bigint
  );
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Operator sweep for leads abandoned before this change (or by a hard crash)
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.reclaim_stale_enrichments(
  p_stale_after interval default interval '3 minutes',
  p_limit integer default 50
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  -- Never reclaim below the pg_net envelope; a shorter window could mark a live
  -- run as failed.
  c_min_stale_after constant interval := interval '3 minutes';
  v_threshold interval := greatest(coalesce(p_stale_after, c_min_stale_after), c_min_stale_after);
  v_now timestamptz := now();
  v_row record;
  v_reclaimed jsonb := '[]'::jsonb;
  v_count integer := 0;
begin
  for v_row in
    select
      l.id,
      coalesce(public.opportunity_enrichment_queued_at(l.enrichment_diagnostics), l.updated_at) as stale_since,
      l.enrichment_diagnostics ->> 'enrichment_claim_id' as prior_claim_id,
      l.enrichment_diagnostics ->> 'queue_generation' as prior_queue_generation
    from public.local_business_leads l
    where l.enrichment_status = 'enriching'
      and coalesce(public.opportunity_enrichment_queued_at(l.enrichment_diagnostics), l.updated_at)
        < v_now - v_threshold
    order by coalesce(public.opportunity_enrichment_queued_at(l.enrichment_diagnostics), l.updated_at) asc
    limit greatest(1, least(coalesce(p_limit, 50), 200))
    for update skip locked
  loop
    -- Terminal state only: no canonical field is written, and a retry afterwards
    -- refills only fields that are still empty.
    update public.local_business_leads
    set
      enrichment_status = 'failed',
      enrichment_diagnostics =
        coalesce(enrichment_diagnostics, '{}'::jsonb)
        || jsonb_build_object(
          'failure_reason', 'stale_enrichment_reclaimed',
          'stale_reclaimed_at', v_now,
          'stale_since', v_row.stale_since,
          'stale_reclaimed_prior_claim_id', v_row.prior_claim_id,
          'stale_reclaimed_prior_queue_generation', v_row.prior_queue_generation,
          'stale_after_ms', (extract(epoch from v_threshold) * 1000)::bigint,
          'enrichment_terminal_status', 'failed',
          'budget_stop_tier', null,
          'reclaimed_by', 'reclaim_stale_enrichments'
        )
    where id = v_row.id;

    insert into public.opportunity_console_audit_log (
      action,
      lead_id,
      actor,
      metadata
    ) values (
      'enrichment_failed',
      v_row.id,
      'operator-console',
      jsonb_build_object(
        'stage', 'stale_reclaim',
        'stale_since', v_row.stale_since,
        'swept_at', v_now,
        'prior_enrichment_claim_id', v_row.prior_claim_id,
        'prior_queue_generation', v_row.prior_queue_generation,
        'stale_after_ms', (extract(epoch from v_threshold) * 1000)::bigint
      )
    );

    v_count := v_count + 1;
    v_reclaimed := v_reclaimed || to_jsonb(v_row.id);
  end loop;

  return jsonb_build_object(
    'ok', true,
    'reclaimed', v_count,
    'lead_ids', v_reclaimed,
    'stale_after_ms', (extract(epoch from v_threshold) * 1000)::bigint,
    'swept_at', v_now
  );
end;
$$;

comment on function public.queue_local_business_enrichment(uuid, text, text, boolean) is
  'Marks a lead enriching, then queues local-business-enrich through pg_net and returns immediately. Refuses an ACTIVE run; reclaims a STALE one.';

comment on function public.reclaim_stale_enrichments(interval, integer) is
  'Marks abandoned `enriching` leads as failed so they never show an endless spinner. Status and diagnostics only; canonical fields untouched.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Access: service role only (same posture as the original queue RPC)
-- ─────────────────────────────────────────────────────────────────────────────

revoke all on function public.opportunity_enrichment_queued_at(jsonb) from public, anon, authenticated;
grant execute on function public.opportunity_enrichment_queued_at(jsonb) to service_role;

revoke all on function public.queue_local_business_enrichment(uuid, text, text, boolean) from public, anon, authenticated;
grant execute on function public.queue_local_business_enrichment(uuid, text, text, boolean) to service_role;

revoke all on function public.reclaim_stale_enrichments(interval, integer) from public, anon, authenticated;
grant execute on function public.reclaim_stale_enrichments(interval, integer) to service_role;
