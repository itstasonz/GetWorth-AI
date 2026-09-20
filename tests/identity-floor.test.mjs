// ══════════════════════════════════════════════════════════════════════════════
// IDENTITY FLOOR — no meaningful identity ⇒ no product-specific price.
//
// WHY THIS EXISTS
// A real production scan of a Ninja blender produced:
//
//   Stage 1   category "Other" 10% · brand none · model none · OCR EMPTY
//   Stage 2   unidentified unidentified / Footwear · generic_only · 28%
//   Pricing   ₪30 / ₪70 / ₪130
//
// Every number in that band is plausible for *something*, so every numeric rule
// in the guard passed. The guard had no rule that asked whether there was a
// PRODUCT to attach a number to — `validateQuote` never read
// `category_confidence`, and `resolveEnvelopeKey` reads category STRINGS, which
// "Footwear" satisfies without being a GetWorth category at all. It then fell
// through to GLOBAL_ENVELOPE: floor 5 / soft 20,000 / hard 500,000, the loosest
// bounds in the system, handed to the least-identified item in the system.
//
// So this suite asserts the PROPERTY, not the witness:
//   pricing eligibility is a function of identity EVIDENCE, and no confidence
//   claim can buy it.
//
//   node --test tests/identity-floor.test.mjs
// ══════════════════════════════════════════════════════════════════════════════
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const G = await import('../api/_lib/valuation-guard.js');
const {
  validateQuote, resolveEnvelope, resolveEnvelopeKey, resolveIdentityTier,
  derivePricingSource, IDENTITY_TIER, CATEGORY_CONFIDENCE_FLOOR, IDENTITY_CONFIDENCE_FLOOR, ENVELOPES,
  RECOGNITION_VERDICT, VALUATION_VERDICT,
} = G;

// ── fixtures, written as the four real scans ────────────────────────────────
const rec = (o = {}) => ({
  category: 'Electronics', subcategory: '', product_type: '',
  category_confidence: 0.9,
  brand_candidates: [], model_candidates: [],
  ocr_text: { raw_texts: [] }, visual_features: { condition: 'Good' }, ...o,
});
const ctx = (o = {}) => ({
  stage: 'stage2', pre_source: null, anchor: null, model: 'claude-test-model',
  identity: { brandOk: true, modelOk: true, identityHigh: true },
  recognition: rec(o.recognition || {}),
  ...o, ...(o.recognition ? { recognition: rec(o.recognition) } : {}),
});
const q = (o = {}) => ({ low: 800, mid: 1200, high: 1800, currency: 'ILS', ...o });

// CASE A — Logitech G Pro X Superlight. Strong identity, text-confirmed.
const CASE_A = ctx({
  recognition: {
    category: 'Electronics', subcategory: 'gaming mouse', product_type: 'mouse',
    category_confidence: 0.95,
    brand_candidates: [{ brand: 'Logitech', confidence: 0.95, evidence: 'readable_text' }],
    model_candidates: [{ model: 'G Pro X Superlight', confidence: 0.9, evidence: 'ocr' }],
    ocr_text: { raw_texts: ['Logitech G PRO X SUPERLIGHT'] },
  },
  identity: { brandOk: true, modelOk: true, identityHigh: true, brandConfLabel: 'confirmed_by_text' },
});

// CASE B — LG monitor. Brand strong, exact model unknown.
const CASE_B = ctx({
  recognition: {
    category: 'Electronics', subcategory: 'monitor', product_type: 'monitor',
    category_confidence: 0.92,
    brand_candidates: [{ brand: 'LG', confidence: 0.9, evidence: 'readable_text' }],
    model_candidates: [],
    ocr_text: { raw_texts: ['LG'] },
  },
  identity: { brandOk: true, modelOk: false, identityHigh: false, brandConfLabel: 'confirmed_by_text' },
});

// CASE C — Louis Vuitton Imagination. Identity from visible text, DB miss.
const CASE_C = ctx({
  recognition: {
    category: 'Beauty', subcategory: 'fragrance', product_type: 'perfume',
    category_confidence: 0.93,
    brand_candidates: [{ brand: 'Louis Vuitton', confidence: 0.95, evidence: 'readable_text' }],
    model_candidates: [{ model: 'Imagination', confidence: 0.9, evidence: 'ocr' }],
    ocr_text: { raw_texts: ['LOUIS VUITTON', 'IMAGINATION'] },
  },
  identity: { brandOk: true, modelOk: true, identityHigh: true, brandConfLabel: 'confirmed_by_text' },
});

// CASE D — the Ninja blender, exactly as production produced it.
const CASE_D = ctx({
  recognition: {
    category: 'Footwear', subcategory: 'ballet shoe', product_type: '',
    category_confidence: 0.10,
    brand_candidates: [], model_candidates: [],
    ocr_text: { raw_texts: [] },
  },
  identity: { brandOk: false, modelOk: false, identityHigh: false },
});

// ── §18 THE NINJA REGRESSION ────────────────────────────────────────────────
describe('CASE D — the Ninja failure shape must not produce a price', () => {
  test('the exact production band ₪30/₪70/₪130 is refused', () => {
    const v = validateQuote(q({ low: 30, mid: 70, high: 130 }), CASE_D);
    assert.equal(v.action, 'degrade',
      'an item with no brand, no model, empty OCR and 10% category confidence must not be priced');
    assert.match(v.metadata.degraded_reason, /V-IDENTITY-FLOOR/);
    assert.deepEqual(v.prices, { low: 0, mid: 0, high: 0 }, 'a degrade emits the zero state, never a band');
  });

  test('no price at ANY magnitude — the rule is about identity, not the number', () => {
    // The witness was ₪70. If the fix only rejected small numbers it would be a
    // coincidence, not a rule. Cross the whole plausible range.
    for (const mid of [7, 70, 700, 7000, 70000]) {
      const v = validateQuote(q({ low: Math.round(mid * 0.5), mid, high: Math.round(mid * 1.5) }), CASE_D);
      assert.equal(v.action, 'degrade', `mid ${mid} must still be refused on an unidentified item`);
      assert.match(v.metadata.degraded_reason, /V-IDENTITY-FLOOR/);
    }
  });

  test('the identity tier is recorded, so the refusal is reproducible from the record', () => {
    assert.equal(resolveIdentityTier(CASE_D), IDENTITY_TIER.UNIDENTIFIED);
    const v = validateQuote(q({ low: 30, mid: 70, high: 130 }), CASE_D);
    assert.equal(v.metadata.identity_tier, IDENTITY_TIER.UNIDENTIFIED);
  });

  test('a confident-sounding model cannot buy eligibility', () => {
    // The stated goal: the LLM must not bypass a constraint by claiming
    // confidence. It cannot, because the inputs are candidate STRINGS.
    const loud = ctx({
      recognition: { ...CASE_D.recognition, category_confidence: 0.99 },
      identity: { brandOk: false, modelOk: false, identityHigh: true },
    });
    const v = validateQuote(q({ low: 30, mid: 70, high: 130 }), loud);
    assert.equal(v.action, 'degrade',
      'identityHigh:true with no brand and no model is a claim, not evidence');
  });

  test('"Footwear" no longer reaches the global envelope', () => {
    const e = resolveEnvelope(CASE_D);
    assert.equal(e.basis, 'manual_only',
      'an unbucketed category on an unidentified item must not receive GLOBAL_ENVELOPE');
    assert.ok(e.hard_max <= 2000, `expected the manual-only ceiling, got ${e.hard_max}`);
  });
});

