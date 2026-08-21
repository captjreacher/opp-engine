import { useState } from "react";
import type { FormEvent } from "react";
import type { VisualEvidence } from "../lib/types";
import { addAnalysableEvidence } from "../lib/api";
import {
  buildStreetViewUrl,
  formatCaptureDate,
  formatEvidenceAge,
  isReferenceOnly,
  VISUAL_FINDING_CATEGORIES,
  VISUAL_FINDING_CATEGORY_LABELS,
} from "../lib/visualEvidence";
import Badge from "./Badge";

// ── Display helpers (pure) ──────────────────────────────────────────────────

/** Operator-facing source label for an evidence row. */
export function sourceLabel(source: VisualEvidence["source"]): string {
  switch (source) {
    case "google_street_view":
      return "Google Street View";
    case "google_places_photo":
      return "Google Places Photo";
    case "operator_upload":
      return "Operator-supplied image";
    case "licensed_external":
      return "Licensed image";
    case "public_web":
      return "Public web image";
  }
}

/** Coordinates formatted for display, or null when missing. */
export function formatCoordinates(evidence: VisualEvidence): string | null {
  if (
    evidence.latitude === null ||
    evidence.latitude === undefined ||
    evidence.longitude === null ||
    evidence.longitude === undefined
  ) {
    return null;
  }
  return `${evidence.latitude.toFixed(6)}, ${evidence.longitude.toFixed(6)}`;
}

interface EvidenceCardProps {
  evidence: VisualEvidence;
}

/**
 * One evidence row. Google Street View evidence is rendered as REFERENCE-ONLY
 * with the explicit "not available for AI analysis" marker. The only action is
 * a deep link into Google's own Street View page — no imagery is fetched,
 * downloaded or proxied by this app.
 */
