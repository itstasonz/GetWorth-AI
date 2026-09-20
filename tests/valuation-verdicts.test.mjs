// ══════════════════════════════════════════════════════════════════════════════
// RECOGNITION AND VALUATION ARE TWO VERDICTS  ·  §0, §5, §8
//
// THE PRODUCT INVARIANT
//   Knowing WHAT an item is does not establish WHAT IT IS WORTH.
//
// THE DEFECT THIS REPLACES
// `derivePricingSource` returned `{ source: 'stage2_ai', grade: 'MEDIUM' }` for
// any Stage-2 result without a catalog anchor. A real scan of a real product
// GetWorth had never seen:
//
//   Ninja Detect Power Blender Pro — brand 0.94 read off the item, model 0.88
//   read off the item, no catalog row anywhere
//     -> identity EXACT_MODEL, ACCEPT ₪400, grade MEDIUM, source stage2_ai
//
// ₪400 is a number the model wrote down. Nothing measured it, nothing compared
// it to anything, and the user saw it in the same shape — with a BETTER grade —
// than a price backed by a real catalog row. There was no state in the system
// meaning "we know what this is and not yet what it costs", so the pipeline had
// nowhere to put the truth and put a guess there instead.
//
// THE DATABASE IS EVIDENCE AND MEMORY, NOT A WHITELIST. An item absent from the
// catalog is not unrecognisable. It is UNPRICED. Different sentences, and now
// different fields.
//
// THE DIRECTION IS DELIBERATELY COUNTERINTUITIVE, and several tests below assert
// it explicitly: BETTER recognition moves a scan from BOUNDED to PENDING_MARKET,
// i.e. from a category-level estimate to an honest refusal — not to a
// better-looking number. A product-level claim requires product-level evidence.
// A reader who finds that surprising is the reason it is asserted rather than
// commented.
//
//   node --test tests/valuation-verdicts.test.mjs
// ══════════════════════════════════════════════════════════════════════════════
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
// VAL001_GUARD_PATH points this suite at a MUTATED COPY of the guard, exactly as
// tests/valuation-guard.test.mjs is pointed. Without the indirection the mutation
// harness would load the real module and every mutant here would survive -- a
// suite that cannot be aimed at broken code cannot testify that it detects any.
const GUARD_URL = process.env.VAL001_GUARD_PATH
  ? new URL(`file://${process.env.VAL001_GUARD_PATH}`)
  : new URL('../api/_lib/valuation-guard.js', import.meta.url);
const G = await import(GUARD_URL.href);
const {
  validateQuote, resolveRecognitionVerdict, resolveValuationVerdict, RECOGNITION_VERDICT, VALUATION_VERDICT, IDENTITY_TIER, ENVELOPES,
} = G;
// The sibling is loaded through its own env var for the same reason the guard is:
// an 'authority' mutant is written beside the mutated guard, and a suite that
// imported the REAL module would report every one of them as SURVIVED. The
// mutation run found exactly that -- five survivors whose only defect was that
// the test could not see the broken code.
const AUTHORITY_URL = process.env.VAL001_AUTHORITY_PATH
  ? new URL(`file://${process.env.VAL001_AUTHORITY_PATH}`)
  : new URL('../api/_lib/pricing-authority.js', import.meta.url);
const A = await import(AUTHORITY_URL.href);
const {
  deriveEvidence,
} = A;

/** Compose the two modules exactly as api/analyze.js does. */
const scan = ({ recognition, visionData = null, anchor = null, identity, stage = 'stage2', pre_source = null }) => ({
  stage, pre_source, anchor, model: 'test-model', identity, recognition,
  evidence: deriveEvidence({ recognition, visionData, anchor }).classes,
});
const withCatalogRow = (c) => ({ ...c, stage: 'pre', pre_source: 'catalog', anchorModelEvidence: true });
const readIdentity = (hasModel = true) => ({
  brandOk: true, modelOk: hasModel, brandC: 0.94, modelC: hasModel ? 0.88 : 0,
  brandConfLabel: 'confirmed_by_text', identityHigh: hasModel,
});
const q = (mid) => ({ low: Math.round(mid * 0.7), mid, high: Math.round(mid * 1.4), currency: 'ILS' });

