-- Production-derived target table DDL, read-only catalogue inspection 2026-10-21.
-- Empty auth.users/contacts shells preserve external FK keys; no production rows or credentials.
-- Existing provider/event/CRM execution functions are outside this migration rehearsal.
create schema if not exists auth;
create table auth.users(id uuid primary key);
create table public.contacts(id uuid primary key);
create table public."local_business_audit_reports" (
  "id" uuid default gen_random_uuid() not null,
  "lead_id" uuid not null,
  "assessment_id" uuid not null,
  "generated_at" timestamp with time zone default now() not null,
  "report_version" text not null,
  "generated_by" uuid,
  "pdf_url" text,
  "metadata_json" jsonb default '{}'::jsonb not null,
  "created_at" timestamp with time zone default now() not null,
  "scenario_id" uuid,
  "scenario_version" integer
);
create table public."local_business_lead_assessments" (
  "id" uuid default gen_random_uuid() not null,
  "lead_id" uuid not null,
  "demand_signal_score" integer default 0 not null,
  "trust_leakage_score" integer default 0 not null,
  "conversion_maturity_score" integer default 0 not null,
  "ai_readiness_score" integer default 0 not null,
  "opportunity_score" numeric(6,2) generated always as ((((demand_signal_score)::numeric * 1.5) + (trust_leakage_score)::numeric)) stored,
  "assessment_summary" text,
  "recommended_outreach_angle" text,
  "assessed_by" text default 'system'::text,
  "assessed_at" timestamp with time zone default now() not null,
  "created_at" timestamp with time zone default now() not null,
  "scenario_id" uuid,
  "scenario_version" integer,
  "assessment_profile" text
);
create table public."local_business_lead_events" (
  "id" uuid default gen_random_uuid() not null,
  "lead_id" uuid,
  "event_type" text not null,
  "status" text default 'new'::text,
  "payload" jsonb default '{}'::jsonb not null,
  "created_at" timestamp with time zone default now() not null
);
create table public."local_business_lead_signals" (
  "id" uuid default gen_random_uuid() not null,
  "lead_id" uuid not null,
  "signal_type" text not null,
  "signal_value" text,
  "confidence" numeric(4,2) default 0.50,
  "source" text default 'manual'::text,
  "evidence_url" text,
  "notes" text,
  "created_at" timestamp with time zone default now() not null
);
create table public."local_business_leads" (
  "id" uuid default gen_random_uuid() not null,
  "business_name" text not null,
  "slug" text,
  "category" text,
  "suburb" text,
  "region" text default 'Auckland'::text,
  "country" text default 'NZ'::text,
  "phone" text,
  "email" text,
  "website_url" text,
  "facebook_url" text,
  "google_maps_url" text,
  "status" text default 'discovered'::text not null,
  "source" text default 'manual'::text,
  "notes" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "trust_signal_score" integer,
  "trust_summary" text,
  "trust_flags" jsonb default '[]'::jsonb not null,
  "leadgen_id" text,
  "source_platform" text,
  "enrichment_diagnostics" jsonb default '{}'::jsonb not null,
  "enrichment_status" text default 'not_started'::text not null,
  "enriched_at" timestamp with time zone,
  "enrichment_error" text,
  "enrichment_confidence" numeric,
  "enrichment_payload" jsonb default '{}'::jsonb,
  "address" text,
  "social_links" jsonb default '[]'::jsonb not null,
  "service_areas" jsonb default '[]'::jsonb not null,
  "categories" jsonb default '[]'::jsonb not null,
  "review_signals" jsonb default '[]'::jsonb not null,
  "trust_signals" jsonb default '[]'::jsonb not null,
  "risk_flags" jsonb default '[]'::jsonb not null,
  "source_urls" jsonb default '[]'::jsonb not null,
  "confidence_score" numeric,
  "trust_score" numeric,
  "data_alignment_status" text,
  "opening_hours" jsonb
);
create table public."local_business_outreach_drafts" (
  "id" uuid default gen_random_uuid() not null,
  "lead_id" uuid not null,
  "channel" text default 'email'::text not null,
  "subject" text,
  "body" text not null,
  "status" text default 'draft'::text not null,
  "created_by" text default 'system'::text,
  "approved_by" text,
  "approved_at" timestamp with time zone,
  "sent_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "scenario_id" uuid,
  "scenario_version" integer,
  "cockpit_handoff_status" text default 'not_started'::text not null,
  "cockpit_contact_id" uuid,
  "cockpit_handoff_error" text,
  "cockpit_handed_off_at" timestamp with time zone
);
create table public."local_business_visual_assessments" (
  "id" uuid default gen_random_uuid() not null,
  "candidate_id" uuid,
  "lead_id" uuid,
  "evidence_id" uuid not null,
  "status" text default 'queued'::text not null,
  "assessment_method" text default 'vision'::text not null,
  "model_provider" text,
  "model_name" text,
  "prompt_version" text,
  "overall_confidence" numeric(5,4),
  "evidence_age_days" integer,
  "assessment_summary" text,
  "requires_operator_review" boolean default true not null,
  "assessed_at" timestamp with time zone,
  "reviewed_at" timestamp with time zone,
  "reviewed_by" text,
  "error_info" jsonb default '{}'::jsonb not null,
  "metadata" jsonb default '{}'::jsonb not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);
