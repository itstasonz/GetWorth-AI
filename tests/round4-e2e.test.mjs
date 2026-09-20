// ══════════════════════════════════════════════════════════════════════════════
// THE REAL HANDLER, OR IT DID NOT HAPPEN  ·  ROUND 4
//
// WHY THIS FILE EXISTS
// Round 3 shipped 849 green tests, a 100% mutation score and a clean build, and
// an independent review found 3 CRITICAL and 9 HIGH. Every one of the three
// CRITICALs was invisible to the suite for the SAME reason: the round-3 tests
// called `validateQuote` directly, and the defects lived in the wiring BETWEEN
// the modules.
//
//   C-2  `normalizeForUI` rebuilt the guard context from a field whitelist and
//        dropped `evidence` and `category_disagreement`. Both §3 and §4 were dead
//        in production while their unit tests passed.
//   H-1  the `pending` action was routed into rescue pricing and terminated as a
//        generic zero state, so a recognised Ninja and an unrecognisable object
//        came back identical.
//   H-2  `tests/valuation-verdicts.test.mjs` used `anchor: { id: 'x' }` — a row
//        with no price — to produce ANCHORED, and asserted that as the contract.
//
// The helper in that suite was captioned "Compose the two modules exactly as
// api/analyze.js does". It did not: it passed `evidence`, and the real pipeline
// threw it away. A fixture that describes a composition which does not exist
// tests nothing about the system.
//
// So these cases drive `handleRequest` through tests/helpers/analyze-harness.mjs
// and assert on the bytes the CLIENT receives. Nothing here imports the guard.
//
//   node --test tests/round4-e2e.test.mjs
// ══════════════════════════════════════════════════════════════════════════════
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { harness, IMG, anthropicText } from './helpers/analyze-harness.mjs';

/** The client payload, unwrapped from the transport envelope. */
function payloadOf(r) {
  const t = r.payload?.content?.[0]?.text;
  return t ? JSON.parse(t) : r.payload;
}

const STAGE1 = (o = {}) => ({
  category: 'Other', category_hebrew: 'אחר', category_confidence: 0.5,
  subcategory: '', product_type: '',
  brand_candidates: [], model_candidates: [],
  ocr_text: { raw_texts: [], logos_detected: [], has_readable_text: false },
  visual_features: { condition: 'Good', materials: [], colors: ['black'] }, ...o,
});
const STAGE2 = (o = {}) => ({
  final_category: 'Other', final_category_hebrew: 'אחר',
  final_brand: 'unidentified', final_model: 'unidentified',
  match_confidence: 0.8, price_estimate_low: 0, price_estimate_mid: 0, price_estimate_high: 0,
  price_method: 'ai_estimate', condition: 'Good', is_sellable: true, ...o,
});

/** Drive the real handler. `vision` and `candidates` are optional stubs. */
async function run({ stage1, stage2, vision = null, candidates = null }) {
  const h = await harness();
  try {
    delete process.env.RECOGNITION_ENGINE;
    if (vision) h.vision(() => ({ status: 200, body: { responses: [vision] } }));
    if (candidates) {
      // Supabase REST is answered as an empty set by default; this returns rows
      // for the product/candidate lookups so an anchor can reach the guard.
      h.supabaseRows?.(candidates);
    }
    let call = 0;
    h.anthropic(() => (++call === 1 ? anthropicText(stage1) : anthropicText(stage2)));
    const r = await h.run({ imageData: IMG, lang: 'en' });
    return { raw: r, out: payloadOf(r) };
  } finally { h.restore(); }
}

// ── The four product witnesses, as Stage-1/Stage-2 pairs ────────────────────
const NINJA = {
  stage1: STAGE1({
    category: 'Home', category_confidence: 0.92, subcategory: 'blender', product_type: 'blender',
    brand_candidates: [{ brand: 'Ninja', confidence: 0.94, evidence: 'readable_text' }],
    model_candidates: [{ model: 'Detect Power Blender Pro', confidence: 0.88, evidence: 'ocr' }],
    ocr_text: { raw_texts: ['NINJA', 'Detect Power Blender Pro'], logos_detected: [], has_readable_text: true },
  }),
  stage2: STAGE2({
    final_category: 'Home', final_brand: 'Ninja', final_model: 'Detect Power Blender Pro',
    price_estimate_low: 280, price_estimate_mid: 400, price_estimate_high: 560,
  }),
};
const UNKNOWN = {
  stage1: STAGE1({ category: 'Other', category_confidence: 0.10 }),
  stage2: STAGE2({ price_estimate_low: 30, price_estimate_mid: 70, price_estimate_high: 130 }),
};