// ── The four required product witnesses, as recognition objects ─────────────
const NINJA = {
  category: 'Home', category_confidence: 0.92, subcategory: 'blender',
  brand_candidates: [{ brand: 'Ninja', confidence: 0.94, evidence: 'readable_text' }],
  model_candidates: [{ model: 'Detect Power Blender Pro', confidence: 0.88, evidence: 'ocr' }],
  ocr_text: { raw_texts: ['NINJA', 'Detect Power Blender Pro'] },
};
const LOGITECH = {
  category: 'Electronics', category_confidence: 0.95, subcategory: 'gaming mouse', product_type: 'mouse',
  brand_candidates: [{ brand: 'Logitech', confidence: 0.95, evidence: 'readable_text' }],
  model_candidates: [{ model: 'G Pro X Superlight', confidence: 0.9, evidence: 'ocr' }],
  ocr_text: { raw_texts: ['Logitech G PRO X SUPERLIGHT'] },
};
const LG = {
  category: 'Electronics', category_confidence: 0.92, subcategory: 'monitor', product_type: 'monitor',
  brand_candidates: [{ brand: 'LG', confidence: 0.9, evidence: 'readable_text' }],
  model_candidates: [],
  ocr_text: { raw_texts: ['LG'] },
};
const LV = {
  category: 'Beauty', category_confidence: 0.93, subcategory: 'fragrance', product_type: 'perfume',
  brand_candidates: [{ brand: 'Louis Vuitton', confidence: 0.95, evidence: 'readable_text' }],
  model_candidates: [{ model: 'Imagination', confidence: 0.9, evidence: 'ocr' }],
  ocr_text: { raw_texts: ['LOUIS VUITTON', 'IMAGINATION'] },
};
const UNKNOWN_OBJECT = {
  category: 'Other', category_confidence: 0.10, subcategory: '', product_type: '',
  brand_candidates: [], model_candidates: [], ocr_text: { raw_texts: [] },
};

describe('VV-1 the Ninja witness — IDENTIFIED and PENDING_MARKET', () => {
  const ctx = scan({ recognition: NINJA, identity: readIdentity() });

  test('VV-1a recognition SUCCEEDS, and is recorded as having succeeded', () => {
    assert.equal(resolveRecognitionVerdict(ctx), RECOGNITION_VERDICT.IDENTIFIED);
    const v = validateQuote(q(400), ctx);
    assert.equal(v.metadata.identity_tier, IDENTITY_TIER.EXACT_MODEL);
    assert.equal(v.metadata.recognition_verdict, RECOGNITION_VERDICT.IDENTIFIED);
  });

  test('VV-1b and NO PRICE SHIPS — the exact ₪400 the old code returned', () => {
    const v = validateQuote(q(400), ctx);
    assert.equal(v.metadata.valuation_verdict, VALUATION_VERDICT.PENDING_MARKET);
    assert.equal(v.action, 'pending');
    assert.deepEqual(v.prices, { low: 0, mid: 0, high: 0 });
    assert.equal(v.metadata.pricing_grade, 'MANUAL_REQUIRED',
      'MEDIUM said this was better evidenced than an unanchored catalog row. It was not evidenced at all.');
    assert.ok(v.violations.some((x) => x.rule === 'V-MARKET-EVIDENCE'));
  });

  test('VV-1c the refusal is NOT a recognition failure, and says so', () => {
    // The distinction /api/enrich will depend on: a pending scan carries an
    // identity worth researching, a degraded one does not.
    const v = validateQuote(q(400), ctx);
    assert.notEqual(v.action, 'degrade');
    assert.notEqual(v.metadata.recognition_verdict, RECOGNITION_VERDICT.UNKNOWN);
    assert.ok(!/V-IDENTITY-FLOOR/.test(v.metadata.degraded_reason || ''));
  });

  test('VV-1d the identity survives the refusal, for Phase B to research', () => {
    // A PENDING_MARKET row that cannot say WHAT is pending is indistinguishable
    // from a failure, and Phase B would have nothing to take as input.
    const v = validateQuote(q(400), ctx);
    assert.deepEqual(v.metadata.evidence, ['BRAND_TEXT', 'PRODUCT_TEXT', 'DERIVED']);
    assert.equal(v.metadata.envelope_key, 'home:kitchen appliance',
      'the envelope is still resolved — Phase B needs the bound it will validate against');
    assert.equal(v.metadata.identity_tier, IDENTITY_TIER.EXACT_MODEL);
  });

  test('VV-1e NO PRICE AT ANY VALUE — this is not an envelope check in disguise', () => {
    // Every one of these sits comfortably inside home:kitchen appliance
    // (floor 20 / soft 1,500 / hard 4,800). If any priced, the rule would be a
    // bounds check wearing a verdict's name.
    for (const mid of [30, 200, 400, 900, 1400]) {
      const v = validateQuote(q(mid), ctx);
      assert.equal(v.action, 'pending', `₪${mid} is inside the envelope and must still not price`);
    }
  });

  test('VV-1f a catalog row resolves it — the state is not a dead end', () => {
    const v = validateQuote(q(400), withCatalogRow(ctx));
    assert.equal(v.metadata.valuation_verdict, VALUATION_VERDICT.ANCHORED);
    assert.equal(v.action, 'accept');
    assert.equal(v.prices.mid, 400);
  });
});

