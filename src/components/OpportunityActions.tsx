import { useId, useRef, useState } from "react";
import { setOpportunityArchived } from "../lib/api";
import { isOpportunityArchived, PERMANENT_DELETION_UNAVAILABLE } from "../../supabase/functions/_shared/opportunityLifecycle";

interface Props {
  opportunity: { id: string; business_name: string; archived_at?: string | null; enrichment_status?: string | null; status?: string | null; pipeline_status?: string | null };
  disabled?: boolean;
  onChanged: () => Promise<void>;
}

/** A dialog-based actions menu avoids clipping inside mobile table scroll containers. */
export default function OpportunityActions({ opportunity, disabled = false, onChanged }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const archived = isOpportunityArchived(opportunity);
  const legacy = opportunity.status === "archived" || opportunity.pipeline_status === "archived";
  const blocked = legacy || !archived && opportunity.enrichment_status === "enriching";
  const action = archived ? "Restore" : "Archive";
  function close() { dialog.current?.close(); trigger.current?.focus(); }
  async function apply() {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      await setOpportunityArchived(opportunity.id, !archived, reason);
      await onChanged();
      close();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The opportunity could not be updated.");
    } finally { setBusy(false); }
  }
  const secondary = "min-h-9 rounded border border-graphite-700 bg-graphite-900 px-3 py-2 text-sm text-graphite-200 hover:bg-graphite-800 disabled:opacity-50";
  return <>
    <button ref={trigger} type="button" aria-haspopup="dialog" aria-label={`Actions for ${opportunity.business_name}`} disabled={disabled}
      className={secondary} onClick={() => { setConfirming(false); setError(null); setReason(""); dialog.current?.showModal(); }}>Actions</button>
    <dialog ref={dialog} aria-labelledby={titleId} aria-describedby={descriptionId}
      onCancel={(event) => { if (busy) event.preventDefault(); }} onClose={() => trigger.current?.focus()}
      className="oe-actions-dialog w-[calc(100%-2rem)] max-w-md rounded-md border border-graphite-700 bg-console-panel p-5 text-graphite-100">
      <h2 id={titleId} className="text-lg font-semibold">{confirming ? `${action} opportunity?` : "Opportunity actions"}</h2>
      <p id={descriptionId} className="mt-2 break-words text-sm text-graphite-300">{opportunity.business_name}</p>
      {!confirming ? <div className="mt-5 space-y-3">
        <button type="button" disabled={blocked} className={`${secondary} w-full text-left`} onClick={() => setConfirming(true)}>{action} opportunity</button>
        {legacy && <p className="text-sm text-amber-300">This legacy archive requires shared lifecycle review before restore. No disposition will be guessed.</p>}
        {blocked && !legacy && <p className="text-sm text-amber-300">Wait for enrichment to finish or resolve its state before archiving.</p>}
        <button type="button" disabled className="w-full rounded border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-left text-sm text-rose-300 opacity-60" aria-describedby={`${descriptionId}-delete`}>Permanently delete (unavailable)</button>
        <p id={`${descriptionId}-delete`} className="text-xs text-graphite-400">{PERMANENT_DELETION_UNAVAILABLE}</p>
        <div className="flex justify-end"><button type="button" className={secondary} onClick={close}>Close</button></div>
      </div> : <div className="mt-4 space-y-4">
        <p className="text-sm text-graphite-300">{archived
          ? "Restore this opportunity to the active list. Its original disposition, evidence and history will remain unchanged. Restore does not queue enrichment or send outreach."
          : "Move this opportunity out of active work. Evidence, assessments, audit reports, outreach history and duplicate-detection identity will be retained. This does not mark it not suitable or change Cockpit records."}</p>
        {!archived && <label className="block text-sm text-graphite-300">Reason (optional)
          <textarea autoFocus maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} disabled={busy}
            className="mt-2 min-h-20 w-full rounded border border-graphite-700 bg-graphite-950 p-2 text-sm" />
        </label>}
        {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" autoFocus={archived} disabled={busy} className={secondary} onClick={close}>Cancel</button>
          <button type="button" disabled={busy} className={secondary} onClick={() => void apply()}>{busy ? "Saving…" : `${action} opportunity`}</button>
        </div>
      </div>}
    </dialog>
  </>;
}
