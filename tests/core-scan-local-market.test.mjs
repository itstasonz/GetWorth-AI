// ══════════════════════════════════════════════════════════════════════════════
// CORE SCAN — AN ISRAELI PRICE RESTS ON ISRAELI EVIDENCE
//
// What decides how much a price found on the web is worth to a second-hand
// valuation in Israel, and where the search looks for it:
//
//   LM-1  where a price is from, what kind of page it was on, and how old the
//         LISTING is — settled from the address and the page, never from the day
//         we looked
//   LM-2  the weighing: local before foreign, fresh before old, agreement before
//         confidence. General rules, tested on made-up items of no category
//   LM-3  the first real Production scan, replayed: the arithmetic that gave ₪90
//         and what the same evidence gives now
//   LM-4  the search: Israel first, further afield only when Israel is thin
//
// Pure functions and fakes. No network, no credit.
//
//   node --test tests/core-scan-local-market.test.mjs
// ══════════════════════════════════════════════════════════════════════════════
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildValuation, normalizeReferences, aggregate, weightedQuantile, localStrength, verifyEvidence, requalify,
  WEIGHT, LOCAL_STRENGTH, DISPERSION, SET_ASIDE, BASIS, NEGOTIATION,
} from '../api/_lib/scan/valuation.js';
import { localityOf, pageTypeOf, listedDate, freshnessOf, isArchived, FRESHNESS_DAYS } from '../api/_lib/scan/evidence.js';
import { buildMarketPrompt, MARKET_STAGES } from '../api/_lib/scan/market.js';
import { runPrice, resetMarketCache, SCAN_STATUS } from '../api/_lib/scan/service.js';
import { normalizeIdentity } from '../api/_lib/scan/identify.js';
import { resetFxCache, parseBoiRates } from '../api/_lib/scan/fx.js';
import { extractSearchProvenance } from '../api/_lib/phaseb/search-provenance.js';
import * as CFG from '../api/_lib/scan/config.js';
import { RAW_IDENTITY, RAW_MARKET, RAW_EXPAND, PAGE_TEXT, SOURCES, TODAY, NOW, BOI_JSON, searchItems, fakeProvider } from './helpers/core-scan-fakes.mjs';

// Listing dates, each a class of age on TODAY (2026-10-06).
const CURRENT = '2026-09-20';
const RECENT = '2026-06-01';
const OLDER = '2025-06-01';
const ARCHIVED = '2023-01-01';

let serial = 0;
/** A verified reference as the pool holds it: by default an Israeli used listing for the exact item, with no date on it. */
const item = (over = {}) => { serial += 1; return { url: `https://ex.example.co.il/ad/${serial}`, domain: 'ex.example.co.il', title: 't', price: 300, currency: 'ILS', price_ils: over.price ?? 300, kind: 'used_listing', match: 'exact', market: 'IL', condition: 'good', page: 'listing', listed: null, binding: 'url', seen: TODAY, ...over }; };
const il = (price, over) => item({ price, ...over });
const abroad = (price, over) => item({ price, currency: 'USD', market: 'INTL', domain: 'used.example.com', ...over });
const shop = (price, over) => item({ price, kind: 'new_retail', condition: 'new_sealed', page: 'shop_product', ...over });
const value = (evidence, opts = {}) => buildValuation({ evidence, today: TODAY, ...opts });
const weigh = (evidence, opts = {}) => normalizeReferences(evidence, { today: TODAY, ...opts });
const centre = (evidence) => Math.round(aggregate(weigh(evidence).points.filter((p) => !p.dropped)).centre);
const weightOf = (e, context = []) => weigh([e, ...context]).points[0].weight;
const band = (b) => ({ list: b.list, low: b.low, high: b.high });