describe('VV-2 the four required product witnesses', () => {
  const CASES = [
    ['NINJA',         NINJA,    readIdentity(),      RECOGNITION_VERDICT.IDENTIFIED, 400],
    ['LOGITECH',      LOGITECH, readIdentity(),      RECOGNITION_VERDICT.IDENTIFIED, 380],
    ['LG',            LG,       readIdentity(false), RECOGNITION_VERDICT.FAMILY,     1400],
    ['LOUIS VUITTON', LV,       readIdentity(),      RECOGNITION_VERDICT.IDENTIFIED, 520],
  ];

  test('VV-2a all four are RECOGNISED — the database is not a whitelist', () => {
    for (const [name, rec, id, expected] of CASES) {
      assert.equal(resolveRecognitionVerdict(scan({ recognition: rec, identity: id })), expected,
        `${name}: recognition must not depend on GetWorth having seen it before`);
    }
  });

  test('VV-2b and all four are PENDING_MARKET without market evidence', () => {
    for (const [name, rec, id, , mid] of CASES) {
      const v = validateQuote(q(mid), scan({ recognition: rec, identity: id }));
      assert.equal(v.metadata.valuation_verdict, VALUATION_VERDICT.PENDING_MARKET, name);
      assert.deepEqual(v.prices, { low: 0, mid: 0, high: 0 }, `${name} shipped a number`);
    }
  });

  test('VV-2c LOGITECH prices when the evidence exists — the non-regression', () => {
    // §8: existing correctly-supported pricing behaviour must not regress when
    // sufficient evidence exists. This is that assertion.
    const v = validateQuote(q(380), withCatalogRow(scan({ recognition: LOGITECH, identity: readIdentity() })));
    assert.equal(v.action, 'accept');
    assert.equal(v.prices.mid, 380, 'mid is never moved');
    assert.equal(v.metadata.valuation_verdict, VALUATION_VERDICT.ANCHORED);
    assert.equal(v.metadata.envelope_key, 'electronics:gaming mouse',
      'and its envelope is unchanged — gaming mouse sits below its parent, so no gate applies');
  });

  test('VV-2d LG — recognition does NOT upgrade pricing authority', () => {
    // §8 in as many words. LG is recognised from text read off the item; that
    // buys BRAND_TEXT and nothing else. `electronics:monitor` is wider than its
    // parent and wants OBJECT_CLASS, so the envelope stays at the parent, and
    // the verdict stays PENDING regardless.
    const bare = scan({ recognition: LG, identity: readIdentity(false) });
    const v = validateQuote(q(1400), bare);
    assert.equal(v.metadata.envelope_key, 'electronics');
    assert.equal(v.metadata.valuation_verdict, VALUATION_VERDICT.PENDING_MARKET);

    // A classifier that saw a monitor buys the tighter-parent-exceeding bucket,
    // and STILL does not buy a price. Two separate authorities, separately held.
    const seen = scan({ recognition: LG, identity: readIdentity(false),
      visionData: { labels: [{ description: 'Computer monitor', score: 0.93 }] } });
    assert.equal(validateQuote(q(1400), seen).metadata.envelope_key, 'electronics:monitor');
    assert.equal(validateQuote(q(1400), seen).metadata.valuation_verdict, VALUATION_VERDICT.PENDING_MARKET,
      'OBJECT_CLASS is envelope evidence, never market evidence');
  });

  test('VV-2e LOUIS VUITTON — recognised, and §7 leaves the envelope alone', () => {
    const v = validateQuote(q(520), scan({ recognition: LV, identity: readIdentity() }));
    assert.equal(v.metadata.recognition_verdict, RECOGNITION_VERDICT.IDENTIFIED,
      'a correctly identified fragrance is a recognition SUCCESS');
    assert.equal(v.metadata.envelope_key, 'beauty');
    // §7: the beauty ceiling is a PRODUCT decision and this round does not move
    // it to make a fixture pass. Pinned by value so that widening it becomes a
    // deliberate act with a failing test attached.
    assert.equal(ENVELOPES.beauty.soft_max, 500);
    assert.equal(ENVELOPES.beauty.hard_max, 1600);
    assert.equal(ENVELOPES.bags.hard_max, 4800);
  });

  test('VV-2f the unknown generic object is MANUAL, not pending — the control', () => {
    // Without this, "everything refuses now" would satisfy every test above.
    // /api/enrich can research a named product; it can do nothing with a shape.
    const ctx = scan({ recognition: UNKNOWN_OBJECT, identity: { brandOk: false, modelOk: false } });
    assert.equal(resolveRecognitionVerdict(ctx), RECOGNITION_VERDICT.UNKNOWN);
    assert.equal(resolveValuationVerdict(ctx), VALUATION_VERDICT.MANUAL);
    const v = validateQuote(q(70), ctx);
    assert.equal(v.action, 'degrade');
    assert.match(v.metadata.degraded_reason, /V-IDENTITY-FLOOR/);
  });
});

