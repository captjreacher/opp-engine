export type GbpScenarioCode = 'G01' | 'G02';
export type GbpBand = '1-3' | '4-5';

export const GBP_OFFER_MAP = {
  G01: {
    slug: 'gbp-setup',
    template: 'gbp_setup_v1',
    templateId: '9f6c67f4-33d8-4d84-97f1-2b07e4210a01',
    title: 'GBP Setup',
    productId: 'product-maximisedai-gbp-setup',
    destination: 'https://maximisedai.com/products/gbp-setup/',
    plans: { '1-3': 'plan-maximisedai-gbp-setup-1-3-services', '4-5': 'plan-maximisedai-gbp-setup-4-5-services' },
  },
  G02: {
    slug: 'gbp-improvement',
    template: 'gbp_improvement_v1',
    templateId: '9f6c67f4-33d8-4d84-97f1-2b07e4210a02',
    title: 'GBP Improvement',
    productId: 'product-maximisedai-gbp-improvement',
    destination: 'https://maximisedai.com/products/gbp-improvement/',
    plans: { '1-3': 'plan-maximisedai-gbp-improvement-1-3-services', '4-5': 'plan-maximisedai-gbp-improvement-4-5-services' },
  },
} as const;

export const GBP_TERMS = [
  'Payment is required in full before work begins.',
  'You may cancel your order before work commences and receive a full refund, except for any third-party costs that were clearly disclosed and expressly agreed to as non-refundable before purchase.',
  'If you cancel after work has commenced, we may charge a reasonable amount for work already completed and any agreed, non-recoverable third-party costs. Any remaining prepaid balance will be refunded.',
  'Where we are unable to complete the agreed services, we will discuss an appropriate remedy, including a refund where applicable.',
  'Nothing in these terms limits your rights under the New Zealand Consumer Guarantees Act 1993 or other applicable consumer protection legislation.',
  'Google Business Profile verification, approval and processing times are controlled by Google and cannot be guaranteed.',
] as const;

export const GBP_SCOPE = {
  G01: {
    description: 'One-off setup or claim of one eligible Google Business Profile with customer authorization.',
    inclusions: [
      'Eligibility and duplicate-profile check, then creation or claim of one profile with your authorization.',
      'Entry or correction of your supplied name, primary category, contact details, website link where available, business description, hours and applicable address or service-area details.',
      'Addition or correction of the agreed genuine service entries, where the profile’s available fields permit them.',
      'Guidance through the verification method Google offers, including one assistance session.',
      'One review and correction round, then a handover record of submitted details and any pending Google steps.',
    ],
    exclusions: 'This option excludes website creation, SEO campaigns, ads, ongoing management, review generation, photos, multiple locations, appeals or reinstatement, duplicate merges and ownership disputes. More than five services or unusual remediation needs a separate written scope. No ranking, traffic or lead outcome is promised.',
  },
  G02: {
    description: 'One-off review and update of one existing verified Google Business Profile controlled by the customer.',
    inclusions: [
      'One review of the live profile against business details you confirm, with a prioritized change list.',
      'Approved corrections to applicable description, hours, contact details, website link, category and address or service-area settings.',
      'Addition, correction or organization of the agreed genuine service entries, where the profile’s available fields permit them.',
      'One review and correction round, followed by a record of changes submitted and any items awaiting Google review.',
    ],
    exclusions: 'This option excludes website work, SEO campaigns, ads, ongoing monitoring, review generation or replies, photos, multiple locations, appeals or reinstatement, duplicate merges and ownership disputes. More than five services or unusual remediation needs a separate written scope. No ranking, traffic or lead outcome is promised.',
  },
} as const;

export interface GbpQualification {
  scenarioCode: GbpScenarioCode;
  serviceCount: number;
  customerConfirmed: boolean;
  profileStatus: 'none_or_unclaimed' | 'verified_controlled';
  humanReviewed: boolean;
  evidenceUrl?: string;
  observedAt?: string;
  searchQuery?: string;
  searchLocation?: string;
  candidateReview?: string;
  searchAttempted?: boolean;
  searchResult?: 'no_match' | 'unclaimed_match' | 'matching_profile';
  observation?: string;
}

export interface GbpCommercialSnapshot {
  scenarioCode: GbpScenarioCode;
  template: string;
  productId: string;
  planId: string;
  priceVersionId: string;
  amountMinor: number;
  currency: 'NZD';
  taxTreatment: 'exclusive';
  taxRate: 1500;
  cadence: 'one-off';
  serviceCount: number;
  serviceBand: GbpBand;
  scopeVersion: 'gbp-commercial-v1';
  destination: string;
  commercialLine: string;
  description: string;
  inclusions: readonly string[];
  exclusions: string;
  terms: readonly string[];
}