create table public."local_business_visual_evidence" (
  "id" uuid default gen_random_uuid() not null,
  "candidate_id" uuid,
  "lead_id" uuid,
  "source" text not null,
  "media_type" text default 'image'::text not null,
  "provider_reference" text,
  "source_url" text,
  "latitude" double precision,
  "longitude" double precision,
  "heading" numeric(6,2),
  "pitch" numeric(6,2),
  "captured_at" timestamp with time zone,
  "capture_date_precision" text,
  "discovered_at" timestamp with time zone default now() not null,
  "analysis_allowed" boolean default false not null,
  "storage_mode" text default 'reference_only'::text not null,
  "metadata" jsonb default '{}'::jsonb not null,
  "status" text default 'available'::text not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);
create table public."local_business_visual_findings" (
  "id" uuid default gen_random_uuid() not null,
  "assessment_id" uuid not null,
  "category" text not null,
  "condition" text not null,
  "severity" text,
  "confidence" numeric(5,4) not null,
  "evidence_description" text not null,
  "location_hint" text,
  "recommended_opportunity" text,
  "signal_decay_class" text default 'moderate'::text not null,
  "operator_status" text default 'pending'::text not null,
  "operator_notes" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);
create table public."opportunity_batch_members" (
  "batch_id" uuid not null,
  "lead_id" uuid not null,
  "added_at" timestamp with time zone default now() not null
);
create table public."opportunity_batches" (
  "id" uuid default gen_random_uuid() not null,
  "name" text not null,
  "purpose" text default ''::text not null,
  "record_filter" jsonb default '{}'::jsonb not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);
create table public."opportunity_categories" (
  "id" uuid default gen_random_uuid() not null,
  "slug" text not null,
  "label" text not null,
  "description" text,
  "status" text default 'active'::text not null,
  "search_terms" jsonb default '[]'::jsonb not null,
  "google_types" jsonb default '[]'::jsonb not null,
  "default_radius_m" integer,
  "compatible_scenarios" jsonb default '[]'::jsonb not null,
  "sort_order" integer default 100 not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);
