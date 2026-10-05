// ══════════════════════════════════════════════════════════════════════════════
// MARKET DATA LAYER — eBay, THE INTERNATIONAL USED-MARKET PROVIDER (boundary)
//
// WHAT THE PUBLICLY DOCUMENTED API GIVES, AND WHAT IT DOES NOT
//
//   Browse API `item_summary/search`     ACTIVE listings by keyword: price and
//                                         currency, condition, item location,
//                                         shipping options, buying options
//                                         (auction / fixed price), item id and
//                                         web URL. Application token (client
//                                         credentials). Marketplaces: EBAY_US,
//                                         EBAY_GB, EBAY_DE … — NOT EBAY_IL.
//   Marketplace Insights `item_sales`     SOLD prices, 90 days. LIMITED RELEASE:
//                                         approval by eBay required. NOT
//                                         implemented here; `capabilities`
//                                         says so, and no code pretends.
//
// Every observation this provider yields is INTERNATIONAL: tier B at best,
// never a local comparable, whatever currency the listing shows (the shekel
// figures on il.ebay.com are eBay's own conversion). Converting a price is the
// FX module's job and arrives as a proof beside the original.
//
// No call is made unless SCAN_ENGINE_V2_EBAY_ENABLED is exactly 'true' AND
// both credentials are set. Credentials never leave the server and never enter
// a report. The two endpoints are the only hosts this file names.
// ══════════════════════════════════════════════════════════════════════════════
import { defineProvider, PROVIDER_CLASS, PROVIDER_STATUS, ERROR_CLASS } from './provider.js';
import { normalizeObservation, PRICE_TYPE, LISTING_STATUS, SALE_TYPE } from './observation.js';
import { IDENTITY_LEVEL } from '../sufficiency.js';
import { SOURCE_TYPE, LOCALE } from '../source-type.js';

export const EBAY_ENV = Object.freeze({
  ENABLED: 'SCAN_ENGINE_V2_EBAY_ENABLED', CLIENT_ID: 'SCAN_ENGINE_V2_EBAY_CLIENT_ID',
  CLIENT_SECRET: 'SCAN_ENGINE_V2_EBAY_CLIENT_SECRET', MARKETPLACES: 'SCAN_ENGINE_V2_EBAY_MARKETPLACES',
});
export const EBAY_CAPABILITIES = Object.freeze({
  active_listings: 'browse_api:item_summary/search',
  sold_prices: 'marketplace_insights:item_sales — LIMITED RELEASE, eBay approval required; not implemented',
  marketplaces_supported: Object.freeze(['EBAY_US', 'EBAY_GB', 'EBAY_DE', 'EBAY_FR', 'EBAY_IT', 'EBAY_ES', 'EBAY_CA', 'EBAY_AU']),
  marketplace_israel: 'EBAY_IL exists as an id; Browse API does not support it',
});
const EBAY_BROWSE_URL = 'https://api.ebay.com/buy/browse/v1/item_summary/search';
// The token endpoint and the scope it is asked for, on one line: one call site for the ledger scan.
const EBAY_TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token', BROWSE_SCOPE = 'https://api.ebay.com/oauth/api_scope';
export const EBAY_TIMEOUT_MS = 3000;
export const EBAY_MAX_RESULTS = 20;
const DEFAULT_MARKETPLACE = 'EBAY_US';
const COUNTRY_OF = Object.freeze({ EBAY_US: 'US', EBAY_GB: 'GB', EBAY_DE: 'DE', EBAY_FR: 'FR', EBAY_IT: 'IT', EBAY_ES: 'ES', EBAY_CA: 'CA', EBAY_AU: 'AU' });

/** Is the provider switched on, with both credentials present? Reads env only. */
export function ebayConfig(env = process.env) {
  const enabled = String(env?.[EBAY_ENV.ENABLED] ?? '').trim().toLowerCase() === 'true';
  const clientId = env?.[EBAY_ENV.CLIENT_ID] ?? null;
  const clientSecret = env?.[EBAY_ENV.CLIENT_SECRET] ?? null;
  const marketplaces = String(env?.[EBAY_ENV.MARKETPLACES] ?? DEFAULT_MARKETPLACE).split(',').map((s) => s.trim().toUpperCase())
    .filter((m) => EBAY_CAPABILITIES.marketplaces_supported.includes(m));
  return { enabled: enabled && !!clientId && !!clientSecret, clientId, clientSecret, marketplaces: marketplaces.length ? marketplaces : [DEFAULT_MARKETPLACE] };
}

/** The search text: brand + the strongest number known, else the read name. */
export function ebayQueryFor(identity, { exactRoots = [] } = {}) {
  const brand = identity?.brand?.value ?? '';
  const number = identity?.model_number?.value ?? exactRoots[0] ?? identity?.market_hypotheses?.model_numbers?.[0] ?? null;
  const name = number ?? identity?.model?.value ?? '';
  return `${brand} ${name}`.replace(/\s+/g, ' ').trim();
}

