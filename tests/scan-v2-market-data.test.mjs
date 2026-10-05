// ══════════════════════════════════════════════════════════════════════════════
// MARKET DATA LAYER — THE OBSERVATION, DEDUPE, INDEPENDENCE, FX, CACHE, PROVIDERS
//
//   node --test tests/scan-v2-market-data.test.mjs
// ══════════════════════════════════════════════════════════════════════════════
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeObservation, observationFromEntry, relationKindOf, freshnessOf, listingKeyOf,
  RELATION_KIND, CONFIGURATION_KIND, PRICE_TYPE, LISTING_STATUS, SALE_TYPE, FRESHNESS, QUALIFICATION,
} from '../api/_lib/v2/market/observation.js';
import { dedupeObservations, dedupeKeyOf, sourceIndependence } from '../api/_lib/v2/market/dedupe.js';
import { parseBoiRates, convertToIls, withConversion, createFxSource, FX_REFUSAL, FX_SOURCE, FX_MAX_AGE_MS } from '../api/_lib/v2/market/fx.js';
import { createMarketEvidenceCache, cacheKeyFor, memoryStore, CACHE_TTL_MS } from '../api/_lib/v2/market/cache.js';
import { createEbayProvider, ebayConfig, ebayQueryFor, normalizeEbayItems, EBAY_CAPABILITIES, EBAY_ENV } from '../api/_lib/v2/market/ebay-provider.js';
import { createSearchProvider } from '../api/_lib/v2/market/search-provider.js';
import { defineProvider, runProvider, PROVIDER_STATUS, PROVIDER_CLASS, ERROR_CLASS, classifyProviderError } from '../api/_lib/v2/market/provider.js';
import { resolveSearchProfiles, SEARCH_PROFILE, LOCAL_USED_HOSTS } from '../api/_lib/v2/config.js';
import { qualifyMarketEvidence } from '../api/_lib/market-evidence.js';
import { RELATION } from '../api/_lib/v2/market-identity.js';
import { CONFIGURATION } from '../api/_lib/v2/configuration.js';
import { normalizeIdentity } from '../api/_lib/v2/identity.js';
import { IDENTITY_LEVEL } from '../api/_lib/v2/sufficiency.js';
import { resolveMarketRegion } from '../api/_lib/phaseb/config.js';
import { MATRIX } from './fixtures/scan-v2/market-matrix.mjs';
import * as M from './fixtures/scan-v2/market-fixtures.mjs';
import { BOI_RAW, BOI_STALE, EBAY_RAW, ABROAD_OBSERVATIONS, NOW, DAY, noNetwork, fakeFetch, fakeDiscovery } from './fixtures/scan-v2/market-data-fixtures.mjs';

const IL = resolveMarketRegion();
const used = (over = {}) => normalizeObservation({
  provider: 'p1', profile: 'local', url: 'https://www.boardone.co.il/ad/1001', origin_domain: 'www.boardone.co.il', locale: 'local', market: 'IL',
  title: 'Sony PlayStation 5 למכירה 1,800 ש"ח', relation: RELATION.EXACT, configuration: CONFIGURATION.UNKNOWN,
  price: 1800, currency: 'ILS', price_type: PRICE_TYPE.ASKING, listing_status: LISTING_STATUS.ACTIVE, sale_type: SALE_TYPE.CLASSIFIED,
  observed_at: NOW, now: NOW, qualification_state: QUALIFICATION.ADMITTED, ...over,
});

