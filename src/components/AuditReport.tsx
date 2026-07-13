import type { AuditReport as AuditReportType } from "../lib/types";
import Badge, { toneForBand } from "./Badge";

function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** Renders any free-form narrative strings found in report_model (summary/narrative/sections). */
function NarrativeBlock({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </h4>
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-300">{value}</p>
    </div>
  );
}

interface AuditReportProps {
  report: AuditReportType | null;
}

/** Renders an audit report's metric grid + narrative + metadata. Never recomputes anything. */
export default function AuditReportDisplay({ report }: AuditReportProps) {
  if (!report) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-6 text-center text-sm text-slate-500">
        No audit report yet.
      </div>
    );
  }

  const reportModel = report.metadata_json?.report_model ?? null;
  const metrics = reportModel?.metrics ?? [];
  const customerReady = report.metadata_json?.validation?.customer_ready ?? false;

  const narrativeEntries: { label: string; value: string }[] = [];
  if (reportModel) {
    if (typeof reportModel.summary === "string" && reportModel.summary.trim()) {
      narrativeEntries.push({ label: "Summary", value: reportModel.summary });
    }
    if (typeof reportModel.narrative === "string" && reportModel.narrative.trim()) {
      narrativeEntries.push({ label: "Narrative", value: reportModel.narrative });
    }
    if (typeof reportModel.sections === "string" && reportModel.sections.trim()) {
      narrativeEntries.push({ label: "Sections", value: reportModel.sections });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge tone={customerReady ? "success" : "warning"}>
            {customerReady ? "Customer-ready" : "Draft"}
          </Badge>
          <span className="text-xs text-slate-500">
            v{report.report_version} · generated {formatTimestamp(report.generated_at)}
          </span>
        </div>
        {report.pdf_url && (
          <a
            href={report.pdf_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-medium text-accent-400 hover:text-accent-300 hover:underline"
          >
            View PDF ↗
          </a>
        )}
      </div>

      {metrics.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {metrics.map((metric) => (
            <div
              key={metric.id}
              className="rounded-lg border border-slate-800 bg-slate-900/60 p-3"
            >
              <div className="text-xs text-slate-500">{metric.label}</div>
              <div className="mt-1 flex items-baseline justify-between gap-2">
                <span className="text-lg font-semibold text-slate-100">{metric.value}</span>
                <Badge tone={toneForBand(metric.band)}>{metric.band}</Badge>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-slate-500">No metrics found in this report.</p>
      )}

      {narrativeEntries.length > 0 && (
        <div className="space-y-3 rounded-lg border border-slate-800 bg-slate-900/40 p-4">
          {narrativeEntries.map((entry) => (
            <NarrativeBlock key={entry.label} label={entry.label} value={entry.value} />
          ))}
        </div>
      )}
    </div>
  );
}
