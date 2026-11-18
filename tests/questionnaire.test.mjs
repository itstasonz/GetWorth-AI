// PQ — PRODUCT QUESTIONS (questionnaire.js, 2026-11-18): the right questions for the kind of product, answers that set or
// limit the condition, facts that go into the listing and never into the price, and a fair-condition estimate from the
// new price that is an assumption, configurable, and never applied to a faulty unit.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { productKind, questionsFor, conditionFromAnswers, factsFromAnswers, QUESTION_SETS } from '../src/lib/questionnaire.js';
import { retailEstimate, resolveFairDeduction, ineligibility } from '../api/_lib/scan/retail-estimate.js';
import { buildValuation } from '../api/_lib/scan/valuation.js';
import { calculatedFor } from '../src/lib/calculatedEstimate.js';

const id = (o) => ({ market_class: 'consumer_electronics', identity_precision: 'exact_model', exact_model_established: true, visible_condition: 'good', ...o });

describe('PQ-1 which questions, for which product', () => {
  test('PQ-1a the kind of product decides the set', () => {
    assert.equal(productKind(id({ item_type: 'smartphone', model: 'iPhone 13' })), 'phone');
    assert.equal(productKind(id({ item_type: 'smartwatch', product_family: 'Apple Watch' })), 'smartwatch');
    assert.equal(productKind(id({ item_type: 'wristwatch', market_class: 'luxury_watch_jewelry', brand: 'Rolex' })), 'luxury_watch');
    assert.equal(productKind(id({ item_type: 'quartz watch', market_class: 'fashion', brand: 'Casio' })), 'fashion_watch');
    assert.equal(productKind(id({ item_type: 'ring', market_class: 'luxury_watch_jewelry' })), 'jewelry');
    assert.equal(productKind(id({ item_type: 'armchair', market_class: 'furniture' })), 'furniture');
    assert.equal(productKind(id({ item_type: 'coffee machine', market_class: 'household' })), 'appliance');
    assert.equal(productKind(id({ item_type: 'game console' })), 'electronics');
    assert.equal(productKind(id({ item_type: 'car', market_class: 'vehicle' })), null, 'no questionnaire where the engine gives no number');
  });
  test('PQ-1b two to four questions for ordinary products; a follow-up only when it applies', () => {
    for (const [kind, qs] of Object.entries(QUESTION_SETS)) assert.ok(qs.length >= 2 && qs.length <= 5, kind);
    const ring = id({ item_type: 'ring', market_class: 'luxury_watch_jewelry' });
    assert.ok(!questionsFor(ring, {}).some((q) => q.id === 'purity'), 'purity is asked only of gold');
    assert.ok(questionsFor(ring, { material: 'gold' }).some((q) => q.id === 'purity'));
    assert.ok(!questionsFor(id({ item_type: 'smartphone' })).some((q) => /model|storage|generation/.test(q.id)), 'which-product questions stay with the server');
  });
});