// ── §19 NON-REGRESSION ──────────────────────────────────────────────────────
// §5 SPLIT THIS BLOCK'S PREMISE IN TWO.
//
// It was called "identified items remain priceable" and asserted mid === 380 for
// CASE A. That sentence conflates the two questions this round separates:
// CASE A is IDENTIFIED, and whether it may be PRICED depends on evidence the
// identity says nothing about. GetWorth holding no catalog row for a Logitech G
// Pro X Superlight does not make it unrecognised — it makes it unpriced.
//
// So each case is now asserted twice: recognition without market evidence, and
// the same recognition with a catalog row. The first must keep the identity and
// refuse the number; the second must price exactly as it always did. CASE D, the
// Ninja failure shape, is unaffected and still fails the identity floor — which
// is the control that proves PENDING_MARKET is not just "everything refuses now".
const withCatalog = (c) => ({ ...c, stage: 'pre', pre_source: 'catalog', anchorModelEvidence: true });

describe('CASE A/B/C — identified items stay identified; pricing needs evidence', () => {
  test('CASE A Logitech G Pro X Superlight — IDENTIFIED, and PENDING without a row', () => {
    const v = validateQuote(q({ low: 250, mid: 380, high: 520 }), CASE_A);
    assert.equal(v.metadata.identity_tier, IDENTITY_TIER.EXACT_MODEL);
    assert.equal(v.metadata.recognition_verdict, RECOGNITION_VERDICT.IDENTIFIED,
      'recognition succeeded and must be recorded as having succeeded');
    assert.equal(v.metadata.valuation_verdict, VALUATION_VERDICT.PENDING_MARKET);
    assert.equal(v.action, 'pending');
    assert.deepEqual(v.prices, { low: 0, mid: 0, high: 0 },
      '₪380 was a number the model wrote down; nothing measured it');
    assert.notEqual(v.metadata.degraded_reason, 'V-IDENTITY-FLOOR',
      'this is not a recognition failure and must never be recorded as one');
  });

  test('CASE A with a catalog row prices exactly as before — the non-regression', () => {
    const v = validateQuote(q({ low: 250, mid: 380, high: 520 }), withCatalog(CASE_A));
    assert.equal(v.action, 'accept', `must price when evidence exists, got ${v.metadata.degraded_reason}`);
    assert.equal(v.prices.mid, 380, 'mid is never moved');
    assert.equal(v.metadata.valuation_verdict, VALUATION_VERDICT.ANCHORED);
    assert.equal(v.metadata.identity_tier, IDENTITY_TIER.EXACT_MODEL);
  });

  test('CASE B LG monitor — brand-only identity, and the limitation stays visible', () => {
    const pending = validateQuote(q({ low: 800, mid: 1400, high: 2200 }), CASE_B);
    assert.equal(pending.metadata.identity_tier, IDENTITY_TIER.BRAND_ONLY,
      'the limitation must be visible in the record, not hidden inside a number');
    assert.equal(pending.metadata.recognition_verdict, RECOGNITION_VERDICT.FAMILY,
      'brand without model is a FAMILY-level belief, not an identification');
    assert.equal(pending.metadata.valuation_verdict, VALUATION_VERDICT.PENDING_MARKET);

    const priced = validateQuote(q({ low: 800, mid: 1400, high: 2200 }), withCatalog(CASE_B));
    assert.notEqual(priced.action, 'degrade', `brand-strong/model-weak must still price, got ${priced.metadata.degraded_reason}`);
    assert.equal(priced.metadata.identity_tier, IDENTITY_TIER.BRAND_ONLY);
  });

  test('CASE C Louis Vuitton Imagination — recognised, and §7 leaves the envelope alone', () => {
    // The beauty envelope is too tight for a luxury fragrance. That is an
    // envelope-CALIBRATION gap, recorded separately, and this round does not
    // widen it to make this case pass — doing so would be inventing a market
    // number to satisfy a fixture. What the guard must not do is answer a
    // calibration question by claiming the item was not recognised.
    const v = validateQuote(q({ low: 350, mid: 520, high: 700 }), CASE_C);
    assert.notEqual(v.metadata.degraded_reason, 'V-IDENTITY-FLOOR',
      'a text-confirmed brand+model identity must never hit the identity floor');
    assert.equal(v.metadata.identity_tier, IDENTITY_TIER.EXACT_MODEL);
    assert.equal(v.metadata.recognition_verdict, RECOGNITION_VERDICT.IDENTIFIED);
    assert.equal(v.metadata.envelope_key, 'beauty');
    assert.equal(ENVELOPES.beauty.hard_max, 1600,
      '§7: the beauty ceiling is UNCHANGED this round. Widening it is a product decision.');
  });

  test('all three identified cases clear the floor; only D does not', () => {
    for (const [name, c] of [['A', CASE_A], ['B', CASE_B], ['C', CASE_C]]) {
      const v = validateQuote(q({ low: 100, mid: 150, high: 220 }), c);
      assert.notEqual(v.metadata.degraded_reason, 'V-IDENTITY-FLOOR', `CASE ${name} must clear the identity floor`);
      assert.notEqual(v.metadata.recognition_verdict, RECOGNITION_VERDICT.UNKNOWN,
        `CASE ${name} was recognised, whatever happened to its price`);
    }
    const d = validateQuote(q({ low: 100, mid: 150, high: 220 }), CASE_D);
    assert.equal(d.metadata.degraded_reason?.startsWith('V-IDENTITY-FLOOR'), true);
    assert.equal(d.metadata.recognition_verdict, RECOGNITION_VERDICT.UNKNOWN,
      'CASE D is the control: a genuine recognition failure, distinguishable from a pricing one');
    assert.equal(d.action, 'degrade',
      'and it DEGRADES rather than pending — /api/enrich cannot research an unknown object');
  });
});

// ── §4 CATEGORY CONFIDENCE FLOOR ────────────────────────────────────────────
describe('category confidence participates in pricing eligibility', () => {
  test('a weak category with no brand or model cannot price', () => {
    const weak = ctx({
      recognition: { category: 'Electronics', category_confidence: CATEGORY_CONFIDENCE_FLOOR - 0.01 },
      identity: { brandOk: false, modelOk: false, identityHigh: false },
    });
    assert.equal(validateQuote(q(), weak).action, 'degrade');
  });

  test('the same category AT the floor can price', () => {
    const atFloor = ctx({
      recognition: { category: 'Electronics', category_confidence: CATEGORY_CONFIDENCE_FLOOR },
      identity: { brandOk: false, modelOk: false, identityHigh: false },
    });
    assert.notEqual(validateQuote(q({ low: 80, mid: 150, high: 300 }), atFloor).action, 'degrade');
  });

  test('a missing category_confidence is treated as weak, not as permission', () => {
    const absent = ctx({
      recognition: { category: 'Electronics', category_confidence: undefined },
      identity: { brandOk: false, modelOk: false, identityHigh: false },
    });
    assert.equal(validateQuote(q(), absent).action, 'degrade', 'absent evidence is not strong evidence');
  });
});

