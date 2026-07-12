import { useEffect, useState } from "react";
import type { Draft } from "../lib/types";
import Badge, { toneForStatus } from "./Badge";

function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

interface DraftEditorProps {
  draft: Draft;
  onSave: (fields: { subject: string; body: string }) => Promise<void>;
  onApprove: () => Promise<void>;
  onSend: () => Promise<void>;
  saving: boolean;
  approving: boolean;
  sending: boolean;
  error: string | null;
}

/**
 * Editable subject + body for the latest outreach draft.
 * Flow: edit → Save changes → Approve → Send.
 * Send is available ONLY on an approved draft, requires an explicit two-step
 * confirmation (no auto-send), and the draft becomes read-only once sent.
 */
export default function DraftEditor({
  draft,
  onSave,
  onApprove,
  onSend,
  saving,
  approving,
  sending,
  error,
}: DraftEditorProps) {
  const [subject, setSubject] = useState(draft.subject ?? "");
  const [body, setBody] = useState(draft.body);
  const [confirmingSend, setConfirmingSend] = useState(false);

  // Resync when a fresh draft object arrives after refetch (Save/Approve/Send).
  useEffect(() => {
    setSubject(draft.subject ?? "");
    setBody(draft.body);
    setConfirmingSend(false);
  }, [draft.id, draft.subject, draft.body, draft.status]);

  const isDraftStatus = draft.status === "draft";
  const isApproved = draft.status === "approved";
  const isSent = draft.status === "sent";
  const dirty = subject !== (draft.subject ?? "") || body !== draft.body;
  const busy = saving || approving || sending;

  return (
    <div className="space-y-3 rounded-lg border border-slate-800 bg-slate-900/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge tone={toneForStatus(draft.status)}>{draft.status}</Badge>
          <span className="text-xs text-slate-500">
            created {formatTimestamp(draft.created_at)}
            {draft.approved_at ? ` · approved ${formatTimestamp(draft.approved_at)}` : ""}
            {draft.sent_at ? ` · sent ${formatTimestamp(draft.sent_at)}` : ""}
          </span>
        </div>
      </div>

      {isSent && (
        <div className="rounded border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
          This draft has been sent{draft.sent_at ? ` (${formatTimestamp(draft.sent_at)})` : ""}. It is now read-only.
        </div>
      )}

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-400">Subject</label>
        <input
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          disabled={busy || isSent}
          className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-accent-500 focus:outline-none disabled:opacity-60"
          placeholder="Draft subject"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-400">Body</label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          disabled={busy || isSent}
          rows={10}
          className="w-full resize-y rounded border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100 focus:border-accent-500 focus:outline-none disabled:opacity-60"
          placeholder="Draft body"
        />
      </div>

      {error && (
        <p className="rounded border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
          {error}
        </p>
      )}

      {!isSent && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onSave({ subject, body })}
            disabled={busy || !dirty}
            className="rounded bg-slate-700 px-3 py-1.5 text-sm font-medium text-slate-100 transition-colors hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>

          <button
            type="button"
            onClick={onApprove}
            disabled={busy || !isDraftStatus}
            title={!isDraftStatus ? "Only drafts in 'draft' status can be approved" : undefined}
            className="rounded bg-accent-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {approving ? "Approving…" : "Approve"}
          </button>

          {isApproved && !confirmingSend && (
            <button
              type="button"
              onClick={() => setConfirmingSend(true)}
              disabled={busy}
              className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Send…
            </button>
          )}

          {isApproved && confirmingSend && (
            <span className="inline-flex items-center gap-2">
              <span className="text-xs text-amber-300">Send this outreach email?</span>
              <button
                type="button"
                onClick={onSend}
                disabled={busy}
                className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {sending ? "Sending…" : "Confirm send"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingSend(false)}
                disabled={busy}
                className="rounded bg-slate-700 px-3 py-1.5 text-sm text-slate-200 transition-colors hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
            </span>
          )}

          {dirty && !busy && <span className="text-xs text-amber-400">Unsaved changes</span>}
        </div>
      )}

      {isApproved && (
        <p className="text-xs text-slate-500">
          Approved and ready to send. Sending is manual — nothing goes out until you confirm.
        </p>
      )}
    </div>
  );
}
