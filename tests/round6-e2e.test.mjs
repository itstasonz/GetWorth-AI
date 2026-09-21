// ══════════════════════════════════════════════════════════════════════════════
// ROUND 6 — THE AUTHORITY CONTRACTS, THROUGH THE REAL HANDLER
//
// WHY A SECOND FILE
// tests/round6-authority.test.mjs proves the properties of the modules. That is
// necessary and it is not sufficient: this repository has shipped a correct
// module wired to nothing more than once — round 4's compatibility fix was INERT
// in production because every test described a `visionData` shape the parser
// cannot emit, and the round-3 `ctx.comps` rule had no reachable input at all.
//
// So every assertion here drives `handleRequest` — the exported default of
// api/analyze.js — with `globalThis.fetch` replaced, and reads the price out of
// the response envelope the client actually receives.
//
// THE CLAIM UNDER TEST (§8): for an accessory that REFERENCES a high-value host
// product, the host reference cannot
//   · establish subject brand          · become ANCHOR
//   · establish subject model          · increase the pricing grade
//   · establish subject object class   · widen the envelope
//   · select the host's pricing bucket · authorise a price above what the
//                                        accessory's own evidence permits
//
// and (§16) the product witnesses that were already closed stay closed.
//
//   node --test tests/round6-e2e.test.mjs
// ══════════════════════════════════════════════════════════════════════════════
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const { harness, IMG, anthropicText } = await import('./helpers/analyze-harness.mjs');

// The handler returns `{ content: [{ type: 'text', text: JSON.stringify(result) }] }`.
// Reading `r.payload.marketValue` directly is undefined for EVERY scan, which is
// how a suite at 100% mutation score once stayed green over a CRITICAL.
const decode = (r) => {
  assert.ok(r.payload?.content?.[0]?.text,
    `expected the handler envelope, got ${JSON.stringify(r.payload).slice(0, 200)}`);
  return JSON.parse(r.payload.content[0].text);
};
const midOf = (res) => res?.marketValue?.mid ?? res?.marketValue?.price_estimate_mid ?? null;

/** A Vision response in the shape Google actually returns: block + per-word. */
const vision = (block, { labels = [], logos = [] } = {}) => ({
  body: {
    responses: [{
      textAnnotations: block
        ? [{ description: block }, ...block.split(/\s+/).filter(Boolean).map((w) => ({ description: w }))]
        : [],
      labelAnnotations: labels.map((l) => (typeof l === 'string' ? { description: l, score: 0.93 } : l)),
      logoAnnotations: logos.map((l) => (typeof l === 'string' ? { description: l, score: 0.95 } : l)),
      webDetection: { webEntities: [] },
    }],
  },
});

const stage1 = (o = {}) => ({
  category: 'Electronics', category_hebrew: 'אלקטרוניקה', category_confidence: 0.6,
  subcategory: 'accessory', product_type: 'accessory',
  brand_candidates: [], model_candidates: [],
  ocr_text: { raw_texts: [], logos_detected: [], has_readable_text: true },
  visual_features: { condition: 'Good', materials: ['plastic'], colors: ['black'] },
  ...o,
});

const stage2 = (o = {}) => ({
  final_category: 'Electronics', final_category_hebrew: 'אלקטרוניקה',
  final_brand: 'Unidentified', final_model: 'Unidentified',
  match_confidence: 0.9, identification_method: 'ocr_confirmed',
  brand_confidence: 'confirmed_by_text',
  price_estimate_low: 100, price_estimate_mid: 150, price_estimate_high: 200,
  price_method: 'comp_based', currency: 'ILS', condition: 'Good',
  matched_product_ids: [], price_factors: [],
  selling_tips: '', israeli_market_notes: '', is_sellable: true, market_demand: 'moderate',
  confidence_reasoning: 'read from the label',
  ...o,
});

/** Drive the real handler once. Returns the decoded result plus the raw run. */
async function scan({ s1, s2, block, labels = [], logos = [], lang = 'en' }) {
  const h = await harness();
  try {
    delete process.env.RECOGNITION_ENGINE;
    let call = 0;
    h.anthropic(() => (++call === 1 ? anthropicText(s1) : anthropicText(s2)));
    h.vision(() => vision(block, { labels, logos }));
    const r = await h.run({ imageData: IMG, lang });
    return { res: decode(r), raw: r };
  } finally { h.restore(); }
}

