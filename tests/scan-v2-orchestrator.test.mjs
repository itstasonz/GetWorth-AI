// ══════════════════════════════════════════════════════════════════════════════
// MARKET DATA LAYER — THE ORCHESTRATOR: PARALLEL, DEADLINED, STOPPED BY EVIDENCE
//
// Every provider here is fake and timed; no test makes a network call. The
// waterfall scenarios the order asks for print a table and assert the budget.
//
//   node --test tests/scan-v2-orchestrator.test.mjs
// ══════════════════════════════════════════════════════════════════════════════
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { runMarketData, mergeProvenance } from '../api/_lib/v2/market/orchestrator.js';
import { PROVIDER_STATUS, PROVIDER_CLASS } from '../api/_lib/v2/market/provider.js';
import { QUALIFICATION, PRICE_TYPE } from '../api/_lib/v2/market/observation.js';
import { createMarketEvidenceCache, memoryStore } from '../api/_lib/v2/market/cache.js';
import { createFxSource, parseBoiRates } from '../api/_lib/v2/market/fx.js';
import { runV2Price, defaultMarketProviders } from '../api/_lib/v2/scan.js';
import { runV2Search } from '../api/_lib/v2/search.js';
import { assessV2Evidence, TIER } from '../api/_lib/v2/evidence.js';
import { resolveV2Price, PRICE_STATE } from '../api/_lib/v2/pricing.js';
import { normalizeIdentity } from '../api/_lib/v2/identity.js';
import { decideSufficiency, IDENTITY_LEVEL } from '../api/_lib/v2/sufficiency.js';
import { subjectOf, planV2Search } from '../api/_lib/v2/search-plan.js';
import { resolveMarketRegion } from '../api/_lib/phaseb/config.js';
import { RELATION } from '../api/_lib/v2/market-identity.js';
import { V2_MARKET_BUDGET_MS } from '../api/_lib/v2/config.js';
import * as M from './fixtures/scan-v2/market-fixtures.mjs';
import { RAW, RESULTS_PS5_VERIFIED, mockV2Provider } from './fixtures/scan-v2/fixtures.mjs';
import { fakeDiscovery, fakeListings, ABROAD_OBSERVATIONS, BOI_RAW, BOI_STALE, NOW, noNetwork, provenanceOf } from './fixtures/scan-v2/market-data-fixtures.mjs';

const IL = resolveMarketRegion();
const scanOf = (raw) => {
  const identity = normalizeIdentity(raw);
  const sufficiency = decideSufficiency(identity);
  return { identity, sufficiency, subject: subjectOf(identity, sufficiency.level), level: sufficiency.level };
};
const run = (raw, providers, extra = {}) => {
  const s = scanOf(raw);
  return runMarketData({ ...s, market: IL, providers, fetchImpl: noNetwork().fetchImpl, ...extra });
};
const NINJA_PAGES = [...M.CONNECTS_TB301, ...M.RESULTS_RETAIL_TWO_SHOPS];

