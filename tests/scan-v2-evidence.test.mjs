// ══════════════════════════════════════════════════════════════════════════════
// SCAN ENGINE V2 — DETERMINISTIC EXTRACTION, EVIDENCE CLASSES, PRICE STATES
//
// What may become valuation evidence, and what a scan is allowed to claim about
// its price. The qualification gate itself is NOT re-tested here (it has its
// own suites and mutation harness); what is tested is that V2 hands it only
// what a reader would call a listing, and reads its answer without raising it.
//
//   node --test tests/scan-v2-evidence.test.mjs
// ══════════════════════════════════════════════════════════════════════════════
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { extractListings, REFUSED, ROLE, SHAPE, MAX_PER_RESULT } from '../api/_lib/v2/listing-extraction.js';
import { assessV2Evidence, EVIDENCE_CLASS, ANCHOR_STRENGTH } from '../api/_lib/v2/evidence.js';
import { resolveV2Price, PRICE_STATE, BASIS, USED_EVIDENCE } from '../api/_lib/v2/pricing.js';
import { normalizeIdentity } from '../api/_lib/v2/identity.js';
import { decideSufficiency, DECISION, IDENTITY_LEVEL } from '../api/_lib/v2/sufficiency.js';
import { subjectOf } from '../api/_lib/v2/search-plan.js';
import { SEARCH_OUTCOME } from '../api/_lib/v2/search.js';
import { extractSearchProvenance } from '../api/_lib/phaseb/search-provenance.js';
import { isMarketEvidence } from '../api/_lib/market-evidence.js';
import {
  RAW, RESULTS_PS5_VERIFIED, RESULTS_MIXED, RESULTS_RETAIL_ONLY, RESULTS_ZARA,
} from './fixtures/scan-v2/fixtures.mjs';

/** The provenance a completed search call would leave for these results. */
const provenanceOf = (results) => extractSearchProvenance([{
  type: 'web_search_call', status: 'completed',
  action: { type: 'search', queries: ['q'], sources: results.map((r) => ({ type: 'url', url: r.url })) },
  results,
}]);
const one = (title, snippet = '', url = 'https://www.boardone.co.il/ad/1') => provenanceOf([{ type: 'text_result', url, title, snippet }]).results;

function scan(raw, results, { level = null, outcome = SEARCH_OUTCOME.COMPLETED } = {}) {
  const identity = normalizeIdentity(raw);
  const sufficiency = level ? { decision: DECISION.SEARCH_NOW, level } : decideSufficiency(identity);
  const subject = subjectOf(identity, sufficiency.level);
  const evidence = results ? assessV2Evidence({ provenance: provenanceOf(results), subject, level: sufficiency.level, identity }) : null;
  return { identity, sufficiency, subject, evidence, price: resolveV2Price({ identity, subject, sufficiency, evidence, searchOutcome: outcome }) };
}

