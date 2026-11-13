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

describe('MI-10 a decade is a model', () => {
  test('MI-10a a "Classic Vibe 60s" ad is another model for a Classic Vibe \'50s Stratocaster; a 50s ad is the item', async () => {
    const { bindPrice } = await import('../api/_lib/scan/binding.js');
    const strat = normalizeIdentity({ ...RAW_IDENTITY, category: 'Music', item_type: 'electric guitar', brand: 'Squier', product_family: 'Classic Vibe', model: "Classic Vibe '50s Stratocaster", canonical_name: 'squier classic vibe 50s stratocaster', display_name: "Squier Classic Vibe '50s Stratocaster", search: { hebrew_name: 'גיטרה חשמלית סקוויר', aliases: ['Classic Vibe'], model_numbers: [] } });
    const page = (t) => ({ type: 'listing', title: t, text: `${t} ₪1700` });
    assert.notEqual(bindPrice({ price: 1700, currency: 'ILS', title: 'Squier Classic Vibe 60s', match: 'close_comparable' }, page('חשמלית Squier Classic Vibe 60s למכירה'), strat).match, 'close_comparable');
  });
});

describe('MI-11 a confirmed model names the item', () => {
  test('MI-11a "Apple iPhone 12 או 12 mini" becomes "Apple iPhone 12" once the owner chose iPhone 12; a plain name containing it stays', async () => {
    const { applyConfirmed } = await import('../api/_lib/scan/confirmed.js');
    const a = { brand: 'Apple', display_name: 'Apple iPhone 12 או 12 mini', attributes: [], alternatives: [{ name: 'iPhone 12 mini' }], confirmed: [{ attribute: 'model', value: 'iPhone 12' }] };
    applyConfirmed(a);
    assert.equal(a.display_name, 'Apple iPhone 12');
    const b = { brand: 'Apple', display_name: 'Apple iPhone 12 (blue)', attributes: [], alternatives: [], confirmed: [{ attribute: 'model', value: 'iPhone 12' }] };
    applyConfirmed(b);
    assert.equal(b.display_name, 'Apple iPhone 12 (blue)');
    const c = { brand: 'Apple', display_name: 'Apple iPhone 12 / 12 mini', attributes: [], alternatives: [], confirmed: [{ attribute: 'model', value: 'iPhone 12 mini' }] };
    applyConfirmed(c);
    assert.equal(c.display_name, 'Apple iPhone 12 mini');
  });
});

describe('MI-12 the saved valuation keeps the worth the person saw', () => {
  test('MI-12a price_mid is the estimated worth, not the middle of the range', async () => {
    const { buildValuationRow } = await import('../api/_lib/scan/persist.js');
    const valuation = { status: 'priced', prices: { good: { low: 870, high: 1300, worth: 950, list: 1300, quick: 870 } } };
    const row = buildValuationRow({ id: 'x', userId: 'u', scanUuid: 's', identity: { display_name: 'iPhone 12' }, valuation, lang: 'he' });
    assert.deepEqual([row.price_low, row.price_mid, row.price_high], [870, 950, 1300]);
  });
});

describe('MI-13 images become files without the network', () => {
  test('MI-13a a data: URL decodes to the same bytes and type', async () => {
    const { dataUrlToBlob } = await import('../src/lib/utils.js');
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    const blob = dataUrlToBlob(`data:image/jpeg;base64,${bytes.toString('base64')}`);
    assert.equal(blob.type, 'image/jpeg');
    assert.deepEqual(Buffer.from(await blob.arrayBuffer()), bytes);
    assert.throws(() => dataUrlToBlob('https://example.com/a.jpg'));
  });
  test('MI-13b nothing in the app fetches a data: URL (the CSP connect-src refuses it in Production)', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../src/contexts/AppContext.jsx', import.meta.url), 'utf8');
    assert.doesNotMatch(src, /await fetch\((img|compressed|dataUrl)\)/);
  });
});

