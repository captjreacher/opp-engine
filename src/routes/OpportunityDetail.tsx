import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ApiError,
  ApiNotConfiguredError,
  createOutreachDraft,
  fetchOpportunityDetail,
  isApiConfigured,
  sendOutreachDraft,
  setReviewState,
  updateOutreachDraft,
} from "../lib/api";
import type { OppDetail, ReviewState } from "../lib/types";
import { REVIEW_STATE_ORDER } from "../lib/types";
import Badge, { toneForStatus } from "../components/Badge";
import ScoreBar from "../components/ScoreBar";
import ReviewStepper from "../components/ReviewStepper";
import EventHistory from "../components/EventHistory";
import AuditReportDisplay from "../components/AuditReport";
import DraftEditor from "../components/DraftEditor";

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
      await load(); // refetch on success AND failure so the event history / failed state updates
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

  const { lead, latest_assessment, audit_report, outreach_drafts, review_state, console_events } =
    detail;
  const currentReviewIndex = REVIEW_STATE_ORDER.indexOf(review_state);
  const latestDraft = outreach_drafts[0] ?? null;
  const priorDrafts = outreach_drafts.slice(1);
  // "failed" is derived: the most recent send event for the latest draft is a failure and the draft
  // is still approved (a failed SMTP send never flips status to sent). console_events is ordered
  // newest-first, so find() returns the most recent send-related event.
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
  const opportunityScoreDisplay =
    latest_assessment?.opportunity_score !== null && latest_assessment?.opportunity_score !== undefined
      ? parseFloat(latest_assessment.opportunity_score).toFixed(2)
      : "—";

  return (
    <div className="space-y-6">
      <Link to="/opportunities" className="text-sm text-accent-400 hover:underline">
        ← Back to opportunities
      </Link>

      {/* Header */}
      <div className="space-y-3 rounded-lg border border-slate-800 bg-slate-900/60 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-slate-100">{lead.business_name}</h1>
            <p className="text-sm text-slate-500">
              {[lead.category, lead.suburb ?? lead.region].filter(Boolean).join(" · ") || "—"}
            </p>
          </div>
          <Badge tone={lead.status ? "info" : "neutral"}>{lead.status ?? "unknown"}</Badge>
        </div>
        <ReviewStepper current={review_state} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Business Details */}
        <section className="space-y-3 rounded-lg border border-slate-800 bg-slate-900/60 p-4">
          <h2 className="text-sm font-semibold text-slate-200">Business Details</h2>
          <dl className="grid grid-cols-3 gap-y-2 text-sm">
            <dt className="text-slate-500">Name</dt>
            <dd className="col-span-2 text-slate-200">{lead.business_name}</dd>

            <dt className="text-slate-500">Location</dt>
            <dd className="col-span-2 text-slate-200">
              {[lead.address, lead.suburb, lead.region, lead.country].filter(Boolean).join(", ") ||
                "—"}
            </dd>

            <dt className="text-slate-500">Category</dt>
            <dd className="col-span-2 text-slate-200">
              {lead.category ?? "—"}
              {lead.categories && lead.categories.length > 0 && (
                <span className="ml-1 text-xs text-slate-500">
                  ({lead.categories.join(", ")})
                </span>
              )}
            </dd>

            <dt className="text-slate-500">Source</dt>
            <dd className="col-span-2 text-slate-200">
              {[lead.source, lead.source_platform].filter(Boolean).join(" · ") || "—"}
            </dd>

            {lead.trust_summary && (
              <>
                <dt className="text-slate-500">Trust summary</dt>
                <dd className="col-span-2 text-slate-200">{lead.trust_summary}</dd>
              </>
            )}
          </dl>

          <div className="flex flex-wrap gap-2 pt-1">
            {lead.website_url && (
              <a
                href={lead.website_url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:border-accent-500 hover:text-accent-300"
              >
                Website ↗
              </a>
            )}
            {lead.facebook_url && (
              <a
                href={lead.facebook_url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:border-accent-500 hover:text-accent-300"
              >
                Facebook ↗
              </a>
            )}
            {lead.google_maps_url && (
              <a
                href={lead.google_maps_url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:border-accent-500 hover:text-accent-300"
              >
                Google Maps ↗
              </a>
            )}
            {lead.phone && (
              <a
                href={`tel:${lead.phone}`}
                className="rounded border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:border-accent-500 hover:text-accent-300"
              >
                Call {lead.phone}
              </a>
            )}
            {lead.email && (
              <a
                href={`mailto:${lead.email}`}
                className="rounded border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:border-accent-500 hover:text-accent-300"
              >
                Email {lead.email}
              </a>
            )}
          </div>
        </section>

        {/* Opportunity Intelligence */}
        <section className="space-y-3 rounded-lg border border-slate-800 bg-slate-900/60 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-200">Opportunity Intelligence</h2>
            <div className="text-right">
              <div className="text-xs text-slate-500">Opportunity Score</div>
              <div className="text-2xl font-bold text-accent-300">{opportunityScoreDisplay}</div>
            </div>
          </div>

          {latest_assessment ? (
            <>
              <div className="space-y-3">
                <ScoreBar
                  label="Demand Signal"
                  value={latest_assessment.demand_signal_score}
                  colorClassName="bg-sky-500"
                />
                <ScoreBar
                  label="Trust Leakage"
                  value={latest_assessment.trust_leakage_score}
                  colorClassName="bg-rose-500"
                />
                <ScoreBar
                  label="Conversion Maturity"
                  value={latest_assessment.conversion_maturity_score}
                  colorClassName="bg-emerald-500"
                />
                <ScoreBar
                  label="AI Readiness"
                  value={latest_assessment.ai_readiness_score}
                  colorClassName="bg-accent-500"
                />
              </div>

              {latest_assessment.recommended_outreach_angle && (
                <div className="rounded border border-slate-800 bg-slate-950/60 p-3">
                  <div className="text-xs font-medium text-slate-500">
                    Recommended Outreach Angle
                  </div>
                  <p className="mt-1 text-sm text-slate-200">
                    {latest_assessment.recommended_outreach_angle}
                  </p>
                </div>
              )}

              {latest_assessment.assessment_summary && (
                <div className="rounded border border-slate-800 bg-slate-950/60 p-3">
                  <div className="text-xs font-medium text-slate-500">Assessment Summary</div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-slate-200">
                    {latest_assessment.assessment_summary}
                  </p>
                </div>
              )}

              <div className="text-xs text-slate-500">
                Assessed {formatTimestamp(latest_assessment.assessed_at)}
              </div>
            </>
          ) : (
            <p className="text-sm text-slate-500">No assessment yet.</p>
          )}
        </section>
      </div>

      {/* Audit Display */}
      <section className="space-y-3 rounded-lg border border-slate-800 bg-slate-900/60 p-4">
        <h2 className="text-sm font-semibold text-slate-200">Audit Report</h2>
        <AuditReportDisplay report={audit_report} />
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Operator Review Workflow */}
        <section className="space-y-3 rounded-lg border border-slate-800 bg-slate-900/60 p-4">
          <h2 className="text-sm font-semibold text-slate-200">Operator Review Workflow</h2>
          <div className="flex flex-wrap gap-2">
            {REVIEW_ACTIONS.map((action) => {
              // Enable any transition strictly ahead of the current review_state
              // (forward progress only — matches the stepper ordering; the API
              // itself does not enforce single-step sequencing).
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

          <div className="pt-2">
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
              Event History
            </h3>
            <EventHistory events={console_events} />
          </div>
        </section>

        {/* Outreach Draft Workflow */}
        <section className="space-y-3 rounded-lg border border-slate-800 bg-slate-900/60 p-4">
          <h2 className="text-sm font-semibold text-slate-200">Outreach Draft</h2>

          {!latestDraft ? (
            <div className="space-y-2">
              <p className="text-sm text-slate-500">No outreach drafts yet.</p>
              <button
                type="button"
                onClick={handleGenerateDraft}
                disabled={generatingDraft}
                className="rounded bg-accent-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {generatingDraft ? "Generating…" : "Generate draft"}
              </button>
              {generateError && (
                <p className="rounded border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
                  {generateError}
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-2">
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
              {sendNotice && (
                <p className="rounded border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
                  {sendNotice}
                </p>
              )}
            </div>
          )}

          {priorDrafts.length > 0 && (
            <div className="pt-2">
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                Prior Drafts
              </h3>
              <ul className="space-y-1.5">
                {priorDrafts.map((d) => (
                  <li
                    key={d.id}
                    className="flex items-center justify-between rounded border border-slate-800 bg-slate-950/40 px-3 py-1.5 text-xs text-slate-400"
                  >
                    <span className="truncate">{d.subject ?? "(no subject)"}</span>
                    <span className="flex items-center gap-2">
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
    </div>
  );
}
