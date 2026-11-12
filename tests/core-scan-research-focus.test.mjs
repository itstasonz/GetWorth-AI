// RF — Phase 2 research focus (Production scan b4254487, Sony DualSense, 2026-11-10).
// That scan's research ran 13 queries over 73 pages; 24 were Reddit threads and 10 gaming news/review articles, reached
// by two open English queries ("… used second hand Israel", "… used sold price"). ~85% of its 29,703 input tokens were
// search results. Two of its five references were DualSense EDGE listings — another product.
// These suites pin: the queries stay on Israeli boards and published sold prices; the research prompt skips non-listing
// pages and treats an edition word as another product; binding demotes an "exact" Edge row; and the evidence rules are
// unchanged — the scan's own references still give no price.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildSearchQueries, buildMarketPrompt, MAX_QUERIES } from '../api/_lib/scan/market.js';
import { bindPrice, BIND_REASON } from '../api/_lib/scan/binding.js';
import { buildValuation } from '../api/_lib/scan/valuation.js';
import { normalizeIdentity } from '../api/_lib/scan/identify.js';
import { RAW_IDENTITY } from './helpers/core-scan-fakes.mjs';

const identity = (over) => normalizeIdentity({ ...RAW_IDENTITY, visible_text: [], ...over });
// The identity scan b4254487 produced (identity_precision family, medium confidence).
const DUALSENSE = identity({
  category: 'Electronics', item_type: 'game controller', brand: 'Sony', product_family: 'DualSense', model: null, model_number: null,
  exact_model_established: false, identity_confidence: 'medium', alternatives: [],
  display_name: 'Sony DualSense', canonical_name: 'sony dualsense',
  search: { hebrew_name: 'שלט Sony DualSense ל-PS5', aliases: ['PS5 DualSense Wireless Controller'], model_numbers: [] },
});
const HEBREW = /[֐-׿]/;
const openEnglish = (q) => !/site:/.test(q) && !HEBREW.test(q);

describe('RF-1 the queries stay on Israeli boards and published sold prices', () => {
  test('RF-1a local stage: no open English query; every query is Hebrew or scoped to named sites', () => {
    const q = buildSearchQueries({ identity: DUALSENSE });
    assert.ok(q.length > 0 && q.length <= MAX_QUERIES.local);
    assert.deepEqual(q.filter(openEnglish), [], 'an open English query is what reached Reddit and the review sites');
    assert.ok(q.some((s) => /site:homeless\.co\.il OR site:zuzz\.co\.il OR site:ad\.co\.il$/.test(s)));
  });

  test('RF-1b wider stage: sold prices only where they are published; Israel still first', () => {
    const q = buildSearchQueries({ identity: DUALSENSE, stage: 'expand' });
    assert.ok(q.length <= MAX_QUERIES.expand);
    assert.match(q[0], /site:homeless\.co\.il$/);
    assert.ok(q.some((s) => /sold price site:ebay\.com OR site:pricecharting\.com OR site:swappa\.com$/.test(s)));
    assert.ok(!q.some((s) => /used sold price$/.test(s)));
    // The one open English query left is the new price abroad (labelled context; it levels an Israeli price).
    assert.deepEqual(q.filter(openEnglish), ['Sony DualSense new price']);
  });

  test('RF-1c no query names another edition: a DualSense is not searched as an Edge', () => {
    for (const stage of ['local', 'expand']) {
      assert.ok(!buildSearchQueries({ identity: DUALSENSE, stage }).some((s) => /edge|elite/i.test(s)), stage);
    }
  });
});

