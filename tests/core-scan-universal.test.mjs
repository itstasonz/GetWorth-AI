// ══════════════════════════════════════════════════════════════════════════════
// CORE SCAN — ONE FLOW FOR EVERY KIND OF THING
//
// A person photographs almost anything they own. The scan has to decide, for
// THAT item, what kind of thing it is, how precisely it is sold, what matters,
// what one question is worth asking before the search, how to phrase the
// search, and how — or whether — to value it. These suites walk sixteen kinds
// of item through those decisions, on identities shaped as the vision model
// returns them. They prove the policy, not the pricing: no fixture here is a
// real market.
//
//   CU-1  the universal identity: market class, precision, attributes with
//         their basis, candidate questions, eligibility notes; unbranded is
//         not unidentified; an inferred value never passes for a fact
//   CU-2  which question, when: OUTCOME-AWARE — required only when the answer
//         changes the search, nothing required where no number is made,
//         eligibility never asked; one at a time, answers kept and never asked
//         twice, a conflicting answer replaced not duplicated, the owner's own
//         words when no option fits, and when to stop
//   CU-3  the sixteen-item matrix: class, precision, strategy, first question
//   CU-4  research and valuation follow the kind of item: a car is not a mouse;
//         similar items are not this item — no anchor from a similar thing,
//         nothing from abroad, two Israeli comparables that agree or no number
//   CU-5  the endpoint, round by round: answer → next question → search
//
//   node --test tests/core-scan-universal.test.mjs
// ══════════════════════════════════════════════════════════════════════════════
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeIdentity, completeIdentity, selectQuestion, recordAnswer, identityGap, marketClassOf, precisionOf, buildIdentityPrompt, IDENTITY_SCHEMA,
  MARKET_CLASSES, PRECISIONS, INCOMPLETE, MAX_ANSWER_TEXT,
} from '../api/_lib/scan/identify.js';
import { buildSearchQueries, buildMarketPrompt, searchNames } from '../api/_lib/scan/market.js';
import { buildValuation, strategyFor, marketKey, STRATEGY, BASIS, WITHDRAWN, SET_ASIDE, COMPARABLE_MIN } from '../api/_lib/scan/valuation.js';
import { bindPrice, BOUND, namesOf } from '../api/_lib/scan/binding.js';
import { runPrice, isApproximate, resetMarketCache, SCAN_STATUS } from '../api/_lib/scan/service.js';
import { createScanHandler } from '../api/scan.js';
import { resetFxCache } from '../api/_lib/scan/fx.js';
import * as CFG from '../api/_lib/scan/config.js';
import { IMG, RAW_IDENTITY, TODAY, NOW, SOURCES, fakeProvider } from './helpers/core-scan-fakes.mjs';

const UUID = '11111111-2222-3333-4444-555555555555';
const fakeStore = () => { const rows = new Map(); return { async load(k) { return rows.get(k) ?? null; }, async save(k, r) { rows.set(k, r); } }; };
const Q = (attribute, kind, question, over = {}) => ({ attribute, kind, question, options: [], unit: null, impact: 'high', affects: 'price', ...over });
const A = (name, value, basis = 'observed', matters = 'medium') => ({ name, value, basis, matters });
const BASE = { ...RAW_IDENTITY, visible_text: [], alternatives: [], followup: { kind: 'none', affects: 'none', question: null, options: [] }, attributes: [], clarifications: [], eligibility_notes: [] };
/** An identity as the vision model returns it for one kind of item, normalised and with the server's question chosen. */
const raw = (over) => ({ ...BASE, ...over });
const scan = (over, opts = {}) => completeIdentity(normalizeIdentity(raw(over)), { lang: 'en', followupsLeft: CFG.MAX_FOLLOWUPS, ...opts });

