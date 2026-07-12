interface ScoreBarProps {
  /** Current value. */
  value: number;
  /** Value that represents a "full" bar. Defaults to 100. */
  max?: number;
  /** Optional label rendered above the bar. */
  label?: string;
  /** Tailwind color class for the filled portion, e.g. "bg-accent-500". */
  colorClassName?: string;
  /** Render the numeric value to the right of the bar. */
  showValue?: boolean;
  /** Compact mode: thinner bar, no label row — for inline table cells. */
  compact?: boolean;
}

/** Small horizontal bar used to visualise a bounded numeric score. */
export default function ScoreBar({
  value,
  max = 100,
  label,
  colorClassName = "bg-accent-500",
  showValue = true,
  compact = false,
}: ScoreBarProps) {
  const safeMax = max > 0 ? max : 100;
  const pct = Math.max(0, Math.min(100, (value / safeMax) * 100));

  return (
    <div className={compact ? "w-24" : "w-full"}>
      {!compact && (label || showValue) && (
        <div className="mb-1 flex items-center justify-between text-xs text-slate-400">
          {label && <span>{label}</span>}
          {showValue && <span className="font-mono text-slate-300">{value}</span>}
        </div>
      )}
      <div
        className={`relative overflow-hidden rounded-full bg-slate-800 ${
          compact ? "h-1.5" : "h-2"
        }`}
      >
        <div
          className={`h-full rounded-full ${colorClassName} transition-[width]`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {compact && showValue && (
        <span className="mt-0.5 block text-right text-[10px] font-mono text-slate-500">
          {value}
        </span>
      )}
    </div>
  );
}
