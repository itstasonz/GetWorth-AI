// ══════════════════════════════════════════════════════════════════════════════
// ROUND-5 PROPERTIES
//
// Round 4 was green — 876 tests, 100% mutation, clean build — and an independent
// review found 4 CRITICAL and 3 HIGH. Three of those were in code round 4 had
// just written, and two of them were UNFALSIFIABLE: the compatibility rule was
// written against a Vision shape the parser cannot produce, and the provider
// rules had no test at all.
//
// So each block below records the witness that was REPRODUCED before the fix,
// and asserts the property from both sides. The fixtures are built by the
// production parser (tests/helpers/vision-fixture.mjs) so a test can no longer
// describe data that does not exist.
//
//   node --test tests/round5-properties.test.mjs
// ══════════════════════════════════════════════════════════════════════════════
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { visionData } from './helpers/vision-fixture.mjs';

const GUARD_URL = process.env.VAL001_GUARD_PATH
  ? new URL(`file://${process.env.VAL001_GUARD_PATH}`)
  : new URL('../api/_lib/valuation-guard.js', import.meta.url);
const G = await import(GUARD_URL.href);
const { validateQuote, derivePricingSource, resolveEnvelope, VALUATION_VERDICT } = G;

const AUTH_URL = process.env.VAL001_AUTHORITY_PATH
  ? new URL(`file://${process.env.VAL001_AUTHORITY_PATH}`)
  : new URL('../api/_lib/pricing-authority.js', import.meta.url);
const A = await import(AUTH_URL.href);
const { deriveEvidence, evidenceList } = A;

const { parseVisionResponse } = await import('../api/analyze.js');
const vd = (block, opts) => visionData(parseVisionResponse, block, opts);

const WATCH = {
  category: 'Watches', subcategory: 'watch', category_confidence: 0.9,
  brand_candidates: [{ brand: 'Rolex', confidence: 0.30 }],
  model_candidates: [{ model: 'Submariner', confidence: 0.30 }],
  ocr_text: { raw_texts: [] },
};
const WEAK_ID = { brandOk: true, modelOk: true, brandC: 0.30, modelC: 0.30 };