describe('OR-1 one profile is today’s engine', () => {
  test('OR-1a runV2Price through the orchestrator gives the same verdict, anchor and call count as the search alone', async () => {
    const { identity, sufficiency, subject } = scanOf(RAW.PS5);
    const state = { identity, sufficiency, followups_used: 0 };
    const fetchImpl = mockV2Provider({ results: RESULTS_PS5_VERIFIED });
    const direct = await runV2Search({ plan: planV2Search(identity, sufficiency.level, IL), market: IL, model: 'm', apiKey: 'k', fetchImpl });
    const expected = resolveV2Price({ identity, subject, sufficiency, evidence: assessV2Evidence({ provenance: direct.provenance, subject, level: sufficiency.level, identity }), searchOutcome: direct.outcome });
    const r = await runV2Price({ state, model: 'm', apiKey: 'k', fetchImpl: mockV2Provider({ results: RESULTS_PS5_VERIFIED }), env: {} });
    assert.equal(r.valuation.state, expected.state);
    assert.deepEqual([r.valuation.low, r.valuation.recommended, r.valuation.high], [expected.low, expected.recommended, expected.high]);
    assert.deepEqual([r.calls.search, r.search.outcome, r.search.stopped_at_results ?? r.search.stopped_early], [1, direct.outcome, true]);
    assert.equal(r.market_data.ledger.length, 1);
    assert.deepEqual([r.market_data.ledger[0].provider, r.market_data.ledger[0].profile, r.market_data.ledger[0].status], ['openai_web_search', 'local', PROVIDER_STATUS.COMPLETED]);
    assert.deepEqual(r.market_data.independence.admitted.providers, ['openai_web_search']);
    assert.equal(r.market_data.independence.admitted.qualified_observation_count, 3);
  });
  test('OR-1b the default provider set from an empty environment is the local search profile alone; eBay and FX are off', () => {
    const providers = defaultMarketProviders({ env: {}, model: 'm', apiKey: 'k' });
    assert.deepEqual(providers.map((p) => [p.id, p.profile_name]), [['openai_web_search', 'local']]);
    const two = defaultMarketProviders({ env: { SCAN_ENGINE_V2_SEARCH_PROFILES: 'local_used_domains' }, model: 'm', apiKey: 'k' });
    assert.deepEqual(two.map((p) => p.profile_name), ['local', 'local_used_domains']);
  });
});

describe('OR-2 providers run in parallel, under one deadline, and one failing does not fail the scan', () => {
  test('OR-2a two providers of 300 ms finish together, not one after the other', async () => {
    const t0 = Date.now();
    const r = await run(M.NINJA, [fakeDiscovery({ id: 'a', results: NINJA_PAGES, delayMs: 300 }), fakeDiscovery({ id: 'b', profile: 'x', results: [], delayMs: 300 })]);
    const elapsed = Date.now() - t0;
    assert.ok(elapsed < 520, `elapsed ${elapsed}`);
    assert.deepEqual(r.ledger.map((x) => x.status).sort(), [PROVIDER_STATUS.COMPLETED, PROVIDER_STATUS.EMPTY]);
  });
  test('OR-2b a hanging provider times out at the deadline; the others’ evidence stands', async () => {
    const t0 = Date.now();
    const r = await run(M.NINJA, [fakeDiscovery({ id: 'fast', results: NINJA_PAGES, delayMs: 30 }), fakeDiscovery({ id: 'hang', profile: 'h', hang: true })], { deadlineMs: 250 });
    const elapsed = Date.now() - t0;
    assert.ok(elapsed < 600, `elapsed ${elapsed}`);
    const hang = r.ledger.find((x) => x.provider === 'hang');
    assert.deepEqual([hang.status, hang.error_class], [PROVIDER_STATUS.TIMED_OUT, 'timeout']);
    assert.equal(r.evidence.retail_anchor.strength, 'STRONG');
    assert.equal(r.timings.within_deadline, true);
  });
  test('OR-2c a provider that throws is FAILED with an error class, and nothing else is lost', async () => {
    const r = await run(M.NINJA, [fakeDiscovery({ id: 'ok', results: NINJA_PAGES }), fakeListings({ id: 'broken', fail: true }), fakeDiscovery({ id: 'broken2', profile: 'b2', fail: true })]);
    const statuses = Object.fromEntries(r.ledger.map((x) => [x.provider, x.status]));
    assert.deepEqual(statuses, { ok: PROVIDER_STATUS.COMPLETED, broken: PROVIDER_STATUS.FAILED, broken2: PROVIDER_STATUS.FAILED });
    assert.ok(r.ledger.filter((x) => x.status === PROVIDER_STATUS.FAILED).every((x) => x.error_class && x.error));
    assert.equal(r.search_outcome, 'COMPLETED');
    assert.equal(r.evidence.retail_anchor.shops, 2);
  });
  test('OR-2d no provider, or every provider empty: an honest empty report, no number', async () => {
    const none = await run(M.NINJA, []);
    assert.deepEqual([none.search_outcome, none.evidence, none.observations.length], ['NOT_ATTEMPTED', null, 0]);
    const empty = await run(M.NINJA, [fakeDiscovery({ results: [] })]);
    assert.equal(empty.ledger[0].status, PROVIDER_STATUS.EMPTY);
    const s = scanOf(M.NINJA);
    assert.equal(resolveV2Price({ ...s, evidence: empty.evidence, searchOutcome: empty.search_outcome }).state, PRICE_STATE.NO_PRICE_EVIDENCE);
  });
});

