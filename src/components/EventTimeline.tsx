import { useState } from "react";
import type { ConsoleEvent, OutcomeState, ReviewState } from "../lib/types";

const SYSTEM_EVENTS: Record<string, { label: string; icon: string }> = {
  opportunity_review_started: { label: "Review started", icon: "▶" },
  opportunity_review_completed: { label: "Review completed", icon: "✓" },
  opportunity_contact_ready: { label: "Marked contact ready", icon: "✓" },
  outreach_draft_created: { label: "Outreach draft created", icon: "✎" },
  outreach_draft_updated: { label: "Outreach draft updated", icon: "✎" },
  outreach_draft_approved: { label: "Outreach draft approved", icon: "✓" },
  outreach_sent: { label: "Email sent", icon: "▸" },
  outreach_send_failed: { label: "Email send failed", icon: "✗" },
};

const WORKFLOW_MILESTONES: { id: string; label: string; color: string; icon: string }[] = [
  { id: "detected", label: "Opportunity discovered", color: "text-slate-400", icon: "◉" },
  { id: "assessment", label: "Assessment completed", color: "text-slate-400", icon: "◉" },
  { id: "audit", label: "Audit generated", color: "text-slate-400", icon: "◉" },
  { id: "draft", label: "Draft created", color: "text-slate-400", icon: "◉" },
  { id: "approved", label: "Outreach approved", color: "text-slate-400", icon: "◉" },
  { id: "sent", label: "Email sent", color: "text-slate-400", icon: "◉" },
  { id: "replied", label: "Customer replied", color: "text-slate-400", icon: "◉" },
  { id: "meeting", label: "Meeting booked", color: "text-slate-400", icon: "◉" },
  { id: "converted", label: "Opportunity converted", color: "text-slate-400", icon: "◉" },
];