describe('RF-2 the research prompt', () => {
  test('RF-2a both stages tell the model to skip forum threads, news and reviews', () => {
    for (const stage of ['local', 'expand']) {
      assert.match(buildMarketPrompt({ identity: DUALSENSE, stage, today: '2026-11-10' }), /forum threads.*news.*reviews/s, stage);
    }
  });

  test('RF-2b an edition word is another product: DualSense Edge is sibling_model for a DualSense', () => {
    const p = buildMarketPrompt({ identity: DUALSENSE, today: '2026-11-10' });
    assert.match(p, /A WORD THAT NAMES ANOTHER EDITION IS ANOTHER PRODUCT/);
    assert.match(p, /"DualSense Edge" is not "DualSense"/);
    assert.match(p, /it is sibling_model/);
  });

  test('RF-2c Israeli second-hand stays the goal; abroad stays context', () => {
    const expand = buildMarketPrompt({ identity: DUALSENSE, stage: 'expand', today: '2026-11-10' });
    assert.match(expand, /Prices abroad are context: they never make an Israeli price by themselves/);
  });
});

describe('RF-3 binding: an "exact" claim on an Edge row is a comparable, never this item', () => {
  const claim = (title, price) => ({ price, currency: 'ILS', title, match: 'exact', shipping: null });
  const page = (title) => ({ type: 'listing', title, text: title });

  test('RF-3a "DualSense Edge" beside a standard DualSense → ANOTHER MODEL (sibling_model), whatever the claim (Production 2026-11-12: one ₪600 Edge ad priced a standard DualSense)', () => {
    const t = 'Sony DualSense Edge למכירה ₪600';
    const r = bindPrice(claim(t, 600), page(t), DUALSENSE);
    assert.equal(r.match, 'sibling_model');
    assert.equal(r.reason, BIND_REASON.VARIANT);
    const claimedClose = bindPrice({ ...claim(t, 600), match: 'close_comparable' }, page(t), DUALSENSE);
    assert.equal(claimedClose.match, 'sibling_model', 'called a close comparable by the research, it is still another model');
  });

  test('RF-3b an Xbox Elite controller beside an Xbox controller → another model', () => {
    const xbox = identity({ brand: 'Microsoft', product_family: 'Xbox Wireless Controller', model: 'Xbox Wireless Controller', display_name: 'Microsoft Xbox Wireless Controller', canonical_name: 'microsoft xbox wireless controller', search: { hebrew_name: null, aliases: [], model_numbers: [] } });
    const t = 'Xbox Wireless Controller Elite Series 2 ₪450';
    assert.equal(bindPrice(claim(t, 450), page(t), xbox).match, 'sibling_model');
  });

  test('RF-3c the standard controller itself stays exact; an item that IS an Edge matches an Edge row exactly', () => {
    const t = 'Sony DualSense שלט אלחוטי ₪200';
    assert.equal(bindPrice(claim(t, 200), page(t), DUALSENSE).match, 'exact');
    const edge = identity({ brand: 'Sony', product_family: 'DualSense', model: 'DualSense Edge', display_name: 'Sony DualSense Edge', canonical_name: 'sony dualsense edge', exact_model_established: true, search: { hebrew_name: null, aliases: [], model_numbers: [] } });
    const e = 'Sony DualSense Edge ₪600';
    assert.equal(bindPrice(claim(e, 600), page(e), edge).match, 'exact');
  });
});

