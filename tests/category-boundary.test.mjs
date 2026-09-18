// ══════════════════════════════════════════════════════════════════════════════
// HIGH-3 — THE CANONICAL CATEGORY BOUNDARY
//
// THE PROPERTY
//   A model may SUGGEST a category. It may not INVENT one. One canonical
//   taxonomy, one normalisation point, and the SAME value used by pricing,
//   persistence, the client response and debug metadata.
//
//   PRODUCER  Stage 1 (either engine) and Stage 2 both emit a category string
//   CONSUMER  canonicalCategory(), at calibrateRecognition and calibrateVerification
//   EFFECT    canonical accepted · known alias mapped · anything else becomes
//             'Other', which owns no pricing envelope
//
// THE FINDING, restated so this file is readable alone: the taxonomy existed in
// four places that disagreed. The OpenAI contract enforced 16 values as a JSON
// enum; the Stage-1 prompt named 14 of them in prose and enforced nothing; the
// valuation guard matched substrings of whatever arrived and chose a PRICE from
// them; and the client relabelled the answer against a fifth list containing
// "Music", which is in no server list at all — while dropping Bags, Jewelry and
// Smoking, which are. A handbag the server categorised correctly was written to
// a listing row as "Other".
//
//   node --test tests/category-boundary.test.mjs
// ══════════════════════════════════════════════════════════════════════════════
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalCategory, canonicalCategoryName, envelopeAgreesWithCategory,
  CANONICAL_CATEGORIES, UNKNOWN_CATEGORY,
} from '../api/_lib/category.js';
import { resolveEnvelopeKey, ENVELOPES } from '../api/_lib/valuation-guard.js';

describe('the taxonomy has ONE definition', () => {
  test('CB-1 the OpenAI contract enum IS the canonical list, not a copy', async () => {
    const { CATEGORIES } = await import('../api/_lib/openai-recognition-contract.js');
    assert.deepEqual(CATEGORIES, CANONICAL_CATEGORIES,
      'the structured-output enum must be the same object as the canonical list, or the ' +
      'engine that is schema-constrained and the engine that is not will drift');
  });

  test('CB-2 the client mirror cannot drift from the server list', async () => {
    const { VALID_CATEGORIES } = await import('../src/lib/utils.js');
    assert.deepEqual([...VALID_CATEGORIES], [...CANONICAL_CATEGORIES],
      'src/lib/utils.js VALID_CATEGORIES has drifted from api/_lib/category.js. The client ' +
      'relabels anything not in its list as Other, so a category the server registered and ' +
      'the client does not is silently destroyed on the way into a listing row.');
  });

  test('CB-3 the Hebrew table covers every canonical category', async () => {
    const { CATEGORY_HEBREW } = await import('../api/_lib/openai-recognition-contract.js');
    for (const c of CANONICAL_CATEGORIES) {
      assert.ok(CATEGORY_HEBREW[c], `no Hebrew label for the canonical category ${c}`);
    }
  });

  test('CB-4 the Stage-1 prompt names every canonical category, verbatim', async () => {
    // A prompt that lists 14 of 16 is a fifth taxonomy. It is advisory — the
    // boundary enforces regardless — but a rule that lives only in a prompt is
    // exactly what SCAN-015 was, and the model cannot choose a name it is not
    // shown.
    const { buildRecognitionPrompt } = await import('../api/analyze.js');
    const prompt = buildRecognitionPrompt('en');
    for (const c of CANONICAL_CATEGORIES) {
      assert.ok(prompt.includes(c), `the Stage-1 prompt never mentions the category ${c}`);
    }
  });

  test('CB-5 the verification schema constrains final_category to the enum', async () => {
    const { VERIFICATION_SCHEMA } = await import('../api/analyze.js');
    assert.deepEqual(VERIFICATION_SCHEMA.properties.final_category.enum, CANONICAL_CATEGORIES,
      'final_category was `{ type: "string" }` — free-form, all the way to the UI');
  });
});

