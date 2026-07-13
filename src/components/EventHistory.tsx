import type { ConsoleEvent } from "../lib/types";

const ACTION_LABEL: Record<string, string> = {
  opportunity_review_started: "Review started",
  opportunity_review_completed: "Review completed",
  opportunity_contact_ready: "Marked contact ready",
  outreach_draft_created: "Outreach draft created",
  outreach_draft_updated: "Outreach draft updated",
  outreach_draft_approved: "Outreach draft approved",
};

function humaniseAction(action: string): string {
  if (ACTION_LABEL[action]) return ACTION_LABEL[action];
  return action
    .split("_")
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

interface EventHistoryProps {
  events: ConsoleEvent[];
}

/** Chronological timeline of operator console events (review transitions, draft actions). */
export default function EventHistory({ events }: EventHistoryProps) {
  if (events.length === 0) {
    return <p className="text-sm text-slate-500">No console events yet.</p>;
  }

  return (
    <ol className="space-y-3">
      {events.map((event) => (
        <li key={event.id} className="relative flex gap-3 pl-4">
          <span
            className="absolute left-0 top-1.5 h-2 w-2 rounded-full bg-accent-500"
            aria-hidden="true"
          />
          <div className="flex-1 border-l border-slate-800 pb-1 pl-4 -ml-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm font-medium text-slate-200">
                {humaniseAction(event.action)}
              </span>
              <span className="text-xs text-slate-500">
                {formatTimestamp(event.created_at)}
              </span>
            </div>
            <div className="mt-0.5 text-xs text-slate-500">
              by {event.actor}
              {event.draft_id ? ` · draft ${event.draft_id.slice(0, 8)}` : ""}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