describe('V2-6 a number is not a price, and a price is not a listing', () => {
  test('V2-6a a price in a page title is one admissible second-hand listing', () => {
    const { entries, refused } = extractListings(one('Sony PlayStation 5 למכירה בתל אביב 1,800 ש"ח | קונסולות | לוח יד שניה'));
    assert.equal(refused.length, 0);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].observation.observed_price, 1800);
    assert.equal(entries[0].observation.currency, 'ILS');
    assert.equal(entries[0].observation.title, 'Sony PlayStation 5 למכירה בתל אביב 1,800 ש"ח', 'the breadcrumb is not the listing');
    assert.equal(entries[0].admissible, true);
    assert.equal(entries[0].observation.match.confidence, null, 'no model read it, so there is no model opinion');
  });
  test('V2-6b a number with no currency marker is not extracted at all', () => {
    assert.equal(extractListings(one('Sony PlayStation 5 למכירה 1800', 'מחיר 1800 בלבד')).entries.length, 0);
  });
  test('V2-6c a NAKED price is refused', () => {
    const { entries, refused } = extractListings(one('קונסולות', '## ₪2,299 ... 650 ₪'));
    assert.equal(entries.length, 0);
    assert.ok(refused.every((r) => r.reason === REFUSED.NAKED_PRICE) && refused.length === 2);
  });
  test('V2-6d a delivery or collection fee is refused, in either language', () => {
    for (const text of ['* משלוח רגיל לבית בעלות של ₪29', '* איסוף מנקודת איסוף בעלות של ₪15', 'Standard shipping 25 ILS to your door']) {
      const { entries, refused } = extractListings(one('חנות', text));
      assert.equal(entries.length, 0, text);
      assert.equal(refused[0].reason, REFUSED.FEE, text);
    }
  });
  test('V2-6e what the seller once paid is not what they are asking', () => {
    const { entries, refused } = extractListings(one('לוח', 'Sony PlayStation 5 למכירה, נקנה ב 2,400 ₪ לפני שנה'));
    assert.equal(entries.length, 0);
    assert.equal(refused[0].reason, REFUSED.NOT_ASKING);
  });
  test('V2-6f "X instead of Y" yields the asking price X and never the original Y', () => {
    const { entries } = extractListings(one('לוח יד שניה', 'בלנדר למכירה מחיר 790₪ במקום 1390₪ גמיש'));
    assert.equal(entries.length, 1);
    assert.equal(entries[0].observation.observed_price, 790);
  });
  test('V2-6g two asking prices in one listing are refused whole; a labelled add-on is refused alone', () => {
    const two = extractListings(one('לוח יד שניה', 'Sony PlayStation 5 למכירה 1,700 ש"ח או עם משחקים 1,900 ש"ח'));
    assert.equal(two.entries.length, 0);
    assert.deepEqual(two.refused.map((r) => [r.value, r.reason]), [[1700, REFUSED.SEVERAL_PRICES], [1900, REFUSED.SEVERAL_PRICES]]);
    // "in addition, a second controller for 150": the label says what the 150 is.
    const upsell = extractListings(one('לוח יד שניה', 'Sony PlayStation 5 למכירה 1,700 ש"ח בנוסף שלט שני ב-150 ש"ח'));
    assert.deepEqual(upsell.entries.map((e) => e.observation.observed_price), [1700]);
    assert.deepEqual(upsell.refused.map((r) => [r.value, r.role, r.reason]), [[150, ROLE.ACCESSORY_PRICE, REFUSED.ACCESSORY]]);
  });
  test('V2-6h a table row is extracted and is NOT admissible: its category cell can name a product it is not', () => {
    for (const text of [
      'משחקים וקונסולות - Sony PlayStation 5 | שלט DualSense | חיפה | 200 ₪ | 01/09/2026',
      '250 ₪ דני     Sony PlayStation 5 למכירה  משחקים וקונסולות יד שניה כבל טעינה מקורי',
    ]) {
      const { entries } = extractListings(one('פלייסטיישן 5 למכירה - לוח יד שניה', text));
      assert.equal(entries.length, 1, text);
      assert.equal(entries[0].shape, SHAPE.TABLE_ROW, text);
      assert.equal(entries[0].admissible, false, text);
    }
  });
  test('V2-6i a shop page is NEW_RETAIL and a forum comment with no sale intent is not a listing', () => {
    const shop = extractListings(one('Sony PlayStation 5 - השוואת מחירים | שופזון', 'Sony PlayStation 5 במחיר 2,299 ₪ משלוח חינם'));
    assert.equal(shop.entries[0].kind, 'new_retail');
    assert.equal(shop.entries[0].admissible, false);
    const forum = extractListings(one('כמה עולה היום קונסולה?', 'Sony PlayStation 5 עולה בערך 2,100 ₪ בחנויות', 'https://www.forumsite.com/r/1'));
    assert.equal(forum.entries[0].kind, 'unknown');
    assert.equal(forum.entries[0].admissible, false);
  });
  test('V2-6j the same page and price is one observation, and a page cannot flood the set', () => {
    const twice = extractListings(one('Sony PlayStation 5 למכירה 1,800 ש"ח | יד שניה', 'Sony PlayStation 5 למכירה במחיר 1,800 ש"ח'));
    assert.equal(twice.entries.length, 1);
    const many = Array.from({ length: 40 }, (_, i) => `פריט ${i} למכירה ${100 + i} ₪`).join(' ... ');
    const flood = extractListings(one('לוח יד שניה', many));
    assert.equal(flood.entries.length, MAX_PER_RESULT);
    assert.ok(flood.refused.some((r) => r.reason === REFUSED.OVER_BUDGET));
  });
  test('V2-6k extraction is total: no input throws, and a result with no URL contributes nothing', () => {
    for (const bad of [null, undefined, 'x', [null], [{}], [{ url: 'not a url', title: 'x 5 ₪ y z' }], [{ url: 'https://a.co.il/1' }]]) {
      assert.deepEqual(extractListings(bad).entries, []);
    }
  });
});