describe('MI-14 the listing text follows the confirmed model', () => {
  test('MI-14a a sentence naming the other candidate, or doubting the model, is dropped; the rest stays', async () => {
    const { applyConfirmed, withoutOtherModels } = await import('../api/_lib/scan/confirmed.js');
    const a = { brand: 'Apple', display_name: 'Apple iPhone 12 או 12 mini', listing_description: 'מכשיר Apple iPhone כחול עם שתי מצלמות אחוריות. נראה מדגמי iPhone 12 או iPhone 12 mini.', attributes: [], alternatives: [{ name: 'iPhone 12 mini' }], confirmed: [{ attribute: 'model', value: 'iPhone 12' }] };
    applyConfirmed(a);
    assert.equal(a.listing_description, 'מכשיר Apple iPhone כחול עם שתי מצלמות אחוריות.');
    assert.equal(withoutOtherModels('Blue phone, light scratches. The exact model could be a 12 or a 12 mini.', 'iPhone 12', []), 'Blue phone, light scratches.');
    assert.equal(withoutOtherModels('Silver laptop in good shape.', 'MacBook Air M1', [{ name: 'MacBook Air M2' }]), 'Silver laptop in good shape.');
  });
});

describe('MI-15 a confirmed series names the product', () => {
  test('MI-15a "Apple Watch" confirmed as Series 4 is "Apple Watch Series 4"; a name that already has it is kept', async () => {
    const { applyConfirmed } = await import('../api/_lib/scan/confirmed.js');
    const w = { brand: 'Apple', product_family: 'Apple Watch', model: null, display_name: 'שעון חכם Apple Watch ללא רצועה', attributes: [], alternatives: [], confirmed: [{ attribute: 'generation', value: 'Series 4' }] };
    applyConfirmed(w);
    assert.equal(w.display_name, 'Apple Watch Series 4');
    const k = { brand: 'Apple', product_family: 'Apple Watch', display_name: 'Apple Watch Series 4', attributes: [], alternatives: [], confirmed: [{ attribute: 'generation', value: 'Series 4' }] };
    applyConfirmed(k);
    assert.equal(k.display_name, 'Apple Watch Series 4');
  });
});

describe('MI-16 the same product in other words reuses its research', () => {
  test('MI-16a research saved for one wording answers a scan whose identity words the product differently', async () => {
    const rows = new Map();
    const s = { load: async (k) => rows.get(k) ?? null, save: async (k, r) => { rows.set(k, r); } };
    const first = await price(fakeIndex(), fakeProvider(), { store: s });
    assert.equal(first.reused, false);
    resetMarketCache();
    const other = normalizeIdentity({ ...RAW_IDENTITY, search: { hebrew_name: 'עכבר לוג׳יטק סופרלייט', aliases: ['Superlight'], model_numbers: [] } });
    const fetchImpl = fakeProvider();
    const again = await runPrice({ identity: other, model: 'm', apiKey: 'k', fetchImpl, store: s, index: fakeIndex(), scanUuid: '11111111-2222-3333-4444-555555555555', now: () => NOW, marketplace: async () => [], background: () => {} });
    assert.equal(again.reused, true);
    assert.equal(fetchImpl.of('market').length, 0, 'no second search');
    assert.equal(again.valuation.prices?.good?.worth, first.valuation.prices?.good?.worth);
  });
});

