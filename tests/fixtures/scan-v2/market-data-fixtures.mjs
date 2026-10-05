// ══════════════════════════════════════════════════════════════════════════════
// MARKET DATA LAYER — FIXTURES
//
// Provider responses in the shapes the real ones have, every value invented,
// and fake providers whose timing and failure the tests control. No test that
// imports this file makes a network call.
// ══════════════════════════════════════════════════════════════════════════════
import { defineProvider, PROVIDER_CLASS, PROVIDER_STATUS } from '../../../api/_lib/v2/market/provider.js';
import { normalizeObservation, PRICE_TYPE, LISTING_STATUS, SALE_TYPE } from '../../../api/_lib/v2/market/observation.js';
import { extractSearchProvenance } from '../../../api/_lib/phaseb/search-provenance.js';
import { SEARCH_OUTCOME } from '../../../api/_lib/v2/search.js';

export const NOW = Date.parse('2026-10-05T10:00:00.000Z');
const day = 24 * 3600 * 1000;

/** The Bank of Israel's JSON, as it is published: shekels per `unit` of each currency. */
export const BOI_RAW = {
  exchangeRates: [
    { key: 'USD', currentExchangeRate: 3.7, currentChange: 0.1, unit: 1, lastUpdate: '2026-10-05T00:00:00Z' },
    { key: 'GBP', currentExchangeRate: 4.8, currentChange: -0.2, unit: 1, lastUpdate: '2026-10-05T00:00:00Z' },
    { key: 'JPY', currentExchangeRate: 2.5, currentChange: 0, unit: 100, lastUpdate: '2026-10-05T00:00:00Z' },
    { key: 'XX', currentExchangeRate: 0, unit: 1 },
  ],
};
export const BOI_STALE = { exchangeRates: [{ key: 'USD', currentExchangeRate: 3.7, unit: 1, lastUpdate: '2026-09-20T00:00:00Z' }] };

/** eBay Browse `item_summary/search`: three used items for one product line. */
export const EBAY_RAW = {
  total: 3,
  itemSummaries: [
    { itemId: 'v1|110000000001|0', title: 'Ninja TB301 Detect Duo Power Blender Pro - complete set, lightly used', condition: 'Used', conditionId: '3000',
      price: { value: '45.00', currency: 'USD' }, buyingOptions: ['FIXED_PRICE'], itemWebUrl: 'https://www.ebay.com/itm/110000000001?hash=abc',
      itemLocation: { country: 'US', postalCode: '902**' }, seller: { username: 'seller-one' }, shippingOptions: [{ shippingCost: { value: '12.00', currency: 'USD' } }],
      itemCreationDate: '2026-09-28T12:00:00.000Z' },
    { itemId: 'v1|110000000002|0', title: 'Ninja Detect Power Blender Duo Pro TB301 - BASE ONLY', condition: 'Used', conditionId: '3000',
      price: { value: '30.00', currency: 'USD' }, buyingOptions: ['FIXED_PRICE', 'BEST_OFFER'], itemWebUrl: 'https://www.ebay.com/itm/110000000002',
      itemLocation: { country: 'US' }, seller: { username: 'seller-two' } },
    { itemId: 'v1|110000000003|0', title: 'Ninja Detect TB303 blender used', condition: 'Used', conditionId: '3000',
      price: { value: '40.00', currency: 'USD' }, buyingOptions: ['AUCTION'], itemWebUrl: 'https://www.ebay.com/itm/110000000003',
      itemLocation: { country: 'GB' }, seller: { username: 'seller-three' } },
  ],
};

export const provenanceOf = (results, { queries = ['q'] } = {}) => extractSearchProvenance([{
  type: 'web_search_call', status: 'completed',
  action: { type: 'search', queries, query: queries[0], sources: results.map((r) => ({ type: 'url', url: r.url })) },
  results,
}]);

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) { reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); return; }
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); }, { once: true });
});

/**
 * A fake DISCOVERY provider: returns `results` (search-result shapes) after
 * `delayMs`, as today's search provider would record them. `fail` throws;
 * `hang` never resolves until aborted.
 */
