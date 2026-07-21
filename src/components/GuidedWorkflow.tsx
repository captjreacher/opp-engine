import type { Draft, OutcomeState, ReviewState } from "../lib/types";

export interface WorkflowState {
  reviewState: ReviewState;
  draftStatus: Draft["status"] | null;
  outcomeState: OutcomeState | null;
}

export interface WorkflowStep {
  id: string;
  label: string;
  subgroup: "review" | "outreach" | "outcome";
  isComplete: boolean;
  isCurrent: boolean;
  isFuture: boolean;
  isDisabled: boolean;
  actionable: boolean;
  actionLabel?: string;
  /**
   * True ONLY for the otherwise-Converted step when the opportunity is closed.
   * Closed is a distinct neutral terminal — it must NOT show the success-green
   * Converted checkmark. The label is overridden to "Closed Lost" in the same step.
   */
  closedTerminal?: boolean;
}

function clampIndex(idx: number, max: number): number {
  return Math.max(0, Math.min(idx, max));
}

/**
 * `converted` is a successful terminal (deal closed-won).
 * `closed` is a failed / abandoned terminal (deal closed-lost).
 * They must not be conflated — only `converted` marks the Converted step complete.
 */
export type WorkflowTerminalState = "active" | "converted" | "closed";

/**
 * Derive the active step index from the current workflow state.
 *
 * 0  = Detected
 * 1  = Review Started  (review_state >= reviewed)
 * 2  = Review Complete (review_state >= approved)
 * 3  = Contact Ready   (review_state >= contact_ready)
 * 4  = Outreach Approved (draft approved)
 * 5  = Sent            (outcome_state >= sent)
 * 6  = Responded       (outcome_state >= awaiting_response or replied)
 * 7  = Meeting Booked  (outcome_state >= meeting_booked)
 * 8  = Converted       (outcome_state === "converted")  ← NOT closed
 */
