// RE — METHOD C, A CALCULATED ESTIMATE FROM THE NEW PRICE (retail-estimate.js, founder decision 2026-11-18), and the shop
// new price named by its page title (evidence.js title_bound). An estimate only with no valuation and no observed ads, only
// from this exact model's verified Israeli new price, only for eligible markets and conditions; always labelled.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { retailEstimate, ineligibility, resolveDeduction, DEDUCTION_DEFAULT } from '../api/_lib/scan/retail-estimate.js';
import { buildValuation, verifyEvidence } from '../api/_lib/scan/valuation.js';
import { buildValuationRow } from '../api/_lib/scan/persist.js';
import { normalizeIdentity } from '../api/_lib/scan/identify.js';
import { calculatedFor } from '../src/lib/calculatedEstimate.js';
import { readFileSync } from 'node:fs';
import { RAW_IDENTITY } from './helpers/core-scan-fakes.mjs';

const TODAY = '2026-11-18';
const identity = normalizeIdentity({ ...RAW_IDENTITY, market_class: 'consumer_electronics', identity_precision: 'exact_model', exact_model_established: true, visible_condition: 'good' });
const shop = (url, price, over = {}) => ({ url, domain: new URL(url).hostname, title: identity.display_name, price, currency: 'ILS', price_ils: price, kind: 'new_retail', match: 'exact', market: 'IL', condition: 'new_sealed', page: 'shop_product', binding: 'strong', binding_reason: 'product_and_price_are_one_listing', stock: 'in_stock', listed: null, seen: TODAY, ...over });
const val = (evidence) => buildValuation({ evidence, searchPerformed: true, today: TODAY });
const ZAP = 'https://www.zap.co.il/model.aspx?modelid=1';
const KSP = 'https://ksp.co.il/web/item/1';

describe('RE-1 when an estimate is made', () => {
  test('RE-1a no valuation, no observed ads, a verified exact new price in stock: estimate = new − 15% (good), 10% (like new)', () => {
    const v = val([shop(ZAP, 1000)]);
    assert.equal(v.status, 'insufficient_evidence');
    const c = retailEstimate(v, identity, { deduction: DEDUCTION_DEFAULT });
    assert.equal(c.method, 'retail_anchored');
    assert.equal(c.retail_ils, 1000);
    assert.equal(c.estimates.good, 850);
    assert.equal(c.estimates.like_new, 900);
    assert.equal(c.condition, 'good');
    assert.equal(c.sources[0].url, ZAP);
    assert.equal(c.validated, false);
  });
  test('RE-1b never with a valuation, never beside observed ads (State A and B win)', () => {
    assert.equal(ineligibility(identity, { status: 'priced' }), 'valued');
    assert.equal(ineligibility(identity, { status: 'insufficient_evidence', comparative: { count: 1 } }), 'observed_ads_shown');
  });
  test('RE-1c never for an open model, a family, a thing sold by description, or an excluded market', () => {
    const v = val([shop(ZAP, 1000)]);
    assert.equal(retailEstimate(v, { ...identity, exact_model_established: false }), null);
    assert.equal(retailEstimate({ ...v, approximate: true }, identity), null);
    assert.equal(retailEstimate(v, { ...identity, identity_precision: 'descriptive' }), null);
    for (const m of ['collectible', 'luxury_watch_jewelry', 'vehicle', 'handmade_vintage', 'furniture', 'fashion', 'fragrance_cosmetics', 'other']) {
      assert.equal(retailEstimate(v, { ...identity, market_class: m }), null, m);
    }
  });
  test('RE-1d never for a unit that looks faulty, or one sold as a part or an accessory; a fair unit takes the fair deduction', () => {
    const v = val([shop(ZAP, 1000)]);
    // 2026-11-18: a fair unit is estimated with its own, larger, stated deduction (questionnaire.js); a faulty one never.
    assert.equal(retailEstimate(v, { ...identity, visible_condition: 'fair' }).condition, 'fair');
    assert.equal(retailEstimate(v, { ...identity, visible_condition: 'poor' }), null);
    assert.equal(retailEstimate(v, { ...identity, configuration: 'part_only' }), null);
  });
  test('RE-1e never from a comparable\'s new price, an unbound one, or one seen only out of stock', () => {
    assert.equal(retailEstimate(val([shop(ZAP, 1000, { match: 'close_comparable' })]), identity), null);
    assert.equal(retailEstimate(val([shop(ZAP, 1000, { binding: 'weak', binding_reason: 'no_page_text_to_check' })]), identity), null);
    assert.equal(retailEstimate(val([shop(ZAP, 1000, { stock: 'out_of_stock' })]), identity), null);
  });
  test('RE-1f the deduction is configurable within 10–20% only', () => {
    assert.equal(resolveDeduction({}), 0.15);
    assert.equal(resolveDeduction({ CORE_SCAN_RETAIL_DEDUCTION: '0.2' }), 0.2);
    assert.equal(resolveDeduction({ CORE_SCAN_RETAIL_DEDUCTION: '0.5' }), 0.15);
    assert.equal(resolveDeduction({ CORE_SCAN_RETAIL_DEDUCTION: 'x' }), 0.15);
  });
  test('RE-1g stored as what it is: price_low/mid/high stay empty, the calculation is kept apart', () => {
    const v = val([shop(ZAP, 1000)]);
    v.calculated = retailEstimate(v, identity);
    const row = buildValuationRow({ id: 'x', userId: 'u', scanUuid: 's', identity, valuation: v, lang: 'he' });
    assert.equal(row.price_mid, null);
    assert.equal(row.price_low, null);
    assert.equal(row.price_method, 'manual_required');
    assert.equal(row.ai_raw_response.valuation.calculated.estimates.good, 850);
  });
});

