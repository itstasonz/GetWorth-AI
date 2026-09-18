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
//   Stage-1 brand_candidates[]       envelope, identity tier        evidenceClass + escalation
//   Stage-1 model_candidates[]       envelope, identity tier        evidenceClass + escalation
//   Google Vision text               the Stage-2 identity upgrade   phrase + corroboration
//   Google Vision logos              the Stage-2 identity upgrade   score >= VISION_TRIGGER
//   serial OCR (ocrSerialLabel)      serial display                 not an identity input
//   retrieval evidence tokens        catalog row grading            isSpecificTokenMatch
//
// THE ONE THAT WAS OPEN. `resolveEnvelopeKey` resolves twice and keeps the
// lower ceiling, so photographed text may narrow an envelope and never widen
// it — except that `brand_candidates` and `model_candidates` ARE photographed
// text, distilled by Stage 1 into a different field name, and BOTH passes read
// them. A sticker reading ROLEX selected watches:luxury, hard_max 250,000, from
// a baseline of 6,400.
//
//   node --test tests/ocr-identity.test.mjs
// ══════════════════════════════════════════════════════════════════════════════
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveEnvelope, resolveEnvelopeKey, envelopeIsReadEscalated, evidenceClass, ENVELOPES,
} from '../api/_lib/valuation-guard.js';
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

describe('evidence classification fails closed', () => {
  test('OI-1 anything read off the item classifies as read, not as shape', () => {
    for (const e of ['readable_text', 'ocr', 'label_sticker', 'serial_number', 'printed_marking', 'engraved']) {
      assert.equal(evidenceClass(e), 'text', `${e} is characters read off the item`);
    }
    for (const e of ['logo', 'logo_visible', 'brand_emblem', 'wordmark']) assert.equal(evidenceClass(e), 'logo');
    for (const e of ['packaging_design', 'packaging_visual', 'retail_box']) assert.equal(evidenceClass(e), 'packaging');
    for (const e of ['shape_only', 'silhouette', 'form_factor', 'colour_match', 'material']) {
      assert.equal(evidenceClass(e), 'visual', `${e} does not rest on reading the item`);
    }
  });

  test('OI-2 an UNRECOGNISED evidence string cannot buy widening power', () => {
    // `evidence` is `{ type: 'string' }` in the schema — free-form model output.
    // A value nobody anticipated must not be treated as shape evidence just
    // because it is unfamiliar.
    const BOMB = JSON.parse('{"toString":1,"valueOf":2}');
    for (const e of ['', 'none', 'vibes', 'high_confidence', 'i_just_know', null, undefined, 42, [], {}, BOMB, true]) {
      assert.equal(evidenceClass(e), 'unknown');
    }
  });
});