export function deriveWorkflowSteps(state: WorkflowState): {
  steps: WorkflowStep[];
  currentIndex: number;
  terminalState: WorkflowTerminalState;
} {
  const { reviewState, draftStatus, outcomeState } = state;

  // Split the two terminal states explicitly. A prior version of this function
  // collapsed these into a single boolean — that falsely implied a successful
  // conversion for any closed opportunity, so the flags are now independent.
  const isClosed = outcomeState === "closed";
  const isConverted = outcomeState === "converted";
  const terminalState: WorkflowTerminalState = isConverted
    ? "converted"
    : isClosed
      ? "closed"
      : "active";

  const reviewIdx = clampIndex(
    ["detected", "reviewed", "approved", "contact_ready"].indexOf(reviewState),
    3,
  );
  const draftApproved = draftStatus === "approved" || draftStatus === "sent";
  const sent = outcomeState !== null
    && ["sent", "awaiting_response", "replied", "meeting_booked", "converted", "closed"].includes(outcomeState);
  const responded = outcomeState !== null
    && ["awaiting_response", "replied", "meeting_booked", "converted"].includes(outcomeState);
  const meetingBooked = outcomeState !== null
    && ["meeting_booked", "converted"].includes(outcomeState);

  // Build ordered step list
  const stepDefs: { id: string; label: string; subgroup: "review" | "outreach" | "outcome" }[] = [
    { id: "detected", label: "Detected", subgroup: "review" },
    { id: "review_started", label: "Review Started", subgroup: "review" },
    { id: "review_complete", label: "Review Complete", subgroup: "review" },
    { id: "contact_ready", label: "Contact Ready", subgroup: "review" },
    { id: "outreach_approved", label: "Outreach Approved", subgroup: "outreach" },
    { id: "sent", label: "Sent", subgroup: "outcome" },
    { id: "responded", label: "Responded", subgroup: "outcome" },
    { id: "meeting_booked", label: "Meeting Booked", subgroup: "outcome" },
    { id: "converted", label: "Converted", subgroup: "outcome" },
  ];

  const completes: boolean[] = [
    true,                              // detected always complete
    reviewIdx >= 1,                    // review started
    reviewIdx >= 2,                    // review complete
    reviewIdx >= 3,                    // contact ready
    draftApproved,                     // outreach approved
    sent,                              // sent
    responded,                         // responded
    meetingBooked,                     // meeting booked
    isConverted,                       // converted — ONLY on actual conversion
  ];

  // In a terminal state (converted or closed), the operator cannot act further,
  // so the "current" pointer sits on the last step. In active state, it's the
  // first incomplete step.
  const lastIndex = stepDefs.length - 1;
  const currentIndex = terminalState !== "active"
    ? lastIndex
    : clampIndex(completes.findIndex((c) => !c), lastIndex);

  const steps: WorkflowStep[] = stepDefs.map((def, idx) => {
    const isComplete = completes[idx];
    const isCurrent = idx === currentIndex;
    const isFuture = idx > currentIndex;
    const closedTerminal = def.id === "converted" && terminalState === "closed";

    // Determine what action this step represents
    let actionable = false;
    let actionLabel: string | undefined;

    // Actionable ONLY in active state on the current incomplete step.
    // Terminal states never make any step actionable — there's no further action.
    if (terminalState === "active" && isCurrent && !isComplete) {
      actionable = true;
      switch (def.id) {
        case "review_started":
          actionLabel = "Start Review";
          break;
        case "review_complete":
          actionLabel = "Complete Review";
          break;
        case "contact_ready":
          actionLabel = "Mark Contact Ready";
          break;
        case "outreach_approved":
          actionLabel = "Approve Draft";
          break;
        case "sent":
          actionLabel = "Send Email";
          break;
        case "responded":
          actionLabel = "Mark Responded";
          break;
        case "meeting_booked":
          actionLabel = "Mark Meeting Booked";
          break;
        case "converted":
          actionLabel = "Mark Converted";
          break;
      }
    }

    return {
      ...def,
      // Closed terminal: relabel the converted step to "Closed Lost" so it does
      // NOT read as a successful conversion.
      label: closedTerminal ? "Closed Lost" : def.label,
      isComplete,
      isCurrent,
      isFuture,
      isDisabled: terminalState !== "active" || isFuture || isComplete,
      actionable,
      actionLabel,
      closedTerminal,
    };
  });

  return { steps, currentIndex, terminalState };
}

interface GuidedWorkflowProps {
  state: WorkflowState;
  onStepAction?: (stepId: string) => void;
}

const STEP_COLORS: Record<string, { ring: string; bg: string; dot: string }> = {
  review: { ring: "ring-accent-500/30", bg: "bg-accent-500/10", dot: "bg-accent-500" },
  outreach: { ring: "ring-violet-500/30", bg: "bg-violet-500/10", dot: "bg-violet-500" },
  outcome: { ring: "ring-emerald-500/30", bg: "bg-emerald-500/10", dot: "bg-emerald-500" },
};

/**
 * Horizontal guided workflow stepper.
 * Shows completed (green), current (accent), future (dim), and closed-lost (slate)
 * steps in a pipeline.
 */
