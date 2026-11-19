// LC — ONE PRICE FROM SCAN TO LISTING (2026-11-19, investor-demo release). The scan screen and the listing form read the
// same band for the same condition (coreScan.js bandFor → listingFiguresFor); a condition change moves every figure the
// listing carries (its box, the worth stored with it, Method C's reference line); and a price the seller typed is never
// replaced — not by a condition, not by the scan's price arriving, not by going back to the scan and selling again.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildValuation } from '../api/_lib/scan/valuation.js';
import { normalizeIdentity } from '../api/_lib/scan/identify.js';
import { bandFor, buildListingDraft, listingFiguresFor, listingPriceFor, listingPricesOf, scanConditionOf, LISTING_CONDITION } from '../src/lib/coreScan.js';
import { calculatedFor } from '../src/lib/calculatedEstimate.js';
import { listingOnSell, listingOnCondition, listingOnScanPrice, ownPrice } from '../src/lib/listingState.js';
import { RAW_IDENTITY } from './helpers/core-scan-fakes.mjs';

const TODAY = '2026-11-19';
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const identity = normalizeIdentity(RAW_IDENTITY);
const ad = (n, price, condition = 'good') => ({ url: `https://a.example.co.il/${n}`, domain: 'a.example.co.il', title: 't', price, currency: 'ILS', price_ils: price, kind: 'used_listing', match: 'exact', market: 'IL', condition, page: 'listing', listed: '2026-11-10', binding: 'strong', seen: TODAY });
// A real engine valuation with a spread of used ads: like-new and fair are placed inside the market's range.
const priced = buildValuation({ independentMin: 1, today: TODAY, evidence: [ad(1, 300), ad(2, 340), ad(3, 380), ad(4, 420)] });
const LISTING = ['newSealed', 'likeNew', 'used', 'poor'];
const SCAN = ['new_sealed', 'like_new', 'good', 'fair', 'poor'];
// Method C: no used ads, a verified new price, a calculated figure per condition.
const methodC = { status: 'insufficient_evidence', prices: null, calculated: { condition: 'good', estimates: { new_sealed: 900, like_new: 810, good: 765, fair: 585 }, deductions: { like_new: 0.1, good: 0.15, fair: 0.35 } } };
const scanOf = (valuation, condition, extra = {}) => ({ identity: { ...identity, ...extra }, valuation, condition, productAnswers: {}, valuationId: 'val-1', images: [] });

describe('LC-1 the listing opens on the scan\'s own numbers', () => {
  test('LC-1a precondition: the fixture valuation is priced, with distinct like-new, good and fair bands', () => {
    assert.equal(priced.status, 'priced');
    const lists = ['like_new', 'good', 'fair'].map((c) => bandFor(priced, c).list);
    assert.equal(new Set(lists).size >= 2, true, `the condition bands differ: ${lists}`);
  });
  for (const c of [null, ...SCAN]) {
    test(`LC-1b scan condition ${c ?? 'unset'}: draft price = the scan's "Sell for" price, stored worth = the scan's worth`, () => {
      const band = bandFor(priced, c);
      const draft = buildListingDraft(scanOf(priced, c));
      assert.equal(draft.price, band ? band.list : '', 'the box holds the price the scan button named');
      assert.equal(draft.result.marketValue?.mid ?? null, band ? band.worth : null, 'the stored worth is the worth the scan showed');
      // The condition the listing opens on suggests exactly the draft's price: opening it is not a change.
      if (draft.condition) assert.equal(listingPriceFor(draft.result, draft.condition), draft.price);
    });
  }
  test('LC-1c a FAIR scan opens as "used" and re-tapping "used" keeps the fair price (was: jumped to the good band)', () => {
    const draft = buildListingDraft(scanOf(priced, 'fair'));
    assert.equal(draft.condition, 'used');
    assert.equal(listingPriceFor(draft.result, 'used'), bandFor(priced, 'fair').list);
    assert.notEqual(bandFor(priced, 'fair').list, bandFor(priced, 'good').list, 'the fixture tells the two apart');
    assert.equal(listingFiguresFor(draft.result, 'used').marketValue.mid, bandFor(priced, 'fair').worth);
  });
  test('LC-1d a GOOD or unset scan prices "used" from the good band', () => {
    for (const c of [null, 'good', 'like_new']) assert.equal(listingPriceFor(buildListingDraft(scanOf(priced, c)).result, 'used'), bandFor(priced, 'good').list);
  });
});