// ── THE SIXTEEN ─────────────────────────────────────────────────────────────
const ITEMS = {
  mouse: raw({ market_class: 'consumer_electronics', identity_precision: 'exact_model', model: 'G Pro Wireless', canonical_name: 'logitech g pro wireless', display_name: 'Logitech G Pro Wireless',
    attributes: [A('works', null, 'unknown'), A('receiver included', null, 'unknown', 'low')], clarifications: [Q('works', 'yes_no', 'Does everything work properly?', { options: ['Yes', 'No'], impact: 'medium' })] }),
  phone: raw({ category: 'Electronics', item_type: 'smartphone', brand: 'Apple', product_family: 'iPhone', model: 'iPhone 13', canonical_name: 'apple iphone 13', display_name: 'Apple iPhone 13', market_class: 'consumer_electronics', identity_precision: 'exact_model',
    search: { hebrew_name: 'אייפון 13', aliases: [], model_numbers: [] }, attributes: [A('storage', null, 'unknown', 'high'), A('color', 'blue')],
    clarifications: [Q('storage', 'choice', 'What storage size is it?', { options: ['128 GB', '256 GB', '512 GB'], affects: 'identity' })] }),
  laptop: raw({ category: 'Electronics', item_type: 'laptop', brand: 'Apple', product_family: 'MacBook Air', model: null, canonical_name: 'apple macbook air', display_name: 'Apple MacBook Air', exact_model_established: false, market_class: 'consumer_electronics', identity_precision: 'exact_model',
    alternatives: [{ name: 'MacBook Air M1 (2020)', distinguishing: null }, { name: 'MacBook Air M2 (2022)', distinguishing: null }], identity_confidence: 'medium',
    clarifications: [Q('generation', 'choice', 'Which MacBook Air is it?', { options: ['M1 (2020)', 'M2 (2022)', 'M3 (2024)'], affects: 'identity' })] }),
  blender: raw({ category: 'Home', item_type: 'blender', brand: 'Ninja', product_family: null, model: null, canonical_name: 'ninja blender', display_name: 'Ninja blender', exact_model_established: false, market_class: 'consumer_electronics', identity_precision: 'exact_model' }),
  sofa: raw({ category: 'Furniture', item_type: 'sofa', brand: null, product_family: null, model: null, canonical_name: 'grey fabric three-seat sofa', display_name: 'Grey three-seat fabric sofa', exact_model_established: false, market_class: 'furniture', identity_precision: 'descriptive',
    search: { hebrew_name: 'ספה תלת מושבית אפורה', aliases: [], model_numbers: [] }, attributes: [A('seats', '3'), A('material', 'fabric'), A('width', null, 'unknown')],
    clarifications: [Q('width', 'number', 'Approximately how wide is it?', { unit: 'cm', impact: 'medium' })] }),
  sneakers: raw({ category: 'Clothing', item_type: 'sneakers', brand: 'Nike', product_family: 'Air Force 1', model: 'Air Force 1 Low', canonical_name: 'nike air force 1 low', display_name: 'Nike Air Force 1 Low', market_class: 'fashion', identity_precision: 'exact_model',
    attributes: [A('size', null, 'unknown', 'high')], clarifications: [Q('size', 'choice', 'What size are they (EU)?', { options: ['40', '41', '42', '43', '44'], affects: 'identity' })] }),
  watch: raw({ category: 'Watches', item_type: 'wristwatch', brand: 'Rolex', product_family: 'Submariner', model: 'Submariner Date', canonical_name: 'rolex submariner date', display_name: 'Rolex Submariner Date', market_class: 'luxury_watch_jewelry', identity_precision: 'exact_model',
    attributes: [A('reference', null, 'unknown', 'high'), A('box and papers', null, 'unknown', 'high'), A('authenticity', null, 'unknown', 'high')],
    clarifications: [Q('reference', 'photo', 'Take one photo of the reference number engraved between the lugs', { affects: 'identity' }), Q('box and papers', 'yes_no', 'Do you have the original box and papers?', { options: ['Yes', 'No'] })],
    eligibility_notes: ['Authenticity cannot be confirmed from a photograph.'] }),
  perfume: raw({ category: 'Beauty', item_type: 'perfume', brand: 'BDK Parfums', product_family: null, model: null, canonical_name: 'bdk parfums perfume', display_name: 'BDK Parfums perfume', exact_model_established: false, market_class: 'fragrance_cosmetics', identity_precision: 'exact_model',
    search: { hebrew_name: 'בושם BDK', aliases: [], model_numbers: [] } }),
  drill: raw({ category: 'Tools', item_type: 'cordless drill', brand: 'Makita', product_family: 'DHP', model: 'DHP485', canonical_name: 'makita dhp485', display_name: 'Makita DHP485', market_class: 'tools', identity_precision: 'exact_model',
    attributes: [A('batteries included', null, 'unknown', 'high'), A('works', null, 'unknown')],
    clarifications: [Q('batteries included', 'choice', 'What comes with it?', { options: ['Tool only', 'One battery and charger', 'Two batteries and charger'] })] }),
  card: raw({ category: 'Toys', item_type: 'trading card', brand: 'Pokémon', product_family: 'Base Set', model: 'Charizard', canonical_name: 'pokemon base set charizard', display_name: 'Pokémon Base Set Charizard', market_class: 'collectible', identity_precision: 'exact_model',
    attributes: [A('edition', null, 'unknown', 'high'), A('grading', null, 'unknown', 'high')],
    clarifications: [Q('edition', 'choice', 'Which edition is it?', { options: ['1st Edition', 'Shadowless', 'Unlimited'], affects: 'identity' })], eligibility_notes: ['Authenticity and grade cannot be confirmed from a photograph.'] }),
  bicycle: raw({ category: 'Sports', item_type: 'bicycle', brand: 'Trek', product_family: 'Marlin', model: 'Marlin 7', canonical_name: 'trek marlin 7', display_name: 'Trek Marlin 7', market_class: 'other', identity_precision: 'exact_model',
    attributes: [A('frame size', null, 'unknown', 'medium'), A('year', null, 'unknown', 'medium')], clarifications: [Q('frame size', 'choice', 'What frame size is it?', { options: ['S', 'M', 'L', 'XL'], impact: 'medium' })] }),
  car: raw({ category: 'Vehicles', item_type: 'car', brand: 'Toyota', product_family: 'Corolla', model: 'Corolla', canonical_name: 'toyota corolla', display_name: 'Toyota Corolla', market_class: 'vehicle', identity_precision: 'exact_model',
    search: { hebrew_name: 'טויוטה קורולה', aliases: [], model_numbers: [] }, attributes: [A('year', null, 'unknown', 'high'), A('mileage', null, 'unknown', 'high'), A('color', 'white', 'observed', 'low'), A('accident history', null, 'unknown', 'high')],
    clarifications: [Q('year', 'number', 'What year is the car?', { affects: 'identity' }), Q('mileage', 'number', 'How many kilometres has it travelled?', { unit: 'km' }), Q('accidents', 'yes_no', 'Has it been in an accident?', { options: ['Yes', 'No'], impact: 'medium' })],
    eligibility_notes: ['Ownership, registration and accident history cannot be verified from a photograph.'] }),
  lamp: raw({ category: 'Home', item_type: 'table lamp', brand: null, product_family: null, model: null, canonical_name: 'brass table lamp', display_name: 'Brass table lamp', exact_model_established: false, market_class: 'household', identity_precision: 'descriptive',
    search: { hebrew_name: 'מנורת שולחן פליז', aliases: [], model_numbers: [] }, attributes: [A('material', 'brass'), A('works', null, 'unknown', 'medium')], clarifications: [Q('works', 'yes_no', 'Does it work?', { options: ['Yes', 'No'], impact: 'medium' })] }),
  vintage: raw({ category: 'Electronics', item_type: 'film camera', brand: 'Canon', product_family: 'AE-1', model: 'AE-1 Program', canonical_name: 'canon ae-1 program', display_name: 'Canon AE-1 Program', market_class: 'handmade_vintage', identity_precision: 'exact_model',
    attributes: [A('works', null, 'unknown', 'high'), A('lens included', 'yes')], clarifications: [Q('works', 'yes_no', 'Does the shutter fire and the meter work?', { options: ['Yes', 'No'] })] }),
  handmade: raw({ category: 'Home', item_type: 'ceramic bowl', brand: null, product_family: null, model: null, canonical_name: 'handmade glazed ceramic bowl', display_name: 'Handmade glazed ceramic bowl', exact_model_established: false, market_class: 'handmade_vintage', identity_precision: 'descriptive',
    search: { hebrew_name: 'קערת קרמיקה בעבודת יד', aliases: [], model_numbers: [] }, attributes: [A('diameter', null, 'unknown', 'medium'), A('maker', null, 'unknown', 'medium')],
    clarifications: [Q('diameter', 'number', 'Roughly what diameter is it?', { unit: 'cm', impact: 'medium' })] }),
  unknown: raw({ category: 'Other', item_type: 'unknown object', brand: null, product_family: null, model: null, canonical_name: 'small carved wooden object', display_name: 'Small carved wooden object', exact_model_established: false, identity_confidence: 'low', market_class: 'other', identity_precision: 'descriptive',
    search: { hebrew_name: null, aliases: [], model_numbers: [] }, attributes: [A('purpose', null, 'unknown', 'high')],
    clarifications: [Q('purpose', 'photo', 'Take one photo showing the whole object next to a coin for scale', { affects: 'identity' })] }),
};
/** A laptop with two questions whose answers change the search (generation, storage) and one whose answer does not (works). */
const TWO_QUESTIONS = raw({ ...ITEMS.laptop, clarifications: [...ITEMS.laptop.clarifications, Q('storage', 'choice', 'How much storage?', { options: ['256 GB', '512 GB'] }), Q('works', 'yes_no', 'Does everything work?', { options: ['Yes', 'No'], impact: 'medium' })] });

