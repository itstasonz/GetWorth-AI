// MI — the market index: source permissions, normalised observations, price history rules, refresh policy, structured
// data, and the scan's fast path / research fallback over the index (2026-11-13).
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { sourceOf, mayRetrieveAutomatically, mayUseInScan, mayKeepHistory, assertRetrievable, retentionMs, PERMISSION, HISTORY_RETENTION_MS, registrySummary } from '../api/_lib/market/sources.js';
import { toObservation, observationsFrom, fingerprintOf, canonicalUrl, isSelfGenerated, dedupeRelisted, isCurrent, SEGMENT, SECONDHAND_SEGMENTS } from '../api/_lib/market/observations.js';
import { refreshClassOf, refreshMsFor, isDue, REFRESH_CLASS } from '../api/_lib/market/refresh-policy.js';
import { extractProducts, extractFromPermittedSource } from '../api/_lib/market/structured-data.js';
import { productKeyOf, loadIndexed, saveIndexed } from '../api/_lib/market/index-store.js';
import { runPrice, resetMarketCache, researchKey, indexRecord, RESEARCH_VERSION } from '../api/_lib/scan/service.js';
import { resetFxCache } from '../api/_lib/scan/fx.js';
import { normalizeIdentity } from '../api/_lib/scan/identify.js';
import { MARKET_POOL_MS } from '../api/_lib/scan/config.js';
import { RAW_IDENTITY, fakeProvider, NOW, RAW_MARKET } from './helpers/core-scan-fakes.mjs';

const identity = normalizeIdentity(RAW_IDENTITY);
const HOUR = 3_600_000;
const today = new Date(NOW).toISOString().slice(0, 10);
const ref = (n, price, extra = {}) => ({ url: `https://www.homeless.co.il/yad2/viewad,${n}.aspx`, domain: 'homeless.co.il', title: `Logitech G Pro X Superlight ${n}`, price, currency: 'ILS', price_ils: price,
  kind: 'used_listing', match: 'exact', market: 'IL', condition: 'good', page: 'listing', listed: today, binding: 'strong', seen: today, ...extra });
const opts = { productKey: 'k'.repeat(40), rulesVersion: RESEARCH_VERSION, seenAt: NOW, researchWindowMs: MARKET_POOL_MS };

describe('MI-1 source permissions', () => {
  test('MI-1a public reachability is not permission: no Israeli marketplace or retailer may be retrieved automatically today', () => {
    for (const site of ['homeless.co.il', 'ad.co.il', 'yad2.co.il', 'facebook.com', 'ksp.co.il', 'bug.co.il', 'ivory.co.il', 'zap.co.il', 'zuzz.co.il', 'unknown-shop.co.il']) {
      assert.equal(mayRetrieveAutomatically(sourceOf(`https://www.${site}/x`)), false, site);
      assert.equal(mayKeepHistory(sourceOf(`https://${site}/x`)), false, site);
    }
    assert.throws(() => assertRetrievable('https://www.homeless.co.il/yad2/'), /source_not_authorized:homeless:public_research_only/);
    assert.throws(() => assertRetrievable('https://www.yad2.co.il/item/1'), /source_not_authorized:yad2:not_authorized/);
  });
  test('MI-1b an operator that forbids collection is not used even inside a scan; unknown and public-research sources are, for the scan only', () => {
    assert.equal(mayUseInScan(sourceOf('https://www.yad2.co.il/item/1')), false);
    assert.equal(mayUseInScan(sourceOf('https://m.facebook.com/marketplace/item/1')), false);
    assert.equal(mayUseInScan(sourceOf('https://www.homeless.co.il/yad2/viewad,1.aspx')), true);
    assert.equal(sourceOf('https://shop.example.co.il/p').permission, PERMISSION.UNKNOWN);
    assert.equal(retentionMs(sourceOf('https://www.homeless.co.il/a'), MARKET_POOL_MS), MARKET_POOL_MS);
    assert.equal(retentionMs(sourceOf('getworth:sale:abcdef12'), MARKET_POOL_MS), HISTORY_RETENTION_MS);
    assert.equal(retentionMs(sourceOf('https://www.yad2.co.il/a'), MARKET_POOL_MS), 0);
  });
  test('MI-1c the registry summary lists every source with what it allows', () => {
    const rows = registrySummary();
    assert.ok(rows.find((r) => r.id === 'getworth' && r.automated && r.history));
    assert.ok(rows.find((r) => r.id === 'ebay' && r.permission === 'authorized_restricted'));
    assert.ok(rows.every((r) => r.id === 'getworth' || r.id === 'ebay' || !r.automated));
  });
});

