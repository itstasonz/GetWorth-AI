// ══════════════════════════════════════════════════════════════════════════════
// CORE SCAN — WHAT KIND OF PRICE EACH PRICE IS
//
// The second-hand market is PRIVATE RESALE: what people ask and get for their
// own units, sealed ones included. A shop's new price is context; a shop's
// refurbished offer may support a price private listings already give, and
// never stands in for one. These suites hold those lines, on the one live
// market search this engine has been run against (2026-10-11, a Logitech
// G Pro Wireless; tests/fixtures/core-scan/gpw-live-search.raw.json) and on
// made-up evidence.
//
//   CC-1  the live search, replayed: what counted, what did not, and why
//   CC-2  a private seller's sealed unit is resale; a classifieds ad is resale
//   CC-3  a shop's refurbished offer supports and never leads
//   CC-4  the new-price anchor: in stock first, shops that disagree, retail is context
//
// Pure functions and a saved response. No network, no credit.
//
//   node --test tests/core-scan-classification.test.mjs
// ══════════════════════════════════════════════════════════════════════════════
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildValuation, normalizeReferences, priceConfidence, verifyEvidence, requalify, localStrength, SET_ASIDE, WEIGHT, LOCAL_STRENGTH, WITHDRAWN } from '../api/_lib/scan/valuation.js';
import { kindOf, conditionOf, freshnessOf } from '../api/_lib/scan/evidence.js';
import { isBound } from '../api/_lib/scan/binding.js';
import { normalizeIdentity } from '../api/_lib/scan/identify.js';
import { buildMarketPrompt } from '../api/_lib/scan/market.js';
import { extractSearchProvenance } from '../api/_lib/phaseb/search-provenance.js';
import { parseBoiRates } from '../api/_lib/scan/fx.js';
import { TODAY, BOI_JSON, searchItems } from './helpers/core-scan-fakes.mjs';

const LIVE = JSON.parse(readFileSync(new URL('./fixtures/core-scan/gpw-live-search.raw.json', import.meta.url), 'utf8'));
const FX = parseBoiRates(BOI_JSON);
const facts = (v) => JSON.stringify([v.status, v.prices, v.price_confidence, v.counts, v.retail_new_ils, v.retail_new_range, v.evidence.map((e) => [e.url, e.used, e.set_aside, e.weight]).sort()]);

let serial = 0;
/** A verified reference as the pool holds it: by default an Israeli private used listing for the exact item, current, bound. */
const item = (over = {}) => { serial += 1; return { url: `https://ex.example.co.il/ad/${serial}`, domain: 'ex.example.co.il', title: 't', price: 300, currency: 'ILS', price_ils: over.price ?? 300, kind: 'used_listing', match: 'exact', market: 'IL', condition: 'good', page: 'listing', listed: '2026-09-20', binding: 'strong', stock: 'unknown', shipping: null, seen: TODAY, ...over }; };
const refurbished = (price, over = {}) => item({ price, kind: 'refurbished', condition: 'unknown', page: 'shop_product', stock: 'in_stock', listed: null, ...over });
const shop = (price, over = {}) => item({ price, kind: 'new_retail', condition: 'new_sealed', page: 'shop_product', stock: 'in_stock', listed: null, ...over });
const value = (evidence, opts = {}) => buildValuation({ evidence, today: TODAY, ...opts });

