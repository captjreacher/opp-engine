import type { ScenarioMatch, OutreachTemplate } from "./companyScenarios.ts";

export const REPORT_TEMPLATE_VERSION = "mgrnz-scenario-report-v1";
export type ApprovedDetails = {
  approved_at: string;
  inclusions: string[];
  terms: string[];
};
export type Offer = {
  id: string;
  name: string;
  description: string;
  components: string[];
  price: Record<string, unknown>;
  price_version: string;
  price_text: string;
  gst: string;
  terms: string[];
  destination: string;
  source: string;
};
type RecordValue = Record<string, unknown>;
const requiredText = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0;
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map(
        (k) =>
          `${JSON.stringify(k)}:${canonicalJson((value as RecordValue)[k])}`,
      )
      .join(",")}}`;
  return JSON.stringify(value);
}

/** Billing is authoritative for identity, availability, pricing and tax. No fallback catalogue. */
export async function resolveOffer(
  template: OutreachTemplate & { approved_details?: ApprovedDetails },
  config: { base: string; token: string },
  request: typeof fetch = fetch,
  now = Date.now(),
): Promise<Offer> {
  if (!config.base || !config.token)
    throw new Error("Billing catalogue is not configured.");
  const base = new URL(config.base);
  if (
    base.protocol !== "https:" ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    !config.token
  )
    throw new Error("Billing catalogue is not configured.");
  const details = template.approved_details;
  if (
    !details ||
    !Number.isFinite(Date.parse(details.approved_at)) ||
    Date.parse(details.approved_at) > now ||
    !Array.isArray(details.inclusions) ||
    !details.inclusions.length ||
    !details.inclusions.every(requiredText) ||
    !Array.isArray(details.terms) ||
    !details.terms.length ||
    !details.terms.every(requiredText)
  )
    throw new Error(
      "Approved offer inclusions and commercial terms are required.",
    );
  const read = async (path: string): Promise<RecordValue> => {
    const res = await request(
      `${config.base.replace(/\/+$/, "")}/catalogue/${path}`,
      {
        headers: {
          Authorization: `Bearer ${config.token}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(10000),
        redirect: "error",
      },
    );
    if (!res.ok)
      throw new Error("Approved Billing offer could not be resolved.");
    const body = await res.json();
    if (!body.data || typeof body.data !== "object")
      throw new Error("Invalid Billing response.");
    return body.data;
  };
  const id = encodeURIComponent(template.offer_id);
  const plan = await read(`plans/${id}`);
  if (
    plan.planId !== template.offer_id ||
    plan.isSellable !== true ||
    plan.isArchived === true ||
    !requiredText(plan.name) ||
    !requiredText(plan.description) ||
    !requiredText(plan.billingType) ||
    !requiredText(plan.productId)
  )
    throw new Error("Offer is missing, withdrawn or incomplete.");
  const product = await read(`products/${encodeURIComponent(plan.productId)}`);
  if (
    product.productId !== plan.productId ||
    product.lifecycleStatus !== "published"
  )
    throw new Error("Offer product is not published.");
  const current = (await read(`plans/${id}/prices/current`))
    .current as RecordValue | null;
  if (
    !current ||
    current.planId !== template.offer_id ||
    !["published", "superseded"].includes(String(current.status)) ||
    !requiredText(current.planVersionId) ||
    !Number.isFinite(Date.parse(String(current.effectiveFrom))) ||
    Date.parse(String(current.effectiveFrom)) > now ||
    (current.effectiveTo !== null &&
      (!Number.isFinite(Date.parse(String(current.effectiveTo))) ||
        Date.parse(String(current.effectiveTo)) <= now))
  )
    throw new Error("No current approved price.");
  const price = current.price as RecordValue;
  if (!price || !["fixed", "poa", "usage"].includes(String(price.kind)))
    throw new Error("Unsupported approved price.");
  const tax = price.taxTreatment;
  if (
    !["inclusive", "exclusive", "exempt"].includes(String(tax)) ||
    (tax !== "exempt" &&
      (!Number.isInteger(price.taxRate) ||
        Number(price.taxRate) < 0 ||
        Number(price.taxRate) > 10000))
  )
    throw new Error("Approved GST treatment is missing.");
  const gst =
    tax === "exempt"
      ? "GST exempt"
      : `GST ${tax} (${Number(price.taxRate) / 100}%)`;
  let amount = "Price on application";
  if (price.kind !== "poa") {
    const minor =
      price.kind === "fixed" ? price.amountMinor : price.unitAmountMinor;
    if (
      !Number.isSafeInteger(minor) ||
      Number(minor) < 0 ||
      !/^[A-Z]{3}$/.test(String(price.currency))
    )
      throw new Error("Approved numeric price is incomplete.");
    amount = `${price.currency} ${(Number(minor) / 100).toFixed(2)}${price.kind === "usage" ? " per unit" : ""}`;
  }
  return {
    id: template.offer_id,
    name: plan.name,
    description: plan.description,
    components: details.inclusions,
    price,
    price_version: current.planVersionId,
    price_text: `${amount} · ${plan.billingType} · ${gst}`,
    gst,
    terms: details.terms,
    destination: template.destination!,
    source: `${config.base.replace(/\/+$/, "")}/catalogue/plans/${id}`,
  };
}