// ════════════════════════════════════════════════════════════════════════════
// V5-1 · THE CONSUMER C-1 MISSED
// ════════════════════════════════════════════════════════════════════════════
describe('R5-1 identity evidence buys no pricing authority, at EVERY consumer', () => {
  const PRICELESS = [
    ['{id}', { id: 'pc-77' }],
    ['approved candidate', { id: 'pc-77', retail_price_ils: null, avg_used_price_ils: null }],
    ['price 0', { retail_price_ils: 0 }],
    ['price -1', { retail_price_ils: -1 }],
    ['price NaN', { retail_price_ils: NaN }],
    ['price Infinity', { retail_price_ils: Infinity }],
    ['price -Infinity', { retail_price_ils: -Infinity }],
    ['price ""', { retail_price_ils: '' }],
    ['price "0"', { retail_price_ils: '0' }],
    ['price "100"', { retail_price_ils: '100' }],
    ['price []', { retail_price_ils: [] }],
    ['price {}', { retail_price_ils: {} }],
    ['price true', { retail_price_ils: true }],
    ['nested malformed', { retail_price_ils: { amount: { value: 900 } } }],
    ['missing field', { id: 'r', brand: 'Rolex' }],
    ['empty object', {}],
    ['a Date', new Date()],
  ];

  test('R5-1a requiresAnchorAboveSoft needs MARKET evidence — the reproduced witness', () => {
    // PRE-FIX: a priceless community row satisfied this gate and ₪240,000
    // shipped. `hasMarketAnchor` existed twelve lines above it and was not used;
    // the BUCKET_AUTHORITY comment said the rule "still applies on top,
    // unchanged" — unchanged meaning it still applied to any object at all.
    const seen = vd('ROLEX\nSUBMARINER');
    const quote = { low: 200000, mid: 240000, high: 250000, currency: 'ILS' };
    for (const [label, anchor] of PRICELESS) {
      const v = validateQuote(quote, { stage: 'stage2', identity: WEAK_ID, recognition: WATCH,
        anchor, evidence: deriveEvidence({ recognition: WATCH, visionData: seen, anchor }).classes });
      assert.equal(v.prices.mid, 0, `${label} shipped ₪${v.prices.mid}`);
      assert.notEqual(v.action, 'accept', label);
    }
    // And with no anchor at all, for the baseline.
    assert.equal(validateQuote(quote, { stage: 'stage2', identity: WEAK_ID, recognition: WATCH,
      evidence: deriveEvidence({ recognition: WATCH, visionData: seen }).classes }).prices.mid, 0);
  });

  test('R5-1b a genuinely PRICED row is still honoured — the positive control', () => {
    // Without this the fix would be indistinguishable from "refuse everything".
    const priced = { id: 'r', retail_price_ils: 60000 };
    const e = resolveEnvelope({ recognition: WATCH, identity: WEAK_ID, anchor: priced });
    assert.equal(e.basis, 'anchor', 'a priced row governs the envelope');
    assert.ok(e.hard_max > 0 && Number.isFinite(e.hard_max));
    assert.equal(derivePricingSource({ stage: 'stage2', anchor: priced }).source, 'stage2_comp_anchored');
  });

  test('R5-1c no priceless shape lifts the pre_catalog grade either', () => {
    // The consumer the mechanical inventory found, which no reviewer reported:
    // `anchorModelEvidence` is `!!guardAnchor?.model`, so a priceless row with a
    // model column lifted pre_catalog from LOW to MEDIUM.
    for (const [label, anchor] of PRICELESS) {
      assert.equal(derivePricingSource({ stage: 'pre', pre_source: 'catalog',
        anchor: { ...(anchor && typeof anchor === 'object' ? anchor : {}), model: 'Submariner' },
        anchorModelEvidence: true }).grade, 'LOW', label);
    }
    assert.equal(derivePricingSource({ stage: 'pre', pre_source: 'catalog',
      anchor: { model: 'S', retail_price_ils: 900 }, anchorModelEvidence: true }).grade, 'MEDIUM',
      'a priced row with a model column still earns MEDIUM');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// R5-C1 · COMPATIBILITY TEXT IS NOT SUBJECT IDENTITY
// ════════════════════════════════════════════════════════════════════════════
describe('R5-2 an accessory does not become the product it fits', () => {
  const ACCESSORIES = [
    ['replacement strap / Rolex', 'Rolex', 'Submariner', 'Replacement strap compatible with Rolex Submariner'],
    ['case for iPhone', 'Apple', 'iPhone 16 Pro', 'Case for iPhone 16 Pro'],
    ['charger for MacBook', 'Apple', 'MacBook Pro', 'Charger for MacBook Pro'],
    ['filter for Dyson', 'Dyson', 'V11', 'Filter compatible with Dyson V11'],
    ['blade for Ninja', 'Ninja', 'Detect Power Blender Pro', 'Replacement blade for Ninja blender'],
    ['band for Apple Watch', 'Apple', 'Watch Series 9', 'Band for Apple Watch Series 9'],
    ['protector for Samsung', 'Samsung', 'Galaxy S24', 'Screen protector for Samsung Galaxy S24'],
    ['ink for HP', 'HP', 'OfficeJet 8000', 'Ink for HP OfficeJet 8000'],
  ];
  const ev = (brand, model, block) => evidenceList({
    recognition: { brand_candidates: [{ brand }], model_candidates: [{ model }], ocr_text: { raw_texts: [] } },
    visionData: vd(block),
  });

  test('R5-2a no accessory label establishes the host product', () => {
    // THE REPRODUCED WITNESS. `visionData.text` is per-WORD — the parser maps
    // textAnnotations[1..], which Google returns as individual words. Round 4's
    // "per line, contiguous" rule was applied to a list where every "line" was
    // one word, so the compatibility token sat alone, was dropped alone, and
    // every other word survived as a clean line. A replacement strap established
    // BRAND_TEXT + PRODUCT_TEXT and reached watches:luxury, hard_max 250,000.
    for (const [label, brand, model, block] of ACCESSORIES) {
      const got = ev(brand, model, block);
      assert.deepEqual(got, ['DERIVED'], `${label} established ${got.join('+')}`);
    }
  });

  test('R5-2d a per-word array with NO line structure establishes NOTHING', () => {
    // Found by mutation: every fixture above is built by the parser, which always
    // sets ocr_context.full_text — so nothing exercised the fallback, and a mutant
    // that restored "use the flat array when full_text is missing" survived.
    //
    // The fail-closed rule matters because the flat array is the shape that
    // defeated round 4: with no line structure, the relationship between a
    // compatibility marker and the words around it cannot be established at all.
    // It may refute; it may not corroborate.
    const perWord = { text: ['Replacement', 'strap', 'for', 'ROLEX', 'SUBMARINER'] };
    assert.deepEqual(evidenceList({
      recognition: { brand_candidates: [{ brand: 'Rolex' }],
        model_candidates: [{ model: 'Submariner' }], ocr_text: { raw_texts: [] } },
      visionData: perWord }), ['DERIVED'],
      'a per-word array with no block must not corroborate');
    // Even a clean one: without the block we cannot tell a label from a sentence.
    assert.deepEqual(evidenceList({
      recognition: { brand_candidates: [{ brand: 'Rolex' }], ocr_text: { raw_texts: [] } },
      visionData: { text: ['ROLEX'] } }), ['DERIVED']);
    // Logos are exempt — a logo is a mark on the object, not a sentence about one.
    assert.deepEqual(evidenceList({
      recognition: { brand_candidates: [{ brand: 'Rolex' }], ocr_text: { raw_texts: [] } },
      visionData: { logos: [{ description: 'Rolex', score: 0.95 }] } }),
      ['OBJECT_CLASS', 'BRAND_TEXT', 'DERIVED'],
      'a logo is both a classifier signal and a mark READ off the object');
  });

  test('R5-2b a GENUINE label still works — the fix is not "refuse all text"', () => {
    assert.deepEqual(ev('Rolex', 'Submariner', 'ROLEX\nSUBMARINER'),
      ['BRAND_TEXT', 'PRODUCT_TEXT', 'DERIVED']);
    assert.deepEqual(ev('Ninja', 'Detect Power Blender Pro', 'NINJA\nDetect Power Blender Pro'),
      ['BRAND_TEXT', 'PRODUCT_TEXT', 'DERIVED']);
    assert.deepEqual(ev('Louis Vuitton', 'Imagination', 'LOUIS VUITTON\nIMAGINATION'),
      ['BRAND_TEXT', 'PRODUCT_TEXT', 'DERIVED']);
  });

  test('R5-2c the accessory cannot reach the host product’s bucket', () => {
    // The money consequence, stated end of chain rather than left implied.
    const strap = { category: 'Watches', subcategory: 'watch', category_confidence: 0.9,
      brand_candidates: [{ brand: 'Rolex', confidence: 0.9 }],
      model_candidates: [{ model: 'Submariner', confidence: 0.9 }], ocr_text: { raw_texts: [] } };
    const accessory = vd('Replacement strap compatible with Rolex Submariner');
    const genuine = vd('ROLEX\nSUBMARINER');
    const key = (v) => resolveEnvelope({ recognition: strap, identity: WEAK_ID,
      evidence: deriveEvidence({ recognition: strap, visionData: v }).classes }).key;
    assert.equal(key(accessory), 'watches', 'a strap is bounded by the ordinary watches bucket');
    assert.equal(key(genuine), 'watches:luxury', 'and a genuine dial still reaches the luxury one');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// R5-H1 · THE MARKET'S OWN LANGUAGE
// ════════════════════════════════════════════════════════════════════════════
describe('R5-3 compatibility is recognised in the languages this market writes', () => {
  const ev = (brand, model, block) => evidenceList({
    recognition: { brand_candidates: [{ brand }], model_candidates: [{ model }], ocr_text: { raw_texts: [] } },
    visionData: vd(block),
  });

  test('R5-3a Hebrew, mixed and European compatibility text establishes nothing', () => {
    // THE REPRODUCED WITNESS. `words()` split on /[^a-z0-9]+/ AFTER lowercasing,
    // so every Hebrew character was a separator and was DELETED — the line read
    // as a bare "Apple iPhone". The filter was not merely English-only; the text
    // it was meant to read did not survive to it. In an ILS marketplace the
    // primary market's own wording was a total bypass.
    const CASES = [
      ['תואם ל (compatible with)', 'Apple', 'iPhone 16 Pro', 'תואם ל Apple iPhone 16 Pro'],
      ['מתאים ל (suitable for)', 'Apple', 'iPhone 16 Pro', 'מתאים ל Apple iPhone 16 Pro'],
      ['רצועה לשעון (watch strap)', 'Rolex', 'Submariner', 'רצועה לשעון Rolex Submariner'],
      ['כיסוי לאייפון (case)', 'Apple', 'iPhone 16 Pro', 'כיסוי לאייפון Apple iPhone 16 Pro'],
      ['מטען למקבוק (charger)', 'Apple', 'MacBook Pro', 'מטען למקבוק Apple MacBook Pro'],
      ['פילטר לדייסון (filter)', 'Dyson', 'V11', 'פילטר לדייסון Dyson V11'],
      ['mixed: רצועה תואמת Rolex', 'Rolex', 'Submariner', 'רצועה תואמת Rolex Submariner'],
      ['mixed: כיסוי ל-iPhone', 'Apple', 'iPhone 16 Pro', 'כיסוי ל-iPhone 16 Pro'],
      ['French', 'Apple', 'iPhone', 'pour Apple iPhone'],
      ['Spanish', 'Apple', 'iPhone', 'para Apple iPhone'],
      ['German', 'Apple', 'iPhone', 'für Apple iPhone'],
      ['Arabic', 'Apple', 'iPhone', 'ل Apple iPhone'],
      ['Cyrillic', 'Apple', 'iPhone', 'для Apple iPhone'],
      ['fullwidth for', 'Apple', 'iPhone', 'ｆｏｒ Apple iPhone'],
    ];
    for (const [label, brand, model, block] of CASES) {
      const got = ev(brand, model, block);
      assert.deepEqual(got, ['DERIVED'], `${label} established ${got.join('+')}`);
    }
  });

  test('R5-3d the RTL preposition PREFIX is load-bearing on its own', () => {
    // Found by mutation. Every Hebrew case above also carried a marker word
    // (תואם) or an accessory noun (רצועה, כיסוי), so deleting the prefix rule
    // changed nothing and the mutant survived. Hebrew and Arabic attach "for" to
    // the FOLLOWING word — לאייפון is one token meaning "for iPhone" — and a set
    // of whole words cannot match it. These lines carry nothing else.
    const bare = (brand, model, block) => evidenceList({
      recognition: { brand_candidates: [{ brand }], model_candidates: [{ model }],
        ocr_text: { raw_texts: [] } },
      visionData: vd(block) });
    for (const [brand, model, block] of [
      ['Apple', 'iPhone 16 Pro', 'לאייפון 16 Pro'],
      ['Apple', 'MacBook Pro', 'למקבוק Pro'],
      ['Dyson', 'V11', 'לדייסון V11'],
      ['Apple', 'iPhone', 'لآيفون Apple iPhone'],
    ]) {
      assert.deepEqual(bare(brand, model, block), ['DERIVED'], block);
    }
    // The narrowing that came with it: מ and כ mean "from" and "as", not "for",
    // and must NOT suppress a legitimate Hebrew line.
    assert.deepEqual(
      bare('נינג׳', 'Detect Power Blender Pro', 'נינג׳\nDetect Power Blender Pro'),
      ['BRAND_TEXT', 'PRODUCT_TEXT', 'DERIVED']);
  });

  test('R5-3b an accessory NOUN is a relationship even with no preposition', () => {
    for (const [brand, model, block] of [
      ['Apple', 'MacBook Pro', 'מטען MacBook Pro'],
      ['Apple', 'MacBook Pro', 'Charger MacBook Pro'],
      ['Rolex', 'Submariner', 'רצועה Rolex Submariner'],
    ]) {
      assert.deepEqual(ev(brand, model, block), ['DERIVED'], block);
    }
  });

  test('R5-3c a non-Latin label is TOKENISED, not erased', () => {
    // The tokeniser change, observed directly: a Hebrew brand read off the item
    // must still be able to corroborate a Hebrew brand candidate. Before, both
    // sides were deleted and the comparison was between two empty lists.
    assert.deepEqual(
      ev('נינג׳', 'Detect Power Blender Pro', 'נינג׳\nDetect Power Blender Pro'),
      ['BRAND_TEXT', 'PRODUCT_TEXT', 'DERIVED'],
      'a Hebrew brand on the item must corroborate a Hebrew brand candidate');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// A5-1 · ONE EVIDENCE VOCABULARY
// ════════════════════════════════════════════════════════════════════════════
describe('R5-6 every evidence class survives to the record', () => {
  test('R5-6a producer and guard serialise the SAME set', () => {
    // PRE-FIX: `evidenceList` returned CATALOG_IDENTITY+DERIVED and the guard's
    // own hard-coded list returned DERIVED. Two serialisers for one set, and the
    // guard's is the copy that reaches the client, ai_raw_response and the
    // ledger — so the single best /api/enrich input (a compatible row whose id we
    // already hold) was indistinguishable from no row at all.
    const cases = [
      { anchor: { id: 'pc', retail_price_ils: null } },
      { anchor: { id: 'r', retail_price_ils: 900 } },
      { visionData: { labels: [{ description: 'Laptop', score: 0.9 }] } },
      { recognition: { brand_candidates: [{ brand: 'Rolex' }] }, visionData: vd('ROLEX') },
      {},
    ];
    for (const input of cases) {
      const classes = deriveEvidence(input).classes;
      const produced = evidenceList(classes);
      const v = validateQuote({ low: 280, mid: 400, high: 560, currency: 'ILS' }, {
        stage: 'stage2', identity: { brandOk: true, modelOk: true, brandC: 0.9, modelC: 0.9 },
        recognition: { category: 'Home', category_confidence: 0.9 },
        anchor: input.anchor ?? null, evidence: classes,
      });
      assert.deepEqual(v.metadata.evidence, produced,
        `serialisers disagree for ${JSON.stringify(input)}`);
    }
  });

  test('R5-6b CATALOG_IDENTITY survives, and does NOT become ANCHOR', () => {
    const classes = deriveEvidence({ anchor: { id: 'pc-77', retail_price_ils: null } }).classes;
    assert.ok(classes.has('CATALOG_IDENTITY'));
    assert.ok(!classes.has('ANCHOR'), 'the round-5 fix must not reopen V5-1');
    const v = validateQuote({ low: 280, mid: 400, high: 560, currency: 'ILS' }, {
      stage: 'stage2', identity: { brandOk: true, modelOk: true, brandC: 0.9, modelC: 0.9 },
      recognition: { category: 'Home', category_confidence: 0.9 },
      anchor: { id: 'pc-77', retail_price_ils: null }, evidence: classes });
    assert.ok(v.metadata.evidence.includes('CATALOG_IDENTITY'), 'it must reach the record');
    assert.equal(v.metadata.valuation_verdict, VALUATION_VERDICT.PENDING_MARKET);
    assert.equal(v.prices.mid, 0);
  });
});