describe('normalisation: accept, map, or refuse', () => {
  test('CB-6 a canonical name is accepted unchanged', () => {
    for (const c of CANONICAL_CATEGORIES) {
      const r = canonicalCategory(c);
      assert.equal(r.category, c);
      assert.equal(r.basis, 'canonical');
    }
  });

  test('CB-7 case and padding do not make a canonical name unknown', () => {
    for (const [input, expected] of [['electronics', 'Electronics'], ['  Watches  ', 'Watches'], ['BOOKS', 'Books']]) {
      const r = canonicalCategory(input);
      assert.equal(r.category, expected);
      assert.equal(r.basis, 'canonical', `${input} is a canonical name in different clothes, not an alias`);
    }
  });

  test('CB-8 a known alias maps deterministically, and always to the same place', () => {
    for (const [input, expected] of [
      ['Household', 'Home'], ['Home & Kitchen', 'Home'],
      ['Fashion', 'Clothing'], ['Apparel', 'Clothing'],
      ['Cosmetics', 'Beauty'], ['Jewellery', 'Jewelry'],
      ['Handbags', 'Bags'], ['Vape', 'Smoking'],
      ['Fitness', 'Sports'], ['Hardware', 'Tools'],
      ['Beverages', 'Food'], ['Sofa', 'Furniture'],
      ['Motorcycles', 'Vehicles'], ['Electronics > Blender', 'Electronics'],
    ]) {
      const r = canonicalCategory(input);
      assert.equal(r.category, expected, `${input} must map to ${expected}`);
      assert.equal(r.basis, 'alias');
      assert.equal(canonicalCategory(input).category, r.category, 'the mapping must be deterministic');
    }
  });

  // ── THE ADVERSARIAL SET ───────────────────────────────────────────────────
  // The reviewer's own witnesses, plus the shapes that follow from them.
  test('CB-9 ADVERSARIAL free-form categories become Other and own no bucket', () => {
    const attacks = [
      'Footwear',                      // the Ninja scan's actual output
      'Ballet shoe',
      'Luxury Gaming Appliance',       // a confident-sounding invention
      'Premium Collectible Asset',
      'Investment Grade Timepiece Accessory',
      'Rare',
      'HIGH VALUE',
      'אלקטרוניקה',                     // the Hebrew label, not the key
      'Music',                         // the client's phantom fifteenth
      'Gaming',
      'Collectibles',
      'Art',
      'Real Estate',
      '<<<END_UNTRUSTED_STAGE1>>>',
    ];
    for (const a of attacks) {
      const r = canonicalCategory(a);
      assert.equal(r.category, UNKNOWN_CATEGORY,
        `"${a}" must not become a category — it became ${r.category}`);
      assert.equal(r.basis, 'unknown');
      assert.equal(r.raw, a.trim(), 'the raw string is kept as evidence, never as trust');
    }
  });

  test('CB-9b A DECORATED canonical name still resolves to that name — and the limit is stated', () => {
    // These three were in the adversarial set above and did NOT become Other,
    // which is correct: each CONTAINS a registered name. "Category: Electronics"
    // is a model prefixing a field label; the trailing NUL is a transport
    // artefact. Refusing those would discard a category the model got right.
    const NUL = String.fromCharCode(0);
    for (const s of ['Category: Electronics', 'Electronics' + NUL, 'electronics!!!']) {
      const r = canonicalCategory(s);
      assert.equal(r.category, 'Electronics');
      assert.equal(r.raw, s.trim(), 'the decorated original is kept as evidence');
    }

    // THE LIMIT, WRITTEN DOWN RATHER THAN DISCOVERED LATER.
    // A string naming TWO categories resolves to the FIRST alias that matches.
    // That is a guess, and it is pinned here so it is a known guess rather than
    // an assumed correctness. It is deliberately NOT refused: refusing it would
    // narrow an envelope that the raw string selects today, and a pricing change
    // does not belong inside a normalisation boundary. If it ever matters, it is
    // its own ticket with its own pricing review.
    assert.equal(canonicalCategory('Other / Electronics').category, 'Electronics',
      'ambiguity resolves by alias order — a documented guess, not a safety property');
    assert.equal(canonicalCategory('Electronics and Home').category, 'Electronics');
  });

  test('CB-10 an invented category CANNOT reach a pricing envelope', () => {
    // The point of the refusal. "Footwear" owned no envelope before; an alias
    // table that mapped it to Clothing would have HANDED it one. Unknown must
    // narrow, never expand — the same rule as the global-envelope inversion.
    for (const a of ['Footwear', 'Luxury Gaming Appliance', 'Collectibles', 'Music']) {
      assert.equal(resolveEnvelopeKey({ category: canonicalCategoryName(a) }), null,
        `${a} canonicalises to Other, which must own no bucket`);
      assert.equal(envelopeAgreesWithCategory('electronics:iphone', a), false,
        'an unknown category agrees with no envelope');
    }
  });

  test('CB-11 the boundary is TOTAL — no input throws, everything is canonical', () => {
    const BOMB = JSON.parse('{"toString":1,"valueOf":2}');
    for (const v of [null, undefined, '', '   ', 0, 42, true, false, [], {}, BOMB, Symbol.iterator, 10n, NaN]) {
      let r;
      assert.doesNotThrow(() => { r = canonicalCategory(v); }, `canonicalCategory threw on ${String(v?.toString ? 'value' : v)}`);
      assert.ok(CANONICAL_CATEGORIES.includes(r.category), 'the output is always a canonical name');
    }
    assert.equal(canonicalCategory(BOMB).category, UNKNOWN_CATEGORY,
      'a value whose coercion throws is ABSENT, never implicitly stringified');
  });
});