// ── THE OBSERVATION ─────────────────────────────────────────────────────────
describe('MD-1 one shape for every price', () => {
  test('MD-1a total: nothing in, a well-formed observation with null fields out; never a default that looks like data', () => {
    const o = normalizeObservation();
    assert.equal(o.price, null); assert.equal(o.currency, null); assert.equal(o.listing_key, null);
    assert.deepEqual([o.relation, o.configuration, o.price_type, o.listing_status, o.sale_type, o.freshness, o.qualification_state],
      [RELATION_KIND.UNKNOWN, CONFIGURATION_KIND.UNKNOWN, PRICE_TYPE.UNKNOWN, LISTING_STATUS.UNKNOWN, SALE_TYPE.UNKNOWN, FRESHNESS.UNKNOWN, QUALIFICATION.PENDING]);
    assert.deepEqual(normalizeObservation(null).retrievals, []);
  });
  test('MD-1b relations and configurations map from the engine’s own, and a part or accessory of the exact product is not an exact comparable', () => {
    assert.equal(relationKindOf(RELATION.EXACT, CONFIGURATION.UNKNOWN), RELATION_KIND.EXACT_PRODUCT);
    assert.equal(relationKindOf(RELATION.EXACT, CONFIGURATION.ACCESSORY_ONLY), RELATION_KIND.ACCESSORY);
    assert.equal(relationKindOf(RELATION.EXACT, CONFIGURATION.REPLACEMENT_PART), RELATION_KIND.PART);
    assert.equal(relationKindOf(RELATION.REGIONAL_VARIANT, CONFIGURATION.BUNDLE), RELATION_KIND.BUNDLE);
    assert.equal(relationKindOf(RELATION.SIBLING, CONFIGURATION.COMPLETE), RELATION_KIND.SIBLING_MODEL);
    assert.equal(relationKindOf(RELATION.OTHER_PRODUCT, CONFIGURATION.COMPLETE), RELATION_KIND.OTHER_PRODUCT);
    assert.equal(relationKindOf('UNKNOWN', CONFIGURATION.COMPLETE), RELATION_KIND.UNKNOWN);
    assert.equal(normalizeObservation({ configuration: CONFIGURATION.REPLACEMENT_PART }).configuration, CONFIGURATION_KIND.PART);
    assert.equal(normalizeObservation({ configuration: CONFIGURATION.COMPLETE }).configuration, CONFIGURATION_KIND.COMPLETE_PRODUCT);
  });
  test('MD-1c the listing key is the origin’s id first, the canonical URL second, namespaced by the ORIGIN SITE and never by the provider', () => {
    assert.equal(listingKeyOf({ origin_site: 'yad2.co.il', listing_id: '9050168655932', canonical_url: 'x' }), 'id:yad2.co.il|9050168655932');
    assert.equal(listingKeyOf({ origin_site: 'shop.co.il', listing_id: null, canonical_url: 'shop.co.il/p/1' }), 'url:shop.co.il/p/1');
    assert.equal(listingKeyOf({ origin_site: null, listing_id: null, canonical_url: null }), null);
    const a = normalizeObservation({ provider: 'p1', url: 'https://www.yad2.co.il/market/item/9050168655932?utm_source=x' });
    const b = normalizeObservation({ provider: 'p2', url: 'https://m.yad2.co.il/market/item/9050168655932' });
    assert.equal(a.listing_key, b.listing_key);
    assert.equal(a.origin_site, 'yad2.co.il');
  });
  test('MD-1d freshness is read from the observed time, and a cached row is CACHED whatever its age', () => {
    assert.equal(freshnessOf(NOW - DAY, NOW), FRESHNESS.LIVE);
    assert.equal(freshnessOf(NOW - 20 * DAY, NOW), FRESHNESS.RECENT);
    assert.equal(freshnessOf(NOW - 90 * DAY, NOW), FRESHNESS.STALE);
    assert.equal(freshnessOf(null, NOW), FRESHNESS.UNKNOWN);
    assert.equal(freshnessOf(NOW, NOW, { cached: true }), FRESHNESS.CACHED);
  });
  test('MD-1e an extraction entry becomes an observation with asking / retail told apart and provider fields left behind', () => {
    const { evidence } = MATRIX.find((m) => m.name === 'C console');
    const entries = evidence.entries.map((e) => observationFromEntry(e, { provider: 'openai_web_search', profile: 'local', market: 'IL', now: NOW }));
    assert.ok(entries.length >= 3);
    for (const o of entries) {
      assert.deepEqual([o.price_type, o.sale_type, o.listing_status, o.qualification_state], [PRICE_TYPE.ASKING, SALE_TYPE.CLASSIFIED, LISTING_STATUS.ACTIVE, QUALIFICATION.ADMITTED]);
      assert.equal(o.locale, 'local'); assert.equal(o.market, 'IL');
      assert.ok(!('observation' in o) && !('binding' in o) && !('role' in o), 'no extraction field leaks');
      assert.equal(o.raw_ref.startsWith('page#'), true);
    }
    const retail = observationFromEntry(MATRIX.find((m) => m.name === 'I retail only').evidence.entries[0], { provider: 'openai_web_search', now: NOW });
    assert.deepEqual([retail.price_type, retail.sale_type, retail.qualification_state], [PRICE_TYPE.RETAIL, SALE_TYPE.RETAIL, QUALIFICATION.ANCHOR]);
    const inferred = observationFromEntry(MATRIX.find((m) => m.name === 'R locale rows').evidence.entries.find((e) => e.currency_basis === 'site_locale'), { provider: 'openai_web_search', now: NOW });
    assert.deepEqual([inferred.currency_basis, inferred.extraction_confidence], ['site_locale', 'low']);
  });
});

