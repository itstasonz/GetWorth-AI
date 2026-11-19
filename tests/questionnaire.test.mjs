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

describe('PQ-4 the listing text names the model the owner confirmed', () => {
  test('PQ-4a a mention of the start of the name is completed; nothing else changes', async () => {
    const { withModelNamed, applyConfirmed } = await import('../api/_lib/scan/confirmed.js');
    assert.equal(withModelNamed('עכבר אלחוטי Logitech MX Master בצבע אפור.', 'MX Master 3S'), 'עכבר אלחוטי Logitech MX Master 3S בצבע אפור.');
    assert.equal(withModelNamed('Sony DualSense wireless controller.', 'DualSense Edge'), 'Sony DualSense Edge wireless controller.');
    assert.equal(withModelNamed('Logitech MX Master 3S mouse.', 'MX Master 3S'), 'Logitech MX Master 3S mouse.', 'already named: untouched');
    assert.equal(withModelNamed('A wireless mouse.', 'MX Master 3S'), 'A wireless mouse.', 'nothing is added');
    const id = { brand: 'Logitech', model: 'MX Master', display_name: 'Logitech MX Master', listing_description: 'עכבר Logitech MX Master אפור.', alternatives: [], attributes: [], confirmed: [{ attribute: 'model', value: 'MX Master 3S' }] };
    applyConfirmed(id);
    assert.match(id.listing_description, /MX Master 3S/);
    const watch = { brand: 'Apple', product_family: 'Apple Watch', display_name: 'שעון חכם Apple Watch', listing_description: 'שעון חכם Apple Watch ללא רצועה.', alternatives: [], attributes: [], confirmed: [{ attribute: 'generation', value: 'Series 4' }] };
    applyConfirmed(watch);
    assert.equal(watch.listing_description, 'שעון חכם Apple Watch Series 4 ללא רצועה.');
  });
});

