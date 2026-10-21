import { GBP_OFFER_MAP, type GbpBand, type GbpScenarioCode } from './gbpCommercial.ts';

type BillingPrice = { planId: string; productId: string; priceVersionId: string; amountMinor: number; currency: string; taxTreatment: string; taxRate: number; cadence: string };

/** Resolve only a published, effective, sellable fixed one-off price. */
export async function resolveGbpBillingPrice(code: GbpScenarioCode, band: GbpBand, env?: { get(name: string): string | undefined }, fetcher = fetch, now = new Date()): Promise<BillingPrice> {
  const runtimeEnv = env ?? (globalThis as typeof globalThis & { Deno?: { env: { get(name: string): string | undefined } } }).Deno?.env;
  const existingBase = runtimeEnv?.get('BILLING_API_BASE_URL')?.trim().replace(/\/+$/, '');
  const apiKey = runtimeEnv?.get('BILLING_CATALOGUE_API_KEY')?.trim();
  const previewBase = runtimeEnv?.get('BILLING_CATALOGUE_API_BASE_URL')?.trim().replace(/\/+$/, '');
  const bearer = runtimeEnv?.get('BILLING_CATALOGUE_BEARER_TOKEN')?.trim();
  const base = existingBase
    ? existingBase.endsWith('/api/v1') ? existingBase : `${existingBase}/api/v1`
    : previewBase;
  const key = apiKey || bearer;
  const scheme = apiKey ? 'ApiKey' : 'Bearer';
  if (!base || !key) throw new Error('billing_catalogue_unconfigured');
  const billingUrl = new URL(base);
  if (billingUrl.protocol !== 'https:' || billingUrl.username || billingUrl.password || billingUrl.search || billingUrl.hash) throw new Error('billing_catalogue_unconfigured');
  const offer = GBP_OFFER_MAP[code];
  const planId = offer.plans[band];
  const get = async (path: string) => {
    const response = await fetcher(`${base}${path}`, { headers: { Accept: 'application/json', Authorization: `${scheme} ${key}` }, signal: AbortSignal.timeout(5000), redirect: 'error' });
    if (!response.ok) throw new Error('billing_offer_unavailable');
    const body = await response.json();
    if (!body || typeof body !== 'object' || !body.data) throw new Error('billing_response_invalid');
    return body.data;
  };
  const plan = await get(`/catalogue/plans/${encodeURIComponent(planId)}`);
  if (plan.planId !== planId || plan.productId !== offer.productId || plan.billingType !== 'one-off' || plan.isSellable !== true || plan.isArchived === true) throw new Error('billing_plan_not_sellable');
  const product = await get(`/catalogue/products/${encodeURIComponent(offer.productId)}`);
  if (product.productId !== offer.productId || product.lifecycleStatus !== 'published' || product.isArchived === true) throw new Error('billing_product_not_published');
  const prices = await get(`/catalogue/plans/${encodeURIComponent(planId)}/prices/current`);
  const current = prices.current;
  const from = Date.parse(String(current?.effectiveFrom ?? ''));
  const to = current?.effectiveTo == null ? Infinity : Date.parse(String(current.effectiveTo));
  if (prices.planId !== planId || current?.planId !== planId || current?.status !== 'published' || !Number.isFinite(from) || from > now.getTime() || !(to > now.getTime()) || current.price?.kind !== 'fixed') throw new Error('billing_price_not_published');
  const p = current.price;
  if (!Number.isSafeInteger(p.amountMinor) || p.amountMinor < 0 || p.currency !== 'NZD' || p.taxTreatment !== 'exclusive' || p.taxRate !== 1500 || !current.planVersionId) throw new Error('billing_price_invalid');
  return { planId, productId: offer.productId, priceVersionId: current.planVersionId, amountMinor: p.amountMinor, currency: p.currency, taxTreatment: p.taxTreatment, taxRate: p.taxRate, cadence: 'one-off' };
}