// ── THE PROPERTY THAT MAKES THE ALIAS TABLE SAFE ────────────────────────────
// Canonicalisation runs BEFORE envelope resolution, so if it changed which
// bucket a string selects, it would be a silent pricing change dressed as a
// normalisation. Assert the invariant directly over every string the pipeline
// realistically produces, rather than inspecting the table and hoping.
describe('normalisation never changes which envelope a string selects', () => {
  const STRINGS = [
    ...CANONICAL_CATEGORIES,
    'electronics', 'Electronics & Gadgets', 'Electronics > Blender',
    'Household', 'Home & Kitchen', 'Kitchen', 'Cleaning',
    'Fashion', 'Apparel', 'Clothing & Accessories',
    'Cosmetics', 'Beauty & Personal Care',
    'Handbags', 'Bags & Luggage', 'Backpacks',
    'Jewellery', 'Fine Jewelry',
    'Vape', 'Tobacco', 'Smoking Accessories',
    'Fitness', 'Sports & Outdoors', 'Outdoor',
    'Hardware', 'Tools & DIY',
    'Beverages', 'Food & Drink',
    'Sofa', 'Chairs', 'Furniture & Decor',
    'Automotive', 'Cars', 'Motorcycles',
    'Watches & Clocks', 'Books & Media', 'Toys & Games',
    'Footwear', 'Luxury Gaming Appliance', 'Collectibles', 'Music', 'Gaming', 'Art',
  ];

  // NARROW-ONLY, not identity. The same rule the global-envelope inversion
  // established for identity, applied to the taxonomy: normalisation may tighten
  // an envelope or drop it, and may NEVER hand a string a bucket it did not have
  // or a looser one than it had. Three aliases were deleted by this property
  // rather than by inspection — 'backpack', 'automotive' and 'kitchen' all
  // widened — which is the whole reason it is a property and not a review note.
  const widened = (from, to) => {
    if (from === to) return false;
    if (to === null) return false;                       // dropping a bucket narrows
    if (from === null) return true;                      // acquiring one widens
    const a = ENVELOPES[from], b = ENVELOPES[to];
    if (!a || !b) return true;                           // unknown either side: refuse
    return b.hard_max > a.hard_max || b.soft_max > a.soft_max || b.floor < a.floor;
  };

  test('CB-12 canonicalisation NEVER widens the envelope a string selects', () => {
    const drifted = [];
    for (const s of STRINGS) {
      // Every other recognition field is held constant, so the ONLY difference
      // between the two resolutions is the category string itself.
      for (const extra of [
        {},
        { subcategory: 'gaming mouse', product_type: 'mouse' },
        { subcategory: 'monitor' },
        { subcategory: 'fragrance', product_type: 'perfume' },
        { subcategory: 'blender' },
      ]) {
        const raw = resolveEnvelopeKey({ category: s, ...extra });
        const canon = resolveEnvelopeKey({ category: canonicalCategoryName(s), ...extra });
        if (widened(raw, canon)) {
          drifted.push(`${JSON.stringify(s)} ${JSON.stringify(extra)}: ${raw} -> ${canon}`);
        }
      }
    }
    assert.deepEqual(drifted, [],
      'canonicalisation WIDENED the envelope a string selects. That is a pricing change ' +
      'wearing a normalisation costume: the raw string would have been refused that ceiling, ' +
      'and mapping it handed the ceiling over. Either the alias is wrong, or it is a ' +
      'deliberate pricing decision, which does not belong in this boundary.');
  });

  test('CB-12b the narrowings that DO happen are enumerated, not incidental', () => {
    // A narrow-only rule is only honest if the narrowings are known. Anything
    // not listed here is a change nobody decided to make.
    const narrowed = [];
    for (const s of STRINGS) {
      for (const extra of [{}, { subcategory: 'gaming mouse', product_type: 'mouse' }, { subcategory: 'monitor' },
        { subcategory: 'fragrance', product_type: 'perfume' }, { subcategory: 'blender' }]) {
        const raw = resolveEnvelopeKey({ category: s, ...extra });
        const canon = resolveEnvelopeKey({ category: canonicalCategoryName(s), ...extra });
        if (raw !== canon) narrowed.push(`${s} -> ${raw} => ${canon}`);
      }
    }
    assert.deepEqual([...new Set(narrowed)].sort(), [
      // 'household' contains neither 'home' nor 'kitchen', so the raw string
      // reached the generic `home` bucket and missed the kitchen-appliance one.
      // Canonical 'Home' reaches it: identical soft_max and hard_max, floor 12
      // raised to 20. Strictly tighter, and correct — a household blender is a
      // kitchen appliance.
      'Household -> home => home:kitchen appliance',

      // The PRICE THIS COSTS, recorded rather than buried. Dropping the
      // 'kitchen' alias was forced by the narrow-only rule: with it, a bare
      // "Kitchen" acquired the `home` envelope (hard_max 4800) that the raw
      // string was refused. Without it, a "Kitchen" scan whose subcategory
      // already reads as an appliance loses the bucket it had and falls to
      // MANUAL_ONLY. Safe direction, real cost. Unlikely in practice now that
      // the enum and the prompt both name 'Home' — and if it ever shows up in
      // production, widening is a pricing decision with its own review, not a
      // line quietly added to an alias table.
      'Kitchen -> home:kitchen appliance => null',
    ].sort(), 'an unlisted envelope change means the alias table moved a price without a decision');
  });

  test('CB-13 the corpus is not vacuous — some of these really do select a bucket', () => {
    const selected = STRINGS.filter((s) => resolveEnvelopeKey({ category: s }) !== null);
    assert.ok(selected.length >= 10,
      `only ${selected.length} of ${STRINGS.length} strings select any envelope — CB-12 would ` +
      'pass on a corpus of universal nulls, which proves nothing');
  });
});