// ── DEDUPE AND INDEPENDENCE ─────────────────────────────────────────────────
describe('MD-2 one advert is one observation, however many ways it was found', () => {
  test('MD-2a the same listing id through two retrieval providers counts once, with both retrievals kept', () => {
    const a = used({ provider: 'openai_web_search', listing_id: '1001', retrievals: [{ provider: 'openai_web_search', profile: 'local' }] });
    const b = used({ provider: 'brave_search', listing_id: '1001', retrievals: [{ provider: 'brave_search', profile: null }], observed_at: NOW + 1000 });
    const r = dedupeObservations([a, b]);
    assert.equal(r.unique.length, 1);
    assert.equal(r.counts.duplicate_count, 1);
    assert.deepEqual(r.unique[0].retrievals.map((x) => x.provider), ['openai_web_search', 'brave_search']);
    assert.equal(r.unique[0].duplicates_folded, 1);
    assert.equal(r.duplicates[0].method, 'listing_id');
  });
  test('MD-2b the same canonical URL with tracking parameters and a device subdomain is one listing', () => {
    const a = used({ url: 'https://www.boardone.co.il/ad/7?utm_source=a', listing_id: null });
    const b = used({ url: 'https://m.boardone.co.il/ad/7?fbclid=zz', listing_id: null, provider: 'p2' });
    assert.equal(dedupeObservations([a, b]).unique.length, 1);
  });
  test('MD-2c two profiles of one provider are two RETRIEVALS of one observation, not two sources', () => {
    const a = used({ provider: 'openai_web_search', listing_id: '5', retrievals: [{ provider: 'openai_web_search', profile: 'local' }] });
    const b = used({ provider: 'openai_web_search', listing_id: '5', retrievals: [{ provider: 'openai_web_search', profile: 'local_used_domains' }] });
    const { unique } = dedupeObservations([a, b]);
    const ind = sourceIndependence(unique);
    assert.deepEqual([ind.qualified_observation_count, ind.distinct_provider_count, ind.distinct_retrieval_count, ind.distinct_origin_count], [1, 1, 2, 1]);
  });
  test('MD-2d the fallback is conservative: same site, title, price and configuration fold; a different title, seller or price stays two listings', () => {
    const base = { listing_id: null, url: null, origin_domain: 'www.boardone.co.il', title: 'Sony PlayStation 5 למכירה' };
    assert.equal(dedupeObservations([used(base), used({ ...base, provider: 'p2' })]).unique.length, 1);
    assert.equal(dedupeObservations([used(base), used({ ...base, title: 'Sony PlayStation 5 למכירה בחיפה' })]).unique.length, 2, 'different words');
    assert.equal(dedupeObservations([used({ ...base, seller_ref: 's1' }), used({ ...base, seller_ref: 's2' })]).unique.length, 2, 'different sellers');
    assert.equal(dedupeObservations([used(base), used({ ...base, price: 1750 })]).unique.length, 2, 'different price');
    assert.equal(dedupeObservations([used(base), used({ ...base, configuration: CONFIGURATION.BASE_ONLY })]).unique.length, 2, 'different object');
    // The same id on two different origins is two listings: the key is namespaced by the origin, never by the provider.
    assert.equal(dedupeObservations([used({ listing_id: '9', url: null }), used({ listing_id: '9', url: null, origin_domain: 'www.boardtwo.co.il' })]).unique.length, 2);
    assert.equal(dedupeKeyOf(normalizeObservation({ title: 'x' })).method, 'none');
  });
  test('MD-2e syndication across two origins is recorded on a seller or id signal, never merged, and collapses the origin count; words and price alone do not', () => {
    const a = used({ url: 'https://www.boardone.co.il/ad/1', title: 'Sony PlayStation 5 למכירה 1800', seller_ref: 'seller-77' });
    const b = used({ url: 'https://www.aggregator.co.il/x/9', origin_domain: 'www.aggregator.co.il', title: 'Sony PlayStation 5 למכירה 1800', seller_ref: 'seller-77', observed_at: NOW + 60_000 });
    const { unique, counts } = dedupeObservations([a, b]);
    assert.equal(unique.length, 2);
    assert.equal(counts.syndicated_count, 1);
    assert.equal(unique[1].syndicated_from, 'boardone.co.il');
    assert.equal(sourceIndependence(unique).distinct_origin_count, 1);
    // Two sellers, same words and price, no shared signal: two origins.
    const c = used({ url: 'https://www.boardtwo.co.il/ad/2', origin_domain: 'www.boardtwo.co.il', title: 'Sony PlayStation 5 למכירה 1800' });
    const honest = dedupeObservations([used({ url: 'https://www.boardone.co.il/ad/1', title: 'Sony PlayStation 5 למכירה 1800' }), c]);
    assert.deepEqual([honest.unique.length, honest.counts.syndicated_count, sourceIndependence(honest.unique).distinct_origin_count], [2, 0, 2]);
  });
  test('MD-2f quorum and diversity read QUALIFIED observations only, never results', () => {
    const list = [used({ listing_id: '1' }), used({ listing_id: '2', url: 'https://www.boardtwo.co.il/ad/2', origin_domain: 'www.boardtwo.co.il' }),
      used({ listing_id: '3', qualification_state: QUALIFICATION.REJECTED }), used({ listing_id: '4', qualification_state: QUALIFICATION.ANCHOR })];
    const ind = sourceIndependence(dedupeObservations(list).unique);
    assert.deepEqual([ind.qualified_observation_count, ind.distinct_origin_count], [2, 2]);
    assert.deepEqual(dedupeObservations(list, { rawResultCount: 40 }).counts, { raw_result_count: 40, normalized_count: 4, duplicate_count: 0, unique_count: 4, syndicated_count: 0 });
  });
});