describe('V2-7 evidence classes: what priced the item, and what was kept apart', () => {
  test('V2-7a of nine kinds of result, only the two real listings become used listings', () => {
    const { evidence } = scan(RAW.PS5, RESULTS_MIXED);
    const admitted = evidence.entries.filter((e) => e.admitted);
    assert.deepEqual(admitted.map((e) => e.observation.observed_price).sort(), [1700, 1800]);
    assert.ok(admitted.every((e) => e.evidence_class === EVIDENCE_CLASS.LOCAL_USED));
    const prices = evidence.entries.map((e) => e.observation.observed_price);
    for (const never of [29, 15, 150, 2400]) assert.ok(!prices.includes(never), `${never} must never be an observation`);
  });
  test('V2-7b retail, foreign, accessory and unrelated are each labelled, with a reason', () => {
    const { evidence } = scan(RAW.PS5, RESULTS_MIXED);
    const byPrice = (p) => evidence.entries.find((e) => e.observation.observed_price === p);
    assert.equal(byPrice(2299).evidence_class, EVIDENCE_CLASS.LOCAL_RETAIL);
    assert.equal(byPrice(2299).admitted, false, 'a shop price is never a used listing');
    assert.equal(byPrice(300).evidence_class, EVIDENCE_CLASS.FOREIGN_USED);
    assert.equal(byPrice(300).reason, 'foreign_currency_without_fx_proof');
    assert.equal(byPrice(300).observation.observed_price, 300, 'and its amount is never converted');
    assert.equal(byPrice(80).reason, 'listing_is_an_accessory_for_the_subject');
    assert.equal(byPrice(200).reason, 'table_row_identity_is_not_beside_the_price', 'the table row');
    assert.equal(byPrice(250).reason, 'table_row_identity_is_not_beside_the_price', 'the flattened table row');
    assert.equal(byPrice(2100).evidence_class, EVIDENCE_CLASS.OTHER, 'the forum comment');
    assert.ok(evidence.entries.filter((e) => !e.admitted && !e.retail_anchor).every((e) => e.reason), 'every rejection says why');
    assert.equal(evidence.counts.admitted, 2);
    assert.equal(evidence.counts.retail_listings, 1);
    assert.equal(evidence.counts.currency_failures, 1);
    assert.equal(evidence.counts.admitted + evidence.counts.rejected, evidence.counts.extracted);
  });
  test('V2-7c every observation handed to the gate names a page the search really returned', () => {
    const { evidence } = scan(RAW.PS5, RESULTS_MIXED);
    assert.equal(evidence.counts.unbound, 0);
    const urls = new Set(RESULTS_MIXED.map((r) => r.url));
    assert.ok(evidence.entries.every((e) => urls.has(e.observation.source)));
    // An observation about a page the search did NOT return cannot be admitted.
    const identity = normalizeIdentity(RAW.PS5);
    const stray = assessV2Evidence({
      provenance: { ...provenanceOf(RESULTS_PS5_VERIFIED), sources: [], source_domains: [], source_details: [] },
      subject: subjectOf(identity, 'product'), level: 'product', identity,
    });
    assert.equal(stray.counts.admitted, 0);
    assert.equal(stray.counts.unbound, 3);
  });
  test('V2-7d the Logitech witness, unresolved: the gate refuses the set before it reads a listing', () => {
    const results = [
      { type: 'text_result', url: 'https://www.boardone.co.il/ad/7', title: 'עכבר גיימינג Logitech G305 למכירה בחדרה 200 שח | לוח יד שניה', snippet: '' },
      { type: 'text_result', url: 'https://www.boardtwo.co.il/ad/8', title: 'Logitech G Pro X Superlight למכירה בחולון 650 שח | יד שנייה', snippet: '' },
    ];
    const { evidence, price } = scan(RAW.LOGITECH, results, { level: IDENTITY_LEVEL.BRAND_CLASS });
    assert.equal(evidence.counts.admitted, 0);
    assert.ok(evidence.qualification.set_failures.includes('branded_subject_without_model'));
    assert.equal(price.state, PRICE_STATE.NO_PRICE_EVIDENCE);
    assert.equal(price.recommended, null);
  });
});