export function qualifyGbp(value: unknown): { ok: true; value: GbpQualification; band: GbpBand } | { ok: false; reason: string } {
  if (!value || typeof value !== 'object') return { ok: false, reason: 'qualification_required' };
  const q = value as GbpQualification;
  if (q.scenarioCode !== 'G01' && q.scenarioCode !== 'G02') return { ok: false, reason: 'unknown_gbp_scenario' };
  if (!Number.isInteger(q.serviceCount) || q.serviceCount < 1 || q.serviceCount > 5 || q.customerConfirmed !== true) return { ok: false, reason: 'customer_confirmed_service_count_required' };
  if (q.humanReviewed !== true) return { ok: false, reason: 'human_evidence_review_required' };
  if (!q.observedAt || Number.isNaN(Date.parse(q.observedAt))) return { ok: false, reason: 'observed_at_required' };
  if (q.scenarioCode === 'G01') {
    if (q.profileStatus !== 'none_or_unclaimed' || q.searchAttempted !== true || !q.searchQuery?.trim() || !q.searchLocation?.trim() || !q.candidateReview?.trim() || !['no_match', 'unclaimed_match'].includes(q.searchResult ?? '')) return { ok: false, reason: 'setup_search_and_profile_status_required' };
    if (q.searchResult === 'unclaimed_match' && !validEvidenceUrl(q.evidenceUrl)) return { ok: false, reason: 'unclaimed_profile_url_required' };
  } else if (q.profileStatus !== 'verified_controlled' || q.searchResult !== 'matching_profile' || !validEvidenceUrl(q.evidenceUrl) || !q.observation?.trim()) {
    return { ok: false, reason: 'improvement_profile_and_observation_required' };
  }
  return { ok: true, value: q, band: q.serviceCount <= 3 ? '1-3' : '4-5' };
}

function validEvidenceUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname.length > 0;
  } catch { return false; }
}

export function buildGbpSnapshot(q: GbpQualification, band: GbpBand, price: { planId: string; productId: string; priceVersionId: string; amountMinor: number; currency: string; taxTreatment: string; taxRate: number; cadence: string }): GbpCommercialSnapshot {
  const offer = GBP_OFFER_MAP[q.scenarioCode];
  if (price.planId !== offer.plans[band] || price.productId !== offer.productId || price.currency !== 'NZD' || price.taxTreatment !== 'exclusive' || price.taxRate !== 1500 || price.cadence !== 'one-off' || !Number.isSafeInteger(price.amountMinor) || price.amountMinor < 0 || !price.priceVersionId) throw new Error('billing_offer_mismatch');
  const amount = new Intl.NumberFormat('en-NZ', { style: 'currency', currency: 'NZD' }).format(price.amountMinor / 100);
  const commercialLine = `${offer.title}: NZD ${amount} + GST, one-off, ${band} services on one profile; no subscription. ${offer.destination}`;
  const scope = GBP_SCOPE[q.scenarioCode];
  return { scenarioCode: q.scenarioCode, template: offer.template, productId: offer.productId, planId: price.planId, priceVersionId: price.priceVersionId, amountMinor: price.amountMinor, currency: 'NZD', taxTreatment: 'exclusive', taxRate: 1500, cadence: 'one-off', serviceCount: q.serviceCount, serviceBand: band, scopeVersion: 'gbp-commercial-v1', destination: offer.destination, commercialLine, description: scope.description, inclusions: scope.inclusions, exclusions: scope.exclusions, terms: GBP_TERMS };
}

export function gbpFinding(q: GbpQualification): string {
  return q.scenarioCode === 'G01'
    ? 'A documented public search could not confirm a controlled verified Business Profile. Profile status was confirmed by the customer before quoting.'
    : `The public Business Profile at ${q.evidenceUrl} showed: ${q.observation?.trim().slice(0, 300)}. The customer confirmed control and verification before quoting.`;
}

export function gbpOutreach(businessName: string, q: GbpQualification, snapshot: GbpCommercialSnapshot): { subject: string; body: string } {
  const offer = GBP_OFFER_MAP[q.scenarioCode];
  const finding = q.scenarioCode === 'G01'
    ? `We reviewed the public business information we could locate for ${businessName} and could not confirm a Business Profile.`
    : `We reviewed your public Business Profile at ${q.evidenceUrl} and observed: ${q.observation?.trim().slice(0, 300)}.`;
  return {
    subject: `${offer.title} for ${businessName}`,
    body: `Kia ora,\n\n${finding}\n\n${snapshot.description}\nIncludes: ${snapshot.inclusions.join('; ')}\nExcludes: ${snapshot.exclusions}\n${snapshot.commercialLine}\nTerms: ${snapshot.terms.join('; ')}\n\nWould you like to discuss the next step?\n\nNgā mihi,\nMaximisedAI`,
  };
}