describe('CU-1 the universal identity', () => {
  test('CU-1a the schema carries a market class, a precision, attributes with their basis, candidate questions and eligibility notes; the prompt asks for them', () => {
    for (const k of ['market_class', 'identity_precision', 'attributes', 'clarifications', 'eligibility_notes']) assert.ok(IDENTITY_SCHEMA.properties[k], k);
    assert.ok(!('followup' in IDENTITY_SCHEMA.properties), 'the one question is the server\'s to choose, not the model\'s to return');
    assert.deepEqual(IDENTITY_SCHEMA.properties.market_class.enum, [...MARKET_CLASSES]);
    assert.deepEqual(IDENTITY_SCHEMA.properties.identity_precision.enum, [...PRECISIONS]);
    const p = buildIdentityPrompt({ lang: 'en' });
    for (const s of ['A used car is not a used mouse', 'An unbranded item is NOT unidentified', 'never inferred from a photograph', 'Most scans need no question', 'Never invent a value: unknown is an answer']) assert.match(p, new RegExp(s.replace(/[()]/g, '\\$&')));
  });
  test('CU-1b an unbranded sofa is identified, not "unidentified"; an inferred value is kept as a hypothesis and never becomes a fact', () => {
    const sofa = scan(ITEMS.sofa);
    assert.deepEqual([sofa.is_sellable_item, sofa.market_class, sofa.identity_precision, sofa.incomplete], [true, 'furniture', 'descriptive', undefined]);
    assert.deepEqual(sofa.attributes.map((a) => [a.name, a.value, a.basis]), [['seats', '3', 'observed'], ['material', 'fabric', 'observed'], ['width', null, 'unknown']]);
    const guessed = normalizeIdentity(raw({ attributes: [A('storage', '256 GB', 'inferred', 'high'), A('year', null, 'observed', 'high')] }));
    assert.deepEqual(guessed.attributes.map((a) => [a.value, a.basis]), [['256 GB', 'inferred'], [null, 'unknown']], 'inferred stays inferred; a value the photograph did not show is unknown');
    assert.ok(!searchNames(guessed).name.includes('256'), 'an inferred storage is not searched for as if it were known');
  });
  test('CU-1c when the model names no market class, the category implies one and the precision follows; an appliance under Home is sold by model', () => {
    const quiet = normalizeIdentity({ ...BASE, market_class: undefined, identity_precision: undefined });
    assert.deepEqual([quiet.market_class, quiet.identity_precision], ['consumer_electronics', 'exact_model']);
    assert.deepEqual([marketClassOf({ category: 'Furniture' }), precisionOf('furniture')], ['furniture', 'descriptive']);
    assert.deepEqual([marketClassOf({ category: 'Home', item_type: 'blender' }), marketClassOf({ category: 'Home', item_type: 'table lamp' })], ['consumer_electronics', 'household']);
    assert.equal(marketClassOf({ category: 'Vehicles' }), 'vehicle');
  });
});