function EvidenceCard({ evidence }: EvidenceCardProps) {
  const referenceOnly = isReferenceOnly(evidence);
  const streetViewUrl = evidence.source === "google_street_view" ? buildStreetViewUrl(evidence) : null;
  const captureDate = formatCaptureDate(evidence);
  const age = formatEvidenceAge(evidence);
  const coords = formatCoordinates(evidence);

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3 space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true">
            <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="12" cy="9" r="2.5" stroke="currentColor" strokeWidth={1.5} />
          </svg>
          <span className="text-sm font-medium text-slate-200 truncate">{sourceLabel(evidence.source)}</span>
          {evidence.media_type !== "image" && (
            <Badge tone="neutral">{evidence.media_type}</Badge>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {referenceOnly ? (
            <Badge tone="warning" title="analysis_allowed=false · storage_mode=reference_only">
              Reference only
            </Badge>
          ) : (
            <Badge tone="success" title="analysis_allowed=true · managed evidence">
              Analysable
            </Badge>
          )}
        </div>
      </div>

      <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-2">
        {evidence.provider_reference && (
          <div className="min-w-0">
            <dt className="text-slate-500">Provider reference</dt>
            <dd className="text-slate-300 truncate" title={evidence.provider_reference}>
              {evidence.provider_reference}
            </dd>
          </div>
        )}
        <div>
          <dt className="text-slate-500">Capture date</dt>
          <dd className="text-slate-300">
            {captureDate}
            {evidence.capture_date_precision === "month" && (
              <span className="ml-1 text-slate-500">(month precision)</span>
            )}
            {evidence.capture_date_precision === "year" && (
              <span className="ml-1 text-slate-500">(year precision)</span>
            )}
          </dd>
        </div>
        {age && (
          <div>
            <dt className="text-slate-500">Evidence age</dt>
            <dd className="text-slate-300">{age}</dd>
          </div>
        )}
        {coords && (
          <div>
            <dt className="text-slate-500">Location</dt>
            <dd className="text-slate-300 font-mono">{coords}</dd>
          </div>
        )}
        <div>
          <dt className="text-slate-500">Status</dt>
          <dd className="text-slate-300 capitalize">{evidence.status}</dd>
        </div>
      </dl>

      {referenceOnly && (
        <p className="rounded border border-amber-500/20 bg-amber-500/5 px-2.5 py-1.5 text-xs text-amber-200/90">
          Reference only — not available for AI analysis. No imagery is stored,
          copied or sent to any model.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-0.5">
        {streetViewUrl && (
          <a
            href={streetViewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded border border-slate-700 px-2.5 py-1 text-xs text-slate-300 transition-colors hover:border-accent-500 hover:text-accent-300"
          >
            Open Street View
            <svg viewBox="0 0 24 24" fill="none" className="h-3 w-3" aria-hidden="true">
              <path d="M18 13V19C18 19.5304 17.7893 20.0391 17.4142 20.4142C17.0391 20.7893 16.5304 21 16 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V8C3 7.46957 3.21071 6.96086 3.58579 6.58579C3.96086 6.21071 4.46957 6 5 6H11M15 3H21V9M21 3L10 14" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </a>
        )}
      </div>
    </div>
  );
}

// ── "Add analysable image" form (contract boundary, not a storage system) ───

interface AddAnalysableFormProps {
  leadId: string;
  onAdded: () => Promise<void>;
}

/**
 * Entry point for operator-supplied / licensed imagery that MAY later be
 * analysed by the vision classifier. The operator references a hosted image
 * URL; this app never uploads or stores image bytes itself. The API records a
 * managed evidence row (analysis_allowed = true). Reference-only evidence is
 * never converted here — this always creates NEW evidence.
 */
function AddAnalysableForm({ leadId, onAdded }: AddAnalysableFormProps) {
  const [open, setOpen] = useState(false);
  const [sourceUrl, setSourceUrl] = useState("");
  const [source, setSource] = useState<"operator_upload" | "licensed_external">("operator_upload");
  const [capturedAt, setCapturedAt] = useState("");
  const [precision, setPrecision] = useState<"exact" | "month" | "year" | "">("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const lat = latitude.trim() === "" ? null : Number(latitude);
      const lng = longitude.trim() === "" ? null : Number(longitude);
      await addAnalysableEvidence(leadId, {
        source_url: sourceUrl.trim(),
        source,
        captured_at: capturedAt.trim() === "" ? null : new Date(capturedAt).toISOString(),
        capture_date_precision: precision === "" ? null : precision,
        latitude: lat !== null && Number.isFinite(lat) ? lat : null,
        longitude: lng !== null && Number.isFinite(lng) ? lng : null,
      });
      setSourceUrl("");
      setCapturedAt("");
      setLatitude("");
      setLongitude("");
      setPrecision("");
      setOpen(false);
      await onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add evidence.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded bg-accent-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-500"
      >
        <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
          <path d="M12 5V19M5 12H19" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Add analysable image
      </button>
    );
  }

  const inputClass =
    "w-full rounded border border-slate-700 bg-slate-950/60 px-2.5 py-1.5 text-sm text-slate-200 placeholder-slate-600 outline-none focus:border-accent-500";

  return (
    <form onSubmit={handleSubmit} className="space-y-2.5 rounded border border-accent-500/20 bg-accent-500/5 p-3">
      <p className="text-xs text-slate-400">
        Add an operator-supplied or licensed image for future AI analysis. Provide the hosted
        image URL — the app does not upload image files directly.
      </p>
      <div>
        <label htmlFor="ve-source-url" className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-slate-500">
          Image URL *
        </label>
        <input
          id="ve-source-url"
          type="url"
          required
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
          placeholder="https://example.com/photo.jpg"
          className={inputClass}
        />
      </div>
      <div>
        <label htmlFor="ve-source" className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-slate-500">
          Provenance
        </label>
        <select
          id="ve-source"
          value={source}
          onChange={(e) => setSource(e.target.value as "operator_upload" | "licensed_external")}
          className={inputClass}
        >
          <option value="operator_upload">Operator-supplied</option>
          <option value="licensed_external">Licensed / permitted</option>
        </select>
      </div>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <div>
          <label htmlFor="ve-captured-at" className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-slate-500">
            Capture date
          </label>
          <input
            id="ve-captured-at"
            type="date"
            value={capturedAt}
            onChange={(e) => setCapturedAt(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="ve-precision" className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-slate-500">
            Precision
          </label>
          <select
            id="ve-precision"
            value={precision}
            onChange={(e) => setPrecision(e.target.value as "exact" | "month" | "year" | "")}
            className={inputClass}
          >
            <option value="">Unknown</option>
            <option value="exact">Exact</option>
            <option value="month">Month</option>
            <option value="year">Year</option>
          </select>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <div>
          <label htmlFor="ve-lat" className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-slate-500">
            Latitude (optional)
          </label>
          <input
            id="ve-lat"
            type="number"
            step="any"
            value={latitude}
            onChange={(e) => setLatitude(e.target.value)}
            placeholder="-36.774"
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="ve-lng" className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-slate-500">
            Longitude (optional)
          </label>
          <input
            id="ve-lng"
            type="number"
            step="any"
            value={longitude}
            onChange={(e) => setLongitude(e.target.value)}
            placeholder="174.537"
            className={inputClass}
          />
        </div>
      </div>
      {error && (
        <p className="rounded border border-rose-500/30 bg-rose-500/10 px-2.5 py-1.5 text-xs text-rose-300">
          {error}
        </p>
      )}
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="rounded bg-accent-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "Adding…" : "Add evidence"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300 transition-colors hover:border-slate-600 hover:text-slate-100"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// ── Panel ───────────────────────────────────────────────────────────────────

interface VisualEvidencePanelProps {
  leadId: string;
  evidence: VisualEvidence[];
  onAdded: () => Promise<void>;
}

/**
 * "Visual Evidence" section for Opportunity Detail.
 *
 * - Google Street View rows render as reference-only with an explicit
 *   "not available for AI analysis" marker and an "Open Street View" deep link
 *   into Google's own page (never a proxied/fetched image).
 * - "Add analysable image" is the entry point for operator-supplied/licensed
 *   imagery (analysis_allowed = true) and always creates NEW evidence — it can
 *   never convert reference-only evidence into analysable evidence.
 * - Future visual-condition findings will be listed per evidence item with
 *   provenance back to its id; no findings are produced or faked yet.
 */
export default function VisualEvidencePanel({ leadId, evidence, onAdded }: VisualEvidencePanelProps) {
  const streetViewCount = evidence.filter((e) => e.source === "google_street_view").length;
  const analysableCount = evidence.filter((e) => !isReferenceOnly(e)).length;

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-200">
          <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 text-slate-400" aria-hidden="true">
            <path d="M2 12S5 4 12 4s10 8 10 8-3 8-10 8-10-8-10-8z" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth={1.5} />
          </svg>
          Visual Evidence
        </h2>
        <div className="flex items-center gap-1.5">
          {streetViewCount > 0 && (
            <Badge tone="warning" title="Reference-only Street View evidence — not available for AI analysis">
              {streetViewCount} Street View
            </Badge>
          )}
          {analysableCount > 0 && (
            <Badge tone="success" title="Managed evidence eligible for AI analysis">
              {analysableCount} analysable
            </Badge>
          )}
        </div>
      </div>

      {evidence.length === 0 ? (
        <p className="text-sm text-slate-500">
          No visual evidence recorded for this opportunity yet.
        </p>
      ) : (
        <div className="space-y-2.5">
          {evidence.map((item) => (
            <EvidenceCard key={item.id} evidence={item} />
          ))}
        </div>
      )}

      <div className="border-t border-slate-800 pt-3 space-y-3">
        <AddAnalysableForm leadId={leadId} onAdded={onAdded} />
        <p className="text-[11px] leading-relaxed text-slate-500">
          Future visual analysis will report conditions (
          {VISUAL_FINDING_CATEGORIES.map((c) => VISUAL_FINDING_CATEGORY_LABELS[c]).join(", ")}
          ) with provenance back to the exact evidence item. No findings are generated yet.
        </p>
      </div>
    </section>
  );
}