create table public."opportunity_console_audit_log" (
  "id" uuid default gen_random_uuid() not null,
  "action" text not null,
  "lead_id" uuid,
  "draft_id" uuid,
  "actor" text default 'operator-console'::text not null,
  "metadata" jsonb default '{}'::jsonb not null,
  "created_at" timestamp with time zone default now() not null
);
create table public."opportunity_contact_handoffs" (
  "id" uuid default gen_random_uuid() not null,
  "source_system" text default 'opportunity-engine'::text not null,
  "source_lead_id" uuid not null,
  "source_outreach_id" uuid not null,
  "contact_id" uuid not null,
  "email" text not null,
  "business_name" text,
  "sent_at" timestamp with time zone not null,
  "scenario_slug" text,
  "scenario_version" integer,
  "metadata" jsonb default '{}'::jsonb not null,
  "created_at" timestamp with time zone default now() not null
);
create table public."opportunity_discovery_candidates" (
  "id" uuid default gen_random_uuid() not null,
  "run_id" uuid not null,
  "source" text default 'google_places'::text not null,
  "source_identifier" text not null,
  "business_name" text not null,
  "normalized_identity" text not null,
  "location" text,
  "address" text,
  "industry" text,
  "website_url" text,
  "phone" text,
  "email" text,
  "google_maps_url" text,
  "source_payload" jsonb default '{}'::jsonb not null,
  "enrichment_evidence" jsonb default '[]'::jsonb not null,
  "preliminary_signals" jsonb default '[]'::jsonb not null,
  "preliminary_score" numeric(6,2),
  "duplicate_lead_id" uuid,
  "imported_lead_id" uuid,
  "enrichment_status" text default 'not_started'::text not null,
  "assessment_status" text default 'not_started'::text not null,
  "audit_status" text default 'not_started'::text not null,
  "import_status" text default 'not_imported'::text not null,
  "error_info" jsonb default '{}'::jsonb not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "visual_status" text default 'not_started'::text not null,
  "eligibility_status" text default 'not_checked'::text not null,
  "eligibility_result" jsonb default '{}'::jsonb not null,
  "eligibility_acknowledged" boolean default false not null,
  "eligibility_acknowledged_at" timestamp with time zone,
  "eligibility_acknowledged_by" text
);
create table public."opportunity_discovery_runs" (
  "id" uuid default gen_random_uuid() not null,
  "location" text not null,
  "industry" text not null,
  "keywords" text,
  "radius_m" integer,
  "result_limit" integer default 20 not null,
  "status" text default 'queued'::text not null,
  "current_stage" text default 'queued'::text not null,
  "businesses_discovered" integer default 0 not null,
  "candidates_enriched" integer default 0 not null,
  "candidates_scored" integer default 0 not null,
  "audits_generated" integer default 0 not null,
  "failures" integer default 0 not null,
  "error_summary" jsonb default '[]'::jsonb not null,
  "created_by" text default 'operator-console'::text not null,
  "created_at" timestamp with time zone default now() not null,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "updated_at" timestamp with time zone default now() not null,
  "scenario_id" uuid,
  "scenario_version" integer,
  "scenario_snapshot" jsonb,
  "location_place_id" text,
  "location_latitude" double precision,
  "location_longitude" double precision,
  "category_id" uuid,
  "category_slug" text,
  "category_label" text,
  "discovery_terms" jsonb default '[]'::jsonb not null,
  "category_slugs" jsonb default '[]'::jsonb not null,
  "category_labels" jsonb default '[]'::jsonb not null,
  "all_categories" boolean default false not null
);
create table public."opportunity_discovery_settings" (
  "id" text default 'global'::text not null,
  "default_radius_m" integer,
  "radius_options_m" jsonb default '[1000, 5000, 10000, 20000, 50000]'::jsonb not null,
  "default_result_limit" integer default 10 not null,
  "max_result_limit" integer default 20 not null,
  "location_country_bias" text default 'nz'::text not null,
  "max_search_terms" integer default 3 not null,
  "autocomplete_limit" integer default 8 not null,
  "updated_by" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);
create table public."opportunity_scenarios" (
  "id" uuid default gen_random_uuid() not null,
  "slug" text not null,
  "name" text not null,
  "description" text,
  "status" text default 'draft'::text not null,
  "version" integer default 1 not null,
  "discovery_config" jsonb default '{}'::jsonb not null,
  "assessment_config" jsonb default '{}'::jsonb not null,
  "report_config" jsonb default '{}'::jsonb not null,
  "outreach_config" jsonb default '{}'::jsonb not null,
  "commercial_config" jsonb default '{}'::jsonb not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);
