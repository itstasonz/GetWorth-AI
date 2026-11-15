// CL — THE CLOSER LOOK (2026-11-15, service.js closerLook): when the fast search ends without a worth, one more search
// runs after the answer — its own queries, several actions, ads' own pages opened — and its evidence passes every check
// the fast search's does. The phone's follow-up gets the result. Never when the fast search priced the item.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { runPrice, resetMarketCache } from '../api/_lib/scan/service.js';
import { resetFxCache } from '../api/_lib/scan/fx.js';
import { normalizeIdentity } from '../api/_lib/scan/identify.js';
import { buildMarketPrompt } from '../api/_lib/scan/market.js';
import { RAW_IDENTITY, NOW, fakeProvider } from './helpers/core-scan-fakes.mjs';

const DAY = '2026-10-01';
const ad = (n, price) => ({ url: `https://www.homeless.co.il/yad2/viewad,7000${n}.aspx`, title: 'Logitech G Pro X Superlight', price, currency: 'ILS', kind: 'used_listing', match: 'exact', market: 'IL', condition: 'good', page: 'listing', listed: DAY, stock: 'unknown', shipping: null });
const identity = normalizeIdentity(RAW_IDENTITY);
beforeEach(() => { resetMarketCache(); resetFxCache(); });

/** The fast stages answer `fast`; the closer look answers `deep` (or fails with `deepStatus`). */
function provider({ fast, deep, deepStatus = null }) {
  const reached = [...fast, ...(deep ?? [])].map((e) => e.url);
  const base = fakeProvider({ markets: [{ evidence: fast }], expand: [{ evidence: [] }], reached });
  const closer = fakeProvider({ markets: [{ evidence: deep ?? [] }], reached, status: deepStatus });
  const deepCalls = [];
  const f = async (url, init = {}) => {
    if (init.body && /SEARCH — LOOK CLOSER/.test(init.body)) { deepCalls.push(JSON.parse(init.body)); return closer(url, init); }
    return base(url, init);
  };
  f.deepCalls = deepCalls;
  return f;
}
const memStore = () => { const m = new Map(); return { load: async (k) => m.get(k) ?? null, save: async (k, r) => { m.set(k, r); } }; };
async function scan(fetchImpl, opts = {}) {
  const bg = [];
  const store = memStore();
  const args = { identity, model: 'm', apiKey: 'k', fetchImpl, now: () => NOW, parallel: false, store, marketplace: async () => [], marketplaceListings: async () => [], deep: true, ...opts };
  const first = await runPrice({ ...args, background: (p) => { bg.push(p); } });
  await Promise.all(bg);
  const follow = await runPrice({ ...args, background: () => {} });
  return { first, follow, bg };
}