// ── FX ──────────────────────────────────────────────────────────────────────
describe('MD-3 foreign money is converted only with a dated proof from the bank', () => {
  const table = parseBoiRates(BOI_RAW, NOW);
  test('MD-3a the bank’s table parses per unit, and a malformed row is dropped', () => {
    assert.equal(table.source, FX_SOURCE);
    assert.deepEqual([table.rates.USD.per_unit, table.rates.JPY.per_unit, table.rates.XX], [3.7, 0.025, undefined]);
    assert.equal(table.rate_date, '2026-10-05T00:00:00.000Z');
  });
  test('MD-3b a conversion keeps the original and carries a proof the evidence gate accepts', () => {
    const r = convertToIls({ amount: 45, currency: 'USD' }, table, { now: NOW });
    assert.ok(r.ok);
    assert.equal(r.converted_ils, 45 * 3.7);
    assert.deepEqual([r.proof.source, r.proof.base_currency, r.proof.quote_currency, r.proof.timestamp, r.proof.retrieved_at],
      [FX_SOURCE, 'USD', 'ILS', '2026-10-05T00:00:00.000Z', new Date(NOW).toISOString()]);
    const o = withConversion(normalizeObservation({ price: 45, currency: 'USD', title: 'x' }), table, { now: NOW });
    assert.deepEqual([o.price, o.currency, o.converted.ils], [45, 'USD', 166.5]);
    // The gate re-does the arithmetic and admits the listing on the proof.
    const report = qualifyMarketEvidence({
      observations: [{ source: 'https://www.ebay.com/itm/1', source_domain: 'ebay.com', listing_id_or_reference: 'ebay-1', title: 'Sony PlayStation 5 used', observed_price: 45, currency: 'USD', listing_kind: 'used_listing', fx_proof: r.proof, match: { confidence: null } }],
      subject: { brand: 'Sony', model: 'PlayStation 5', object_class: 'game console' },
    });
    assert.equal(report.admitted.length, 1);
    assert.equal(report.admitted[0].normalized_ils_price, 166.5);
  });
  test('MD-3c stale, unsupported and unavailable rates are refused by name; shekels need no proof', () => {
    assert.equal(convertToIls({ amount: 45, currency: 'USD' }, parseBoiRates(BOI_STALE, NOW), { now: NOW }).reason, FX_REFUSAL.STALE);
    assert.equal(convertToIls({ amount: 45, currency: 'USD' }, table, { now: NOW + FX_MAX_AGE_MS + 1 }).reason, FX_REFUSAL.STALE);
    assert.equal(convertToIls({ amount: 45, currency: 'THB' }, table, { now: NOW }).reason, FX_REFUSAL.UNSUPPORTED);
    assert.equal(convertToIls({ amount: 45, currency: 'USD' }, null, { now: NOW }).reason, FX_REFUSAL.UNAVAILABLE);
    assert.equal(convertToIls({ amount: -1, currency: 'USD' }, table, { now: NOW }).reason, FX_REFUSAL.BAD_AMOUNT);
    assert.deepEqual(convertToIls({ amount: 100, currency: 'ILS' }, null, { now: NOW }), { ok: true, converted_ils: 100, proof: null, identity: true });
    const refused = withConversion(normalizeObservation({ price: 45, currency: 'USD', title: 'x' }), parseBoiRates(BOI_STALE, NOW), { now: NOW });
    assert.deepEqual([refused.converted.ils, refused.converted.refused, refused.price], [null, FX_REFUSAL.STALE, 45]);
  });
  test('MD-3d the source makes no call when off, one call per TTL when on, and a failure yields no table', async () => {
    const off = noNetwork();
    const src = createFxSource({ enabled: false, fetchImpl: off.fetchImpl, now: () => NOW });
    assert.deepEqual(await src.rates(), { status: 'NOT_CONFIGURED', table: null, error: null });
    assert.equal(off.calls.length, 0);
    const ff = fakeFetch([{ prefix: 'https://www.boi.org.il/PublicApi/GetExchangeRates', body: BOI_RAW }]);
    let t = NOW;
    const on = createFxSource({ enabled: true, fetchImpl: ff.fetchImpl, now: () => t });
    assert.equal((await on.rates()).status, 'OK');
    t += 3600_000;
    assert.equal((await on.rates()).cached, true);
    assert.equal(ff.requests.length, 1, 'one fetch inside the TTL');
    const bad = createFxSource({ enabled: true, fetchImpl: fakeFetch([{ prefix: 'https://www.boi.org.il', status: 503, body: {} }]).fetchImpl, now: () => NOW });
    const r = await bad.rates();
    assert.deepEqual([r.status, r.table], ['FAILED', null]);
  });
});