describe('MI-17 a confirmed generation must be in the row (Apple Watch Series 4, 2026-11-13)', () => {
  const watch = () => normalizeIdentity({ ...RAW_IDENTITY, category: 'Electronics', item_type: 'smartwatch', brand: 'Apple', product_family: 'Apple Watch', model: null, canonical_name: 'apple watch', display_name: 'Apple Watch', exact_model_established: false, search: { hebrew_name: 'שעון אפל ווטש', aliases: [], model_numbers: [] } });
  const confirmed = () => ({ ...watch(), confirmed: [{ attribute: 'generation', value: 'Series 4' }] });
  const page = (t, price) => ({ type: 'search_or_category', title: 'לוח יד שניה', text: `${t} ${price} ש"ח` });
  test('MI-17a "שעוני אפל ווטש ₪1000" is not tied to a confirmed Series 4; "Apple Watch Series 4 40mm" and "אפל ווטש סדרה 4" are', async () => {
    const { bindPrice, isBound } = await import('../api/_lib/scan/binding.js');
    const tied = (t, price, match = 'close_comparable') => isBound({ binding: bindPrice({ price, currency: 'ILS', title: t, match }, page(t, price), confirmed()).level });
    assert.equal(tied('שעוני אפל ווטש', 1000), false);
    assert.equal(bindPrice({ price: 1000, currency: 'ILS', title: 'שעוני אפל ווטש', match: 'close_comparable' }, page('שעוני אפל ווטש', 1000), confirmed()).reason, 'row_does_not_state_the_confirmed_generation');
    assert.equal(tied('Apple Watch Series 4 40mm', 800, 'exact'), true);
    assert.equal(tied('Apple Watch S4 40mm', 800, 'exact'), true);
    assert.equal(tied('אפל ווטש סדרה 4', 800), true);
    assert.equal(tied('Apple Watch Series 40mm', 800), false, '40mm is a size, not the series');
    assert.equal(bindPrice({ price: 1000, currency: 'ILS', title: 'שעוני אפל ווטש', match: 'close_comparable' }, page('שעוני אפל ווטש', 1000), watch()).level !== 'weak', true, 'without a confirmed generation the rule does not apply');
  });
  test('MI-17b refurbished alone never prices: with the generic row refused, the Ivory unit is set aside and there is no price', async () => {
    const { buildValuation } = await import('../api/_lib/scan/valuation.js');
    const ivory = { url: 'https://www.ivory.co.il/catalog.php?id=27338', domain: 'ivory.co.il', title: 'Apple Watch Series 4 GPS 40mm', price: 1699, currency: 'ILS', price_ils: 1699, kind: 'refurbished', match: 'exact', market: 'IL', condition: 'unknown', page: 'shop_product', listed: null, binding: 'strong', seen: today };
    const generic = { url: 'https://m.homeless.co.il/yad2?inumber3=377', domain: 'homeless.co.il', title: 'שעוני אפל ווטש', price: 1000, currency: 'ILS', price_ils: 1000, kind: 'used_listing', match: 'close_comparable', market: 'IL', condition: 'unknown', page: 'search_or_category', listed: null, binding: 'weak', binding_reason: 'row_does_not_state_the_confirmed_generation', seen: today };
    const v = buildValuation({ evidence: [ivory, generic], today });
    assert.equal(v.status, 'insufficient_evidence');
    assert.equal(v.prices, null);
  });
});

describe('MI-18 price stability comes from pooling, not freezing (iPhone 12, Production 2026-11-13)', () => {
  test('MI-18a two searches of the same product: ₪950 and ₪1,300 alone; pooled, the price rests on all eight ads and lies between', async () => {
    const fs = await import('node:fs');
    const { buildValuation, mergeEvidence, requalify } = await import('../api/_lib/scan/valuation.js');
    const runs = JSON.parse(fs.readFileSync(new URL('./fixtures/iphone12-two-searches-2026-11-13.json', import.meta.url), 'utf8')).map((r) => r.evidence.map(requalify));
    const v = (ev) => buildValuation({ evidence: ev, approximate: true, today: '2026-11-13' });
    const [a, b, pooled] = [v(runs[0]), v(runs[1]), v(mergeEvidence(runs[1], runs[0], 20))];
    assert.deepEqual([a.prices.good.worth, b.prices.good.worth], [950, 1300]);
    assert.ok(pooled.counts.resale > Math.max(a.counts.resale, b.counts.resale), 'the pool holds more ads than either search');
    assert.ok(pooled.prices.good.worth >= a.prices.good.worth && pooled.prices.good.worth <= b.prices.good.worth, `pooled ${pooled.prices.good.worth}`);
    assert.equal(pooled.price_confidence, 'low', 'pooling does not invent confidence: storage is still unknown');
  });
});