export type ScenarioReport = ReturnType<typeof buildScenarioReport>;
export function buildScenarioReport(input: {
  lead: RecordValue;
  assessment: RecordValue;
  scenario: RecordValue;
  match: ScenarioMatch;
  template: OutreachTemplate | null;
  offer: Offer | null;
  blocked: string | null;
}) {
  const { lead, assessment, scenario, match, template, offer, blocked } = input;
  const config = (scenario.report_config ?? {}) as RecordValue;
  const text = (key: string, fallback: string) =>
    requiredText(config[key]) ? String(config[key]) : fallback;
  const evidence = match.evidence.filter((e) => e.supported === true);
  const sourceEvidence =
    (lead.enrichment_diagnostics as RecordValue | undefined)
      ?.enrichment_result ?? null;
  const references = new Set(evidence.map((e) => e.source));
  const collectReferences = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    for (const [key, entry] of Object.entries(value)) {
      if (
        ["source_url", "url", "provider_reference"].includes(key) &&
        requiredText(entry)
      )
        references.add(entry);
      else if (entry && typeof entry === "object") collectReferences(entry);
    }
  };
  collectReferences(sourceEvidence);
  return {
    template_version: REPORT_TEMPLATE_VERSION,
    business: {
      id: lead.id,
      name: lead.business_name,
      category: lead.category ?? null,
      location: lead.suburb ?? lead.region ?? null,
    },
    scenario: {
      id: match.scenario_id,
      key: match.scenario_key,
      name: scenario.name ?? match.scenario_key,
      category: config.category ?? null,
      version: match.scenario_version,
    },
    opportunity: evidence.length
      ? evidence.map((e) => e.description).join("; ")
      : "No supported opportunity established.",
    evidence,
    potential_impact: text(
      "potential_impact",
      "Business impact has not been established; validate with the business.",
    ),
    recommended_solution: text(
      "recommended_solution",
      offer?.description ??
        "Solution requires an approved offer and scope discussion.",
    ),
    offer,
    commercial_block: blocked,
    outreach_angle: text(
      "outreach_angle",
      "Discuss the recorded observations and confirm priorities with the business.",
    ),
    confidence: match.state,
    sources: [...references],
    source_evidence: sourceEvidence,
    limitations: [
      "Observations are point-in-time evidence, not proof of commercial impact or buying readiness.",
      ...(evidence.length
        ? []
        : ["No confirmed evidence; outreach unavailable."]),
      ...(blocked ? [blocked] : []),
    ],
    source_assessment_id: assessment.id,
    source_assessment: assessment,
    source_scenario: scenario,
    source_template: template,
  };
}

/** Required commercial and evidence paragraphs are generated independently of template copy. */
export function reportEmail(
  template: OutreachTemplate,
  reports: ScenarioReport[],
  businessName: string,
) {
  if (
    !reports.length ||
    reports.some(
      (r) => !r.offer || r.confidence !== "confirmed" || r.commercial_block,
    )
  )
    throw new Error(
      "Every selected scenario needs confirmed evidence and an approved offer.",
    );
  const offer = reports[0].offer!;
  if (reports.some((r) => canonicalJson(r.offer) !== canonicalJson(offer)))
    throw new Error(
      "Combined scenarios require the same approved offer; review the configured combined template.",
    );
  if (!template.body.includes("{{business_name}}"))
    throw new Error(
      "A personalised business introduction is required in the reviewed template.",
    );
  const blocks = reports.map(
    (r) =>
      `${r.scenario.name}: ${r.opportunity}\nProposed solution: ${r.recommended_solution}`,
  );
  const commercial = [
    offer.name,
    offer.description,
    "Includes: " + offer.components.join("; "),
    offer.price_text,
    "Terms: " + offer.terms.join("; "),
    offer.destination,
  ].join("\n");
  const render = (value: string) => {
    if (/{{(?!business_name}}|findings}}|destination}})[^}]+}}/.test(value))
      throw new Error("Unsupported template placeholder.");
    return value
      .replace(/{{business_name}}/g, () => businessName)
      .replace(/{{findings}}/g, () =>
        reports.map((r) => r.opportunity).join("; "),
      )
      .replace(/{{destination}}/g, () => offer.destination);
  };
  const intro = render(template.body);
  const subject = render(template.subject);
  const requiredIntro = intro
    .split("\n")
    .filter((line) => !["Hello,", "Kia ora,", "Hi,"].includes(line.trim()))
    .join("\n");
  const cta = "Would a conversation about these observations be useful?";
  return {
    subject,
    body: [intro, ...blocks, commercial, cta, "Kind regards,\nMGRNZ"].join(
      "\n\n",
    ),
    required_blocks: [requiredIntro, ...blocks, commercial, cta],
  };
}

/** Operators may reorder required blocks and edit using reviewed template phrases. New claims fail closed. */
export function validateEmailEdit(
  subject: string,
  body: string,
  original: { subject: string; body: string; required_blocks: string[] },
  phrases: string[] = [],
): string | null {
  if (!subject.trim() || !body.trim() || subject !== original.subject)
    return "Keep the reviewed template subject.";
  let remaining = body;
  for (const block of original.required_blocks) {
    if (!remaining.includes(block))
      return "Keep the supported findings, solution and approved commercial details intact.";
    remaining = remaining.replace(block, "");
  }
  let optional = original.body;
  for (const block of original.required_blocks)
    optional = optional.replace(block, "");
  const allowed = new Set(
    [
      ...optional.split(/\n+/),
      ...phrases,
      "Hello,",
      "Kia ora,",
      "Thank you,",
      "Kind regards,",
      "MGRNZ",
    ]
      .map((v) => v.trim())
      .filter(Boolean),
  );
  if (
    remaining
      .split(/\n+/)
      .some((line) => line.trim() && !allowed.has(line.trim()))
  )
    return "Use reviewed template phrases for edits; unsupported claims cannot be added.";
  return null;
}
