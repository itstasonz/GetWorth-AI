// ══════════════════════════════════════════════════════════════════════════════
// PRICING ENVELOPE AUTHORITY  ·  §3   +   CATEGORY AUTHORITY  ·  §4
//
// WHAT EXACT DEFECT WOULD MAKE EACH TEST HERE FAIL?
// That question is the admission criterion for every case below, because the two
// rules these tests cover were each written twice before and withdrawn twice,
// and both times the tests written alongside them passed.
//
//   §3 attempt 1 — gated on the candidate's own `evidence` string. A reviewer
//                  relabelled 'readable_text' to 'shape_only' on an otherwise
//                  identical scan and the rule INVERTED: wider permission to the
//                  weaker class. Its tests used realistic fixtures, in which the
//                  label always matched the evidence, so none of them could see it.
//   §3 attempt 2 — baselined on the canonical category. Closed both defeats and
//                  degraded a legitimate ₪12,000 laptop, which V-ENVELOPE-SOFT-01
//                  says in terms must be flagged, not refused.
//   §4 attempt 1 — took the envelope from Stage 2's category. A paperback
//                  relabelled Electronics moved from hard_max 480 to 6,400.
//                  CB-14 asserted the SOURCE TEXT of the offending line, so it
//                  could not see what the line did.
//   §4 attempt 2 — reverted to Stage 1 forever, which made a wrong Stage 1
//                  permanent while still displaying Stage 2's label.
//
// So every gate here is asserted from BOTH sides — the evidence that opens it and
// the same scan with that evidence removed — and the negative half is the point.
// A gate tested only from the permitted side is a gate nobody has tested.
//
//   node --test tests/envelope-authority.test.mjs
// ══════════════════════════════════════════════════════════════════════════════
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// VAL001_GUARD_PATH points this suite at a MUTATED COPY of the guard, exactly as
// tests/valuation-guard.test.mjs is pointed. Without the indirection the mutation
// harness would load the real module and every mutant here would survive -- a
// suite that cannot be aimed at broken code cannot testify that it detects any.
const GUARD_URL = process.env.VAL001_GUARD_PATH
  ? new URL(`file://${process.env.VAL001_GUARD_PATH}`)
  : new URL('../api/_lib/valuation-guard.js', import.meta.url);
const G = await import(GUARD_URL.href);
const {
  ENVELOPES, resolveEnvelope, resolveEnvelopeKey, resolveEnvelopeKeyUngated, bucketEntryRequirement, bucketEntryPermitted, validateQuote, resolveCategoryAuthority, ENVELOPE_SOURCE, resolveIdentityTier, IDENTITY_TIER,
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
  EVIDENCE, EVIDENCE_CLASSES, deriveEvidence, evidenceList, confidence, OBJECT_CLASS_SCORE_FLOOR, names, TOKEN_MODE,
} = A;

const ev = (...classes) => new Set(['DERIVED', ...classes]);
const sawA = (what, score = 0.93) => ({ labels: [{ description: what, score }] });