describe('RF-4 the evidence rules are unchanged: scan b4254487\'s own references still give no price', () => {
  // The five references exactly as Production recorded them (core_scan_market row, 2026-11-10 17:15:17 UTC).
  const EVIDENCE = [
    { archived: false, binding: 'strong', binding_reason: 'product_and_price_are_one_listing', condition: 'unknown', currency: 'ILS', domain: 'm.homeless.co.il', kind: 'used_listing', listed: '2026-10-11', market: 'IL', match: 'close_comparable', page: 'listing', price: 600, price_ils: 600, seen: '2026-11-10', shipping: null, shipping_ils: null, stock: 'unknown', title: 'שלט לסוני DualSense edge למכירה בתל אביב', url: 'https://m.homeless.co.il/yad2/viewad%2C1101657.aspx' },
    { archived: false, binding: 'weak', binding_reason: 'product_not_named_beside_the_price', condition: 'unknown', currency: 'ILS', domain: 'homeless.co.il', kind: 'used_listing', listed: '2026-10-30', market: 'IL', match: 'close_comparable', page: 'search_or_category', price: 600, price_ils: 600, seen: '2026-11-10', shipping: null, shipping_ils: null, stock: 'unknown', title: 'משחקים וקונסולות יד שניה בתל אביב והמרכז', url: 'https://www.homeless.co.il/yad2/inumber3%3D152%24%24inumber1%3D1' },
    { archived: false, binding: 'strong', binding_reason: 'product_and_price_are_one_listing', condition: 'new_sealed', currency: 'ILS', domain: 'zipzap.co.il', kind: 'new_retail', listed: null, market: 'IL', match: 'close_comparable', page: 'shop_product', price: 229, price_ils: 229, seen: '2026-11-10', shipping: null, shipping_ils: null, stock: 'unknown', title: 'לקנות בקר אלחוטי Sony PlayStation 5 DualSense Wireless Controller בצבע', url: 'https://zipzap.co.il/product/x/' },
    { archived: false, binding: 'strong', binding_reason: 'product_and_price_are_one_listing', condition: 'good', currency: 'USD', domain: 'pricecharting.com', kind: 'sold', listed: null, market: 'INTL', match: 'close_comparable', page: 'price_guide', price: 34.99, price_ils: 111, seen: '2026-11-10', shipping: null, shipping_ils: null, stock: 'unknown', title: 'Used Sony Playstation 5 Dualsense Wireless Controller - White [eBay]', url: 'https://www.pricecharting.com/game/playstation-5/playstation-5-dualsense-wireless-controller' },
    { archived: false, binding: 'weak', binding_reason: 'product_not_named_beside_the_price', condition: 'like_new', currency: 'ILS', domain: 'player1.co.il', kind: 'refurbished', listed: null, market: 'IL', match: 'close_comparable', page: 'shop_product', price: 499, price_ils: 499, seen: '2026-11-10', shipping: null, shipping_ils: null, stock: 'unknown', title: 'DUALSENSE EDGE MIDNIGHT BLACK בקר מקצועי - יד שניה!', url: 'https://player1.co.il/dualsense-edge-midnight-black' },
  ];

  test('RF-4a replayed through the valuation: no price, the same reason Production gave', () => {
    const v = buildValuation({ evidence: EVIDENCE, today: '2026-11-10', familyLevel: true });
    assert.equal(v.status, 'insufficient_evidence');
    assert.equal(v.withdrawn, 'no_verified_israeli_second_hand_reference');
  });

  test('RF-4b an Edge listing classified as another product never becomes this item\'s Israeli used price', () => {
    const edgeAsSibling = EVIDENCE.map((e) => (/edge/i.test(e.title) ? { ...e, match: 'sibling_model' } : e));
    const v = buildValuation({ evidence: edgeAsSibling, today: '2026-11-10', familyLevel: true });
    assert.equal(v.status, 'insufficient_evidence');
  });
});

describe('RF-3S a description or a frame size after the name is not another model (2026-11-12)', () => {
  const claim = (title, price) => ({ price, currency: 'ILS', title, match: 'exact', shipping: null });
  const page = (title) => ({ type: 'listing', title, text: title });
  test('RF-3Sa "Canon 5D Mark III Digital" and a bike "XS" stay comparables; "Pro" after the name is another model', () => {
    const camera = identity({ brand: 'Canon', product_family: 'EOS', model: 'EOS 5D Mark III', display_name: 'Canon EOS 5D Mark III', canonical_name: 'canon eos 5d mark iii', item_type: 'DSLR camera body', search: { hebrew_name: null, aliases: [], model_numbers: [] } });
    const t = 'Canon Eos 5D Mark III Digital למכירה ₪2,000';
    assert.notEqual(bindPrice(claim(t, 2000), page(t), camera).match, 'sibling_model');
    const pro = 'Sony DualSense Pro ₪600';
    assert.equal(bindPrice(claim(pro, 600), page(pro), DUALSENSE).match, 'sibling_model');
  });
});