describe('RE-2 a shop page named by the search\'s title', () => {
  const page = 'https://www.itechmobile.co.il/product/galaxy-s23';
  const prov = (title) => ({ search_performed: true, sources: [page], results: [{ url: page, title, text: null }] });
  const claim = (over = {}) => ({ url: page, title: 'x', price: 1550, currency: 'ILS', kind: 'new_retail', match: 'exact', market: 'IL', condition: 'new_sealed', page: 'shop_product', listed: null, stock: 'in_stock', shipping: null, ...over });
  const phone = normalizeIdentity({ ...RAW_IDENTITY, brand: 'Samsung', product_family: 'Galaxy S', model: 'Galaxy S23', model_number: null, size_or_capacity: '128 GB', display_name: 'Samsung Galaxy S23 128GB', canonical_name: 'samsung galaxy s23', market_class: 'consumer_electronics', search: { hebrew_name: 'גלקסי S23', aliases: [], model_numbers: ['SM-S911B'] } });
  test('RE-2a the exact product in the title: a new-price reference (title_bound), and an estimate from it', () => {
    const { evidence } = verifyEvidence([claim()], prov('טלפון סלולרי Samsung Galaxy S23 SM-S911B/DS 128GB 8GB RAM'), null, TODAY, { identity: phone });
    assert.equal(evidence[0].title_bound, true);
    const v = val(evidence);
    assert.equal(v.retail_new_ils, 1550);
    assert.equal(retailEstimate(v, phone).estimates.good, 1300);
  });
  test('RE-2b another capacity, another model, or an accessory in the title: not this product\'s new price', () => {
    for (const t of ['Samsung Galaxy S23 256GB', 'Samsung Galaxy S23 Ultra 128GB', 'כיסוי ל-Samsung Galaxy S23 128GB']) {
      const { evidence } = verifyEvidence([claim()], prov(t), null, TODAY, { identity: phone });
      assert.notEqual(evidence[0]?.title_bound, true, t);
      assert.equal(val(evidence).retail_new_ils, null, t);
    }
  });
  test('RE-2c never for a used claim, or a page that lists many things', () => {
    const used = verifyEvidence([claim({ kind: 'used_listing' })], prov('Samsung Galaxy S23 128GB'), null, TODAY, { identity: phone }).evidence[0];
    assert.notEqual(used.title_bound, true);
    const list = verifyEvidence([claim({ page: 'search_or_category' })], prov('Samsung Galaxy S23 128GB'), null, TODAY, { identity: phone }).evidence[0];
    assert.notEqual(list.title_bound, true);
  });
});

describe('RE-3 on the screen', () => {
  const c = { estimates: { new_sealed: 900, like_new: 900, good: 850 }, deductions: { new_sealed: 0.1, like_new: 0.1, good: 0.15 }, condition: 'good', retail_ils: 1000 };
  test('RE-3a the condition picked wins over the photo; fair/poor give none; unknown asks', () => {
    assert.deepEqual(calculatedFor(c, null), { condition: 'good', value: 850, deduction: 0.15, chosen: false });
    assert.equal(calculatedFor(c, 'like_new').value, 900);
    assert.deepEqual(calculatedFor(c, 'fair'), { excluded: 'fair' });
    assert.deepEqual(calculatedFor({ ...c, condition: 'unknown' }, null), { needsCondition: true });
  });
  test('RE-3b the label is the founder\'s words in Hebrew, and says it is not a market valuation in English', () => {
    const copy = readFileSync(new URL('../src/lib/scanCopy.js', import.meta.url), 'utf8');
    // The founder's disclosure, kept in meaning and written without the dash (copy pass 2026-11-18).
    assert.ok(copy.includes("calculatedTitle: 'אומדן לפי מחיר מוצר חדש'"));
    assert.ok(copy.includes("calculatedLabel: 'חישוב לפי מחיר מוצר חדש. זו לא הערכת שוק מאומתת.'"));
    assert.ok(copy.includes("calculatedLabel: 'Calculated from the new price. Not a verified market valuation.'"));
  });
});