// ════════════════════════════════════════════════════════════════════════════
// §3  BUCKET ENTRY AUTHORITY
// ════════════════════════════════════════════════════════════════════════════
describe('EA-1 the witness: a written subcategory no longer buys a ceiling', () => {
  // The reproduction from the round-2 report, verbatim. Zero identity evidence:
  // no brand candidate, no model candidate, no OCR, no classifier. One free-form
  // string, and the ceiling moved from 6,400 to 24,000 — turning a ₪20,000 quote
  // from a refusal into an acceptance.
  const bare = (subcategory) => ({
    category: 'Electronics', category_confidence: 0.9, subcategory,
    brand_candidates: [], model_candidates: [], ocr_text: { raw_texts: [] },
  });
  const price = (rec, mid, evidence) => validateQuote(
    { low: Math.round(mid * 0.8), mid, high: Math.round(mid * 1.2), currency: 'ILS' },
    { stage: 'pre', pre_source: 'catalog', anchorModelEvidence: true, anchor: null,
      identity: { brandOk: false, modelOk: false }, recognition: rec, evidence });

  test('EA-1a DERIVED alone cannot reach any bucket wider than its parent', () => {
    for (const sub of ['laptop', 'notebook', 'tv', 'camera', 'monitor', 'drone', 'tablet', 'macbook']) {
      const rec = bare(sub);
      // The matchers still SELECT the specific bucket — the fix is not to stop
      // recognising the word, which would lose the tighter buckets too.
      assert.ok(String(resolveEnvelopeKeyUngated(rec)).startsWith('electronics:'),
        `${sub}: the matcher must still select the specific bucket`);
      // Authority is what refuses it.
      assert.equal(resolveEnvelopeKey(rec, ev()), 'electronics',
        `${sub}: a written subcategory must fall back to the PARENT`);
    }
  });

  test('EA-1b the money consequence, both directions', () => {
    assert.equal(price(bare('laptop'), 20000, ev()).action, 'degrade',
      '₪20,000 on a written "laptop" was ACCEPTED before this rule');
    assert.equal(price(bare('laptop'), 20000, ev(EVIDENCE.OBJECT_CLASS)).action, 'accept',
      'and a laptop a classifier actually saw must still be priceable');
    // The parent bound still applies to the ungated case, so the item is not
    // simply unbounded: ₪5,000 is inside electronics and prices either way.
    assert.equal(price(bare('laptop'), 5000, ev()).action, 'accept',
      'falling back to the parent is not falling back to a refusal');
  });

  test('EA-1c fallback goes to the PARENT, never forward and never to GLOBAL', () => {
    const k = resolveEnvelopeKey(bare('macbook'), ev());
    assert.equal(k, 'electronics');
    assert.ok(ENVELOPES[k].hard_max < ENVELOPES['electronics:macbook'].hard_max);
    assert.notEqual(k, null, 'null would mean MANUAL_ONLY/GLOBAL, which is the inversion this system already closed');
  });
});

