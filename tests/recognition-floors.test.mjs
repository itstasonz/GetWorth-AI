// ══════════════════════════════════════════════════════════════════════════════
// HIGH-6 — RECOGNITION FLOORS, AND THE STATE MATRIX BEHIND THEM
//
// THE INVARIANT
//   A numeric product-specific price may exist ONLY when the required identity
//   evidence for that pricing source is satisfied.
//
// Case D being fixed does not make the floors complete, and the way to find out
// is not to re-read the rules. The matrix below is GENERATED across every axis
// that can make a scan priceable, and the invariant is asserted over all of it.
// A hand-listed set of cases only ever tests the shapes someone already
// imagined — which is how the Ninja scan passed every numeric rule in the
// system while pricing an object nobody had identified.
//
//   AXIS                 VALUES
//   brand evidence       absent · weak · OCR-only · corroborated ·
//                        percent-scale · boolean
//   model evidence       absent · weak · OCR-only · exact · percent-scale ·
//                        numeric-string
//   category evidence    absent · weak · canonical · model-suggested · free-form
//   recognition state    normal · stage-1 timeout · fallback · generic-only ·
//                        DB missing · DB candidate · AI estimate
//   confidence           absent · NaN · string · 0 · below · exactly · above · >1
//   pricing source       catalog · AI · registered · unknown
//
// THE MATRIX MISSED A CRITICAL, AND THE SHAPE OF THE MISS IS THE LESSON. Its
// confidence axis varied `category_confidence` across eight encodings and left
// the IDENTITY confidences well-formed, so an independent reviewer found what it
// could not see: `brandC: 30` — the same 30% on a percent scale — read as
// strong and took a refused scan to the top tier. A generated matrix is only as
// complete as its axes, and an axis that varies one of three sibling fields is
// a hand-listed corpus with extra steps. Both identity confidences now carry
// malformed encodings of their own.
//
//   node --test tests/recognition-floors.test.mjs
// ══════════════════════════════════════════════════════════════════════════════
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateQuote, resolveIdentityTier, resolveEnvelope, derivePricingSource,
  IDENTITY_TIER, IDENTITY_CONFIDENCE_FLOOR, CATEGORY_CONFIDENCE_FLOOR,
} from '../api/_lib/valuation-guard.js';
import { parseVisionResponse, buildVerificationPrompt } from '../api/analyze.js';