describe('MI-2 observations', () => {
  test('MI-2a a verified Israeli ad becomes a private asking observation kept for the research window only', () => {
    const { observation } = toObservation(ref(1, 300), opts);
    assert.equal(observation.segment, SEGMENT.PRIVATE_ASKING);
    assert.equal(observation.source_id, 'homeless');
    assert.equal(observation.permission, PERMISSION.PUBLIC_RESEARCH);
    assert.equal(Date.parse(observation.retain_until) - NOW, MARKET_POOL_MS);
    assert.equal(observation.reference.price, 300);
  });
  test('MI-2b kinds stay apart: a sale, a refurbished unit, a new price and a guide are four segments, and only the first two plus refurbished are second-hand', () => {
    const seg = (kind) => toObservation(ref(2, 500, { kind }), opts).observation.segment;
    assert.deepEqual([seg('sold'), seg('refurbished'), seg('new_retail'), seg('price_guide')], ['completed_sale', 'refurbished', 'new_retail', 'price_guide']);
    assert.ok(!SECONDHAND_SEGMENTS.includes(SEGMENT.NEW_RETAIL) && !SECONDHAND_SEGMENTS.includes(SEGMENT.PRICE_GUIDE));
    assert.equal(toObservation(ref(3, 500, { kind: 'other' }), opts).reason, 'not_a_price_kind');
  });
  test('MI-2c another model, an accessory or a bundle is never kept for this product', () => {
    for (const match of ['sibling_model', 'accessory', 'part', 'bundle', 'box_only', 'irrelevant']) assert.equal(toObservation(ref(4, 100, { match }), opts).reason, 'not_this_product', match);
  });
  test('MI-2d Yad2 and Facebook are refused at the index', () => {
    assert.equal(toObservation(ref(5, 300, { url: 'https://www.yad2.co.il/item/abc' }), opts).reason, 'source_not_authorized');
  });
  test('MI-2e FEEDBACK LOOP: GetWorth estimates, recommended prices and engine-priced listings never become evidence', () => {
    for (const bad of [{ source: 'getworth_estimate' }, { source: 'recommended_price' }, { price_origin: 'engine' }, { url: 'getworth:valuation:123', source: 'x' }, { url: 'getworth:sale:abcdef12', source: 'getworth_sale', verification: 'seller_reported', kind: 'sold' }]) {
      assert.equal(isSelfGenerated(ref(6, 300, bad)), true, JSON.stringify(bad));
      assert.equal(toObservation(ref(6, 300, bad), opts).reason, 'self_generated');
    }
    const sale = { url: 'getworth:sale:abcdef12', source: 'getworth_sale', verification: 'buyer_confirmed', kind: 'sold', page: 'listing' };
    assert.equal(isSelfGenerated(ref(7, 300, sale)), false);
    assert.equal(toObservation(ref(7, 300, sale), opts).observation.segment, SEGMENT.COMPLETED_SALE);
  });
  test('MI-2f one listing is one fingerprint: tracking parameters, www/m and a new price do not make a new listing; another row on a list page does', () => {
    const a = fingerprintOf(ref(8, 300));
    assert.equal(fingerprintOf(ref(8, 280, { url: 'https://m.homeless.co.il/yad2/viewad,8.aspx?utm_source=x' })), a);
    assert.equal(canonicalUrl('https://www.homeless.co.il/yad2/viewad,8.aspx?b=2&a=1&fbclid=z'), 'homeless.co.il/yad2/viewad,8.aspx?a=1&b=2');
    const list = (title) => fingerprintOf(ref(9, 300, { page: 'search_or_category', url: 'https://www.homeless.co.il/yad2/', title }));
    assert.notEqual(list('Superlight black'), list('Superlight white'));
  });
  test('MI-2g a research deduplicates by fingerprint and says what it refused', () => {
    const { observations, refused } = observationsFrom([ref(10, 300), ref(10, 300), ref(11, 320, { match: 'sibling_model' }), ref(12, 310, { url: 'https://www.yad2.co.il/item/12' })], opts);
    assert.equal(observations.length, 1);
    assert.deepEqual(refused, { duplicate: 1, not_this_product: 1, source_not_authorized: 1 });
  });
  test('MI-2h a relisted ad (same title, price and site) is read once', () => {
    const rows = [{ source_id: 'homeless', title: 'G Pro X', price: 300, currency: 'ILS' }, { source_id: 'homeless', title: 'g pro x!', price: 300, currency: 'ILS' }, { source_id: 'homeless', title: 'G Pro X', price: 290, currency: 'ILS' }];
    assert.equal(dedupeRelisted(rows).length, 2);
  });
  test('MI-2i current vs historical: archived, expired, or read by older rules is not current evidence', () => {
    const row = { archived: false, rules_version: RESEARCH_VERSION, retain_until: new Date(NOW + HOUR).toISOString(), permission: 'public_research_only' };
    assert.equal(isCurrent(row, { now: NOW, rulesVersion: RESEARCH_VERSION }), true);
    assert.equal(isCurrent({ ...row, archived: true }, { now: NOW, rulesVersion: RESEARCH_VERSION }), false);
    assert.equal(isCurrent({ ...row, retain_until: new Date(NOW - 1).toISOString() }, { now: NOW, rulesVersion: RESEARCH_VERSION }), false);
    assert.equal(isCurrent({ ...row, rules_version: RESEARCH_VERSION - 1 }, { now: NOW, rulesVersion: RESEARCH_VERSION }), false);
  });
});