describe('MI-19 the founder\'s DualSense (Production scan dcb5196d, 2026-11-13)', () => {
  // The identity as the scan produced it, with the Hebrew seller alias the prompt now asks for.
  const dualsense = (aliases = ['PS5 controller', 'שלט פלייסטיישן 5']) => normalizeIdentity({ ...RAW_IDENTITY, category: 'Electronics', item_type: 'game controller', brand: 'Sony', product_family: 'DualSense', model: 'DualSense Wireless Controller', canonical_name: 'sony dualsense wireless controller', display_name: 'Sony DualSense Wireless Controller', color: 'green and black', search: { hebrew_name: 'שלט דואלסנס לפלייסטיישן 5', aliases, model_numbers: [] } });
  const homeless = (t, price) => ({ type: 'listing', title: `${t} למכירה בבאר שבע ${price} ש"ח`, text: `# ${t} למכירה בבאר שבע\n\n${price} ₪\n\n## פריט\n\n${t}\n\n### מחיר: \n\n${price}` });
  const bind = async (t, price, id, match = 'exact') => { const { bindPrice } = await import('../api/_lib/scan/binding.js'); return bindPrice({ price, currency: 'ILS', title: t, match }, homeless(t, price), id); };
  test('MI-19a the Homeless ad "שלט פליסטישן סוני 5 שחור ₪270" (misspelt, brand inside the name) is tied to the DualSense through its Hebrew seller alias', async () => {
    const r = await bind('שלט פליסטישן סוני 5 שחור', 270, dualsense());
    assert.equal(r.level, 'strong', JSON.stringify(r));
    assert.notEqual((await bind('שלט פליסטישן סוני 5 שחור', 270, dualsense(['PS5 controller']))).level, 'strong', 'without the Hebrew alias it was never tied: the scan\'s failure');
  });
  test('MI-19b another model is never the DualSense: Edge, a PS4 controller, a controller "for" PS5', async () => {
    const edge = await bind('שלט פלייסטיישן 5 אדג', 600, dualsense());
    assert.equal(edge.match, 'sibling_model');
    assert.notEqual((await bind('שלט פלייסטיישן 4 שחור', 120, dualsense())).level, 'strong');
    assert.notEqual((await bind('שלט אלחוטי לפלייסטיישן 5', 90, dualsense())).level, 'strong');
  });
  test('MI-19c a short Hebrew word is not read by its consonants alone', async () => {
    const { bindPrice } = await import('../api/_lib/scan/binding.js');
    const id = dualsense(['שלט פלייסטיישן 5']);
    assert.notEqual(bindPrice({ price: 100, currency: 'ILS', title: 'שולט פלייסטיישן 5', match: 'exact' }, homeless('שולט פלייסטיישן 5', 100), id).level, 'strong', '"שולט" (3 consonants) is not "שלט"');
  });
});

describe('MI-20 a modified unit is priced as a standard unit, and says so', () => {
  test('MI-20a a confirmed custom shell marks the market price as a standard unit\'s; "original" does not; the draft starts with no price', async () => {
    const { unitModification, buildListingDraft } = await import('../src/lib/coreScan.js');
    const custom = { confirmed: [{ attribute: 'original or custom shell', value: 'Custom replacement shell' }] };
    assert.equal(unitModification(custom).value, 'Custom replacement shell');
    assert.equal(unitModification({ confirmed: [{ attribute: 'original or custom shell', value: 'Original Sony shell' }] }), null);
    assert.equal(unitModification({ confirmed: [{ attribute: 'original or custom shell', value: 'Custom replacement shell', unsure: true }] }), null);
    const valuation = { status: 'priced', prices: { good: { low: 150, high: 230, worth: 190, list: 230, quick: 150 } } };
    assert.equal(buildListingDraft({ identity: { display_name: 'Sony DualSense', ...custom }, valuation, condition: 'good' }).price, '');
    assert.equal(buildListingDraft({ identity: { display_name: 'Sony DualSense' }, valuation, condition: 'good' }).price, 230);
  });
});

