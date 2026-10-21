import { describe, expect, it } from 'vitest';
import { GBP_OFFER_MAP, GBP_TERMS, buildGbpSnapshot, gbpFinding, gbpOutreach, qualifyGbp, type GbpQualification } from '../../supabase/functions/_shared/gbpCommercial';
import { resolveGbpBillingPrice } from '../../supabase/functions/_shared/gbpBilling';

const setup: GbpQualification = { scenarioCode: 'G01', serviceCount: 3, customerConfirmed: true, profileStatus: 'none_or_unclaimed', humanReviewed: true, observedAt: '2026-10-22T00:00:00Z', searchQuery: 'Example Auckland', searchLocation: 'Auckland', candidateReview: 'Checked trading name and location variants.', searchAttempted: true, searchResult: 'no_match' };
const improvement: GbpQualification = { scenarioCode: 'G02', serviceCount: 4, customerConfirmed: true, profileStatus: 'verified_controlled', humanReviewed: true, observedAt: '2026-10-22T00:00:00Z', evidenceUrl: 'https://maps.google.com/example', searchResult: 'matching_profile', observation: 'The published hours differ from the customer-confirmed hours.' };

describe('GBP commercial qualification', () => {
  it('requires customer-confirmed count, evidence and separate profile findings', () => {
    expect(qualifyGbp(setup)).toMatchObject({ ok: true, band: '1-3' });
    expect(qualifyGbp(improvement)).toMatchObject({ ok: true, band: '4-5' });
    expect(qualifyGbp({ ...setup, serviceCount: 0 }).ok).toBe(false);
    expect(qualifyGbp({ ...setup, serviceCount: 6 }).ok).toBe(false);
    expect(qualifyGbp({ ...setup, customerConfirmed: false }).ok).toBe(false);
    expect(qualifyGbp({ ...setup, searchAttempted: false }).ok).toBe(false);
    expect(qualifyGbp({ ...setup, searchLocation: '' }).ok).toBe(false);
    expect(qualifyGbp({ ...setup, candidateReview: '' }).ok).toBe(false);
    expect(qualifyGbp({ ...improvement, evidenceUrl: undefined }).ok).toBe(false);
    expect(qualifyGbp({ ...improvement, observation: '' }).ok).toBe(false);
    expect(gbpFinding(setup)).toContain('could not confirm');
    expect(gbpFinding(improvement)).toContain('published hours');
  });

  it('locks each tier to its own Billing plan, template and page', () => {
    for (const [code, q, band, amount] of [
      ['G01', setup, '1-3', 24900],
      ['G01', { ...setup, serviceCount: 4 }, '4-5', 34900],
      ['G02', { ...improvement, serviceCount: 3 }, '1-3', 19900],
      ['G02', improvement, '4-5', 29900],
    ] as const) {
      const offer = GBP_OFFER_MAP[code];
      const snapshot = buildGbpSnapshot(q, band, { planId: offer.plans[band], productId: offer.productId, priceVersionId: 'pv-1', amountMinor: amount, currency: 'NZD', taxTreatment: 'exclusive', taxRate: 1500, cadence: 'one-off' });
      const email = gbpOutreach('Example Ltd', q, snapshot);
      expect(snapshot.template).toBe(offer.template);
      expect(snapshot.destination).toBe(offer.destination);
      expect(email.body).toContain(snapshot.commercialLine);
      expect(email.body).toContain(snapshot.exclusions);
      for (const term of GBP_TERMS) expect(email.body).toContain(term);
      for (const inclusion of snapshot.inclusions) expect(email.body).toContain(inclusion);
      expect(email.body).not.toMatch(/guaranteed rankings|recurring SEO reporting/i);
      expect(snapshot.commercialLine).toContain('no subscription');
      expect(snapshot.commercialLine).toContain(`NZD $${(amount / 100).toFixed(2)} + GST`);
      expect(() => buildGbpSnapshot(q, band, { planId: GBP_OFFER_MAP[code === 'G01' ? 'G02' : 'G01'].plans[band], productId: offer.productId, priceVersionId: 'pv-1', amountMinor: amount, currency: 'NZD', taxTreatment: 'exclusive', taxRate: 1500, cadence: 'one-off' })).toThrow('billing_offer_mismatch');
    }
  });
});

describe('GBP Billing fail-closed lookup', () => {
  const env = { get: (key: string) => key === 'BILLING_API_BASE_URL' ? 'https://billing.example.test' : key === 'BILLING_CATALOGUE_API_KEY' ? 'local-key' : undefined };
  const fetcher = async (url: string, init?: RequestInit) => {
    expect(new Headers(init?.headers).get('authorization')).toBe('ApiKey local-key');
    const planId = GBP_OFFER_MAP.G01.plans['1-3'];
    const data = url.endsWith(`/plans/${planId}`) ? { planId, productId: GBP_OFFER_MAP.G01.productId, billingType: 'one-off', isSellable: true }
      : url.endsWith(`/products/${GBP_OFFER_MAP.G01.productId}`) ? { productId: GBP_OFFER_MAP.G01.productId, lifecycleStatus: 'published' }
      : { planId, current: { planId, planVersionId: 'pv-1', status: 'published', effectiveFrom: '2026-01-01T00:00:00Z', effectiveTo: null, price: { kind: 'fixed', amountMinor: 24900, currency: 'NZD', taxTreatment: 'exclusive', taxRate: 1500 } } };
    return { ok: true, json: async () => ({ data }) } as Response;
  };
  it('resolves the exact current fixed price', async () => {
    await expect(resolveGbpBillingPrice('G01', '1-3', env, fetcher as typeof fetch, new Date('2026-10-22'))).resolves.toMatchObject({ amountMinor: 24900, priceVersionId: 'pv-1' });
  });
  it('rejects unpublished or withdrawn catalogue states', async () => {
    const draftPrice = async (url: string, init?: RequestInit) => {
      const response = await fetcher(url, init);
      const body = await response.json();
      if (url.endsWith('/prices/current')) body.data.current.status = 'draft';
      return { ok: true, json: async () => body } as Response;
    };
    await expect(resolveGbpBillingPrice('G01', '1-3', env, draftPrice as typeof fetch, new Date('2026-10-22'))).rejects.toThrow('billing_price_not_published');
    const withdrawn = async (url: string, init?: RequestInit) => {
      const response = await fetcher(url, init);
      const body = await response.json();
      if (url.endsWith(`/plans/${GBP_OFFER_MAP.G01.plans['1-3']}`)) body.data.isSellable = false;
      return { ok: true, json: async () => body } as Response;
    };
    await expect(resolveGbpBillingPrice('G01', '1-3', env, withdrawn as typeof fetch, new Date('2026-10-22'))).rejects.toThrow('billing_plan_not_sellable');
  });
});
