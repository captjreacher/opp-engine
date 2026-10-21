import type { ScenarioReport } from "../../supabase/functions/_shared/scenarioReports";

export default function ScenarioReportView({
  report: r,
}: {
  report: ScenarioReport;
}) {
  return (
    <details className="rounded border border-graphite-700 p-3">
      <summary className="cursor-pointer text-accent-400">
        View Scenario Report — {String(r.scenario.name)}
      </summary>
      <dl className="mt-3 space-y-3 break-words text-sm">
        <div>
          <dt className="font-semibold">Business and opportunity</dt>
          <dd>
            {String(r.business.name)} · {String(r.business.id)} ·{" "}
            {String(r.business.location ?? "Location not recorded")}
          </dd>
        </div>
        <div>
          <dt className="font-semibold">Scenario and category</dt>
          <dd>
            {String(r.scenario.name)} v{r.scenario.version} ·{" "}
            {String(
              r.scenario.category ?? r.business.category ?? "Not configured",
            )}
          </dd>
        </div>
        <div>
          <dt className="font-semibold">Opportunity</dt>
          <dd>{r.opportunity}</dd>
        </div>
        <div>
          <dt className="font-semibold">Evidence and observed signals</dt>
          <dd>
            <ul>
              {r.evidence.map((e) => (
                <li key={e.key}>
                  {e.description} · {e.source} · {JSON.stringify(e.value)}
                </li>
              ))}
            </ul>
          </dd>
        </div>
        <div>
          <dt className="font-semibold">Potential business impact</dt>
          <dd>{r.potential_impact}</dd>
        </div>
        <div>
          <dt className="font-semibold">Recommended solution</dt>
          <dd>{r.recommended_solution}</dd>
        </div>
        <div>
          <dt className="font-semibold">Proposed offer and components</dt>
          <dd>
            {r.offer ? (
              <>
                {r.offer.name} ({r.offer.id})<p>{r.offer.description}</p>
                <ul>
                  {r.offer.components.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </>
            ) : (
              "Approved offer unavailable"
            )}
          </dd>
        </div>
        <div>
          <dt className="font-semibold">
            Approved price, GST and commercial terms
          </dt>
          <dd>
            {r.offer ? (
              <>
                <p>{r.offer.price_text}</p>
                <p>{r.offer.terms.join("; ")}</p>
                <a
                  className="text-accent-400"
                  href={r.offer.destination}
                  target="_blank"
                  rel="noreferrer"
                >
                  Offer destination
                </a>
                <p>Billing price version: {r.offer.price_version}</p>
              </>
            ) : (
              r.commercial_block
            )}
          </dd>
        </div>
        <div>
          <dt className="font-semibold">Recommended outreach angle</dt>
          <dd>{r.outreach_angle}</dd>
        </div>
        <div>
          <dt className="font-semibold">Confidence, sources and limitations</dt>
          <dd>
            {r.confidence}
            <p>{r.sources.join("; ")}</p>
            <ul>
              {r.limitations.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            <p>
              Assessment: {String(r.source_assessment_id)} · Template:{" "}
              {r.template_version}
            </p>
          </dd>
        </div>
      </dl>
    </details>
  );
}