// ── THE CACHE ───────────────────────────────────────────────────────────────
describe('MD-4 the market evidence cache keeps observations, their time and their provenance', () => {
  const identity = normalizeIdentity(M.NINJA);
  test('MD-4a the key is the canonical market identity: the exact number once known, else the read name', () => {
    assert.equal(cacheKeyFor({ identity, market: 'IL' }), 'v1|IL|ninja|power-blender-duo-pro');
    assert.equal(cacheKeyFor({ identity, market: 'IL', exactRoots: ['TB301'] }), 'v1|IL|ninja|tb301');
    assert.equal(cacheKeyFor({ identity: null }), null);
  });
  test('MD-4b a put is read back with each observation marked CACHED, its observed time intact, and as CONTEXT; after the TTL it is expired, not current', async () => {
    let t = NOW;
    const cache = createMarketEvidenceCache({ store: memoryStore(), now: () => t });
    const key = cache.keyFor({ identity, market: 'IL', exactRoots: ['TB301'] });
    assert.ok(await cache.put(key, [used({ observed_at: NOW - DAY })], { provenance: { run: 'r1' } }));
    t += 3600_000;
    const hit = await cache.get(key);
    assert.deepEqual([hit.hit, hit.expired, hit.observations.length], [true, false, 1]);
    assert.deepEqual([hit.observations[0].from_cache, hit.observations[0].freshness, hit.observations[0].qualification_state, hit.observations[0].observed_at],
      [true, FRESHNESS.CACHED, QUALIFICATION.CONTEXT, new Date(NOW - DAY).toISOString()]);
    t = NOW + CACHE_TTL_MS + 1;
    const old = await cache.get(key);
    assert.deepEqual([old.hit, old.expired, old.observations.length], [false, true, 1], 'what was known is visible, and is not current');
    assert.deepEqual(await cache.get(null), { hit: false, expired: false, key: null, observations: [], stored_at: null });
    assert.deepEqual(cache.stats(), { hits: 1, misses: 1, expired: 1, puts: 1 });
  });
});