describe('PQ-2 answers set the condition', () => {
  const phone = id({ item_type: 'smartphone' });
  test('PQ-2a appearance sets it; a fault makes it faulty whatever the appearance', () => {
    assert.equal(conditionFromAnswers(phone, { looks: 'like_new' }).condition, 'like_new');
    assert.equal(conditionFromAnswers(phone, { looks: 'worn' }).condition, 'fair');
    assert.equal(conditionFromAnswers(phone, { looks: 'like_new', works: 'fault' }).condition, 'poor');
    assert.equal(conditionFromAnswers(phone, { works: 'yes' }), null, 'a working unit alone changes nothing');
  });
  test('PQ-2b a weak battery or a missing part limits it: "no better than", from the answer or the photograph', () => {
    assert.equal(conditionFromAnswers(phone, { looks: 'like_new', battery: 'low' }).condition, 'fair');
    assert.equal(conditionFromAnswers(phone, { looks: 'like_new', battery: 'mid' }).condition, 'good');
    assert.equal(conditionFromAnswers(phone, { battery: 'high' }), null, 'a healthy battery is a fact, not a price change');
    assert.equal(conditionFromAnswers(id({ item_type: 'coffee machine', market_class: 'household', visible_condition: 'like_new' }), { missing: 'no' }).condition, 'fair');
    assert.equal(conditionFromAnswers(id({ item_type: 'armchair', market_class: 'furniture' }), { structure: 'yes', looks: 'like_new' }).condition, 'poor');
  });
  test('PQ-2c facts go to the listing; box, warranty, purity and weight never move the condition', () => {
    const ring = id({ item_type: 'ring', market_class: 'luxury_watch_jewelry' });
    assert.deepEqual(factsFromAnswers(ring, { material: 'gold', purity: '14k', weight: 4.2, certificate: 'yes' }, 'he'), ['זהב 14K', 'משקל 4.2 גרם', 'יש תעודה או חשבונית']);
    assert.equal(conditionFromAnswers(ring, { material: 'gold', purity: '14k', weight: 4.2 }), null);
    assert.deepEqual(factsFromAnswers(phone, { box: 'yes', battery: 'high' }, 'he'), ['בריאות סוללה 90% ומעלה', 'עם קופסה ומטען מקוריים']);
    assert.equal(conditionFromAnswers(phone, { box: 'yes' }), null);
  });
});

describe('PQ-3 the estimate from the new price follows the condition', () => {
  const TODAY = '2026-11-18';
  const shop = { url: 'https://www.zap.co.il/model.aspx?modelid=1', domain: 'zap.co.il', title: 'x', price: 1000, currency: 'ILS', price_ils: 1000, kind: 'new_retail', match: 'exact', market: 'IL', condition: 'new_sealed', page: 'shop_product', binding: 'strong', binding_reason: 'product_and_price_are_one_listing', stock: 'in_stock', listed: null, seen: TODAY };
  const v = buildValuation({ evidence: [shop], searchPerformed: true, today: TODAY });
  test('PQ-3a like new −10%, good −15%, fair −35% (electronics) / −30% (household): stated assumptions', () => {
    const e = retailEstimate(v, id({}), { deduction: 0.15 });
    assert.deepEqual([e.estimates.like_new, e.estimates.good, e.estimates.fair], [900, 850, 650]);
    assert.equal(retailEstimate(v, id({ market_class: 'household' }), { deduction: 0.15 }).estimates.fair, 700);
    assert.equal(e.estimates.poor, undefined, 'a faulty unit is never priced from a new price');
  });
  test('PQ-3b the fair deduction is configurable within 25–50% only', () => {
    assert.equal(resolveFairDeduction('consumer_electronics', {}), 0.35);
    assert.equal(resolveFairDeduction('consumer_electronics', { CORE_SCAN_RETAIL_FAIR_DEDUCTION: '0.4' }), 0.4);
    assert.equal(resolveFairDeduction('consumer_electronics', { CORE_SCAN_RETAIL_FAIR_DEDUCTION: '0.9' }), 0.35);
  });
  test('PQ-3c the screen\'s figure changes with the answers; faulty shows none', () => {
    const e = retailEstimate(v, id({}), { deduction: 0.15 });
    const phone = id({ item_type: 'smartphone' });
    const at = (answers) => calculatedFor(e, conditionFromAnswers(phone, answers)?.condition ?? null);
    assert.equal(at({}).value, 850, 'from the photograph: good');
    assert.equal(at({ looks: 'like_new' }).value, 900);
    assert.equal(at({ looks: 'like_new', battery: 'low' }).value, 650);
    assert.deepEqual(at({ works: 'fault' }), { excluded: 'poor' });
    assert.equal(ineligibility(id({ visible_condition: 'fair' }), v), null, 'a unit that looks fair now gets the fair estimate');
    assert.equal(ineligibility(id({ visible_condition: 'poor' }), v), 'condition_excluded');
  });
});
