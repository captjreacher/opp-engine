// Shared types for the opp-engine frontend.
//
// These mirror the API contract served by the `opportunities` Supabase Edge
// Function EXACTLY. The frontend never computes or reshapes scores/state —
// it only renders what the API returns and calls the mutation endpoints.

/** A single row in the board/list response (GET {VITE_API_BASE}). */
export interface OppRow {
  id: string;
  business_name: string;
  location: string | null;
  industry: string | null;
  pipeline_status: string;
  /** Decimal string from Postgres numeric, e.g. "168.00". Parse with parseFloat. */
  opportunity_score: string | null;
  demand_signal_score: number;
  trust_leakage_score: number;
  conversion_maturity_score: number;
  ai_readiness_score: number;
  recommended_outreach_angle: string | null;
  assessed_at: string | null;
  has_audit: boolean;
  outreach_status: string | null;
  updated_at: string;
}

export interface OppListResponse {
  opportunities: OppRow[];
}

/** A point-in-time scoring assessment for a lead. */
export interface Assessment {
  id: string;
  demand_signal_score: number;
  trust_leakage_score: number;
  conversion_maturity_score: number;
  ai_readiness_score: number;
  opportunity_score: string | null;
  assessment_summary: string | null;
  recommended_outreach_angle: string | null;
  assessed_at: string;
}

/** One metric shown in an audit report's metric grid. */
export interface AuditMetric {
  id: string;
  label: string;
  value: number;
  band: string;
}

/** The structured "report_model" shape nested in audit_report.metadata_json. */
export interface AuditReportModel {
  metrics?: AuditMetric[];
  business?: {
    name?: string;
    source?: string;
    category?: string;
    location?: string;
    websiteUrl?: string;
  };
  metadata?: {
    generatedAt?: string;
  };
  // Free-form narrative content that may or may not be present — rendered
  // as-is when found, never fabricated.
  summary?: string;
  narrative?: string;
  sections?: unknown;
  [key: string]: unknown;
}