// ── §7 V-ENVELOPE-BAND ──────────────────────────────────────────────────────
describe('the whole displayed distribution fits the envelope, not just mid', () => {
  test('a displayed high above hard_max is refused', () => {
    // books: high 60 -> hard_max 480. A mid inside the envelope with a high
    // outside it used to pass, because only mid was bounded.
    const books = ctx({
      recognition: { category: 'Books', category_confidence: 0.95 },
      identity: { brandOk: false, modelOk: false, identityHigh: false },
    });
    const env = resolveEnvelope(books);
    const v = validateQuote(q({ low: 100, mid: 200, high: env.hard_max + 500 }), books);
    assert.equal(v.action, 'degrade', 'a high beyond hard_max must not be displayed');
    assert.match(v.metadata.degraded_reason, /V-ENVELOPE-BAND|V-SPREAD|V-ENVELOPE-HARD/);
  });

  test('no accepted verdict anywhere in a weak-identity sweep displays high > hard_max', () => {
    // The property, swept — not one witness. Weak identity is where the spread
    // ceiling is loosest (SPREAD_MAX_WEAK 6.0) and therefore where `high` could
    // run furthest past hard_max.
    for (const key of ['books', 'electronics', 'toys', 'clothing', 'electronics:gaming mouse']) {
      const env = ENVELOPES[key];
      if (!env) continue;
      const c = ctx({
        recognition: { category: 'Electronics', subcategory: '', category_confidence: 0.9 },
        envelope_key: key,
        identity: { brandOk: false, modelOk: false, identityHigh: false },
      });
      for (const mult of [0.5, 0.9, 1.0]) {
        const mid = Math.max(env.floor + 1, Math.round(env.hard_max * mult));
        const v = validateQuote(q({ low: Math.round(mid / 5), mid, high: mid * 5 }), c);
        if (v.action === 'degrade') continue;
        assert.ok(v.prices.high <= env.hard_max,
          `${key}: accepted a displayed high ${v.prices.high} above hard_max ${env.hard_max}`);
      }
    }
  });
});

// ── §8 PRE-SOURCE POLICY ────────────────────────────────────────────────────
describe('pricing source grades follow evidence, and unknown fails closed', () => {
  test('an unanchored AI estimate does not outrank a compatible catalog row', () => {
    const haiku = derivePricingSource({ stage: 'pre', pre_source: 'ai_haiku' });
    const catalog = derivePricingSource({ stage: 'pre', pre_source: 'catalog', anchorModelEvidence: false });
    const RANK = ['MANUAL_REQUIRED', 'LOW', 'MEDIUM', 'HIGH'];
    assert.ok(RANK.indexOf(haiku.grade) <= RANK.indexOf(catalog.grade),
      `an unanchored estimate (${haiku.grade}) must not outrank a real catalog row (${catalog.grade})`);
  });

  test('an unregistered pricing source does not price', () => {
    for (const src of ['market_comps', 'some_future_source', 'x', '']) {
      const d = derivePricingSource({ stage: 'pre', pre_source: src });
      assert.equal(d.grade, 'MANUAL_REQUIRED',
        `unregistered source "${src}" must fail closed, got ${d.grade}`);
    }
  });

  test('a quote from an unregistered source is refused end to end', () => {
    const c = ctx({ stage: 'pre', pre_source: 'market_comps_v1' });
    const v = validateQuote(q(), c);
    assert.equal(v.metadata.pricing_grade, 'MANUAL_REQUIRED',
      'a future market source must not ship prices by forgetting to register itself');
  });
});

// ── §11 ENVELOPE INPUT TRUST ────────────────────────────────────────────────
describe('photographed text may narrow the envelope, never widen it', () => {
  const STICKERS = ['macbook', 'iphone', 'rolex submariner', 'dji', 'playstation 5', 'ipad'];

  test('a sticker cannot raise the ceiling that governs its own price', () => {
    const clean = rec({ category: 'Electronics' });
    const ceiling = (k) => (k && ENVELOPES[k] ? ENVELOPES[k].hard_max : 500000);
    const base = ceiling(resolveEnvelopeKey(clean));

    for (const word of STICKERS) {
      const attacked = rec({ category: 'Electronics', ocr_text: { raw_texts: [word] } });
      const got = ceiling(resolveEnvelopeKey(attacked));
      assert.ok(got <= base,
        `printing "${word}" on a label raised hard_max from ${base} to ${got} — ` +
        'the photographed text chose the constraint that governs its own price');
    }
  });

  test('OCR that selects a TIGHTER bucket is still honoured', () => {
    // The fix must not be "ignore OCR" — several buckets are tighter than the
    // category they sit in and OCR is the only way to reach them.
    const cordless = rec({ category: 'Electronics', ocr_text: { raw_texts: ['KX-TG6811'] } });
    assert.equal(resolveEnvelopeKey(cordless), 'electronics:cordless phone');
    assert.ok(ENVELOPES['electronics:cordless phone'].hard_max < ENVELOPES['electronics'].hard_max,
      'fixture: the cordless bucket must genuinely be tighter than plain electronics');
  });
});

// ── §21 CROSS-PRODUCT ───────────────────────────────────────────────────────
// identity strength × category confidence × pricing source. Generated, so a
// new combination cannot appear without being covered.
describe('XP identity × category confidence × pricing source', () => {
  const IDENTITIES = {
    'exact-model': { brandOk: true, modelOk: true, identityHigh: true },
    'brand-only':  { brandOk: true, modelOk: false, identityHigh: false },
    'none':        { brandOk: false, modelOk: false, identityHigh: false },
  };
  const CONFIDENCES = { 'strong-category': 0.9, 'weak-category': 0.2 };
  const SOURCES = ['catalog', 'ai_haiku', 'category_anchor', 'unregistered_source'];

  for (const [idName, identity] of Object.entries(IDENTITIES)) {
    for (const [ccName, cc] of Object.entries(CONFIDENCES)) {
      for (const src of SOURCES) {
        test(`XP [${idName}] × [${ccName}] × [${src}]`, () => {
          const c = ctx({
            recognition: { category: 'Electronics', subcategory: 'laptop', category_confidence: cc },
            identity, stage: 'pre', pre_source: src,
          });
          const v = validateQuote(q({ low: 400, mid: 900, high: 1600 }), c);

          // Two independent refusals can apply to the same cell — an
          // unregistered source AND an unidentified item. Assert the PROPERTY
          // (no price reaches anyone) rather than which rule happened to fire
          // first; pinning the order would make a future reordering of the
          // guard look like a regression when nothing had weakened.
          const identityless = idName === 'none' && ccName === 'weak-category';
          if (identityless || src === 'unregistered_source') {
            assert.equal(v.action, 'degrade',
              `${idName}/${ccName}/${src} must not price (reason: ${v.metadata.degraded_reason})`);
            assert.deepEqual(v.prices, { low: 0, mid: 0, high: 0 }, 'a refusal emits no band');
            assert.match(v.metadata.degraded_reason, /V-IDENTITY-FLOOR|V-SOURCE-UNREGISTERED/,
              'the refusal must name one of the two rules that apply here');
            return;
          }
          // Everything that IS priced keeps the whole band inside the envelope.
          if (v.action !== 'degrade') {
            const env = resolveEnvelope(c);
            assert.ok(v.prices.high <= env.hard_max, 'displayed high must fit the envelope');
            assert.ok(v.prices.low >= env.floor || v.prices.low > 0, 'low must be a real positive price');
          }
        });
      }
    }
  }
});