describe('MI-3 refresh policy', () => {
  test('MI-3a the proposed intervals by kind of item, never beyond the research window', () => {
    assert.equal(refreshClassOf(identity), REFRESH_CLASS.FAST);
    assert.equal(refreshMsFor({ market_class: 'household', item_type: 'washing machine' }), 72 * HOUR);
    assert.equal(refreshMsFor({ market_class: 'furniture', item_type: 'sofa' }), Math.min(168 * HOUR, MARKET_POOL_MS));
    assert.equal(refreshClassOf({ item_type: 'smartphone' }), REFRESH_CLASS.FAST);
    assert.equal(isDue(identity, NOW - 23 * HOUR, { now: NOW }), true);
    assert.equal(isDue(identity, NOW - 10 * HOUR, { now: NOW }), false);
    assert.equal(isDue({ market_class: 'furniture' }, NOW - 48 * HOUR, { now: NOW }), false);
    assert.equal(isDue(identity, null, { now: NOW }), true);
  });
});

describe('MI-4 structured data', () => {
  const html = `<html><script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Product","name":"PlayStation 5 Slim","brand":{"@type":"Brand","name":"Sony"},"sku":"CFI-2016","offers":{"@type":"Offer","price":"2,199.00","priceCurrency":"ils","itemCondition":"https://schema.org/NewCondition","availability":"https://schema.org/InStock"}}]}</script>
  <script type="application/ld+json">{ broken json </script></html>`;
  test('MI-4a JSON-LD Product/Offer is read field by field; missing fields are null; broken blocks are skipped', () => {
    const [p] = extractProducts(html);
    assert.deepEqual([p.name, p.brand, p.sku, p.model], ['PlayStation 5 Slim', 'Sony', 'CFI-2016', null]);
    assert.deepEqual(p.offers[0], { price: 2199, currency: 'ILS', condition: 'new_sealed', availability: 'in_stock', seller: null, valid_from: null, url: null });
  });
  test('MI-4b the permitted entry point refuses every source without retrieval permission', () => {
    assert.throws(() => extractFromPermittedSource('https://ksp.co.il/web/item/1', html), /source_not_authorized:ksp:unknown/);
    assert.equal(extractFromPermittedSource('https://www.ebay.com/itm/1', html).products.length, 1);
  });
});

describe('MI-5 product keys', () => {
  test('MI-5a the same product phrased differently (Hebrew name, aliases) shares one product key, though its research key differs', async () => {
    const other = normalizeIdentity({ ...RAW_IDENTITY, search: { hebrew_name: 'עכבר לוג׳יטק סופרלייט', aliases: ['Superlight'], model_numbers: [] } });
    assert.notEqual(researchKey(identity), researchKey(other));
    assert.equal((await productKeyOf(identity)).key, (await productKeyOf(other)).key);
  });
  test('MI-5b another capacity or generation is another product: its evidence is not shared', async () => {
    const a = normalizeIdentity({ ...RAW_IDENTITY, item_type: 'smartphone', brand: 'Apple', model: 'iPhone 13', canonical_name: 'apple iphone 13', size_or_capacity: '128GB' });
    const b = normalizeIdentity({ ...RAW_IDENTITY, item_type: 'smartphone', brand: 'Apple', model: 'iPhone 13', canonical_name: 'apple iphone 13', size_or_capacity: '256GB' });
    const c = normalizeIdentity({ ...RAW_IDENTITY, item_type: 'smartphone', brand: 'Apple', model: 'iPhone 14', canonical_name: 'apple iphone 14', size_or_capacity: '128GB' });
    const keys = await Promise.all([a, b, c].map(async (i) => (await productKeyOf(i)).key));
    assert.equal(new Set(keys).size, 3);
  });
  test('MI-5c no database: the index reads nothing and writes nothing, and never throws', async () => {
    assert.deepEqual((await loadIndexed(identity, null, { supa: null, rulesVersion: 4 })).rows, []);
    assert.equal((await saveIndexed(identity, null, [ref(1, 300)], { supa: null, rulesVersion: 4 })).stored, 0);
    const failing = { from: () => { throw new Error('boom'); }, rpc: async () => ({ error: { message: 'missing' } }) };
    assert.equal((await loadIndexed(identity, null, { supa: failing, rulesVersion: 4 })).error, 'boom');
    assert.equal((await saveIndexed(identity, null, [ref(1, 300)], { supa: failing, rulesVersion: 4, seenAt: NOW })).stored, 0);
  });
});

