import { scoreInterpretation } from "./ColorMeter";

interface AssessmentCardProps {
  label: string;
  value: number;
  type: "demand" | "trust_leakage" | "conversion" | "ai_readiness";
  barColor: string;
}

/**
 * Single assessment metric card.
 * Shows label, numeric score, colour-coded interpretation, and a horizontal bar.
 */
export default function AssessmentCard({
  label,
  value,
  type,
  barColor,
}: AssessmentCardProps) {
  const interpretation = scoreInterpretation(type, value);
  const pct = Math.max(0, Math.min(100, value));

  return (
    <div className="group rounded-lg border border-slate-800 bg-slate-900/60 p-3.5 transition-all duration-200 hover:border-slate-700 hover:bg-slate-900/80">
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-0.5">
          <p className="text-xs font-medium text-slate-400">{label}</p>
          <p className={`text-xs font-medium ${interpretation.color}`}>{interpretation.label}</p>
        </div>
        <span className="shrink-0 font-mono text-lg font-bold text-slate-100 transition-all duration-200 group-hover:text-white">
          {Number.isFinite(value) ? Math.round(value) : "—"}
        </span>
      </div>

      <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-slate-800">
        <div
          className={`h-full rounded-full ${barColor} transition-all duration-500 ease-out group-hover:opacity-90`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