// ── END-TO-END: the real handler, not the guard in isolation ────────────────
// The unit tests above prove the RULE. This proves the PIPELINE honours it —
// that a Stage-1 result shaped like the Ninja scan cannot reach the client with
// a product price, through every fallback the handler has.
describe('E2E the Ninja shape reaches the client with no product price', () => {
  test('a scan with no brand, no model, empty OCR and a weak category is withheld', async () => {
    const { harness, IMG, anthropicText } = await import('./helpers/analyze-harness.mjs');
    const h = await harness();
    try {
      delete process.env.RECOGNITION_ENGINE;
      // Exactly what production Stage 1 returned: category Other at 10%,
      // nothing identified, no readable text.
      h.anthropic(() => anthropicText({
        category: 'Other', category_hebrew: 'אחר', category_confidence: 0.10,
        subcategory: '', product_type: '',
        brand_candidates: [], model_candidates: [],
        ocr_text: { raw_texts: [], logos_detected: [], has_readable_text: false },
        visual_features: { condition: 'Good', materials: [], colors: ['black'] },
      }));
      const r = await h.run({ imageData: IMG, lang: 'en' });

      if (r.status === 200) {
        const mv = r.payload?.marketValue ?? r.payload;
        const mid = mv?.price_estimate_mid ?? mv?.mid ?? r.payload?.price_estimate_mid;
        assert.ok(mid === 0 || mid == null,
          `an unidentified item returned a product price of ${mid} — the observed failure was ₪70`);
        const status = JSON.stringify(r.payload);
        assert.match(status, /manual_required/,
          'the response must carry the manual-required state so the UI asks for a better photo');
      }
      // A non-200 is also an acceptable outcome: no price reached the user.
      assert.notEqual(r.payload?.price_estimate_mid, 70, 'the exact production number must not recur');
    } finally {
      h.restore();
    }
  });
});

// ── §9 VARIANT / CAPACITY CHANNEL ───────────────────────────────────────────
describe('a variant-contradicting anchor does not set the envelope', () => {
  const { extractVariantTokens, variantContradiction } = G;

  test('variant tokens are read deterministically', () => {
    assert.deepEqual(extractVariantTokens('iPhone 15 Pro 256GB'), ['256gb']);
    assert.deepEqual(extractVariantTokens('LV Imagination 100ml'), ['100ml']);
    assert.deepEqual(extractVariantTokens('LG 27" monitor'), ['27"']);
    assert.deepEqual(extractVariantTokens('no variant here'), []);
  });

  test('absence is never a contradiction', () => {
    assert.equal(variantContradiction('iPhone 15', 'iPhone 15 Pro 256GB'), null,
      'a row with no capacity token must still be usable as an anchor');
  });

  test('same dimension, different value IS a contradiction', () => {
    assert.ok(variantContradiction('iPhone 15 256GB', 'iPhone 15 1TB'));
    assert.ok(variantContradiction('perfume 50ml', 'perfume 100ml'));
    assert.ok(variantContradiction('monitor 27"', 'monitor 32"'));
  });

  test('a 1TB anchor cannot set the ceiling for a 256GB item', () => {
    const base = {
      recognition: {
        category: 'Electronics', subcategory: 'smartphone', category_confidence: 0.95,
        brand_candidates: [{ brand: 'Apple', confidence: 0.95 }],
        model_candidates: [{ model: 'iPhone 15 256GB', confidence: 0.9 }],
        ocr_text: { raw_texts: ['iPhone 15 256GB'] },
      },
      identity: { brandOk: true, modelOk: true, identityHigh: true },
    };
    const matching = resolveEnvelope({ ...base, anchor: { id: 1, model: 'iPhone 15 256GB', retail_price_ils: 4000 } });
    const conflicting = resolveEnvelope({ ...base, anchor: { id: 2, model: 'iPhone 15 1TB', retail_price_ils: 7500 } });

    assert.equal(matching.basis, 'anchor', 'a matching-variant anchor must still be used');
    assert.notEqual(conflicting.basis, 'anchor',
      'a 1TB anchor describes a different unit and must not set a 256GB item\'s ceiling');
    assert.ok(!String(conflicting.key).startsWith('anchor:'),
      'the rejected anchor must not appear as the envelope key either');

    // Asserted rather than assumed, because it is a real cost: rejecting the
    // anchor falls back to the CATEGORY envelope, which is BROADER than the
    // anchor would have been (electronics:iphone hard_max 24000 against the
    // anchor's 5000). That is the correct trade and it is not free — a tight
    // bound is lost because it can no longer be shown to describe this unit.
    // The alternative is a precise bound derived from a different product.
    assert.equal(conflicting.basis, 'category',
      'a rejected anchor falls back to the category envelope, not to global');
  });
});

// ── §10 CURRENCY BOUNDARY ───────────────────────────────────────────────────
describe('V-FX — money without a proven conversion never contributes', () => {
  const priced = (comps) => validateQuote(q({ low: 250, mid: 380, high: 520 }), { ...CASE_A, comps });

  test('$120 cannot silently become ₪120', () => {
    const v = priced([{ price_amount: 120, currency: 'USD' }]);
    assert.equal(v.action, 'degrade', 'a USD comparable with no conversion record must not price');
    assert.match(v.metadata.degraded_reason, /V-FX/);
  });

  test('a bare symbol is not a currency', () => {
    for (const cur of ['$', '', null, undefined, 'dollars', 'US$']) {
      const v = priced([{ price_amount: 120, currency: cur }]);
      assert.equal(v.action, 'degrade', `currency ${JSON.stringify(cur)} must be refused`);
      assert.match(v.metadata.degraded_reason, /V-FX/);
    }
  });

  test('a conversion record that is not self-consistent is refused', () => {
    const v = priced([{
      price_amount: 120, currency: 'USD',
      fx_rate: 3.7, normalized_amount: 120, normalized_currency: 'ILS',
      fx_timestamp: '2026-09-18T00:00:00Z', fx_source: 'test',
    }]);
    assert.equal(v.action, 'degrade', '120 USD x 3.7 is not 120 ILS');
    assert.match(v.metadata.degraded_reason, /V-FX/);
  });

  test('a complete, arithmetically true conversion is accepted', () => {
    const v = priced([{
      price_amount: 120, currency: 'USD',
      fx_rate: 3.7, normalized_amount: 444, normalized_currency: 'ILS',
      fx_timestamp: '2026-09-18T00:00:00Z', fx_source: 'test',
    }]);
    assert.notEqual(v.metadata.degraded_reason, 'V-FX', 'a proven conversion must be allowed through');
  });

  test('ILS comparables need no conversion record', () => {
    const v = priced([{ price_amount: 400, currency: 'ILS' }]);
    assert.notEqual(v.metadata.degraded_reason, 'V-FX');
  });

  test('no comps at all is unchanged behaviour', () => {
    assert.notEqual(priced(undefined).action, 'degrade');
    assert.notEqual(priced([]).action, 'degrade');
  });
});

