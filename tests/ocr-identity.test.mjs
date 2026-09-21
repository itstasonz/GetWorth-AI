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
// R5-C1. Vision fixtures are built by the PARSER, from text as printed on the
// item, so a test can no longer describe a shape production cannot emit.
import { visionData } from './helpers/vision-fixture.mjs';
const { parseVisionResponse } = await import('../api/analyze.js');
const vd = (block, opts) => visionData(parseVisionResponse, block, opts);
import { resolveEnvelope, validateQuote, ENVELOPES,
  bucketEntryRequirement, bucketEntryPermitted } from '../api/_lib/valuation-guard.js';
import { deriveEvidence } from '../api/_lib/pricing-authority.js';
import { isSpecificTokenMatch, gradeRowEvidence } from '../api/analyze.js';

const CONFIRMED = { brandOk: true, modelOk: true, brandC: 0.9, modelC: 0.9, brandConfLabel: 'confirmed_by_text' };
// §3. `resolveEnvelope` now reads an evidence set, and a caller that passes none
// gets DERIVED only — the fail-closed default. These fixtures must therefore
// COMPOSE the two modules exactly as api/analyze.js does, or they would be
// measuring the default rather than the recognition in front of them.
const env = (recognition, identity = CONFIRMED, visionData = null, anchor = null) =>
  resolveEnvelope({ recognition, identity, anchor,
    evidence: deriveEvidence({ recognition, visionData, anchor }).classes });