describe('OR-3 early stopping runs on QUALIFIED evidence', () => {
  test('OR-3a a fast local tier-A quorum aborts a slow lower-tier provider; a slow DISCOVERY provider is left to finish', async () => {
    const t0 = Date.now();
    const r = await run(RAW.PS5, [
      fakeDiscovery({ id: 'local', results: RESULTS_PS5_VERIFIED, delayMs: 20 }),
      fakeListings({ id: 'abroad', observations: ABROAD_OBSERVATIONS, delayMs: 900 }),
      fakeDiscovery({ id: 'second', profile: 'local_used_domains', results: [], delayMs: 200, classes: [PROVIDER_CLASS.SEARCH_DISCOVERY, PROVIDER_CLASS.LOCAL_USED] }),
    ]);
    const elapsed = Date.now() - t0;
    assert.equal(r.early_stop.triggered, true);
    assert.deepEqual(r.early_stop.aborted, ['abroad']);
    assert.equal(r.ledger.find((x) => x.provider === 'abroad').status, PROVIDER_STATUS.ABORTED);
    assert.equal(r.ledger.find((x) => x.provider === 'second').status, PROVIDER_STATUS.EMPTY, 'a discovery provider could still raise the verdict');
    assert.ok(elapsed < 700, `elapsed ${elapsed}: the slow provider did not delay the answer`);
    assert.equal(r.evidence.qualification.qualified, true);
  });
  test('OR-3b many results that qualify nothing stop nothing', async () => {
    const r = await run(M.NINJA, [fakeDiscovery({ id: 'local', results: NINJA_PAGES, delayMs: 10 }), fakeListings({ id: 'abroad', observations: ABROAD_OBSERVATIONS, delayMs: 120 })]);
    assert.equal(r.early_stop.triggered, false);
    assert.equal(r.ledger.find((x) => x.provider === 'abroad').status, PROVIDER_STATUS.COMPLETED);
    assert.ok(r.evidence.pages.length >= 4, 'results existed');
  });
  test('OR-3c early stopping can be switched off', async () => {
    const r = await run(RAW.PS5, [fakeDiscovery({ id: 'local', results: RESULTS_PS5_VERIFIED }), fakeListings({ id: 'abroad', observations: ABROAD_OBSERVATIONS, delayMs: 60 })], { earlyStop: false });
    assert.equal(r.early_stop.triggered, false);
    assert.equal(r.ledger.find((x) => x.provider === 'abroad').status, PROVIDER_STATUS.COMPLETED);
  });
});

