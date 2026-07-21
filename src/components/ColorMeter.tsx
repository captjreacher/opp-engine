interface ColorMeterProps {
  /** Numeric score value. */
  score: number;
  /** Maximum possible score. */
  max?: number;
  /** Optional label like "HIGH OPPORTUNITY", "MODERATE OPPORTUNITY", etc. */
  label?: string;
  /** Optional sub-label like "High priority" */
  subLabel?: string;
}

function scoreColor(pct: number): {
  label: string;
  text: string;
  bar: string;
  bg: string;
  ring: string;
} {
  if (pct >= 75) {
    return {
      label: "HIGH OPPORTUNITY",
      text: "text-emerald-300",
      bar: "bg-emerald-500",
      bg: "bg-emerald-500/10",
      ring: "ring-emerald-500/25",
    };
  }
  if (pct >= 45) {
    return {
      label: "MODERATE OPPORTUNITY",
      text: "text-amber-300",
      bar: "bg-amber-500",
      bg: "bg-amber-500/10",
      ring: "ring-amber-500/25",
    };
  }
  return {
    label: "LOW OPPORTUNITY",
    text: "text-rose-300",
    bar: "bg-rose-500",
    bg: "bg-rose-500/10",
    ring: "ring-rose-500/25",
  };
}

/**
 * Color-coded score gauge.
 * Shows the numeric score out of max, a progress bar, percentage, and a
 * qualitative label (HIGH / MODERATE / LOW) with matching colours.
 */
export default function ColorMeter({
  score,
  max = 200,
  label,
  subLabel,
}: ColorMeterProps) {
  const safeMax = max > 0 ? max : 200;
  const pct = Math.max(0, Math.min(100, (score / safeMax) * 100));
  const colors = scoreColor(pct);

  return (
    <div
      className={`rounded-lg border px-5 py-4 transition-all duration-200 ${colors.bg} ${colors.ring} ring-1 ring-inset`}
    >
      {/* Top: label + score */}
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-0.5">
          {label && (
            <p className="text-xs font-medium uppercase tracking-[0.15em] text-slate-500">
              {label}
            </p>
          )}
          <p className={`text-lg font-bold tracking-tight ${colors.text}`}>
            {colors.label}
          </p>
          {subLabel && (
            <p className="text-xs text-slate-500">{subLabel}</p>
          )}
        </div>
        <div className="text-right">
          <span className={`text-3xl font-bold ${colors.text}`}>
            {Number.isFinite(score) ? Math.round(score) : "—"}
          </span>
          <span className="ml-1 text-sm text-slate-500">/ {safeMax}</span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-slate-800/60">
        <div
          className={`h-full rounded-full ${colors.bar} transition-all duration-700 ease-out`}
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Percentage + legend */}
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
        <span className="text-slate-500">
          {Math.round(pct)}% of maximum
        </span>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
            <span className="text-slate-500">High</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-amber-500" aria-hidden="true" />
            <span className="text-slate-500">Medium</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-rose-500" aria-hidden="true" />
            <span className="text-slate-500">Low</span>
          </span>
        </div>
      </div>
    </div>
  );
}

/** Determine the contribution level description for a given type of score. */
export function scoreInterpretation(
  type: "demand" | "trust_leakage" | "conversion" | "ai_readiness",
  value: number,
): { label: string; color: string } {
  switch (type) {
    case "demand":
      if (value >= 70) return { label: "Strong demand signal", color: "text-emerald-400" };
      if (value >= 40) return { label: "Moderate demand", color: "text-amber-400" };
      return { label: "Low demand signal", color: "text-rose-400" };
    case "trust_leakage":
      if (value >= 70) return { label: "Critical leakage", color: "text-rose-400" };
      if (value >= 40) return { label: "Significant leakage", color: "text-amber-400" };
      return { label: "Minor leakage", color: "text-emerald-400" };
    case "conversion":
      if (value >= 70) return { label: "Ready for conversion", color: "text-emerald-400" };
      if (value >= 40) return { label: "Developing maturity", color: "text-amber-400" };
      return { label: "Early stage", color: "text-rose-400" };
    case "ai_readiness":
      if (value >= 70) return { label: "AI ready", color: "text-emerald-400" };
      if (value >= 40) return { label: "Partial readiness", color: "text-amber-400" };
      return { label: "Limited readiness", color: "text-rose-400" };
  }
}
