import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ApiError,
  ApiNotConfiguredError,
  createOutreachDraft,
  fetchOpportunityDetail,
  isApiConfigured,
  sendOutreachDraft,
  setOutcomeState,
  setReviewState,
  updateOutreachDraft,
} from "../lib/api";
import type { OppDetail, OutcomeState, ReviewState } from "../lib/types";
import { OUTCOME_ACTIONS, REVIEW_STATE_ORDER } from "../lib/types";
import Badge, { toneForStatus } from "../components/Badge";

import AuditReportDisplay from "../components/AuditReport";
import DraftEditor from "../components/DraftEditor";
import GuidedWorkflow, { type WorkflowState } from "../components/GuidedWorkflow";
import ExecutiveSummary from "../components/ExecutiveSummary";
import ColorMeter from "../components/ColorMeter";
import AssessmentCard from "../components/AssessmentCard";
import EvidencePanel, { deriveEvidence } from "../components/EvidencePanel";
import EventTimeline from "../components/EventTimeline";

function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function errorMessage(err: unknown): string {
  if (err instanceof ApiNotConfiguredError) return err.message;
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Unknown error.";
}

/** Compact inline detail row for the Business Details section. */
function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-x-3 gap-y-0.5 text-sm sm:grid-cols-[5rem_1fr] sm:gap-y-0">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-sm text-slate-200 break-words sm:truncate">{children}</dd>
    </div>
  );
}

/** Section heading used consistently across the page. */
function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-200">
      {children}
    </h2>
  );
}

/** Action bar for the outcome tracking pipeline. */
const REVIEW_ACTIONS: { toState: Exclude<ReviewState, "detected">; label: string }[] = [
  { toState: "reviewed", label: "Start review" },
  { toState: "approved", label: "Complete review" },
  { toState: "contact_ready", label: "Mark contact ready" },
];

