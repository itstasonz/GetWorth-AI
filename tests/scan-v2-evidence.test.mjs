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

import { extractListings, REFUSED, SHAPE, MAX_PER_RESULT } from '../api/_lib/v2/listing-extraction.js';
import { assessV2Evidence, EVIDENCE_CLASS } from '../api/_lib/v2/evidence.js';
import { resolveV2Price, PRICE_STATE, BASIS } from '../api/_lib/v2/pricing.js';
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
  test('V2-6g a bundle or an upsell — several asking prices in one listing — is refused whole', () => {
    const { entries, refused } = extractListings(one('לוח יד שניה', 'Sony PlayStation 5 למכירה 1,700 ש"ח בנוסף שלט שני ב-150 ש"ח'));
    assert.equal(entries.length, 0);
    assert.equal(refused[0].reason, REFUSED.SEVERAL_PRICES);
    assert.deepEqual(refused[0].prices, ['1700|ILS', '150|ILS']);
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
  test('V2-7a of nine kinds of result, exactly one becomes a used listing', () => {
    const { evidence } = scan(RAW.PS5, RESULTS_MIXED);
    const admitted = evidence.entries.filter((e) => e.admitted);
    assert.equal(admitted.length, 1);
    assert.equal(admitted[0].observation.observed_price, 1800);
    assert.equal(admitted[0].evidence_class, EVIDENCE_CLASS.USED_LISTING);
    const prices = evidence.entries.map((e) => e.observation.observed_price);
    for (const never of [29, 15, 150, 2400]) assert.ok(!prices.includes(never), `${never} must never be an observation`);
  });
  test('V2-7b retail, foreign, accessory and unrelated are each labelled, with a reason', () => {
    const { evidence } = scan(RAW.PS5, RESULTS_MIXED);
    const byPrice = (p) => evidence.entries.find((e) => e.observation.observed_price === p);
    assert.equal(byPrice(2299).evidence_class, EVIDENCE_CLASS.NEW_RETAIL);
    assert.equal(byPrice(300).evidence_class, EVIDENCE_CLASS.FOREIGN_CONTEXT);
    assert.equal(byPrice(80).evidence_class, EVIDENCE_CLASS.ACCESSORY_PARTS);
    assert.equal(byPrice(200).evidence_class, EVIDENCE_CLASS.UNRELATED, 'the table row');
    assert.equal(byPrice(250).evidence_class, EVIDENCE_CLASS.UNRELATED, 'the flattened table row');
    assert.equal(byPrice(2100).evidence_class, EVIDENCE_CLASS.UNRELATED, 'the forum comment');
    assert.ok(evidence.entries.filter((e) => !e.admitted).every((e) => e.reason), 'every rejection says why');
    assert.equal(evidence.counts.admitted, 1);
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
    assert.notEqual(price.state, PRICE_STATE.VERIFIED_MARKET_VALUE);
    assert.notEqual(price.state, PRICE_STATE.MARKET_INFORMED_ESTIMATE);
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
  test('V2-8b the same three listings from ONE site are an informed estimate, not a verified value', () => {
    const oneSite = RESULTS_PS5_VERIFIED.map((r, i) => ({ ...r, url: `https://www.boardone.co.il/ad/${i + 1}` }));
    const { price } = scan(RAW.PS5, oneSite);
    assert.equal(price.state, PRICE_STATE.MARKET_INFORMED_ESTIMATE);
    assert.equal(price.authority, 'none');
    assert.equal(price.basis.kind, BASIS.ADMITTED_BELOW_QUORUM);
    assert.equal(price.basis.listings, 3);
    assert.equal(price.basis.sources, 1);
  });
  test('V2-8c one admitted listing for the product is an informed estimate that says "1 listing"', () => {
    const { price } = scan(RAW.PS5, RESULTS_MIXED);
    assert.equal(price.state, PRICE_STATE.MARKET_INFORMED_ESTIMATE);
    assert.equal(price.basis.listings, 1);
    assert.equal(price.recommended, 1800);
  });
  test('V2-8d nothing admitted, a shop page for this product: ESTIMATED_WORTH from the new price and GetWorth’s own ladder', () => {
    const { price, evidence } = scan(RAW.NINJA, RESULTS_RETAIL_ONLY);
    assert.equal(evidence.counts.admitted, 0);
    assert.equal(price.state, PRICE_STATE.ESTIMATED_WORTH);
    assert.equal(price.authority, 'none');
    assert.equal(price.basis.kind, BASIS.RETAIL_DEPRECIATED);
    assert.equal(price.basis.new_retail_price, 1000);
    assert.equal(price.recommended, 700, 'Good -> the used rung, 30% below new');
    assert.equal(price.high, 850);
    assert.equal(price.low, 500);
    assert.equal(price.guard, null);
  });
  test('V2-8e a shop page for a DIFFERENT product of the brand is not retail context for this one', () => {
    const other = [{ ...RESULTS_RETAIL_ONLY[0], title: 'Ninja Foodi Air Fryer - השוואת מחירים | שופזון' }];
    assert.equal(scan(RAW.NINJA, other).price.state, PRICE_STATE.NO_PRICE_EVIDENCE);
  });
  test('V2-8f a brand and a kind of object: listings naming both give ESTIMATED_WORTH, never a market state', () => {
    const { price, evidence } = scan(RAW.ZARA, RESULTS_ZARA);
    assert.equal(evidence.counts.admitted, 0, 'the market gate refuses a brand with no model');
    assert.equal(price.state, PRICE_STATE.ESTIMATED_WORTH);
    assert.equal(price.basis.kind, BASIS.BRAND_CLASS_LISTINGS);
    assert.equal(price.basis.listings, 3);
    assert.equal(price.low, 120);
    assert.equal(price.high, 200);
    // A shirt of the same brand is not a jacket: the brand alone is not context.
    const shirt = { type: 'text_result', url: 'https://www.boardfour.co.il/ad/504', title: 'חולצה Zara למכירה 40 ש"ח | לוח יד שניה', snippet: '' };
    const withShirt = scan(RAW.ZARA, [...RESULTS_ZARA, shirt]);
    assert.equal(withShirt.price.basis.listings, 3);
    assert.equal(withShirt.price.low, 120);
    const two = scan(RAW.ZARA, RESULTS_ZARA.slice(0, 2));
    assert.equal(two.price.state, PRICE_STATE.NO_PRICE_EVIDENCE, 'two listings are not a range');
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
    assert.equal(three.price.state, PRICE_STATE.MARKET_INFORMED_ESTIMATE);
    assert.equal(three.price.authority, 'none');
    const five = scan(RAW.SOFA, sofa(5));
    assert.equal(five.price.state, PRICE_STATE.MARKET_INFORMED_ESTIMATE, 'comparables verify a KIND, never this product');
    assert.notEqual(five.price.state, PRICE_STATE.VERIFIED_MARKET_VALUE);
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
    const cases = [scan(RAW.PS5, RESULTS_PS5_VERIFIED), scan(RAW.PS5, RESULTS_MIXED), scan(RAW.NINJA, RESULTS_RETAIL_ONLY), scan(RAW.ZARA, RESULTS_ZARA)];
    for (const { price } of cases) {
      assert.ok(price.recommended > 0);
      assert.notEqual(price.basis.kind, BASIS.NONE);
      assert.ok(price.basis.listings >= 1);
      assert.equal(price.authority === 'verified_market', price.state === PRICE_STATE.VERIFIED_MARKET_VALUE);
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
  test('V2-9c V2 contains no "strong evidence" or catalog-reference claim to make', () => {
    for (const f of ['pricing.js', 'report.js', 'evidence.js']) {
      assert.ok(!/strong|catalog reference/i.test(code(f)), f);
    }
  });
  test('V2-9d no model output is a number in the valuation: pricing imports no provider client', () => {
    assert.ok(!/openai-stream|identifyItem|streamResponse|fetch\(/.test(code('pricing.js')));
    assert.ok(!/openai-stream|streamResponse|fetch\(/.test(code('evidence.js')));
    assert.ok(!/openai-stream|streamResponse|fetch\(/.test(code('listing-extraction.js')));
  });
});