// ── §22 ADVERSARIAL — the vectors that found five defects in this work ──────
//
// Every case below PRICED AN UNIDENTIFIED OBJECT when V-IDENTITY-FLOOR was
// first written. They are kept as tests rather than as a memory, because each
// is a different way of being wrong about the same thing: trusting a caller's
// word instead of requiring evidence.
describe('ADV nothing buys pricing eligibility except evidence', () => {
  const noId = { brandOk: false, modelOk: false, identityHigh: false };
  const priceIt = (c) => validateQuote({ low: 100, mid: 200, high: 400, currency: 'ILS' }, c);

  test('a confidence outside [0,1] is malformed, not strong', () => {
    // `5` and `99` are finite and above the floor. A model emitting a number too
    // large to be a probability was buying category trust with it.
    for (const cc of [5, 99, 1.01, -1, Infinity]) {
      const v = priceIt({ stage: 'stage2', identity: noId, recognition: { category: 'Electronics', category_confidence: cc } });
      assert.equal(v.action, 'degrade', `category_confidence ${cc} must not establish a category`);
    }
  });

  test('a confidence that is not a number is malformed, not strong', () => {
    // `true` coerces to exactly 1 under Number(). '0.9' parses cleanly. Neither
    // is a confidence, and the schema declares this field a number.
    for (const cc of [true, '0.9', '1', [], {}, null, undefined, NaN]) {
      const v = priceIt({ stage: 'stage2', identity: noId, recognition: { category: 'Electronics', category_confidence: cc } });
      assert.equal(v.action, 'degrade', `category_confidence ${JSON.stringify(cc)} must not establish a category`);
    }
  });

  test('an ABSENT identity is unidentified, not neutral', () => {
    // Fail-open on the one input the whole rule is about: a caller that simply
    // forgot to pass identity was getting a price.
    for (const identity of [undefined, null, 'yes', 42, []]) {
      const v = priceIt({ stage: 'stage2', identity, recognition: { category: 'Electronics', category_confidence: 0.95 } });
      assert.equal(v.action, 'degrade', `identity ${JSON.stringify(identity)} must not price`);
      assert.equal(v.metadata.identity_tier, IDENTITY_TIER.UNIDENTIFIED);
    }
  });

  test('a truthy non-boolean does not buy the top tier', () => {
    // `{ brandOk: 'yes', modelOk: 'yes' }` with a nonsense category reached
    // EXACT_MODEL and the 500,000 global ceiling.
    const v = priceIt({
      stage: 'stage2',
      identity: { brandOk: 'yes', modelOk: 'yes' },
      recognition: { category: 'Nonsense', category_confidence: 0.01 },
    });
    assert.equal(v.action, 'degrade', 'truthiness is not evidence');
    assert.equal(v.metadata.identity_tier, IDENTITY_TIER.UNIDENTIFIED);
  });

  test('a caller-supplied envelope_key cannot answer the identity question', () => {
    // The caller may choose which envelope BOUNDS a price. It may not choose the
    // evidence that decides whether there is a price at all — passing
    // envelope_key:'electronics' for a "Footwear" item used to do exactly that.
    const v = priceIt({
      stage: 'stage2', identity: noId, envelope_key: 'electronics',
      recognition: { category: 'Footwear', category_confidence: 0.99 },
    });
    assert.equal(v.action, 'degrade',
      'the category-bucket check must read the recognition, not the caller-supplied key');
  });

  test('an anchor does not rescue an unidentified item', () => {
    const v = priceIt({
      stage: 'stage2', identity: noId, anchor: { id: 'x', retail_price_ils: 5000 },
      recognition: { category: 'Footwear', category_confidence: 0.01 },
    });
    assert.equal(v.action, 'degrade', 'a catalog anchor is not an identity');
  });

  test('a MANUAL_REQUIRED grade refuses the NUMBER, not just the label', () => {
    // The grade was being stapled to an accepted ₪200. A grade nothing enforces
    // is a caption, and a future market source would have shipped prices under it.
    for (const src of ['none', 'db_retail', 'market_search', '', null, undefined]) {
      const v = priceIt({
        stage: 'pre', pre_source: src,
        identity: { brandOk: true, modelOk: true, identityHigh: true },
        recognition: { category: 'Electronics', category_confidence: 0.9 },
      });
      assert.equal(v.metadata.pricing_grade, 'MANUAL_REQUIRED', `${src} must grade MANUAL_REQUIRED`);
      assert.equal(v.action, 'degrade', `${src} graded MANUAL_REQUIRED but still priced`);
      assert.deepEqual(v.prices, { low: 0, mid: 0, high: 0 });
    }
  });

  test('every registered source still prices — the rule is not "refuse everything"', () => {
    // The control. Without it, a guard that degraded unconditionally would pass
    // every assertion above.
    for (const src of ['catalog', 'ai_haiku']) {
      const v = priceIt({
        stage: 'pre', pre_source: src,
        identity: { brandOk: true, modelOk: true, identityHigh: true },
        recognition: { category: 'Electronics', category_confidence: 0.9 },
      });
      assert.notEqual(v.action, 'degrade', `registered source ${src} must still price`);
    }
    // `category_anchor` is registered and DOES price — but not for a confidently
    // identified product, which V-SOURCE-POLICY (B-15) has always forbidden.
    // Asserted with a weaker identity so the control tests registration rather
    // than accidentally re-testing B-15.
    const catAnchor = priceIt({
      stage: 'pre', pre_source: 'category_anchor',
      identity: { brandOk: true, modelOk: false, identityHigh: false },
      recognition: { category: 'Electronics', category_confidence: 0.9 },
    });
    assert.notEqual(catAnchor.action, 'degrade', 'category_anchor is registered and must price a weak identity');
  });
});

// ── THE FAMILY TIER MUST BE REACHABLE ───────────────────────────────────────
// It was not. The first draft read `product_family`, which lives only inside
// the OpenAI identity object; both engines put `model_family` on the
// recognition root (RECOGNITION_SCHEMA declares it; the OpenAI normalizer maps
// onto it). The tier failed safe — those items fell to BRAND_ONLY, which is
// stricter — but an unreachable branch is not a rule.
describe('the FAMILY tier is reachable on the field both engines emit', () => {
  // brandC is required now: a name with no confidence behind it is not an
  // evidenced brand, so these fixtures have to state the evidence they assume.
  const brandOnly = { brandOk: true, modelOk: false, identityHigh: false, brandC: 0.9 };

  test('model_family reaches FAMILY', () => {
    assert.equal(resolveIdentityTier({
      identity: brandOnly,
      recognition: { category: 'Electronics', category_confidence: 0.9, model_family: 'Logitech G-series gaming mouse' },
    }), IDENTITY_TIER.FAMILY);
  });

  test('product_family is tolerated as an alias', () => {
    assert.equal(resolveIdentityTier({
      identity: brandOnly,
      recognition: { category: 'Electronics', category_confidence: 0.9, product_family: 'Logitech G-series' },
    }), IDENTITY_TIER.FAMILY);
  });

  test('no family, or an empty one, stays BRAND_ONLY', () => {
    for (const model_family of [undefined, null, '', '   ', 42, {}]) {
      assert.equal(resolveIdentityTier({
        identity: brandOnly,
        recognition: { category: 'Electronics', category_confidence: 0.9, model_family },
      }), IDENTITY_TIER.BRAND_ONLY, `family ${JSON.stringify(model_family)} must not promote the tier`);
    }
  });

  test('a family without a brand does not promote anything', () => {
    assert.equal(resolveIdentityTier({
      identity: { brandOk: false, modelOk: false, brandC: 0 },
      recognition: { category: 'Electronics', category_confidence: 0.9, model_family: 'some family' },
    }), IDENTITY_TIER.CATEGORY_ONLY, 'a family is a refinement of a brand, not a substitute for one');
  });

  test('the field name matches what the engines actually declare', () => {
    // Pin the agreement between guard and producers, since the mismatch is the
    // defect and nothing else would have caught it.
    const analyze = readFileSync(new URL('../api/analyze.js', import.meta.url), 'utf8');
    const normalize = readFileSync(new URL('../api/_lib/openai-recognition-normalize.js', import.meta.url), 'utf8');
    assert.match(analyze, /model_family:\s*\{ type: \['string', 'null'\] \}/,
      'the current engine must still declare model_family in RECOGNITION_SCHEMA');
    assert.match(normalize, /model_family: family/,
      'the OpenAI normalizer must still map its product_family onto model_family');
  });
});