describe('EA-2 each bucket declares what it costs to enter', () => {
  test('EA-2a the declared requirements are exactly what the buckets demand', () => {
    const cases = [
      ['electronics:laptop', [EVIDENCE.OBJECT_CLASS]],
      ['electronics:tv', [EVIDENCE.OBJECT_CLASS]],
      ['electronics:camera', [EVIDENCE.OBJECT_CLASS]],
      ['electronics:monitor', [EVIDENCE.OBJECT_CLASS]],
      ['electronics:drone', [EVIDENCE.OBJECT_CLASS]],
      ['electronics:gaming console', [EVIDENCE.OBJECT_CLASS]],
      ['electronics:iphone', [EVIDENCE.OBJECT_CLASS, EVIDENCE.BRAND_TEXT]],
      ['electronics:macbook', [EVIDENCE.OBJECT_CLASS, EVIDENCE.BRAND_TEXT]],
      ['electronics:ipad', [EVIDENCE.OBJECT_CLASS, EVIDENCE.BRAND_TEXT]],
      ['watches:luxury', [EVIDENCE.BRAND_TEXT, EVIDENCE.PRODUCT_TEXT]],
    ];
    for (const [key, req] of cases) {
      assert.deepEqual([...bucketEntryRequirement(key)].sort(), [...req].sort(), key);
      // Every declared class is genuinely required: dropping ANY ONE of them
      // must close the bucket. Without this an over-broad requirement list would
      // look identical to a correct one.
      for (const dropped of req) {
        const partial = new Set(['DERIVED', ...req.filter((c) => c !== dropped)]);
        assert.equal(bucketEntryPermitted(key, partial), false,
          `${key} opened without ${dropped} — the requirement is not really a conjunction`);
      }
      assert.equal(bucketEntryPermitted(key, new Set(['DERIVED', ...req])), true, key);
    }
  });

  test('EA-2b ANCHOR satisfies every bucket, and is the only class that does', () => {
    for (const key of Object.keys(ENVELOPES)) {
      assert.equal(bucketEntryPermitted(key, new Set(['DERIVED', EVIDENCE.ANCHOR])), true,
        `${key}: a compatible GetWorth catalog row outranks any reading of the photograph`);
    }
    // No other single class is universal.
    for (const c of [EVIDENCE.OBJECT_CLASS, EVIDENCE.BRAND_TEXT, EVIDENCE.PRODUCT_TEXT]) {
      const closed = Object.keys(ENVELOPES).filter((k) => !bucketEntryPermitted(k, new Set(['DERIVED', c])));
      assert.ok(closed.length > 0, `${c} must not be a universal key the way ANCHOR is`);
    }
  });

  test('EA-2c THE FAIL-CLOSED DEFAULT: an undeclared wide bucket is unreachable', () => {
    // This is the property the previous round CLAIMED and did not have. It is
    // structural, so a bucket added tomorrow is covered without anyone adding a
    // test for it — which is the only kind of coverage that survives.
    for (const [key, e] of Object.entries(ENVELOPES)) {
      if (!key.includes(':')) continue;
      const parent = ENVELOPES[key.split(':')[0]];
      if (!parent) continue;
      if (e.hard_max <= parent.hard_max) continue;
      assert.equal(bucketEntryPermitted(key, new Set(['DERIVED'])), false,
        `${key} exceeds its parent (${e.hard_max} > ${parent.hard_max}) and must not open on DERIVED`);
    }
  });

  test('EA-2d NEGATIVE CONTROL: a synthetic wide bucket with no declaration', () => {
    // A MUTATION RUN CAUGHT THIS TEST BEING VACUOUS. Replacing the UNSATISFIABLE
    // branch with `return []` left every suite green, because every bucket that
    // currently exceeds its parent IS declared in BUCKET_AUTHORITY — so the
    // fail-closed default had no reachable input, and the one rule whose whole
    // job is to catch a bucket somebody adds TOMORROW was verified by nothing.
    //
    // So the table is synthetic. `electronics:teleporter` is wider than its
    // parent and declared nowhere; it must be unreachable rather than open.
    const table = {
      ...ENVELOPES,
      'electronics:teleporter': { key: 'electronics:teleporter', class: 'derived',
        floor: 10, soft_max: 50000, hard_max: 200000, requiresAnchorAboveSoft: false },
    };
    assert.ok(table['electronics:teleporter'].hard_max > table.electronics.hard_max,
      'the synthetic bucket must actually be wider, or it proves nothing');
    assert.equal(bucketEntryRequirement('electronics:teleporter', table).length, 1,
      'an undeclared wide bucket returns the unsatisfiable sentinel');
    for (const set of [
      new Set(['DERIVED']),
      new Set(['DERIVED', 'OBJECT_CLASS']),
      new Set(['DERIVED', 'OBJECT_CLASS', 'BRAND_TEXT', 'PRODUCT_TEXT']),
      new Set(['DERIVED', 'ANCHOR']),
    ]) {
      assert.equal(bucketEntryPermitted('electronics:teleporter', set, table), false,
        `no evidence set may open an undeclared wide bucket, not even ${[...set].join('+')}`);
    }

    // The mirror: the rule keys off the CEILING RELATIONSHIP, not off a name
    // list. A bucket within its parent needs nothing and is open on DERIVED.
    assert.equal(bucketEntryPermitted('electronics:gaming mouse', new Set(['DERIVED'])), true);
    const withinParent = Object.entries(ENVELOPES)
      .filter(([k]) => k.includes(':'))
      .filter(([k, e]) => ENVELOPES[k.split(':')[0]] && e.hard_max <= ENVELOPES[k.split(':')[0]].hard_max);
    assert.ok(withinParent.length >= 5, 'the within-parent half of the table must not be empty');
    for (const [k] of withinParent) {
      assert.deepEqual(bucketEntryRequirement(k), [], `${k} is no wider than its parent and needs nothing`);
    }
  });

  test('EA-2e THE DEFAULT ITSELF: no second argument means DERIVED only', () => {
    // Also found by mutation. Every other case here passes an explicit evidence
    // set, so widening the DERIVED_ONLY default went unnoticed — and that default
    // is what protects every caller who has not been taught about evidence yet.
    const rec = { category: 'Electronics', category_confidence: 0.9, subcategory: 'laptop',
      brand_candidates: [], model_candidates: [], ocr_text: { raw_texts: [] } };
    assert.equal(resolveEnvelopeKey(rec), 'electronics',
      'a caller that passes nothing must not receive a bucket wider than the parent');
    assert.equal(resolveEnvelopeKey(rec, undefined), 'electronics');
    // A garbled evidence argument is not a permissive one either.
    for (const junk of [null, 0, '', 'OBJECT_CLASS', 42, {}, true]) {
      assert.equal(resolveEnvelopeKey(rec, junk), 'electronics',
        `${JSON.stringify(junk)} must not be read as evidence`);
    }
    // An ARRAY is a legitimate serialised form and must still work.
    assert.equal(resolveEnvelopeKey(rec, ['DERIVED', 'OBJECT_CLASS']), 'electronics:laptop');
  });
});