describe('MI-21 the Hebrew seller name with a number names the product', () => {
  const id = (hebrew, exact = true) => normalizeIdentity({ ...RAW_IDENTITY, category: 'Electronics', item_type: 'game controller', brand: 'Sony', product_family: 'DualSense', model: 'DualSense', canonical_name: 'sony dualsense', display_name: 'Sony DualSense', exact_model_established: exact, search: { hebrew_name: hebrew, aliases: ['שלט PS5'], model_numbers: [] } });
  test('MI-21a the scan of 13:14: hebrew_name "שלט פלייסטיישן 5" ties the Homeless ad and is searched as written', async () => {
    const { bindPrice } = await import('../api/_lib/scan/binding.js');
    const { buildSearchQueries } = await import('../api/_lib/scan/market.js');
    const t = 'שלט פליסטישן סוני 5 ש"חור';
    const page = { type: 'listing', title: `${t} למכירה בבאר שבע 270 ש"ח`, text: `# ${t} למכירה בבאר שבע\n\n270 ₪\n\n## פריט\n\n${t}\n\n### מחיר: \n\n270` };
    assert.equal(bindPrice({ price: 270, currency: 'ILS', title: t, match: 'exact' }, page, id('שלט פלייסטיישן 5')).level, 'strong');
    assert.ok(buildSearchQueries({ identity: id('שלט פלייסטיישן 5'), stage: 'local' }).includes('שלט פלייסטיישן 5 יד שנייה'));
    assert.ok(!buildSearchQueries({ identity: id('שלט פלייסטיישן 5'), stage: 'local' }).some((q) => /שלט פלייסטיישן 5 DualSense/.test(q)));
  });
  test('MI-21b without an established model, or without a number, the Hebrew name is not enough', async () => {
    const { hebrewNamesProduct } = await import('../api/_lib/scan/strategy.js');
    assert.equal(hebrewNamesProduct(id('שלט פלייסטיישן 5', false)), false);
    assert.equal(hebrewNamesProduct(id('שלט סוני')), false);
    assert.equal(hebrewNamesProduct(id('שלט פלייסטיישן 5')), true);
  });
});

describe('MI-22 a new price is never a stray number (DualSense "new ₪30", 2026-11-13)', () => {
  const shop = (price, extra = {}) => ({ url: `https://www.shop${price}.co.il/p`, domain: `shop${price}.co.il`, title: 'Sony DualSense', price, currency: 'ILS', price_ils: price, kind: 'new_retail', match: 'exact', market: 'IL', condition: 'new_sealed', page: 'shop_product', listed: null, binding: 'strong', stock: 'in_stock', seen: today, ...extra });
  test('MI-22a ₪29 beside a ₪279 shop is not the new price; beside a $30 used guide neither', async () => {
    const { buildValuation } = await import('../api/_lib/scan/valuation.js');
    assert.equal(buildValuation({ evidence: [shop(29), shop(279)], today }).retail_new_ils, 280);
    const guide = { url: 'https://www.pricecharting.com/game/x', domain: 'pricecharting.com', title: 'DualSense', price: 30, currency: 'USD', price_ils: 96, kind: 'price_guide', match: 'exact', market: 'INTL', condition: 'unknown', page: 'price_guide', binding: 'weak', seen: today };
    assert.equal(buildValuation({ evidence: [shop(29), guide], today }).retail_new_ils, null);
    assert.equal(buildValuation({ evidence: [shop(279)], today }).retail_new_ils, 280, 'a real new price stands');
  });
  test('MI-22b loyalty points and monthly instalments are not the price', async () => {
    const { bindPrice } = await import('../api/_lib/scan/binding.js');
    const id = normalizeIdentity({ ...RAW_IDENTITY, brand: 'Sony', product_family: 'DualSense', model: 'DualSense', canonical_name: 'sony dualsense', display_name: 'Sony DualSense' });
    const page = (text) => ({ type: 'shop_product', title: 'בקר Sony DualSense Midnight Black', text });
    assert.notEqual(bindPrice({ price: 29, currency: 'ILS', title: 'Sony DualSense', match: 'exact' }, page('בקר Sony DualSense Midnight Black 36 תשלומים של ₪29'), id).level, 'strong');
    assert.notEqual(bindPrice({ price: 299, currency: 'ILS', title: 'Sony DualSense', match: 'exact' }, page('בקר Sony DualSense Midnight Black ₪275 מימוש: 299 נקודות'), id).level, 'strong');
    assert.equal(bindPrice({ price: 275, currency: 'ILS', title: 'Sony DualSense', match: 'exact' }, page('בקר Sony DualSense Midnight Black ₪275 מימוש: 299 נקודות'), id).level, 'strong');
  });
});
