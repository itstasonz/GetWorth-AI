// ══════════════════════════════════════════════════════════════════════════════
// HIGH-4 — OCR IS EVIDENCE, NOT TRUTH
//
// THE PRINCIPLE
//   OCR may CORROBORATE or NARROW identity.
//   OCR alone must not silently BROADEN an unsupported identity into a
//   priceable exact product.
//
// THE OCR PRODUCERS, and where each one lands. This list is the audit the
// finding asked for; every row has at least one test below.
//
//   PRODUCER                         REACHES                        BOUND BY
//   Stage-1 ocr_text.raw_texts       envelope selection             narrow-only
//   Stage-1 ocr_text.logos_detected  prompt evidence only           (not a trust input)
//   Stage-1 brand_candidates[]       envelope, identity tier        identity floor only (envelope: OPEN)
//   Stage-1 model_candidates[]       envelope, identity tier        identity floor only (envelope: OPEN)
//   Google Vision text               the Stage-2 identity upgrade   phrase + corroboration
//   Google Vision logos              the Stage-2 identity upgrade   score >= VISION_TRIGGER
//   serial OCR (ocrSerialLabel)      serial display                 not an identity input
//   retrieval evidence tokens        catalog row grading            isSpecificTokenMatch
//
// WHAT THIS FILE CLOSES, AND WHAT IT DOES NOT.
// CLOSED: the "duo" class — a plain word read off an unbranded item no longer
// grades a catalog row as exact evidence — and the cross-brand collision, whose
// bound at the anchor gate is now asserted rather than assumed.
// OPEN: the ENVELOPE half. `resolveEnvelopeKey` resolves twice and keeps the
// lower ceiling, so photographed text may narrow and never widen — except that
// `brand_candidates`, `model_candidates`, `subcategory` and `product_type` are
// ALL Stage 1 describing the photograph, and every pass reads them. A sticker
// reading ROLEX still selects watches:luxury. A derived rule to close it was
// written, defeated twice, and withdrawn; see the block above the Rolex tests.
//
//   node --test tests/ocr-identity.test.mjs
// ══════════════════════════════════════════════════════════════════════════════
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resolveEnvelope, validateQuote, ENVELOPES } from '../api/_lib/valuation-guard.js';
import { isSpecificTokenMatch, gradeRowEvidence } from '../api/analyze.js';

const CONFIRMED = { brandOk: true, modelOk: true, brandC: 0.9, modelC: 0.9, brandConfLabel: 'confirmed_by_text' };
const env = (recognition, identity = CONFIRMED) => resolveEnvelope({ recognition, identity });

// ── The four physical cases, as recognition objects ─────────────────────────
const LOGITECH = {
  category: 'Electronics', subcategory: 'gaming mouse', product_type: 'mouse', category_confidence: 0.95,
  brand_candidates: [{ brand: 'Logitech', confidence: 0.95, evidence: 'readable_text' }],
  model_candidates: [{ model: 'G Pro X Superlight', confidence: 0.9, evidence: 'ocr' }],
  ocr_text: { raw_texts: ['Logitech G PRO X SUPERLIGHT'] },
};
const LG = {
  category: 'Electronics', subcategory: 'monitor', product_type: 'monitor', category_confidence: 0.92,
  brand_candidates: [{ brand: 'LG', confidence: 0.9, evidence: 'readable_text' }],
  model_candidates: [],
  ocr_text: { raw_texts: ['LG'] },
};
const LV = {
  category: 'Beauty', subcategory: 'fragrance', product_type: 'perfume', category_confidence: 0.93,
  brand_candidates: [{ brand: 'Louis Vuitton', confidence: 0.95, evidence: 'readable_text' }],
  model_candidates: [{ model: 'Imagination', confidence: 0.9, evidence: 'ocr' }],
  ocr_text: { raw_texts: ['LOUIS VUITTON', 'IMAGINATION'] },
};
// The witness from the review: an unremarkable watch with ROLEX read off it.
const ROLEX_STICKER = {
  category: 'Watches', subcategory: 'watch', product_type: 'watch', category_confidence: 0.8,
  brand_candidates: [{ brand: 'Rolex', confidence: 0.9, evidence: 'readable_text' }],
  model_candidates: [{ model: 'Submariner', confidence: 0.8, evidence: 'ocr' }],
  ocr_text: { raw_texts: ['ROLEX SUBMARINER'] },
};

