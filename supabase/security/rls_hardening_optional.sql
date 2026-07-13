-- OPTIONAL, PROJECT-WIDE security hardening — NOT required by the standalone app.
-- =============================================================================
-- Context: 19 tables in `public` have Row Level Security DISABLED while anon/
-- authenticated hold table grants -> they are readable/writable with the public
-- anon key. NONE of these are used by the Opportunity Console (which only touches
-- the local_business_* family + events, all already RLS-protected against anon).
--
-- This script closes the anon hole WITHOUT breaking existing service-role or
-- authenticated flows: it enables RLS and adds an `authenticated`-role ALL policy
-- (mirroring the pattern already on the local_business_* tables). The service
-- role bypasses RLS, so backend jobs are unaffected; anon (no policy) is denied.
--
-- ⚠️ Review before applying: if any PUBLIC/anon surface currently reads these
-- tables with the anon key, that reader must move to a service-role function
-- first, or it will break. Do NOT apply blindly.

DO $$
DECLARE t text;
DECLARE tables text[] := ARRAY[
  'event_routes','paperclip_execution_queue','event_taxonomy','event_type_aliases',
  'cockpit_operator_workflows','cockpit_operator_modes','cockpit_operator_mode_workflows',
  'cockpit_operator_journeys','cockpit_operator_journey_steps','cockpit_journey_outcomes',
  'of_creator_automation_scenarios','of_simulated_subscribers','of_conversation_instances',
  'of_conversation_history','of_automation_rules','of_automation_simulations',
  'of_queues','of_queue_items','of_automation_audit_trail'
];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true);',
      t || '_authenticated_all', t
    );
  END LOOP;
END $$;