/** metadata_json shape on an audit_report row. */
export interface AuditReportMetadataJson {
  report_model?: AuditReportModel;
  validation?: {
    customer_ready?: boolean;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface AuditReport {
  id: string;
  generated_at: string;
  report_version: string;
  pdf_url: string | null;
  metadata_json: AuditReportMetadataJson | null;
}

export type DraftStatus = "draft" | "approved" | "sent";

export interface Draft {
  id: string;
  subject: string | null;
  body: string;
  status: DraftStatus;
  created_at: string;
  approved_at: string | null;
  sent_at: string | null;
}

export type ReviewState = "detected" | "reviewed" | "approved" | "contact_ready";

/** Ordered review-state pipeline, used to derive which "next" action(s) to enable. */
export const REVIEW_STATE_ORDER: ReviewState[] = [
  "detected",
  "reviewed",
  "approved",
  "contact_ready",
];

/** Post-send outcome lifecycle (Phase 4). "sent" is derived; the rest are operator-set. */
export type OutcomeState =
  | "sent"
  | "awaiting_response"
  | "replied"
  | "meeting_booked"
  | "converted"
  | "closed";

export const OUTCOME_STATE_ORDER: OutcomeState[] = [
  "sent",
  "awaiting_response",
  "replied",
  "meeting_booked",
  "converted",
  "closed",
];

/** Operator-selectable outcome transitions (excludes the derived "sent" entry state). */
export const OUTCOME_ACTIONS: { toState: Exclude<OutcomeState, "sent">; label: string }[] = [
  { toState: "awaiting_response", label: "Mark Awaiting Response" },
  { toState: "replied", label: "Mark Replied" },
  { toState: "meeting_booked", label: "Mark Meeting Booked" },
  { toState: "converted", label: "Mark Converted" },
  { toState: "closed", label: "Mark Closed" },
];

export interface ConsoleEvent {
  id: string;
  action: string;
  draft_id: string | null;
  actor: string;
  metadata: unknown;
  created_at: string;
}

/** The lead/business record embedded in the detail response. */
export interface Lead {
  id: string;
  business_name: string;
  slug: string | null;
  category: string | null;
  categories: string[] | null;
  suburb: string | null;
  region: string | null;
  country: string | null;
  phone: string | null;
  email: string | null;
  website_url: string | null;
  facebook_url: string | null;
  google_maps_url: string | null;
  status: string | null;
  source: string | null;
  source_platform: string | null;
  address: string | null;
  trust_summary: string | null;
}

/** Full detail response (GET {VITE_API_BASE}/{id}). */
export interface OppDetail {
  lead: Lead;
  latest_assessment: Assessment | null;
  assessments: Assessment[];
  audit_report: AuditReport | null;
  audit_reports: AuditReport[];
  events: unknown[];
  outreach_drafts: Draft[];
  review_state: ReviewState;
  outcome_state: OutcomeState | null;
  console_events: ConsoleEvent[];
}

/** Response from POST {VITE_API_BASE}/{id}/outreach and PATCH .../outreach/{draftId}. */
export interface DraftResponse {
  draft: Draft;
}

/** Response from POST {VITE_API_BASE}/{id}/outreach/{draftId}/send. */
export interface SendResponse {
  draft: Draft;
  sent_to: string;
  overridden: boolean;
}

/** Response from POST {VITE_API_BASE}/{id}/review. */
export interface ReviewResponse {
  review_state: ReviewState;
  event: string;
}

/** Response from POST {VITE_API_BASE}/{id}/outcome. */
export interface OutcomeResponse {
  outcome_state: OutcomeState;
  event: string;
}

/** A card on the outcome pipeline (GET {VITE_API_BASE}/pipeline). */
export interface PipelineOpportunity {
  id: string;
  business_name: string;
  industry: string | null;
  opportunity_score: string | null;
  outcome_state: OutcomeState;
}

export interface PipelineMetrics {
  total_opportunities: number;
  audited_opportunities: number;
  drafts_created: number;
  emails_sent: number;
  replies: number;
  meetings: number;
  conversions: number;
}

export interface PipelineResponse {
  metrics: PipelineMetrics;
  opportunities: PipelineOpportunity[];
}

/** Shape of a parsed API error body, when the API returns a JSON error payload. */
export interface ApiErrorBody {
  error?: string;
  detail?: string;
  allowed?: string[];
  [key: string]: unknown;
}

export type DiscoveryRunStatus =
  | "queued" | "discovering" | "enriching" | "scoring" | "auditing"
  | "completed" | "partially_completed" | "failed" | "cancelled";

export interface DiscoverySearchInput {
  location: string;
  industry: string;
  keywords: string;
  radius_m: number | null;
  result_limit: number;
}

export interface DiscoveryRun extends DiscoverySearchInput {
  id: string;
  status: DiscoveryRunStatus;
  current_stage: string;
  businesses_discovered: number;
  candidates_enriched: number;
  candidates_scored: number;
  audits_generated: number;
  failures: number;
  error_summary: unknown[];
  created_by: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
}

export interface DiscoveryEvent {
  id: string;
  event_type: string;
  status: string;
  payload: unknown;
  created_at: string;
  entity_id: string;
}

export interface DiscoveryCandidate {
  id: string;
  run_id: string;
  source: string;
  source_identifier: string;
  business_name: string;
  normalized_identity: string;
  location: string | null;
  address: string | null;
  industry: string | null;
  website_url: string | null;
  phone: string | null;
  email: string | null;
  google_maps_url: string | null;
  source_payload: Record<string, unknown>;
  enrichment_evidence: unknown;
  preliminary_signals: unknown[];
  preliminary_score: string | null;
  duplicate_lead_id: string | null;
  imported_lead_id: string | null;
  enrichment_status: string;
  assessment_status: string;
  audit_status: string;
  import_status: string;
  error_info: Record<string, unknown>;
  events: DiscoveryEvent[];
  created_at: string;
  updated_at: string;
}

export interface DiscoveryRunResponse { run: DiscoveryRun; }
export interface DiscoveryCandidatesResponse { candidates: DiscoveryCandidate[]; }
export interface BatchActionResult {
  candidate_id: string;
  lead_id?: string;
  ok: boolean;
  error?: string;
}
export interface BatchActionResponse {
  results: BatchActionResult[];
  succeeded: number;
  failed: number;
  partial: boolean;
}