export function fakeDiscovery({ id = 'fake_search', profile = 'local', results = [], delayMs = 0, fail = false, hang = false, classes = null, billed = true, ignoreSignal = false } = {}) {
  return defineProvider({
    id, kind: 'discovery', profile_name: profile,
    classes: classes ?? [PROVIDER_CLASS.SEARCH_DISCOVERY, PROVIDER_CLASS.LOCAL_USED, PROVIDER_CLASS.LOCAL_RETAIL],
    profile: { cost_per_call_usd: 0.01, typical_ms: delayMs, timeout_ms: 4500 },
    supports: () => true,
    async search(identity, ctx) {
      // A provider that ignores its abort signal: it answers late, as if nothing happened.
      const signal = ignoreSignal ? null : ctx.signal;
      if (hang) await sleep(60_000, signal);
      else if (delayMs) await sleep(delayMs, signal);
      if (fail) throw new Error(`[${id}] API 500: synthetic failure`);
      const provenance = provenanceOf(results, { queries: ctx.plan?.queries?.map((q) => q.text) ?? ['q'] });
      if (results.length) ctx.onFirstResult?.();
      return {
        status: PROVIDER_STATUS.COMPLETED, result_count: results.length, billed, cost_usd: billed ? 0.01 : 0,
        raw: { plan: ctx.plan, search: { outcome: SEARCH_OUTCOME.COMPLETED, provenance, timings: { first_event_ms: delayMs, results_available_ms: delayMs, total_ms: delayMs }, usage: null, failure: null, stopped_early: true, billed } },
        request_id: `${id}-${profile}-r1`,
      };
    },
    normalize: () => [],
  });
}

/** A fake LISTINGS provider (an eBay-shaped source) returning ready observations after `delayMs`. */
export function fakeListings({ id = 'fake_listings', observations = [], delayMs = 0, fail = false, hang = false, classes = [PROVIDER_CLASS.INTERNATIONAL_USED] } = {}) {
  return defineProvider({
    id, kind: 'listings', classes,
    profile: { cost_per_call_usd: 0, typical_ms: delayMs, timeout_ms: 4500 },
    supports: () => true,
    async search(identity, ctx) {
      if (hang) await sleep(60_000, ctx.signal);
      else if (delayMs) await sleep(delayMs, ctx.signal);
      if (fail) throw new Error(`[${id}] network error: synthetic`);
      if (observations.length) ctx.onFirstResult?.();
      return { status: PROVIDER_STATUS.COMPLETED, result_count: observations.length, billed: false, raw: { items: observations }, request_id: `${id}-r1` };
    },
    normalize: (raw) => (raw?.items ?? []).map((o) => normalizeObservation({ provider: id, now: NOW, observed_at: NOW, ...o })),
  });
}

/** Observations an international listings provider might yield, before resolution. */
export const ABROAD_OBSERVATIONS = [
  { url: 'https://www.ebay.com/itm/110000000001', origin_domain: 'www.ebay.com', source_type: 'INTERNATIONAL_USED_MARKETPLACE', locale: 'international', market: 'US',
    title: 'Ninja TB301 Detect Duo Power Blender Pro - complete set, lightly used', listing_id: 'v1|110000000001|0', condition: 'Used',
    listing_status: LISTING_STATUS.ACTIVE, sale_type: SALE_TYPE.FIXED_PRICE, price: 45, currency: 'USD', price_type: PRICE_TYPE.ASKING, currency_basis: 'api', seller_ref: 'ebay:a1' },
  { url: 'https://www.ebay.com/itm/110000000002', origin_domain: 'www.ebay.com', source_type: 'INTERNATIONAL_USED_MARKETPLACE', locale: 'international', market: 'US',
    title: 'Ninja Detect Power Blender Duo Pro TB301 - BASE ONLY', listing_id: 'v1|110000000002|0', condition: 'Used',
    listing_status: LISTING_STATUS.ACTIVE, sale_type: SALE_TYPE.FIXED_PRICE, price: 30, currency: 'USD', price_type: PRICE_TYPE.ASKING, currency_basis: 'api', seller_ref: 'ebay:a2' },
  { url: 'https://www.ebay.com/itm/110000000003', origin_domain: 'www.ebay.com', source_type: 'INTERNATIONAL_USED_MARKETPLACE', locale: 'international', market: 'GB',
    title: 'Ninja Detect TB303 blender used', listing_id: 'v1|110000000003|0', condition: 'Used',
    listing_status: LISTING_STATUS.ACTIVE, sale_type: SALE_TYPE.AUCTION, price: 40, currency: 'USD', price_type: PRICE_TYPE.ASKING, currency_basis: 'api', seller_ref: 'ebay:a3' },
];

/** A fetch stub that refuses every call and counts the attempts. */
export function noNetwork() {
  const calls = [];
  const fetchImpl = async (url) => { calls.push(String(url)); throw new Error(`network call attempted: ${String(url).slice(0, 60)}`); };
  return { fetchImpl, calls };
}

/** A fetch stub that answers from a table of URL prefixes, recording every request. */
export function fakeFetch(routes) {
  const requests = [];
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    requests.push({ url: u, init });
    const route = routes.find((r) => u.startsWith(r.prefix));
    if (!route) throw new Error(`no route for ${u.slice(0, 60)}`);
    const body = typeof route.body === 'function' ? route.body(u, init) : route.body;
    return { ok: (route.status ?? 200) < 400, status: route.status ?? 200, json: async () => body, text: async () => JSON.stringify(body) };
  };
  return { fetchImpl, requests };
}

export { NOW as FIXED_NOW, day as DAY };