describe('OR-4 pages, listings and the same advert through two providers', () => {
  test('OR-4a the same page from two profiles is one page with two retrievals; actions and queries are summed and unioned', () => {
    const a = { provider: 'openai_web_search', profile: 'local', request_id: 'r1', raw: { search: { provenance: provenanceOf(M.RESULTS_ONE_LISTING, { queries: ['q1'] }) } } };
    const b = { provider: 'openai_web_search', profile: 'local_used_domains', request_id: 'r2', raw: { search: { provenance: provenanceOf(M.RESULTS_ONE_LISTING, { queries: ['q2'] }) } } };
    const m = mergeProvenance([a, b]);
    assert.deepEqual([m.results.length, m.results[0].retrievals.length, m.search_call_count, m.queries], [1, 2, 2, ['q1', 'q2']]);
    assert.equal(mergeProvenance([{ raw: null }]).search_performed, false);
  });
  test('OR-4b listing-provider observations are resolved against the market identity the pages established: exact and complete is tier-B context; the base-only and the sibling are rejected; nothing abroad is admitted', async () => {
    const r = await run(M.NINJA, [fakeDiscovery({ results: NINJA_PAGES }), fakeListings({ id: 'ebay_fake', observations: ABROAD_OBSERVATIONS })]);
    const abroad = r.observations.filter((o) => o.provider === 'ebay_fake');
    assert.equal(abroad.length, 3);
    const byPrice = Object.fromEntries(abroad.map((o) => [o.price, o]));
    assert.deepEqual([byPrice[45].relation, byPrice[45].tier, byPrice[45].qualification_state, byPrice[45].price_type], ['EXACT_PRODUCT', TIER.B, QUALIFICATION.CONTEXT, PRICE_TYPE.ASKING]);
    assert.deepEqual([byPrice[30].configuration, byPrice[30].qualification_state, byPrice[30].rejection_reason, byPrice[30].tier], ['BASE_ONLY', QUALIFICATION.REJECTED, 'configuration_base_only', null]);
    // No page showed TB303 beside the brand, so it is not a known sibling: it is another product's number, and rejected as such.
    assert.deepEqual([byPrice[40].relation, byPrice[40].qualification_state, byPrice[40].rejection_reason], ['OTHER_PRODUCT', QUALIFICATION.REJECTED, 'listing_relation_other_product']);
    assert.ok(abroad.every((o) => o.locale === 'international' && o.qualification_state !== QUALIFICATION.ADMITTED));
    assert.equal(r.independence.admitted.qualified_observation_count, 0);
    assert.equal(r.independence.anchors.distinct_origin_count, 2);
  });
  test('OR-4c the same listing seen by a discovery page and a listing provider is one observation', async () => {
    const page = M.result('https://www.ebay.com/itm/110000000001', 'Ninja TB301 Detect Duo Power Blender Pro complete set $45.00 Used | eBay', 'lightly used');
    const r = await run(M.NINJA, [fakeDiscovery({ results: [...M.CONNECTS_TB301, page] }), fakeListings({ id: 'ebay_fake', observations: ABROAD_OBSERVATIONS.slice(0, 1) })]);
    const same = r.observations.filter((o) => o.listing_key === 'id:ebay.com|110000000001' || (o.canonical_url ?? '').includes('110000000001'));
    assert.equal(same.length, 1, 'one advert, two retrieval providers');
    assert.ok(same[0].retrievals.length >= 2 || same[0].duplicates_folded >= 1);
    assert.equal(r.dedupe.counts.duplicate_count, 1);
  });
  test('OR-4d a foreign asking price is converted beside its original when the bank’s table is in hand, and refused by name when it is stale', async () => {
    const fx = createFxSource({ enabled: true, fetchImpl: async () => ({ ok: true, status: 200, json: async () => BOI_RAW }), now: () => NOW });
    const r = await run(M.NINJA, [fakeDiscovery({ results: NINJA_PAGES }), fakeListings({ id: 'ebay_fake', observations: ABROAD_OBSERVATIONS })], { fx, now: () => NOW });
    const exact = r.observations.find((o) => o.price === 45);
    assert.deepEqual([exact.price, exact.currency, exact.converted.ils, exact.converted.proof.source], [45, 'USD', 166.5, 'bank_of_israel']);
    assert.deepEqual([r.fx.status, r.fx.rate_date], ['OK', '2026-10-05T00:00:00.000Z']);
    const stale = createFxSource({ enabled: true, seed: parseBoiRates(BOI_STALE, NOW), now: () => NOW });
    const r2 = await run(M.NINJA, [fakeDiscovery({ results: NINJA_PAGES }), fakeListings({ id: 'ebay_fake', observations: ABROAD_OBSERVATIONS })], { fx: stale, now: () => NOW });
    assert.equal(r2.observations.find((o) => o.price === 45).converted.refused, 'fx_stale');
  });
});

