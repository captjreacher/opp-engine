export type OpportunityScenario = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  version: number;
  discovery_config: Record<string, unknown>;
  assessment_config: Record<string, unknown>;
  report_config: Record<string, unknown>;
  outreach_config: Record<string, unknown>;
  commercial_config: Record<string, unknown>;
};

type ScenarioListResponse = {
  scenarios: OpportunityScenario[];
};

const API_BASE = (import.meta.env.VITE_API_BASE ?? "").trim();
const OPERATOR_TOKEN = (import.meta.env.VITE_OPERATOR_TOKEN ?? "").trim();

function scenarioEndpoint(): string {
  const trimmed = API_BASE.replace(/\/+$/, "");
  if (!trimmed) throw new Error("VITE_API_BASE is not configured.");
  if (/\/opportunities$/i.test(trimmed)) {
    return trimmed.replace(/\/opportunities$/i, "/opportunity-scenarios");
  }
  return `${trimmed}/opportunity-scenarios`;
}

export async function fetchOpportunityScenarios(): Promise<OpportunityScenario[]> {
  if (!OPERATOR_TOKEN) throw new Error("VITE_OPERATOR_TOKEN is not configured.");

  const response = await fetch(scenarioEndpoint(), {
    headers: {
      Authorization: `Bearer ${OPERATOR_TOKEN}`,
      "content-type": "application/json",
    },
  });

  const body = (await response.json().catch(() => ({}))) as Partial<ScenarioListResponse> & {
    error?: string;
    detail?: string;
  };

  if (!response.ok) {
    throw new Error(body.detail ?? body.error ?? `Scenario request failed with status ${response.status}`);
  }

  return Array.isArray(body.scenarios) ? body.scenarios : [];
}

export function scenarioDefaultResultLimit(scenario: OpportunityScenario): number | null {
  const value = scenario.discovery_config?.default_result_limit;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function scenarioDefaultRadius(scenario: OpportunityScenario): number | null {
  const value = scenario.discovery_config?.radius_m;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
