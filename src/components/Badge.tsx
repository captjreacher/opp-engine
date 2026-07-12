import type { ReactNode } from "react";

export type BadgeTone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger"
  | "accent";

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: "bg-slate-700/60 text-slate-200 ring-1 ring-inset ring-slate-600/50",
  info: "bg-sky-500/15 text-sky-300 ring-1 ring-inset ring-sky-500/30",
  success: "bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-500/30",
  warning: "bg-amber-500/15 text-amber-300 ring-1 ring-inset ring-amber-500/30",
  danger: "bg-rose-500/15 text-rose-300 ring-1 ring-inset ring-rose-500/30",
  accent: "bg-accent-500/15 text-accent-300 ring-1 ring-inset ring-accent-500/30",
};

interface BadgeProps {
  children: ReactNode;
  tone?: BadgeTone;
  title?: string;
}

/** Small pill-shaped status/band indicator used across tables and detail panels. */
export default function Badge({ children, tone = "neutral", title }: BadgeProps) {
  return (
    <span
      title={title}
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${TONE_CLASSES[tone]}`}
    >
      {children}
    </span>
  );
}

/** Maps a pipeline/outreach/generic status string to a Badge tone, best-effort. */
export function toneForStatus(status: string | null | undefined): BadgeTone {
  const s = (status ?? "").toLowerCase();
  if (["approved", "contact_ready", "sent", "success", "assessed"].includes(s)) {
    return "success";
  }
  if (["reviewed", "in_progress", "processing"].includes(s)) {
    return "info";
  }
  if (["draft", "pending", "detected", "new"].includes(s)) {
    return "warning";
  }
  if (["rejected", "failed", "error", "lost"].includes(s)) {
    return "danger";
  }
  return "neutral";
}

/** Maps an audit metric "band" (e.g. low/medium/high/critical) to a Badge tone. */
export function toneForBand(band: string | null | undefined): BadgeTone {
  const b = (band ?? "").toLowerCase();
  if (["critical", "severe", "high_risk", "poor"].includes(b)) return "danger";
  if (["high", "warning", "at_risk", "fair"].includes(b)) return "warning";
  if (["medium", "moderate", "average"].includes(b)) return "info";
  if (["low", "good", "strong", "excellent", "healthy"].includes(b)) return "success";
  return "neutral";
}
