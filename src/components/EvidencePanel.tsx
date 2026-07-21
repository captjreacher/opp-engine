import { useState } from "react";
import type { Assessment, Lead } from "../lib/types";

export type EvidenceStatus = "found" | "missing" | "partial" | "unknown";

export interface EvidenceItem {
  label: string;
  status: EvidenceStatus;
  detail?: string;
}

function statusIcon(status: EvidenceStatus): string {
  switch (status) {
    case "found":
      return "✓";
    case "missing":
      return "✗";
    case "partial":
      return "~";
    case "unknown":
      return "?";
  }
}

function statusColor(status: EvidenceStatus): string {
  switch (status) {
    case "found":
      return "bg-emerald-500/15 text-emerald-400 ring-emerald-500/30";
    case "missing":
      return "bg-rose-500/15 text-rose-400 ring-rose-500/30";
    case "partial":
      return "bg-amber-500/15 text-amber-400 ring-amber-500/30";
    case "unknown":
      return "bg-slate-700/50 text-slate-500 ring-slate-600/50";
  }
}

function statusLabel(status: EvidenceStatus): string {
  switch (status) {
    case "found": return "Found";
    case "missing": return "Missing";
    case "partial": return "Partial";
    case "unknown": return "Unknown";
  }
}

/** Derive evidence items from the lead record and optional assessment. */
export function deriveEvidence(lead: Lead, assessment?: Assessment | null): EvidenceItem[] {
  const aiReadiness = assessment?.ai_readiness_score;
  return [
    {
      label: "AI Confidence",
      status: aiReadiness !== undefined && aiReadiness >= 60 ? "found" : aiReadiness !== undefined ? "partial" : "unknown",
      detail: aiReadiness !== undefined ? `${Math.round(aiReadiness)}/100` : undefined,
    },
    {
      label: "Website",
      status: lead.website_url ? "found" : "missing",
      detail: lead.website_url ?? undefined,
    },
    {
      label: "Google Business Profile",
      status: lead.google_maps_url ? "found" : "missing",
      detail: lead.google_maps_url ? "Available" : undefined,
    },
    {
      label: "Maps",
      status: lead.google_maps_url ? "found" : "missing",
      detail: lead.google_maps_url ?? undefined,
    },
    {
      label: "Phone",
      status: lead.phone ? "found" : "missing",
      detail: lead.phone ?? undefined,
    },
    {
      label: "Email",
      status: lead.email ? "found" : "missing",
      detail: lead.email ?? undefined,
    },
    {
      label: "Social",
      status: lead.facebook_url ? "found" : lead.status ? "partial" : "missing",
      detail: lead.facebook_url ?? undefined,
    },
    {
      label: "Reviews",
      status: lead.source === "google_places" ? "partial" : "unknown",
      detail: lead.source === "google_places" ? "Available from Google" : undefined,
    },
    {
      label: "Business Category",
      status: lead.category ? "found" : "missing",
      detail: lead.category ?? undefined,
    },
    {
      label: "Contact Name",
      status: lead.trust_summary ? "partial" : "unknown",
      detail: lead.trust_summary ? "Inferred" : undefined,
    },
  ];
}

interface EvidencePanelProps {
  items: EvidenceItem[];
}

/**
 * Collapsible panel showing what evidence sources were found/missing/partial/unknown.
 */
export default function EvidencePanel({ items }: EvidencePanelProps) {
  const [open, setOpen] = useState(false);

  const foundCount = items.filter((i) => i.status === "found").length;
  const totalCount = items.length;

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/60 transition-all duration-200">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-800/40"
      >
        <div className="flex items-center gap-2">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            className="h-4 w-4 text-slate-400"
            aria-hidden="true"
          >
            <path
              d="M9 5L5 9L9 13"
              stroke="currentColor"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path d="M5 9H15C17.2091 9 19 10.7909 19 13V19" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
          </svg>
          <span className="text-sm font-medium text-slate-200">Evidence Used</span>
          <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-400">
            {foundCount}/{totalCount} found
          </span>
        </div>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          className={`h-4 w-4 text-slate-500 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        >
          <path d="M6 9L12 15L18 9" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <div
        className={`overflow-hidden transition-all duration-300 ease-in-out ${
          open ? "max-h-96 opacity-100" : "max-h-0 opacity-0"
        }`}
      >
        {items.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-slate-500">No evidence available.</p>
        ) : (
          <div className="px-4 pb-4">
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {items.map((item) => (
                <div
                  key={item.label}
                  className="flex items-center justify-between gap-2 rounded border border-slate-800 bg-slate-950/40 px-3 py-2"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ring-1 ring-inset ${statusColor(item.status)}`}
                    >
                      {statusIcon(item.status)}
                    </span>
                    <span className="text-sm text-slate-300 truncate">{item.label}</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${statusColor(item.status)}`}
                    >
                      {statusLabel(item.status)}
                    </span>
                    {item.detail && (
                      <span className="hidden text-[10px] text-slate-500 sm:inline max-w-24 truncate" title={item.detail}>
                        {item.detail}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