describe('CL-1 the closer look (off by default; these run it on)', () => {
  test('CL-1o off unless CORE_SCAN_MARKET_DEEP is exactly "true"', async () => {
    const { resolveMarketDeep } = await import('../api/_lib/scan/config.js');
    assert.deepEqual([resolveMarketDeep({}), resolveMarketDeep({ CORE_SCAN_MARKET_DEEP: 'true' }), resolveMarketDeep({ CORE_SCAN_MARKET_DEEP: '1' })], [false, true, false]);
  });
  test('CL-1a one ad (no worth): the answer comes at once, says it is still looking, and the closer look searches like a person', async () => {
    const f = provider({ fast: [ad(1, 260)], deep: [] });
    const { first, bg } = await scan(f);
    assert.equal(first.status, 'insufficient_evidence');
    assert.deepEqual([first.refreshing, first.deepening], [true, true]);
    assert.equal(bg.length, 1);
    const body = f.deepCalls[0];
    assert.equal(body.max_tool_calls, 4);
    assert.equal(body.tools[0].search_context_size, 'high');
    assert.match(body.input[0].content[0].text, /OPEN that ad's own page/);
  });
  test('CL-1b a second independent ad found by the closer look: the follow-up is a worth, from both ads', async () => {
    const { follow } = await scan(provider({ fast: [ad(1, 260)], deep: [ad(2, 250)] }));
    assert.equal(follow.status, 'priced');
    assert.equal(follow.valuation.evidence.filter((e) => e.used).length, 2);
    assert.ok(follow.valuation.searched.stages.includes('deep'));
  });
  test('CL-1c the fast search priced the item: no closer look, no extra cost', async () => {
    const f = provider({ fast: [ad(1, 260), ad(2, 250)], deep: [ad(3, 255)] });
    const { first, bg } = await scan(f);
    assert.equal(first.status, 'priced');
    assert.equal(first.refreshing ?? false, false);
    assert.equal(bg.length, 0);
    assert.equal(f.deepCalls.length, 0);
  });
  test('CL-1d the closer look failing leaves the first answer standing', async () => {
    const { follow } = await scan(provider({ fast: [ad(1, 260)], deepStatus: 500 }));
    assert.equal(follow.status, 'insufficient_evidence');
    assert.equal(follow.valuation.comparative.count, 1);
  });
  test('CL-1e switched off (CORE_SCAN_MARKET_DEEP=false): nothing more runs', async () => {
    const f = provider({ fast: [ad(1, 260)], deep: [ad(2, 250)] });
    const { first, bg } = await scan(f, { deep: false });
    assert.equal(first.refreshing ?? false, false);
    assert.equal(bg.length + f.deepCalls.length, 0);
  });
  test('CL-1f a follow-up that arrives while the closer look runs waits for it, bounded', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const inner = provider({ fast: [ad(1, 260)], deep: [ad(2, 250)] });
    const f = async (url, init = {}) => { if (init.body && /LOOK CLOSER/.test(init.body)) await gate; return inner(url, init); };
    const store = memStore();
    const args = { identity, model: 'm', apiKey: 'k', fetchImpl: f, now: () => NOW, parallel: false, store, marketplace: async () => [], marketplaceListings: async () => [], deep: true };
    await runPrice({ ...args, background: () => {} });
    const pending = runPrice({ ...args, background: () => {} });
    setTimeout(release, 30);
    assert.equal((await pending).status, 'priced');
  });
  test('CL-1g the closer look still never reports a price the search did not show (the same evidence rules)', () => {
    const p = buildMarketPrompt({ identity, stage: 'deep' });
    assert.match(p, /Report only prices you actually found on a page the search returned/);
    assert.match(p, /SEARCH — LOOK CLOSER/);
  });
});

describe('CL-2 an exact model is one product, whatever its class (2026-11-15)', async () => {
  const { strategyFor, STRATEGY } = await import('../api/_lib/scan/strategy.js');
  const { buildValuation } = await import('../api/_lib/scan/valuation.js');
  test('CL-2a a Nespresso Essenza Mini or a Philips HD9650 is valued as itself; a described sofa, a vintage camera, a model-less kettle by kind', () => {
    assert.equal(strategyFor({ market_class: 'household', identity_precision: 'exact_model', exact_model_established: true, model: 'Essenza Mini' }), STRATEGY.EXACT);
    assert.equal(strategyFor({ market_class: 'furniture', identity_precision: 'descriptive', exact_model_established: false, model: null }), STRATEGY.COMPARABLE);
    assert.equal(strategyFor({ market_class: 'handmade_vintage', identity_precision: 'exact_model', exact_model_established: true, model: 'AE-1 Program' }), STRATEGY.COMPARABLE);
    assert.equal(strategyFor({ market_class: 'household', identity_precision: 'exact_model', exact_model_established: false, model: 'kettle' }), STRATEGY.COMPARABLE);
    assert.equal(strategyFor({ market_class: 'household', identity_precision: 'family', exact_model_established: true, model: 'Airfryer' }), STRATEGY.COMPARABLE);
  });
  test('CL-2b the recorded Essenza: a ₪650 used ad above Ivory\'s ₪365 new price is not shown as its comparable; the new price is', () => {
    const T = '2026-11-15';
    const ev = [
      { url: 'https://www.ivory.co.il/catalog.php?id=1', domain: 'ivory.co.il', title: 'Nespresso Essenza Mini', price: 365, currency: 'ILS', price_ils: 365, kind: 'new_retail', match: 'exact', market: 'IL', condition: 'new_sealed', page: 'shop_product', listed: null, binding: 'strong', seen: T },
      { url: 'https://m.homeless.co.il/yad2/viewad,1.aspx', domain: 'm.homeless.co.il', title: 'Nespresso Essenza Mini', price: 650, currency: 'ILS', price_ils: 650, kind: 'used_listing', match: 'exact', market: 'IL', condition: 'unknown', page: 'listing', listed: T, binding: 'strong', seen: T },
    ];
    const v = buildValuation({ evidence: ev, strategy: STRATEGY.EXACT, today: T });
    assert.equal(v.status, 'insufficient_evidence');
    assert.equal(v.comparative, null, 'an ad above the new price is never shown as what it is worth');
    assert.equal(v.retail_new_ils, 370);
  });
});
