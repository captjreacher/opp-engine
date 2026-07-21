import type { Assessment } from "../lib/types";

export interface IssueItem {
  label: string;
  severity: "high" | "medium" | "low";
}

/** Derive primary issues from an assessment. */
export function deriveIssues(assessment: Assessment): IssueItem[] {
  const issues: IssueItem[] = [];

  if (assessment.trust_leakage_score >= 60) {
    issues.push({
      label: "Significant trust leakage — customers cannot verify legitimacy online",
      severity: "high",
    });
  } else if (assessment.trust_leakage_score >= 35) {
    issues.push({
      label: "Moderate trust leakage — online presence needs improvement",
      severity: "medium",
    });
  }

  if (assessment.demand_signal_score >= 70) {
    issues.push({
      label: "Strong demand signal — high market interest in this category",
      severity: "medium",
    });
  } else if (assessment.demand_signal_score < 35) {
    issues.push({
      label: "Weak demand signal — may need broader market validation",
      severity: "high",
    });
  }

  if (assessment.conversion_maturity_score < 40) {
    issues.push({
      label: "Low conversion maturity — enquiry and booking process is underdeveloped",
      severity: "high",
    });
  } else if (assessment.conversion_maturity_score < 65) {
    issues.push({
      label: "Conversion process needs refinement — opportunities to streamline bookings",
      severity: "medium",
    });
  }

  if (assessment.ai_readiness_score < 35) {
    issues.push({
      label: "Limited AI readiness — manual processes dominate operations",
      severity: "medium",
    });
  }

  // If no specific issues found, include a general observation
  if (issues.length === 0) {
    issues.push({
      label: "All key metrics indicate stable business operations",
      severity: "low",
    });
  }

  return issues.slice(0, 4); // Max 4 issues
}

/** Derive the recommended next action as a human-readable string. */
export function deriveNextAction(
  assessment: Assessment,
): { label: string; description: string } {
  const score = assessment.opportunity_score
    ? parseFloat(assessment.opportunity_score)
    : 0;

  if (score >= 120) {
    return {
      label: "Approve Digital Opportunity Audit",
      description:
        "This business shows strong opportunity signals. Proceed with a full digital audit to identify specific growth areas.",
    };
  }
  if (score >= 60) {
    return {
      label: "Review Assessment Data",
      description:
        "Moderate opportunity detected. Review the individual metrics below and consider proceeding with an audit.",
    };
  }
  return {
    label: "Monitor for Changes",
    description:
      "Current opportunity signals are below threshold. Continue monitoring or refine the search criteria.",
  };
}

type Severity = "high" | "medium" | "low";

const severityConfig: Record<Severity, {
  dot: string;
  label: string;
  badge: string;
}> = {
  high: { dot: "bg-rose-500", label: "High", badge: "bg-rose-500/15 text-rose-300 ring-rose-500/30" },
  medium: { dot: "bg-amber-500", label: "Medium", badge: "bg-amber-500/15 text-amber-300 ring-amber-500/30" },
  low: { dot: "bg-emerald-500", label: "Low", badge: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30" },
};

interface ExecutiveSummaryProps {
  assessment: Assessment | null;
}

/**
 * Executive summary section.
 * Shows AI-powered business summary, primary issues, and recommended next action.
 */
export default function ExecutiveSummary({ assessment }: ExecutiveSummaryProps) {
  if (!assessment) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-5">
        <h2 className="text-sm font-semibold text-slate-200">Business Summary</h2>
        <p className="mt-2 text-sm text-slate-500">No assessment data available yet.</p>
      </div>
    );
  }

  const issues = deriveIssues(assessment);
  const nextAction = deriveNextAction(assessment);
  const summary = assessment.assessment_summary;

  return (
    <div className="rounded-lg border border-slate-800 bg-gradient-to-br from-slate-900/80 to-slate-900/40 p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-200">
        <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 text-accent-400" aria-hidden="true">
          <path d="M9 5H5V9" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
          <path d="M5 15V19H9" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
          <path d="M15 19H19V15" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
          <path d="M19 9V5H15" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Business Summary
      </h2>

      {/* AI-generated summary */}
      {summary && (
        <p className="mt-3 text-sm leading-relaxed text-slate-300">
          {summary}
        </p>
      )}

      {/* Primary Issues */}
      {issues.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
            Primary Issues
          </p>
          <ul className="mt-2 space-y-1.5">
            {issues.map((issue, idx) => {
              const sev = severityConfig[issue.severity];
              return (
                <li key={idx} className="flex items-start gap-2">
                  <span
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${sev.dot}`}
                    aria-hidden="true"
                  />
                  <span className="text-sm text-slate-300">{issue.label}</span>
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${sev.badge}`}
                  >
                    {sev.label}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Recommended Next Action */}
      <div className="mt-4 rounded-md border border-accent-500/20 bg-accent-500/5 px-4 py-3">
        <div className="flex items-center gap-2">
          <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 shrink-0 text-accent-400" aria-hidden="true">
            <path d="M12 16V12M12 8H12.01" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
            <path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z" stroke="currentColor" strokeWidth={1.5} />
          </svg>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-accent-300">
              Recommended Next Action
            </p>
            <p className="text-sm font-semibold text-accent-200">{nextAction.label}</p>
            <p className="mt-0.5 text-xs text-slate-400">{nextAction.description}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