describe('CU-2 which question, when — and when to stop', () => {
  test('CU-2a outcome-aware: a question is required only when its answer changes the search; where no number is made nothing is required and nothing about the price is asked; eligibility is never asked; low never; the required one first', () => {
    const phone = scan(ITEMS.phone);
    assert.deepEqual([phone.followup.kind, phone.followup.required, phone.followup.attribute], ['choice', true, 'storage'], 'storage decides what is searched for: before the search');
    const drill = scan(ITEMS.drill);
    assert.deepEqual([drill.followup.kind, drill.followup.required, drill.followup.attribute], ['choice', undefined, 'batteries included'], 'high impact, but it describes the unit: offered beside the price');
    const car = scan(ITEMS.car);
    assert.deepEqual([car.followup.kind, car.followup.question, car.followup.required], ['number', 'What year is the car?', undefined], 'a car gets no number from this engine: nothing stands before the search');
    const dated = recordAnswer(car, 2019, { lang: 'en', followupsLeft: 2 }).identity;
    assert.equal(dated.followup.kind, 'none', 'mileage and accidents move a price this engine does not make: never asked');
    const mouse = scan(ITEMS.mouse);
    assert.deepEqual([mouse.followup.kind, mouse.followup.required], ['yes_no', undefined], 'a medium question waits beside the price');
    const low = scan(raw({ clarifications: [Q('color', 'choice', 'Which colour?', { options: ['Black', 'White'], impact: 'low' })] }));
    assert.equal(low.followup.kind, 'none');
    const eligibility = scan(raw({ clarifications: [Q('authenticity', 'yes_no', 'Is it genuine?', { options: ['Yes', 'No'], affects: 'eligibility' })] }));
    assert.equal(eligibility.followup.kind, 'none', 'no outcome turns on it: eligibility_notes say what a photograph cannot establish');
    const mixed = scan(raw({ clarifications: [Q('a', 'yes_no', 'Price thing?', { options: ['Yes', 'No'] }), Q('b', 'yes_no', 'Identity thing?', { options: ['Yes', 'No'], affects: 'identity' })] }));
    assert.deepEqual([mixed.followup.question, mixed.followup.required], ['Identity thing?', true]);
    const later = scan(raw({ clarifications: [Q('works', 'yes_no', 'Does it work?', { options: ['Yes', 'No'] }), Q('storage', 'choice', 'How much storage?', { options: ['64 GB', '128 GB'] })] }));
    assert.deepEqual([later.followup.question, later.followup.required], ['How much storage?', true], 'the one that changes the search comes first, whatever order the model gave');
  });
  test('CU-2b each answer is kept as a confirmed fact, written over the model\'s guess, never asked again; a later answer to the same question replaces, not duplicates', () => {
    let laptop = scan(TWO_QUESTIONS);
    assert.deepEqual([laptop.followup.question, laptop.followup.required], ['Which MacBook Air is it?', true]);
    laptop = recordAnswer(laptop, 1, { lang: 'en', followupsLeft: 2 }).identity;
    assert.deepEqual(laptop.confirmed, [{ attribute: 'generation', value: 'M2 (2022)', question: 'Which MacBook Air is it?' }]);
    assert.deepEqual(laptop.attributes.find((a) => a.name === 'generation'), { name: 'generation', value: 'M2 (2022)', basis: 'confirmed', matters: 'high' });
    assert.deepEqual([laptop.followup.question, laptop.followup.required], ['How much storage?', true], 'storage joins the search: still before it');
    laptop = recordAnswer(laptop, 0, { lang: 'en', followupsLeft: 1 }).identity;
    assert.deepEqual([laptop.followup.question, laptop.followup.required, laptop.size_or_capacity], ['Does everything work?', undefined, '256 GB'], 'medium: beside the price');
    assert.equal(selectQuestion({ ...laptop, confirmed: [...laptop.confirmed, { attribute: 'works', value: 'Yes', question: 'Does everything work?' }] }, { lang: 'en', followupsLeft: 1 }), null, 'everything asked: nothing left');
    // The owner changes their mind: the same attribute is confirmed once, with the latest value.
    const again = recordAnswer({ ...laptop, followup: { kind: 'choice', question: 'Which MacBook Air is it?', options: ['M1 (2020)', 'M2 (2022)', 'M3 (2024)'], unit: null, attribute: 'generation' } }, 2, { lang: 'en', followupsLeft: 1 }).identity;
    assert.deepEqual(again.confirmed.filter((c) => c.attribute === 'generation').map((c) => c.value), ['M3 (2024)']);
    assert.equal(again.attributes.find((a) => a.name === 'generation').value, 'M3 (2024)');
  });
  test('CU-2c "unsure" is kept as such, the price stays approximate, and the search does not carry it; a wrong-typed answer is refused', () => {
    const phone = scan(ITEMS.phone);
    const unsure = recordAnswer(phone, 'unsure', { lang: 'en', followupsLeft: 2 });
    assert.deepEqual([unsure.identity.confirmed[0].unsure, unsure.answer.unsure, isApproximate(unsure.identity, unsure.answer)], [true, true, true]);
    assert.ok(!searchNames(unsure.identity, unsure.answer).name.includes('not sure'));
    assert.ok(recordAnswer(phone, 'free text', { lang: 'en' }).error);
    assert.ok(recordAnswer(phone, 7, { lang: 'en' }).error, 'not an offered option');
    assert.ok(recordAnswer(scan(ITEMS.car), -5, { lang: 'en' }).error, 'a negative year is not a year');
    assert.ok(recordAnswer(scan(ITEMS.unknown), 0, { lang: 'en' }).error, 'a photograph cannot be answered with a number');
    const sized = recordAnswer(phone, 1, { lang: 'en', followupsLeft: 2 });
    assert.deepEqual([sized.identity.size_or_capacity, sized.answer.text], ['256 GB', '256 GB'], 'a confirmed storage settles the core field too');
    assert.ok(buildSearchQueries({ identity: sized.identity, answer: sized.answer }).some((q) => /iPhone 13 256 GB/.test(q)));
  });
  test('CU-2d stopping: when the allowance is spent nothing more is asked; a required detail still missing leaves the identity incomplete, and a medium question is simply dropped', () => {
    const spent = scan(ITEMS.perfume, { followupsLeft: 0 });
    assert.deepEqual([spent.incomplete, spent.followup.kind], [INCOMPLETE.FRAGRANCE_NAME_OR_SIZE, 'none']);
    assert.equal(scan(ITEMS.mouse, { followupsLeft: 0 }).followup.kind, 'none');
    assert.equal(CFG.MAX_FOLLOWUPS, 3);
  });
  test('CU-2e the owner\'s own words: a choice whose options do not fit takes { other } — short, cleaned, a confirmed fact that joins the search; bare text, markup-only or empty words are refused, and so are words for a yes/no or a number question; "not sure" typed is "unsure"', () => {
    const phone = scan(ITEMS.phone);
    const own = recordAnswer(phone, { other: '  64  GB ' }, { lang: 'en', followupsLeft: 2 });
    assert.deepEqual([own.answer, own.identity.confirmed, own.identity.size_or_capacity], [
      { question: 'What storage size is it?', text: '64 GB', stated: true },
      [{ attribute: 'storage', value: '64 GB', question: 'What storage size is it?', stated: true }],
      '64 GB',
    ]);
    assert.ok(buildSearchQueries({ identity: own.identity, answer: own.answer }).some((q) => /iPhone 13 64 GB/.test(q)), 'the owner\'s storage is searched for like an offered one');
    assert.equal(recordAnswer(phone, { other: '<64 GB>' }, { lang: 'en' }).answer.text, '64 GB', 'markup never survives the boundary');
    assert.equal(recordAnswer(phone, { other: 'x'.repeat(100) }, { lang: 'en' }).answer.text.length, MAX_ANSWER_TEXT);
    assert.deepEqual([recordAnswer(phone, { other: 'not sure' }, { lang: 'en' }).answer.unsure, recordAnswer(phone, { other: 'לא יודע' }, { lang: 'en' }).answer.unsure], [true, true]);
    for (const bad of [{ other: '' }, { other: '   ' }, { other: '<<>>' }, { other: 42 }, { text: '64 GB' }, '64 GB', ['64 GB']]) assert.ok(recordAnswer(phone, bad, { lang: 'en' }).error, JSON.stringify(bad));
    assert.ok(recordAnswer(scan(ITEMS.mouse), { other: 'mostly' }, { lang: 'en' }).error, 'a yes/no question takes yes or no');
    assert.ok(recordAnswer(scan(ITEMS.sofa), { other: '180 cm' }, { lang: 'en' }).error, 'a number question takes a number');
  });
});