function humaniseAction(action: string): string {
  if (SYSTEM_EVENTS[action]) return SYSTEM_EVENTS[action].label;
  return action
    .split("_")
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function iconForAction(action: string): string {
  if (SYSTEM_EVENTS[action]) return SYSTEM_EVENTS[action].icon;
  return "•";
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return formatTimestamp(iso);
}

/** A single resolved milestone in the timeline. */
export interface TimelineMilestone {
  id: string;
  label: string;
  complete: boolean;
  current: boolean;
  /**
   * True ONLY for the otherwise-Converted milestone when the opportunity has
   * been closed. Closed is a distinct neutral terminal — it must NOT show the
   * emerald "Opportunity converted" success treatment.
   */
  closedTerminal?: boolean;
}

/**
 * Determine which milestone events are complete based on review/outcome state.
 *
 * `converted` is the success terminal — all 9 milestones complete, last in
 *   emerald.
 * `closed` is the neutral/abandoned terminal — first 8 milestones complete,
 *   last rendered in slate as "Opportunity closed" (no emerald checkmark).
 */
export function deriveMilestones(
  reviewState: ReviewState,
  outcomeState: OutcomeState | null,
  hasAssessment: boolean,
  hasAudit: boolean,
  hasDraft: boolean,
  hasSentDraft: boolean,
): TimelineMilestone[] {
  const reviewIdx = ["detected", "reviewed", "approved", "contact_ready"].indexOf(reviewState);
  const isClosed = outcomeState === "closed";
  const isConverted = outcomeState === "converted";

  return WORKFLOW_MILESTONES.map((m, i) => {
    let complete = false;
    let current = false;
    let closedTerminal = false;

    if (isClosed) {
      // Closed terminal: the first 8 milestones (up to but not including the
      // converted position) are complete; the milestone at index 8 is rendered
      // as the current neutral terminal — NOT marked complete.
      if (i < 8) complete = true;
      if (i === 8) {
        current = true;
        closedTerminal = true;
      }
    } else {
      // Normal progress (incl. converted success terminal)
      let progress = 0;
      if (reviewIdx >= 0) progress = 1;
      if (hasAssessment) progress = 2;
      if (hasAudit) progress = 3;
      if (hasDraft) progress = 4;
      if (reviewIdx >= 2) progress = 5;
      if (hasSentDraft) progress = 6;
      if (isConverted) progress = 9;
      else if (outcomeState === "meeting_booked") progress = 8;
      else if (outcomeState !== null && ["awaiting_response", "replied"].includes(outcomeState)) progress = 7;

      if (i < progress) complete = true;
      if (i === progress) current = true;
    }

    return {
      id: m.id,
      // Closed terminal: relabel the last milestone explicitly so it does NOT
      // read as "Opportunity converted" — neutral closure instead.
      label: closedTerminal ? "Opportunity closed" : m.label,
      complete,
      current,
      closedTerminal,
    };
  });
}

interface EventTimelineProps {
  events: ConsoleEvent[];
  reviewState: ReviewState;
  outcomeState: OutcomeState | null;
  hasAssessment: boolean;
  hasAudit: boolean;
  hasDraft: boolean;
  hasSentDraft: boolean;
}

/**
 * Vertical event timeline showing the opportunity lifecycle.
 * Combines console events with workflow milestones.
 */
export default function EventTimeline({
  events,
  reviewState,
  outcomeState,
  hasAssessment,
  hasAudit,
  hasDraft,
  hasSentDraft,
}: EventTimelineProps) {
  const [showAllEvents, setShowAllEvents] = useState(false);

  const milestones = deriveMilestones(
    reviewState,
    outcomeState,
    hasAssessment,
    hasAudit,
    hasDraft,
    hasSentDraft,
  );

  // Filter to only show relevant events (not the system noise events that are represented by milestones)
  const displayEvents = showAllEvents ? events : events.slice(0, 5);
  const hasMore = events.length > 5;

  return (
    <div className="space-y-1">
      {/* Workflow milestones */}
      <div className="relative">
        {milestones.map((m, idx) => {
          const isLast = idx === milestones.length - 1;
          const bgColor = m.closedTerminal
            ? "bg-slate-700/60 ring-slate-600/50"
            : m.complete
              ? "bg-emerald-500/20 ring-emerald-500/40"
              : m.current
                ? "bg-accent-500/20 ring-accent-500/40"
                : "bg-slate-800/60 ring-slate-700/50";
          const lineColor = m.closedTerminal
            ? "bg-slate-700/60"
            : m.complete
              ? "bg-emerald-500/30"
              : m.current
                ? "bg-accent-500/20"
                : "bg-slate-800";

          // Label class derives the closed-terminal slate/neutral palette —
          // distinct from emerald success (complete) and accent current.
          const labelClass = m.closedTerminal
            ? "text-slate-300"
            : m.complete
              ? "text-emerald-300"
              : m.current
                ? "text-accent-200"
                : "text-slate-500";

          return (
            <div key={m.id} className="relative flex gap-3 pb-2 last:pb-0">
              {/* Vertical line */}
              {!isLast && (
                <div
                  className={`absolute left-[0.5625rem] top-5 w-px ${lineColor}`}
                  style={{ height: "calc(100% - 0.5rem)" }}
                  aria-hidden="true"
                />
              )}

              {/* Dot */}
              <div className="relative z-10 flex-shrink-0">
                <div
                  className={`flex h-[1.125rem] w-[1.125rem] items-center justify-center rounded-full ring-1 ring-inset ${bgColor} transition-all duration-300`}
                  aria-hidden="true"
                >
                  {m.closedTerminal ? (
                    // Hyphen/dash glyph: indicates terminal "ended" without implying conversion.
                    <span className="block h-px w-2.5 bg-slate-300" />
                  ) : m.complete ? (
                    <svg viewBox="0 0 12 12" fill="none" className="h-2.5 w-2.5 text-emerald-400">
                      <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : m.current ? (
                    <span className="h-2 w-2 rounded-full bg-accent-400 animate-pulse" />
                  ) : (
                    <span className="h-1.5 w-1.5 rounded-full bg-slate-600" />
                  )}
                </div>
              </div>

              {/* Label */}
              <div className="min-w-0 flex-1 pb-2">
                <span className={`text-sm font-medium transition-colors duration-300 ${labelClass}`}>
                  {m.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Divider / console events */}
      {events.length > 0 && (
        <>
          <div className="relative my-3">
            <div className="absolute inset-0 flex items-center" aria-hidden="true">
              <div className="w-full border-t border-slate-800" />
            </div>
            <div className="relative flex justify-center">
              <span className="bg-slate-900/60 px-2 text-[10px] text-slate-600 uppercase tracking-wider">
                Event Log
              </span>
            </div>
          </div>

          <div className="space-y-1">
            {displayEvents.map((event, idx) => {
              const isLatest = idx === 0;
              return (
                <div
                  key={event.id}
                  className={`flex items-start gap-2.5 rounded-md px-3 py-2 transition-colors ${
                    isLatest ? "bg-slate-800/40" : "hover:bg-slate-800/20"
                  }`}
                >
                  <span
                    className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] ${
                      event.action === "outreach_send_failed"
                        ? "bg-rose-500/20 text-rose-400"
                        : "bg-slate-800 text-slate-400"
                    }`}
                  >
                    {iconForAction(event.action)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-xs font-medium text-slate-300">
                        {humaniseAction(event.action)}
                      </span>
                      <span
                        className="shrink-0 text-[10px] text-slate-600"
                        title={formatTimestamp(event.created_at)}
                      >
                        {formatRelative(event.created_at)}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[10px] text-slate-600">
                      by {event.actor}
                      {event.draft_id ? ` · draft ${event.draft_id.slice(0, 8)}` : ""}
                    </p>
                  </div>
                </div>
              );
            })}
            {hasMore && !showAllEvents && (
              <button
                type="button"
                onClick={() => setShowAllEvents(true)}
                className="w-full rounded-md px-3 py-1.5 text-xs text-accent-400 transition-colors hover:bg-slate-800/30 hover:text-accent-300"
              >
                Show all {events.length} events
              </button>
            )}
            {showAllEvents && events.length > 5 && (
              <button
                type="button"
                onClick={() => setShowAllEvents(false)}
                className="w-full rounded-md px-3 py-1.5 text-xs text-slate-500 transition-colors hover:bg-slate-800/30"
              >
                Show fewer
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