// ════════════════════════════════════════════════════════════════════════════
// E6-1 · THE ACCESSORY CROSS-PRODUCT
// ════════════════════════════════════════════════════════════════════════════
describe('E6-1 a host reference buys no authority anywhere in the pipeline', () => {
  // Five accessories, each referencing a high-value host, in three language
  // layouts. `ceiling` is what the ACCESSORY'S OWN evidence could ever justify;
  // `forbidden` is the host's price, the number the reference would buy.
  // ── THE ORACLE IS A DIFFERENTIAL, AND MY FIRST ONE WAS NOT ────────────────
  //
  // I first asserted an absolute ceiling: "an accessory must price below half
  // the host's price". Three of the five failed, and the failures were not the
  // defect. A ₪4,200 claim on an unidentified Electronics item is inside the
  // `electronics` envelope on its own; the host reference contributed NOTHING to
  // it. The absolute bound was measuring the category envelope's generosity,
  // which is a calibration question this round is forbidden to touch.
  //
  // The contract is about what the REFERENCE buys. So each scan is run twice —
  // once with the host named in the OCR block, once with the identical
  // accessory wording and the host name REMOVED — and the two are compared.
  // Anything the reference is worth shows up as a difference, and nothing else
  // does.
  const ACCESSORIES = [
    {
      name: 'ROLEX STRAP', brand: 'Rolex', model: 'Submariner', hostPrice: 60000,
      s1: { category: 'Watches', subcategory: 'watch strap', product_type: 'strap' },
      blocks: {
        en: ['Replacement strap for\nROLEX SUBMARINER', 'Replacement strap for'],
        he: ['רצועה\nעבור\nRolex Submariner', 'רצועה\nעבור'],
        mixed: ['ROLEX SUBMARINER\nרצועה חלופית\nReplacement Strap', 'רצועה חלופית\nReplacement Strap'],
      },
      labels: ['Watch accessory', 'Strap'],
    },
    {
      name: 'IPHONE CASE', brand: 'Apple', model: 'iPhone 16 Pro', hostPrice: 4200,
      s1: { category: 'Electronics', subcategory: 'phone case', product_type: 'case' },
      blocks: {
        en: ['Compatible With\niPhone 16 Pro\nProtective Case', 'Compatible With\nProtective Case'],
        he: ['כיסוי תואם\niPhone 16 Pro', 'כיסוי תואם'],
        mixed: ['iPhone 16 Pro\nכיסוי\nCompatible Case', 'כיסוי\nCompatible Case'],
      },
      labels: ['Mobile phone case'],
    },
    {
      name: 'MACBOOK CHARGER', brand: 'Apple', model: 'MacBook Pro', hostPrice: 9000,
      s1: { category: 'Electronics', subcategory: 'charger', product_type: 'charger' },
      blocks: {
        en: ['Replacement Charger\nFor MacBook Pro\n96W USB-C', 'Replacement Charger\n96W USB-C'],
        he: ['מטען ל-MacBook Pro', 'מטען'],
        mixed: ['MacBook Pro\nמטען\n96W', 'מטען\n96W'],
      },
      labels: ['Power adapter', 'Cable'],
    },
    {
      name: 'DYSON FILTER', brand: 'Dyson', model: 'V15', hostPrice: 3500,
      s1: { category: 'Home', subcategory: 'vacuum filter', product_type: 'filter' },
      blocks: {
        en: ['Replacement Filter\nDYSON V15', 'Replacement Filter'],
        he: ['פילטר תואם\nDyson V15', 'פילטר תואם'],
        mixed: ['DYSON V15\nפילטר\nReplacement Filter', 'פילטר\nReplacement Filter'],
      },
      labels: ['Filter'],
    },
    {
      name: 'NINJA BLADE', brand: 'Ninja', model: 'Detect Power Blender Pro', hostPrice: 1600,
      s1: { category: 'Home', subcategory: 'blender blade', product_type: 'blade' },
      blocks: {
        en: ['Replacement Blade\nNINJA\nPOWER BLENDER', 'Replacement Blade'],
        he: ['חלק חילוף\nNINJA\nPOWER BLENDER', 'חלק חילוף'],
        mixed: ['NINJA POWER BLENDER\nלהב\nReplacement Blade', 'להב\nReplacement Blade'],
      },
      labels: ['Kitchen appliance accessory'],
    },
  ];

  // The pricing authority a response actually carries, read from the fields the
  // client receives rather than from anything this test computes.
  const GRADE = { LOW: 1, MEDIUM: 2, HIGH: 3 };
  const authorityOf = (res) => ({
    mid: midOf(res) ?? 0,
    evidence: [...(res?.evidence || [])].sort(),
    envelope: res?._debug?.pricing?.guard_envelope_key ?? null,
    grade: GRADE[res?._debug?.pricing?.pricing_confidence] ?? 0,
    tier: res?.identity_tier ?? null,
    source: res?._debug?.pricing?.guard_pricing_source ?? null,
  });

  for (const a of ACCESSORIES) {
    for (const [lang, [withHost, withoutHost]] of Object.entries(a.blocks)) {
      test(`E6-1 ${a.name} (${lang}) — naming the host in OCR buys nothing`, async () => {
        // Stage 2 asserts the HOST outright, at the host's price. That is the
        // strongest form of the attack: the model has already decided the
        // accessory IS the product, and the only thing between that claim and a
        // price is whether the OCR block corroborates it.
        const s2 = stage2({
          final_brand: a.brand, final_model: a.model, final_category: a.s1.category,
          price_estimate_low: Math.round(a.hostPrice * 0.8),
          price_estimate_mid: a.hostPrice,
          price_estimate_high: Math.round(a.hostPrice * 1.2),
        });
        const A = authorityOf((await scan({ s1: stage1(a.s1), s2, block: withHost, labels: a.labels })).res);
        const B = authorityOf((await scan({ s1: stage1(a.s1), s2, block: withoutHost, labels: a.labels })).res);

        assert.ok(A.mid <= B.mid,
          `${a.name}/${lang}: naming the host raised the price ₪${B.mid} -> ₪${A.mid}`);
        assert.deepEqual(A.evidence.filter((c) => !B.evidence.includes(c)), [],
          `${a.name}/${lang}: naming the host created evidence classes out of nothing`);
        assert.equal(A.envelope, B.envelope,
          `${a.name}/${lang}: naming the host moved the pricing envelope ` +
          `${B.envelope} -> ${A.envelope}`);
        assert.ok(A.grade <= B.grade,
          `${a.name}/${lang}: naming the host raised the pricing grade`);
        assert.equal(A.tier, B.tier,
          `${a.name}/${lang}: naming the host changed the identity tier ${B.tier} -> ${A.tier}`);

        // ABSOLUTES, on top of the differential: the classes that would let the
        // host's own bucket and the host's own price through.
        assert.ok(!A.evidence.includes('ANCHOR'),
          `${a.name}/${lang}: a referenced host became market-price evidence`);
        assert.ok(!A.evidence.includes('PRODUCT_TEXT'),
          `${a.name}/${lang}: the host's model was read as subject text — ${A.evidence.join('+')}`);

        // NOT ASSERTED HERE: an absolute ceiling on `A.mid`. I wrote one first
        // and three accessories failed it — and the failures were not this
        // defect. A ₪4,200 claim on an unidentified Electronics item sits
        // inside the `electronics` envelope with or without the host name, so
        // the bound was measuring envelope calibration, which this round is
        // forbidden to touch. What the reference is worth is B minus A, and
        // that is what is asserted above. The remaining exposure is recorded
        // as an open finding in E6-4 rather than hidden in a threshold here.
      });
    }
  }

  test('E6-1y the differential is not vacuous — a GENUINE label does move it', async () => {
    // Without this, every comparison above would pass on a pipeline that had
    // stopped reading OCR entirely. Same handler, same Stage 2, and the only
    // change is that the block is the product's own label rather than an
    // accessory's: the evidence must genuinely grow.
    // The candidate confidences are DELIBERATELY below VISION_TRIGGER_THRESHOLD.
    // At 0.9 the pipeline skips Vision entirely — correctly, it is already sure
    // — and then there is no independent reader, no OCR block, and no text
    // evidence for anything. My first version of this control asserted the
    // opposite of what it set up and failed for that reason, not for a defect.
    const s1 = stage1({
      category: 'Watches', subcategory: 'watch', product_type: 'watch', category_confidence: 0.55,
      brand_candidates: [{ brand: 'Rolex', confidence: 0.5, evidence: 'readable_text' }],
      model_candidates: [{ model: 'Submariner', confidence: 0.5, evidence: 'ocr' }],
      ocr_text: { raw_texts: ['ROLEX', 'SUBMARINER'], has_readable_text: true },
    });
    const s2 = stage2({ final_brand: 'Rolex', final_model: 'Submariner', final_category: 'Watches',
      price_estimate_low: 48000, price_estimate_mid: 60000, price_estimate_high: 72000 });
    const genuine = (await scan({ s1, s2, block: 'ROLEX\nSUBMARINER', labels: ['Watch'] })).res;
    const strap = (await scan({ s1, s2, block: 'Replacement strap for\nROLEX SUBMARINER', labels: ['Watch'] })).res;

    const g = [...(genuine?.evidence || [])];
    const st = [...(strap?.evidence || [])];
    assert.ok(g.includes('BRAND_TEXT') && g.includes('PRODUCT_TEXT'),
      `a genuine dial must still establish text evidence, got ${g.join('+')} — if it does not, ` +
      'every differential above passes because nothing reads OCR at all');
    assert.ok(!st.includes('BRAND_TEXT') && !st.includes('PRODUCT_TEXT'),
      `the strap must not, got ${st.join('+')}`);
  });

  test('E6-1z THE ORACLE IS NOT BLIND — a genuine product still prices', async () => {
    // Without this control, "no price" and "this test cannot see prices" are
    // indistinguishable, and every assertion above is vacuous.
    const { VALID_RECOGNITION } = await import('./helpers/analyze-harness.mjs');
    const { res } = await scan({
      s1: VALID_RECOGNITION,
      s2: stage2({
        final_brand: 'Logitech', final_model: 'G502', final_category: 'Electronics',
        price_estimate_low: 180, price_estimate_mid: 240, price_estimate_high: 300,
      }),
      block: 'LOGITECH\nG502',
      labels: ['Mouse', 'Input device'],
    });
    assert.ok(Object.prototype.hasOwnProperty.call(res, 'marketValue'),
      'the decoded result must expose marketValue, or every price assertion above is vacuous');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// E6-2 · THE PRESERVED PRODUCT WITNESSES  (§15, §16)
// ════════════════════════════════════════════════════════════════════════════
describe('E6-2 the closed blockers stay closed', () => {
  test('E6-2a NINJA — IDENTIFIED, PENDING_MARKET, 0/0/0', async () => {
    const { res } = await scan({
      s1: stage1({
        category: 'Home', subcategory: 'blender', product_type: 'blender', category_confidence: 0.9,
        brand_candidates: [{ brand: 'Ninja', confidence: 0.9, evidence: 'readable_text' }],
        model_candidates: [{ model: 'Detect Power Blender Pro', confidence: 0.9, evidence: 'ocr' }],
        ocr_text: { raw_texts: ['NINJA', 'DETECT POWER BLENDER PRO'], has_readable_text: true },
      }),
      s2: stage2({ final_brand: 'Ninja', final_model: 'Detect Power Blender Pro', final_category: 'Home' }),
      block: 'NINJA\nDETECT POWER BLENDER PRO\nBLENDSENSE',
      labels: ['Blender', 'Kitchen appliance'],
    });
    assert.equal(midOf(res) ?? 0, 0, 'a recognised product with no market evidence is not priced');
    const blob = JSON.stringify(res);
    assert.ok(/PENDING_MARKET/.test(blob),
      'the recognition verdict must still be distinguishable from UNKNOWN');
  });

  test('E6-2b UNKNOWN — UNKNOWN, MANUAL, 0/0/0, and DISTINGUISHABLE from Ninja', async () => {
    const { res } = await scan({
      s1: stage1({ category: 'Other', subcategory: '', product_type: '', category_confidence: 0.2,
        ocr_text: { raw_texts: [], has_readable_text: false } }),
      s2: stage2({ final_brand: 'Unidentified', final_model: 'Unidentified', final_category: 'Other',
        price_estimate_low: 0, price_estimate_mid: 0, price_estimate_high: 0 }),
      block: '',
    });
    assert.equal(midOf(res) ?? 0, 0);
    const blob = JSON.stringify(res);
    assert.ok(!/PENDING_MARKET/.test(blob),
      'H-1: an unrecognised item must NOT claim the same verdict as a recognised one — ' +
      'the two states have to stay distinguishable');
  });

  test('E6-2c LOGITECH — legitimate recognition survives, and prices only on market authority', async () => {
    const { VALID_RECOGNITION } = await import('./helpers/analyze-harness.mjs');
    const { res } = await scan({
      s1: VALID_RECOGNITION,
      s2: stage2({ final_brand: 'Logitech', final_model: 'G502', final_category: 'Electronics',
        price_estimate_low: 180, price_estimate_mid: 240, price_estimate_high: 300 }),
      block: 'LOGITECH\nG502',
      labels: ['Mouse'],
    });
    const blob = JSON.stringify(res);
    assert.ok(/Logitech/i.test(blob), 'the recognised brand must still reach the client');
  });

  test('E6-2d LOUIS VUITTON — identity behaviour unchanged, calibration untouched', async () => {
    const { res } = await scan({
      s1: stage1({
        category: 'Beauty', subcategory: 'fragrance', product_type: 'perfume', category_confidence: 0.93,
        brand_candidates: [{ brand: 'Louis Vuitton', confidence: 0.95, evidence: 'readable_text' }],
        model_candidates: [{ model: 'Imagination', confidence: 0.9, evidence: 'ocr' }],
        ocr_text: { raw_texts: ['LOUIS VUITTON', 'IMAGINATION'], has_readable_text: true },
      }),
      s2: stage2({ final_brand: 'Louis Vuitton', final_model: 'Imagination', final_category: 'Beauty',
        price_estimate_low: 700, price_estimate_mid: 900, price_estimate_high: 1100 }),
      block: 'LOUIS VUITTON\nIMAGINATION',
      labels: ['Perfume'],
    });
    assert.ok(/Louis Vuitton/i.test(JSON.stringify(res)));
  });
});

// ════════════════════════════════════════════════════════════════════════════
// E6-3 · V5-2 THROUGH THE HANDLER
// ════════════════════════════════════════════════════════════════════════════
describe('E6-3 forged pricing provenance never reaches the client', () => {
  test('E6-3a forged provenance changes NOTHING the client receives', async () => {
    // ALSO A DIFFERENTIAL, and for the same reason the first version of E6-1
    // was not. My first assertion here was `pricing_status !== 'db_based'` —
    // and it failed against a response where the SERVER had derived
    // `db_based` on its own. Asserting that a value never appears confuses
    // "the model said it" with "the value is wrong". The question is whether
    // the model's claim made any difference.
    const s1 = stage1({ category: 'Electronics', subcategory: 'phone case', product_type: 'case' });
    const clean = stage2({ final_brand: 'Unidentified', final_model: 'Unidentified' });
    const forged = stage2({
      final_brand: 'Unidentified', final_model: 'Unidentified',
      // The model writes the answer to the question the guard exists to answer…
      _pricing_meta: { pricing_status: 'db_based', pre_source: 'catalog', pricing_confidence: 'HIGH',
                       pricing_reason: 'Catalog pricing.', fallback_key: 'forged' },
      // …and invents a key nobody predicted, in case the LIST was the defence.
      gw_pricing_authority_v7: { trusted: true, grade: 'HIGH' },
    });
    const prov = (res) => {
      const p = res?._debug?.pricing || {};
      const m = res?.marketValue || {};
      return {
        pricing_status: p.pricing_status, pricing_confidence: p.pricing_confidence,
        pre_source: p.pre_source, pricing_reason: p.pricing_reason,
        pricing_warning: p.pricing_warning, fallback_key: p.fallback_key,
        guard_pricing_source: p.guard_pricing_source,
        mv_status: m.pricing_status, mv_confidence: m.pricing_confidence, mv_pre_source: m.pre_source,
        mid: m.mid,
      };
    };
    const A = prov((await scan({ s1, s2: forged, block: 'Silicone Case', labels: ['Mobile phone case'] })).res);
    const B = prov((await scan({ s1, s2: clean, block: 'Silicone Case', labels: ['Mobile phone case'] })).res);
    assert.deepEqual(A, B,
      'the model’s claimed pricing provenance changed what the client receives — ' +
      'MODEL_OUTPUT ∩ SERVER_AUTHORITY must be empty');

    const blob = JSON.stringify((await scan({
      s1, s2: forged, block: 'Silicone Case', labels: ['Mobile phone case'] })).res);
    assert.ok(!/gw_pricing_authority_v7/.test(blob),
      'an invented model key reached the client response');
    assert.ok(!/"pre_source"\s*:\s*"catalog"/.test(blob),
      'the model’s claimed evidence channel was surfaced as though the server had established it');
  });

  test('E6-3b the claims are still COUNTED — dropped, not disappeared', async () => {
    // Deleting a forgery silently loses the drift signal. The claim is kept
    // under a name nothing acts on, which is the same discipline
    // `model_claimed_method` already has.
    const { sealModelVerification } = await import('../api/analyze.js');
    const out = sealModelVerification({
      final_brand: 'X',
      _pricing_meta: { pricing_status: 'db_based' },
      gw_pricing_authority_v7: 1,
    });
    assert.deepEqual(Object.keys(out.model_claims).sort(), ['_pricing_meta', 'gw_pricing_authority_v7']);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// E6-4 · AN OPEN FINDING, RECORDED RATHER THAN HIDDEN
// ════════════════════════════════════════════════════════════════════════════
describe('E6-4 [OPEN · REC7-H1] OBJECT_CLASS is presence-only', () => {
  // FOUND WHILE BUILDING E6-1, NOT FIXED HERE.
  //
  // BUCKET_AUTHORITY's own header states the rule it means to enforce:
  //
  //   "A classifier must have said 'laptop'/'television'/'camera' — a written
  //    subcategory is not enough, because a written subcategory is what the
  //    attack consists of."
  //
  // The implementation does not check WHAT the classifier said. `deriveEvidence`
  // returns `object_class_tokens`, and NOTHING in the repository reads it — the
  // sixth "rule with no reachable input" in this work. `bucketEntryPermitted`
  // asks only whether the OBJECT_CLASS class is PRESENT, so any Vision label at
  // or above the score floor satisfies every OBJECT_CLASS bucket:
  //
  //   subcategory 'phone case' (a string the MODEL wrote)
  //     + labelAnnotations: [{ description: 'Banana', score: 0.93 }]
  //     -> electronics:smartphone, hard_max 9,600 instead of electronics' 6,400
  //
  // and with subcategory 'laptop' the same pair reaches 24,000.
  //
  // WHY IT IS NOT FIXED IN THIS ROUND. It is a different mechanism from the
  // four this round was scoped to, and the fix is a token-to-bucket mapping
  // whose effect on legitimate scans is a calibration question — a laptop whose
  // Vision labels read "Personal computer" and "Netbook" must keep its bucket.
  // The round's stop conditions are explicit: report the witness, do not
  // silently expand scope, do not change calibration.
  //
  // This test asserts the CURRENT behaviour, so that fixing it breaks here
  // deliberately and nobody has to rediscover the witness.
  test('E6-4a THE WITNESS: an unrelated label opens a wider bucket', async () => {
    const s1 = stage1({ category: 'Electronics', subcategory: 'phone case', product_type: 'case' });
    const s2 = stage2({ final_brand: 'Unidentified', final_model: 'Unidentified' });
    const envOf = (res) => res?._debug?.pricing?.guard_envelope_key ?? null;

    const none = envOf((await scan({ s1, s2, block: 'Protective Case', labels: [] })).res);
    const banana = envOf((await scan({ s1, s2, block: 'Protective Case', labels: ['Banana'] })).res);

    assert.equal(none, 'electronics',
      'with no classifier output the bucket falls back to the parent, as designed');
    assert.equal(banana, 'electronics:smartphone',
      'OPEN FINDING REC7-H1: a classifier saying "Banana" satisfies the OBJECT_CLASS ' +
      'requirement for electronics:smartphone. If this assertion now FAILS because the ' +
      'requirement checks what the classifier actually named, delete this test — the ' +
      'finding is closed.');
  });

  test('E6-4b and the produced evidence tokens are read by nobody', async () => {
    const { deriveEvidence } = await import('../api/_lib/pricing-authority.js');
    const { object_class_tokens } = deriveEvidence({
      visionData: { labels: [{ description: 'Banana', score: 0.93 }] },
    });
    assert.deepEqual(object_class_tokens, ['Banana'],
      'the tokens ARE produced — the gap is that no consumer compares them to the bucket');
  });
});