// ════════════════════════════════════════════════════════════════════════════════
// THE ENVELOPE HALF OF HIGH-4 IS OPEN, AND THESE TESTS SAY SO
//
// A derived escalation rule was written here and WITHDRAWN. An independent
// reviewer defeated it twice, and the second version, which closed both
// defeats, degraded a ₪12,000 laptop — an item V-ENVELOPE-SOFT-01 says in terms
// is real and must be FLAGGED, not refused.
//
// The reason no third version follows is in api/_lib/valuation-guard.js beside
// the withdrawal: specific buckets are looser than their category parents by
// design, four of them sit above their parent's hard ceiling, and `subcategory`
// is BOTH the legitimate route to a specific bucket AND derived from the image.
// A laptop legitimately exceeds what "Electronics" allows; a watch with ROLEX
// printed on it claims to. No field in the recognition separates them, so any
// threshold that does is a number chosen to make the laptop pass.
//
// These tests therefore pin THE BOUND THAT ACTUALLY EXISTS, so that nobody
// reads the section heading and assumes more. If one of them starts failing,
// the envelope behaviour has moved and the gap needs re-measuring.
// ════════════════════════════════════════════════════════════════════════════════
describe('the Rolex witness: what bounds it today, measured not assumed', () => {
  test('OI-3 a sticker DOES still reach watches:luxury — the gap, stated', () => {
    const e = env(ROLEX_STICKER);
    assert.equal(e.key, 'watches:luxury');
    assert.equal(e.hard_max, 250000,
      'OCR-derived candidates still select this bucket. That is the open finding, unclosed.');
  });

  test('OI-4 the bound is requiresAnchorAboveSoft on the BUCKET, set by hand', () => {
    // This is what the review meant by "bounded by requiresAnchorAboveSoft",
    // and it is why the witness is HIGH and not CRITICAL. It is a per-bucket
    // decision in the ENVELOPES table, not a rule derived from the scan.
    const e = env(ROLEX_STICKER);
    assert.equal(e.requiresAnchorAboveSoft, true);
    assert.equal(ENVELOPES['watches:luxury'].requiresAnchorAboveSoft, true,
      'the flag lives on the table row — a bucket added without it inherits nothing');
  });

  test('OI-5 so a sticker-only Rolex is refused above soft, and priced below it', () => {
    // The actual money consequence, both directions, so the bound is a measured
    // number rather than a claim.
    const hi = validateQuote({ low: 90000, mid: 120000, high: 160000, currency: 'ILS' },
      { stage: 'stage2', pre_source: null, anchor: null, model: 'm', recognition: ROLEX_STICKER, identity: CONFIRMED });
    assert.equal(hi.action, 'degrade', 'above soft_max with no catalog anchor');
    assert.match(hi.metadata.degraded_reason, /V-ENVELOPE-SOFT/);

    const lo = validateQuote({ low: 8000, mid: 12000, high: 18000, currency: 'ILS' },
      { stage: 'stage2', pre_source: null, anchor: null, model: 'm', recognition: ROLEX_STICKER, identity: CONFIRMED });
    assert.notEqual(lo.action, 'degrade',
      'below soft_max a text-confirmed watch is priced — ₪40,000 is the real bound, not ₪250,000');
  });

  test('OI-6 THE BUCKETS WITH NO SUCH FLAG, enumerated — this is the gap', () => {
    // Four specific buckets sit above their category parent's hard ceiling.
    // Exactly one of them carries the anchor requirement. The other three are
    // the unclosed surface, and listing them is the deliverable: the fix is to
    // decide each one against the real market, which is a pricing change.
    const parentHard = ENVELOPES.electronics.hard_max;
    const exposed = Object.entries(ENVELOPES)
      .filter(([k, e]) => k.startsWith('electronics:') && e.soft_max > parentHard)
      .filter(([, e]) => !e.requiresAnchorAboveSoft)
      .map(([k, e]) => `${k} soft=${e.soft_max} hard=${e.hard_max}`);
    assert.deepEqual(exposed.sort(), [
      'electronics:iphone soft=7500 hard=24000',
      'electronics:laptop soft=7500 hard=24000',
      'electronics:macbook soft=12500 hard=40000',
    ], 'if this list changes, the open finding has changed shape and must be re-reported');
  });

  test('OI-7 NON-REGRESSION: the three priceable cases keep their envelopes', () => {
    for (const [name, rec, key] of [
      ['Logitech', LOGITECH, 'electronics:gaming mouse'],
      ['LG', LG, 'electronics:monitor'],
      ['Louis Vuitton', LV, 'beauty'],
    ]) {
      const e = env(rec);
      assert.equal(e.key, key, `${name} must keep its envelope`);
      assert.equal(e.requiresAnchorAboveSoft, false,
        `${name} must not acquire an anchor requirement it did not have`);
    }
  });

  test('OI-8 the ₪12,000 laptop — the case that withdrew the rule', () => {
    // Kept as a live test rather than a comment, because it is the reason the
    // rule is not here. If a future change makes this degrade, that change has
    // made the same mistake.
    const laptop = { category: 'Electronics', subcategory: 'Laptop', product_type: '', category_confidence: 0.9,
      brand_candidates: [], model_candidates: [], ocr_text: { raw_texts: [] }, visual_features: { condition: 'Good' } };
    const v = validateQuote({ low: 10000, mid: 12000, high: 14000, currency: 'ILS' },
      { stage: 'stage2', pre_source: null, anchor: null, model: 'm', recognition: laptop,
        identity: { brandOk: true, modelOk: true, brandC: 0.9, modelC: 0.8 } });
    assert.equal(v.action, 'accept', 'a ₪12,000 laptop is real — flag it, do not refuse it');
    assert.equal(v.metadata.needs_review, true);
  });
});