describe('VV-3 the verdict lattice is total and not collapsed', () => {
  test('VV-3a every identity tier maps to a recognition verdict, and all four occur', () => {
    const seen = new Set();
    const cases = [
      [{ brandOk: true, modelOk: true, brandC: 0.9, modelC: 0.9 }, RECOGNITION_VERDICT.IDENTIFIED],
      [{ brandOk: true, modelOk: false, brandC: 0.9 }, RECOGNITION_VERDICT.FAMILY],
      [{ brandOk: false, modelOk: false }, RECOGNITION_VERDICT.CATEGORY],
      [null, RECOGNITION_VERDICT.UNKNOWN],
    ];
    for (const [identity, expected] of cases) {
      const got = resolveRecognitionVerdict({
        identity, recognition: { category: 'Electronics', category_confidence: 0.9 } });
      assert.equal(got, expected, JSON.stringify(identity));
      seen.add(got);
    }
    assert.equal(seen.size, 4, 'all four recognition verdicts must be reachable');
  });

  test('VV-3b all four valuation verdicts are reachable — none is decorative', () => {
    const rec = { category: 'Electronics', category_confidence: 0.9 };
    const id = { brandOk: true, modelOk: true, brandC: 0.9, modelC: 0.9 };
    const got = new Set([
      resolveValuationVerdict({ stage: 'stage2', identity: id, recognition: rec, anchor: { id: 'x' } }),
      resolveValuationVerdict({ stage: 'stage2', identity: id, recognition: rec }),
      resolveValuationVerdict({ stage: 'stage2', identity: { brandOk: false, modelOk: false },
        recognition: { category: 'Electronics', category_confidence: 0.55 } }),
      resolveValuationVerdict({ stage: 'pre', pre_source: 'none', identity: id, recognition: rec }),
    ]);
    assert.deepEqual([...got].sort(), ['ANCHORED', 'BOUNDED', 'MANUAL', 'PENDING_MARKET']);
  });

  test('VV-3c THE COUNTERINTUITIVE DIRECTION, asserted', () => {
    // The same item, the same number, the same envelope. The ONLY difference is
    // how well it was recognised — and the better-recognised one refuses.
    const weak = { category: 'Electronics', category_confidence: 0.55,
      brand_candidates: [], model_candidates: [], ocr_text: { raw_texts: [] } };
    const strong = { ...weak,
      brand_candidates: [{ brand: 'Logitech', confidence: 0.9 }],
      model_candidates: [{ model: 'G502', confidence: 0.9 }],
      ocr_text: { raw_texts: ['Logitech G502'] } };

    const a = validateQuote(q(200), scan({ recognition: weak, identity: { brandOk: false, modelOk: false } }));
    const b = validateQuote(q(200), scan({ recognition: strong, identity: readIdentity() }));

    assert.equal(a.metadata.valuation_verdict, VALUATION_VERDICT.BOUNDED);
    assert.equal(a.action, 'accept', 'a category-level estimate LABELLED as one is honest');
    assert.equal(b.metadata.valuation_verdict, VALUATION_VERDICT.PENDING_MARKET);
    assert.equal(b.action, 'pending', 'a product-level claim needs product-level evidence');
  });

  test('VV-3d a category disagreement is MANUAL, never pending', () => {
    // Pending promises /api/enrich can resolve it. If the two stages cannot
    // agree what the object IS, market research has no subject.
    const v = resolveValuationVerdict({
      stage: 'stage2', identity: { brandOk: true, modelOk: true, brandC: 0.9, modelC: 0.9 },
      recognition: { category: 'Books', category_confidence: 0.9 }, category_disagreement: true });
    assert.equal(v, VALUATION_VERDICT.MANUAL);
  });

  test('VV-3e a REFUSAL never carries a number, over every verdict', () => {
    // The V-SOURCE-UNREGISTERED class, generalised: a grade nothing enforces is
    // a caption. Any action that is not accept/repair must be 0/0/0 and flagged.
    const contexts = [
      scan({ recognition: NINJA, identity: readIdentity() }),
      scan({ recognition: UNKNOWN_OBJECT, identity: { brandOk: false, modelOk: false } }),
      { stage: 'pre', pre_source: 'none', identity: readIdentity(), recognition: NINJA },
      { stage: 'weird', identity: readIdentity(), recognition: NINJA },
    ];
    for (const c of contexts) {
      const v = validateQuote(q(400), c);
      if (v.action === 'accept' || v.action === 'repair') continue;
      assert.deepEqual(v.prices, { low: 0, mid: 0, high: 0 }, `${v.action} shipped a number`);
      assert.equal(v.metadata.degraded, true, `${v.action} must be flagged for old callers`);
      assert.equal(v.metadata.pricing_grade, 'MANUAL_REQUIRED');
      // FOUND BY MUTATION, then CORRECTED once it went red. The verdicts are
      // computed on `base` before the numeric rules run, so a quote that later
      // failed an envelope check still reported BOUNDED beside its own refusal.
      // Prices, degraded and grade all stayed green through that, because a
      // refusal that CLAIMS to be bounded still zeroes its prices.
      //
      // The first version of this assertion demanded MANUAL for EVERY refusal,
      // and `pending` immediately failed it — correctly. PENDING_MARKET is the
      // one refusal that is allowed to say something about the future, because
      // /api/enrich can act on it. The two refusals mean different things and
      // the assertion has to keep them apart, not flatten them.
      const expected = v.action === 'pending'
        ? VALUATION_VERDICT.PENDING_MARKET
        : VALUATION_VERDICT.MANUAL;
      assert.equal(v.metadata.valuation_verdict, expected,
        `${v.action} reported ${v.metadata.valuation_verdict}`);
      assert.notEqual(v.metadata.valuation_verdict, VALUATION_VERDICT.BOUNDED,
        'no refusal may claim the envelope bounded a number it did not ship');
      assert.notEqual(v.metadata.valuation_verdict, VALUATION_VERDICT.ANCHORED);
    }
  });

  test('VV-3f `pending` is degraded=true, so callers written before it refuse the number', () => {
    // A new state that old code silently treats as priced would be worse than
    // the defect it replaces. Every existing consumer reads `action === accept`
    // or `degraded`; both answers must point the same way.
    const v = validateQuote(q(400), scan({ recognition: NINJA, identity: readIdentity() }));
    assert.equal(v.metadata.degraded, true);
    assert.notEqual(v.action, 'accept');
    assert.notEqual(v.action, 'repair');
    assert.equal(v.metadata.pricing_status, 'manual_required');
  });
});

