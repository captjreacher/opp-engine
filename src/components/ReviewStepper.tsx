import { REVIEW_STATE_ORDER, type ReviewState } from "../lib/types";

const STEP_LABEL: Record<ReviewState, string> = {
  detected: "Detected",
  reviewed: "Reviewed",
  approved: "Approved",
  contact_ready: "Contact Ready",
};

interface ReviewStepperProps {
  current: ReviewState;
}

/** Horizontal Detected -> Reviewed -> Approved -> Contact Ready progress stepper. */
export default function ReviewStepper({ current }: ReviewStepperProps) {
  const currentIndex = REVIEW_STATE_ORDER.indexOf(current);

  return (
    <ol className="flex items-center gap-2">
      {REVIEW_STATE_ORDER.map((state, idx) => {
        const isDone = idx < currentIndex;
        const isCurrent = idx === currentIndex;
        return (
          <li key={state} className="flex items-center gap-2">
            <div
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
                isCurrent
                  ? "bg-accent-500/20 text-accent-200 ring-1 ring-inset ring-accent-500/50"
                  : isDone
                    ? "bg-emerald-500/10 text-emerald-300 ring-1 ring-inset ring-emerald-500/30"
                    : "bg-slate-800/60 text-slate-500 ring-1 ring-inset ring-slate-700/50"
              }`}
            >
              <span
                className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] ${
                  isCurrent
                    ? "bg-accent-500 text-slate-950"
                    : isDone
                      ? "bg-emerald-500 text-slate-950"
                      : "bg-slate-700 text-slate-400"
                }`}
              >
                {isDone ? "✓" : idx + 1}
              </span>
              {STEP_LABEL[state]}
            </div>
            {idx < REVIEW_STATE_ORDER.length - 1 && (
              <span
                className={`h-px w-6 ${isDone ? "bg-emerald-500/40" : "bg-slate-700"}`}
                aria-hidden="true"
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
