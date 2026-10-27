begin;

-- Website commercial configuration is additive and keeps Billing authoritative.
-- The legacy `website-improvement` slug is the existing New Website scenario.
update public.opportunity_scenarios
set
  name = 'New Website',
  description = 'Find businesses with recorded evidence of a missing website and prepare a reviewed website offer.',
  status = 'active',
  assessment_config = jsonb_build_object(
    'profile', 'new_website_v1',
    'evidence_rules', jsonb_build_array(
      jsonb_build_object(
        'path', 'enrichment.risk_flags',
        'includes', 'missing_website',
        'description', 'Recorded enrichment indicates that a website is missing.',
        'score', 100,
        'evidence_key', 'website.missing'
      )
    )
  ),
  report_config = jsonb_build_object(
    'category', 'Website',
    'potential_impact', 'A clear website destination may improve how prospective customers understand and contact the business; impact is not established by this assessment.',
    'outreach_angle', 'Discuss the recorded missing-website signal and confirm which website pathway fits the business.',
    'recommended_solution', 'Select one reviewed MaximisedAI website offer after confirming scope.'
  ),
  updated_at = now()
where slug = 'website-improvement' and version = 1;

-- Website Replacement remains intentionally unavailable. The historical
-- Website Refresh identity is retained as a decision record only; it is not a
-- sellable offer and therefore cannot be used by outreach.
insert into public.opportunity_scenarios (
  slug, name, description, status, version, discovery_config,
  assessment_config, report_config, outreach_config, commercial_config
)
values (
  'website-replacement',
  'Website Replacement',
  'Find businesses where replacing an existing website may be appropriate; commercial mapping is pending owner approval.',
  'draft',
  1,
  jsonb_build_object('provider', 'google_places', 'execution_supported', false),
  jsonb_build_object('profile', 'website_replacement_pending_v1'),
  jsonb_build_object(
    'commercial_block', 'Website Replacement is blocked until a current sellable Billing offer and dedicated destination are approved.'
  ),
  jsonb_build_object('requires_operator_approval', true),
  jsonb_build_object(
    'status', 'blocked',
    'reason', 'Historical product-maximisedai-website-refresh / plan-maximisedai-website-refresh is archived and non-sellable.'
  )
)
on conflict (slug, version) do update set
  name = excluded.name,
  description = excluded.description,
  status = excluded.status,
  discovery_config = excluded.discovery_config,
  assessment_config = excluded.assessment_config,
  report_config = excluded.report_config,
  outreach_config = excluded.outreach_config,
  commercial_config = excluded.commercial_config,
  updated_at = now();

alter table public.opportunity_outreach_templates
  add column if not exists product_id text;

-- An enabled mapping must carry the exact Billing product as well as plan and
-- destination. Existing legacy mappings remain readable but cannot be made
-- safe merely by naming a plan.
alter table public.opportunity_outreach_templates
  drop constraint if exists opportunity_outreach_templates_enabled_product_chk;
alter table public.opportunity_outreach_templates
  add constraint opportunity_outreach_templates_enabled_product_chk
  check (not enabled or product_id is not null);

-- Three approved website packages, three exact destinations. They are separate
-- templates so selection is explicit; no package is substituted automatically.
insert into public.opportunity_outreach_templates (
  name, version, scenario_keys, combined, subject, body,
  product_id, offer_id, destination, destination_verified_at,
  approved_details, enabled
)
values
(
  'New Website — Landing Page', 1, array['website-improvement'], false,
  'A website pathway for {{business_name}}',
  'Hello,\nWe recorded a missing-website signal for {{business_name}} and would be happy to discuss the right website pathway.',
  'product-maximisedai-landing-page',
  'plan-maximisedai-landing-page',
  'https://maximisedai.com/products/website-packages/landing-page/',
  '2026-10-27T00:00:00Z',
  jsonb_build_object(
    'approved_at', '2026-10-27T00:00:00Z',
    'inclusions', jsonb_build_array('Design, build and launch.'),
    'terms', jsonb_build_array('Prices are exclusive of GST.', 'MaximisedAI hosting is not compulsory.', 'Additional costs and inclusions are confirmed before commitment.')
  ), true
),
(
  'New Website — Small Business', 1, array['website-improvement'], false,
  'A website pathway for {{business_name}}',
  'Hello,\nWe recorded a missing-website signal for {{business_name}} and would be happy to discuss the right website pathway.',
  'product-maximisedai-small-business-website',
  'plan-maximisedai-small-business-website',
  'https://maximisedai.com/products/website-packages/small-business/',
  '2026-10-27T00:00:00Z',
  jsonb_build_object(
    'approved_at', '2026-10-27T00:00:00Z',
    'inclusions', jsonb_build_array('Design, build and launch.'),
    'terms', jsonb_build_array('Prices are exclusive of GST.', 'MaximisedAI hosting is not compulsory.', 'Additional costs and inclusions are confirmed before commitment.')
  ), true
),
(
  'New Website — Tradie', 1, array['website-improvement'], false,
  'A website pathway for {{business_name}}',
  'Hello,\nWe recorded a missing-website signal for {{business_name}} and would be happy to discuss the right website pathway.',
  'product-maximisedai-tradie-website',
  'plan-maximisedai-tradie-website',
  'https://maximisedai.com/products/website-packages/tradie/',
  '2026-10-27T00:00:00Z',
  jsonb_build_object(
    'approved_at', '2026-10-27T00:00:00Z',
    'inclusions', jsonb_build_array('Design, build and launch.'),
    'terms', jsonb_build_array('Prices are exclusive of GST.', 'MaximisedAI hosting is not compulsory.', 'Additional costs and inclusions are confirmed before commitment.')
  ), true
);

comment on column public.opportunity_outreach_templates.product_id is
  'Exact Billing product expected to own offer_id; prices and sellability still resolve at runtime from Billing.';

commit;