// ── PROVIDERS ───────────────────────────────────────────────────────────────
describe('MD-5 the provider contract', () => {
  test('MD-5a a provider is validated on definition', () => {
    assert.throws(() => defineProvider({ id: 'x' }), /lacks classes/);
    assert.throws(() => defineProvider({ id: 'x', classes: ['nope'], supports: () => true, search: async () => ({}), normalize: () => [] }), /no valid class/);
    const p = defineProvider({ id: 'x', classes: [PROVIDER_CLASS.LOCAL_USED], supports: () => true, search: async () => ({ status: 'COMPLETED', raw: {} }), normalize: () => [] });
    assert.equal(p.profile.timeout_ms, 4500);
  });
  test('MD-5b a provider that throws, hangs, or returns garbage is a report with a status, never a rejection', async () => {
    const id = normalizeIdentity(M.NINJA);
    const throws = fakeDiscovery({ id: 'throws', fail: true });
    const r1 = await runProvider(throws, id, { market: IL, level: IDENTITY_LEVEL.PRODUCT, deadlineMs: 500 });
    assert.deepEqual([r1.status, r1.error_class], [PROVIDER_STATUS.FAILED, ERROR_CLASS.HTTP]);
    const hangs = fakeDiscovery({ id: 'hangs', hang: true });
    const t0 = Date.now();
    const r2 = await runProvider(hangs, id, { market: IL, level: IDENTITY_LEVEL.PRODUCT, deadlineMs: 150 });
    assert.equal(r2.status, PROVIDER_STATUS.TIMED_OUT);
    assert.ok(Date.now() - t0 < 1000);
    // A provider that ignores its signal and answers after the deadline is TIMED_OUT, not COMPLETED: a late answer is not an answer.
    const late = fakeDiscovery({ id: 'late', results: M.RESULTS_ONE_LISTING, delayMs: 220, ignoreSignal: true });
    const r3 = await runProvider(late, id, { market: IL, level: IDENTITY_LEVEL.PRODUCT, deadlineMs: 80 });
    assert.deepEqual([r3.status, r3.error_class], [PROVIDER_STATUS.TIMED_OUT, ERROR_CLASS.TIMEOUT]);
    assert.equal(r3.observations.length, 0);
    const garbage = defineProvider({ id: 'g', classes: [PROVIDER_CLASS.LOCAL_USED], supports: () => true, search: async () => null, normalize: () => [] });
    assert.deepEqual([(await runProvider(garbage, id, {})).status, (await runProvider(garbage, id, {})).error_class], [PROVIDER_STATUS.FAILED, ERROR_CLASS.CONTRACT]);
    const unsupported = defineProvider({ id: 'u', classes: [PROVIDER_CLASS.LOCAL_USED], supports: () => false, search: async () => ({}), normalize: () => [] });
    assert.equal((await runProvider(unsupported, id, {})).status, PROVIDER_STATUS.SKIPPED);
    assert.equal(classifyProviderError(new Error('[OpenAI] API 401: nope')), ERROR_CLASS.AUTH);
    assert.equal(classifyProviderError(new Error('fetch failed')), ERROR_CLASS.NETWORK);
  });
  test('MD-5c every report carries the timing and counting fields the order asks for', async () => {
    const r = await runProvider(fakeDiscovery({ results: M.RESULTS_ONE_LISTING, delayMs: 20 }), normalizeIdentity(M.CONSOLE), { market: IL, level: IDENTITY_LEVEL.PRODUCT, deadlineMs: 1000 });
    for (const k of ['started_at', 'first_result_at', 'completed_at', 'status', 'result_count', 'normalized_count', 'error_class', 'elapsed_ms', 'billed', 'cost_usd']) assert.ok(k in r, k);
    assert.deepEqual([r.status, r.result_count, r.billed, r.cost_usd], [PROVIDER_STATUS.COMPLETED, 1, true, 0.01]);
    assert.ok(r.first_result_at >= r.started_at && r.completed_at >= r.first_result_at);
  });
});