describe('VV-4 a broken quote is broken whatever evidence stands behind it', () => {
  // ORDERING, and it is load-bearing. Placed before the numeric rules,
  // V-MARKET-EVIDENCE short-circuited a malformed quote into `pending` — telling
  // the caller "market research will resolve this" about a quote that violates
  // V-ORDER. It is the SOFTER of the two refusals, and a scan must always fail
  // to the harder one.
  const ctx = scan({ recognition: NINJA, identity: readIdentity() });

  test('VV-4a structural violations still DEGRADE, and name their own rule', () => {
    const cases = [
      [{ low: 2000, mid: 1200, high: 3000, currency: 'ILS' }, /V-ORDER/],
      [{ low: 100, mid: 'not-a-number', high: 900, currency: 'ILS' }, /V-FINITE/],
      [{ low: 10, mid: 99000, high: 120000, currency: 'ILS' }, /V-ENVELOPE/],
      [{ low: 100, mid: 200, high: 400, currency: 'USD' }, /V-CURRENCY/],
    ];
    for (const [quote, rule] of cases) {
      const v = validateQuote(quote, ctx);
      assert.equal(v.action, 'degrade', `${JSON.stringify(quote)} must degrade, not pend`);
      assert.match(v.metadata.degraded_reason, rule);
    }
  });

  test('VV-4b and a WELL-FORMED quote on the same context pends', () => {
    // The control for VV-4a: without it, "everything degrades" would pass.
    assert.equal(validateQuote(q(400), ctx).action, 'pending');
  });
});