/** An application token, cached until shortly before it expires. */
async function ebayAppToken({ clientId, clientSecret, fetchImpl, now, cache, signal }) {
  if (cache.token && cache.expires_at - now() > 60_000) return cache.token;
  const res = await fetchImpl(EBAY_TOKEN_URL, {
    method: 'POST', signal,
    headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}` },
    body: `grant_type=client_credentials&scope=${encodeURIComponent(BROWSE_SCOPE)}`,
  });
  if (!res.ok) throw new Error(`[ebay] token HTTP ${res.status}`);
  const json = await res.json();
  if (!json?.access_token) throw new Error('[ebay] token response carried no access_token');
  cache.token = json.access_token;
  cache.expires_at = now() + (Number(json.expires_in) || 7200) * 1000;
  return cache.token;
}

/** One Browse search on one marketplace. */
async function ebayBrowseSearch({ query, marketplace, token, fetchImpl, signal }) {
  const qs = `q=${encodeURIComponent(query)}&limit=${EBAY_MAX_RESULTS}&filter=${encodeURIComponent('conditions:{USED}')}`;
  const res = await fetchImpl(`${EBAY_BROWSE_URL}?${qs}`, {
    method: 'GET', signal,
    headers: { authorization: `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': marketplace, accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`[ebay] browse HTTP ${res.status}`);
  return res.json();
}

/** A non-reversible, short reference for a seller handle: never the handle itself. */
function sellerRef(username) {
  const s = String(username ?? '');
  if (!s) return null;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `ebay:${h.toString(16)}`;
}

/** Browse API item summaries → observations. Pure. */
export function normalizeEbayItems(raw, { marketplace = DEFAULT_MARKETPLACE, now = Date.now(), request_id = null } = {}) {
  const items = Array.isArray(raw?.itemSummaries) ? raw.itemSummaries : [];
  return items.map((it) => {
    const options = Array.isArray(it?.buyingOptions) ? it.buyingOptions : [];
    const ship = it?.shippingOptions?.[0]?.shippingCost;
    return normalizeObservation({
      provider: 'ebay_browse', profile: marketplace, request_id, provider_result_id: it?.itemId ?? null,
      url: it?.itemWebUrl ?? null, origin_domain: 'ebay.com',
      source_type: SOURCE_TYPE.INTERNATIONAL_USED_MARKETPLACE, locale: LOCALE.INTERNATIONAL,
      market: COUNTRY_OF[marketplace] ?? null, country: it?.itemLocation?.country ?? null,
      title: it?.title ?? null, listing_id: it?.itemId ?? null, seller_ref: sellerRef(it?.seller?.username),
      condition: it?.condition ?? null,
      listing_status: LISTING_STATUS.ACTIVE,
      sale_type: options.includes('AUCTION') ? SALE_TYPE.AUCTION : (options.includes('FIXED_PRICE') ? SALE_TYPE.FIXED_PRICE : SALE_TYPE.UNKNOWN),
      price: Number(it?.price?.value), currency: it?.price?.currency ?? null, currency_basis: 'api',
      shipping: ship ? { amount: Number(ship.value), currency: ship.currency ?? null } : null,
      price_type: PRICE_TYPE.ASKING,
      listed_at: it?.itemCreationDate ?? null, observed_at: now, retrieved_at: now,
      extraction_confidence: 'high',
      raw_ref: it?.itemId ? `ebay:${it.itemId}` : null,
    });
  });
}

/** The provider. `config` defaults to the environment; tests hand in their own. */
export function createEbayProvider({ config = ebayConfig(), fetchImpl = fetch, now = Date.now } = {}) {
  const tokenCache = { token: null, expires_at: 0 };
  return defineProvider({
    id: 'ebay_browse',
    kind: 'listings',
    classes: [PROVIDER_CLASS.INTERNATIONAL_USED],
    capabilities: EBAY_CAPABILITIES,
    profile: { cost_per_call_usd: 0, typical_ms: 700, max_results: EBAY_MAX_RESULTS, timeout_ms: EBAY_TIMEOUT_MS },
    supports(identity, market, evidenceClass) {
      if (evidenceClass && evidenceClass !== PROVIDER_CLASS.INTERNATIONAL_USED) return false;
      return !!identity?.brand?.value && !!identity?.model?.value;
    },
    async search(identity, ctx = {}) {
      if (ctx.level && ctx.level !== IDENTITY_LEVEL.PRODUCT) return { status: PROVIDER_STATUS.SKIPPED };
      if (!config.enabled) return { status: PROVIDER_STATUS.NOT_CONFIGURED, error: 'ebay provider is off or has no credentials' };
      const query = ebayQueryFor(identity, { exactRoots: ctx.exactRoots ?? [] });
      const marketplace = config.marketplaces[0];
      const f = ctx.fetchImpl ?? fetchImpl;
      try {
        const token = await ebayAppToken({ clientId: config.clientId, clientSecret: config.clientSecret, fetchImpl: f, now, cache: tokenCache, signal: ctx.signal });
        const raw = await ebayBrowseSearch({ query, marketplace, token, fetchImpl: f, signal: ctx.signal });
        ctx.onFirstResult?.();
        return { status: PROVIDER_STATUS.COMPLETED, raw: { marketplace, query, response: raw }, result_count: Array.isArray(raw?.itemSummaries) ? raw.itemSummaries.length : 0, billed: false, cost_usd: 0, request_id: `ebay-${now()}` };
      } catch (err) {
        return { status: PROVIDER_STATUS.FAILED, error: String(err?.message ?? err).replace(/Bearer [^ ]+/g, 'Bearer [redacted]').slice(0, 160), error_class: /HTTP 4(01|03)/.test(String(err?.message)) ? ERROR_CLASS.AUTH : ERROR_CLASS.HTTP };
      }
    },
    normalize(raw, ctx = {}) {
      return normalizeEbayItems(raw?.response, { marketplace: raw?.marketplace ?? config.marketplaces[0], now: typeof ctx.now === 'function' ? ctx.now() : Date.now(), request_id: raw?.request_id ?? null });
    },
  });
}