describe('EA-3 evidence is established by PROVENANCE, not by assertion', () => {
  test('EA-3a the relabelling attack that defeated attempt 1 does nothing here', () => {
    // A reviewer inverted the previous rule by editing one free-form string.
    // Nothing in this module reads that field, so all four labels agree.
    const base = {
      category: 'Watches', subcategory: 'watch', category_confidence: 0.9,
      brand_candidates: [{ brand: 'Rolex', confidence: 0.9 }],
      model_candidates: [{ model: 'Submariner', confidence: 0.9 }],
      ocr_text: { raw_texts: [] },
    };
    const seen = new Set();
    for (const label of ['readable_text', 'shape_only', 'visual_shape', 'packaging_design', undefined]) {
      const rec = {
        ...base,
        brand_candidates: [{ brand: 'Rolex', confidence: 0.9, evidence: label }],
        model_candidates: [{ model: 'Submariner', confidence: 0.9, evidence: label }],
      };
      seen.add(resolveEnvelopeKey(rec, deriveEvidence({ recognition: rec }).classes));
    }
    assert.equal(seen.size, 1, 'the self-described evidence label must change nothing at all');
    assert.deepEqual([...seen], ['watches'], 'and with nothing READ, the luxury bucket stays shut');
  });

  test('EA-3b a name is BRAND_TEXT only when it occurs in text read off the item', () => {
    const claimed = { brand_candidates: [{ brand: 'Rolex' }], ocr_text: { raw_texts: ['WARRANTY 2019'] } };
    assert.deepEqual(evidenceList({ recognition: claimed }), ['DERIVED']);

    // H-5. THIS ASSERTED SELF-CORROBORATION AS VALID. `ocr_text.raw_texts` is
    // STAGE-1 MODEL OUTPUT — the schema declares it, the prompt asks for "exact
    // text found", and the schema is never applied. So one model call wrote both
    // the candidate and the transcription that "confirmed" it, and BRAND_TEXT
    // meant the model had said it twice. DERIVED + DERIVED is not corroboration.
    const selfWritten = { brand_candidates: [{ brand: 'Rolex' }], ocr_text: { raw_texts: ['ROLEX OYSTER'] } };
    assert.deepEqual(evidenceList({ recognition: selfWritten }), ['DERIVED'],
      'a model may not corroborate its own claim with its own transcription');

    // An INDEPENDENT reader does establish it. This is the half that must keep
    // working, or the class would be unreachable rather than merely honest.
    const viaVision = { brand_candidates: [{ brand: 'Rolex' }], ocr_text: { raw_texts: [] } };
    assert.deepEqual(evidenceList({ recognition: viaVision, visionData: { text: ['ROLEX'] } }),
      ['BRAND_TEXT', 'DERIVED']);

    // H-6. A compatibility label contains the brand BY DESIGN — that is what it
    // is for. A ₪20 case must not inherit the phone's bucket.
    assert.deepEqual(evidenceList({ recognition: viaVision,
      visionData: { text: ['Compatible with Rolex'] } }), ['DERIVED']);
    // And tokens may not pool across separate detections.
    assert.deepEqual(evidenceList({
      recognition: { brand_candidates: [{ brand: 'Tag Heuer' }], ocr_text: { raw_texts: [] } },
      visionData: { text: ['TAG', 'HEUER'] } }), ['DERIVED'],
      'two detections are not one line');
  });

  test('EA-3c WHOLE WORDS: a longer word does not establish a shorter name', () => {
    // 'G502' must not be established by 'G5020'; 'LG' must not be established by
    // the word 'ALGAE'. Substring matching here would hand BRAND_TEXT to any
    // scan whose OCR happened to contain the letters.
    // Read by VISION, not self-written — see H-5 in EA-3b. The property under
    // test here is whole-word matching, not provenance.
    const near = (raw, brand) => evidenceList({
      recognition: { brand_candidates: [{ brand }], ocr_text: { raw_texts: [] } },
      visionData: { text: [raw] } });
    assert.deepEqual(near('G5020 SERIAL', 'G502'), ['DERIVED']);
    assert.deepEqual(near('ALGAE EXTRACT', 'LG'), ['DERIVED']);
    assert.deepEqual(near('LG OLED', 'LG'), ['BRAND_TEXT', 'DERIVED']);
    // A multi-word product name matches as a contiguous phrase, not a bag.
    const phrase = (raw) => evidenceList({
      recognition: { model_candidates: [{ model: 'Detect Power Blender' }], ocr_text: { raw_texts: [] } },
      visionData: { text: [raw] } });
    assert.deepEqual(phrase('DETECT POWER BLENDER PRO'), ['PRODUCT_TEXT', 'DERIVED']);
    assert.deepEqual(phrase('POWER SUPPLY / DETECT MODE / BLENDER'), ['DERIVED'],
      'tokens pooled across the line must not assemble the product name');
  });

  test('EA-3d OBJECT_CLASS comes from a classifier, at or above the signal floor', () => {
    assert.deepEqual(evidenceList({ visionData: sawA('Laptop', OBJECT_CLASS_SCORE_FLOOR) }),
      ['OBJECT_CLASS', 'DERIVED'], 'at the floor is in');
    assert.deepEqual(evidenceList({ visionData: sawA('Laptop', OBJECT_CLASS_SCORE_FLOOR - 0.01) }),
      ['DERIVED'], 'below the floor is out');
    // A written subcategory is never object class, however specific it sounds.
    assert.deepEqual(evidenceList({ recognition: { subcategory: 'laptop', product_type: 'notebook computer' } }),
      ['DERIVED']);
  });

  test('EA-3e the floor is the SAME number the recognition path uses', () => {
    // Restated rather than imported, because the module takes no imports — so
    // the equality is asserted instead of assumed. Two floors would mean a
    // signal Vision kept and the evidence layer dropped, or the reverse.
    const src = readFileSync(new URL('../api/analyze.js', import.meta.url), 'utf8');
    const m = src.match(/const VISION_SIGNAL_FLOOR = ([0-9.]+);/);
    assert.ok(m, 'VISION_SIGNAL_FLOOR must still exist in api/analyze.js');
    assert.equal(Number(m[1]), OBJECT_CLASS_SCORE_FLOOR);
  });

  test('EA-3f deriveEvidence is TOTAL — no input shape throws, all fail closed', () => {
    const junk = [undefined, null, 0, '', 'str', [], {}, NaN, true, () => {}];
    for (const r of junk) for (const v of junk) {
      const out = evidenceList({ recognition: r, visionData: v, anchor: r });
      assert.ok(Array.isArray(out), 'must always return a list');
      assert.ok(out.includes('DERIVED'), 'DERIVED is always present');
      for (const c of out) assert.ok(EVIDENCE_CLASSES.includes(c), `unknown class ${c}`);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// §4  CATEGORY AUTHORITY
// ════════════════════════════════════════════════════════════════════════════
describe('CA-1 the paperback witness, end to end', () => {
  const PAPERBACK = {
    category: 'Books', category_confidence: 0.9, subcategory: 'paperback',
    brand_candidates: [], model_candidates: [], ocr_text: { raw_texts: [] },
  };
  const authority = (stage2cat, evidence = ev()) =>
    resolveCategoryAuthority({ stage1: PAPERBACK, stage2: { category: stage2cat }, evidence });

  test('CA-1a Stage 2 cannot widen the ceiling by returning a different string', () => {
    // The CRITICAL. Books hard_max 480; the enum bounds the NAMES and not the
    // ceilings, which run from 480 to 250,000.
    for (const cat of ['Electronics', 'Furniture', 'Vehicles', 'Watches', 'Home', 'Tools']) {
      const a = authority(cat);
      assert.equal(a.pricing_category, 'Books', `${cat} must not become the pricing category`);
      assert.equal(a.display_category, cat, 'but the UI may still show what Stage 2 believes');
      assert.equal(a.category_disagreement, true);
      assert.equal(a.pricing_envelope_source, ENVELOPE_SOURCE.STAGE1_HELD_ON_DISAGREEMENT);
    }
  });

  test('CA-1b and the disagreement REFUSES the number under either label', () => {
    // The half the revert missed. Pricing on Stage 1 while displaying Stage 2
    // tells the user two things, one of which is false, and they cannot tell
    // which. So no price ships at all.
    const a = authority('Electronics');
    const v = validateQuote({ low: 3200, mid: 4000, high: 5000, currency: 'ILS' }, {
      stage: 'pre', pre_source: 'catalog', anchorModelEvidence: true, anchor: null,
      identity: { brandOk: false, modelOk: false }, recognition: PAPERBACK, evidence: ev(),
      category_disagreement: a.category_disagreement,
      pricing_category: a.pricing_category, display_category: a.display_category,
    });
    assert.equal(v.action, 'degrade');
    assert.match(v.metadata.degraded_reason, /V-CATEGORY-DISAGREEMENT/);
    assert.deepEqual(v.prices, { low: 0, mid: 0, high: 0 });
    // And a price that WOULD have fit Books is refused too, because the
    // disagreement is about what the object is, not about the size of the number.
    const small = validateQuote({ low: 15, mid: 20, high: 30, currency: 'ILS' }, {
      stage: 'pre', pre_source: 'catalog', anchorModelEvidence: true, anchor: null,
      identity: { brandOk: false, modelOk: false }, recognition: PAPERBACK, evidence: ev(),
      category_disagreement: true,
    });
    assert.equal(small.action, 'degrade');
  });

  test('CA-1c THE INVERSE: a wrong Stage 1 can be corrected by real evidence', () => {
    // Stage 1 is not immutable. This is the route the revert removed, and its
    // absence was the reopened finding: without it, a Stage-1 mistake is
    // permanent and correct recognition can never rescue it.
    const a = authority('Electronics', ev(EVIDENCE.OBJECT_CLASS));
    assert.equal(a.pricing_category, 'Electronics');
    assert.equal(a.category_disagreement, false);
    assert.equal(a.pricing_envelope_source, ENVELOPE_SOURCE.STAGE2_EVIDENCED);

    const withAnchor = authority('Electronics', ev(EVIDENCE.ANCHOR));
    assert.equal(withAnchor.pricing_category, 'Electronics');
    assert.equal(withAnchor.pricing_envelope_source, ENVELOPE_SOURCE.STAGE2_EVIDENCED);
  });

  test('CA-1d text classes do NOT widen a category, and the reason is physical', () => {
    // A brand name printed on a book jacket is genuinely read off the item and
    // says nothing whatever about whether the object is a book or a laptop. Only
    // a verdict about the OBJECT can answer that.
    for (const c of [EVIDENCE.BRAND_TEXT, EVIDENCE.PRODUCT_TEXT]) {
      const a = authority('Electronics', ev(c));
      assert.equal(a.pricing_category, 'Books', `${c} must not widen a category`);
      assert.equal(a.category_disagreement, true);
    }
    assert.equal(authority('Electronics', ev(EVIDENCE.BRAND_TEXT, EVIDENCE.PRODUCT_TEXT)).category_disagreement,
      true, 'nor both of them together');
  });
});

describe('CA-2 narrowing is free; widening is not', () => {
  const s1 = (category, extra = {}) => ({ category, category_confidence: 0.9, ...extra });

  test('CA-2a a narrowing move needs no evidence at all', () => {
    const a = resolveCategoryAuthority({ stage1: s1('Electronics'), stage2: { category: 'Books' }, evidence: ev() });
    assert.equal(a.pricing_category, 'Books');
    assert.equal(a.pricing_envelope_source, ENVELOPE_SOURCE.STAGE2_NARROWING);
    assert.equal(a.category_disagreement, false);
    assert.ok(ENVELOPES[a.pricing_envelope_key].hard_max <= ENVELOPES.electronics.hard_max);
  });

  test('CA-2b the direction is decided by CEILINGS, over every ordered pair', () => {
    // Generated, not listed: every ordered pair of canonical categories is
    // checked, so the rule cannot be right for the examples somebody thought of
    // and wrong elsewhere. 15 x 15 = 225 transitions.
    const CATS = ['Electronics', 'Furniture', 'Vehicles', 'Watches', 'Clothing', 'Sports',
      'Smoking', 'Home', 'Beauty', 'Books', 'Toys', 'Tools', 'Food', 'Bags', 'Jewelry'];
    let widened = 0, narrowed = 0, held = 0;
    for (const from of CATS) for (const to of CATS) {
      const a = resolveCategoryAuthority({ stage1: s1(from), stage2: { category: to }, evidence: ev() });
      const incumbent = resolveEnvelopeKey(s1(from), ev());
      const ceil = (k) => (k ? ENVELOPES[k].hard_max : 2000);
      if (from === to) { held++; continue; }
      const chosen = resolveEnvelopeKey(s1(to), ev());
      if (ceil(chosen) <= ceil(incumbent)) {
        narrowed++;
        assert.equal(a.pricing_category, to, `${from}->${to} narrows and must be taken`);
        assert.equal(a.category_disagreement, false);
      } else {
        widened++;
        assert.equal(a.pricing_category, from, `${from}->${to} widens and must be refused`);
        assert.equal(a.category_disagreement, true);
      }
      // Whatever happened to the price, the UI is always allowed Stage 2's view.
      assert.equal(a.display_category, to);
    }
    assert.ok(widened > 20 && narrowed > 20,
      `the corpus must exercise both directions (widened ${widened}, narrowed ${narrowed}, held ${held})`);
  });

  test('CA-2c THE FOUR NAMES ARE FOUR DIFFERENT ANSWERS, and are never collapsed', () => {
    const a = resolveCategoryAuthority({
      stage1: s1('Books'), stage2: { category: 'Electronics' }, evidence: ev() });
    assert.equal(a.display_category, 'Electronics');
    assert.equal(a.recognition_category, 'Electronics');
    assert.equal(a.pricing_category, 'Books');
    assert.equal(a.pricing_envelope_source, ENVELOPE_SOURCE.STAGE1_HELD_ON_DISAGREEMENT);
    assert.notEqual(a.display_category, a.pricing_category,
      'the case that matters is exactly the one where they differ');
  });

  test('CA-2d Stage 2 supplies ONLY a category — not a route through another field', () => {
    // The first version of the envelope rule was defeated by moving the identity
    // from `brand_candidates` into `subcategory`. If Stage 2 could contribute
    // `subcategory` here, the same move would reopen the widening: a "Books"
    // scan with Stage 2 subcategory 'laptop' would reach electronics:laptop.
    const a = resolveCategoryAuthority({
      stage1: s1('Books'),
      stage2: { category: 'Books', subcategory: 'laptop', product_type: 'laptop',
                brand_candidates: [{ brand: 'Apple' }] },
      evidence: ev(EVIDENCE.OBJECT_CLASS),
    });
    assert.equal(a.pricing_envelope_key, 'books',
      'no field of Stage 2 except `category` may influence the envelope');
  });

  test('CA-2e a missing, blank or non-string Stage 2 category changes nothing', () => {
    for (const bad of [undefined, null, '', '   ', 42, [], {}, true]) {
      const a = resolveCategoryAuthority({ stage1: s1('Books'), stage2: { category: bad }, evidence: ev() });
      assert.equal(a.pricing_category, 'Books');
      assert.equal(a.category_disagreement, false, `${JSON.stringify(bad)} must not be a disagreement`);
      assert.equal(a.pricing_envelope_source, ENVELOPE_SOURCE.STAGE1);
    }
    // Same name in different case is the same answer, not a disagreement.
    assert.equal(resolveCategoryAuthority({ stage1: s1('Books'), stage2: { category: 'books' }, evidence: ev() })
      .category_disagreement, false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// §9  CONFIDENCE — ONE PARSER, TWO CALL SITES, NO TRUTHINESS
// ════════════════════════════════════════════════════════════════════════════
describe('CF-1 a confidence is a probability', () => {
  // 0.9999999999 was in this list while it was being written, and both CF-1a and
  // CF-1d went red for it. It is a perfectly good probability; the list was wrong,
  // not the parser. Left recorded because a malformed-input corpus that quietly
  // contains a VALID input is how a fail-closed rule gets loosened to make a test
  // pass — which is the failure mode this whole file exists to avoid.
  const MALFORMED = [30, 99, '0.95', NaN, Infinity, -Infinity, -1, 1.01, [], {}, null, undefined,
    true, false, '1', '', { valueOf: () => 1 }, [0.9], 5];

  test('CF-1a every malformed encoding parses to NaN, which fails every comparison', () => {
    for (const v of MALFORMED) {
      assert.ok(Number.isNaN(confidence(v)), `${JSON.stringify(v)} must not parse as a probability`);
      // The property that matters is not "returns NaN" but "cannot clear a
      // floor" — asserted directly, because that is what callers do with it.
      assert.equal(confidence(v) >= 0.6, false);
      assert.equal(confidence(v) >= 0, false, 'NaN fails even the weakest comparison');
    }
  });

  test('CF-1b and every well-formed probability survives unchanged', () => {
    for (const v of [0, 0.0001, 0.3, 0.5, 0.6, 0.999, 1]) assert.equal(confidence(v), v);
  });

  test('CF-1c the guard and the shared module agree over the whole matrix', () => {
    // The guard keeps its own copy because it may not import at will. That is
    // only safe if the two are proven to agree, so they are compared here rather
    // than assumed to match. resolveIdentityTier is the guard's observable.
    for (const v of [...MALFORMED, 0, 0.3, 0.59, 0.6, 0.95, 1]) {
      const tier = resolveIdentityTier({
        identity: { brandOk: true, modelOk: true, brandC: v, modelC: v },
        recognition: { category: 'Electronics', category_confidence: 0.9 },
      });
      const shouldReachTop = !Number.isNaN(confidence(v)) && confidence(v) >= 0.6;
      assert.equal(tier === IDENTITY_TIER.EXACT_MODEL, shouldReachTop,
        `brandC/modelC ${JSON.stringify(v)}: guard and parser disagree`);
    }
  });

  test('CF-1d MALFORMED IS NEVER STRONGER THAN WEAK — the reviewer witness', () => {
    // brandC 0.30 refused; brandC 30 reached EXACT_MODEL and a top-tier price.
    // The property is that every malformed value behaves exactly like the
    // below-floor value, never better.
    const tierFor = (v) => resolveIdentityTier({
      identity: { brandOk: true, modelOk: true, brandC: v, modelC: v },
      recognition: { category: 'Electronics', category_confidence: 0.9 },
    });
    const weak = tierFor(0.30);
    for (const v of MALFORMED) {
      assert.equal(tierFor(v), weak,
        `${JSON.stringify(v)} must be treated exactly as the below-floor 0.30, not better`);
    }
    assert.notEqual(tierFor(0.95), weak, 'and a real confidence must still be worth something');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// §6  TOKENS — the shared predicate, adversarially
// ════════════════════════════════════════════════════════════════════════════
describe('TK-1 one predicate, declared modes', () => {
  test('TK-1a every declared token matches itself and its plural', () => {
    for (const [tok, mode] of Object.entries(TOKEN_MODE)) {
      assert.equal(names(tok, tok), true, `${tok} must name itself`);
      if (mode === 'word') {
        assert.equal(names(`${tok}s`, tok), true, `${tok}s must still name ${tok}`);
        // and must NOT match an unrelated word that merely starts with it
        assert.equal(names(`${tok}zzq`, tok), false, `${tok}zzq must not name ${tok}`);
      }
      assert.equal(names(`the ${tok} thing`, tok), true, 'position within the string is irrelevant');
    }
  });

  test('TK-1b GENERATED ADVERSARIAL CORPUS: an affixed token never matches a word mode', () => {
    // Not a list of remembered witnesses. Every 'word' token is crossed with
    // real English affixes, and each product is required to stop naming its
    // token. "Tablet" and "Watchdog" are two of the cases this generates; the
    // others were never written down by anyone.
    const PREFIX = ['rail', 'score', 'hand', 'book', 'card', 'card', 'over', 'under', 'foot', 'note'];
    const SUFFIX = ['dog', 'let', 'case', 'pet', 'igan', 'toon', 'van', 'cloth', 'board', 'ing'];
    let checked = 0;
    for (const [tok, mode] of Object.entries(TOKEN_MODE)) {
      if (mode !== 'word') continue;
      for (const p of PREFIX) {
        const w = p + tok;
        if (w === tok) continue;
        assert.equal(names(w, tok), false, `"${w}" contains "${tok}" but does not name it`);
        checked++;
      }
      for (const sfx of SUFFIX) {
        const w = tok + sfx;
        if (w === `${tok}s` || w === `${tok}es`) continue;   // those ARE the plural
        assert.equal(names(w, tok), false, `"${w}" contains "${tok}" but does not name it`);
        checked++;
      }
    }
    assert.ok(checked > 300, `only ${checked} adversarial pairs generated — the corpus is too small to mean anything`);
  });

  test('TK-1c an UNDECLARED token cannot match anything — fail-closed', () => {
    // Adding a matcher without declaring its word must break loudly. If this
    // ever returns true, a new matcher silently fell back to substring.
    for (const t of ['gizmo', 'widget', 'thingamajig', '']) {
      assert.equal(names(`a ${t} here`, t), false, `undeclared token ${t} must not match`);
    }
  });
});