describe('CC-1 the live search of 2026-10-11, replayed', () => {
  const identity = normalizeIdentity(LIVE.identity_raw, { followupsLeft: 0 });
  const provenance = extractSearchProvenance(LIVE.output);
  const said = JSON.parse(LIVE.output.find((i) => i.type === 'message').content[0].text).evidence;
  const replay = (claims = said) => verifyEvidence(claims, provenance, FX, LIVE.today, { identity, answer: null });
  const by = (list, host) => list.find((e) => e.url.includes(host));

  test('CC-1a the record: one completed search, four queries, 28 results with the provider\'s text; four claims, all four tied to the mouse', () => {
    assert.deepEqual([provenance.search_performed, provenance.completed_call_count, provenance.queries.length, provenance.results.length], [true, 1, 4, 28]);
    const { evidence, unverified } = replay();
    assert.equal(unverified, 0);
    assert.deepEqual(evidence.map((e) => [e.domain, e.price, e.binding]), [['m.homeless.co.il', 430, 'strong'], ['ivory.co.il', 389, 'strong'], ['zap.co.il', 659, 'strong'], ['bug.co.il', 399, 'strong']]);
    // Binding stays strict: the same claims with another number the pages do show are not this product's price.
    const wrong = replay(said.map((e, k) => ({ ...e, price: [700, 413, 60, 338.14][k] }))).evidence;
    assert.ok(wrong.every((e) => !isBound(e)), JSON.stringify(wrong.map((e) => [e.price, e.binding, e.binding_reason])));
  });
  test('CC-1b what each price IS: a private sealed unit a year and a half old, a shop\'s refurbished unit it no longer has, two shops\' new prices', () => {
    const { evidence } = replay();
    const homeless = by(evidence, 'homeless');
    assert.deepEqual([homeless.kind, homeless.kind_claimed, homeless.condition, homeless.market, homeless.page, homeless.listed, freshnessOf(homeless.listed, LIVE.today)], ['used_listing', 'other', 'new_sealed', 'IL', 'listing', '2025-04-11', 'older']);
    const ivory = by(evidence, 'ivory');
    assert.deepEqual([ivory.kind, ivory.condition, ivory.stock, ivory.page, ivory.listed], ['refurbished', 'unknown', 'out_of_stock', 'shop_product', null]);
    assert.deepEqual([by(evidence, 'zap').kind, by(evidence, 'zap').stock, by(evidence, 'zap').shipping, by(evidence, 'bug').kind, by(evidence, 'bug').stock], ['new_retail', 'in_stock', 60, 'new_retail', 'unknown']);
  });
  test('CC-1c the valuation: no trustworthy private used price, so no used price; the new price is the cheaper shop\'s, and says the shops disagreed', () => {
    const { evidence } = replay();
    const v = value(evidence, { today: LIVE.today });
    assert.deepEqual([v.status, v.withdrawn, v.prices, v.price_confidence], ['insufficient_evidence', WITHDRAWN.NO_RESALE_EVIDENCE, null, null]);
    const aside = Object.fromEntries(v.evidence.map((e) => [e.domain, e.set_aside]));
    assert.equal(aside['m.homeless.co.il'], SET_ASIDE.ABOVE_NEW, 'a sealed unit asked above the shop\'s new price is not a second-hand price');
    assert.equal(aside['ivory.co.il'], SET_ASIDE.REFURBISHED_ALONE, 'a shop\'s refurbished offer with no private listing standing prices nothing');
    assert.deepEqual([v.retail_new_ils, v.retail_new_in_stock, v.retail_new_range], [400, true, { low: 400, high: 660, dispersed: true }]);
    assert.deepEqual([v.counts.resale, v.counts.retail_il, v.counts.retail_refurbished, v.counts.unbound, v.counts.set_aside], [0, 2, 1, 0, 2]);
    assert.equal(localStrength(evidence, { today: LIVE.today }), 0, 'and the server would go on to search abroad');
    assert.ok(0 < LOCAL_STRENGTH.drives);
    for (const order of [[...evidence].reverse(), [2, 0, 3, 1].map((k) => evidence[k])]) assert.equal(facts(value(order, { today: LIVE.today })), facts(v), 'the same evidence in any order');
  });
  test('CC-1d had the sealed ad asked less than the shop, it would have counted as what it is: a private sealed asking price, old, and the refurbished unit would have supported it', () => {
    // The same verified records, with the ad's price below the shop's. (The claim itself cannot be changed: the page says 430, and binding would refuse 350.)
    const evidence = replay().evidence.map((e) => (e.domain === 'm.homeless.co.il' ? { ...e, price: 350, price_ils: 350 } : e));
    const v = value(evidence, { today: LIVE.today });
    const homeless = v.evidence.find((e) => e.domain === 'm.homeless.co.il');
    const ivory = v.evidence.find((e) => e.domain === 'ivory.co.il');
    assert.deepEqual([v.status, v.price_confidence, v.counts.resale], ['priced', 'low', 2]);
    assert.deepEqual([homeless.used, homeless.freshness, homeless.weight], [true, 'older', WEIGHT.freshness.older]);
    assert.deepEqual([ivory.used, ivory.set_aside, ivory.weight], [true, null, Math.round(WEIGHT.kind.refurbished * WEIGHT.page.shop_product * WEIGHT.freshness.unknown * WEIGHT.stock.out_of_stock * 100) / 100]);
    assert.equal(v.prices.new_sealed.basis, 'listings', 'the sealed condition was stated by the listing');
    assert.ok(v.prices.good.list < 350 && v.prices.new_sealed.list <= 400, JSON.stringify(v.prices));
  });
});