describe('LM-1 where a price is from, what page it was on, and how old the listing is', () => {
  test('LM-1a Israel or abroad is read from the address: a global marketplace showing shekels is abroad', () => {
    assert.equal(localityOf('il.ebay.com', 'IL'), 'INTL', 'an Israel-facing storefront of a global marketplace is not an Israeli seller');
    assert.equal(localityOf('ebay.co.uk', 'IL'), 'INTL');
    assert.equal(localityOf('yad2.co.il', 'INTL'), 'IL', 'an .il site is Israel whatever the model called it');
    assert.equal(localityOf('m.homeless.co.il', undefined), 'IL');
    assert.equal(localityOf('shop.example.com', 'IL'), 'IL', 'where the address does not say, the model is believed');
    assert.equal(localityOf('shop.example.com', 'MARS'), 'INTL');
  });
  test('LM-1b a known address shape says whether a page is one listing or a list of many', () => {
    assert.equal(pageTypeOf('https://il.ebay.com/b/Logitech/bn_21829535', 'listing'), 'search_or_category', 'a browse page is a list, whatever the model called it');
    assert.equal(pageTypeOf('https://www.ebay.com/itm/1234567890', 'other'), 'listing');
    assert.equal(pageTypeOf('https://www.ad.co.il/c/23', 'listing'), 'search_or_category');
    assert.equal(pageTypeOf('https://m.homeless.co.il/yad2/viewad%2C994310.aspx', 'other'), 'listing');
    // The shapes each Israeli source was seen to use on the public web.
    const shapes = {
      'https://www.ebay.com/p/24032623131': 'search_or_category',                      // a product page lists many sellers
      'https://www.yad2.co.il/market/item/8948748746812': 'listing',
      'https://www.yad2.co.il/market/collections/electronics_for-laptops-and-computers_computer-accessories?pageNumber=6': 'search_or_category',
      'https://www.yad2.co.il/products/computers-and-accessories?category=6&item=682&type=401&page=3': 'search_or_category',
      'https://market.yad2.co.il/products/irobot-roomba-870': 'listing',               // the same word, a different host, a different thing
      'https://market.yad2.co.il/collections/all': 'search_or_category',
      'https://market.yad2.co.il/search?q=x&type=product': 'search_or_category',
      'https://m.homeless.co.il/yad2/680?highlight_id=830796': 'search_or_category',
      'https://www.ad.co.il/ad/12130905': 'listing',
      'https://www.ad.co.il/archive/c/23?sp169=4614&withprice=1&view=list': 'search_or_category',
      'https://www.facebook.com/marketplace/item/1496525957639509/': 'listing',
      'https://www.facebook.com/marketplace/telaviv/gaming-mouses/': 'search_or_category',
    };
    for (const [url, type] of Object.entries(shapes)) assert.equal(pageTypeOf(url, type === 'listing' ? 'other' : 'listing'), type, url);
    assert.equal(pageTypeOf('https://unknown.example.co.il/x/1', 'listing'), 'listing', 'an unknown site keeps the model\'s classification');
    assert.equal(pageTypeOf('https://unknown.example.co.il/x/1', 'front page'), 'other');
  });
  test('LM-1c a listing date is kept only when the page itself bears it out', () => {
    assert.equal(listedDate('2026-10-01', 'פורסם 01/10/2026', TODAY), '2026-10-01');
    assert.equal(listedDate('2026-10-04', 'Listed Oct 4 · Tel Aviv', TODAY), '2026-10-04');
    assert.equal(listedDate('2026-10-03', 'עודכן לפני 3 ימים', TODAY), '2026-10-03', 'an age in words that comes to the date');
    assert.equal(listedDate('2026-09-22', 'posted 2 weeks ago', TODAY), '2026-09-22');
    assert.equal(listedDate('2026-10-06', 'Posted today', TODAY), '2026-10-06');
    assert.equal(listedDate('2024-10-04', 'מודעה מתאריך 04/10/2024', TODAY), '2024-10-04', 'an old date is kept as old');
    // Never invented.
    assert.equal(listedDate('2026-10-01', '© 2026 all rights reserved', TODAY), null, 'a year alone proves nothing');
    assert.equal(listedDate('2026-10-01', '', TODAY), null, 'no page text, no date');
    assert.equal(listedDate('2026-10-01', undefined, TODAY), null);
    assert.equal(listedDate('2026-08-20', 'עודכן לפני 3 ימים', TODAY), null, 'the page says three days; the claim says seven weeks');
    assert.equal(listedDate('2026-10-06', 'the best price in Israel today', TODAY), null, 'the word "today" in passing is not a posting date');
    assert.equal(listedDate('2024-10-04', '04/10', TODAY), null, 'a day and month with no year cannot vouch for two years ago');
    assert.equal(listedDate('2026-11-01', '01/11/2026', TODAY), null, 'a listing cannot be from the future');
    assert.equal(listedDate('last week', 'last week', TODAY), null);
  });
  test('LM-1d the day we looked never becomes the day it was listed', () => {
    const reached = extractSearchProvenance(searchItems(Object.values(SOURCES), { text: PAGE_TEXT }));
    const fx = parseBoiRates(BOI_JSON);
    const { evidence } = verifyEvidence(RAW_MARKET.evidence, reached, fx, TODAY);
    assert.deepEqual(evidence.map((e) => [e.listed, e.seen]), [['2026-10-01', TODAY], [null, TODAY], [null, TODAY]]);
    // The model reports the day of the search as the listing date: the page says otherwise, so there is no date.
    const lying = RAW_MARKET.evidence.map((e) => ({ ...e, listed: TODAY }));
    assert.deepEqual(verifyEvidence(lying, reached, fx, TODAY).evidence.map((e) => e.listed), [null, null, null]);
    const v = value(evidence);
    assert.deepEqual(v.evidence.filter((e) => e.used).map((e) => e.freshness).sort(), ['current', 'unknown']);
  });
  test('LM-1e a listing\'s age is one of five classes, and with no date it is unknown — never current', () => {
    assert.deepEqual([CURRENT, RECENT, OLDER, ARCHIVED, null, 'soon'].map((d) => freshnessOf(d, TODAY)), ['current', 'recent', 'older', 'archived', 'unknown', 'unknown']);
    assert.equal(freshnessOf('2026-08-22', TODAY), 'current', `${FRESHNESS_DAYS.current} days old is still current`);
    assert.equal(freshnessOf('2026-08-21', TODAY), 'recent');
    assert.equal(freshnessOf(TODAY, '2027-10-06'), 'older', 'kept evidence ages: the same listing a year later is older');
  });
  test('LM-1g an ad its own site files as archive is old, dated or not — and no date is invented for it', () => {
    assert.equal(isArchived('https://www.ad.co.il/archive/c/23', ''), true);
    assert.equal(isArchived('https://www.ad.co.il/ad/12130905', 'זוהי מודעת ארכיון, איננה רלוונטית ונועדה לצרכים סטטיסטיים בלבד'), true);
    assert.equal(isArchived('https://www.ad.co.il/ad/16226497', 'עכבר גיימינג למכירה'), false);
    assert.equal(freshnessOf(null, TODAY, true), 'archived');
    assert.equal(freshnessOf(CURRENT, TODAY, true), 'current', 'a date the page shows still decides');
    const url = 'https://www.ad.co.il/ad/12130905';
    const reached = extractSearchProvenance(searchItems([url], { text: { [url]: 'Logitech G Pro Wireless 400 ש"ח · זוהי מודעת ארכיון' } }));
    const [e] = verifyEvidence([{ ...RAW_MARKET.evidence[1], url, price: 400, listed: null }], reached, parseBoiRates(BOI_JSON), TODAY).evidence;
    assert.deepEqual([e.archived, e.listed, e.seen], [true, null, TODAY]);
    const v = value([e]);
    assert.deepEqual([v.evidence[0].freshness, v.evidence[0].weight, v.local_strength], ['archived', WEIGHT.freshness.archived, 0]);
  });
  test('LM-1f evidence kept from an earlier search is read by today\'s rules', () => {
    const kept = requalify({ url: 'https://il.ebay.com/b/Logitech/bn_21829535', domain: 'il.ebay.com', price: 56, price_ils: 56, kind: 'used_listing', match: 'exact', market: 'IL' });
    assert.deepEqual([kept.market, kept.page, kept.listed, kept.archived, kept.price], ['INTL', 'search_or_category', null, false, 56]);
    assert.deepEqual(requalify(kept), kept, 'and reading it twice changes nothing');
  });
});