describe('CU-3 the sixteen, through the same door', () => {
  // kind of thing → [market class, precision, strategy, first question kind, required, incomplete]
  // Required only where the answer changes the search (identity, or an attribute that joins the queries) and a number
  // will be made: a car, a watch and a card are specialised markets with no number, so nothing stands before their
  // search; a drill's "what comes with it" and a camera's "does it work" describe the unit, so they wait beside the price.
  const EXPECT = {
    mouse: ['consumer_electronics', 'exact_model', STRATEGY.EXACT, 'yes_no', false, undefined],
    phone: ['consumer_electronics', 'exact_model', STRATEGY.EXACT, 'choice', true, undefined],
    laptop: ['consumer_electronics', 'exact_model', STRATEGY.EXACT, 'choice', true, undefined],
    blender: ['consumer_electronics', 'exact_model', STRATEGY.EXACT, 'photo', true, INCOMPLETE.BRAND_ONLY],
    sofa: ['furniture', 'descriptive', STRATEGY.COMPARABLE, 'number', false, undefined],
    sneakers: ['fashion', 'exact_model', STRATEGY.EXACT, 'choice', true, undefined],
    watch: ['luxury_watch_jewelry', 'exact_model', STRATEGY.SPECIALISED, 'photo', false, undefined],
    perfume: ['fragrance_cosmetics', 'exact_model', STRATEGY.EXACT, 'photo', true, INCOMPLETE.FRAGRANCE_NAME_OR_SIZE],
    drill: ['tools', 'exact_model', STRATEGY.EXACT, 'choice', false, undefined],
    card: ['collectible', 'exact_model', STRATEGY.SPECIALISED, 'choice', false, undefined],
    bicycle: ['other', 'exact_model', STRATEGY.EXACT, 'choice', false, undefined],
    car: ['vehicle', 'exact_model', STRATEGY.SPECIALISED, 'number', false, undefined],
    lamp: ['household', 'descriptive', STRATEGY.COMPARABLE, 'yes_no', false, undefined],
    vintage: ['handmade_vintage', 'exact_model', STRATEGY.COMPARABLE, 'yes_no', false, undefined],
    handmade: ['handmade_vintage', 'descriptive', STRATEGY.COMPARABLE, 'number', false, undefined],
    unknown: ['other', 'descriptive', STRATEGY.COMPARABLE, 'photo', true, undefined],
  };
  for (const [name, expected] of Object.entries(EXPECT)) {
    test(`CU-3 ${name}`, () => {
      const i = scan(ITEMS[name]);
      assert.deepEqual([i.market_class, i.identity_precision, strategyFor(i), i.followup.kind, i.followup.required === true, i.incomplete], expected);
      assert.ok(buildSearchQueries({ identity: i }).length > 0, 'every kind of item can be searched for');
      assert.ok(i.followup.kind === 'none' || i.followup.question, 'a question has words');
    });
  }
  test('CU-3x the questions are the item\'s own: no two kinds of item get the same first question, and nobody is asked for the brand or the condition in general', () => {
    const questions = Object.values(ITEMS).map((it) => scan(it).followup.question).filter(Boolean);
    assert.ok(new Set(questions).size >= 12, `${new Set(questions).size} distinct first questions`);
    assert.ok(questions.every((q) => !/what brand|what condition/i.test(q)));
    const car = scan(ITEMS.car);
    assert.deepEqual(car.eligibility_notes, ['Ownership, registration and accident history cannot be verified from a photograph.']);
  });
});