describe('MD-6 the search adapter: one provider, two profiles, the second off by default', () => {
  test('MD-6a the environment decides the profiles; "local" alone is the default and is always first', () => {
    assert.deepEqual(resolveSearchProfiles({}), [SEARCH_PROFILE.LOCAL]);
    assert.deepEqual(resolveSearchProfiles({ SCAN_ENGINE_V2_SEARCH_PROFILES: 'local_used_domains' }), [SEARCH_PROFILE.LOCAL, SEARCH_PROFILE.LOCAL_USED_DOMAINS]);
    assert.deepEqual(resolveSearchProfiles({ SCAN_ENGINE_V2_SEARCH_PROFILES: 'nonsense' }), [SEARCH_PROFILE.LOCAL]);
    assert.ok(Array.isArray(LOCAL_USED_HOSTS.IL) && LOCAL_USED_HOSTS.IL.length > 0);
  });
  test('MD-6b the narrowed profile sends the market’s used-marketplace hosts as the tool filter; the local profile sends none', async () => {
    const bodies = [];
    const fetchImpl = async (url, init) => { bodies.push(JSON.parse(init.body)); throw new Error('[OpenAI] network error: stop here'); };
    const identity = normalizeIdentity(M.NINJA);
    const ctx = { market: IL, level: IDENTITY_LEVEL.PRODUCT, deadlineMs: 1000 };
    const local = createSearchProvider({ profile: SEARCH_PROFILE.LOCAL, model: 'm', apiKey: 'k', fetchImpl });
    const narrowed = createSearchProvider({ profile: SEARCH_PROFILE.LOCAL_USED_DOMAINS, model: 'm', apiKey: 'k', fetchImpl });
    assert.deepEqual([local.kind, narrowed.classes], ['discovery', [PROVIDER_CLASS.SEARCH_DISCOVERY, PROVIDER_CLASS.LOCAL_USED]]);
    await runProvider(local, identity, ctx);
    await runProvider(narrowed, identity, ctx);
    assert.equal(bodies.length, 2);
    assert.equal(bodies[0].tools[0].filters, undefined);
    assert.deepEqual(bodies[1].tools[0].filters, { allowed_domains: LOCAL_USED_HOSTS.IL });
    assert.deepEqual(bodies[0].tools[0].user_location, bodies[1].tools[0].user_location);
    assert.equal(narrowed.supports(identity, { ...IL, id: 'XX' }), false, 'no hosts for the market, no narrowed search');
    assert.deepEqual(local.normalize({}), [], 'a discovery provider yields pages, not observations');
  });
});