describe('LM-2 the weighing: general rules, on items of no category', () => {
  test('LM-2a [1] an Israeli used listing outranks the same listing abroad, and two cheap ones abroad do not outvote it', () => {
    const israeli = il(300, { listed: CURRENT });
    assert.ok(weightOf(il(300, { listed: CURRENT })) > weightOf(abroad(300, { listed: CURRENT })));
    assert.equal(weightOf(il(300, { listed: CURRENT })), WEIGHT.where.IL);
    assert.equal(weightOf(abroad(300, { listed: CURRENT })), WEIGHT.where.INTL);
    assert.equal(centre([israeli, abroad(90, { listed: CURRENT }), abroad(60, { listed: CURRENT })]), 270, '300 less negotiation, not the foreign pair');
    // Brought to Israeli price level a foreign price counts for more, and still for less than an Israeli one.
    const levels = [shop(600), shop(500, { market: 'INTL', currency: 'USD' })];
    assert.equal(weightOf(abroad(300, { listed: CURRENT }), levels), WEIGHT.where.INTL_scaled);
    assert.equal(centre([israeli, abroad(90, { listed: CURRENT }), abroad(60, { listed: CURRENT }), ...levels]), 270);
  });
  test('LM-2b [2] an old archived Israeli listing does not dominate recent evidence from abroad, and never makes Israel "enough"', () => {
    const sale = () => abroad(200, { kind: 'sold', listed: CURRENT });
    assert.ok(weightOf(il(600, { listed: ARCHIVED })) < weightOf(sale()));
    assert.equal(centre([il(600, { listed: ARCHIVED }), sale()]), 200);
    assert.equal(centre([il(600, { listed: ARCHIVED }), il(620, { listed: ARCHIVED }), sale(), sale()]), 200);
    const old = Array.from({ length: 12 }, () => il(600, { listed: ARCHIVED }));
    const v = value([...old, sale()]);
    assert.deepEqual([v.local_drives, v.local_strength, v.counts.abroad_unused], [false, 0, 0], 'twelve old ads are not local strength');
    assert.equal(localStrength(old, { today: TODAY }), 0, 'so the search still looks further');
  });
  test('LM-2c [3] several good Israeli listings establish the price alone; what was found abroad is context, not arithmetic', () => {
    const local = [il(300, { listed: CURRENT }), il(310, { listed: CURRENT }), il(320, { listed: CURRENT })];
    const cheap = [abroad(80, { listed: CURRENT }), abroad(80, { listed: CURRENT }), abroad(85, { kind: 'sold', listed: CURRENT })];
    const v = value([...cheap, ...local]);
    // 270, 279, 288 at equal weight: the centre is 279. Three references: 279 -18% / +9%. Asking price 279 / 0.9.
    assert.deepEqual(band(v.prices.good), { list: 310, low: 230, high: 300 });
    assert.deepEqual([v.local_drives, v.counts.resale, v.counts.il_used_exact, v.counts.intl_used_exact, v.counts.abroad_unused, v.counts.set_aside], [true, 3, 3, 0, 3, 0]);
    assert.deepEqual(v.prices, value(local).prices, 'with or without the foreign prices, the same price');
    assert.deepEqual(v.evidence.filter((e) => e.market === 'INTL').map((e) => [e.used, e.set_aside]), Array(3).fill([false, SET_ASIDE.LOCAL_SUFFICIENT]));
    assert.equal(v.price_confidence, 'high');
    assert.deepEqual(v.reference_range, { low: 300, high: 320 });
  });
  test('LM-2d [3] one Israeli listing is one seller\'s opinion: it leads, it does not price alone, and it is never confident', () => {
    const one = value([il(300, { listed: CURRENT })]);
    assert.deepEqual([one.status, one.local_drives, one.price_confidence], ['priced', false, 'low']);
    assert.ok(localStrength([il(300, { listed: CURRENT })], { today: TODAY }) < LOCAL_STRENGTH.drives, 'one listing never stops the search');
    assert.ok(localStrength([il(300, { listed: CURRENT }), il(310, { listed: CURRENT })], { today: TODAY }) >= LOCAL_STRENGTH.drives, 'two that stand do');
    assert.ok(localStrength([il(300), il(310), il(320)], { today: TODAY }) >= LOCAL_STRENGTH.drives, 'so do three with no date on them');
  });
  test('LM-2e [4] with no Israeli evidence, evidence from abroad prices the item — scaled when it can be, and said to be foreign', () => {
    const sold = [200, 210, 220].map((p) => abroad(p, { kind: 'sold', listed: CURRENT }));
    const levels = [shop(600), shop(500, { market: 'INTL', currency: 'USD' })];
    const scaled = value([...sold, ...levels]);
    // Scale 600 / 500 = 1.2: 240, 252, 264. Centre 252.
    assert.deepEqual([scaled.status, scaled.intl_adjusted, scaled.intl_scale, scaled.price_confidence], ['priced', true, 1.2, 'medium']);
    assert.deepEqual([scaled.counts.il_used_exact + scaled.counts.il_used_close, scaled.counts.intl_used_exact, scaled.local_strength], [0, 3, 0]);
    assert.equal(scaled.prices.good.low < 252 && scaled.prices.good.high > 252, true);
    const unscaled = value(sold);
    assert.deepEqual([unscaled.status, unscaled.intl_adjusted, unscaled.intl_scale, unscaled.price_confidence], ['priced', false, null, 'low'], 'converted, not adjusted: priced, and not trusted');
  });
  test('LM-2f [5] new prices alone are never a second-hand valuation', () => {
    const v = value([shop(600), shop(580, { match: 'close_comparable' }), shop(500, { market: 'INTL', currency: 'USD' })]);
    assert.deepEqual([v.status, v.prices, v.price_confidence, v.counts.resale, v.retail_new_ils], ['insufficient_evidence', null, null, 0, 600]);
  });
  test('LM-2g [6] accessories, parts, empty boxes and bundles never touch the price, at any price', () => {
    const real = () => [il(300, { listed: CURRENT }), il(320, { listed: CURRENT })];
    const junk = ['accessory', 'part', 'box_only', 'bundle', 'irrelevant'].flatMap((match) => [il(5, { match, listed: CURRENT }), il(9000, { match, kind: 'sold', listed: CURRENT })]);
    const v = value([...junk, ...real()]);
    assert.deepEqual(v.prices, value(real()).prices);
    assert.deepEqual([v.counts.resale, v.counts.not_comparable, v.evidence.filter((e) => e.used).length], [2, 10, 2]);
    assert.equal(value(junk).status, 'insufficient_evidence', 'and alone they price nothing');
  });
  test('LM-2h [7] the order the evidence arrives in changes nothing', () => {
    const pool = [
      il(300), il(280, { listed: OLDER }), il(340, { match: 'close_comparable', listed: RECENT }), abroad(200, { kind: 'sold', listed: CURRENT }), abroad(180),
      abroad(150, { page: 'search_or_category' }), shop(600), shop(500, { market: 'INTL', currency: 'USD' }), il(50, { match: 'part' }), il(100, { match: 'sibling_model' }),
    ];
    const facts = (v) => JSON.stringify([v.prices, v.price_confidence, v.counts, v.reference_range, v.dispersion, v.local_strength, v.basis, v.evidence.filter((e) => e.used).map((e) => e.url).sort()]);
    const first = facts(value(pool));
    const orders = [[...pool].reverse(), [...pool.slice(4), ...pool.slice(0, 4)], [3, 9, 0, 7, 5, 1, 8, 2, 6, 4].map((k) => pool[k])];
    for (const order of orders) assert.equal(facts(value(order)), first);
    // A weight that splits exactly between two prices is their midpoint, not whichever sorted first.
    const tie = [{ value: 100, weight: 1, evidence: { url: 'b' } }, { value: 200, weight: 1, evidence: { url: 'a' } }];
    assert.equal(weightedQuantile(tie, 0.5), 150);
    assert.equal(weightedQuantile([...tie].reverse(), 0.5), 150);
  });
  test('LM-2i [8] evidence that disagrees lowers the confidence and widens the range', () => {
    const three = (...prices) => value(prices.map((p) => il(p, { listed: CURRENT })));
    const agree = three(300, 310, 320);
    const apart = three(300, 310, 520);       // 270 … 468: P90 / P10 = 1.73
    const far = three(300, 310, 700);         // 270 … 630: 2.33
    assert.deepEqual([agree.price_confidence, apart.price_confidence, far.price_confidence], ['high', 'medium', 'low']);
    assert.deepEqual([agree.dispersed, apart.dispersed, far.dispersed], [false, false, true]);
    assert.ok(agree.dispersion <= DISPERSION.agrees && apart.dispersion > DISPERSION.agrees && far.dispersion > DISPERSION.dispersed);
    const width = (v) => v.prices.good.high - v.prices.good.low;
    assert.ok(width(far) > width(agree), `${width(far)} > ${width(agree)}`);
    assert.deepEqual(band(far.prices.good), { list: 390, low: 230, high: 390 }, 'the range reaches to where the evidence is');
  });
  test('LM-2j [9] a listing with no date does not pass for a current one', () => {
    assert.equal(weightOf(il(300)), WEIGHT.freshness.unknown);
    assert.ok(weightOf(il(300)) < weightOf(il(300, { listed: RECENT })) && weightOf(il(300, { listed: RECENT })) < weightOf(il(300, { listed: CURRENT })));
    assert.ok(weightOf(il(300)) > weightOf(il(300, { listed: OLDER })) && weightOf(il(300, { listed: OLDER })) > weightOf(il(300, { listed: ARCHIVED })));
    const undated = value([il(300), il(310), il(320)]);
    const dated = value([il(300, { listed: CURRENT }), il(310, { listed: CURRENT }), il(320, { listed: CURRENT })]);
    assert.deepEqual([undated.price_confidence, dated.price_confidence], ['medium', 'high'], 'the same prices, undated, earn less confidence');
    assert.deepEqual(undated.evidence.map((e) => e.freshness), ['unknown', 'unknown', 'unknown']);
  });
  test('LM-2k a price read off a list of many counts for less than one seller\'s own listing; a completed sale for more than an asking price', () => {
    assert.ok(weightOf(il(300, { page: 'search_or_category' })) < weightOf(il(300)));
    assert.ok(weightOf(il(300, { kind: 'sold' })) > weightOf(il(300)));
    assert.ok(weightOf(il(300, { match: 'close_comparable' })) < weightOf(il(300)));
    const asking = weigh([il(500)]).points[0];
    const sold = weigh([il(500, { kind: 'sold' })]).points[0];
    assert.deepEqual([asking.value, sold.value], [500 * NEGOTIATION, 500], 'the negotiation allowance is taken off asking prices only');
  });
  test('LM-2l [11] condition prices are the same ladder every time, from the same evidence', () => {
    const e = [il(300, { listed: CURRENT }), il(310, { listed: CURRENT }), il(320, { listed: CURRENT })];
    const p = value(e).prices;
    // Good: centre 279, range 228.78-304.11, asking 310. Each condition is that, times its factor, rounded.
    assert.deepEqual(Object.fromEntries(Object.entries(p).map(([c, b]) => [c, band(b)])), {
      new_sealed: { list: 440, low: 330, high: 430 }, like_new: { list: 380, low: 280, high: 370 }, good: { list: 310, low: 230, high: 300 },
      fair: { list: 220, low: 160, high: 220 }, poor: { list: 130, low: 100, high: 130 },
    });
    assert.equal(JSON.stringify(value([...e].reverse()).prices), JSON.stringify(p));
  });
  test('LM-2m [13] when the exact model is known and nothing was found for it, similar models give an approximate range and say so', () => {
    const siblings = [il(650, { match: 'sibling_model', condition: 'like_new' }), il(600, { match: 'sibling_model', page: 'search_or_category' }), il(790, { match: 'sibling_model', condition: 'new_sealed', page: 'search_or_category' })];
    const v = value(siblings);
    assert.deepEqual([v.status, v.basis, v.approximate, v.family_level, v.price_confidence, v.counts.resale], ['priced', BASIS.SIMILAR, true, true, 'low', 3]);
    const withExact = value([...siblings, il(400, { listed: CURRENT })]);
    assert.deepEqual([withExact.basis, withExact.approximate, withExact.counts.resale], [BASIS.ITEM, false, 1], 'one listing for the item itself and the similar models are not used');
  });
});