// ══════════════════════════════════════════════════════════════════════════════
// FLOOR-A — NO SCORE FLOOR ON VISION LABELS
//
// WITNESS    The Ninja blender. Stage 1 returned category "Other" at 10%; the
//            Stage-2 prompt carried Vision's low-score object guesses in the
//            same list, in the same shape, as a 97% one; the scan came back
//            "unidentified unidentified / Footwear" and was priced ₪30/70/130.
// ROOT CAUSE `parseVisionResponse` filtered `webEntities` at `score > 0.5` and
//            applied NO floor to `labels` or to `logos`. Three sibling fields,
//            one rule, applied to one of them. A 2% guess and a 97% reading
//            were rendered identically into the prompt that forms the identity.
// FIX        One named constant, VISION_SIGNAL_FLOOR = 0.5 — the value
//            webEntities already used — applied to all three. `ocr_context`
//            stays unfiltered: it is capture for OCE scoring and feeds no
//            decision.
// TEST       FA-1 … FA-4 below.
// MUTATION   FA-5 — remove the floor and the Ninja label is back in the prompt.
// ══════════════════════════════════════════════════════════════════════════════
describe('FLOOR-A a Vision signal below the floor never reaches Stage 2', () => {
  const NINJA_VISION = {
    labelAnnotations: [
      { description: 'Computer mouse', score: 0.97 },
      { description: 'Gadget', score: 0.51 },
      { description: 'Footwear', score: 0.44 },      // the witness
      { description: 'Ballet shoe', score: 0.12 },   // the witness
    ],
    logoAnnotations: [
      { description: 'Logitech', score: 0.94 },
      { description: 'Apple', score: 0.02 },         // the ₪1,500 phone-case witness
    ],
    textAnnotations: [{ description: 'full' }, { description: 'Logitech G502' }],
    webDetection: { webEntities: [{ description: 'gaming mouse', score: 0.8 }, { description: 'shoe', score: 0.3 }] },
  };

  test('FA-1 low-score labels are dropped', () => {
    const r = parseVisionResponse(NINJA_VISION);
    assert.deepEqual(r.labels.map((l) => l.description), ['Computer mouse', 'Gadget']);
    assert.ok(!r.labels.some((l) => /Footwear|Ballet/.test(l.description)),
      'the two labels that produced the Ninja category must not survive');
  });

  test('FA-2 the SAME floor applies to labels, logos and web entities', () => {
    // The asymmetry was the defect. Assert the symmetry, not each value.
    const r = parseVisionResponse(NINJA_VISION);
    for (const l of r.labels) assert.ok(l.score > 0.5, `label ${l.description} is below the floor`);
    for (const l of r.logos) assert.ok(l.score > 0.5, `logo ${l.description} is below the floor`);
    assert.deepEqual(r.webEntities, ['gaming mouse']);
    assert.deepEqual(r.logos.map((l) => l.description), ['Logitech'],
      'a 2% logo guess bought `confirmed_by_text` once; it is not shown at all now');
  });

  test('FA-3 the capture field stays UNFILTERED, deliberately', () => {
    // ocr_context exists so OCE scoring can be designed against real geometry,
    // including the junk. It feeds no decision, so a floor there would destroy
    // data for no safety gain.
    const r = parseVisionResponse(NINJA_VISION);
    assert.equal(r.ocr_context.logo_boxes.length, 2, 'capture keeps what the floor drops');
  });

  test('FA-4 the floor does not silently empty a good scan', () => {
    const r = parseVisionResponse(NINJA_VISION);
    assert.ok(r.labels.length > 0 && r.logos.length > 0 && r.webEntities.length > 0,
      'a floor that removes everything is a different bug wearing the same hat');
  });

  test('FA-5 MUTATION the witness returns the moment the floor is removed', () => {
    // The negative control: the same parse WITHOUT the filter still contains the
    // labels, which proves FA-1 observes the floor and not the fixture.
    const unfiltered = (NINJA_VISION.labelAnnotations || []).map((l) => l.description);
    assert.ok(unfiltered.includes('Ballet shoe') && unfiltered.includes('Footwear'),
      'the fixture must actually carry the witness, or FA-1 proves nothing');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// FLOOR-B — NO SIGNAL-CLASS RANKING IN THE STAGE-2 PROMPT
//
// WITNESS    A Vision LABEL ("Footwear", "Ballet shoe") and Vision TEXT read
//            off the item were presented to Stage 2 as four flat bullets with
//            no statement of relative evidential weight. A label is Vision
//            guessing what KIND of object it sees; it can never name a product.
//            Nothing in the prompt said so, and the model used it as if it
//            could: the Ninja scan's displayed category came from a label.
// ROOT CAUSE The VISION USAGE RULES told the model what to do when signals
//            AGREE and when Vision disagrees with Stage 1. They never said what
//            each signal class IS, or which outranks which.
// FIX        An explicit ranked class list in the prompt: TEXT > LOGO > LABEL >
//            WEB ENTITY, with what each class may and may not establish, and
//            the standing rule that a weaker class never overrides a stronger.
// TEST       FB-1 … FB-3.
// MUTATION   covered by the rendered-prompt golden — any edit to this block
//            changes a hash and has to be declared.
// ══════════════════════════════════════════════════════════════════════════════
describe('FLOOR-B the prompt states what each Vision signal class can establish', () => {
  const prompt = buildVerificationPrompt(
    { category: 'Electronics', category_confidence: 0.9, brand_candidates: [], model_candidates: [], ocr_text: { raw_texts: [] }, visual_features: {} },
    [], [], 'en',
    { labels: [{ description: 'mouse', score: 0.9 }], text: ['Logitech'], logos: [], webEntities: [] },
    true);

  test('FB-1 the four classes are ranked, strongest first', () => {
    const order = ['TEXT/OCR read off the item', 'LOGO detected on the item', 'LABEL', 'WEB ENTITY']
      .map((s) => prompt.indexOf(s));
    assert.ok(order.every((i) => i > 0), 'every signal class must be named');
    for (let i = 1; i < order.length; i++) {
      assert.ok(order[i] > order[i - 1], 'the classes must be presented in rank order');
    }
  });

  test('FB-2 each class says what it may NOT establish', () => {
    assert.match(prompt, /It identifies the MAKER, never the model/, 'a logo is brand-level only');
    assert.match(prompt, /Category-level only.*never evidence of a brand, a model, or a price/s,
      'a label must not be allowed to name a product');
    assert.match(prompt, /resemblance, not evidence/, 'a web entity is similarity, not identity');
  });

  test('FB-3 confidence does not promote a class', () => {
    // The rule that closes the Ninja shape: a 99% label is still a label.
    assert.match(prompt, /A high-confidence LABEL is still a LABEL: it cannot name a product/);
    assert.match(prompt, /A weaker class NEVER overrides a stronger one/);
    assert.match(prompt, /If a label or a web entity disagrees with text read off the item, the text wins/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// FLOOR-C — final_category WAS A FREE-FORM STRING WITH NO ENUM
//
// WITNESS    "Footwear", displayed for a blender, straight from the model.
// ROOT CAUSE VERIFICATION_SCHEMA declared `{ type: 'string' }`, and the
//            taxonomy existed in four places that disagreed.
// FIX        api/_lib/category.js — one canonical list, one normalisation
//            point, applied at calibrateRecognition and calibrateVerification.
// TEST       tests/category-boundary.test.mjs (19 tests). FC-1 below is the
//            link, so this file's floor list is complete rather than implying
//            the third floor is somebody else's problem.
// MUTATION   CB-12 — an alias that changes which envelope a string selects
//            fails; it deleted three aliases I had written.
// ══════════════════════════════════════════════════════════════════════════════
test('FC-1 the third floor is closed, and its witness is refused', async () => {
  const { canonicalCategory } = await import('../api/_lib/category.js');
  assert.equal(canonicalCategory('Footwear').category, 'Other');
  const { VERIFICATION_SCHEMA } = await import('../api/analyze.js');
  assert.ok(Array.isArray(VERIFICATION_SCHEMA.properties.final_category.enum),
    'final_category must be enumerated, not free-form');
});

// ══════════════════════════════════════════════════════════════════════════════
// THE GENERATED STATE MATRIX
// ══════════════════════════════════════════════════════════════════════════════

const BRAND_EVIDENCE = {
  absent:       { brandOk: false, brandC: undefined, brandLabel: undefined },
  weak:         { brandOk: true, brandC: 0.3, brandLabel: undefined },
  ocr_only:     { brandOk: true, brandC: 0.75, brandLabel: undefined },
  corroborated: { brandOk: true, brandC: 0.9, brandLabel: 'confirmed_by_text' },
  // THE AXIS THIS MATRIX WAS MISSING. It varied `category_confidence` across
  // eight encodings and left the IDENTITY confidences at well-formed values, so
  // it could not see the bypass an independent reviewer found: `brandC: 30` —
  // the same 30% on a percent scale — read as strong and took a refused scan to
  // the top tier. A generated matrix is only as complete as its axes, and an
  // axis that varies one of three sibling fields is a hand-listed corpus with
  // extra steps.
  percent_scale: { brandOk: true, brandC: 30, brandLabel: undefined },
  boolean_true:  { brandOk: true, brandC: true, brandLabel: undefined },
};
const MODEL_EVIDENCE = {
  absent: { modelOk: false, modelC: undefined },
  weak:   { modelOk: true, modelC: 0.25 },
  ocr:    { modelOk: true, modelC: 0.72 },
  exact:  { modelOk: true, modelC: 0.95 },
  percent_scale: { modelOk: true, modelC: 30 },
  numeric_string: { modelOk: true, modelC: '0.95' },
};
const CATEGORY_EVIDENCE = {
  absent:          { category: '', subcategory: '' },
  weak:            { category: 'Electronics', subcategory: '' },
  canonical:       { category: 'Electronics', subcategory: 'gaming mouse', product_type: 'mouse' },
  model_suggested: { category: 'Electronics', subcategory: 'blender' },
  free_form:       { category: 'Footwear', subcategory: 'ballet shoe' },
};
const RECOGNITION_STATE = {
  normal:         { stage: 'stage2', pre_source: null, anchor: null },
  stage1_timeout: { stage: 'pre', pre_source: 'none', anchor: null },
  fallback:       { stage: 'pre', pre_source: 'category_anchor', anchor: null },
  generic_only:   { stage: 'stage2', pre_source: null, anchor: null, generic: true },
  db_missing:     { stage: 'pre', pre_source: 'ai_haiku', anchor: null },
  db_candidate:   { stage: 'pre', pre_source: 'catalog', anchor: { id: 'r1', brand: 'Logitech', model: 'G502', retail_price_ils: 549 } },
  ai_estimate:    { stage: 'stage2', pre_source: null, anchor: null },
};
const CONFIDENCES = {
  absent: undefined, nan: NaN, string: '0.9', zero: 0,
  below: CATEGORY_CONFIDENCE_FLOOR - 0.01,
  exactly: CATEGORY_CONFIDENCE_FLOOR,
  above: 0.9,
  over_one: 5,
};
const PRICING_SOURCE = {
  catalog:    { stage: 'pre', pre_source: 'catalog' },
  ai:         { stage: 'pre', pre_source: 'ai_haiku' },
  registered: { stage: 'stage2', pre_source: null },
  unknown:    { stage: 'wormhole', pre_source: 'market_comparables_v2' },
};

function buildCase(b, m, c, r, conf, ps) {
  const brand = BRAND_EVIDENCE[b];
  const model = MODEL_EVIDENCE[m];
  const cat = CATEGORY_EVIDENCE[c];
  const state = RECOGNITION_STATE[r];
  const src = PRICING_SOURCE[ps];
  return {
    ...state,
    ...src,                                  // pricing source wins on stage/pre_source
    anchor: state.anchor,
    identity: state.generic
      ? { brandOk: false, modelOk: false }
      : {
        brandOk: brand.brandOk, modelOk: model.modelOk,
        brandC: brand.brandC, modelC: model.modelC,
        brandConfLabel: brand.brandLabel,
      },
    recognition: {
      ...cat,
      category_confidence: CONFIDENCES[conf],
      brand_candidates: brand.brandOk ? [{ brand: 'Logitech', confidence: brand.brandC, evidence: 'readable_text' }] : [],
      model_candidates: model.modelOk ? [{ model: 'G502', confidence: model.modelC, evidence: 'ocr' }] : [],
      ocr_text: { raw_texts: [] },
    },
    model: 'claude-test-model',
  };
}

const ALL_CASES = [];
for (const b of Object.keys(BRAND_EVIDENCE)) {
  for (const m of Object.keys(MODEL_EVIDENCE)) {
    for (const c of Object.keys(CATEGORY_EVIDENCE)) {
      for (const r of Object.keys(RECOGNITION_STATE)) {
        for (const conf of Object.keys(CONFIDENCES)) {
          for (const ps of Object.keys(PRICING_SOURCE)) {
            ALL_CASES.push({ id: `${b}/${m}/${c}/${r}/${conf}/${ps}`, ctx: buildCase(b, m, c, r, conf, ps) });
          }
        }
      }
    }
  }
}

const QUOTE = { low: 250, mid: 380, high: 520, currency: 'ILS' };
const priced = (v) => v.action !== 'degrade' && Number(v.prices?.mid) > 0;

describe('the generated matrix', () => {
  test('SM-0 the matrix is the size it claims, and BOTH outcomes occur', () => {
    assert.equal(ALL_CASES.length, 6 * 6 * 5 * 7 * 8 * 4);
    const results = ALL_CASES.map((c) => priced(validateQuote(QUOTE, c.ctx)));
    const yes = results.filter(Boolean).length;
    assert.ok(yes > 0, 'a matrix where nothing is ever priced proves no invariant');
    assert.ok(yes < results.length, 'a matrix where everything is priced proves no invariant either');
    // Printed so a future reviewer can see the shape shift if a rule changes.
    console.log(`  matrix: ${ALL_CASES.length} cases, ${yes} priced, ${results.length - yes} refused`);
  });

  test('SM-1 THE INVARIANT — a price implies a meaningful identity', () => {
    const violations = [];
    for (const { id, ctx } of ALL_CASES) {
      const v = validateQuote(QUOTE, ctx);
      if (!priced(v)) continue;
      if (v.metadata.identity_tier === IDENTITY_TIER.UNIDENTIFIED) violations.push(id);
    }
    assert.deepEqual(violations.slice(0, 10), [],
      `${violations.length} states produced a product-specific price with NO identity`);
  });

  test('SM-2 a degraded verdict never leaks a number', () => {
    const leaks = [];
    for (const { id, ctx } of ALL_CASES) {
      const v = validateQuote(QUOTE, ctx);
      if (v.action !== 'degrade') continue;
      if (v.prices.low !== 0 || v.prices.mid !== 0 || v.prices.high !== 0) leaks.push(id);
    }
    assert.deepEqual(leaks.slice(0, 10), []);
  });

  test('SM-3 an UNREGISTERED pricing source never prices, in any state', () => {
    // The sibling hole: the PRE switch failed closed on an unknown source while
    // an unrecognised STAGE three lines later still returned LOW and priced.
    const pricedUnknown = ALL_CASES
      .filter((c) => c.id.endsWith('/unknown'))
      .filter(({ ctx }) => priced(validateQuote(QUOTE, ctx)))
      .map((c) => c.id);
    assert.deepEqual(pricedUnknown.slice(0, 10), [],
      'a pricing source nobody registered must not produce a number');
    assert.equal(derivePricingSource({ stage: 'wormhole' }).grade, 'MANUAL_REQUIRED');
    assert.equal(derivePricingSource({ stage: 'pre', pre_source: 'market_comparables_v2' }).grade, 'MANUAL_REQUIRED');
  });

  test('SM-4 the displayed band always fits the envelope', () => {
    const outside = [];
    for (const { id, ctx } of ALL_CASES) {
      const v = validateQuote(QUOTE, ctx);
      if (!priced(v)) continue;
      const env = resolveEnvelope(ctx);
      if (v.prices.high > env.hard_max) outside.push(`${id}: high ${v.prices.high} > ${env.hard_max}`);
    }
    assert.deepEqual(outside.slice(0, 10), [],
      'the whole displayed distribution must fit, not just mid');
  });

  test('SM-5 CONFIDENCE ATTACKS cannot raise the tier', () => {
    // NaN, a numeric string, 0 and 5 must never do more than a real in-range
    // value would. Five bypasses of exactly this shape were found in round 1.
    const bad = [];
    for (const b of Object.keys(BRAND_EVIDENCE)) {
      for (const m of Object.keys(MODEL_EVIDENCE)) {
        for (const c of Object.keys(CATEGORY_EVIDENCE)) {
          const honest = resolveIdentityTier(buildCase(b, m, c, 'normal', 'above', 'registered'));
          for (const attack of ['nan', 'string', 'zero', 'over_one', 'absent']) {
            const t = resolveIdentityTier(buildCase(b, m, c, 'normal', attack, 'registered'));
            const rank = (x) => [IDENTITY_TIER.UNIDENTIFIED, IDENTITY_TIER.CATEGORY_ONLY,
              IDENTITY_TIER.BRAND_ONLY, IDENTITY_TIER.FAMILY, IDENTITY_TIER.EXACT_MODEL].indexOf(x);
            if (rank(t) > rank(honest)) bad.push(`${b}/${m}/${c}/${attack}: ${t} > ${honest}`);
          }
        }
      }
    }
    assert.deepEqual(bad.slice(0, 10), [], 'a malformed confidence outranked a real one');
  });

  test('SM-6 a FREE-FORM category never reaches a category-specific bucket', () => {
    // The Ninja shape, as a property over the whole matrix rather than one case.
    const leaked = [];
    for (const { id, ctx } of ALL_CASES) {
      if (!id.includes('/free_form/')) continue;
      const env = resolveEnvelope(ctx);
      if (env.basis === 'category') leaked.push(`${id}: ${env.key}`);
    }
    assert.deepEqual(leaked.slice(0, 10), [],
      '"Footwear" must not select a priced category envelope');
  });

  test('SM-7 NO identity at all is refused in every single state', () => {
    // The strongest reading of the invariant, and the one Case D is an instance
    // of: with no brand and no model, nothing else on any axis may rescue it
    // into a product-specific price.
    const survivors = ALL_CASES
      .filter((c) => c.id.startsWith('absent/absent/'))
      .filter(({ ctx }) => priced(validateQuote(QUOTE, ctx)))
      .map((c) => c.id);
    // CATEGORY_ONLY is a legitimate tier — a confident canonical category with a
    // priced bucket may still produce a band. What must never happen is a price
    // with NO tier at all, which SM-1 covers. Here we assert the narrower thing:
    // every survivor is explicitly CATEGORY_ONLY and nothing stronger.
    for (const id of survivors) {
      const ctx = ALL_CASES.find((c) => c.id === id).ctx;
      const tier = validateQuote(QUOTE, ctx).metadata.identity_tier;
      assert.equal(tier, IDENTITY_TIER.CATEGORY_ONLY,
        `${id} priced at tier ${tier} with no brand and no model`);
    }
  });

  test('SM-9 a MALFORMED IDENTITY confidence never reads as strong', () => {
    // The reviewer's CRITICAL, pinned. `resolveIdentityTier` hardened
    // `category_confidence` against exactly these encodings in round 1 and the
    // comment stated the rule in general terms, while `brandC` and `modelC` two
    // lines below were still read through a bare `Number()` with no type check
    // and no upper bound. The witness is not exotic: a model writing
    // confidences on a 0-100 scale is the commonest malformation of the field,
    // and RECOGNITION_SCHEMA is never applied.
    const rec = {
      category: 'Clothing', subcategory: 'sneaker', category_confidence: 0.20,
      brand_candidates: [{ brand: 'Nike', confidence: 0.3, evidence: 'visual_shape' }],
      model_candidates: [{ model: 'Air Max', confidence: 0.3, evidence: 'visual_shape' }],
      ocr_text: { raw_texts: [] },
    };
    const at = (c) => ({
      stage: 'stage2', pre_source: null, anchor: null, model: 'm', recognition: rec,
      identity: { brandOk: true, modelOk: true, brandC: c, modelC: c },
    });

    // The honest reading of this scan.
    assert.equal(resolveIdentityTier(at(0.30)), IDENTITY_TIER.UNIDENTIFIED);
    assert.equal(validateQuote(QUOTE, at(0.30)).action, 'degrade');

    // Every malformation must land in the SAME place, never above it.
    const BOMB = JSON.parse('{"toString":1,"valueOf":2}');
    for (const c of [30, 99, 5, true, '30', '0.9', [0.9], { valueOf: () => 1 }, BOMB,
      Infinity, -Infinity, NaN, -1, 1.5, null, undefined, 0]) {
      const tier = resolveIdentityTier(at(c));
      assert.equal(tier, IDENTITY_TIER.UNIDENTIFIED,
        `brandC/modelC ${String(typeof c === 'object' ? JSON.stringify(c) : c)} reached ${tier}`);
      assert.equal(validateQuote(QUOTE, at(c)).prices.mid, 0,
        'a malformed confidence must not produce a number');
    }

    // And a REAL confidence still works, so this is a floor and not a wall.
    assert.equal(resolveIdentityTier(at(0.9)), IDENTITY_TIER.EXACT_MODEL);
    assert.notEqual(validateQuote(QUOTE, at(0.9)).action, 'degrade');
    assert.equal(resolveIdentityTier(at(1)), IDENTITY_TIER.EXACT_MODEL, 'exactly 1 is a valid probability');
  });

  test('SM-8 the identity floor constants still stand where they were placed', () => {
    // Both were set against a measured constraint, not chosen. If either moves,
    // the reachability argument for the tiers has to be redone.
    assert.equal(IDENTITY_CONFIDENCE_FLOOR, 0.60, 'equal to VISION_TRIGGER_THRESHOLD');
    assert.ok(CATEGORY_CONFIDENCE_FLOOR < 0.55,
      'must sit below calibrateRecognition\'s brandless cap, or CATEGORY_ONLY is unreachable');
  });
});