export default function OpportunityDetail() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<OppDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [reviewPending, setReviewPending] = useState<ReviewState | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);

  const [outcomePending, setOutcomePending] = useState<OutcomeState | null>(null);
  const [outcomeError, setOutcomeError] = useState<string | null>(null);

  const [generatingDraft, setGeneratingDraft] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [approvingDraft, setApprovingDraft] = useState(false);
  const [sendingDraft, setSendingDraft] = useState(false);
  const [sendNotice, setSendNotice] = useState<string | null>(null);
  const [draftMutationError, setDraftMutationError] = useState<string | null>(null);

  async function load() {
    if (!id || !isApiConfigured) return;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetchOpportunityDetail(id);
      setDetail(res);
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function handleReviewTransition(toState: Exclude<ReviewState, "detected">) {
    if (!id) return;
    setReviewPending(toState);
    setReviewError(null);
    try {
      await setReviewState(id, toState);
      await load();
    } catch (err) {
      setReviewError(errorMessage(err));
    } finally {
      setReviewPending(null);
    }
  }

  async function handleOutcomeTransition(toState: Exclude<OutcomeState, "sent">) {
    if (!id) return;
    setOutcomePending(toState);
    setOutcomeError(null);
    try {
      await setOutcomeState(id, toState);
      await load();
    } catch (err) {
      setOutcomeError(errorMessage(err));
    } finally {
      setOutcomePending(null);
    }
  }

  async function handleGenerateDraft() {
    if (!id) return;
    setGeneratingDraft(true);
    setGenerateError(null);
    try {
      await createOutreachDraft(id);
      await load();
    } catch (err) {
      setGenerateError(errorMessage(err));
    } finally {
      setGeneratingDraft(false);
    }
  }

  async function handleSaveDraft(draftId: string, fields: { subject: string; body: string }) {
    if (!id) return;
    setSavingDraft(true);
    setDraftMutationError(null);
    try {
      await updateOutreachDraft(id, draftId, fields);
      await load();
    } catch (err) {
      setDraftMutationError(errorMessage(err));
    } finally {
      setSavingDraft(false);
    }
  }

  async function handleApproveDraft(draftId: string) {
    if (!id) return;
    setApprovingDraft(true);
    setDraftMutationError(null);
    try {
      await updateOutreachDraft(id, draftId, { status: "approved" });
      await load();
    } catch (err) {
      setDraftMutationError(errorMessage(err));
    } finally {
      setApprovingDraft(false);
    }
  }

  async function handleSendDraft(draftId: string) {
    if (!id) return;
    setSendingDraft(true);
    setDraftMutationError(null);
    setSendNotice(null);
    try {
      const res = await sendOutreachDraft(id, draftId);
      setSendNotice(
        `Sent to ${res.sent_to}${res.overridden ? " (test override — not the prospect)" : ""}.`,
      );
    } catch (err) {
      setDraftMutationError(errorMessage(err));
    } finally {
      setSendingDraft(false);
      await load();
    }
  }

  /** Map a GuidedWorkflow step ID to the corresponding action. */
  function handleWorkflowStep(stepId: string) {
    if (!id) return;
    switch (stepId) {
      case "review_started":
        void handleReviewTransition("reviewed");
        break;
      case "review_complete":
        void handleReviewTransition("approved");
        break;
      case "contact_ready":
        void handleReviewTransition("contact_ready");
        break;
      case "outreach_approved":
        // Trigger the draft approval if a draft exists
        if (detail) {
          const latestDraft = detail.outreach_drafts[0] ?? null;
          if (latestDraft && latestDraft.status === "draft") {
            void handleApproveDraft(latestDraft.id);
          } else if (!latestDraft) {
            void handleGenerateDraft();
          }
        }
        break;
      case "sent":
        if (detail) {
          const latestDraft = detail.outreach_drafts[0] ?? null;
          if (latestDraft) {
            void handleSendDraft(latestDraft.id);
          }
        }
        break;
      case "responded":
        void handleOutcomeTransition("awaiting_response");
        break;
      case "meeting_booked":
        void handleOutcomeTransition("meeting_booked");
        break;
      case "converted":
        void handleOutcomeTransition("converted");
        break;
    }
  }

  if (!isApiConfigured) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-8 text-center text-slate-400">
        API is not configured. See the banner above.
      </div>
    );
  }

  if (loading && !detail) {
    return <p className="text-sm text-slate-500">Loading opportunity…</p>;
  }

  if (loadError) {
    return (
      <div className="space-y-3">
        <Link to="/opportunities" className="text-sm text-accent-400 hover:underline">
          ← Back to opportunities
        </Link>
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {loadError}
        </div>
      </div>
    );
  }

  if (!detail) {
    return <p className="text-sm text-slate-500">No data.</p>;
  }

  const {
    lead,
    latest_assessment,
    audit_report,
    outreach_drafts,
    review_state,
    outcome_state,
    console_events,
  } = detail;

  const currentReviewIndex = REVIEW_STATE_ORDER.indexOf(review_state);
  const latestDraft = outreach_drafts[0] ?? null;
  const priorDrafts = outreach_drafts.slice(1);
  const latestDraftSendEvent = latestDraft
    ? console_events.find(
        (e) =>
          e.draft_id === latestDraft.id &&
          (e.action === "outreach_sent" || e.action === "outreach_send_failed"),
      )
    : null;
  const latestDraftSendFailed =
    latestDraft?.status === "approved" &&
    latestDraftSendEvent?.action === "outreach_send_failed";

  const opportunityScore: number =
    latest_assessment?.opportunity_score !== null &&
    latest_assessment?.opportunity_score !== undefined
      ? parseFloat(latest_assessment.opportunity_score)
      : 0;

  // Derive workflow state for the GuidedWorkflow component
  const workflowState: WorkflowState = {
    reviewState: review_state,
    draftStatus: latestDraft?.status ?? null,
    outcomeState: outcome_state,
  };

  // Derive evidence items from lead data and assessment
  const evidenceItems = deriveEvidence(lead, latest_assessment);

  // Check if we have a sent draft for timeline milestones
  const hasSentDraft = outreach_drafts.some((d) => d.status === "sent");
  const hasDraft = outreach_drafts.length > 0;

  // Build contact info for the outreach workspace header
  const contactInfo = [
    { label: "Business", value: lead.business_name },
    lead.email && { label: "Email", value: lead.email },
    lead.phone && { label: "Phone", value: lead.phone },
    latestDraft && { label: "Template", value: latestDraft.subject ?? "(no subject)" },
    latestDraft && { label: "Status", value: latestDraft.status },
  ].filter(Boolean) as { label: string; value: string }[];

  return (
    <div className="space-y-5">
      {/* ── Back link ── */}
      <Link to="/opportunities" className="inline-flex items-center gap-1 text-sm text-accent-400 hover:text-accent-300 hover:underline transition-colors">
        <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
          <path d="M19 12H5M12 19L5 12L12 5" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Back to opportunities
      </Link>

      {/* ── Header card: business name + status + guided workflow ── */}
      <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-slate-100 truncate">{lead.business_name}</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              {[lead.category, lead.suburb ?? lead.region].filter(Boolean).join(" · ") || "—"}
            </p>
          </div>
          <Badge tone={lead.status ? "info" : "neutral"}>{lead.status ?? "unknown"}</Badge>
        </div>

        {/* Guided workflow — replaces the old 4-step ReviewStepper */}
        <div className="border-t border-slate-800 pt-3">
          <GuidedWorkflow state={workflowState} onStepAction={handleWorkflowStep} />
        </div>
      </div>

      {/* ── Executive Summary ── */}
      <ExecutiveSummary assessment={latest_assessment} />

      {/* ── Two-column: Business Details (left) + Opportunity Overview + Assessment Cards (right) ── */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Left column: Business Details + evidence preview */}
        <div className="space-y-4">
          {/* Business Details (condensed) */}
          <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 space-y-3">
            <SectionHeading>
              <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 text-slate-400" aria-hidden="true">
                <path d="M3 9L12 2L21 9V20C21 20.5304 20.7893 21.0391 20.4142 21.4142C20.0391 21.7893 19.5304 22 19 22H5C4.46957 22 3.96086 21.7893 3.58579 21.4142C3.21071 21.0391 3 20.5304 3 20V9Z" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Business Details
            </SectionHeading>
            <dl className="space-y-2">
              <DetailRow label="Name">{lead.business_name}</DetailRow>
              <DetailRow label="Location">
                {[lead.address, lead.suburb, lead.region, lead.country].filter(Boolean).join(", ") || "—"}
              </DetailRow>
              <DetailRow label="Category">
                {lead.category ?? "—"}
                {lead.categories && lead.categories.length > 0 && (
                  <span className="ml-1 text-xs text-slate-500">
                    ({lead.categories.join(", ")})
                  </span>
                )}
              </DetailRow>
              <DetailRow label="Source">
                {[lead.source, lead.source_platform].filter(Boolean).join(" · ") || "—"}
              </DetailRow>
              {lead.trust_summary && (
                <DetailRow label="Trust Summary">{lead.trust_summary}</DetailRow>
              )}
            </dl>

            {/* Contact links */}
            <div className="flex flex-wrap gap-1.5 pt-1">
              {lead.website_url && (
                <a href={lead.website_url} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:border-accent-500 hover:text-accent-300 transition-colors">
                  Website
                  <svg viewBox="0 0 24 24" fill="none" className="h-3 w-3" aria-hidden="true"><path d="M18 13V19C18 19.5304 17.7893 20.0391 17.4142 20.4142C17.0391 20.7893 16.5304 21 16 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V8C3 7.46957 3.21071 6.96086 3.58579 6.58579C3.96086 6.21071 4.46957 6 5 6H11M15 3H21V9M21 3L10 14" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"/></svg>
                </a>
              )}
              {lead.facebook_url && (
                <a href={lead.facebook_url} target="_blank" rel="noopener noreferrer"
                  className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:border-accent-500 hover:text-accent-300 transition-colors">
                  Facebook ↗
                </a>
              )}
              {lead.google_maps_url && (
                <a href={lead.google_maps_url} target="_blank" rel="noopener noreferrer"
                  className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:border-accent-500 hover:text-accent-300 transition-colors">
                  Google Maps ↗
                </a>
              )}
              {lead.phone && (
                <a href={`tel:${lead.phone}`}
                  className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:border-accent-500 hover:text-accent-300 transition-colors">
                  Call {lead.phone}
                </a>
              )}
              {lead.email && (
                <a href={`mailto:${lead.email}`}
                  className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:border-accent-500 hover:text-accent-300 transition-colors">
                  Email {lead.email}
                </a>
              )}
            </div>
          </section>

          {/* Business Evidence (inline usage under Business Details — fills the empty space) */}
          {evidenceItems.length > 0 && (
            <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 space-y-3">
              <SectionHeading>
                <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 text-slate-400" aria-hidden="true">
                  <path d="M9 12L11 14L15 10M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Business Evidence
              </SectionHeading>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {evidenceItems.slice(0, 6).map((item) => {
                  const statusColor =
                    item.status === "found" ? "text-emerald-400" :
                    item.status === "missing" ? "text-rose-400" :
                    item.status === "partial" ? "text-amber-400" : "text-slate-500";
                  const dotColor =
                    item.status === "found" ? "bg-emerald-500" :
                    item.status === "missing" ? "bg-rose-500" :
                    item.status === "partial" ? "bg-amber-500" : "bg-slate-600";
                  return (
                    <div key={item.label} className="flex items-center gap-2 rounded-md bg-slate-950/40 px-3 py-2 border border-slate-800/60">
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotColor}`} aria-hidden="true" />
                      <span className="text-xs text-slate-300">{item.label}</span>
                      <span className={`ml-auto text-xs font-medium ${statusColor}`}>
                        {item.status === "found" ? "✓" : item.status === "missing" ? "✗" : item.status === "partial" ? "~" : "?"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Website & Google Maps preview area */}
          {(lead.website_url || lead.google_maps_url) && (
            <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 space-y-3">
              <SectionHeading>
                <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 text-slate-400" aria-hidden="true">
                  <path d="M21 10C21 17 12 23 12 23C12 23 3 17 3 10C3 7.61305 3.94821 5.32387 5.63604 3.63604C7.32387 1.94821 9.61305 1 12 1C14.3869 1 16.6761 1.94821 18.364 3.63604C20.0518 5.32387 21 7.61305 21 10Z" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M12 13C13.6569 13 15 11.6569 15 10C15 8.34315 13.6569 7 12 7C10.3431 7 9 8.34315 9 10C9 11.6569 10.3431 13 12 13Z" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Location &amp; Online Presence
              </SectionHeading>
              <div className="space-y-2 text-sm">
                {lead.website_url && (
                  <div className="flex items-start gap-2 rounded-md bg-slate-950/40 px-3 py-2.5 border border-slate-800/60">
                    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 mt-0.5 shrink-0 text-sky-400" aria-hidden="true">
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" fill="currentColor"/>
                    </svg>
                    <a href={lead.website_url} target="_blank" rel="noopener noreferrer"
                      className="text-accent-400 hover:text-accent-300 hover:underline truncate">
                      {lead.website_url}
                    </a>
                  </div>
                )}
                {lead.google_maps_url && (
                  <div className="flex items-start gap-2 rounded-md bg-slate-950/40 px-3 py-2.5 border border-slate-800/60">
                    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 mt-0.5 shrink-0 text-emerald-400" aria-hidden="true">
                      <path d="M21 10C21 17 12 23 12 23C12 23 3 17 3 10C3 7.61305 3.94821 5.32387 5.63604 3.63604C7.32387 1.94821 9.61305 1 12 1C14.3869 1 16.6761 1.94821 18.364 3.63604C20.0518 5.32387 21 7.61305 21 10Z" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"/>
                      <path d="M12 13C13.6569 13 15 11.6569 15 10C15 8.34315 13.6569 7 12 7C10.3431 7 9 8.34315 9 10C9 11.6569 10.3431 13 12 13Z" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    <a href={lead.google_maps_url} target="_blank" rel="noopener noreferrer"
                      className="text-accent-400 hover:text-accent-300 hover:underline truncate">
                      {lead.address || lead.suburb || "View on Google Maps"}
                    </a>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* AI Reasoning — assessment summary / recommended angle */}
          {latest_assessment?.recommended_outreach_angle && (
            <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 space-y-2">
              <SectionHeading>
                <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 text-slate-400" aria-hidden="true">
                  <path d="M9.66347 17H4C2.89543 17 2 16.1046 2 15V5C2 3.89543 2.89543 3 4 3H20C21.1046 3 22 3.89543 22 5V15C22 16.1046 21.1046 17 20 17H14.3365L11.4545 19.8819C10.6125 20.7239 9.16347 20.1239 9.16347 18.9519L9.66347 17Z" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                AI Reasoning
              </SectionHeading>
              <p className="text-sm leading-relaxed text-slate-300 bg-slate-950/40 rounded-md px-3 py-2.5 border border-slate-800/60">
                {latest_assessment.recommended_outreach_angle}
              </p>
            </section>
          )}
        </div>

        {/* Right column: Opportunity Overview + Assessment Cards */}
        <div className="space-y-4">
          {/* Opportunity Overview — color-coded meter replacing plain score */}
          <section className="space-y-3">
            <SectionHeading>
              <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 text-slate-400" aria-hidden="true">
                <path d="M13 2L3 14H12L11 22L21 10H12L13 2Z" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Opportunity Overview
            </SectionHeading>
            <ColorMeter
              score={opportunityScore}
              max={200}
              label="Opportunity Score"
              subLabel={latest_assessment ? `Assessed ${formatTimestamp(latest_assessment.assessed_at)}` : undefined}
            />
          </section>

          {/* Assessment Cards — enhanced with interpretations */}
          {latest_assessment ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <SectionHeading>
                  <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 text-slate-400" aria-hidden="true">
                    <path d="M9 5L5 9L9 13" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M5 9H13C15.2091 9 17 10.7909 17 13V19" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round"/>
                  </svg>
                  Assessment Metrics
                </SectionHeading>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <AssessmentCard
                  label="Demand Signal"
                  value={latest_assessment.demand_signal_score}
                  type="demand"
                  barColor="bg-sky-500"
                />
                <AssessmentCard
                  label="Trust Leakage"
                  value={latest_assessment.trust_leakage_score}
                  type="trust_leakage"
                  barColor="bg-rose-500"
                />
                <AssessmentCard
                  label="Conversion Maturity"
                  value={latest_assessment.conversion_maturity_score}
                  type="conversion"
                  barColor="bg-emerald-500"
                />
                <AssessmentCard
                  label="AI Readiness"
                  value={latest_assessment.ai_readiness_score}
                  type="ai_readiness"
                  barColor="bg-accent-500"
                />
              </div>
            </div>
          ) : (
            <p className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 text-sm text-slate-500">
              No assessment yet.
            </p>
          )}
        </div>
      </div>

      {/* ── Evidence Panel (collapsible, full width) ── */}
      <EvidencePanel items={evidenceItems} />

      {/* ── Audit Report (existing, unchanged) ── */}
      <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 space-y-3">
        <SectionHeading>
          <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 text-slate-400" aria-hidden="true">
            <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M14 2V8H20" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M16 13H8M16 17H8M10 9H8" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round"/>
          </svg>
          Audit Report
        </SectionHeading>
        <AuditReportDisplay report={audit_report} />
      </section>

      {/* ── Event Timeline (vertical, replaces old EventHistory) ── */}
      <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 space-y-3">
        <SectionHeading>
          <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 text-slate-400" aria-hidden="true">
            <path d="M12 8V12L15 15M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Timeline
        </SectionHeading>
        <EventTimeline
          events={console_events}
          reviewState={review_state}
          outcomeState={outcome_state}
          hasAssessment={latest_assessment !== null}
          hasAudit={audit_report !== null}
          hasDraft={hasDraft}
          hasSentDraft={hasSentDraft}
        />
      </section>

      {/* ── Two-column: Review actions (left) + Outreach Workspace (right) ── */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Left: Operator Review Actions */}
        <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 space-y-3">
          <SectionHeading>
            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 text-slate-400" aria-hidden="true">
              <path d="M9 11L12 14L22 4M21 12V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V5C3 4.46957 3.21071 3.96086 3.58579 3.58579C3.96086 3.21071 4.46957 3 5 3H16" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Review Actions
          </SectionHeading>
          <div className="flex flex-wrap gap-2">
            {REVIEW_ACTIONS.map((action) => {
              const targetIndex = REVIEW_STATE_ORDER.indexOf(action.toState);
              const isAheadOfCurrent = targetIndex > currentReviewIndex;
              const disabled = !isAheadOfCurrent || reviewPending !== null;
              return (
                <button
                  key={action.toState}
                  type="button"
                  onClick={() => handleReviewTransition(action.toState)}
                  disabled={disabled}
                  className="rounded bg-accent-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-500 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400 disabled:opacity-60"
                >
                  {reviewPending === action.toState ? "Working…" : action.label}
                </button>
              );
            })}
          </div>
          {review_state === "contact_ready" && (
            <p className="text-xs text-emerald-400">
              This opportunity has completed the review workflow.
            </p>
          )}
          {reviewError && (
            <p className="rounded border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
              {reviewError}
            </p>
          )}
        </section>

        {/* Right: Outreach Workspace — redesigned with contact header */}
        <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 space-y-4">
          <SectionHeading>
            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 text-slate-400" aria-hidden="true">
              <path d="M22 2L11 13M22 2L15 22L11 13L2 9L22 2Z" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Outreach
          </SectionHeading>

          {/* Contact summary header */}
          {contactInfo.length > 0 && (
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {contactInfo.map((info) => (
                <div
                  key={info.label}
                  className="rounded-md border border-slate-800 bg-slate-950/40 px-3 py-2"
                >
                  <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
                    {info.label}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-200 break-words" title={info.value}>{info.value}</p>
                </div>
              ))}
            </div>
          )}

          {/* Draft workspace */}
          {!latestDraft ? (
            <div className="space-y-3">
              <p className="text-sm text-slate-500">No outreach drafts yet.</p>
              <button
                type="button"
                onClick={handleGenerateDraft}
                disabled={generatingDraft}
                className="rounded bg-accent-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-500 disabled:cursor-not-allowed disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
                  <path d="M12 5V19M5 12H19" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                {generatingDraft ? "Generating…" : "Generate draft"}
              </button>
              {generateError && (
                <p className="rounded border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
                  {generateError}
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <DraftEditor
                draft={latestDraft}
                onSave={(fields) => handleSaveDraft(latestDraft.id, fields)}
                onApprove={() => handleApproveDraft(latestDraft.id)}
                onSend={() => handleSendDraft(latestDraft.id)}
                saving={savingDraft}
                approving={approvingDraft}
                sending={sendingDraft}
                sendFailed={!!latestDraftSendFailed}
                error={draftMutationError}
              />

              {/* Attachments placeholder */}
              <div className="rounded border border-dashed border-slate-700/60 bg-slate-950/30 px-4 py-3 text-center text-xs text-slate-600">
                Attachments — coming soon
              </div>

              {/* Audit PDF download */}
              {audit_report?.pdf_url && (
                <a
                  href={audit_report.pdf_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 rounded border border-slate-700 px-3 py-2 text-xs text-accent-400 transition-colors hover:border-accent-600 hover:text-accent-300"
                >
                  <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 shrink-0" aria-hidden="true">
                    <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M16 18H8M16 13H8M10 9H8" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round"/>
                  </svg>
                  Audit PDF
                  <svg viewBox="0 0 24 24" fill="none" className="h-3 w-3 ml-auto" aria-hidden="true">
                    <path d="M18 13V19C18 19.5304 17.7893 20.0391 17.4142 20.4142C17.0391 20.7893 16.5304 21 16 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V8C3 7.46957 3.21071 6.96086 3.58579 6.58579C3.96086 6.21071 4.46957 6 5 6H11M15 3H21V9M21 3L10 14" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </a>
              )}

              {sendNotice && (
                <p className="rounded border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
                  {sendNotice}
                </p>
              )}
            </div>
          )}

          {/* Prior drafts */}
          {priorDrafts.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                Prior Drafts
              </p>
              <ul className="space-y-1.5">
                {priorDrafts.map((d) => (
                  <li
                    key={d.id}
                    className="flex items-center justify-between rounded border border-slate-800 bg-slate-950/40 px-3 py-1.5 text-xs text-slate-400"
                  >
                    <span className="truncate">{d.subject ?? "(no subject)"}</span>
                    <span className="flex items-center gap-2 shrink-0">
                      <Badge tone={toneForStatus(d.status)}>{d.status}</Badge>
                      <span>{formatTimestamp(d.created_at)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>

      {/* ── Outcome Tracking (Phase 4, preserved) ── */}
      <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionHeading>
            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 text-slate-400" aria-hidden="true">
              <path d="M22 11.08V12C21.9988 14.1564 21.3005 16.2547 20.0093 17.9818C18.7182 19.709 16.9033 20.9725 14.8354 21.5839C12.7674 22.1953 10.5573 22.1219 8.53447 21.3746C6.51168 20.6273 4.78465 19.2461 3.61096 17.4371C2.43727 15.628 1.87979 13.4881 2.02168 11.3363C2.16356 9.18455 2.99721 7.13631 4.39828 5.49706C5.79935 3.85781 7.69279 2.71537 9.79619 2.24013C11.8996 1.7649 14.1003 1.98232 16.07 2.85999" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M22 4L12 14.01L9 11.01" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Outcome Tracking
          </SectionHeading>
          <Badge tone={outcome_state ? toneForStatus(outcome_state) : "neutral"}>
            {outcome_state ? outcome_state.replace(/_/g, " ") : "Not started"}
          </Badge>
        </div>

        {outcome_state ? (
          <>
            <div className="flex flex-wrap gap-2">
              {OUTCOME_ACTIONS.map((action) => {
                const isCurrent = outcome_state === action.toState;
                const disabled = isCurrent || outcomePending !== null;
                return (
                  <button
                    key={action.toState}
                    type="button"
                    onClick={() => handleOutcomeTransition(action.toState)}
                    disabled={disabled}
                    className="rounded bg-slate-700 px-3 py-1.5 text-sm font-medium text-slate-100 transition-colors hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {outcomePending === action.toState ? "Working…" : action.label}
                  </button>
                );
              })}
            </div>
            {outcomeError && (
              <p className="rounded border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
                {outcomeError}
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-slate-500">
            Send an approved outreach email to start tracking outcomes for this opportunity.
          </p>
        )}
      </section>
    </div>
  );
}