describe('MD-7 the eBay boundary', () => {
  test('MD-7a off by default, and off without both credentials: no call is made and the report says NOT_CONFIGURED', async () => {
    assert.equal(ebayConfig({}).enabled, false);
    assert.equal(ebayConfig({ [EBAY_ENV.ENABLED]: 'true', [EBAY_ENV.CLIENT_ID]: 'id' }).enabled, false);
    assert.equal(ebayConfig({ [EBAY_ENV.ENABLED]: 'true', [EBAY_ENV.CLIENT_ID]: 'id', [EBAY_ENV.CLIENT_SECRET]: 's' }).enabled, true);
    assert.deepEqual(ebayConfig({ [EBAY_ENV.MARKETPLACES]: 'EBAY_IL,EBAY_GB' }).marketplaces, ['EBAY_GB'], 'EBAY_IL is not a Browse marketplace');
    const net = noNetwork();
    const p = createEbayProvider({ config: ebayConfig({}), fetchImpl: net.fetchImpl });
    const r = await runProvider(p, normalizeIdentity(M.NINJA), { market: IL, level: IDENTITY_LEVEL.PRODUCT, deadlineMs: 500 });
    assert.equal(r.status, PROVIDER_STATUS.NOT_CONFIGURED);
    assert.equal(net.calls.length, 0);
  });
  test('MD-7b what the API gives is normalised; what it does not give is stated, not faked', () => {
    assert.match(EBAY_CAPABILITIES.sold_prices, /LIMITED RELEASE/);
    assert.match(EBAY_CAPABILITIES.marketplace_israel, /does not support/);
    const obs = normalizeEbayItems(EBAY_RAW, { marketplace: 'EBAY_US', now: NOW });
    assert.equal(obs.length, 3);
    const [a, b, c] = obs;
    assert.deepEqual([a.price, a.currency, a.currency_basis, a.price_type, a.listing_status, a.sale_type, a.condition, a.locale, a.market, a.country],
      [45, 'USD', 'api', PRICE_TYPE.ASKING, LISTING_STATUS.ACTIVE, SALE_TYPE.FIXED_PRICE, 'Used', 'international', 'US', 'US']);
    assert.deepEqual([a.shipping, a.listing_id, a.origin_site, a.listed_at], [{ amount: 12, currency: 'USD' }, '110000000001', 'ebay.com', '2026-09-28T12:00:00.000Z']);
    assert.equal(c.sale_type, SALE_TYPE.AUCTION);
    assert.ok(obs.every((o) => o.price_type !== PRICE_TYPE.SOLD), 'no sold price is claimed');
    assert.ok(obs.every((o) => o.seller_ref?.startsWith('ebay:') && !/seller-/.test(o.seller_ref)), 'a seller handle never travels');
    // The URL's id is the key every provider that saw this page agrees on; eBay's own id travels beside it.
    assert.deepEqual([b.listing_key, b.provider_result_id], ['id:ebay.com|110000000002', 'v1|110000000002|0']);
    assert.equal(ebayQueryFor(normalizeIdentity(M.NINJA)), 'Ninja TB301', 'the strongest number known, not the read name');
    assert.equal(ebayQueryFor(normalizeIdentity(M.CONSOLE)), 'Sony PlayStation 5');
  });
  test('MD-7c switched on with credentials: a token, then one Browse search with the marketplace header; the secret never enters the report', async () => {
    const ff = fakeFetch([
      { prefix: 'https://api.ebay.com/identity/v1/oauth2/token', body: { access_token: 'tok-abc', expires_in: 7200 } },
      { prefix: 'https://api.ebay.com/buy/browse/v1/item_summary/search', body: EBAY_RAW },
    ]);
    const config = ebayConfig({ [EBAY_ENV.ENABLED]: 'true', [EBAY_ENV.CLIENT_ID]: 'client-id-xyz', [EBAY_ENV.CLIENT_SECRET]: 'secret-shh' });
    const p = createEbayProvider({ config, fetchImpl: ff.fetchImpl, now: () => NOW });
    const r = await runProvider(p, normalizeIdentity(M.NINJA), { market: IL, level: IDENTITY_LEVEL.PRODUCT, deadlineMs: 1000, now: () => NOW });
    assert.deepEqual([r.status, r.result_count, r.normalized_count, r.billed, r.cost_usd], [PROVIDER_STATUS.COMPLETED, 3, 3, false, 0]);
    assert.equal(ff.requests.length, 2);
    assert.equal(ff.requests[1].init.headers['X-EBAY-C-MARKETPLACE-ID'], 'EBAY_US');
    assert.match(ff.requests[1].url, /q=Ninja%20TB301/);
    assert.match(ff.requests[1].url, /conditions%3A%7BUSED%7D/);
    const text = JSON.stringify({ ...r, raw: undefined });
    assert.ok(!text.includes('secret-shh') && !text.includes('client-id-xyz') && !text.includes('tok-abc'));
    // A second search reuses the token.
    await runProvider(p, normalizeIdentity(M.NINJA), { market: IL, level: IDENTITY_LEVEL.PRODUCT, deadlineMs: 1000, now: () => NOW });
    assert.equal(ff.requests.length, 3);
    // A refused token is an AUTH failure, isolated.
    const denied = createEbayProvider({ config, fetchImpl: fakeFetch([{ prefix: 'https://api.ebay.com/identity', status: 401, body: {} }]).fetchImpl, now: () => NOW });
    const d = await runProvider(denied, normalizeIdentity(M.NINJA), { market: IL, level: IDENTITY_LEVEL.PRODUCT, deadlineMs: 1000 });
    assert.deepEqual([d.status, d.error_class], [PROVIDER_STATUS.FAILED, ERROR_CLASS.AUTH]);
  });
});