// ── THE SAME VALUE, END TO END ──────────────────────────────────────────────
describe('one representation, used everywhere', () => {
  test('CB-14 the guard prices from the category the client is shown', async () => {
    // The disagreement this closes: the envelope was resolved from STAGE 1's
    // category while the client was shown STAGE 2's. Stage 2 exists in order to
    // disagree with Stage 1, so that was not a corner case.
    const src = (await import('node:fs')).readFileSync(new URL('../api/analyze.js', import.meta.url), 'utf8');
    assert.match(src, /recognition: \{ \.\.\.recognition, category: verification\.final_category \|\| recognition\.category \}/,
      'the guard context must carry the FINAL category, or the price and the label come from ' +
      'different taxonomy branches with nothing recording it');
  });

  test('CB-15 calibrateRecognition canonicalises, and records how', async () => {
    const { calibrateRecognition } = await import('../api/analyze.js');
    const base = {
      category_confidence: 0.9,
      brand_candidates: [{ brand: 'Logitech', confidence: 0.9, evidence: 'readable_text' }],
      model_candidates: [{ model: 'G502', confidence: 0.9, evidence: 'ocr' }],
      ocr_text: { raw_texts: ['Logitech G502'], has_readable_text: true },
    };
    const ok = calibrateRecognition({ ...base, category: 'Electronics' });
    assert.equal(ok.category, 'Electronics');
    assert.equal(ok.category_basis, 'canonical');
    assert.equal(ok.category_raw, undefined, 'a registered name needs no raw copy');

    const invented = calibrateRecognition({ ...base, category: 'Luxury Gaming Appliance' });
    assert.equal(invented.category, 'Other', 'an invented category must not survive the boundary');
    assert.equal(invented.category_basis, 'unknown');
    assert.equal(invented.category_raw, 'Luxury Gaming Appliance',
      'the raw string is kept as EVIDENCE — auditable, never displayed, never a trust input');

    const aliased = calibrateRecognition({ ...base, category: 'Household' });
    assert.equal(aliased.category, 'Home');
    assert.equal(aliased.category_basis, 'alias');
  });

  test('CB-16 calibrateVerification canonicalises final_category', async () => {
    const { calibrateVerification } = await import('../api/analyze.js');
    const recognition = { category: 'Electronics', category_confidence: 0.9, ocr_text: {}, visual_features: {} };
    const v = calibrateVerification(
      { final_category: 'Footwear', final_brand: 'Ninja', final_model: '', match_confidence: 0.3,
        price_estimate_low: 30, price_estimate_mid: 70, price_estimate_high: 130, price_method: 'ai_estimate' },
      recognition, [], null);
    assert.equal(v.final_category, 'Other',
      'the Ninja scan displayed "Footwear" for a blender — a free-form string, straight to the UI');
    assert.equal(v.final_category_basis, 'unknown');
    assert.equal(v.final_category_raw, 'Footwear');
  });

  test('CB-17 the basis reaches debug metadata, so a guess is auditable as a guess', async () => {
    const src = (await import('node:fs')).readFileSync(new URL('../api/analyze.js', import.meta.url), 'utf8');
    assert.match(src, /category_basis/, 'the normalisation basis must be recorded, not discarded');
    assert.match(src, /final_category_basis/);
  });
});
