# Phase 5 discovery architecture

## Boundary and source

`opp-engine` remains standalone. React calls only the `opportunities` Edge Function with the existing
operator bearer token. The function calls Google Places using `GOOGLE_PLACES_API_KEY`; no service-role
or provider credential reaches the browser.

The canonical intelligence implementation lives at:

`C:\Users\user\Local Sites\mgrnz\app\supabase\functions\local-business-enrich`

It is deployed in Supabase project `mgrnz-web` (`jqfodlzcsgfocyuawzyx`) as
`local-business-enrich`. It owns identity-gated enrichment and scoring across Google Places, Exa and
web fallbacks. `opp-engine` calls it by canonical lead UUID and does not copy its scoring model. The
older `local-business-assess` function is legacy and is not used.

## Flow

1. **Discovery** — `POST /discovery-runs` persists a queued run and schedules a background Places
   search. Provider rows are candidates, not leads.
2. **Duplicate matching** — Maps URL, canonical website and normalized business-name/location matching
   flag existing leads before import.
3. **Import** — a service-role-only Postgres function locks the normalized identity, rechecks for a
   canonical match, and returns that UUID or inserts one `local_business_leads` row.
4. **Enrichment and scoring** — the API invokes `local-business-enrich`, which persists canonical lead
   fields, `local_business_lead_assessments`, and events.
5. **Audit** — the API reads the latest canonical assessment/evidence and writes the established
   `local_business_audit_reports.metadata_json.report_model`. Lead/assessment/version matching makes
   retries idempotent.
6. **Opportunity workflow** — imported UUIDs appear through `v_opportunity_list`; review, outreach and
   Pipeline continue without copied data or manual database changes.

## Persistence and security

- `opportunity_discovery_runs` stores query, lifecycle, counts, failures and timestamps.
- `opportunity_discovery_candidates` stores provider identity/payload, evidence, duplicate/import UUIDs
  and per-stage statuses/errors.
- Both tables have RLS enabled, deny `anon`/`authenticated`, and are accessed only by the service role.
- Batch input is limited to 25 UUIDs and discovery results to 20.
- Imports use a transaction-level advisory lock to close concurrent duplicate races.

## Events, retry and failures

Run/candidate events append to `public.events` with source `opportunity-engine`. Imported, scored and
audited lead actions use `emit_local_business_event`, which also writes
`local_business_lead_events`. Start/completion/failure are explicit. Partial batches return per-item
errors and set `partially_completed`; failures are not silently marked complete. Failed assessment or
audit candidates can be retried. Intelligence routes contain no outreach or SMTP side effect.

## Deployment dependency

Apply `20260720052820_phase_5_discovery.sql`, confirm `local-business-enrich` is deployed, configure
`GOOGLE_PLACES_API_KEY` and optional `EXA_API_KEY` as Edge Function secrets, then deploy
`opportunities`. Canonical scorer changes are deployed from the MGRNZ repository, never copied here.