// ── THE HISTORICAL CLASS THE FINDING NAMED ──────────────────────────────────
describe('a plain word read off an unbranded item is not exact evidence', () => {
  const SODASTREAM_DUO = { brand: 'SodaStream', model: 'Duo', name: 'SodaStream Duo Sparkling Water Maker', category: 'Home', aliases: ['duo'], keywords: [] };
  const PHILIPS_DUO = { brand: 'Philips', model: 'Duo', name: 'Philips Duo Coffee Maker', category: 'Home', aliases: [], keywords: [] };
  const LOGITECH_G502 = { brand: 'Logitech', model: 'G502', name: 'Logitech G502 HERO', category: 'Electronics', aliases: [], keywords: [] };

  test('OI-9 THE DUO WITNESS — OCR "duo" with no brand grades nothing', () => {
    assert.equal(gradeRowEvidence(SODASTREAM_DUO, ['duo'], ['duo'], null), false,
      'OCR "duo" on an unbranded machine used to make SodaStream Duo EXACT evidence');
    assert.equal(gradeRowEvidence(PHILIPS_DUO, ['duo'], ['duo'], null), false,
      'and it graded every OTHER row called Duo just as well, which is the point');
    assert.equal(isSpecificTokenMatch(SODASTREAM_DUO, 'duo', null), false);
  });

  test('OI-10 the same word WITH a recognised brand is still evidence', () => {
    // Narrowing, not refusing. "Duo" in SodaStream's own catalog when the item
    // WAS recognised as a SodaStream is real signal, and stays real.
    assert.equal(gradeRowEvidence(SODASTREAM_DUO, ['duo'], ['duo'], 'sodastream'), true);
    assert.equal(isSpecificTokenMatch(SODASTREAM_DUO, 'duo', 'sodastream'), true);
    // And a brand CONTRADICTION still refuses it.
    assert.equal(gradeRowEvidence(SODASTREAM_DUO, ['duo'], ['duo'], 'philips'), false);
  });

  test('OI-11 a model-shaped token still identifies without any brand', () => {
    // The distinction that makes this narrow: a manufacturer part number
    // carries its own specificity. Removing that would break the case where
    // Stage 1 reads a label correctly and names the wrong brand.
    assert.equal(isSpecificTokenMatch(LOGITECH_G502, 'g502', null), true);
    assert.equal(isSpecificTokenMatch(LOGITECH_G502, 'g502', 'razer'), true,
      'a part number outranks a wrong brand guess — C-03 in the baseline suite');
    assert.equal(gradeRowEvidence(LOGITECH_G502, ['g502'], ['g502'], null), true);
  });

  test('OI-12 ATTACK a model belonging to ANOTHER brand cannot reach the PRICE', async () => {
    // The attack the finding named: OCR reads a competitor's model number, and
    // the row it grades belongs to a different manufacturer.
    //
    // THE TOKEN TEST DOES NOT REFUSE IT, AND THAT IS DELIBERATE — C-03 in the
    // recognition baseline. Production shows Stage 1 reading a label correctly
    // while naming the wrong brand, so a model-shaped token is allowed to
    // outrank a brand GUESS. Reversing that would trade this attack for a
    // larger class of real misidentifications.
    const BOSE_QC45 = { brand: 'Bose', model: 'QC45', name: 'Bose QuietComfort 45', category: 'Electronics', aliases: [], keywords: [] };
    assert.equal(gradeRowEvidence(BOSE_QC45, ['qc45'], ['qc45'], 'sony'), true,
      'grading is deliberately permissive here — the bound is downstream, and it is asserted next');

    // THE BOUND, ASSERTED RATHER THAN ASSUMED. Grading a row as evidence is not
    // the same as pricing from it. The anchor gate requires the brand head to
    // match, so a Bose row cannot set the envelope or the price of an item
    // identified as a Sony — which is where "exact identity" would have become
    // money.
    const { isCompatibleAnchor } = await import('../api/analyze.js');
    const verdict = isCompatibleAnchor(
      { ...BOSE_QC45, avg_used_price_ils: 900, retail_price_ils: 1400 },
      { brandOk: true, brandHead: 'sony', modelOk: true, modelC: 0.9, brand: 'Sony', model: 'QC45' },
      { category: 'Electronics', subcategory: 'headphones' });
    assert.equal(verdict.ok, false, 'a cross-brand row must never anchor a price');
    assert.equal(verdict.reason, 'brand_mismatch');

    // With NO brand recognised there is nothing to contradict, so the row does
    // grade. That path's bound is the envelope escalation above, not this test.
    assert.equal(gradeRowEvidence(BOSE_QC45, ['qc45'], ['qc45'], null), true);
  });
});