describe('CC-2 a private seller\'s unit is resale, sealed or not', () => {
  test('CC-2a one ad on a classifieds board is private resale whatever the model called it; a shop\'s page keeps its kind', () => {
    const ad = 'https://m.homeless.co.il/yad2/viewad%2C994310.aspx';
    assert.deepEqual([kindOf(ad, 'listing', 'other'), kindOf(ad, 'listing', 'new_retail'), kindOf(ad, 'listing', 'used_listing'), kindOf(ad, 'listing', 'sold')], ['used_listing', 'used_listing', 'used_listing', 'sold']);
    assert.equal(kindOf('https://www.yad2.co.il/market/item/123', 'listing', 'other'), 'used_listing');
    assert.equal(kindOf('https://www.facebook.com/marketplace/item/1', 'listing', 'new_retail'), 'used_listing');
    assert.equal(kindOf('https://www.bug.co.il/brand/logitech/gprowireless/', 'shop_product', 'new_retail'), 'new_retail', 'a shop is a shop');
    assert.equal(kindOf('https://www.ad.co.il/c/23', 'search_or_category', 'other'), 'other', 'a list page is not one seller\'s ad');
    assert.equal(kindOf(ad, 'listing', 'nonsense'), 'used_listing');
    const kept = requalify({ url: ad, domain: 'm.homeless.co.il', price: 430, price_ils: 430, kind: 'other', match: 'exact', market: 'IL', condition: 'new_sealed' });
    assert.deepEqual([kept.kind, kept.kind_claimed, kept.condition], ['used_listing', 'other', 'new_sealed'], 'kept research is read by the same rule');
    assert.deepEqual(requalify(kept), kept);
  });
  test('CC-2b a sealed private listing is priced as a sealed asking price: the ladder brings it to "good", negotiation applies, and its age counts against it', () => {
    const sealed = item({ price: 350, condition: 'new_sealed', listed: '2025-04-11' });
    const [p] = normalizeReferences([sealed], { today: TODAY }).points;
    assert.deepEqual([p.condition, p.stated, p.asking, p.freshness, p.weight], ['new_sealed', true, true, 'older', WEIGHT.freshness.older]);
    assert.ok(p.value < 350 * 0.9, 'a sealed asking price is not a good-condition price');
    const v = value([sealed]);
    assert.deepEqual([v.status, v.price_confidence, v.prices.new_sealed.basis, v.prices.good.basis], ['priced', 'low', 'listings', 'adjusted']);
    assert.ok(v.prices.good.list < v.prices.new_sealed.list);
  });
  test('CC-2d when the model leaves the condition unknown and the listing\'s own page says the unit is sealed, the condition is sealed — and only that, only on a listing page', () => {
    assert.equal(conditionOf('unknown', 'listing', 'Logitech g pro wireless חדש באריזה.'), 'new_sealed');
    assert.equal(conditionOf('unknown', 'listing', 'Logitech G Pro Wireless, brand new, never opened'), 'new_sealed');
    assert.equal(conditionOf('unknown', 'listing', 'unsealed and used daily'), 'unknown', '"unsealed" is not "sealed"');
    assert.equal(conditionOf('unknown', 'listing', 'עכבר במצב מעולה'), 'unknown', 'no word on the page makes a unit "good"');
    assert.equal(conditionOf('unknown', 'search_or_category', 'Logitech G703 חדש באריזה ₪300\nLogitech G Pro Wireless ₪430'), 'unknown', 'a list page\'s words belong to many listings');
    assert.equal(conditionOf('good', 'listing', 'חדש באריזה'), 'good', 'the model\'s own reading is never overridden');
    assert.equal(conditionOf('mint', 'listing', ''), 'unknown');
    const url = 'https://m.homeless.co.il/yad2/viewad%2C994310.aspx';
    const reached = extractSearchProvenance(searchItems([url], { text: { [url]: 'g pro wireless עכבר גיימינג למכירה 430 שח\nLogitech g pro wireless חדש באריזה.' } }));
    const [e] = verifyEvidence([{ url, title: 'g pro wireless עכבר גיימינג למכירה 430 שח', price: 430, currency: 'ILS', kind: 'used_listing', match: 'exact', market: 'IL', condition: 'unknown', page: 'listing', listed: null, stock: 'unknown', shipping: null }], reached, FX, TODAY, { identity: normalizeIdentity(LIVE.identity_raw), answer: null }).evidence;
    assert.deepEqual([e.condition, e.condition_claimed], ['new_sealed', 'unknown']);
    const [p] = normalizeReferences([{ ...e, listed: '2025-04-11' }], { today: TODAY }).points;
    assert.deepEqual([p.condition, p.stated, Math.round(p.value)], ['new_sealed', true, 271], 'a sealed asking price of ₪430 is a good-condition price of about ₪270, not ₪387');
  });
  test('CC-2c the prompt says so to the model', () => {
    const prompt = buildMarketPrompt({ identity: normalizeIdentity(LIVE.identity_raw), today: TODAY });
    assert.match(prompt, /used_listing \(a PRIVATE SELLER's/);
    assert.match(prompt, /sealed, unused unit offered this way is still used_listing, with condition new_sealed/);
    assert.match(prompt, /refurbished \(a SHOP's/);
  });
});

describe('CC-3 a shop\'s refurbished offer supports and never leads', () => {
  test('CC-3a alone, in or out of stock, one or several, it prices nothing and is shown as set aside', () => {
    for (const pool of [[refurbished(389)], [refurbished(389, { stock: 'out_of_stock' })], [refurbished(389), refurbished(379), refurbished(399, { stock: 'out_of_stock' })], [refurbished(389), shop(399)]]) {
      const v = value(pool);
      assert.deepEqual([v.status, v.prices, v.price_confidence, v.counts.resale], ['insufficient_evidence', null, null, 0], JSON.stringify(pool.map((e) => e.price)));
      assert.ok(v.evidence.filter((e) => e.kind === 'refurbished').every((e) => !e.used && e.set_aside === SET_ASIDE.REFURBISHED_ALONE));
      assert.equal(v.counts.retail_refurbished, pool.filter((e) => e.kind === 'refurbished').length);
    }
  });
  test('CC-3b beside a private listing it supports the price, weighs less, less again when the shop no longer has it, and lends no confidence', () => {
    const base = [item({ price: 300 })];
    const v = value([...base, refurbished(389), refurbished(379, { stock: 'out_of_stock' })]);
    const weights = Object.fromEntries(v.evidence.map((e) => [e.price, e.weight]));
    assert.deepEqual(weights, { 300: 1, 389: Math.round(0.8 * 0.9 * 0.6 * 100) / 100, 379: Math.round(0.8 * 0.9 * 0.6 * 0.5 * 100) / 100 });
    assert.deepEqual([v.status, v.counts.resale, v.price_confidence], ['priced', 3, 'low'], 'three references, one of them private: still one seller\'s opinion');
    assert.equal(v.local_strength, 1, 'local strength is private strength');
    assert.equal(localStrength([...base, refurbished(389), refurbished(379)], { today: TODAY }), localStrength(base, { today: TODAY }));
    // Two private listings earn medium with or without the refurbished support; the support does not make it high.
    const two = [item({ price: 300 }), item({ price: 320 })];
    assert.equal(value(two).price_confidence, 'medium');
    assert.equal(value([...two, refurbished(389), refurbished(379), refurbished(369)]).price_confidence, 'medium');
    assert.equal(value([...two, item({ price: 310 })]).price_confidence, 'high');
    assert.equal(priceConfidence({ kept: normalizeReferences([item({ price: 300 }), refurbished(389)], { today: TODAY }).points, scale: null }), 'low');
    // A private listing ABROAD does not let an Israeli shop's refurbished offer stand for the Israeli used market.
    const abroadOnly = value([item({ price: 62, currency: 'USD', price_ils: 189, market: 'INTL', domain: 'used.example.com' }), refurbished(389)]);
    assert.deepEqual([abroadOnly.counts.resale, abroadOnly.evidence.find((e) => e.kind === 'refurbished').set_aside], [1, SET_ASIDE.REFURBISHED_ALONE]);
  });
});

describe('CC-4 the new-price anchor: context, not proof', () => {
  const anchor = (shops) => { const v = value([item({ price: 200 }), ...shops]); return [v.retail_new_ils, v.retail_new_in_stock, v.retail_new_range]; };
  test('CC-4a offers not known to be out of stock come first; out-of-stock pages count only when they are all there is, and the answer says so', () => {
    assert.deepEqual(anchor([shop(399), shop(450, { stock: 'out_of_stock' })]), [400, true, { low: 400, high: 450, dispersed: false }]);
    assert.deepEqual(anchor([shop(399, { stock: 'unknown' }), shop(450, { stock: 'out_of_stock' })]), [400, true, { low: 400, high: 450, dispersed: false }]);
    assert.deepEqual(anchor([shop(450, { stock: 'out_of_stock' }), shop(470, { stock: 'out_of_stock' })]), [460, false, { low: 450, high: 470, dispersed: false }]);
  });
  test('CC-4b shops that agree give their median; shops that disagree give the cheapest, and the range says they disagreed', () => {
    assert.deepEqual(anchor([shop(399), shop(419), shop(429)]), [420, true, { low: 400, high: 430, dispersed: false }]);
    assert.deepEqual(anchor([shop(399), shop(659)]), [400, true, { low: 400, high: 660, dispersed: true }], 'one expensive shop does not lift the line');
    assert.deepEqual(anchor([shop(399), shop(409), shop(659)]), [400, true, { low: 400, high: 660, dispersed: true }]);
  });
  test('CC-4d the first real scan (2026-10-11): the cheaper shop was out of the mouse, the dearer one had it — the cheaper shop still sets the line, and the answer says it was out of stock', () => {
    assert.deepEqual(anchor([shop(399, { stock: 'out_of_stock' }), shop(659, { stock: 'in_stock' })]), [400, false, { low: 400, high: 660, dispersed: true }], 'not ₪660 because one shop happened to have it');
    assert.deepEqual(anchor([shop(399, { stock: 'out_of_stock' }), shop(419, { stock: 'in_stock' })]), [420, true, { low: 400, high: 420, dispersed: false }], 'shops that agree: the one that has it today');
    // The five sources of that scan, as the record would have held them with the model's own classification; the sealed ad is then above the new price.
    const live = [
      item({ price: 430, condition: 'new_sealed', listed: '2025-04-11', domain: 'm.homeless.co.il' }),
      refurbished(389, { stock: 'out_of_stock', domain: 'ivory.co.il' }),
      item({ price: 62, currency: 'USD', price_ils: 189, market: 'INTL', domain: 'reddit.com', page: 'other', condition: 'unknown', listed: null }),
      shop(659, { stock: 'in_stock', shipping: 60, domain: 'zap.co.il' }),
      shop(399, { stock: 'out_of_stock', domain: 'bug.co.il' }),
    ];
    const v = value(live, { today: '2026-10-11' });
    const aside = Object.fromEntries(v.evidence.map((e) => [e.domain, e.set_aside]));
    assert.deepEqual([v.retail_new_ils, v.retail_new_in_stock, v.retail_new_range], [400, false, { low: 400, high: 660, dispersed: true }]);
    assert.equal(aside['m.homeless.co.il'], SET_ASIDE.ABOVE_NEW, 'a sealed unit asked above the cheaper shop\'s price is not a second-hand price');
    assert.equal(aside['ivory.co.il'], SET_ASIDE.REFURBISHED_ALONE, 'with no Israeli private listing standing, the shop\'s refurbished unit is not the Israeli used market');
    assert.deepEqual([v.counts.resale, v.counts.il_used_exact, v.counts.intl_used_exact, v.counts.refurbished_used, v.price_confidence], [1, 0, 1, 0, 'low'], 'what is left is one private listing abroad, unscaled: a low-confidence price, not ₪430');
    assert.ok(v.prices.good.list < 200 && v.prices.good.list > 100, JSON.stringify(v.prices.good));
  });
  test('CC-4c a refurbished offer, a price without binding, a variant and a sealed private unit are never the new price; the anchor still caps a sealed price and sets aside a used price above it', () => {
    assert.deepEqual(anchor([refurbished(389)]), [null, null, null]);
    assert.deepEqual(anchor([shop(399, { binding: 'weak' })]), [null, null, null]);
    assert.deepEqual(anchor([shop(399, { match: 'sibling_model' })]), [null, null, null]);
    assert.deepEqual(anchor([item({ price: 430, condition: 'new_sealed' })]), [null, null, null]);
    const v = value([item({ price: 200 }), item({ price: 430, condition: 'new_sealed' }), shop(399), shop(659)]);
    assert.equal(v.evidence.find((e) => e.price === 430).set_aside, SET_ASIDE.ABOVE_NEW, 'measured against the cheaper shop, not the dearer one');
    assert.ok(v.prices.new_sealed.list <= 400);
  });
});