describe('CU-4 research and valuation follow the kind of item', () => {
  beforeEach(() => { resetMarketCache(); resetFxCache(); });
  test('CU-4a the queries: a car with the words of the car market and no shop price; a sofa in Hebrew first and by description; a mouse by model and shop', () => {
    // The year was answered (offered beside the evidence); the mileage, a fact about the unit, sits on the identity as a confirmed fact.
    let car = recordAnswer(scan(ITEMS.car), 2019, { lang: 'en', followupsLeft: 2 }).identity;
    car = { ...car, confirmed: [...car.confirmed, { attribute: 'mileage', value: '85000 km', question: 'How many kilometres has it travelled?' }] };
    const q = buildSearchQueries({ identity: car });
    assert.ok(q.some((s) => /Toyota Corolla 2019 יד שנייה למכירה/.test(s)), 'the year names the car; the mileage does not');
    assert.ok(q.every((s) => !/85000/.test(s)));
    assert.ok(q.some((s) => /מחירון רכב/.test(s)) && q.some((s) => /רכב יד שנייה/.test(s)));
    assert.ok(q.every((s) => !/zap\.co\.il/.test(s)), 'a car has no shop price');
    assert.equal(q[0], 'טויוטה קורולה יד שנייה', 'the Hebrew name already carries the model, in Hebrew letters');
    const sofa = buildSearchQueries({ identity: scan(ITEMS.sofa) });
    assert.equal(sofa[0], 'ספה תלת מושבית אפורה יד שנייה');
    assert.ok(sofa.some((s) => /ריהוט יד שנייה/.test(s)) && sofa.every((s) => !/zap\.co\.il/.test(s)));
    const mouse = buildSearchQueries({ identity: scan(ITEMS.mouse) });
    assert.ok(mouse.at(-1).includes('zap.co.il'));
    assert.match(buildMarketPrompt({ identity: scan(ITEMS.sofa), today: TODAY }), /this kind of item has no exact model\. exact \(the same kind of thing/);
    assert.match(buildMarketPrompt({ identity: scan(ITEMS.sofa), today: TODAY }), /market_class: furniture\nidentity_precision: descriptive\nseats: 3\nmaterial: fabric/);
  });
  test('CU-4b binding by description: a sofa listing binds when the row names the kind of thing, in Hebrew or English; a desk does not', () => {
    const sofa = scan(ITEMS.sofa);
    assert.ok(namesOf(sofa).some((r) => r.join(' ') === 'ספה'));
    const page = (title) => ({ type: 'listing', title, text: `${title}\n₪900` });
    const claim = (title) => ({ price: 900, currency: 'ILS', title, match: 'close_comparable', shipping: null });
    assert.equal(bindPrice(claim('ספה תלת מושבית במצב טוב'), page('ספה תלת מושבית במצב טוב'), sofa).level, BOUND.STRONG);
    assert.equal(bindPrice(claim('Grey sofa, 3 seats'), page('Grey sofa, 3 seats'), sofa).level, BOUND.STRONG);
    assert.equal(bindPrice(claim('שולחן עבודה'), page('שולחן עבודה'), sofa).level, BOUND.WEAK, 'a desk is not a sofa');
  });
  test('CU-4c valuation strategy: similar items give an approximate, low range and say so; a car, a watch, a card are verified, shown and NOT priced; a mouse is priced as before', async () => {
    const listing = (url, price, match = 'close_comparable') => ({ url, title: `t ${match}`, price, currency: 'ILS', kind: 'used_listing', match, market: 'IL', condition: 'good', page: 'listing', listed: '2026-10-01', stock: 'unknown', shipping: null });
    const market = { evidence: [listing(SOURCES.IL_USED_1, 900), listing(SOURCES.IL_USED_2, 1100), listing(SOURCES.IL_RETAIL, 800)] };
    const pages = Object.fromEntries(market.evidence.map((e) => [e.url, `ספה תלת מושבית אפורה יד שנייה ₪${e.price.toLocaleString()} · פורסם 01/10/2026`]));
    const run = (identity, pageText = pages) => runPrice({ identity, model: 'm', apiKey: 'k', fetchImpl: fakeProvider({ markets: [market], reached: Object.values(SOURCES), pageText, rows: false }), store: fakeStore(), scanUuid: UUID, now: () => NOW });
    const sofa = await run(scan(ITEMS.sofa));
    assert.deepEqual([sofa.status, sofa.valuation.strategy, sofa.valuation.basis, sofa.valuation.approximate, sofa.valuation.price_confidence, sofa.valuation.counts.resale], [SCAN_STATUS.PRICED, STRATEGY.COMPARABLE, BASIS.SIMILAR_ITEMS, true, 'low', 3]);
    resetMarketCache();
    const carPages = Object.fromEntries(Object.values(SOURCES).map((u) => [u, 'טויוטה קורולה 2019 יד שנייה ₪90,000 · פורסם 01/10/2026']));
    const car = recordAnswer(scan(ITEMS.car), 2019, { lang: 'en', followupsLeft: 2 }).identity;
    const carMarket = { evidence: [listing(SOURCES.IL_USED_1, 90000, 'exact'), listing(SOURCES.IL_USED_2, 90000, 'exact')] };
    const priced = await runPrice({ identity: car, model: 'm', apiKey: 'k', fetchImpl: fakeProvider({ markets: [carMarket], reached: Object.values(SOURCES), pageText: carPages, rows: false }), store: fakeStore(), scanUuid: UUID, now: () => NOW });
    assert.deepEqual([priced.status, priced.valuation.prices, priced.valuation.withdrawn, priced.valuation.no_price_reason, priced.valuation.strategy], [SCAN_STATUS.INSUFFICIENT, null, WITHDRAWN.NO_CALIBRATED_METHOD, WITHDRAWN.NO_CALIBRATED_METHOD, STRATEGY.SPECIALISED]);
    assert.ok(priced.valuation.evidence.length === 2 && priced.valuation.evidence.every((e) => e.set_aside === SET_ASIDE.SPECIALISED_CONTEXT && !e.used), 'verified, shown as context, not priced from');
    for (const name of ['watch', 'card']) assert.equal(strategyFor(scan(ITEMS[name])), STRATEGY.SPECIALISED, name);
    // The existing method, for the existing kind of item, exactly as before.
    const mouse = buildValuation({ evidence: [{ url: SOURCES.IL_USED_1, domain: 'x.co.il', title: 't', price: 300, currency: 'ILS', price_ils: 300, kind: 'used_listing', match: 'exact', market: 'IL', condition: 'good', page: 'listing', listed: '2026-09-20', binding: 'strong', stock: 'unknown', shipping: null, seen: TODAY }], today: TODAY });
    assert.deepEqual([mouse.status, mouse.strategy, mouse.basis, mouse.approximate], ['priced', STRATEGY.EXACT, BASIS.ITEM, false]);
  });
  test('CU-4d the market key: what the owner confirmed is part of what the item is, so one scan\'s facts never read another\'s research', () => {
    const a = scan(ITEMS.car);
    const b = recordAnswer(a, 2019, { lang: 'en', followupsLeft: 2 }).identity;
    const c = recordAnswer(a, 2015, { lang: 'en', followupsLeft: 2 }).identity;
    assert.notEqual(marketKey(b), marketKey(c));
    assert.notEqual(marketKey(a), marketKey(b));
    assert.equal(marketKey(b), marketKey({ ...b, display_name: 'קורולה', color: 'red' }), 'wording and colour are not the item');
  });
  test('CU-4e similar items are not this item: no new-price anchor from a similar thing, nothing from abroad, at least two Israeli comparables that stand, and no number when they disagree', () => {
    const ref = (url, price, over = {}) => ({ url, domain: new URL(url).host, title: 'ספה תלת מושבית', price, currency: 'ILS', price_ils: price, kind: 'used_listing', match: 'close_comparable', market: 'IL', condition: 'good', page: 'listing', listed: '2026-10-01', binding: 'strong', stock: 'unknown', shipping: null, seen: TODAY, ...over });
    const similar = (evidence) => buildValuation({ evidence, strategy: STRATEGY.COMPARABLE, today: TODAY });
    // ONE similar item is one seller's opinion of another thing: shown, not priced from.
    const one = similar([ref(SOURCES.IL_USED_1, 900)]);
    assert.deepEqual([one.status, one.withdrawn, one.no_price_reason, one.prices, one.evidence[0].set_aside, one.evidence[0].used, one.reference_range], ['insufficient_evidence', WITHDRAWN.TOO_FEW_COMPARABLES, WITHDRAWN.TOO_FEW_COMPARABLES, null, SET_ASIDE.SIMILAR_CONTEXT, false, { low: 900, high: 900 }]);
    assert.equal(COMPARABLE_MIN, 2);
    // Two that agree: a range, approximate, low.
    const two = similar([ref(SOURCES.IL_USED_1, 900), ref(SOURCES.IL_USED_2, 1100)]);
    assert.deepEqual([two.status, two.basis, two.approximate, two.price_confidence, two.counts.resale], ['priced', BASIS.SIMILAR_ITEMS, true, 'low', 2]);
    // Three that disagree (₪300 to ₪2,500) describe no market: shown with their spread, no number.
    const apart = similar([ref(SOURCES.IL_USED_1, 300), ref(SOURCES.IL_USED_2, 900), ref('https://ads.example.co.il/3', 2500)]);
    assert.deepEqual([apart.status, apart.withdrawn, apart.dispersed, apart.reference_range, apart.evidence.every((e) => e.set_aside === SET_ASIDE.SIMILAR_CONTEXT && !e.used)], ['insufficient_evidence', WITHDRAWN.COMPARABLES_DISAGREE, true, { low: 300, high: 2500 }, true]);
    // A shop's new price for a SIMILAR sofa is not this sofa's new price: it sets nothing aside and caps nothing.
    const shop = ref(SOURCES.IL_RETAIL, 1000, { kind: 'new_retail', condition: 'new_sealed', page: 'shop_product', stock: 'in_stock' });
    const withShop = similar([ref(SOURCES.IL_USED_1, 900), ref(SOURCES.IL_USED_2, 1100), ref('https://ads.example.co.il/3', 1500), shop]);
    assert.deepEqual([withShop.status, withShop.retail_new_ils, withShop.counts.retail_il, withShop.counts.resale, withShop.evidence.find((e) => e.kind === 'new_retail').set_aside], ['priced', null, 0, 3, SET_ASIDE.SIMILAR_RETAIL]);
    assert.ok(withShop.evidence.every((e) => e.set_aside !== SET_ASIDE.ABOVE_NEW), 'a used sofa dearer than a similar new one is not "above new"');
    assert.ok(withShop.prices.new_sealed.list > 1000, 'and no similar item\'s shop price caps the sealed band');
    // The same evidence for an EXACT item uses the anchor and sets the dearer listing aside: the rule is the strategy's, not the data's.
    const exact = buildValuation({ evidence: [ref(SOURCES.IL_USED_1, 900, { match: 'exact' }), ref(SOURCES.IL_USED_2, 1100, { match: 'exact' }), ref('https://ads.example.co.il/3', 1500, { match: 'exact' }), { ...shop, match: 'exact' }], today: TODAY });
    assert.deepEqual([exact.retail_new_ils, exact.evidence.find((e) => e.price === 1500).set_aside, exact.evidence.find((e) => e.price === 900).set_aside], [1000, SET_ASIDE.ABOVE_NEW, null]);
    // A similar item abroad says nothing about Israel: never a reference, whatever stands locally.
    const abroad = similar([ref(SOURCES.IL_USED_1, 900), ref(SOURCES.IL_USED_2, 1100), ref(SOURCES.INTL_USED, 700, { market: 'INTL', currency: 'USD', price: 200 })]);
    assert.deepEqual([abroad.status, abroad.counts.resale, abroad.evidence.find((e) => e.market === 'INTL').set_aside], ['priced', 2, SET_ASIDE.SIMILAR_ABROAD]);
  });
  test('CU-4f a thing valued from similar items is searched in Israel only: with one similar item found the search does not go abroad, and the answer says the comparables were too few; an exact item with thin Israeli evidence still looks further', async () => {
    const market = { evidence: [{ url: SOURCES.IL_USED_1, title: 'ספה תלת מושבית אפורה', price: 900, currency: 'ILS', kind: 'used_listing', match: 'close_comparable', market: 'IL', condition: 'good', page: 'listing', listed: '2026-10-01', stock: 'unknown', shipping: null }] };
    const pages = { [SOURCES.IL_USED_1]: 'ספה תלת מושבית אפורה יד שנייה ₪900 · פורסם 01/10/2026' };
    const fetchImpl = fakeProvider({ markets: [market], reached: Object.values(SOURCES), pageText: pages, rows: false });
    const sofa = await runPrice({ identity: scan(ITEMS.sofa), model: 'm', apiKey: 'k', fetchImpl, store: fakeStore(), scanUuid: UUID, now: () => NOW });
    assert.deepEqual([sofa.status, sofa.valuation.withdrawn, fetchImpl.stages(), sofa.call.stages], [SCAN_STATUS.INSUFFICIENT, WITHDRAWN.TOO_FEW_COMPARABLES, ['local'], ['local']]);
    resetMarketCache();
    const thin = fakeProvider({ markets: [{ evidence: [] }], reached: Object.values(SOURCES), pageText: {}, rows: false });
    const mouse = await runPrice({ identity: scan(ITEMS.mouse), model: 'm', apiKey: 'k', fetchImpl: thin, store: fakeStore(), scanUuid: UUID, now: () => NOW });
    assert.deepEqual([mouse.call.stages, thin.stages()], [['local', 'expand'], ['local', 'expand']]);
  });
});

describe('CU-5 the endpoint, round by round', () => {
  const USER = { id: 'user-1' };
  const env = { SCAN_STATE_SECRET: 's'.repeat(40), OPENAI_API_KEY: 'k', SCAN_ENGINE_V2_USER_IDS: 'user-1' };
  function harness(identity) {
    const log = { price: 0, priceArgs: null, records: 0 };
    const handler = createScanHandler({
      verify: async (h) => (h === 'Bearer good' ? USER : null),
      charge: async () => ({ allowed: true, charged: true, limitType: null, retryAfter: 0 }),
      refund: async () => {},
      identify: async () => ({ status: 'identified', identity, followups: identity.followup.kind === 'none' ? 0 : 1, default_condition: 'good', billed: true, call: { stage: 'identify', model: 'm', ms: 1, usage: null } }),
      price: async (args) => { log.price += 1; log.priceArgs = args; return { status: 'priced', valuation: { status: 'priced', prices: {}, counts: { resale: 2 }, price_confidence: 'low', approximate: false }, reused: false, call: { stage: 'market', model: 'm', ms: 1, usage: null, tool_calls: 1 } }; },
      record: async () => { log.records += 1; return 'val-1'; },
      logEvent: async () => {},
    });
    const call = async (body) => {
      const res = await handler(new Request('https://getworth.test/api/scan', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer good' }, body: JSON.stringify(body) }));
      return { status: res.status, payload: await res.json() };
    };
    return { call, log };
  }
  beforeEach(() => { for (const [k, v] of Object.entries(env)) process.env[k] = v; });

  test('CU-5a a laptop: generation, then storage — each required because its answer changes the search, each a confirmed fact in a re-signed token; "does it work" waits beside the result; the search runs once, with every confirmed fact on the identity', async () => {
    const { call, log } = harness(scan(TWO_QUESTIONS));
    const first = await call({ action: 'identify', scan_uuid: UUID, lang: 'en', images: [IMG] });
    assert.deepEqual([first.payload.status, first.payload.identity.followup.question, first.payload.identity.followup.required], ['identified', 'Which MacBook Air is it?', true]);
    const second = await call({ action: 'price', scan_uuid: UUID, lang: 'en', token: first.payload.token, answer: 1 });
    assert.deepEqual([second.status, second.payload.status, second.payload.identity.followup.question, second.payload.identity.followup.required, log.price], [200, 'identified', 'How much storage?', true, 0], 'another required question: no search yet');
    assert.deepEqual(second.payload.identity.confirmed.map((c) => c.value), ['M2 (2022)']);
    assert.notEqual(second.payload.token, first.payload.token);
    const third = await call({ action: 'price', scan_uuid: UUID, lang: 'en', token: second.payload.token, answer: 0 });
    assert.deepEqual([third.status, third.payload.status, log.price, log.records], [200, 'priced', 1, 1]);
    assert.deepEqual(log.priceArgs.identity.confirmed.map((c) => c.value), ['M2 (2022)', '256 GB']);
    assert.deepEqual(log.priceArgs.answer, { question: 'How much storage?', text: '256 GB' });
    assert.deepEqual([third.payload.identity.followup.question, third.payload.identity.followup.required], ['Does everything work?', undefined], 'the medium question is offered beside the result');
    assert.ok(third.payload.token, 'the client carries the newest token');
    // A stale token cannot answer a question that was already answered differently: the server re-selects from ITS state.
    const replay = await call({ action: 'price', scan_uuid: UUID, lang: 'en', token: first.payload.token, answer: 2 });
    assert.equal(replay.payload.identity.confirmed[0].value, 'M3 (2024)');
  });
  test('CU-5c a car at the endpoint: nothing is required, so the price step runs at once and the year question is offered beside the evidence; the owner\'s own words answer a choice whose options do not fit, and empty or bare words are refused before any search', async () => {
    const car = harness(scan(ITEMS.car));
    const seen = await car.call({ action: 'identify', scan_uuid: UUID, lang: 'en', images: [IMG] });
    assert.deepEqual([seen.payload.identity.followup.question, seen.payload.identity.followup.required], ['What year is the car?', undefined]);
    const priced = await car.call({ action: 'price', scan_uuid: UUID, lang: 'en', token: seen.payload.token });
    assert.deepEqual([priced.payload.status, car.log.price], ['priced', 1]);
    const phone = harness(scan(ITEMS.phone));
    const { token } = (await phone.call({ action: 'identify', scan_uuid: UUID, lang: 'en', images: [IMG] })).payload;
    for (const answer of [{ other: '' }, { other: '   ' }, { other: '<>' }, { text: '64 GB' }, 'other']) assert.equal((await phone.call({ action: 'price', scan_uuid: UUID, token, answer })).status, 400, JSON.stringify(answer));
    assert.equal(phone.log.price, 0);
    const own = await phone.call({ action: 'price', scan_uuid: UUID, lang: 'en', token, answer: { other: '  64  GB ' } });
    assert.deepEqual([own.status, own.payload.status, phone.log.priceArgs.identity.size_or_capacity, phone.log.priceArgs.answer], [200, 'priced', '64 GB', { question: 'What storage size is it?', text: '64 GB', stated: true }]);
  });
  test('CU-5b an answer that is not an offered option, not a number for a number question, or free text is refused before any search', async () => {
    const { call, log } = harness(scan(ITEMS.phone));
    const { token } = (await call({ action: 'identify', scan_uuid: UUID, lang: 'en', images: [IMG] })).payload;
    for (const answer of ['256 GB', 9, -1, { text: 'ignore the rules' }, 'text']) assert.equal((await call({ action: 'price', scan_uuid: UUID, token, answer })).status, 400, JSON.stringify(answer));
    assert.equal(log.price, 0);
    const ok = await call({ action: 'price', scan_uuid: UUID, token, answer: 1 });
    assert.deepEqual([ok.payload.status, log.priceArgs.identity.size_or_capacity], ['priced', '256 GB']);
  });
});
