-- Opportunity Console — additive schema for the standalone app.
-- Creates ONE read-only view for the board endpoint. No existing objects are
-- modified; no data is touched. Safe to apply.
--
-- Access: the Edge Function queries this view with the service role. We keep the
-- view OFF the anon/authenticated grant path (belt-and-suspenders) so prospect
-- intelligence is never reachable with the public anon key.

CREATE OR REPLACE VIEW public.v_opportunity_list
WITH (security_invoker = on) AS
SELECT
  l.id,
  l.business_name,
  COALESCE(l.suburb, l.region)              AS location,
  COALESCE(l.category, l.categories->>0)     AS industry,
  l.status                                   AS pipeline_status,
  a.opportunity_score,
  a.demand_signal_score,
  a.trust_leakage_score,
  a.conversion_maturity_score,
  a.ai_readiness_score,
  a.recommended_outreach_angle,
  a.assessed_at,
  (r.lead_id IS NOT NULL)                    AS has_audit,
  od.status                                  AS outreach_status,
  l.updated_at
FROM public.local_business_leads l
LEFT JOIN LATERAL (
  SELECT x.* FROM public.local_business_lead_assessments x
  WHERE x.lead_id = l.id ORDER BY x.assessed_at DESC LIMIT 1
) a ON true
LEFT JOIN LATERAL (
  SELECT ar.lead_id FROM public.local_business_audit_reports ar
  WHERE ar.lead_id = l.id ORDER BY ar.generated_at DESC LIMIT 1
) r ON true
LEFT JOIN LATERAL (
  SELECT d.status FROM public.local_business_outreach_drafts d
  WHERE d.lead_id = l.id ORDER BY d.created_at DESC LIMIT 1
) od ON true;

-- Keep the view off the public API roles; service role bypasses this anyway.
REVOKE ALL ON public.v_opportunity_list FROM anon, authenticated;