export default function GuidedWorkflow({ state, onStepAction }: GuidedWorkflowProps) {
  const { steps } = deriveWorkflowSteps(state);

  return (
    <div className="overflow-x-auto pb-1" role="group" aria-label="Opportunity workflow">
      <ol className="flex items-center gap-0 min-w-max">
        {steps.map((step, idx) => {
          const colors = STEP_COLORS[step.subgroup];
          const isLast = idx === steps.length - 1;

          return (
            <li key={step.id} className="flex items-center">
              <button
                type="button"
                disabled={!step.actionable}
                onClick={() => step.actionable && onStepAction?.(step.id)}
                title={
                  step.isFuture
                    ? `Complete previous steps first`
                    : step.closedTerminal
                      ? `${step.label} — terminal (no conversion)`
                      : step.isComplete
                        ? `${step.label} — completed`
                        : step.actionable
                          ? `Click to ${step.actionLabel?.toLowerCase() ?? "advance"}`
                          : step.label
                }
                aria-current={step.isCurrent && step.actionable ? "step" : undefined}
                className={`
                  flex items-center gap-1.5 rounded-full px-2.5 py-2
                  min-h-[2.25rem] text-xs font-medium whitespace-nowrap
                  ring-1 ring-inset transition-all duration-200
                  ${step.closedTerminal
                    ? "bg-slate-800/60 text-slate-300 ring-slate-600/60"
                    : step.isComplete
                      ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30"
                      : step.isCurrent
                        ? `${colors.bg} ${colors.ring} text-slate-100`
                        : "bg-slate-800/40 text-slate-500 ring-slate-700/50"
                  }
                  ${step.actionable
                    ? "cursor-pointer hover:brightness-125 hover:scale-105 active:scale-95"
                    : "cursor-default"
                  }
                  ${step.isCurrent && step.actionable ? "ring-2 ring-accent-400/70 ring-offset-1 ring-offset-slate-900" : ""}
                  ${step.isCurrent && step.actionable ? "shadow-[0_0_8px_-1px_rgba(72,182,255,0.45)]" : ""}
                `}
              >
                {/* Step dot */}
                <span
                  className={`
                    flex h-4.5 w-4.5 items-center justify-center rounded-full
                    text-[10px] font-bold leading-none
                    transition-all duration-200
                    ${step.closedTerminal
                      ? "bg-slate-600 text-slate-300"
                      : step.isComplete
                        ? "bg-emerald-500 text-slate-950"
                        : step.isCurrent
                          ? `${colors.dot} text-white`
                          : "bg-slate-700 text-slate-400"
                    }
                  `}
                  style={{ width: "1.125rem", height: "1.125rem" }}
                >
                  {step.closedTerminal ? (
                    <svg viewBox="0 0 12 12" fill="none" className="h-2.5 w-2.5" aria-hidden="true">
                      {/* Hyphen/dash glyph reads as "no progress / ended" */}
                      <path d="M3 6H9" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" />
                    </svg>
                  ) : step.isComplete ? (
                    <svg viewBox="0 0 12 12" fill="none" className="h-2.5 w-2.5" aria-hidden="true">
                      <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : (
                    <span className="block leading-none">{idx + 1}</span>
                  )}
                </span>

                <span className="ml-0.5">{step.label}</span>

                {step.actionable && step.actionLabel && (
                  <span className="ml-1 hidden rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider sm:inline-block">
                    {step.actionLabel}
                  </span>
                )}

                {step.isCurrent && !step.actionable && !step.closedTerminal && (
                  <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-current opacity-60" aria-hidden="true" />
                )}
              </button>

              {/* Connector line — the segment leading INTO the closed-terminal
                  step is muted (not emerald) to avoid implying success. */}
              {!isLast && (
                <span
                  className={`
                    mx-1 h-px w-4 sm:w-8 transition-colors duration-300
                    ${connectorColor(steps, idx)}
                  `}
                  aria-hidden="true"
                />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/**
 * Connector colour strategy:
 * - If every step before AND the next step are complete → emerald (success path).
 * - If the next step is a closed-terminal → muted slate (neutral end).
 * - Otherwise → default slate (still in progress).
 */
function connectorColor(steps: WorkflowStep[], idx: number): string {
  const next = steps[idx + 1];
  if (!next) return "bg-slate-700";
  if (next.closedTerminal) {
    // Lead-in to the closed-terminal node: muted, not emerald.
    return allCompleteBefore(steps, idx) ? "bg-slate-600" : "bg-slate-700";
  }
  if (steps[idx].isComplete && allCompleteBefore(steps, idx)) {
    return "bg-emerald-500/40";
  }
  return "bg-slate-700";
}

function allCompleteBefore(steps: WorkflowStep[], idx: number): boolean {
  for (let i = 0; i <= idx; i++) {
    if (!steps[i].isComplete) return false;
  }
  return true;
}