alter table public."local_business_audit_reports" add constraint "local_business_audit_reports_metadata_object" CHECK ((jsonb_typeof(metadata_json) = 'object'::text));
alter table public."local_business_audit_reports" add constraint "local_business_audit_reports_pdf_url_format" CHECK (((pdf_url IS NULL) OR (pdf_url ~* '^https?://'::text)));
alter table public."local_business_audit_reports" add constraint "local_business_audit_reports_pkey" PRIMARY KEY (id);
alter table public."local_business_lead_assessments" add constraint "local_business_lead_assessments_ai_readiness_score_check" CHECK ((ai_readiness_score >= 0));
alter table public."local_business_lead_assessments" add constraint "local_business_lead_assessments_conversion_maturity_score_check" CHECK ((conversion_maturity_score >= 0));
alter table public."local_business_lead_assessments" add constraint "local_business_lead_assessments_demand_signal_score_check" CHECK ((demand_signal_score >= 0));
alter table public."local_business_lead_assessments" add constraint "local_business_lead_assessments_pkey" PRIMARY KEY (id);
alter table public."local_business_lead_assessments" add constraint "local_business_lead_assessments_trust_leakage_score_check" CHECK ((trust_leakage_score >= 0));
alter table public."local_business_lead_events" add constraint "local_business_lead_events_pkey" PRIMARY KEY (id);
alter table public."local_business_lead_signals" add constraint "local_business_lead_signals_confidence_check" CHECK (((confidence >= (0)::numeric) AND (confidence <= (1)::numeric)));
alter table public."local_business_lead_signals" add constraint "local_business_lead_signals_pkey" PRIMARY KEY (id);
alter table public."local_business_leads" add constraint "local_business_leads_pkey" PRIMARY KEY (id);
alter table public."local_business_leads" add constraint "local_business_leads_slug_key" UNIQUE (slug);
alter table public."local_business_leads" add constraint "local_business_leads_status_check" CHECK ((status = ANY (ARRAY['discovered'::text, 'enriched'::text, 'assessed'::text, 'review_required'::text, 'approved_for_outreach'::text, 'outreach_drafted'::text, 'outreach_sent'::text, 'responded'::text, 'converted'::text, 'disqualified'::text, 'archived'::text])));
alter table public."local_business_outreach_drafts" add constraint "local_business_outreach_drafts_channel_check" CHECK ((channel = ANY (ARRAY['email'::text, 'sms'::text, 'phone'::text, 'social'::text, 'other'::text])));
alter table public."local_business_outreach_drafts" add constraint "local_business_outreach_drafts_cockpit_handoff_status_chk" CHECK ((cockpit_handoff_status = ANY (ARRAY['not_started'::text, 'completed'::text, 'failed'::text, 'skipped'::text])));
alter table public."local_business_outreach_drafts" add constraint "local_business_outreach_drafts_pkey" PRIMARY KEY (id);
alter table public."local_business_outreach_drafts" add constraint "local_business_outreach_drafts_status_check" CHECK ((status = ANY (ARRAY['draft'::text, 'pending_review'::text, 'approved'::text, 'rejected'::text, 'sent'::text, 'archived'::text])));
alter table public."local_business_visual_assessments" add constraint "local_business_visual_assessments_assessment_method_check" CHECK ((assessment_method = ANY (ARRAY['vision'::text, 'operator'::text, 'hybrid'::text])));
alter table public."local_business_visual_assessments" add constraint "local_business_visual_assessments_check" CHECK (((candidate_id IS NOT NULL) OR (lead_id IS NOT NULL)));
alter table public."local_business_visual_assessments" add constraint "local_business_visual_assessments_evidence_age_days_check" CHECK (((evidence_age_days IS NULL) OR (evidence_age_days >= 0)));
alter table public."local_business_visual_assessments" add constraint "local_business_visual_assessments_overall_confidence_check" CHECK (((overall_confidence IS NULL) OR ((overall_confidence >= (0)::numeric) AND (overall_confidence <= (1)::numeric))));
alter table public."local_business_visual_assessments" add constraint "local_business_visual_assessments_pkey" PRIMARY KEY (id);
alter table public."local_business_visual_assessments" add constraint "local_business_visual_assessments_status_check" CHECK ((status = ANY (ARRAY['queued'::text, 'assessing'::text, 'completed'::text, 'review_required'::text, 'rejected'::text, 'failed'::text])));
alter table public."local_business_visual_evidence" add constraint "local_business_visual_evidence_capture_date_precision_check" CHECK (((capture_date_precision IS NULL) OR (capture_date_precision = ANY (ARRAY['exact'::text, 'month'::text, 'year'::text, 'unknown'::text]))));
alter table public."local_business_visual_evidence" add constraint "local_business_visual_evidence_check" CHECK (((candidate_id IS NOT NULL) OR (lead_id IS NOT NULL)));
alter table public."local_business_visual_evidence" add constraint "local_business_visual_evidence_media_type_check" CHECK ((media_type = ANY (ARRAY['image'::text, 'video'::text, 'panorama'::text])));
alter table public."local_business_visual_evidence" add constraint "local_business_visual_evidence_pkey" PRIMARY KEY (id);
alter table public."local_business_visual_evidence" add constraint "local_business_visual_evidence_source_check" CHECK ((source = ANY (ARRAY['google_street_view'::text, 'google_places_photo'::text, 'operator_upload'::text, 'licensed_external'::text, 'public_web'::text])));
alter table public."local_business_visual_evidence" add constraint "local_business_visual_evidence_status_check" CHECK ((status = ANY (ARRAY['available'::text, 'unavailable'::text, 'expired'::text, 'superseded'::text, 'rejected'::text])));
alter table public."local_business_visual_evidence" add constraint "local_business_visual_evidence_storage_mode_check" CHECK ((storage_mode = ANY (ARRAY['reference_only'::text, 'temporary'::text, 'managed'::text])));
alter table public."local_business_visual_findings" add constraint "local_business_visual_findings_category_check" CHECK ((category = ANY (ARRAY['fencing'::text, 'gates'::text, 'letterbox'::text, 'mowing'::text, 'gardening'::text, 'landscaping'::text, 'concreting'::text, 'waterblasting'::text, 'exterior_paint'::text, 'windows'::text, 'exterior_cleaning'::text])));
alter table public."local_business_visual_findings" add constraint "local_business_visual_findings_confidence_check" CHECK (((confidence >= (0)::numeric) AND (confidence <= (1)::numeric)));
alter table public."local_business_visual_findings" add constraint "local_business_visual_findings_operator_status_check" CHECK ((operator_status = ANY (ARRAY['pending'::text, 'accepted'::text, 'rejected'::text, 'dismissed'::text])));
alter table public."local_business_visual_findings" add constraint "local_business_visual_findings_pkey" PRIMARY KEY (id);
alter table public."local_business_visual_findings" add constraint "local_business_visual_findings_severity_check" CHECK (((severity IS NULL) OR (severity = ANY (ARRAY['low'::text, 'moderate'::text, 'high'::text, 'urgent'::text]))));
alter table public."local_business_visual_findings" add constraint "local_business_visual_findings_signal_decay_class_check" CHECK ((signal_decay_class = ANY (ARRAY['very_fast'::text, 'fast'::text, 'moderate'::text, 'slow'::text])));
alter table public."opportunity_batch_members" add constraint "opportunity_batch_members_pkey" PRIMARY KEY (batch_id, lead_id);
alter table public."opportunity_batches" add constraint "opportunity_batches_name_check" CHECK (((char_length(name) >= 1) AND (char_length(name) <= 120)));
alter table public."opportunity_batches" add constraint "opportunity_batches_pkey" PRIMARY KEY (id);
alter table public."opportunity_batches" add constraint "opportunity_batches_purpose_check" CHECK ((char_length(purpose) <= 2000));
alter table public."opportunity_batches" add constraint "opportunity_batches_record_filter_check" CHECK ((jsonb_typeof(record_filter) = 'object'::text));
alter table public."opportunity_categories" add constraint "opportunity_categories_default_radius_m_check" CHECK (((default_radius_m IS NULL) OR ((default_radius_m >= 100) AND (default_radius_m <= 50000))));
alter table public."opportunity_categories" add constraint "opportunity_categories_pkey" PRIMARY KEY (id);
alter table public."opportunity_categories" add constraint "opportunity_categories_slug_key" UNIQUE (slug);
alter table public."opportunity_categories" add constraint "opportunity_categories_status_check" CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text])));
alter table public."opportunity_console_audit_log" add constraint "opportunity_console_audit_log_pkey" PRIMARY KEY (id);
alter table public."opportunity_contact_handoffs" add constraint "opportunity_contact_handoffs_pkey" PRIMARY KEY (id);
alter table public."opportunity_contact_handoffs" add constraint "opportunity_contact_handoffs_source_system_source_outreach__key" UNIQUE (source_system, source_outreach_id);
alter table public."opportunity_discovery_candidates" add constraint "opportunity_discovery_candida_run_id_source_source_identifi_key" UNIQUE (run_id, source, source_identifier);
alter table public."opportunity_discovery_candidates" add constraint "opportunity_discovery_candidates_assessment_status_check" CHECK ((assessment_status = ANY (ARRAY['not_started'::text, 'queued'::text, 'scoring'::text, 'scored'::text, 'partial'::text, 'failed'::text])));
alter table public."opportunity_discovery_candidates" add constraint "opportunity_discovery_candidates_audit_status_check" CHECK ((audit_status = ANY (ARRAY['not_started'::text, 'queued'::text, 'auditing'::text, 'audited'::text, 'failed'::text])));
alter table public."opportunity_discovery_candidates" add constraint "opportunity_discovery_candidates_eligibility_status_chk" CHECK ((eligibility_status = ANY (ARRAY['not_checked'::text, 'eligible'::text, 'blocked'::text, 'review_required'::text, 'failed'::text])));
alter table public."opportunity_discovery_candidates" add constraint "opportunity_discovery_candidates_enrichment_status_check" CHECK ((enrichment_status = ANY (ARRAY['not_started'::text, 'queued'::text, 'enriching'::text, 'enriched'::text, 'partial'::text, 'failed'::text])));
alter table public."opportunity_discovery_candidates" add constraint "opportunity_discovery_candidates_import_status_check" CHECK ((import_status = ANY (ARRAY['not_imported'::text, 'imported'::text, 'existing'::text, 'duplicate'::text, 'incomplete'::text, 'failed'::text])));
alter table public."opportunity_discovery_candidates" add constraint "opportunity_discovery_candidates_pkey" PRIMARY KEY (id);
alter table public."opportunity_discovery_candidates" add constraint "opportunity_discovery_candidates_visual_status_check" CHECK ((visual_status = ANY (ARRAY['not_started'::text, 'discovering'::text, 'evidence_available'::text, 'no_evidence'::text, 'assessment_queued'::text, 'assessing'::text, 'assessed'::text, 'review_required'::text, 'failed'::text])));
alter table public."opportunity_discovery_runs" add constraint "opportunity_discovery_runs_audits_generated_check" CHECK ((audits_generated >= 0));
alter table public."opportunity_discovery_runs" add constraint "opportunity_discovery_runs_businesses_discovered_check" CHECK ((businesses_discovered >= 0));
alter table public."opportunity_discovery_runs" add constraint "opportunity_discovery_runs_candidates_enriched_check" CHECK ((candidates_enriched >= 0));
alter table public."opportunity_discovery_runs" add constraint "opportunity_discovery_runs_candidates_scored_check" CHECK ((candidates_scored >= 0));
alter table public."opportunity_discovery_runs" add constraint "opportunity_discovery_runs_failures_check" CHECK ((failures >= 0));
alter table public."opportunity_discovery_runs" add constraint "opportunity_discovery_runs_pkey" PRIMARY KEY (id);
alter table public."opportunity_discovery_runs" add constraint "opportunity_discovery_runs_radius_m_check" CHECK (((radius_m IS NULL) OR ((radius_m >= 100) AND (radius_m <= 50000))));
alter table public."opportunity_discovery_runs" add constraint "opportunity_discovery_runs_result_limit_check" CHECK (((result_limit >= 1) AND (result_limit <= 50)));
alter table public."opportunity_discovery_runs" add constraint "opportunity_discovery_runs_status_check" CHECK ((status = ANY (ARRAY['queued'::text, 'discovering'::text, 'enriching'::text, 'scoring'::text, 'auditing'::text, 'completed'::text, 'partially_completed'::text, 'failed'::text, 'cancelled'::text])));
alter table public."opportunity_discovery_settings" add constraint "opportunity_discovery_settings_autocomplete_limit_check" CHECK (((autocomplete_limit >= 1) AND (autocomplete_limit <= 10)));
alter table public."opportunity_discovery_settings" add constraint "opportunity_discovery_settings_default_radius_m_check" CHECK (((default_radius_m IS NULL) OR ((default_radius_m >= 100) AND (default_radius_m <= 50000))));
alter table public."opportunity_discovery_settings" add constraint "opportunity_discovery_settings_default_result_limit_check" CHECK (((default_result_limit >= 1) AND (default_result_limit <= 20)));
alter table public."opportunity_discovery_settings" add constraint "opportunity_discovery_settings_id_check" CHECK ((id = 'global'::text));
alter table public."opportunity_discovery_settings" add constraint "opportunity_discovery_settings_limit_order" CHECK ((default_result_limit <= max_result_limit));
alter table public."opportunity_discovery_settings" add constraint "opportunity_discovery_settings_location_country_bias_check" CHECK ((location_country_bias = ANY (ARRAY['nz'::text, 'au'::text])));
alter table public."opportunity_discovery_settings" add constraint "opportunity_discovery_settings_max_result_limit_check" CHECK (((max_result_limit >= 1) AND (max_result_limit <= 20)));
alter table public."opportunity_discovery_settings" add constraint "opportunity_discovery_settings_max_search_terms_check" CHECK (((max_search_terms >= 1) AND (max_search_terms <= 3)));
alter table public."opportunity_discovery_settings" add constraint "opportunity_discovery_settings_pkey" PRIMARY KEY (id);
alter table public."opportunity_scenarios" add constraint "opportunity_scenarios_pkey" PRIMARY KEY (id);
alter table public."opportunity_scenarios" add constraint "opportunity_scenarios_slug_version_key" UNIQUE (slug, version);
alter table public."opportunity_scenarios" add constraint "opportunity_scenarios_status_check" CHECK ((status = ANY (ARRAY['draft'::text, 'active'::text, 'retired'::text])));
alter table public."opportunity_scenarios" add constraint "opportunity_scenarios_version_check" CHECK ((version > 0));
alter table public."local_business_audit_reports" add constraint "local_business_audit_reports_assessment_id_fkey" FOREIGN KEY (assessment_id) REFERENCES local_business_lead_assessments(id) ON DELETE RESTRICT;
alter table public."local_business_audit_reports" add constraint "local_business_audit_reports_generated_by_fkey" FOREIGN KEY (generated_by) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public."local_business_audit_reports" add constraint "local_business_audit_reports_lead_id_fkey" FOREIGN KEY (lead_id) REFERENCES local_business_leads(id) ON DELETE CASCADE;
alter table public."local_business_audit_reports" add constraint "local_business_audit_reports_scenario_id_fkey" FOREIGN KEY (scenario_id) REFERENCES opportunity_scenarios(id) ON DELETE SET NULL;
alter table public."local_business_lead_assessments" add constraint "local_business_lead_assessments_lead_id_fkey" FOREIGN KEY (lead_id) REFERENCES local_business_leads(id) ON DELETE CASCADE;
alter table public."local_business_lead_assessments" add constraint "local_business_lead_assessments_scenario_id_fkey" FOREIGN KEY (scenario_id) REFERENCES opportunity_scenarios(id) ON DELETE SET NULL;
alter table public."local_business_lead_events" add constraint "local_business_lead_events_lead_id_fkey" FOREIGN KEY (lead_id) REFERENCES local_business_leads(id) ON DELETE SET NULL;
alter table public."local_business_lead_signals" add constraint "local_business_lead_signals_lead_id_fkey" FOREIGN KEY (lead_id) REFERENCES local_business_leads(id) ON DELETE CASCADE;
alter table public."local_business_outreach_drafts" add constraint "local_business_outreach_drafts_cockpit_contact_id_fkey" FOREIGN KEY (cockpit_contact_id) REFERENCES contacts(id) ON DELETE SET NULL;
alter table public."local_business_outreach_drafts" add constraint "local_business_outreach_drafts_lead_id_fkey" FOREIGN KEY (lead_id) REFERENCES local_business_leads(id) ON DELETE CASCADE;
alter table public."local_business_outreach_drafts" add constraint "local_business_outreach_drafts_scenario_id_fkey" FOREIGN KEY (scenario_id) REFERENCES opportunity_scenarios(id) ON DELETE SET NULL;
alter table public."local_business_visual_assessments" add constraint "local_business_visual_assessments_candidate_id_fkey" FOREIGN KEY (candidate_id) REFERENCES opportunity_discovery_candidates(id) ON DELETE CASCADE;
alter table public."local_business_visual_assessments" add constraint "local_business_visual_assessments_evidence_id_fkey" FOREIGN KEY (evidence_id) REFERENCES local_business_visual_evidence(id) ON DELETE CASCADE;
alter table public."local_business_visual_assessments" add constraint "local_business_visual_assessments_lead_id_fkey" FOREIGN KEY (lead_id) REFERENCES local_business_leads(id) ON DELETE CASCADE;
alter table public."local_business_visual_evidence" add constraint "local_business_visual_evidence_candidate_id_fkey" FOREIGN KEY (candidate_id) REFERENCES opportunity_discovery_candidates(id) ON DELETE CASCADE;
alter table public."local_business_visual_evidence" add constraint "local_business_visual_evidence_lead_id_fkey" FOREIGN KEY (lead_id) REFERENCES local_business_leads(id) ON DELETE CASCADE;
alter table public."local_business_visual_findings" add constraint "local_business_visual_findings_assessment_id_fkey" FOREIGN KEY (assessment_id) REFERENCES local_business_visual_assessments(id) ON DELETE CASCADE;
alter table public."opportunity_batch_members" add constraint "opportunity_batch_members_batch_id_fkey" FOREIGN KEY (batch_id) REFERENCES opportunity_batches(id) ON DELETE CASCADE;
alter table public."opportunity_batch_members" add constraint "opportunity_batch_members_lead_id_fkey" FOREIGN KEY (lead_id) REFERENCES local_business_leads(id) ON DELETE CASCADE;
alter table public."opportunity_contact_handoffs" add constraint "opportunity_contact_handoffs_contact_id_fkey" FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE RESTRICT;
alter table public."opportunity_discovery_candidates" add constraint "opportunity_discovery_candidates_duplicate_lead_id_fkey" FOREIGN KEY (duplicate_lead_id) REFERENCES local_business_leads(id) ON DELETE SET NULL;
alter table public."opportunity_discovery_candidates" add constraint "opportunity_discovery_candidates_imported_lead_id_fkey" FOREIGN KEY (imported_lead_id) REFERENCES local_business_leads(id) ON DELETE SET NULL;
alter table public."opportunity_discovery_candidates" add constraint "opportunity_discovery_candidates_run_id_fkey" FOREIGN KEY (run_id) REFERENCES opportunity_discovery_runs(id) ON DELETE CASCADE;
alter table public."opportunity_discovery_runs" add constraint "opportunity_discovery_runs_category_id_fkey" FOREIGN KEY (category_id) REFERENCES opportunity_categories(id) ON DELETE SET NULL;
alter table public."opportunity_discovery_runs" add constraint "opportunity_discovery_runs_scenario_id_fkey" FOREIGN KEY (scenario_id) REFERENCES opportunity_scenarios(id) ON DELETE RESTRICT;

grant usage on schema public to service_role,authenticated,anon;
grant all on all tables in schema public to service_role;