describe('PQ-5 the listing draft carries the answers and the condition', () => {
  test('PQ-5a facts join the description; a faulty unit says so; the condition maps to the listing\'s', async () => {
    const { buildListingDraft } = await import('../src/lib/coreScan.js');
    const identity = id({ item_type: 'smartphone', display_name: 'Apple iPhone 13 128GB', listing_description: 'Apple iPhone 13 בצבע כחול.' });
    const a = buildListingDraft({ identity, condition: 'good', productAnswers: { battery: 'high', box: 'yes' }, valuation: null });
    assert.equal(a.title, 'Apple iPhone 13 128GB');
    assert.equal(a.condition, 'used');
    assert.equal(a.price, '', 'no price without a valuation');
    assert.match(a.desc, /בריאות סוללה 90% ומעלה\./);
    const b = buildListingDraft({ identity, condition: 'poor', productAnswers: {}, valuation: null });
    assert.equal(b.condition, 'poor');
    assert.match(b.desc, /המוצר תקול\./);
    const c = buildListingDraft({ identity, condition: 'poor', productAnswers: { works: 'fault' }, valuation: null });
    assert.equal((c.desc.match(/תקלה|תקול/g) ?? []).length, 1, 'said once');
    assert.equal(buildListingDraft({ identity, condition: null, productAnswers: {}, valuation: null }).condition, null, 'never assumed');
  });
  test('PQ-5b the review step offers the condition for a scan listing, and publishing requires one', async () => {
    const { readFileSync } = await import('node:fs');
    const sell = readFileSync(new URL('../src/views/SellViews.jsx', import.meta.url), 'utf8');
    assert.match(sell, /data-testid="listing-condition"[\s\S]{0,600}selectCondition\(c, \{ stay: true \}\)/);
    const app = readFileSync(new URL('../src/contexts/AppContext.jsx', import.meta.url), 'utf8');
    assert.match(app, /if \(!condition\) \{ setError\(/);
  });
});

describe('PQ-6 Production E2E fixes (2026-11-18)', () => {
  test('PQ-6a a confirmed capacity stays in the listing title, once', async () => {
    const { buildListingDraft } = await import('../src/lib/coreScan.js');
    const t = (identity) => buildListingDraft({ identity, condition: 'good', productAnswers: {}, valuation: null }).title;
    assert.equal(t(id({ display_name: 'Apple iPhone 12', size_or_capacity: '128 GB' })), 'Apple iPhone 12 128 GB');
    assert.equal(t(id({ display_name: 'Apple iPhone 12 128GB', size_or_capacity: '128 GB' })), 'Apple iPhone 12 128GB');
    assert.equal(t(id({ display_name: 'Sony DualSense Edge', size_or_capacity: null })), 'Sony DualSense Edge');
  });
  test('PQ-6b once the model is confirmed, the screen asks for "one more detail", not the model', async () => {
    const { readFileSync } = await import('node:fs');
    const copy = readFileSync(new URL('../src/lib/scanCopy.js', import.meta.url), 'utf8');
    assert.ok(copy.includes('needsDetail: (name, modelKnown = false) => (modelKnown ? `זוהה ${name}. כדי לחפש מחיר צריך לדעת עוד פרט אחד.`'));
    // The hint agrees with the questions: only "does not work" is faulty; a cracked screen that works is fair (LOOKS.broken).
    assert.ok(copy.includes(`device: 'משהו לא עובד? בחרו "תקול". מסך סדוק שעדיין עובד הוא "סביר".'`), 'a cracked screen that works is fair, not faulty');
    const view = readFileSync(new URL('../src/views/ScanView.jsx', import.meta.url), 'utf8');
    assert.ok(view.includes('copy.needsDetail(identity.display_name, /^(storage|capacity)$/i.test(String(identity.incomplete ?? "")) || /storage|capacity/i.test(String(question?.attribute ?? "")) || (identity.confirmed ?? []).some((c) => !c.unsure))'), 'storage, or a model already confirmed, is "one more detail"');
  });
});

describe('PQ-7 a generation answer that names the product', () => {
  test('PQ-7a "AirPods Pro דור שני" names the product once, with the brand once', async () => {
    const { applyConfirmed } = await import('../api/_lib/scan/confirmed.js');
    const i = { brand: 'Apple', model: 'AirPods Pro', display_name: 'אוזניות Apple AirPods Pro', listing_description: 'אוזניות Apple AirPods Pro עם קייס טעינה.', alternatives: [], attributes: [], confirmed: [{ attribute: 'generation', value: 'AirPods Pro דור שני' }] };
    applyConfirmed(i);
    assert.equal(i.display_name, 'Apple AirPods Pro דור שני');
    assert.equal(i.listing_description, 'אוזניות Apple AirPods Pro דור שני עם קייס טעינה.');
    const w = { brand: 'Apple', product_family: 'Apple Watch', display_name: 'Apple Watch', listing_description: null, alternatives: [], attributes: [], confirmed: [{ attribute: 'generation', value: 'Series 4' }] };
    applyConfirmed(w);
    assert.equal(w.display_name, 'Apple Watch Series 4');
  });
});

describe('PQ-8 the condition moves a market price inside the range the ads show', () => {
  const market = { list: 500, low: 330, high: 500, worth: 360, quick: 330, basis: 'market', references: 6 };
  const v = { status: 'priced', prices: { good: market, like_new: { ...market, references: 0 }, fair: { ...market, references: 0 }, new_sealed: null, poor: null } };
  test('PQ-8a like new: upper half; fair: lower half; good: the market; sealed and faulty: nothing without their own ads', async () => {
    const { bandFor } = await import('../src/lib/coreScan.js');
    const ln = bandFor(v, 'like_new'); const fr = bandFor(v, 'fair'); const gd = bandFor(v, 'good');
    assert.equal(gd.worth, 360);
    assert.equal(ln.basis, 'range_position'); assert.equal(ln.worth, 430); assert.ok(ln.low >= 330 && ln.high <= 500);
    assert.equal(fr.basis, 'range_position'); assert.equal(fr.worth, 350); assert.ok(fr.low >= 330 && fr.high <= 500);
    assert.ok(fr.worth <= gd.worth && gd.worth <= ln.worth, 'a better unit never costs less');
    assert.equal(bandFor(v, 'new_sealed'), null);
    assert.equal(bandFor(v, 'poor'), null);
  });
  test('PQ-8b ads that state the condition win over a placement', async () => {
    const { bandFor } = await import('../src/lib/coreScan.js');
    const own = { list: 520, low: 450, high: 520, worth: 480, quick: 450, basis: 'listings', references: 3 };
    assert.equal(bandFor({ ...v, prices: { ...v.prices, like_new: own } }, 'like_new'), own);
  });
});

describe('PQ-9 review findings (2026-11-18)', () => {
  const PHONE_ID = { item_type: 'smartphone', model: 'iPhone 12', market_class: 'consumer_electronics', visible_condition: 'good', display_name: 'Apple iPhone 12' };
  test('PQ-9b headphones, microphones, buds and cases are not phones; tools and lamps are not jewelry', () => {
    const k = (o) => productKind({ market_class: 'consumer_electronics', ...o });
    assert.equal(k({ item_type: 'earbuds', product_family: 'AirPods Pro', category: 'headphones' }), 'electronics');
    assert.equal(k({ item_type: 'headphones', brand: 'Sony' }), 'electronics');
    assert.equal(k({ item_type: 'USB microphone' }), 'electronics');
    assert.equal(k({ item_type: 'earbuds', model: 'Pixel Buds Pro' }), 'electronics');
    assert.equal(k({ item_type: 'phone case', model: 'iPhone 13' }), 'electronics');
    assert.equal(k({ item_type: 'smartphone', model: 'Galaxy S22' }), 'phone');
    assert.equal(productKind({ item_type: 'chainsaw', market_class: 'tools' }), 'appliance');
    assert.equal(productKind({ item_type: 'string trimmer', market_class: 'tools' }), 'appliance');
    assert.equal(productKind({ item_type: 'pendant lamp', market_class: 'furniture' }), 'furniture');
    assert.equal(productKind({ item_type: 'gold ring', market_class: 'fashion' }), 'jewelry');
  });
  test('PQ-9c a cracked unit that works is fair, not faulty; a sealed unit stays sealed; no en dash in Hebrew options', () => {
    assert.equal(conditionFromAnswers(PHONE_ID, { looks: 'broken' }).condition, 'fair');
    assert.equal(conditionFromAnswers(PHONE_ID, { looks: 'broken', works: 'fault' }).condition, 'poor');
    assert.equal(conditionFromAnswers(PHONE_ID, { looks: 'sealed' }).condition, 'new_sealed');
    for (const q of questionsFor(PHONE_ID, {})) for (const o of q.options ?? []) assert.ok(!/[–—]/.test(o.he), `${q.id}.${o.id}`);
  });
});
