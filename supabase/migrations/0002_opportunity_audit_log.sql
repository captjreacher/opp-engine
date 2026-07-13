-- Opportunity Console — app-owned audit log (additive; no existing objects touched).
-- Records operator actions (e.g. outreach draft generation). This is the STANDALONE
-- app's own log — deliberately NOT wired into the MGRNZ canonical `events` system or
-- `local_business_lead_events` (which mirrors to events via trigger), per the
-- "no cockpit / event-routing integration" constraint.

CREATE TABLE IF NOT EXISTS public.opportunity_console_audit_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action     text NOT NULL,
  lead_id    uuid,                       -- soft ref to local_business_leads.id (no FK: keep decoupled)
  draft_id   uuid,                       -- soft ref to local_business_outreach_drafts.id
  actor      text NOT NULL DEFAULT 'operator-console',
  metadata   jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Lock to the service role only (Edge Function). Deny the public API roles.
ALTER TABLE public.opportunity_console_audit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.opportunity_console_audit_log FROM anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_oca_log_lead    ON public.opportunity_console_audit_log(lead_id);
CREATE INDEX IF NOT EXISTS idx_oca_log_created ON public.opportunity_console_audit_log(created_at DESC);

COMMENT ON TABLE public.opportunity_console_audit_log IS
  'Standalone Opportunity Console operator action log (draft generation, etc). App-owned; not part of the MGRNZ canonical event system.';