/** A classifier that saw `what`. The only producer of OBJECT_CLASS. */
const sawA = (what) => ({ labels: [{ description: what, score: 0.93 }] });

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
// THE ENVELOPE HALF OF HIGH-4 IS CLOSED  ·  §3 BUCKET AUTHORITY
//
// WHAT THESE TESTS USED TO SAY. OI-3 asserted `watches:luxury` for a sticker and
// called it "the gap, stated". OI-6 enumerated three exposed buckets and called
// the list "the deliverable". OI-8 pinned a ₪12,000 laptop as ACCEPT and existed
// to stop anyone re-deriving the withdrawn rule. All three were honest records of
// an open finding, and all three pinned the defect in place.
//
// Two earlier attempts failed because they asked the model how sure it was, in
// different words: the first read the `evidence` string a candidate writes about
// itself and inverted under relabelling; the second baselined on the canonical
// category and degraded the legitimate laptop. The rule that replaced them asks
// a different question entirely — WHO PRODUCED THIS EVIDENCE — and lets each
// bucket declare what it costs to enter, because entering `electronics:laptop`
// wrongly costs a ₪24,000 ceiling and entering `watches:luxury` wrongly costs
// ₪250,000. One global threshold would have to be set for the worse case.
//
// These tests now measure the closure from both sides. Every case states the
// evidence it supplies and the bucket that evidence buys, and the negative half
// — the same recognition with the evidence removed — is asserted beside it. A
// gate tested only from the permitted side is not a gate.
// ════════════════════════════════════════════════════════════════════════════════
describe('the Rolex witness: what bounds it now, measured not assumed', () => {
  // H-5. The sticker fixture carries its text in `ocr_text.raw_texts`, which is
  // STAGE-1 MODEL OUTPUT. That no longer corroborates the model's own candidate,
  // so these cases now supply what production supplies when it matters: an
  // INDEPENDENT reader. `sawText` is Google Vision reading the same object.
  // R5-C1. WAS `({ text: lines })` — one phrase per entry, a shape
  // parseVisionResponse cannot emit. Its `text` array is per-WORD and the line
  // structure lives in ocr_context.full_text, which this fixture had no notion
  // of. The tests passed against data production never produces.
  //
  // Built by the parser itself now, from the text as PRINTED on the item.
  // ROUND 6: the fixture now carries the classifier label a real photograph of a
  // watch carries. `watches:luxury` requires OBJECT_CLASS as well as the two
  // text classes — a recognition reviewer showed that without it the
  // compatibility-marker vocabulary was this bucket's ONLY layer, so every gap
  // in that vocabulary was a ₪250,000 gap. A fixture with text and no classifier
  // output describes a photograph Vision never looked at.
  const sawText = (...lines) =>
    visionData(parseVisionResponse, lines.join('\n'), { labels: ['Watch', 'Analog watch'] });

  test('OI-3a self-written text alone does NOT reach watches:luxury', () => {
    // The strongest single improvement in this round for this witness. The
    // sticker fixture's `raw_texts` is the same model call that produced the
    // "Rolex"/"Submariner" candidates, so it is the model saying it twice.
    // ₪250,000 was reachable on that alone.
    assert.equal(env(ROLEX_STICKER).key, 'watches');
    assert.equal(env(ROLEX_STICKER).hard_max, ENVELOPES.watches.hard_max);
  });

  test('OI-3 an INDEPENDENTLY READ sticker reaches watches:luxury — and that is the DESIGN', () => {
    // Worth being blunt about, because it looks like the rule failing. The brand
    // AND the product name were genuinely read off the object ('ROLEX
    // SUBMARINER' is in raw_texts), so BRAND_TEXT and PRODUCT_TEXT both hold,
    // which is exactly what the bucket declares. Printing a brand on a thing IS
    // the evidence class; pretending otherwise would refuse every real Rolex too.
    //
    // What the bucket does NOT accept is a model simply WRITING the brand down.
    // That is the next test, and it is the half that used to be missing.
    const e = env(ROLEX_STICKER, CONFIRMED, sawText('ROLEX', 'SUBMARINER'));
    assert.equal(e.key, 'watches:luxury');
    assert.equal(e.hard_max, 250000);
  });

  test('OI-3b THE CLOSURE: the same watch with nothing READ falls back to the parent', () => {
    // Identical recognition, identical candidate strings, identical confidences
    // — only the OCR is empty, so the names are ASSERTED rather than read. Under
    // the old rule this was indistinguishable from the case above and selected
    // the same ₪250,000 ceiling.
    const asserted = { ...ROLEX_STICKER, ocr_text: { raw_texts: [] } };
    const e = env(asserted);
    assert.equal(e.key, 'watches', 'a written brand must not open the luxury bucket');
    assert.equal(e.hard_max, ENVELOPES.watches.hard_max);
    assert.ok(e.hard_max < ENVELOPES['watches:luxury'].hard_max,
      'the fallback must be the PARENT, never the wider bucket and never GLOBAL');

    // And one class is not two: the bucket declares BRAND_TEXT *and*
    // PRODUCT_TEXT, so reading only the brand is not enough.
    const brandOnly = { ...ROLEX_STICKER, model_candidates: [], ocr_text: { raw_texts: [] } };
    assert.equal(env(brandOnly, CONFIRMED, sawText('ROLEX')).key, 'watches',
      'BRAND_TEXT alone must not enter a bucket that declares two classes');
  });

  test('OI-4 requiresAnchorAboveSoft still applies ON TOP, unchanged', () => {
    // §3 gates ENTRY to the bucket. This flag bounds what you may be quoted once
    // inside it. They are different questions and both still have to be answered
    // — closing the first is not an excuse to relax the second.
    const e = env(ROLEX_STICKER, CONFIRMED, sawText('ROLEX', 'SUBMARINER'));
    assert.equal(e.requiresAnchorAboveSoft, true);
    assert.equal(ENVELOPES['watches:luxury'].requiresAnchorAboveSoft, true,
      'the flag lives on the table row — a bucket added without it inherits nothing');
  });

  test('OI-5 so a sticker-only Rolex is refused above soft, and priced below it', () => {
    const vq = (quote, rec, visionData = sawText('ROLEX', 'SUBMARINER')) => validateQuote(quote,
      { stage: 'pre', pre_source: 'catalog', anchorModelEvidence: true, anchor: null, model: 'm',
        recognition: rec, identity: CONFIRMED,
        evidence: deriveEvidence({ recognition: rec, visionData }).classes });

    const hi = vq({ low: 90000, mid: 120000, high: 160000, currency: 'ILS' }, ROLEX_STICKER);
    assert.equal(hi.action, 'degrade', 'above soft_max with no catalog anchor');
    assert.match(hi.metadata.degraded_reason, /V-ENVELOPE-SOFT/);

    const lo = vq({ low: 8000, mid: 12000, high: 18000, currency: 'ILS' }, ROLEX_STICKER);
    assert.notEqual(lo.action, 'degrade',
      'below soft_max a text-confirmed watch is priced — ₪40,000 is the real bound');

    // The same ₪12,000 with the names merely asserted is now out of range
    // entirely, because the envelope is `watches` (hard 6,400) rather than
    // `watches:luxury`. Two refusals for two different reasons, both correct.
    const asserted = { ...ROLEX_STICKER, ocr_text: { raw_texts: [] } };
    const lo2 = vq({ low: 8000, mid: 12000, high: 18000, currency: 'ILS' }, asserted, null);
    assert.equal(lo2.action, 'degrade');
    assert.match(lo2.metadata.degraded_reason, /V-ENVELOPE-HARD/);
  });

  test('OI-6 EVERY bucket above its parent is declared, or it is unreachable', () => {
    // WAS: a hand-written list of three "exposed" buckets, which was wrong —
    // twelve buckets exceed their parent, and the record said four. Counting
    // them by hand is what produced that error, so nothing is counted here.
    //
    // The property is structural and holds over the whole table: a bucket wider
    // than its parent either declares its entry evidence or CANNOT BE ENTERED AT
    // ALL. That is what makes a bucket added tomorrow fail closed instead of
    // silently inheriting permission, which is what the previous round claimed
    // and did not have.
    const wider = Object.entries(ENVELOPES)
      .filter(([k]) => k.includes(':'))
      .filter(([k, e]) => ENVELOPES[k.split(':')[0]] && e.hard_max > ENVELOPES[k.split(':')[0]].hard_max);
    assert.ok(wider.length >= 10,
      `only ${wider.length} buckets exceed their parent — if this collapsed, the test proves nothing`);
    for (const [k] of wider) {
      const req = bucketEntryRequirement(k);
      assert.ok(req.length > 0, `${k} exceeds its parent and must declare entry evidence`);
      assert.equal(bucketEntryPermitted(k, new Set(['DERIVED'])), false,
        `${k} exceeds its parent and must not be enterable on DERIVED alone`);
    }
    // The mirror half: a bucket at or below its parent needs nothing, because
    // entering it cannot buy a bigger number than the caller already had.
    for (const [k, e] of Object.entries(ENVELOPES)) {
      if (!k.includes(':')) continue;
      const up = ENVELOPES[k.split(':')[0]];
      if (!up || e.hard_max > up.hard_max) continue;
      assert.equal(bucketEntryPermitted(k, new Set(['DERIVED'])), true,
        `${k} is no wider than its parent and must not have acquired a requirement`);
    }
  });

  test('OI-6b an UNDECLARED wide bucket is unreachable, not permitted', () => {
    // The fail-closed default, exercised directly rather than inferred from the
    // table as it happens to stand today. `electronics:headphones` sits BELOW its
    // parent, so it is undeclared and open; the check below is that the
    // requirement function keys off the ceiling relationship and not off a
    // hard-coded list.
    assert.deepEqual(bucketEntryRequirement('electronics:headphones'), [],
      'a bucket within its parent needs no declaration');
    assert.equal(bucketEntryPermitted('electronics:laptop', new Set(['DERIVED', 'BRAND_TEXT', 'PRODUCT_TEXT'])), false,
      'text classes do not substitute for the OBJECT_CLASS a laptop bucket declares');
    assert.equal(bucketEntryPermitted('electronics:laptop', new Set(['DERIVED', 'OBJECT_CLASS'])), true);
    assert.equal(bucketEntryPermitted('electronics:laptop', new Set(['DERIVED', 'ANCHOR'])), true,
      'a GetWorth catalog row outranks any reading of the photograph');
  });

  test('OI-7 the priceable cases keep, or correctly lose, their envelopes', () => {
    // Logitech: `electronics:gaming mouse` sits BELOW the electronics parent, so
    // nothing is required and nothing changed. This is the non-regression half —
    // a gate that moved a bucket it had no business moving would show up here.
    assert.equal(env(LOGITECH).key, 'electronics:gaming mouse');
    assert.equal(env(LOGITECH).requiresAnchorAboveSoft, false);

    // Louis Vuitton: `beauty` is a top-level bucket, ungated. §7 — the envelope
    // is NOT widened in this round, and this test does not ask it to be.
    assert.equal(env(LV).key, 'beauty');
    assert.equal(env(LV).hard_max, ENVELOPES.beauty.hard_max);

    // LG: `electronics:monitor` is WIDER than electronics (12,000 vs 6,400), so
    // it declares OBJECT_CLASS. The fixture has a written `subcategory: 'monitor'`
    // and no classifier, so it correctly falls back to the parent. This is the
    // change §8 asks for in as many words: recognition succeeding does not
    // upgrade pricing authority.
    assert.equal(env(LG).key, 'electronics',
      'a written subcategory does not open a bucket wider than its parent');
    // Give it a classifier that actually saw a monitor and the bucket opens.
    assert.equal(env(LG, CONFIRMED, sawA('Computer monitor')).key, 'electronics:monitor');
  });

  test('OI-8 the ₪12,000 laptop — the case that withdrew the rule, both directions', () => {
    // The withdrawn second version degraded this, and that is why it was
    // withdrawn: V-ENVELOPE-SOFT-01 says in terms that a ₪12,000 laptop is real
    // and must be FLAGGED, not refused. The rule that replaced it does not have
    // to choose, because it asks who produced the evidence rather than how
    // confident anyone was.
    const laptop = { category: 'Electronics', subcategory: 'Laptop', product_type: '', category_confidence: 0.9,
      brand_candidates: [], model_candidates: [], ocr_text: { raw_texts: [] }, visual_features: { condition: 'Good' } };
    const vq = (visionData) => validateQuote({ low: 10000, mid: 12000, high: 14000, currency: 'ILS' },
      { stage: 'pre', pre_source: 'catalog', anchorModelEvidence: true, anchor: null, model: 'm',
        recognition: laptop, identity: { brandOk: true, modelOk: true, brandC: 0.9, modelC: 0.8 },
        evidence: deriveEvidence({ recognition: laptop, visionData }).classes });

    // A classifier saw a laptop: priced and flagged, exactly as before.
    const seen = vq(sawA('Laptop'));
    assert.equal(seen.action, 'accept', 'a ₪12,000 laptop a classifier SAW is real — flag it, do not refuse it');
    assert.equal(seen.metadata.needs_review, true);
    assert.equal(seen.metadata.envelope_key, 'electronics:laptop');

    // Nobody saw anything; the word "Laptop" was written by a stage. The
    // envelope is electronics and ₪12,000 is out of range. This is the
    // subcategory-only widening attack, and it is the reason the bucket is gated.
    const unseen = vq(null);
    assert.equal(unseen.action, 'degrade');
    assert.equal(unseen.metadata.envelope_key, 'electronics');
    assert.match(unseen.metadata.degraded_reason, /V-ENVELOPE-HARD/);
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