describe('V2-8 the price state is the claim', () => {
  test('V2-8a VERIFIED_MARKET_VALUE needs the minted token AND the guard', () => {
    const { evidence, price } = scan(RAW.PS5, RESULTS_PS5_VERIFIED);
    assert.equal(evidence.qualification.qualified, true);
    assert.ok(isMarketEvidence(evidence.qualification.token));
    assert.equal(price.state, PRICE_STATE.VERIFIED_MARKET_VALUE);
    assert.equal(price.authority, 'verified_market');
    assert.equal(price.guard.action, 'accept');
    assert.deepEqual(price.basis, { kind: BASIS.VERIFIED_LISTINGS, listings: 3, sources: 3 });
    assert.ok(price.low <= price.recommended && price.recommended <= price.high);
    assert.ok(price.recommended >= 1700 && price.recommended <= 2000, 'a price inside the listings that earned it');
  });
  test('V2-8b the same three listings from ONE site are below the floors, not a verified value', () => {
    const oneSite = RESULTS_PS5_VERIFIED.map((r, i) => ({ ...r, url: `https://www.boardone.co.il/ad/${i + 1}` }));
    const { price } = scan(RAW.PS5, oneSite);
    assert.equal(price.state, PRICE_STATE.USED_EVIDENCE_BELOW_QUORUM);
    assert.equal(price.authority, 'none');
    assert.equal(price.basis.kind, BASIS.ADMITTED_BELOW_QUORUM);
    assert.equal(price.basis.listings, 3);
    assert.equal(price.basis.sources, 1);
  });
  test('V2-8c one admitted listing for the product is below the floors, and says "1 listing"', () => {
    const { price } = scan(RAW.PS5, RESULTS_MIXED.filter((r) => !r.url.includes('/item/2002')));
    assert.equal(price.state, PRICE_STATE.USED_EVIDENCE_BELOW_QUORUM);
    assert.equal(price.basis.listings, 1);
    assert.equal(price.recommended, 1800);
  });
  test('V2-8d nothing admitted, a shop page for this product: NO used value, and the new price beside it as an anchor', () => {
    const { price, evidence } = scan(RAW.NINJA, RESULTS_RETAIL_ONLY);
    assert.equal(evidence.counts.admitted, 0);
    assert.equal(price.state, PRICE_STATE.NO_PRICE_EVIDENCE);
    assert.equal(price.authority, 'none');
    assert.equal(price.basis.kind, BASIS.NONE);
    for (const k of ['low', 'recommended', 'high']) assert.equal(price[k], null, `no ${k} is derived from a shop price`);
    assert.equal(price.retail_anchor.kind, 'RETAIL_REPLACEMENT_ANCHOR');
    assert.equal(price.retail_anchor.strength, ANCHOR_STRENGTH.SINGLE_SOURCE);
    assert.deepEqual([price.retail_anchor.low, price.retail_anchor.median, price.retail_anchor.high, price.retail_anchor.shops], [1000, 1000, 1000, 1]);
    assert.equal(price.confidence.pricing.used_market, USED_EVIDENCE.NONE);
    assert.equal(price.guard, null);
    // No number anywhere in the used value is a fraction of the anchor.
    assert.ok(!JSON.stringify({ ...price, retail_anchor: null }).match(/\b(700|850|500)\b/));
  });
  test('V2-8e a shop page for a DIFFERENT product of the brand is not retail context for this one', () => {
    const other = [{ ...RESULTS_RETAIL_ONLY[0], title: 'Ninja Foodi Air Fryer - השוואת מחירים | שופזון' }];
    assert.equal(scan(RAW.NINJA, other).price.state, PRICE_STATE.NO_PRICE_EVIDENCE);
  });
  test('V2-8f a brand and a kind of object: the gate refuses the set, and nothing else prices it', () => {
    const { price, evidence } = scan(RAW.ZARA, RESULTS_ZARA);
    assert.equal(evidence.counts.admitted, 0, 'the market gate refuses a brand with no model');
    assert.equal(price.state, PRICE_STATE.NO_PRICE_EVIDENCE);
    assert.equal(price.recommended, null);
    assert.equal(price.retail_anchor.strength, ANCHOR_STRENGTH.NONE);
    assert.ok(evidence.entries.every((e) => /^set_refused: /.test(e.reason)), 'and each listing says the set was refused');
  });
  test('V2-8g an identity the gate did not approve has no price and no search behind it', () => {
    for (const raw of [RAW.LOGITECH, RAW.DARK]) {
      const { price } = scan(raw, null);
      assert.equal(price.state, PRICE_STATE.NEED_MORE_INFORMATION);
      assert.equal(price.recommended, null);
    }
    const spent = normalizeIdentity(RAW.LOGITECH);
    const insufficient = decideSufficiency(spent, { followupsUsed: 1 });
    assert.equal(resolveV2Price({ identity: spent, sufficiency: insufficient, evidence: null }).state, PRICE_STATE.NEED_MORE_INFORMATION);
  });
  test('V2-8h a search that failed, timed out or recorded no search is NO_PRICE_EVIDENCE with the reason, never an estimate', () => {
    for (const outcome of [SEARCH_OUTCOME.TIMED_OUT, SEARCH_OUTCOME.FAILED, SEARCH_OUTCOME.NO_SEARCH_RECORDED]) {
      const { price } = scan(RAW.PS5, null, { outcome });
      assert.equal(price.state, PRICE_STATE.NO_PRICE_EVIDENCE);
      assert.equal(price.recommended, null);
      assert.match(price.reason, new RegExp(outcome.toLowerCase()));
      // Even with evidence in hand, an outcome that is not COMPLETED prices nothing.
      const stale = scan(RAW.PS5, RESULTS_PS5_VERIFIED, { outcome });
      assert.equal(stale.price.state, PRICE_STATE.NO_PRICE_EVIDENCE);
      assert.equal(stale.price.recommended, null);
    }
  });
  test('V2-8i identified, searched, nothing usable: NO_PRICE_EVIDENCE, with the gate’s own reason', () => {
    const { price } = scan(RAW.PS5, [{ type: 'text_result', url: 'https://www.a.co.il/1', title: 'דף הבית', snippet: 'ברוכים הבאים' }]);
    assert.equal(price.state, PRICE_STATE.NO_PRICE_EVIDENCE);
    assert.match(price.reason, /below_observation_quorum/);
  });
  test('V2-8j a generic object needs a small sample: one listing of a KIND is not a price for another', () => {
    const sofa = (n) => Array.from({ length: n }, (_, i) => ({
      type: 'text_result', url: `https://www.board${i}.co.il/ad/${i}`, title: `ספה פינתית למכירה ${1000 + i * 100} ש"ח | לוח יד שניה`, snippet: '',
    }));
    assert.equal(scan(RAW.SOFA, sofa(1)).price.state, PRICE_STATE.NO_PRICE_EVIDENCE);
    const three = scan(RAW.SOFA, sofa(3));
    assert.equal(three.price.state, PRICE_STATE.USED_EVIDENCE_BELOW_QUORUM);
    assert.equal(three.price.authority, 'none');
    const five = scan(RAW.SOFA, sofa(5));
    assert.equal(five.price.state, PRICE_STATE.COMPARABLE_MARKET_ESTIMATE, 'comparables verify a KIND, never this product');
    assert.equal(five.price.confidence.pricing.used_market, USED_EVIDENCE.COMPARABLE);
    assert.notEqual(five.price.state, PRICE_STATE.VERIFIED_MARKET_VALUE);
    assert.notEqual(five.price.state, PRICE_STATE.USED_EVIDENCE_ESTIMATE, 'a kind’s market is never "exact used evidence"');
    assert.deepEqual([five.price.basis.kind, five.price.guard.material_repair], [BASIS.COMPARABLE_LISTINGS, false]);
    // Five comparables that agree to the shekel: the guard widens the band. Still a kind's market, and it says the guard moved it.
    const agree = (n) => Array.from({ length: n }, (_, i) => ({
      type: 'text_result', url: `https://www.board${i}.co.il/ad/${i}`, title: `ספה פינתית למכירה 1,200 ש"ח | לוח יד שניה`, snippet: '',
    }));
    const widened = scan(RAW.SOFA, agree(5)).price;
    assert.equal(widened.state, PRICE_STATE.COMPARABLE_MARKET_ESTIMATE);
    assert.notEqual(widened.state, PRICE_STATE.USED_EVIDENCE_ESTIMATE, 'a widened comparable range is not "sufficient exact used evidence"');
    assert.deepEqual([widened.basis.kind, widened.guard.action, widened.guard.material_repair, widened.guard.moved], [BASIS.COMPARABLE_GUARD_ADJUSTED, 'repair', true, ['low', 'high']]);
    assert.equal(widened.confidence.pricing.used_market, USED_EVIDENCE.COMPARABLE);
    assert.ok(widened.low < 1200 && widened.recommended === 1200 && widened.high > 1200);
  });
  test('V2-8l a verified set the GUARD declines is not shown under any label', () => {
    const at = (prices) => prices.map((p, i) => ({
      type: 'text_result', url: `https://www.board${i}.co.il/ad/${i}`, title: `Sony PlayStation 5 למכירה ${p} ש"ח | לוח יד שניה`, snippet: '',
    }));
    for (const prices of [[90000, 95000, 99000], [5, 6, 7]]) {
      const { evidence, price } = scan(RAW.PS5, at(prices));
      assert.equal(evidence.qualification.qualified, true, 'the evidence gate did its job');
      assert.notEqual(price.guard.action, 'accept');
      assert.equal(price.state, PRICE_STATE.NO_PRICE_EVIDENCE);
      assert.equal(price.recommended, null);
      assert.equal(price.reason, 'guard_declined_the_market_price');
      assert.ok(price.guard.violations.length > 0, 'and says which rule declined it');
    }
  });
  test('V2-8k only a verified state carries authority, and every priced state names its basis and sample', () => {
    const cases = [scan(RAW.PS5, RESULTS_PS5_VERIFIED), scan(RAW.PS5, RESULTS_MIXED)];
    for (const { price } of cases) {
      assert.ok(price.recommended > 0);
      assert.notEqual(price.basis.kind, BASIS.NONE);
      assert.ok(price.basis.listings >= 1);
      assert.equal(price.authority === 'verified_market', price.state === PRICE_STATE.VERIFIED_MARKET_VALUE);
    }
    // And a state with no number names no basis and no sample.
    for (const { price } of [scan(RAW.NINJA, RESULTS_RETAIL_ONLY), scan(RAW.ZARA, RESULTS_ZARA)]) {
      assert.equal(price.recommended, null);
      assert.deepEqual(price.basis, { kind: BASIS.NONE, listings: 0, sources: 0 });
      assert.equal(price.authority, 'none');
    }
  });
});