describe('LC-2 a condition change in the listing moves every figure together', () => {
  for (const from of [null, 'good', 'fair', 'like_new']) {
    test(`LC-2a from scan condition ${from ?? 'unset'}: each listing condition's price, worth and range are that condition's band`, () => {
      const draft = buildListingDraft(scanOf(priced, from));
      for (const lc of LISTING) {
        const band = bandFor(priced, scanConditionOf(lc, from));
        const f = listingFiguresFor(draft.result, lc);
        assert.equal(listingPriceFor(draft.result, lc), band ? band.list : '', `${lc}: box`);
        assert.equal(f.price, band ? band.list : '', `${lc}: figures`);
        assert.deepEqual(f.marketValue && [f.marketValue.low, f.marketValue.mid, f.marketValue.high], band && [band.low, band.worth, band.high], `${lc}: stored worth`);
      }
    });
  }
  test('LC-2b the order holds: a better listing condition never suggests less', () => {
    const draft = buildListingDraft(scanOf(priced, 'good'));
    assert.equal(listingPriceFor(draft.result, 'likeNew') >= listingPriceFor(draft.result, 'used'), true);
  });
  test('LC-2c sealed and faulty with no ads of their own: no number, the seller sets it', () => {
    const draft = buildListingDraft(scanOf(priced, 'good'));
    assert.deepEqual([listingPriceFor(draft.result, 'newSealed'), listingPriceFor(draft.result, 'poor')], ['', '']);
    assert.equal(listingFiguresFor(draft.result, 'poor').marketValue, null, 'no stored worth for a faulty unit with no evidence');
  });
  test('LC-2d Method C: the reference line follows the listing condition; never a prefilled price', () => {
    const draft = buildListingDraft(scanOf(methodC, null));
    assert.equal(draft.price, '');
    assert.equal(draft.result.calculatedEstimate, calculatedFor(methodC.calculated, null).value, 'opens on the photo\'s condition, as the scan screen');
    assert.equal(listingFiguresFor(draft.result, 'likeNew').calculatedEstimate, 810);
    assert.equal(listingFiguresFor(draft.result, 'used').calculatedEstimate, 765);
    assert.equal(listingFiguresFor(draft.result, 'poor').calculatedEstimate, null, 'faulty is never estimated');
    for (const lc of LISTING) assert.equal(listingPriceFor(draft.result, lc), '', `${lc}: Method C never fills the box`);
    const fair = buildListingDraft(scanOf(methodC, 'fair'));
    assert.equal(listingFiguresFor(fair.result, 'used').calculatedEstimate, 585, 'a fair scan\'s "used" is fair\'s figure');
  });
  test('LC-2e a unit confirmed as MODIFIED has no figure for any condition (was: picking a condition filled the standard price)', () => {
    const draft = buildListingDraft(scanOf(priced, 'good', { confirmed: [{ value: 'custom replacement shell' }] }));
    assert.equal(draft.price, '');
    assert.equal(draft.result.listingPrices, null);
    for (const lc of LISTING) {
      assert.equal(listingPriceFor(draft.result, lc), '', lc);
      assert.equal(listingFiguresFor(draft.result, lc).marketValue, null, lc);
    }
  });
  test('LC-2f listingPricesOf takes the scan condition; the four listing conditions only', () => {
    assert.deepEqual(Object.keys(listingPricesOf(priced, 'fair')), LISTING);
    assert.equal(listingPricesOf(priced, 'fair').used, bandFor(priced, 'fair').list);
    assert.equal(listingPricesOf(methodC, 'good'), null);
    assert.deepEqual(Object.values(LISTING_CONDITION).filter((x, i, a) => a.indexOf(x) === i).sort(), [...LISTING].sort());
  });
});