// ── A NAME IS NOT EVIDENCE ──────────────────────────────────────────────────
//
// The Ninja defect's sibling, and the more dangerous half. V-IDENTITY-FLOOR as
// first written closed "no identity ⇒ no price" and left "INVENTED identity ⇒
// priced" wide open: `brandOk` is `brand !== 'unidentified'`, a string-presence
// test, so any non-empty name bought the EXACT_MODEL tier. A confidence floor
// was applied to the category and none at all to the brand or the model.
//
// Found by an independent reviewer driving the real handler. Pinned here
// because the recognition path — unscored Vision labels, and a Stage-2 prompt
// told to prefer them — is precisely the machine that manufactures a
// confident-sounding name out of nothing.
describe('an invented identity cannot buy a price', () => {
  const hallucinated = {
    brandOk: true, modelOk: true, identityHigh: false,
    brandC: 0.55, modelC: 0.50,   // shape-only guesses, no text
  };
  const sneaker = {
    category: 'Footwear', subcategory: 'sneaker', category_confidence: 0.6,
    brand_candidates: [{ brand: 'Nike', confidence: 0.55, evidence: 'visual_shape' }],
    model_candidates: [{ model: 'Air Max', confidence: 0.50, evidence: 'shape_only' }],
    ocr_text: { raw_texts: [] },
  };

  test('the reviewer witness — "Nike Air Max" at 0.55/0.50 — is refused', () => {
    const v = validateQuote({ low: 35, mid: 70, high: 130, currency: 'ILS' },
      { stage: 'stage2', identity: hallucinated, recognition: sneaker });
    assert.equal(v.action, 'degrade', 'a shape-only guess is not an identity');
    assert.notEqual(v.metadata.identity_tier, IDENTITY_TIER.EXACT_MODEL,
      'a name with no evidence behind it must not reach the top tier');
  });

  test('the floor is on EVIDENCE, swept — not on one witness value', () => {
    for (const c of [0.0, 0.1, 0.3, 0.5, 0.59]) {
      const tier = resolveIdentityTier({
        identity: { brandOk: true, modelOk: true, brandC: c, modelC: c },
        recognition: { category: 'Electronics', category_confidence: 0.9 },
      });
      assert.notEqual(tier, IDENTITY_TIER.EXACT_MODEL,
        `brand/model confidence ${c} is below the floor and must not reach EXACT_MODEL`);
    }
    for (const c of [0.6, 0.75, 0.95]) {
      assert.equal(resolveIdentityTier({
        identity: { brandOk: true, modelOk: true, brandC: c, modelC: c },
        recognition: { category: 'Electronics', category_confidence: 0.9 },
      }), IDENTITY_TIER.EXACT_MODEL, `an evidenced identity at ${c} must still price`);
    }
  });

  test('text-confirmed identity bypasses the numeric floor — reading beats scoring', () => {
    // A name READ off the item is stronger evidence than any number the model
    // assigns itself, so confirmed_by_text must not be blocked by a low score.
    assert.equal(resolveIdentityTier({
      identity: { brandOk: true, modelOk: true, brandC: 0.4, modelC: 0.3, brandConfLabel: 'confirmed_by_text' },
      recognition: { category: 'Electronics', category_confidence: 0.9 },
    }), IDENTITY_TIER.EXACT_MODEL);
  });

  test('CATEGORY_ONLY is REACHABLE — the tier is not decorative', () => {
    // calibrateRecognition caps a brandless recognition at 0.55 and the guard
    // reads the CALIBRATED value, so a 0.60 floor made this tier unenterable in
    // production while its tests passed against hand-built ctx.
    assert.equal(resolveIdentityTier({
      identity: { brandOk: false, modelOk: false },
      recognition: { category: 'Electronics', category_confidence: 0.55 },
    }), IDENTITY_TIER.CATEGORY_ONLY, 'the calibrated brandless ceiling must be able to reach this tier');
    assert.ok(CATEGORY_CONFIDENCE_FLOOR < 0.55,
      `the floor (${CATEGORY_CONFIDENCE_FLOOR}) must sit below calibrateRecognition's 0.55 brandless cap, ` +
      'or CATEGORY_ONLY can never be entered in production');
  });

  test('a brandless textless scan still lands UNIDENTIFIED', () => {
    // 0.55 minus the 0.15 no-readable-text penalty = 0.40. The tier must stay
    // reachable without becoming a way in for the Ninja shape.
    assert.equal(resolveIdentityTier({
      identity: { brandOk: false, modelOk: false },
      recognition: { category: 'Electronics', category_confidence: 0.40 },
    }), IDENTITY_TIER.UNIDENTIFIED);
  });
});

// ── THE GUARD MUST SEE WHAT STAGE 2 ESTABLISHED ─────────────────────────────
//
// V-IDENTITY-FLOOR reads an identity assessed from STAGE 1 ONLY, which made it
// falsely refuse the exact scan the pipeline exists to rescue: Stage 1 blank,
// Vision reads the logo and the model plate, Stage 2 returns ocr_confirmed.
// The item was correctly identified and the price was withheld anyway.
//
// The upgrade requires corroboration the model did not author — the brand must
// appear in text READ off the image. Asserting a name is not evidence.
describe('E2E a Stage-2 identity corroborated by read text is not refused', () => {
  const blankStage1 = {
    category: 'Electronics', category_hebrew: 'אלקטרוניקה', category_confidence: 0.55,
    subcategory: 'mouse', product_type: 'mouse',
    brand_candidates: [], model_candidates: [],
    ocr_text: { raw_texts: [], logos_detected: [], has_readable_text: false },
    visual_features: { condition: 'Good', materials: ['plastic'], colors: ['black'] },
  };
  const stage2Confirmed = {
    final_category: 'Electronics', final_category_hebrew: 'אלקטרוניקה',
    final_brand: 'Logitech', final_model: 'G502 HERO',
    match_confidence: 0.92, identification_method: 'ocr_confirmed',
    brand_confidence: 'confirmed_by_text',
    price_estimate_low: 150, price_estimate_mid: 240, price_estimate_high: 340,
    price_method: 'comp_based', currency: 'ILS', condition: 'Good',
    matched_product_ids: [], comparable_items: [], price_factors: [],
    selling_tips: '', israeli_market_notes: '', is_sellable: true, market_demand: 'moderate',
    confidence_reasoning: 'model plate read by Vision',
  };

  test('Vision reads the plate, Stage 2 confirms it, a price is returned', async () => {
    const { harness, IMG, anthropicText } = await import('./helpers/analyze-harness.mjs');
    const h = await harness();
    try {
      delete process.env.RECOGNITION_ENGINE;
      let call = 0;
      h.anthropic(() => (++call === 1 ? anthropicText(blankStage1) : anthropicText(stage2Confirmed)));
      // The corroboration: Google Vision actually reads the brand off the item.
      // Google returns textAnnotations[0] as the whole concatenated block and
      // [1..] as individual words; parseVisionResponse `.slice(1)` accordingly.
      // A one-element stub would leave `visionData.text` EMPTY and quietly test
      // nothing — which is exactly what the first version of this fixture did.
      h.vision(() => ({ body: { responses: [{
        textAnnotations: [
          { description: 'Logitech G502 HERO' },
          { description: 'Logitech' }, { description: 'G502' }, { description: 'HERO' },
        ],
        logoAnnotations: [{ description: 'Logitech', score: 0.94 }],
        labelAnnotations: [{ description: 'Computer mouse', score: 0.9 }],
      }] } }));

      const r = await h.run({ imageData: IMG, lang: 'en' });
      const payload = JSON.stringify(r.payload);
      assert.ok(!/V-IDENTITY-FLOOR/.test(payload),
        'a Vision-read, Stage-2-confirmed identity must not hit the identity floor');
    } finally { h.restore(); }
  });

  test('an UNCORROBORATED Stage-2 claim does NOT upgrade the identity', () => {
    // The control, and the reason the upgrade is gated. Stage 2 asserting
    // `ocr_confirmed` with no text anywhere to support it is the model grading
    // its own homework — which is what SCAN-022 exists to refuse.
    const src = readFileSync(new URL('../api/analyze.js', import.meta.url), 'utf8');
    assert.match(src, /if \(verification\?\.identification_method !== 'ocr_confirmed'\) return base;/,
      'the upgrade must require ocr_confirmed');
    assert.match(src, /if \(!brandByLogo && brandLines\.length === 0\) return base;/,
      'the brand must be corroborated by a logo or by a non-compatibility line');
    assert.match(src, /if \(!modelCorroborated\) return base;/,
      'and the MODEL too — that is what ocr_confirmed actually claims');
    assert.match(src, /const COMPATIBILITY = /,
      'a line describing COMPATIBILITY must not corroborate — that is the accessory attack');
    assert.match(src, /const hasPhrase = /,
      'matching must be contiguous per line, not a bag of words pooled across lines');
  });
});