describe('LM-3 the first Production scan, replayed (2026-10-06, a wireless gaming mouse)', () => {
  // The evidence exactly as that scan stored it: five prices, none with a listing date.
  const stored = [
    { url: 'https://www.ad.co.il/c/23', domain: 'ad.co.il', price: 300, kind: 'used_listing', match: 'exact', market: 'IL', condition: 'unknown' },
    { url: 'https://m.homeless.co.il/yad2/viewad%2C994310.aspx', domain: 'm.homeless.co.il', price: 430, kind: 'used_listing', match: 'exact', market: 'IL', condition: 'new_sealed' },
    { url: 'https://il.ebay.com/b/Logitech-Wireless-Ergonomic-Optical-Computer-Gaming-Mice/23160/bn_71362921', domain: 'il.ebay.com', price: 89, kind: 'used_listing', match: 'exact', market: 'INTL', condition: 'unknown' },
    { url: 'https://il.ebay.com/b/Logitech/bn_21829535', domain: 'il.ebay.com', price: 56, kind: 'used_listing', match: 'exact', market: 'INTL', condition: 'unknown' },
    { url: 'https://www.bug.co.il/brand/logitech/gprowireless/', domain: 'bug.co.il', price: 399, kind: 'new_retail', match: 'exact', market: 'IL', condition: 'new_sealed' },
  ].map((e) => ({ ...e, title: 't', currency: 'ILS', price_ils: e.price, binding: 'url', seen: TODAY }));

  test('LM-3a what gave ₪90: three prices at weights 1, ½, ½, and a median that took the lower neighbour', () => {
    // As deployed: 300, 89 and 56 less 10% negotiation; Israel weighed 1, abroad 0.5 each; the ₪430 "used" unit
    // above the ₪399 new price was set aside. Half the weight is reached exactly at 80.1.
    const deployed = [{ value: 300 * 0.9, weight: 1 }, { value: 89 * 0.9, weight: 0.5 }, { value: 56 * 0.9, weight: 0.5 }].map((p, k) => ({ ...p, evidence: { url: String(k) } }));
    const reached = deployed.filter((p) => p.value <= 89 * 0.9).reduce((s, p) => s + p.weight, 0);
    assert.equal(reached, 1, 'the two foreign prices together weighed exactly as much as the Israeli one');
    assert.equal(Math.round((89 * 0.9) / 0.9 / 5) * 5, 90, 'taking the lower neighbour as the centre gave the ₪90 on the screen');
    assert.equal(Math.round(weightedQuantile(deployed, 0.5)), 175, 'the same weights, split fairly, land between the two markets');
  });
  test('LM-3b the same evidence now: the pages are seen for what they are, and the price says how little it knows', () => {
    const evidence = stored.map(requalify);
    assert.deepEqual(evidence.map((e) => [e.market, e.page]), [['IL', 'search_or_category'], ['IL', 'listing'], ['INTL', 'search_or_category'], ['INTL', 'search_or_category'], ['IL', 'other']]);
    const v = value(evidence);
    // Israel: 300 off a category page, undated: weight 1 x 0.6 x 0.7 = 0.42, value 270.
    // Abroad: 89 and 56 off browse pages, undated, not scaled: 0.25 x 0.6 x 0.7 = 0.105 each, values 80.1 and 50.4.
    // The Israeli price holds two thirds of the weight: centre 270. The range reaches down toward the rest.
    assert.deepEqual(band(v.prices.good), { list: 300, low: 140, high: 290 });
    assert.deepEqual([v.status, v.price_confidence, v.dispersed, v.local_strength, v.local_drives, v.basis], ['priced', 'low', true, 0.42, false, BASIS.ITEM]);
    assert.deepEqual(v.reference_range, { low: 56, high: 300 });
    assert.deepEqual([v.counts.resale, v.counts.il_used_exact, v.counts.intl_used_exact, v.counts.set_aside, v.retail_new_ils], [3, 1, 2, 1, 400]);
    assert.deepEqual(v.evidence.filter((e) => e.set_aside === SET_ASIDE.ABOVE_NEW).map((e) => e.price), [430]);
    assert.deepEqual(v.evidence.filter((e) => e.used).map((e) => [e.price, e.weight, e.freshness]), [[300, 0.42, 'unknown'], [89, 0.11, 'unknown'], [56, 0.11, 'unknown']]);
  });
  test('LM-3c and the search would not have stopped there', () => {
    assert.ok(localStrength(stored.map(requalify), { today: TODAY }) < LOCAL_STRENGTH.drives);
  });
});