describe('OR-5 the cache', () => {
  test('OR-5a a completed run is written through; the next run reads it as CONTEXT with the observed time intact, and a verified state never comes from the cache alone', async () => {
    let t = NOW;
    const cache = createMarketEvidenceCache({ store: memoryStore(), now: () => t });
    const first = await run(RAW.PS5, [fakeDiscovery({ results: RESULTS_PS5_VERIFIED })], { cache, now: () => t });
    assert.equal(first.cached.hit, false);
    assert.equal(cache.stats().puts, 1);
    t += 3600_000;
    const second = await run(RAW.PS5, [fakeDiscovery({ results: [] })], { cache, now: () => t });
    assert.deepEqual([second.cached.hit, second.cached.count], [true, 3]);
    const s = scanOf(RAW.PS5);
    assert.equal(resolveV2Price({ ...s, evidence: second.evidence, searchOutcome: second.search_outcome }).state, PRICE_STATE.NO_PRICE_EVIDENCE, 'cached rows are not fresh evidence');
    const got = await cache.get(second.cached.key);
    assert.ok(got.observations.every((o) => o.from_cache && o.freshness === 'CACHED' && o.observed_at === new Date(NOW).toISOString()));
  });
});

describe('OR-6 waterfall: the budget holds in every shape of run', () => {
  const scenarios = [
    ['fast local evidence', RAW.PS5, () => [fakeDiscovery({ id: 'local', results: RESULTS_PS5_VERIFIED, delayMs: 40 }), fakeListings({ id: 'abroad', observations: ABROAD_OBSERVATIONS, delayMs: 400 })]],
    ['retail + international', M.NINJA, () => [fakeDiscovery({ id: 'local', results: NINJA_PAGES, delayMs: 120 }), fakeListings({ id: 'abroad', observations: ABROAD_OBSERVATIONS, delayMs: 80 })]],
    ['one provider timeout', M.NINJA, () => [fakeDiscovery({ id: 'local', results: NINJA_PAGES, delayMs: 60 }), fakeListings({ id: 'abroad', hang: true })]],
    ['one provider failure', M.NINJA, () => [fakeDiscovery({ id: 'local', results: NINJA_PAGES, delayMs: 60 }), fakeListings({ id: 'abroad', fail: true, delayMs: 20 })]],
    ['no evidence', M.NINJA, () => [fakeDiscovery({ id: 'local', results: [], delayMs: 50 }), fakeListings({ id: 'abroad', observations: [], delayMs: 50 })]],
  ];
  test('OR-6a each scenario completes within the deadline and reports every provider', async () => {
    const DEADLINE = 300;
    const rows = [];
    for (const [name, raw, make] of scenarios) {
      const t0 = Date.now();
      const r = await run(raw, make(), { deadlineMs: DEADLINE });
      const elapsed = Date.now() - t0;
      const s = scanOf(raw);
      const v = resolveV2Price({ ...s, evidence: r.evidence, searchOutcome: r.search_outcome });
      rows.push({ scenario: name, elapsed_ms: elapsed, within: r.timings.within_deadline, early_stop: r.early_stop.triggered, state: v.state, anchor: v.retail_anchor.strength,
        providers: r.ledger.map((x) => `${x.provider}:${x.status}:${x.elapsed_ms}ms`).join(' ') });
      assert.ok(elapsed <= DEADLINE + 250, `${name}: ${elapsed} ms`);
      assert.equal(r.ledger.length, 2, name);
    }
    console.table(rows);
    assert.equal(rows[0].early_stop, true);
    assert.equal(rows[0].state, PRICE_STATE.VERIFIED_MARKET_VALUE);
    assert.equal(rows[1].anchor, 'STRONG');
    assert.match(rows[2].providers, /abroad:TIMED_OUT/);
    assert.match(rows[3].providers, /abroad:FAILED/);
    assert.equal(rows[4].state, PRICE_STATE.NO_PRICE_EVIDENCE);
    assert.ok(V2_MARKET_BUDGET_MS <= 4500);
  });
});