// ── CORROBORATION IS NOT A COINCIDENCE ──────────────────────────────────────
//
// The first Stage-2 upgrade tested `readText.includes(brand)` — a raw
// substring — and reopened the hallucinated-identity CRITICAL through a side
// door. Vision reading "APPLE JUICE 1L" corroborated brand "Apple", and a juice
// carton shipped as "Apple iPhone 15 Pro" at ₪1,500, grade MEDIUM, no warning,
// at SPREAD_MAX_CONFIRMED — the system's NARROWEST band, i.e. its highest
// stated certainty, on an invented identity. "ORANGE JUICE" did the same for
// "GE", because "ge" is a substring of "orange".
//
// Found by an independent reviewer. The predicate now matches whole tokens and
// verifies the claim that `ocr_confirmed` actually makes: that the MODEL was
// read off the item.
describe('the Stage-2 identity upgrade cannot be satisfied by coincidence', () => {
  const src = readFileSync(new URL('../api/analyze.js', import.meta.url), 'utf8');

  test('the predicate matches WHOLE TOKENS, not substrings', () => {
    assert.equal(/readText\.includes\(b\.toLowerCase\(\)\)/.test(src), false,
      'the raw-substring corroboration must not come back — "apple" in "APPLE JUICE" forged an iPhone');
    assert.match(src, /const readTokens = new Set\(toks\(/, 'corroboration must be token-based');
  });

  test('the MODEL must be corroborated, because that is what ocr_confirmed claims', () => {
    assert.match(src, /if \(!modelCorroborated\) return base;/,
      'a brand appearing somewhere is not evidence that the model was read');
    assert.match(src, /shaped\.some\(\(t\) => toks\(l\)\.includes\(t\)\)/,
      'a model-shaped token is the strongest available corroboration, matched per line');
    assert.match(src, /\(\?=\.\*\[a-z\]\)\(\?=\.\*\[0-9\]\)/,
      'a shaped token must MIX letters and digits — bare digits let a warranty year ' +
      'or a price tag stand in for a model number');
  });

  test('a Vision LOGO is accepted as brand corroboration — a different signal class', () => {
    assert.match(src, /logoNames\.includes\(norm\(b\)\)/,
      'the legitimate logo-plus-model-plate rescue must keep working');
  });

  test('the upgrade still requires ocr_confirmed', () => {
    assert.match(src, /identification_method !== 'ocr_confirmed'/,
      'Stage 2 grading its own homework is not evidence — SCAN-022');
  });
});

test('a low-confidence Vision logo cannot corroborate a brand', () => {
  // parseVisionResponse maps logoAnnotations with NO score filter, while
  // webEntities two lines below are filtered at 0.5 — the same asymmetry that
  // let an unscored label become "Footwear". A 2% logo guess corroborated a
  // brand identically to a 94% one, and because this path writes
  // confirmed_by_text it bought a bypass of IDENTITY_CONFIDENCE_FLOOR and the
  // narrowest spread band the system has. Witness: a silicone phone case, OCR
  // "For iPhone 15 Pro", Apple logo guessed at 0.02, priced ₪1,500.
  const src = readFileSync(new URL('../api/analyze.js', import.meta.url), 'utf8');
  assert.match(src, /\.filter\(\(l\) => Number\(l\?\.score\) >= VISION_TRIGGER_THRESHOLD\)/,
    'logo corroboration must respect the logo score');
  assert.equal(/const logoNames = \(visionData\?\.logos \|\| \[\]\)\.map\(/.test(src), false,
    'the unfiltered logo mapping must not come back');
});

test('a category-only price cannot claim more than category-level confidence', () => {
  // Before the cap, a brandless/modelless "Clothing" scan and a forged identity
  // both surfaced as MEDIUM. The grade is the machine-readable field the spread
  // limits and downstream logic key on, so that collision made it useless as a
  // signal for exactly the distinction it should carry.
  const v = validateQuote({ low: 30, mid: 70, high: 130, currency: 'ILS' }, {
    stage: 'pre', pre_source: 'ai_haiku',
    identity: { brandOk: false, modelOk: false, identityHigh: false },
    recognition: { category: 'Clothing', subcategory: 't-shirt', category_confidence: 0.55,
                   ocr_text: { raw_texts: ['cotton'] } },
  });
  assert.notEqual(v.action, 'degrade', 'generic clothing genuinely has a category price');
  assert.equal(v.metadata.identity_tier, IDENTITY_TIER.CATEGORY_ONLY);
  assert.equal(v.metadata.pricing_grade, 'LOW', 'a category-only price may not grade above LOW');
  assert.equal(v.metadata.needs_review, true, 'and it must be flagged');
  assert.ok(v.violations.some((x) => x.rule === 'V-IDENTITY-GRADE-CAP'),
    'the reason must be recorded, not implied by the number');
});

test('an identified product is NOT capped — the rule is about identity, not caution', () => {
  const v = validateQuote({ low: 250, mid: 380, high: 520, currency: 'ILS' }, {
    stage: 'pre', pre_source: 'catalog', anchorModelEvidence: true,
    identity: { brandOk: true, modelOk: true, identityHigh: true, brandC: 0.95, modelC: 0.9 },
    recognition: { category: 'Electronics', subcategory: 'gaming mouse', category_confidence: 0.95 },
  });
  assert.equal(v.metadata.identity_tier, IDENTITY_TIER.EXACT_MODEL);
  assert.notEqual(v.metadata.pricing_grade, 'LOW', 'an evidenced identity keeps its earned grade');
});

test('the _debug allowlist covers every section the pipeline builds', () => {
  // The first allowlist named five sections while the object builds eight, so
  // recognition_engine, ocr_context and memory were silently deleted from the
  // response AND from ai_raw_response — breaking the OpenAI-vs-Claude
  // benchmark, SCAN-014 shadow memory, and OCE capture. 682 green tests missed
  // it because nothing asserted a _debug section. This is that assertion.
  const src = readFileSync(new URL('../api/analyze.js', import.meta.url), 'utf8');
  const block = src.slice(src.indexOf('result._debug = {'), src.indexOf('DEBUG_PUBLIC_SECTIONS'));
  const built = [...block.matchAll(/^ {6}([a-z_]+):/gm)].map((m) => m[1]);
  const allowed = (/DEBUG_PUBLIC_SECTIONS = \[([^\]]+)\]/.exec(src)?.[1] ?? '')
    .split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);

  // The regex sees the sections declared at this indent; stage1/stage2 are
  // asserted by name below so a rename cannot slip past the count.
  assert.ok(built.length >= 6, `expected the debug object's sections, found ${built.length}`);
  for (const required of ['stage1', 'stage2']) {
    assert.ok(allowed.includes(required), `${required} must stay allowlisted`);
  }
  assert.deepEqual(built.filter((s) => !allowed.includes(s)), [],
    'a _debug section is built but not allowlisted — it is being silently dropped from both ' +
    'the client response and ai_raw_response');
});

test('corroboration comes from an INDEPENDENT reader, not the model itself', () => {
  // The first version drew corroborating text from recognition.ocr_text.raw_texts
  // — a transcription THE SAME MODEL produced. Stage 2 claiming "Rolex
  // Submariner 126610" was corroborated by Stage 1 having written
  // "ROLEX SUBMARINER 126610": the model grading its own homework, which is
  // what SCAN-022 exists to refuse and what the comment claimed to avoid.
  // Found by an independent security review; the claim was false whenever
  // Vision had not run.
  const src = readFileSync(new URL('../api/analyze.js', import.meta.url), 'utf8');
  // NOTE: there is an unrelated `const logoNames` far earlier in the file (the
  // OCE scoring block), so the end of the slice must be searched FORWARD from
  // the start — the first draft of this test sliced backwards and compared an
  // empty string, which passes for the wrong reason.
  const start = src.indexOf('const readTokens = new Set(');
  const block = src.slice(start, src.indexOf('const logoNames', start));
  assert.ok(block.length > 40, 'fixture: the corroboration block must be locatable');
  assert.equal(/recognition\.ocr_text/.test(block), false,
    'Stage-1 OCR is model output and must never corroborate a Stage-2 claim');
  assert.match(block, /visionData\?\.text/,
    'corroboration must come from Vision — a different vendor reading the same pixels');
});

// ── A REAL ORACLE FOR THE HANDLER'S RESPONSE ────────────────────────────────
//
// The handler returns `{ content: [{ type: 'text', text: JSON.stringify(result) }] }`
// (api/analyze.js:5619). The first E2E test here read `r.payload.marketValue`,
// which is undefined for EVERY scan — so its assertion could not fail, and a
// PRICED result passed it identically to a refused one. That blind oracle is
// why a suite at 100% mutation score stayed green over a CRITICAL. Found by an
// independent valuation review.
const decode = (r) => {
  assert.ok(r.payload?.content?.[0]?.text, `expected the handler envelope, got ${JSON.stringify(r.payload).slice(0, 200)}`);
  return JSON.parse(r.payload.content[0].text);
};
const midOf = (res) => res?.marketValue?.mid ?? res?.marketValue?.price_estimate_mid ?? null;

describe('E2E the real pipeline, read through a real oracle', () => {
  const blankStage1 = {
    category: 'Electronics', category_hebrew: 'אלקטרוניקה', category_confidence: 0.55,
    subcategory: 'phone case', product_type: 'case',
    brand_candidates: [], model_candidates: [],
    ocr_text: { raw_texts: [], logos_detected: [], has_readable_text: false },
    visual_features: { condition: 'Good', materials: ['silicone'], colors: ['black'] },
  };
  const stage2Claim = (brand, model) => ({
    final_category: 'Electronics', final_category_hebrew: 'אלקטרוניקה',
    final_brand: brand, final_model: model,
    match_confidence: 0.92, identification_method: 'ocr_confirmed',
    brand_confidence: 'confirmed_by_text',
    price_estimate_low: 3400, price_estimate_mid: 3800, price_estimate_high: 4200,
    price_method: 'comp_based', currency: 'ILS', condition: 'Good',
    matched_product_ids: [], comparable_items: [], price_factors: [],
    selling_tips: '', israeli_market_notes: '', is_sellable: true, market_demand: 'moderate',
    confidence_reasoning: 'read from the label',
  });

  test('a compatibility label on an accessory does NOT price it as the product', async () => {
    // The CRITICAL, produced independently by two reviewers: a ₪20 silicone
    // case whose own packaging reads "Compatible with Apple iPhone 15 Pro Max"
    // shipped as an iPhone at ₪3,800 — roughly 190x its value. A compatibility
    // label contains the brand and model tokens BY DESIGN.
    const { harness, IMG, anthropicText } = await import('./helpers/analyze-harness.mjs');
    const h = await harness();
    try {
      delete process.env.RECOGNITION_ENGINE;
      let call = 0;
      h.anthropic(() => (++call === 1 ? anthropicText(blankStage1) : anthropicText(stage2Claim('Apple', 'iPhone 15 Pro Max'))));
      h.vision(() => ({ body: { responses: [{
        textAnnotations: [
          { description: 'Compatible with Apple iPhone 15 Pro Max Silicone Case' },
          { description: 'Compatible' }, { description: 'with' }, { description: 'Apple' },
          { description: 'iPhone' }, { description: '15' }, { description: 'Pro' },
          { description: 'Max' }, { description: 'Silicone' }, { description: 'Case' },
        ],
        logoAnnotations: [],
        labelAnnotations: [{ description: 'Mobile phone case', score: 0.9 }],
      }] } }));

      const res = decode(await h.run({ imageData: IMG, lang: 'en' }));
      const mid = midOf(res);
      assert.notEqual(mid, 3800,
        `an accessory was priced as the product it is compatible with (₪${mid})`);
      assert.ok(mid === null || mid === 0 || mid < 1000,
        `a ₪20 case must not carry a flagship-phone price, got ₪${mid}`);
    } finally { h.restore(); }
  });

  test('the oracle is not blind — a PRICED scan reads back a real number', async () => {
    // The control that the previous version lacked. Without it, "no price" and
    // "the test cannot see prices" are indistinguishable.
    const { harness, IMG, anthropicText, VALID_RECOGNITION } = await import('./helpers/analyze-harness.mjs');
    const h = await harness();
    try {
      delete process.env.RECOGNITION_ENGINE;
      h.anthropic(() => anthropicText(VALID_RECOGNITION));
      const res = decode(await h.run({ imageData: IMG, lang: 'en' }));
      assert.ok(Object.prototype.hasOwnProperty.call(res, 'marketValue'),
        'the decoded result must actually expose marketValue — otherwise every price assertion is vacuous');
    } finally { h.restore(); }
  });
});

test('ctx.comps actually reaches the guard — V-FX has a reachable input', () => {
  // The guard read ctx.comps and the only production caller built gctx as an
  // explicit field whitelist WITHOUT it, so the currency boundary could never
  // fire. A rule with no reachable input is the fourth time that shape appeared
  // in this work — the FAMILY tier, the CATEGORY_ONLY tier, the market fence,
  // and this. Found by an independent architecture review.
  const src = readFileSync(new URL('../api/analyze.js', import.meta.url), 'utf8');
  const gctx = src.slice(src.indexOf('const gctx = {'), src.indexOf('let verdict = null;'));
  assert.ok(gctx.length > 100, 'fixture: the gctx builder must be locatable');
  assert.match(gctx, /comps:/,
    'gctx is a field whitelist — a field the guard reads must be listed here or it is silently dropped');

  // And the guard must still read it, so the two cannot drift apart.
  const guard = readFileSync(new URL('../api/_lib/valuation-guard.js', import.meta.url), 'utf8');
  assert.match(guard, /Array\.isArray\(ctx\.comps\)/, 'V-FX must still consume ctx.comps');
});

test('V-FX fires end to end once a comparable is present', () => {
  // Proves the wiring, not just the field name: an unconvertible USD comp must
  // now degrade through the same ctx the handler builds.
  const withBadComp = {
    stage: 'stage2',
    identity: { brandOk: true, modelOk: true, identityHigh: true, brandC: 0.95, modelC: 0.9 },
    recognition: { category: 'Electronics', subcategory: 'gaming mouse', category_confidence: 0.95 },
    comps: [{ price_amount: 120, currency: 'USD' }],
  };
  const v = validateQuote({ low: 250, mid: 380, high: 520, currency: 'ILS' }, withBadComp);
  assert.equal(v.action, 'degrade', 'a USD comp with no conversion record must degrade');
  assert.match(v.metadata.degraded_reason, /V-FX/);
});
