-- Review-only GBP scenario definitions and snapshot storage. These rows are
-- deliberately draft; the existing discovery allow-list does not execute them.
begin;

alter table public.local_business_outreach_drafts
  add column if not exists gbp_commercial_snapshot jsonb;

create unique index if not exists local_business_outreach_one_gbp_draft_per_lead
  on public.local_business_outreach_drafts
  (lead_id)
  where gbp_commercial_snapshot is not null;

insert into public.opportunity_scenarios
  (slug, name, description, status, version, discovery_config,
   assessment_config, report_config, outreach_config, commercial_config)
values
  ('gbp-setup', 'G01 — GBP Setup', 'Evidence-led GBP setup opportunity; fixed-price qualification requires customer confirmation.', 'draft', 1,
   '{"provider":"google_places","requires_human_review":true}'::jsonb,
   '{"profile":"gbp_setup_v1","required_evidence":["documented_profile_search","human_review"]}'::jsonb,
   '{"template":"gbp_setup_report_v1","commercial_snapshot_required":true}'::jsonb,
   '{"message_template":"gbp_setup_v1","requires_operator_approval":true}'::jsonb,
   '{"offer_product_id":"product-maximisedai-gbp-setup","destination":"/products/gbp-setup/","plans":{"1-3":"plan-maximisedai-gbp-setup-1-3-services","4-5":"plan-maximisedai-gbp-setup-4-5-services"}}'::jsonb),
  ('gbp-improvement', 'G02 — GBP Improvement', 'Evidence-led improvement of an existing verified profile.', 'draft', 1,
   '{"provider":"google_places","requires_human_review":true}'::jsonb,
   '{"profile":"gbp_improvement_v1","required_evidence":["matching_profile_url","specific_observation","human_review"]}'::jsonb,
   '{"template":"gbp_improvement_report_v1","commercial_snapshot_required":true}'::jsonb,
   '{"message_template":"gbp_improvement_v1","requires_operator_approval":true}'::jsonb,
   '{"offer_product_id":"product-maximisedai-gbp-improvement","destination":"/products/gbp-improvement/","plans":{"1-3":"plan-maximisedai-gbp-improvement-1-3-services","4-5":"plan-maximisedai-gbp-improvement-4-5-services"}}'::jsonb)
on conflict (slug, version) do nothing;

insert into public.opportunity_outreach_templates
  (id, version, name, scenario_keys, combined, subject, body, offer_id,
   destination, destination_verified_at, enabled)
values
  ('9f6c67f4-33d8-4d84-97f1-2b07e4210a01', 1, 'gbp_setup_v1', array['G01'], false,
   'GBP Setup for {{business_name}}', 'Kia ora {{business_name}}, {{findings}}',
   'product-maximisedai-gbp-setup', 'https://maximisedai.com/products/gbp-setup/', null, false),
  ('9f6c67f4-33d8-4d84-97f1-2b07e4210a02', 1, 'gbp_improvement_v1', array['G02'], false,
   'GBP Improvement for {{business_name}}', 'Kia ora {{business_name}}, {{findings}}',
   'product-maximisedai-gbp-improvement', 'https://maximisedai.com/products/gbp-improvement/', null, false)
on conflict (id) do nothing;

commit;
