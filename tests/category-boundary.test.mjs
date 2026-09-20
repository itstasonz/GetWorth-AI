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
import { readFileSync } from 'node:fs';
import {
  canonicalCategory, canonicalCategoryName, aliasVocabulary,
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
      ['Vape', 'Smoking'],
      ['Fitness', 'Sports'], ['Hardware', 'Tools'],
      ['Beverages', 'Food'], ['Sofa', 'Furniture'], ['Bag', 'Bags'],
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
describe('normalisation never widens the envelope a string selects', () => {
  // ══ THE CORPUS IS GENERATED, AND THE REASON IS A FINDING ════════════════
  // This property first ran against a HAND-LISTED corpus, and an independent
  // reviewer walked straight past it: the `gadget` alias widened "Gadget" from
  // no bucket to `electronics`, and no hand-listed corpus contained the word.
  // A property tested against remembered inputs tests the memory.
  //
  // The vocabulary now comes from the two places that can actually produce a
  // mapping, and from nowhere else:
  //   1. `aliasVocabulary()` — every literal the alias table matches on, derived
  //      from the table itself, so a new alias brings its own test words.
  //   2. the `cat.includes('…')` literals READ OUT OF the valuation guard's
  //      source, so a new envelope matcher brings its own test words too.
  // Neither list can be updated without updating this corpus, because neither
  // is written down here.
  const GUARD_SRC = readFileSync(new URL('../api/_lib/valuation-guard.js', import.meta.url), 'utf8');
  const MATCHER_WORDS = [...new Set(
    [...GUARD_SRC.matchAll(/cat\.includes\('([^']+)'\)/g)].map((m) => m[1]),
  )];

  const VOCAB = [...new Set([
    ...CANONICAL_CATEGORIES.map((c) => c.toLowerCase()),
    ...aliasVocabulary(),
    ...MATCHER_WORDS,
  ])];

  // Each word in the shapes a model actually emits: bare, plural, title case,
  // joined with another canonical name, and as a path or a marketing phrase.
  const DECORATIONS = [
    (w) => w,
    (w) => (w.endsWith('s') ? w : w + 's'),   // never 'carss'; see CB-12d
    (w) => w[0].toUpperCase() + w.slice(1),
    (w) => w + ' & Accessories',
    (w) => 'Consumer ' + w,
    (w) => w + ' > Misc',
    (w) => 'Other / ' + w,
  ];
  const CONTEXTS = [
    {},
    { subcategory: 'gaming mouse', product_type: 'mouse' },
    { subcategory: 'monitor' },
    { subcategory: 'laptop' },
    { subcategory: 'fragrance', product_type: 'perfume' },
    { subcategory: 'blender' },
    { subcategory: 'watch' },
  ];
  const STRINGS = [...new Set(VOCAB.flatMap((w) => DECORATIONS.map((d) => d(w))))];

  // NARROW-ONLY, not identity. Normalisation may tighten a bucket or drop it,
  // and may never hand a string one it did not have or a looser one than it had.
  const widened = (from, to) => {
    if (from === to) return false;
    if (to === null) return false;                       // dropping a bucket narrows
    if (from === null) return true;                      // acquiring one widens
    const a = ENVELOPES[from], b = ENVELOPES[to];
    if (!a || !b) return true;                           // unknown either side: refuse
    return b.hard_max > a.hard_max || b.soft_max > a.soft_max || b.floor < a.floor;
  };

  test('CB-12 canonicalisation NEVER widens, over a generated corpus', () => {
    const drifted = [];
    for (const str of STRINGS) {
      for (const extra of CONTEXTS) {
        const raw = resolveEnvelopeKey({ category: str, ...extra });
        const canon = resolveEnvelopeKey({ category: canonicalCategoryName(str), ...extra });
        if (widened(raw, canon)) drifted.push(`${JSON.stringify(str)} ${JSON.stringify(extra)}: ${raw} -> ${canon}`);
      }
    }
    assert.deepEqual(drifted.slice(0, 12), [],
      `${drifted.length} of ${STRINGS.length * CONTEXTS.length} pairs WIDENED. That is a pricing ` +
      'change wearing a normalisation costume: the raw string would have been refused that ' +
      'ceiling, and mapping it handed the ceiling over.');
  });

  test('CB-12b the corpus is large, derived, and NOT vacuous', () => {
    // Three ways this property could pass while proving nothing, all refused.
    assert.ok(STRINGS.length >= 200,
      `the generated corpus is only ${STRINGS.length} strings — too small to be doing work`);
    assert.ok(MATCHER_WORDS.length >= 20,
      `only ${MATCHER_WORDS.length} matcher words were read out of the guard source; the ` +
      'extraction regex has probably stopped matching');
    for (const w of ['electron', 'household', 'jewel', 'vape', 'motor']) {
      assert.ok(MATCHER_WORDS.includes(w) || VOCAB.includes(w), `the corpus lost the word ${w}`);
    }
    const selecting = STRINGS.filter((s) => resolveEnvelopeKey({ category: s }) !== null);
    assert.ok(selecting.length >= 30,
      `only ${selecting.length} corpus strings select any envelope — CB-12 would pass on a ` +
      'corpus of universal nulls');
    // And the withdrawn aliases must still be refused, by name.
    for (const w of ['Gadget', 'Backpacks', 'Automotive', 'Kitchen']) {
      assert.equal(canonicalCategoryName(w), 'Other', `${w} was removed as a widening alias`);
    }
  });

  test('CB-12d the guard names CATEGORIES, it does not match letters — N-4', () => {
    // WAS: this test asserted the DEFECT. It pinned `resolveEnvelopeKey({category:
    // 'Caravan'}) === 'vehicles'` and called the disagreement with the alias
    // table a safe narrowing — true as far as it went, and it meant the suite
    // was holding a substring coincidence in place. "Scorecard" selected the
    // vehicles envelope. "Tablet" selected FURNITURE, hard_max 16,000, because
    // "tablet" contains "table"; that one CB-12 could never surface, because
    // both the raw and the canonical string agreed on the same wrong answer.
    //
    // The matchers now declare a match mode per token, so a coincidence in the
    // letters cannot select a bucket. What this test observes is the behaviour,
    // not the mode table: each string below WOULD have been matched by the old
    // substring rule and must no longer be.
    const COINCIDENCES = [
      ['Caravan',   'car'],    ['Railcar',  'car'],    ['Scorecard', 'car'],
      ['Cardigan',  'car'],    ['Carpet',   'car'],    ['Cartoon',   'car'],
      ['Watchdog',  'watch'],  ['Tablecloth', 'table'],
    ];
    for (const [s0, letters] of COINCIDENCES) {
      assert.ok(s0.toLowerCase().includes(letters),
        `${s0} must actually contain "${letters}", or this case proves nothing`);
      assert.equal(resolveEnvelopeKey({ category: s0 }), null,
        `${s0} contains "${letters}" but does not NAME that category — it must select no bucket`);
      assert.equal(canonicalCategoryName(s0), 'Other');
    }

    // The words that genuinely ARE the category still match, including plurals
    // and the inflections the 'stem' mode exists for. Without this half the fix
    // would pass by matching nothing at all.
    for (const [s0, key] of [
      ['Vehicles', 'vehicles'], ['Car', 'vehicles'], ['Cars', 'vehicles'],
      ['Watches', 'watches'], ['Watch', 'watches'],
      ['Electronics', 'electronics'], ['Electronic', 'electronics'],
      ['Furniture', 'furniture'], ['Table', 'furniture'], ['Tables', 'furniture'],
      ['Books', 'books'], ['Book', 'books'], ['Jewelry', 'jewelry'],
    ]) {
      assert.equal(resolveEnvelopeKey({ category: s0 }), key,
        `${s0} names ${key} and must still select it`);
    }

    // THE NARROW-ONLY FLOOR, which is what makes this change safe to make at
    // all. "Bookcase" named `books` (hard 480) by coincidence; under the token
    // rule alone it names nothing, and NO bucket means MANUAL_ONLY's 2,000 —
    // ABOVE what it had. Resolving both ways and keeping the lower ceiling is
    // why the fix narrows six strings without widening three others.
    assert.equal(resolveEnvelopeKey({ category: 'Bookcase' }), 'books',
      'the token rule alone would widen Bookcase from 480 to MANUAL_ONLY 2,000');
  });

  test('CB-12c the narrowings that DO happen are enumerated, not incidental', () => {
    // A narrow-only rule is only honest if the narrowings are known. Anything
    // not listed here is a change nobody decided to make.
    const narrowed = new Set();
    for (const str of STRINGS) {
      for (const extra of CONTEXTS) {
        const raw = resolveEnvelopeKey({ category: str, ...extra });
        const canon = resolveEnvelopeKey({ category: canonicalCategoryName(str), ...extra });
        if (raw !== canon) narrowed.add(`${raw} => ${canon}`);
      }
    }
    assert.deepEqual([...narrowed].sort(), [
      // 'household' contains neither 'home' nor 'kitchen', so the raw string
      // reached the generic `home` bucket and missed the kitchen-appliance one.
      // Canonical 'Home' reaches it: identical soft and hard, floor 12 -> 20.
      // Strictly tighter, and correct — a household blender is a kitchen appliance.
      'home => home:kitchen appliance',
      // The cost of dropping the 'kitchen' alias: a "Kitchen" scan whose
      // subcategory already reads as an appliance loses the bucket it had.
      // Safe direction, real cost, recorded rather than buried.
      'home:kitchen appliance => null',
    ], 'an unlisted envelope change means the alias table moved a price without a decision');
  });
});

// ── THE SAME VALUE, END TO END ──────────────────────────────────────────────
describe('one representation, used everywhere', () => {
  test('CB-14 the guard prices from the STAGE 1 category — and the gap is recorded', async () => {
    // THIS TEST USED TO ASSERT THE OPPOSITE, AND IT WAS WRONG.
    //
    // It pinned the source text of `{ ...recognition, category:
    // verification.final_category || recognition.category }` on the reasoning
    // that the price and the label must come from the same string. They must.
    // But that line made it true by taking BOTH from the LESS trusted one:
    // Stage 2 is the stage whose prompt carries OCR, Vision labels, catalog
    // rows and the user's correction. A paperback Stage 1 read correctly as
    // Books (hard_max 480) could be priced at ₪4,000 by Stage 2 answering
    // "Furniture" (16,000). Two independent reviews produced that witness.
    //
    // Pinning a line of SOURCE TEXT is also why this test could not see the
    // problem: it asserted that the line existed, not what it did.
    const src = (await import('node:fs')).readFileSync(new URL('../api/analyze.js', import.meta.url), 'utf8');
    assert.ok(!/recognition: \{ \.\.\.recognition, category: verification\.final_category/.test(src),
      'the guard must not resolve its envelope from the Stage 2 category');

    // The behaviour, asserted as behaviour. Stage 2 naming a looser category
    // must not move the ceiling.
    const book = { category: 'Books', subcategory: 'paperback', category_confidence: 0.9,
      brand_candidates: [], model_candidates: [], ocr_text: { raw_texts: [] } };
    assert.equal(resolveEnvelopeKey(book), 'books');
    assert.equal(ENVELOPES.books.hard_max, 480);
    assert.ok(ENVELOPES.furniture.hard_max > 10000,
      'the two ceilings must really differ, or this test proves nothing');
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