// ── THE SCAN OVER THE INDEX ─────────────────────────────────────────────────
const row = (r, seenAgoMs) => ({ fingerprint: fingerprintOf(r), source_id: 'homeless', permission: 'public_research_only', segment: 'private_asking', market: 'IL', title: r.title, price: r.price, currency: 'ILS',
  archived: false, rules_version: RESEARCH_VERSION, retain_until: new Date(NOW + 5 * 86_400_000).toISOString(), last_seen_at: new Date(NOW - seenAgoMs).toISOString(), reference: r });
function fakeIndex(rows = []) {
  return { saved: [], load: async () => ({ rows, ms: 3, error: null }), save: async function (_i, _a, refs) { this.saved.push(refs); return { stored: refs.length, refused: {} }; } };
}
const emptyStore = () => ({ load: async () => null, save: async () => {} });
const price = (index, fetchImpl, extra = {}) => runPrice({ identity, model: 'm', apiKey: 'k', fetchImpl, store: emptyStore(), index, scanUuid: '11111111-2222-3333-4444-555555555555', now: () => NOW, marketplace: async () => [], background: () => {}, ...extra });

beforeEach(() => { resetMarketCache(); resetFxCache(); });

describe('MI-6 fast path and research fallback', () => {
  test('MI-6a FAST PATH: current indexed Israeli evidence strong enough to price prices with NO search, and says it came from the index', async () => {
    const index = fakeIndex([row(ref(1, 300), 2 * HOUR), row(ref(2, 320), 3 * HOUR), row(ref(3, 310), 4 * HOUR), row(ref(4, 290), 5 * HOUR)]);
    const fetchImpl = fakeProvider();
    const r = await price(index, fetchImpl);
    assert.equal(r.status, 'priced');
    assert.equal(r.indexed, true);
    assert.equal(r.index.used, 'priced');
    assert.equal(fetchImpl.of('market').length, 0, 'no search');
    assert.equal(r.valuation.searched.at, new Date(NOW - 2 * HOUR).toISOString(), 'the answer says when its prices were last seen');
  });
  test('MI-6b evidence older than the item\'s refresh interval does not skip the search; it joins the new search\'s pool', async () => {
    const index = fakeIndex([row(ref(1, 300), 30 * HOUR), row(ref(2, 320), 30 * HOUR), row(ref(3, 310), 30 * HOUR)]);
    const fetchImpl = fakeProvider();
    const r = await price(index, fetchImpl);
    assert.ok(fetchImpl.of('market').length >= 1, 'searched');
    assert.equal(r.index.used, 'pool');
    assert.ok(r.valuation.evidence.some((e) => e.url.includes('viewad,1.aspx')), 'indexed evidence joined the pool');
    assert.equal(index.saved.length, 1, 'the new research was indexed');
  });
  test('MI-6c too little indexed evidence never stands in for a search (no stale-while-revalidate on the index alone)', async () => {
    const index = fakeIndex([row(ref(1, 300), 1 * HOUR)]);
    const fetchImpl = fakeProvider();
    const r = await price(index, fetchImpl);
    assert.ok(fetchImpl.of('market').length >= 1);
    assert.equal(r.stale ?? false, false);
    assert.equal(r.reused, false);
  });
  test('MI-6d new-retail-only evidence in the index never prices a used item without a search', async () => {
    const shop = (n, p) => ref(n, p, { url: `https://www.ksp.co.il/web/item/${n}`, domain: 'ksp.co.il', kind: 'new_retail', condition: 'new_sealed', page: 'shop_product' });
    const index = fakeIndex([1, 2, 3, 4].map((n) => ({ ...row(shop(n, 600), HOUR), source_id: 'ksp', segment: 'new_retail' })));
    const fetchImpl = fakeProvider();
    await price(index, fetchImpl);
    assert.ok(fetchImpl.of('market').length >= 1);
  });
  test('MI-6e a Yad2 price in a search result is not used, and is counted', async () => {
    const yad2 = { url: 'https://www.yad2.co.il/item/abc123', title: 'Logitech G Pro X Superlight', price: 150, currency: 'ILS', kind: 'used_listing', match: 'exact', market: 'IL', condition: 'good', page: 'listing', listed: null, stock: 'unknown', shipping: null };
    const market = { evidence: [...RAW_MARKET.evidence, yad2] };
    const fetchImpl = fakeProvider({ markets: [market], reached: [...RAW_MARKET.evidence.map((e) => e.url), yad2.url] });
    const r = await price(fakeIndex(), fetchImpl);
    assert.ok(!r.valuation.evidence.some((e) => /yad2/.test(e.url)));
    assert.equal(r.valuation.searched.source_not_authorized, 1);
  });
  test('MI-6f the index record keeps the newest sighting first and reads it by today\'s rules', () => {
    const rec = indexRecord([row(ref(1, 300), 5 * HOUR), row(ref(2, 320), HOUR)], today);
    assert.equal(rec.at, NOW - HOUR);
    assert.equal(rec.evidence[0].price, 320);
    assert.deepEqual(rec.searched.stages, ['index']);
    assert.equal(indexRecord([], today), null);
  });
});