describe('LC-3 the seller\'s own price is never replaced', () => {
  const draftOf = (c) => buildListingDraft(scanOf(priced, c));
  const sell = (prev, c, uuid = 'scan-1') => listingOnSell(prev, draftOf(c), { scanUuid: uuid, priced: true, referenceSeen: false }, { contact_phone: '050-1', location: 'Haifa' });
  test('LC-3a sell opens with GetWorth\'s suggestion, marked as such', () => {
    const d = sell(null, 'good');
    assert.deepEqual([d.price, d.priceOrigin, d.suggestionSeen, d.phone, d.location], [bandFor(priced, 'good').list, 'suggestion', true, '050-1', 'Haifa']);
  });
  test('LC-3b condition change replaces GetWorth\'s own suggestion, never the seller\'s', () => {
    let d = sell(null, 'good');
    d = listingOnCondition(d, 999);
    assert.deepEqual([d.price, d.priceOrigin], [999, 'suggestion']);
    d = { ...d, price: 450, priceOrigin: 'seller' };
    assert.equal(ownPrice(d), true);
    assert.equal(listingOnCondition(d, 123), d, 'typed 450 stays');
    assert.equal(listingOnCondition(d, '').price, 450, 'a condition with no figure does not clear it either');
  });
  test('LC-3c a condition with no evidence empties GetWorth\'s suggestion; the empty box is the seller\'s to fill', () => {
    const d = listingOnCondition(sell(null, 'good'), '');
    assert.deepEqual([d.price, d.priceOrigin], ['', 'seller']);
    assert.equal(listingOnCondition(d, 300).price, 300, 'the next condition with a figure fills it again');
  });
  test('LC-3d back to the scan and sell again: the typed price, edited title/description and phone stay', () => {
    let d = sell(null, 'good');
    d = { ...d, price: 450, priceOrigin: 'seller', title: 'My mouse', phone: '052-9' };
    const again = sell(d, 'fair');
    assert.deepEqual([again.price, again.priceOrigin, again.title, again.phone], [450, 'seller', 'My mouse', '052-9']);
    assert.equal(again.desc, draftOf('fair').desc, 'an untouched description follows the scan\'s answers');
  });
  test('LC-3e back and sell again with only GetWorth\'s price: it follows the scan\'s new condition', () => {
    const again = sell(sell(null, 'good'), 'fair');
    assert.deepEqual([again.price, again.priceOrigin], [bandFor(priced, 'fair').list, 'suggestion']);
  });
  test('LC-3f another scan starts clean', () => {
    const d = { ...sell(null, 'good'), price: 450, priceOrigin: 'seller', title: 'Mine' };
    const other = sell(d, 'good', 'scan-2');
    assert.deepEqual([other.price, other.priceOrigin, other.title, other.phone], [bandFor(priced, 'good').list, 'suggestion', draftOf('good').title, '050-1']);
  });
  test('LC-3g the scan\'s price arriving fills an empty box only', () => {
    const empty = { price: '', priceOrigin: 'seller', suggestionSeen: false, referenceSeen: false };
    assert.deepEqual(listingOnScanPrice(empty, 380, true), { price: 380, priceOrigin: 'suggestion', suggestionSeen: true, referenceSeen: true });
    const typed = { price: 450, priceOrigin: 'seller', suggestionSeen: false, referenceSeen: false };
    assert.deepEqual(listingOnScanPrice(typed, 380, false), { ...typed, suggestionSeen: true }, 'typed 450 stays, the price was still seen');
    assert.deepEqual(listingOnScanPrice(empty, '', false).price, '', 'no price, nothing filled');
  });
});

describe('LC-4 the provider uses these transitions (source checks: AppContext has no test seam)', () => {
  const ctx = read('src/contexts/AppContext.jsx');
  test('LC-4a sell, condition change and the arriving price go through listingState.js', () => {
    assert.match(ctx, /setListingData\(\(prev\) => listingOnSell\(prev, draft,/);
    assert.match(ctx, /setListingData\(\(prev\) => listingOnCondition\(prev, suggestPrice\(c\)\)\)/);
    assert.match(ctx, /setListingData\(\(prev\) => listingOnScanPrice\(prev, price, reference\)\)/);
  });
  test('LC-4b a condition change re-reads the stored worth and the reference line for a scan\'s listing', () => {
    assert.match(ctx, /if \(result\?\.coreScan\) setResult\(\(prev\) => \(prev\?\.coreScan \? \{ \.\.\.prev, \.\.\.resultFiguresFor\(prev, c\) \} : prev\)\)/);
  });
  test('LC-4c the arriving price is the listing\'s CURRENT condition\'s', () => {
    assert.match(ctx, /listingConditionRef\.current = condition;/);
    assert.match(ctx, /listingConditionRef\.current \? listingPriceFor\(merged, listingConditionRef\.current\) : draft\.price/);
  });
  test('LC-4d the older flow\'s Continue keeps a typed price', () => {
    assert.match(read('src/views/SellViews.jsx'), /setListingData\(\(prev\) => \(ownPrice\(prev\) \? prev : \{/);
  });
});