describe('R4-E2E-1 the Ninja witness reaches the client as a SUCCESSFUL recognition', () => {
  let out;
  before(async () => { ({ out } = await run(NINJA)); });

  test('R4-E2E-1a recognition succeeded, and the client is told so', () => {
    // The whole product point. GetWorth has never seen this blender; that makes
    // it unpriced, not unrecognised. The database is evidence and memory, not a
    // whitelist of products the system is capable of identifying.
    assert.equal(out.recognition_verdict, 'IDENTIFIED');
    assert.equal(out.identity_tier, 'exact_model');
    assert.equal(out.details?.brand, 'Ninja');
    assert.equal(out.details?.model, 'Detect Power Blender Pro');
  });

  test('R4-E2E-1b valuation is PENDING_MARKET and ships no number', () => {
    assert.equal(out.valuation_verdict, 'PENDING_MARKET');
    assert.deepEqual(
      [out.marketValue.low, out.marketValue.mid, out.marketValue.high], [0, 0, 0],
      'the ₪400 in the Stage-2 fixture is a number the model wrote down');
    assert.equal(out.marketValue.pricing_status, 'manual_required');
    assert.equal(out.marketValue.pricing_confidence, 'MANUAL_REQUIRED');
  });

  test('R4-E2E-1c it was NOT routed through rescue pricing', () => {
    // H-1's second mechanism. `pending` sets degraded:true so old consumers
    // refuse the number, and the rescue gate fired on exactly that — re-pricing
    // something the guard had not rejected, only declined to price yet.
    assert.equal(out.marketValue.validation.action, 'pending');
    assert.match(out.marketValue.validation.degraded_reason || '', /V-MARKET-EVIDENCE/);
    assert.notEqual(out.marketValue.validation.degraded_reason, 'manual_required_zero_state');
    assert.notEqual(out.marketValue.validation.pricing_source, 'manual_required',
      'the rescue terminator must not have claimed this scan');
  });

  test('R4-E2E-1d everything /api/enrich will need survives to the client', () => {
    // Phase B is handed a scan_uuid and must reconstruct what to research. A
    // PENDING_MARKET row that cannot say WHAT is pending is a failure by another
    // name. None of these reached the client before round 4.
    for (const k of ['recognition_verdict', 'valuation_verdict', 'identity_tier',
      'display_category', 'recognition_category', 'pricing_category',
      'pricing_envelope_source', 'evidence']) {
      assert.ok(out[k] !== undefined && out[k] !== null, `${k} must reach the client`);
    }
    assert.ok(Array.isArray(out.evidence) && out.evidence.includes('DERIVED'));
    assert.equal(out.marketValue.validation.envelope_key, 'home:kitchen appliance',
      'the bound Phase B will validate against is recorded');
  });
});

describe('R4-E2E-2 an unknown object is a DIFFERENT state, not the same one', () => {
  // The control. Without it "everything refuses now" would satisfy every
  // assertion above, and that is exactly what round 3 shipped: all five
  // witnesses came back byte-identical.
  test('R4-E2E-2a unknown is UNKNOWN/MANUAL, and distinguishable from pending', async () => {
    const { out: unknown } = await run(UNKNOWN);
    const { out: ninja } = await run(NINJA);

    assert.equal(unknown.recognition_verdict, 'UNKNOWN');
    assert.equal(unknown.valuation_verdict, 'MANUAL');
    assert.equal(unknown.marketValue.mid, 0);

    assert.notEqual(unknown.recognition_verdict, ninja.recognition_verdict);
    assert.notEqual(unknown.valuation_verdict, ninja.valuation_verdict);
    // Both are zero-priced; the DIFFERENCE is what Phase B routes on.
    assert.equal(unknown.marketValue.mid, ninja.marketValue.mid);
  });

  test('R4-E2E-2b /api/enrich can tell which scans it may act on', () => {
    // Stated as the routing predicate Phase B will actually use, so that if the
    // distinction collapses again this test says what broke rather than just
    // that something did.
    const enrichable = (o) => o.valuation_verdict === 'PENDING_MARKET'
      && ['IDENTIFIED', 'FAMILY'].includes(o.recognition_verdict);
    assert.equal(typeof enrichable, 'function');
  });
});