describe('MI-7 scheduled refresh', () => {
  test('MI-7a prewarm renews a product on its kind\'s interval: phones a day, appliances three days, furniture a week', async () => {
    const { refreshAfterFor, REFRESH_AFTER_MS } = await import('../api/_lib/scan/prewarm.js');
    assert.equal(refreshAfterFor(identity), REFRESH_AFTER_MS);
    assert.equal(refreshAfterFor({ market_class: 'household' }), 68 * HOUR);
    assert.equal(refreshAfterFor({ market_class: 'furniture' }), 164 * HOUR);
  });
  test('MI-7b every cron run purges expired observations first, even when the research job is disabled', async () => {
    const { createPrewarmHandler } = await import('../api/prewarm.js');
    let purged = 0;
    const handler = createPrewarmHandler({ env: { CRON_SECRET: 's'.repeat(32) }, supa: () => ({}), purge: async () => { purged += 1; return 3; } });
    const res = { statusCode: 0, body: null, setHeader() {}, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, end(b) { this.body = b; return this; } };
    await handler({ method: 'GET', headers: { authorization: `Bearer ${'s'.repeat(32)}` } }, res);
    assert.equal(purged, 1);
  });
});

describe('MI-8 Hebrew brand + short model word (Xiaomi scooter, 2026-11-13)', () => {
  const scooter = () => normalizeIdentity({ ...RAW_IDENTITY, category: 'Sports', item_type: 'electric scooter', brand: 'Xiaomi', product_family: 'Mi Electric Scooter', model: 'Mi Electric Scooter Pro 2', canonical_name: 'xiaomi mi electric scooter pro 2', display_name: 'Xiaomi Mi Electric Scooter Pro 2', search: { hebrew_name: 'קורקינט חשמלי שיאומי פרו 2', aliases: [], model_numbers: [] } });
  const page = (t) => ({ type: 'listing', title: `${t} למכירה באלעד`, text: `# ${t} למכירה באלעד\n\n600 ₪\n\n## פריט\n\n${t}\n\n### מחיר: \n\n600` });
  test('MI-8a the ad written in Hebrew ("שיאומי פרו 2", ₪600 beside it) is tied to the product', async () => {
    const { bindPrice } = await import('../api/_lib/scan/binding.js');
    assert.equal(bindPrice({ price: 600, currency: 'ILS', title: 'קורקינט חשמלי שיאומי פרו 2', match: 'exact' }, page('קורקינט חשמלי שיאומי פרו 2'), scooter()).level, 'strong');
  });
  test('MI-8b another generation, a missing number or another brand is NOT tied', async () => {
    const { bindPrice } = await import('../api/_lib/scan/binding.js');
    for (const t of ['קורקינט חשמלי שיאומי פרו 3', 'קורקינט חשמלי שיאומי פרו', 'קורקינט חשמלי סגווי פרו 2']) {
      assert.notEqual(bindPrice({ price: 600, currency: 'ILS', title: t, match: 'exact' }, page(t), scooter()).level, 'strong', t);
    }
  });
});

describe('MI-9 restricted sources', () => {
  test('MI-9a an eBay price seen in a web search is kept only for the research window, never as history', () => {
    assert.equal(mayKeepHistory(sourceOf('https://www.ebay.com/itm/1')), false);
    assert.equal(retentionMs(sourceOf('https://www.ebay.com/itm/1'), MARKET_POOL_MS), MARKET_POOL_MS);
  });
});