describe('V2-9 authority rules V2 must not regress', () => {
  const dir = fileURLToPath(new URL('../api/_lib/v2/', import.meta.url));
  const src = (f) => readFileSync(`${dir}${f}`, 'utf8');
  const code = (f) => src(f).split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

  test('V2-9a no catalog row takes part in V2: nothing to anchor, cap or strengthen a price', () => {
    for (const f of ['pricing.js', 'evidence.js', 'scan.js', 'sufficiency.js', 'search-plan.js']) {
      assert.ok(!/selectPricingAnchor|isCompatibleAnchor|catalog_reference|retrieveCandidates|supabase/i.test(code(f)), f);
    }
    assert.match(code('pricing.js'), /catalogCandidates: \[\]/);
  });
  test('V2-9b the context tiers are never handed to the guard or to qualification', () => {
    const pricing = code('pricing.js');
    const guardCall = pricing.slice(pricing.indexOf('applyGuard({'), pricing.indexOf('});', pricing.indexOf('applyGuard({')));
    assert.ok(!/context|retail/i.test(guardCall));
    assert.equal((code('evidence.js').match(/qualifyMarketEvidence\(/g) || []).length, 1, 'one qualification call, on the bound candidates');
  });
  test('V2-9c "strong" describes a retail anchor and nothing else; there is no catalog-reference claim', () => {
    // The one permitted use: the strength of the RETAIL anchor, by name.
    const allowed = /ANCHOR_STRENGTH\.STRONG|STRONG: 'STRONG'/g;
    for (const f of ['pricing.js', 'report.js', 'evidence.js']) {
      assert.ok(!/strong|catalog reference/i.test(code(f).replace(allowed, '')), f);
    }
    assert.equal((code('evidence.js').match(/ANCHOR_STRENGTH\.STRONG/g) || []).length, 1, 'assigned in one place: the retail anchor');
    assert.ok(!/ANCHOR_STRENGTH\.STRONG/.test(code('pricing.js')), 'the used-market state never reads it');
  });
  test('V2-9e a used value is derived from a retail price ONLY through a measured factor: no percentage lives in the code', () => {
    const pricing = code('pricing.js').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    // The anchor is multiplied by a factor read from the table, never by a literal.
    assert.ok(!/anchor\.(low|median|high)\s*\*\s*\d/.test(pricing), 'no literal multiplies the anchor');
    assert.ok(!/ESTIMATED_WORTH|RETAIL_DEPRECIATED|0\.7\b|0\.70\b|0\.5\b|0\.6\b/.test(pricing));
    assert.ok(!/conditionMultiplier\([^)]*\)\s*[^;]*anchor/.test(pricing), 'the condition ladder never scales the anchor');
    const estimate = pricing.slice(pricing.indexOf('if (limitation === null)'), pricing.indexOf('ADMITTED, BELOW THE FLOORS'));
    assert.ok(estimate.length > 0 && /factorLookup\.factor/.test(estimate) && /anchor\.median \* f\.median/.test(estimate));
    assert.ok(!/valuation-calibration/.test(code('pricing.js') + code('evidence.js') + code('scan.js')), 'the offline harness is not imported');
  });
  test('V2-9d no model output is a number in the valuation: pricing imports no provider client', () => {
    assert.ok(!/openai-stream|identifyItem|streamResponse|fetch\(/.test(code('pricing.js')));
    assert.ok(!/openai-stream|streamResponse|fetch\(/.test(code('evidence.js')));
    assert.ok(!/openai-stream|streamResponse|fetch\(/.test(code('listing-extraction.js')));
  });
});