// ── THE SEARCH ──────────────────────────────────────────────────────────────
function fakeStore(seed = {}) {
  const rows = new Map(Object.entries(seed));
  return { rows, async load(key) { return rows.get(key) ?? null; }, async save(key, record) { rows.set(key, JSON.parse(JSON.stringify(record))); } };
}
const THIN = { evidence: [RAW_MARKET.evidence[1], RAW_MARKET.evidence[2]] };   // one undated Israeli listing and the new price

describe('LM-4 the search looks in Israel first, and further only when Israel is thin', () => {
  const identity = normalizeIdentity(RAW_IDENTITY);
  const run = (fetchImpl, extra = {}) => runPrice({ identity, model: 'm', apiKey: 'k', fetchImpl, store: fakeStore(), scanUuid: '11111111-2222-3333-4444-555555555555', now: () => NOW, ...extra });
  beforeEach(() => { resetMarketCache(); resetFxCache(); });

  test('LM-4a the two stages ask for different things, and neither asks for a price', () => {
    assert.deepEqual([...MARKET_STAGES], ['local', 'expand']);
    const local = buildMarketPrompt({ identity, today: TODAY, stage: 'local' });
    const expand = buildMarketPrompt({ identity, today: TODAY, stage: 'expand' });
    assert.match(local, /SEARCH — ISRAEL FIRST/);
    assert.match(local, /יד שנייה/);
    assert.match(local, /Do not search abroad in this call/);
    assert.match(expand, /SEARCH — LOOK FURTHER/);
    assert.match(expand, /SOLD prices abroad/);
    assert.match(expand, /NEW unit of this exact item/);
    for (const p of [local, expand]) {
      assert.match(p, /You do NOT set a price/);
      assert.match(p, /listed: the date the LISTING was posted or last updated/);
      assert.match(p, /Never the date of your search, and never a guess/);
      assert.match(p, /A global marketplace showing shekels \(il\.ebay\.com\) is INTL/);
      // What the research found shops and archives do to a careless reader.
      assert.match(p, /"Eilat" price without VAT: never report that one/);
      assert.match(p, /"מחודש", "מציאון", "renewed" — never new_retail/);
      assert.match(p, /An expired or archived ad is still evidence: report it with the date it shows/);
    }
    assert.match(local, /homeless\.co\.il/);
    assert.match(local, /ad\.co\.il/);
    assert.doesNotMatch(local + expand, /facebook|cookie|log ?in|sign in/i, 'no marketplace is entered or signed in to: the search reads what the public web returns');
  });
  test('LM-4b good Israeli evidence: ONE search, and it does not go abroad', async () => {
    const fetchImpl = fakeProvider();
    const r = await run(fetchImpl);
    assert.deepEqual(fetchImpl.stages(), ['local']);
    assert.equal(fetchImpl.of('market')[0].body.max_tool_calls, 1, 'one search action per stage');
    assert.deepEqual([r.status, r.call.tool_calls, r.call.stages, r.valuation.searched.stages, r.valuation.local_drives], [SCAN_STATUS.PRICED, 1, ['local'], ['local'], true]);
  });
  test('LM-4c thin Israeli evidence: one more search, further afield, and both searches\' evidence is priced together', async () => {
    const fetchImpl = fakeProvider({ markets: [THIN], expand: [RAW_EXPAND] });
    const r = await run(fetchImpl);
    assert.deepEqual(fetchImpl.stages(), ['local', 'expand']);
    assert.deepEqual([r.status, r.call.tool_calls, r.call.stages], [SCAN_STATUS.PRICED, 2, ['local', 'expand']]);
    assert.deepEqual([r.valuation.counts.il_used_exact, r.valuation.counts.intl_used_exact, r.valuation.local_drives], [1, 1, false]);
    // 549 new in Israel, 110 USD (385) abroad: the foreign sale is brought to Israeli price level.
    assert.deepEqual([r.valuation.intl_adjusted, r.valuation.intl_scale], [true, 1.43]);
    assert.equal(r.call.usage.input_tokens, 2000, 'both calls are accounted for');
  });
  test('LM-4d the search never makes more calls than it has stages', async () => {
    const fetchImpl = fakeProvider({ markets: [{ evidence: [] }], expand: [{ evidence: [] }] });
    const r = await run(fetchImpl);
    assert.equal(fetchImpl.of('market').length, CFG.MARKET_MAX_STAGES);
    assert.equal(r.status, SCAN_STATUS.INSUFFICIENT);
    assert.ok(CFG.MARKET_MAX_STAGES * CFG.MARKET_STAGE_TIMEOUT_MS + 8000 <= CFG.SCAN_FUNCTION_MAX_DURATION_S * 1000, 'both stages fit inside the function\'s time limit');
  });
  test('LM-4e the wider search failing leaves the Israeli evidence standing', async () => {
    const fetchImpl = fakeProvider({ markets: [THIN], expandStatus: 500 });
    const r = await run(fetchImpl);
    assert.deepEqual(fetchImpl.stages(), ['local', 'expand']);
    assert.deepEqual([r.status, r.valuation.counts.resale, r.call.stages], [SCAN_STATUS.PRICED, 1, ['local']]);
  });
  test('LM-4f the Israeli search failing is a failure: nothing abroad is asked, and no number is made up', async () => {
    const fetchImpl = fakeProvider({ status: 500 });
    const r = await run(fetchImpl);
    assert.deepEqual(fetchImpl.stages(), ['local']);
    assert.deepEqual([r.status, r.failure, r.valuation], [SCAN_STATUS.FAILED, 'upstream_5xx', null]);
  });
  test('LM-4g Israeli evidence already kept for the item counts toward "enough"', async () => {
    const store = fakeStore();
    await run(fakeProvider(), { store });                         // good local evidence, kept
    resetMarketCache();
    const later = fakeProvider({ markets: [{ evidence: [] }] });  // today's Israeli search finds nothing new
    const r = await run(later, { store, now: () => NOW + 3 * 3_600_000 });
    assert.deepEqual(later.stages(), ['local'], 'what is already known is enough: no search abroad');
    assert.deepEqual([r.status, r.reused, r.valuation.local_drives], [SCAN_STATUS.PRICED, false, true]);
  });
  test('LM-4h [12] the same item scanned again within the hour: no search, and the identical valuation', async () => {
    const store = fakeStore();
    const fetchImpl = fakeProvider({ markets: [THIN], expand: [RAW_EXPAND] });
    const first = await run(fetchImpl, { store });
    const again = await run(fetchImpl, { store, now: () => NOW + 30 * 60_000 });
    assert.equal(fetchImpl.of('market').length, 2, 'the two searches of the first scan and none after');
    assert.deepEqual([again.reused, again.call.tool_calls], [true, 0]);
    const same = (v) => JSON.stringify({ ...v, searched: null });
    assert.equal(same(again.valuation), same(first.valuation));
  });
});