describe('OCR-derived candidates cannot silently widen an envelope', () => {
  test('OI-3 THE ROLEX WITNESS — a sticker cannot buy an unbounded ceiling', () => {
    const e = env(ROLEX_STICKER);
    assert.equal(e.key, 'watches:luxury', 'the bucket is still selected — text may narrow identity');
    assert.equal(e.readEscalated, true,
      'the ONLY reason this is not the 6,400 watches bucket is a value read off the item');
    assert.equal(e.requiresAnchorAboveSoft, true,
      'so everything above soft_max needs a catalog anchor, not more photographed text');
  });

  test('OI-4 the escalation requirement follows from HOW, not from a table flag', () => {
    // watches:luxury already carried requiresAnchorAboveSoft, which is why the
    // review rated this HIGH rather than CRITICAL. The point of the fix is that
    // the bound is now derived from the provenance of the identity, so a bucket
    // added tomorrow WITHOUT the flag inherits it.
    assert.equal(ENVELOPES['electronics:iphone'].requiresAnchorAboveSoft, false,
      'this bucket carries no flag of its own — if it did, the test below would prove nothing');
    const iphone = {
      category: 'Electronics', subcategory: 'smartphone', category_confidence: 0.9,
      brand_candidates: [{ brand: 'Apple', confidence: 0.9, evidence: 'readable_text' }],
      model_candidates: [{ model: 'iPhone 15 Pro', confidence: 0.9, evidence: 'ocr' }],
      ocr_text: { raw_texts: ['iPhone'] },
    };
    const e = env(iphone);
    assert.equal(e.key, 'electronics:iphone');
    assert.equal(e.requiresAnchorAboveSoft, true,
      'an unflagged bucket reached only through read evidence still needs an anchor above soft');
  });

  test('OI-5 the escalation is ALLOWED — this is not a cap on legitimate value', () => {
    // The naive fix (resolve without read-derived candidates and keep that) caps
    // every iPhone at the generic electronics ceiling of 6,400. That is a
    // pricing regression dressed as a safety fix, and it is refused here.
    const iphone = {
      category: 'Electronics', subcategory: 'smartphone', category_confidence: 0.9,
      brand_candidates: [{ brand: 'Apple', confidence: 0.9, evidence: 'readable_text' }],
      model_candidates: [{ model: 'iPhone 15 Pro', confidence: 0.9, evidence: 'ocr' }],
      ocr_text: { raw_texts: ['iPhone'] },
    };
    assert.equal(env(iphone).hard_max, 24000, 'the iPhone envelope is still reachable');
    assert.ok(env(iphone).soft_max >= 7500, 'and the soft ceiling still covers the real market');
  });

  test('OI-6 NON-REGRESSION: the three priceable cases are not escalated at all', () => {
    // Their buckets come from category and subcategory — fields that describe
    // the SHAPE of the thing, not characters read off it. Nothing changes for
    // them, which is the test that keeps this fix from being a blunt instrument.
    for (const [name, rec, key] of [
      ['Logitech', LOGITECH, 'electronics:gaming mouse'],
      ['LG', LG, 'electronics:monitor'],
      ['Louis Vuitton', LV, 'beauty'],
    ]) {
      const e = env(rec);
      assert.equal(e.key, key, `${name} must keep its envelope`);
      assert.equal(e.readEscalated, false, `${name} is not read-escalated — its bucket comes from its shape`);
      assert.equal(e.requiresAnchorAboveSoft, false, `${name} must not acquire an anchor requirement`);
      assert.equal(envelopeIsReadEscalated(rec), false);
    }
  });

  test('OI-7 stripping the read evidence does not change the three cases', () => {
    // The property behind OI-6, stated directly: if the candidates were removed
    // entirely, these three resolve to the same bucket. That is what "not
    // read-escalated" means, and it is checked rather than asserted.
    for (const rec of [LOGITECH, LG, LV]) {
      const blind = { ...rec, brand_candidates: [], model_candidates: [], ocr_text: { raw_texts: [] } };
      assert.equal(resolveEnvelopeKey(blind), resolveEnvelopeKey(rec));
    }
    // And the contrast: the Rolex witness collapses to the generic bucket.
    const blindRolex = { ...ROLEX_STICKER, brand_candidates: [], model_candidates: [], ocr_text: { raw_texts: [] } };
    assert.equal(resolveEnvelopeKey(blindRolex), 'watches');
    assert.equal(ENVELOPES.watches.hard_max, 6400, 'the 6,400 baseline the review named');
  });

  test('OI-8 a SHAPE-evidenced candidate is not treated as read', () => {
    // The rule is about provenance, not about the field. A brand proposed from
    // the silhouette carries no photographed text, so it does not trigger the
    // anchor requirement — it is bounded by its own low confidence instead.
    const shaped = {
      ...ROLEX_STICKER,
      brand_candidates: [{ brand: 'Rolex', confidence: 0.4, evidence: 'shape_only' }],
      model_candidates: [{ model: 'Submariner', confidence: 0.3, evidence: 'silhouette' }],
      ocr_text: { raw_texts: [] },
    };
    assert.equal(envelopeIsReadEscalated(shaped), false);
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
