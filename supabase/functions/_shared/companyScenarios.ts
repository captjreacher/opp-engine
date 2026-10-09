export type Finding = { key: string; description: string; source: string; value: unknown; score: number };
export type ScenarioMatch = { scenario_key: string; scenario_id: string; scenario_version: number; state: "confirmed" | "uncertain" | "unassessed"; evidence: Finding[]; assessed_at: string; score: number | null };
export type CompanyScenario = { id: string; slug: string; version: number; status?: string; assessment_config: Record<string, unknown>; discovery_config?: Record<string, unknown> };
type Rule = { path: string; equals?: unknown; below?: number; includes?: string; description: string; score: number; evidence_key?: string };
function at(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((v, key) => v && typeof v === "object" ? (v as Record<string, unknown>)[key] : undefined, value);
}
export function evaluateScenarios(scenarios: CompanyScenario[], facts: Record<string, unknown>, source: string, assessedAt: string): ScenarioMatch[] {
  // A slug is the stable scenario identity across registry versions. Never first-match wins.
  const latest = new Map<string, CompanyScenario>();
  for (const scenario of scenarios) if ((!scenario.status || scenario.status === "active") && (!latest.has(scenario.slug) || latest.get(scenario.slug)!.version < scenario.version)) latest.set(scenario.slug, scenario);
  return [...latest.values()].map((scenario) => {
    const configured = scenario.assessment_config.evidence_rules;
    const rules: Rule[] = Array.isArray(configured) ? configured as Rule[] : scenario.slug === "local-digital-presence" ? [
      { path: "enrichment.trust_score", below: 60, description: "Recorded digital trust score is below 60", score: 70 },
      { path: "enrichment.trust_signals", includes: "clear_contact_pathway", description: "A contact pathway was observed", score: 30 },
    ] : [];
    const evidence: Finding[] = [];
    let observed = false;
    for (const rule of rules) {
      if (!rule || typeof rule.path !== "string" || !Number.isFinite(rule.score) || typeof rule.description !== "string") continue;
      const value = at(facts, rule.path);
      if (value === undefined || value === null) continue; // Missing never means absent.
      observed = true;
      const matches = rule.below !== undefined ? typeof value === "number" && value < rule.below : rule.includes !== undefined ? Array.isArray(value) && value.includes(rule.includes) : Object.prototype.hasOwnProperty.call(rule, "equals") && value === rule.equals;
      if (matches) evidence.push({ key: rule.evidence_key ?? rule.path, description: rule.description, source, value, score: Math.max(0, Math.min(100, rule.score)) });
    }
    return { scenario_key: scenario.slug, scenario_id: scenario.id, scenario_version: scenario.version, state: evidence.length ? "confirmed" : observed ? "uncertain" : "unassessed", evidence, assessed_at: assessedAt, score: evidence.length ? Math.max(...evidence.map(e => e.score)) : null };
  });
}
export function aggregateScenarios(matches: ScenarioMatch[], demand: number, trust: number) {
  // Existing generated scale: 1.5*demand + trust, 0..250. Max per shared finding.
  const unique = new Map<string, number>();
  for (const match of matches.filter(m => m.state === "confirmed")) for (const e of match.evidence) unique.set(e.key, Math.max(unique.get(e.key) ?? 0, e.score));
  const strengths = [...unique.values()].sort((a,b) => b-a);
  const independentSupport = Math.min(10, strengths.slice(1).reduce((sum, score) => sum + score / 20, 0));
  const strongest = Math.max(0, trust, strengths[0] ?? 0);
  const adjustedTrust = Math.min(100, strongest + independentSupport);
  return { demand_signal_score: demand, trust_leakage_score: Math.round(adjustedTrust), overall_score: 1.5*demand + Math.round(adjustedTrust), explanation: { rule: "company-evidence-v1", base_score: 1.5*demand + trust, strongest_evidence: strongest, independent_support: Math.round(adjustedTrust)-Math.min(100,strongest), unique_evidence_keys: [...unique.keys()], note: "Shared evidence counts once; scenario count is not commercial value or buying readiness." } };
}
export type OutreachTemplate = { id: string; version: number; name: string; scenario_keys: string[]; combined: boolean; subject: string; body: string; offer_id: string; destination: string | null; destination_verified_at: string | null; enabled: boolean };
export function compatibleTemplates(matches: ScenarioMatch[], templates: OutreachTemplate[]): OutreachTemplate[] {
  const confirmed = new Set(matches.filter(m => m.state === "confirmed").map(m => m.scenario_key));
  return templates.filter(t => t.enabled && t.scenario_keys.length > 0 && (t.combined ? t.scenario_keys.every(key => confirmed.has(key)) : t.scenario_keys.length === 1 && confirmed.has(t.scenario_keys[0])));
}
export function selectTemplate(matches: ScenarioMatch[], templates: OutreachTemplate[], requested?: string): OutreachTemplate {
  const compatible = compatibleTemplates(matches, templates);
  const confirmed = matches.filter(m => m.state === "confirmed");
  const selected = requested ? compatible.find(t => t.id === requested) : confirmed.length === 1 && compatible.length === 1 ? compatible[0] : undefined;
  if (!selected) throw new Error("Select a compatible outreach template; multi-scenario companies require explicit selection.");
  if (!selected.destination || !selected.destination_verified_at || !selected.offer_id) throw new Error("Offer destination has not been verified.");
  const url = new URL(selected.destination);
  if (url.protocol !== "https:" || url.username || url.password || url.hash || [...url.searchParams.keys()].some(key => !["source", "utm_source", "utm_medium", "utm_campaign", "utm_content"].includes(key))) throw new Error("Unsafe offer destination or attribution parameters.");
  if (!/^(www\.)?maximisedai\.com$/.test(url.hostname)) throw new Error("Offer destination must be on the verified MaximisedAI website.");
  return selected;
}
export function renderTemplate(template: OutreachTemplate, matches: ScenarioMatch[], businessName: string) {
  const findings = matches.filter(m => m.state === "confirmed" && template.scenario_keys.includes(m.scenario_key)).flatMap(m => m.evidence);
  const descriptions = [...new Set(findings.map(e => e.description))];
  if (!descriptions.length) throw new Error("Recorded findings are required for personalisation.");
  const render = (text: string) => {
    if (/{{(?!business_name}}|findings}}|destination}})[^}]+}}/.test(text)) throw new Error("Unsupported template placeholder.");
    return text.replace(/{{business_name}}/g, () => businessName).replace(/{{findings}}/g, () => descriptions.join("; ")).replace(/{{destination}}/g, () => template.destination ?? "");
  };
  return { subject: render(template.subject), body: render(template.body), findings };
}