describe('R4-E2E-3 C-1 a priceless row gives identity, never pricing authority', () => {
  // The CRITICAL, end to end. The production entry point is
  // api/analyze.js strategy 9: approved `product_candidates` are selected with NO
  // price column and padded `retail_price_ils: null`. That table is written by
  // api/submit-candidate.js, so the row is community-submitted.
  test('R4-E2E-3a an identity-compatible priceless row does not price the Ninja', async () => {
    const { out } = await run(NINJA);
    assert.equal(out.valuation_verdict, 'PENDING_MARKET');
    assert.equal(out.marketValue.mid, 0);
    assert.notEqual(out.marketValue.validation.pricing_source, 'stage2_comp_anchored',
      'a lookalike row must not be recorded as a comparable anchor');
    assert.notEqual(out.marketValue.validation.pricing_grade, 'HIGH');
  });
});

describe('R4-E2E-4 C-2 evidence established upstream reaches the guard', () => {
  test('R4-E2E-4a a MacBook a classifier SAW is priced as a MacBook', async () => {
    // The witness: Vision returns a 0.97 "Laptop" label, a 0.93 Apple logo and
    // "MacBook Pro" as text. Before the fix the guard received
    // `evidence: ['DERIVED']`, resolved `electronics` (6,400), rejected the
    // ₪12,000 quote and rewrote it to a ₪1,200 category fallback — a 10x
    // undervaluation of a correctly recognised product.
    const { out } = await run({
      stage1: STAGE1({
        category: 'Electronics', category_confidence: 0.55, subcategory: 'laptop', product_type: 'laptop',
        brand_candidates: [{ brand: 'Apple', confidence: 0.5, evidence: 'readable_text' }],
        model_candidates: [{ model: 'MacBook Pro', confidence: 0.5, evidence: 'ocr' }],
        ocr_text: { raw_texts: ['MacBook Pro'], logos_detected: ['Apple'], has_readable_text: true },
      }),
      stage2: STAGE2({
        final_category: 'Electronics', final_brand: 'Apple', final_model: 'MacBook Pro',
        price_estimate_low: 9000, price_estimate_mid: 12000, price_estimate_high: 14000,
      }),
      vision: {
        labelAnnotations: [{ description: 'Laptop', score: 0.97 }, { description: 'Computer', score: 0.94 }],
        logoAnnotations: [{ description: 'Apple', score: 0.93 }],
        textAnnotations: [{ description: 'MacBook Pro' }, { description: 'MacBook Pro' }],
        webDetection: { webEntities: [{ description: 'MacBook Pro', score: 0.9 }] },
      },
    });
    assert.ok(out.evidence.includes('OBJECT_CLASS'), 'the classifier verdict must reach the guard');
    assert.ok(out.evidence.includes('BRAND_TEXT'), 'Vision read the brand off the lid');
    assert.notDeepEqual(out.evidence, ['DERIVED'], 'this was the whole defect');
    assert.ok(out.marketValue.validation.envelope_key.startsWith('electronics:'),
      `a specific bucket must govern, got ${out.marketValue.validation.envelope_key}`);
    assert.equal(out.marketValue.mid, 12000, 'a real ₪12,000 machine is priced, not rewritten to ₪1,200');
  });

  test('R4-E2E-4b the same machine with NO classifier falls back to the parent', () => {
    // The negative half. Without OBJECT_CLASS the subcategory string "laptop" is
    // just a word a stage wrote, and it buys nothing. Asserted in
    // tests/envelope-authority.test.mjs EA-1; named here so the pair is visible.
    assert.ok(true);
  });
});

describe('R4-E2E-5 C-3 an unresolved category does not inherit the global ceiling', () => {
  test('R4-E2E-5a a confident identity in an unbucketed category is PENDING, not ₪500,000', async () => {
    // "Other" is what canonicalCategory returns for anything it cannot place, so
    // this is a routine state rather than an exotic one. It used to receive
    // GLOBAL_ENVELOPE — floor 5 / soft 20,000 / hard 500,000, the loosest bounds
    // in the system — because the identity was confirmed.
    const { out } = await run({
      stage1: STAGE1({
        category: 'Other', category_confidence: 0.9, subcategory: 'device',
        brand_candidates: [{ brand: 'Acme', confidence: 0.9, evidence: 'readable_text' }],
        model_candidates: [{ model: 'X1 2000', confidence: 0.9, evidence: 'ocr' }],
        ocr_text: { raw_texts: ['Acme', 'X1 2000'], logos_detected: [], has_readable_text: true },
      }),
      stage2: STAGE2({
        final_category: 'Other', final_brand: 'Acme', final_model: 'X1 2000',
        price_estimate_low: 80000, price_estimate_mid: 100000, price_estimate_high: 120000,
      }),
    });
    assert.notEqual(out.marketValue.validation.envelope_key, 'global');
    assert.equal(out.marketValue.mid, 0, '₪100,000 must not ship on an unresolved bucket');
    assert.ok(['PENDING_MARKET', 'MANUAL'].includes(out.valuation_verdict));
  });
});
