// ══════════════════════════════════════════════════════════════════════════════
// SCAN-015 — recognition baseline (characterization tests)
//
// WHAT THIS FILE IS FOR
// Two kinds of assertion live here, and the difference is the point of the file:
//
//   §A INVARIANTS — behaviour that must hold before AND after the recognition
//     work. If one of these fails, something broke. Fix the code, not the test.
//
//   §B BASELINE — behaviour as it exists TODAY, including behaviour we believe
//     is wrong. Each defect-encoding assertion carries a DEFECT-nn tag naming
//     what it should become. When a later commit fixes that defect, the
//     assertion here is EXPECTED to change, and the diff is the before/after
//     evidence for that commit. A §B test changing silently, with no DEFECT tag
//     retired in the same commit, means an unintended behaviour change.
//
// Recording current behaviour — including wrong behaviour — is the only way to
// prove a later change did what it claimed and nothing else. Every expected
// value below was OBSERVED by executing the function, never assumed.
//
// Pure unit tests: no network, no DB, no env vars. api/analyze.js is safe to
// import directly — it calls createClient() lazily inside functions and does no
// top-level I/O, so importing it has no side effects.
//
//   node --test tests/recognition-baseline.test.mjs
// ══════════════════════════════════════════════════════════════════════════════
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ANALYZE_URL = new URL('../api/analyze.js', import.meta.url);
const MEMORY_URL = new URL('../api/_lib/recognition-memory.js', import.meta.url);

const A = await import(ANALYZE_URL.href);
const M = await import(MEMORY_URL.href);

const {
  stripBrandPrefix, composeBrandModelName, sanitizeUserCorrection,
  gradeRowEvidence, calibrateRecognition, buildRecognitionPrompt, RECOGNITION_SCHEMA, VERIFICATION_SCHEMA,
  rankCandidates, classifyRowEvidence, sameModelString, EVIDENCE_CLASS,
  calibrateVerification, isSpecificTokenMatch, brandCompatible,
} = A;
const { buildRecognitionMemoryKey, MEMORY_KEY_VERSION } = M;

const ANALYZE_SRC = readFileSync(ANALYZE_URL, 'utf8');

// Model key for a brand/model pair, or the failure sentinel.
const key = (brand, model, category = 'Electronics') => {
  const r = buildRecognitionMemoryKey({ category, brand, model });
  return r?.ok ? r.key : `NOT_OK:${r?.reason ?? 'unknown'}`;
};
const modelKey = (brand, model, category = 'Electronics') =>
  buildRecognitionMemoryKey({ category, brand, model })?.modelKey ?? null;

// ══════════════════════════════════════════════════════════════════════════════
// §A INVARIANTS — must survive every recognition change
// ══════════════════════════════════════════════════════════════════════════════

test('A-01 stripBrandPrefix removes a brand prefix, repeated any number of times', () => {
  assert.equal(stripBrandPrefix('Logitech', 'Logitech G900'), 'G900');
  assert.equal(stripBrandPrefix('Logitech', 'Logitech Logitech G Pro'), 'G Pro');
});

test('A-02 stripBrandPrefix never empties a model that is only the brand', () => {
  // Returning '' here would erase the identity downstream; it must fall back.
  assert.equal(stripBrandPrefix('Logitech', 'Logitech'), 'Logitech');
  assert.equal(stripBrandPrefix('Logitech', 'G900'), 'G900');
});

test('A-03 composeBrandModelName does not double a brand already in the model', () => {
  assert.equal(composeBrandModelName('Logitech', 'G900'), 'Logitech G900');
  assert.equal(composeBrandModelName('Logitech', 'Logitech G900'), 'Logitech G900');
});

test('A-04 sanitizeUserCorrection splits a typed correction into brand + model', () => {
  const withBrand = sanitizeUserCorrection('Logitech G900', 'Logitech');
  assert.equal(withBrand.corrBrand, 'Logitech');
  assert.equal(withBrand.corrModel, 'G900');

  // Model-only input inherits the Stage 1 brand rather than losing it.
  const modelOnly = sanitizeUserCorrection('G900', 'Logitech');
  assert.equal(modelOnly.corrBrand, 'Logitech');
  assert.equal(modelOnly.corrModel, 'G900');
});

test('A-05 gradeRowEvidence demands model-level evidence, not a brand match', () => {
  const row = { brand: 'Logitech', model: 'G502', name: 'Logitech G502 Hero', keywords: [], aliases: [] };

  // A token matching the MODEL column is evidence.
  assert.equal(gradeRowEvidence(row, ['g502'], ['g502']), true);
  // No evidence tokens at all cannot manufacture evidence.
  assert.equal(gradeRowEvidence(row, [], ['g502']), false);
  // The brand alone is not evidence — every row of that brand would match.
  assert.equal(gradeRowEvidence(row, ['logitech'], ['logitech']), false);
  // A DIFFERENT model must not grade as evidence for this row. This is the
  // sibling-confusion guard; if it ever returns true, wrong-model rows start
  // earning confidence boosts.
  assert.equal(gradeRowEvidence(row, ['g903'], ['g903']), false);
});

test('A-06 memory keys are deterministic and version-stamped', () => {
  assert.equal(MEMORY_KEY_VERSION, 2);
  assert.equal(key('Logitech', 'G900'), key('Logitech', 'G900'));
  assert.ok(key('Logitech', 'G900').startsWith(`v${MEMORY_KEY_VERSION}|`));
});

test('A-07 category is key material — same brand+model, different category, different key', () => {
  // Fail-safe against cross-category collisions.
  assert.notEqual(key('Acme', 'X1', 'Electronics'), key('Acme', 'X1', 'Furniture'));
});

test('A-08 the recognition schema still requires the identity-bearing fields', () => {
  // Guards against a field being quietly dropped from the contract.
  for (const f of ['category', 'category_confidence', 'brand_candidates', 'model_candidates', 'ocr_text', 'visual_features']) {
    assert.ok(RECOGNITION_SCHEMA.required.includes(f), `RECOGNITION_SCHEMA must require ${f}`);
  }
  for (const f of ['final_brand', 'final_model', 'match_confidence']) {
    assert.ok(VERIFICATION_SCHEMA.required.includes(f), `VERIFICATION_SCHEMA must require ${f}`);
  }
});

// ── Stage 1 uncertainty (SCAN-015) ───────────────────────────────────────────
// A minimal recognition object. Defaults describe the hard case: a shape-only
// photo with a visible logo and no legible text.
const recog = (over = {}) => calibrateRecognition({
  category: 'Electronics',
  category_confidence: 0.8,
  ocr_text: { has_readable_text: false, raw_texts: [] },
  brand_candidates: [{ brand: 'Logitech', confidence: 0.88, evidence: 'logo_visible' }],
  model_candidates: [],
  ...over,
});

test('A-09 an unearned model confidence is clamped to the prompt ceiling', () => {
  // The prompt has always said "NEVER assign >0.70 model confidence from
  // silhouette/shape alone". Nothing enforced it. A silhouette claiming 0.90
  // reached the Vision trigger and retrieval's model_ok gate intact.
  const r = recog({ model_candidates: [{ model: 'G903', confidence: 0.90, evidence: 'shape_match' }] });
  assert.equal(r.model_candidates[0].confidence, 0.70);
  assert.equal(r.model_candidates[0]._clamp_reason, 'no_text_evidence');
});

test('A-10 text-confirmed model confidence is NOT clamped', () => {
  // The clamp must not punish the case it exists to protect. Reading "G900" off
  // a label is exactly the evidence that earns a high number.
  const r = recog({
    ocr_text: { has_readable_text: true, raw_texts: ['G900'] },
    model_candidates: [{ model: 'G900', confidence: 0.90, evidence: 'readable_text' }],
  });
  assert.equal(r.model_candidates[0].confidence, 0.90);
  assert.equal(r.identity_resolution.level, 'exact');
});

test('A-11 brand confidence survives model uncertainty', () => {
  // The asymmetry that makes family-level identity possible: a visible logo is
  // real brand evidence even when no model text is legible. Capping brand here
  // would discard the one thing we actually know.
  const r = recog({ model_candidates: [{ model: 'G903', confidence: 0.90, evidence: 'shape_match' }] });
  assert.equal(r.identity_resolution.brand, 'Logitech');
  assert.equal(r.identity_resolution.brand_confidence, 0.88);
  assert.equal(r.identity_resolution.level, 'family');
  assert.equal(r.identity_resolution.model, null, 'no exact model may be claimed without text evidence');
});

test('A-12 a sibling tie resolves to family, not to an arbitrary winner', () => {
  // Decided by the MARGIN between the top two, not either absolute number:
  // 0.62 vs 0.58 is a coin flip however confident each claims to be. This is
  // the "Logitech G900 vs G903 — uncertain" case stated honestly.
  const r = recog({
    model_candidates: [
      { model: 'G502', confidence: 0.62, evidence: 'shape' },
      { model: 'G903', confidence: 0.58, evidence: 'shape' },
    ],
  });
  assert.equal(r.identity_resolution.level, 'family');
  assert.equal(r.identity_resolution.exact_model_ambiguous, true);
  assert.deepEqual(r.identity_resolution.ambiguous_between, ['G502', 'G903']);
});

test('A-13 Stage 1 may report a family it recognises', () => {
  const r = recog({
    model_family: 'Logitech G-series gaming mouse',
    exact_model_ambiguous: true,
    model_candidates: [
      { model: 'G502', confidence: 0.30, evidence: 'shape' },
      { model: 'G903', confidence: 0.30, evidence: 'shape' },
    ],
  });
  assert.equal(r.identity_resolution.family, 'Logitech G-series gaming mouse');
  assert.equal(r.identity_resolution.level, 'family');
});

test('A-14 no identity at all resolves to unknown, never to a guess', () => {
  // Uncertainty is a valid terminal result. The pipeline must be able to say so
  // rather than emit a low-confidence invention.
  const r = calibrateRecognition({
    category: 'Other', category_confidence: 0.3,
    ocr_text: {}, brand_candidates: [], model_candidates: [],
  });
  assert.equal(r.identity_resolution.level, 'unknown');
  assert.equal(r.identity_resolution.brand, null);
  assert.equal(r.identity_resolution.model, null);
});

test('A-15 calibration is pure — the caller\'s object is not mutated', () => {
  // handleRequest injects user corrections into `recognition` AFTER this runs;
  // in-place mutation here would make that ordering fragile.
  const input = {
    category: 'Electronics', category_confidence: 0.8,
    ocr_text: { has_readable_text: false, raw_texts: [] },
    brand_candidates: [{ brand: 'Logitech', confidence: 0.88, evidence: 'logo' }],
    model_candidates: [{ model: 'G903', confidence: 0.90, evidence: 'shape' }],
  };
  const before = JSON.stringify(input);
  calibrateRecognition(input);
  assert.equal(JSON.stringify(input), before, 'calibrateRecognition must not mutate its argument');
});

// ── Evidence-class ranking (SCAN-016) ────────────────────────────────────────
// Retrieval row shorthand. `sim` is the strategy's constant, NOT a measurement.
const row = (o) => ({
  id: o.id, brand: o.brand ?? 'Logitech', model: o.model,
  similarity: o.sim, _source: o.src,
  _evidence_grade: !!o.ev, _ocr_model_confirmed: !!o.otc,
});

test('A-16 exact catalog evidence outranks a higher-scoring semantic hit', () => {
  // The flat sort's core failure: vector similarity is real cosine, bounded
  // only by 1.0, so it could exceed strategy 1's fixed 0.92 and take top-1 from
  // an exact brand+model match. Class first means it no longer can, at any cosine.
  const r = rankCandidates([
    row({ id: 'vec', model: 'G903', sim: 0.97, src: 'vector' }),
    row({ id: 'exact', model: 'G502 Hero', sim: 0.92, src: 'exact_brand_model' }),
  ], { queryModel: 'G502 Hero' });

  assert.equal(r.rows[0].id, 'exact');
  assert.equal(r.rows[0]._evidence_class, EVIDENCE_CLASS.EXACT_MODEL);
  assert.equal(r.exactMatch, true);
});

test('A-17 a G502-family sibling does not outrank the scanned model', () => {
  // THE sibling-confusion regression. Strategy 3a strips the trailing variant
  // suffix, so a "G502 Hero" query matches "G502 X Plus" and stamped it 0.85 —
  // above the true row and above the old >70% adoption rule. Different products
  // at different prices.
  const r = rankCandidates([
    row({ id: 'sibling', model: 'G502 X Plus', sim: 0.85, src: 'normalized_model' }),
    row({ id: 'true', model: 'G502 Hero', sim: 0.72, src: 'model_candidates' }),
  ], { queryModel: 'G502 Hero' });

  assert.equal(r.rows[0].id, 'true', 'the scanned model must win despite the lower score');
  assert.equal(r.rows[0]._evidence_class, EVIDENCE_CLASS.EXACT_MODEL);

  const sib = r.rows.find((x) => x.id === 'sibling');
  assert.equal(sib._evidence_class, EVIDENCE_CLASS.CATALOG_FUZZY);
  assert.equal(sib._sibling_of, 'G502 Hero', 'a demoted sibling must record what it is a sibling of');
});

test('A-18 plain G502, G502 Hero and G502 X Plus are three different products', () => {
  // Complements B-01: identity-key normalization still merges these (frozen v1
  // contract, changed separately), but RANKING must not. A G502 X Plus priced
  // as a G502 is the failure mode users actually see.
  for (const [query, wrong] of [
    ['G502', 'G502 X Plus'],
    ['G502 Hero', 'G502'],
    ['G502 X Plus', 'G502 Hero'],
  ]) {
    const r = rankCandidates([
      row({ id: 'wrong', model: wrong, sim: 0.85, src: 'normalized_model' }),
      row({ id: 'right', model: query, sim: 0.72, src: 'model_candidates' }),
    ], { queryModel: query });
    assert.equal(r.rows[0].id, 'right', `querying "${query}" must not return "${wrong}" first`);
  }
});

test('A-19 read model text beats a higher-scoring structural sibling', () => {
  // OCR that matched the model column is evidence; a suffix-stripped ILIKE is not.
  const r = rankCandidates([
    row({ id: 'sib', model: 'G502 X Plus', sim: 0.85, src: 'normalized_model' }),
    row({ id: 'ocr', model: 'G502 Hero SE', sim: 0.80, src: 'ocr_rpc', otc: true }),
  ], { queryModel: 'G502 Hero' });

  assert.equal(r.rows[0].id, 'ocr');
  assert.equal(r.rows[0]._evidence_class, EVIDENCE_CLASS.MODEL_TEXT);
});

test('A-20 a DB-missing item is not silently replaced by the nearest row', () => {
  // Nothing in the pool is the scanned item. exactMatch must be false so the
  // caller reports database_match=false / candidate_needed=true instead of
  // renaming the user's item to a product they do not own.
  const r = rankCandidates([
    row({ id: 'sib', model: 'G502 X Plus', sim: 0.85, src: 'normalized_model' }),
    row({ id: 'vec', model: 'G903', sim: 0.96, src: 'vector' }),
  ], { queryModel: 'G900 Chaos Spectrum' });

  assert.equal(r.exactMatch, false, 'resemblance is not a catalog match');
  assert.ok(r.topClass < EVIDENCE_CLASS.MODEL_TEXT);
});

test('A-21 ambiguity is preserved rather than resolved by list position', () => {
  // Two same-class rows, equal scores, different models: retrieval genuinely
  // cannot separate them. Position 0 must not be treated as a decision.
  const r = rankCandidates([
    row({ id: 'a', model: 'G502', sim: 0.85, src: 'normalized_model' }),
    row({ id: 'b', model: 'G502 X Plus', sim: 0.85, src: 'normalized_model' }),
  ], { queryModel: 'G502 Hero' });

  assert.equal(r.ambiguous, true);
  assert.equal(r.ambiguousBetween.length, 2);
});

test('A-22 an exact match is unambiguous even with a close-scoring neighbour', () => {
  // The ambiguity flag must not fire when one row is genuinely the item —
  // otherwise every confident scan would be reported as uncertain.
  const r = rankCandidates([
    row({ id: 'exact', model: 'G502 Hero', sim: 0.92, src: 'exact_brand_model' }),
    row({ id: 'near', model: 'G502 X Plus', sim: 0.90, src: 'normalized_model' }),
  ], { queryModel: 'G502 Hero' });

  assert.equal(r.ambiguous, false, 'different classes are not a tie');
  assert.equal(r.rows[0].id, 'exact');
});

test('A-23 sameModelString compares loosely but never across variants', () => {
  // Case/spacing/separator insensitive...
  assert.equal(sameModelString('G502 Hero', 'g502-hero'), true);
  assert.equal(sameModelString('WH-1000XM5', 'wh1000xm5'), true);
  // ...but a variant suffix is a DIFFERENT product. This is the line that
  // normalizeModelKey crosses and this function must not.
  assert.equal(sameModelString('G502', 'G502 X Plus'), false);
  assert.equal(sameModelString('G502 Hero', 'G502'), false);
  assert.equal(sameModelString('', ''), false, 'empty is never a match');
});

test('A-24 ranking is pure — input rows are not mutated', () => {
  const input = [row({ id: 'a', model: 'G502', sim: 0.85, src: 'normalized_model' })];
  const snapshot = JSON.stringify(input);
  rankCandidates(input, { queryModel: 'G502 Hero' });
  assert.equal(JSON.stringify(input), snapshot);
});

// ── Self-declaration cannot manufacture evidence (SCAN-017) ──────────────────
// `brand_confidence` and `identification_method` are written by Stage 2 ABOUT
// ITSELF. The rule these tests pin: CAPS may read them (a false claim can only
// lower a score), FLOORS and BOOSTS may not.
const verif = (o = {}) => ({
  match_confidence: 0.55, final_brand: 'Logitech', final_model: 'G502',
  brand_confidence: 'confirmed_by_text', identification_method: 'ocr_confirmed', ...o,
});
const recogFor = (o = {}) => ({
  ocr_text: { raw_texts: [], labels_detected: [], logos_detected: [] },
  brand_candidates: [{ brand: 'Logitech', confidence: 0.8, evidence: 'logo' }], ...o,
});
const conf = (v, r, db = [], vis = null) => calibrateVerification(v, r, db, vis).match_confidence;

test('A-25 a bare confirmed_by_text claim cannot raise confidence', () => {
  // THE regression. Stage 2 emitting brand_confidence='confirmed_by_text' used
  // to floor its own confidence at 0.80 while reading no evidence at all — not
  // _source, not similarity, not _evidence_grade, not rank. With retrieval
  // handing it a same-brand sibling, that produced a confident wrong answer.
  assert.equal(conf(verif(), recogFor(), []), 0.55, 'the claim alone must move nothing');
});

test('A-26 an uncorroborated claim is capped, not merely ignored', () => {
  // An inference presented as a reading IS an inference, so it is capped like
  // the inferred_from_visuals it actually was. Ignoring it would let a
  // self-reported 0.94 stand.
  assert.equal(conf(verif({ match_confidence: 0.94 }), recogFor(), []), 0.75);
});

test('A-27 Stage 1 OCR text corroborates the claim and the floor applies', () => {
  // The claim is falsifiable: if the brand was genuinely read off the item, it
  // is in the text Stage 1 extracted. Legitimate scans keep their floor.
  const r = recogFor({ ocr_text: { raw_texts: ['Logitech G502'], labels_detected: [], logos_detected: [] } });
  assert.equal(conf(verif(), r, []), 0.80);
});

test('A-28 Google Vision independently corroborates the claim', () => {
  // A second, independent OCR/logo pass Stage 2 did not author.
  const got = conf(verif(), recogFor(), [], { logos: [{ description: 'Logitech' }], text: [] });
  assert.ok(got >= 0.80, `expected >= 0.80 with Vision logo corroboration, got ${got}`);
});

test('A-29 retrieval model-text evidence corroborates the claim', () => {
  const db = [{
    brand: 'Logitech', model: 'G502', _ocr_model_confirmed: true,
    _evidence_grade: true, _source: 'ocr_rpc', _evidence_class: EVIDENCE_CLASS.MODEL_TEXT,
  }];
  assert.ok(conf(verif(), recogFor(), db) >= 0.80);
});

test('A-30 a sibling row is not corroboration for an exact-model claim', () => {
  // Guards the seam between this commit and evidence-class ranking: a
  // CATALOG_FUZZY row is family evidence, never model evidence, so it must not
  // unlock the text floor.
  const db = [{
    brand: 'Logitech', model: 'G502 X Plus', _ocr_model_confirmed: false,
    _evidence_grade: false, _source: 'normalized_model',
    _evidence_class: EVIDENCE_CLASS.CATALOG_FUZZY, _sibling_of: 'G502',
  }];
  assert.equal(conf(verif(), recogFor(), db), 0.55);
});

test('A-31 the packaging floor requires Stage 1 to agree it is packaging', () => {
  const v = verif({ brand_confidence: 'packaging_recognized', identification_method: 'packaging_recognized', match_confidence: 0.40 });

  // Stage 2 alone claiming packaging: no floor.
  assert.equal(conf(v, recogFor(), []), 0.40);

  // Stage 1's own evidence tag agrees — independent, so the floor stands.
  const corroborated = recogFor({ brand_candidates: [{ brand: 'Logitech', confidence: 0.8, evidence: 'packaging_design' }] });
  assert.equal(conf(v, corroborated, []), 0.60);
});

test('A-32 caps still read self-declared fields — a claim may only lower', () => {
  // The asymmetry that makes the rule safe. A model that under-claims is
  // believed; a model that over-claims is not.
  assert.ok(conf(verif({ brand_confidence: 'inferred_from_visuals', match_confidence: 0.95 }), recogFor(), []) <= 0.75);
  assert.ok(conf(verif({ identification_method: 'generic_only', match_confidence: 0.95 }), recogFor(), []) <= 0.50);
  assert.ok(conf(verif({ final_brand: 'unidentified', match_confidence: 0.95 }), recogFor(), []) <= 0.60);
});

test('A-33 no self-declared value can reach the old 0.80 floor unaided', () => {
  // Sweep every brand_confidence x identification_method pair with zero
  // corroboration. None may exceed the uncorroborated cap.
  const brandConfs = ['confirmed_by_text', 'inferred_from_visuals', 'packaging_recognized', 'db_matched', 'unidentified'];
  const methods = ['ocr_confirmed', 'visual_match', 'packaging_recognized', 'db_match', 'generic_only'];
  for (const bc of brandConfs) {
    for (const m of methods) {
      const got = conf(verif({ brand_confidence: bc, identification_method: m, match_confidence: 0.99 }), recogFor(), []);
      assert.ok(got < 0.80, `brand_confidence="${bc}" method="${m}" reached ${got} with no evidence`);
    }
  }
});

test('A-34 a user correction outranks every other signal and is never capped', () => {
  // Caught a real over-correction: the first version of the uncorroborated cap
  // fired BEFORE user-correction was considered, so the one signal that is not
  // a model's opinion at all was capped at 0.75 like an unsupported guess.
  // A correction is the user telling us what the item is.
  const r = recogFor({ _user_correction: 'Logitech G502' });
  const got = conf(verif({ match_confidence: 0.96 }), r, []);
  assert.ok(got > 0.75, `a user correction must not be capped as unsupported, got ${got}`);
  assert.equal(calibrateVerification(verif({ match_confidence: 0.96 }), r, []).confidence_evidence.user_correction, true);
});

test('A-35 legitimate text-confirmed scans keep their confidence', () => {
  // The whole point of verifying rather than deleting the floor: real evidence
  // must still earn a high number, or this trades one wrong answer for another.
  const readLabel = recogFor({ ocr_text: { raw_texts: ['Logitech G502'], labels_detected: [], logos_detected: [] } });
  const ocrRow = {
    brand: 'Logitech', model: 'G502', _ocr_model_confirmed: true,
    _evidence_grade: true, _source: 'ocr_rpc', _evidence_class: EVIDENCE_CLASS.MODEL_TEXT,
  };
  assert.ok(conf(verif({ match_confidence: 0.85 }), readLabel, [ocrRow]) >= 0.85);
  assert.ok(conf(verif({ match_confidence: 0.85 }), readLabel, [], { logos: [{ description: 'Logitech' }], text: ['G502'] }) >= 0.85);
});

test('A-36 confidence_evidence records which sources backed the number', () => {
  // Makes a scan's confidence auditable after the fact rather than inferred.
  const bare = calibrateVerification(verif(), recogFor(), []);
  assert.equal(bare.confidence_evidence.corroborated, false);

  const backed = calibrateVerification(
    verif(), recogFor({ ocr_text: { raw_texts: ['Logitech G502'], labels_detected: [], logos_detected: [] } }), []);
  assert.equal(backed.confidence_evidence.corroborated, true);
  assert.equal(backed.confidence_evidence.brand_in_text, true);
});

// ══════════════════════════════════════════════════════════════════════════════
// §B BASELINE — current behaviour, defects included. Expected to change.
// ══════════════════════════════════════════════════════════════════════════════

test('B-01 [DEFECT-1] model normalization OVER-merges distinct sibling products', () => {
  // normalizeModelKey strips ONE trailing variant suffix, so three products
  // that sell at different prices collapse to a single identity. A G502 X Plus
  // is not a G502. Expected fix: distinct products keep distinct keys.
  assert.equal(modelKey('Logitech', 'G502'), 'g502');
  assert.equal(modelKey('Logitech', 'G502 Hero'), 'g502');
  assert.equal(modelKey('Logitech', 'G502 X Plus'), 'g502');
});

test('B-02 [DEFECT-2] model normalization UNDER-merges the same product', () => {
  // Spacing, a vendor prefix, or the full retail name each fork the identity.
  // All four of these are one product. Expected fix: they converge.
  assert.equal(modelKey('Logitech', 'G900'), 'g900');
  assert.equal(modelKey('Logitech', 'G 900'), 'g 900');            // space forks it
  assert.equal(modelKey('Logitech', 'M-G900'), 'm g900');          // prefix forks it
  assert.equal(modelKey('Logitech', 'G900 Chaos Spectrum'), 'g900 chaos spectrum');

  const variants = new Set([
    modelKey('Logitech', 'G900'), modelKey('Logitech', 'G 900'),
    modelKey('Logitech', 'M-G900'), modelKey('Logitech', 'G900 Chaos Spectrum'),
  ]);
  assert.equal(variants.size, 4, 'one product currently occupies four identities');
});

test('B-03 [DEFECT-3] there is no brand normalization anywhere', () => {
  // Sub-brands and legal suffixes produce unrelated identities, so learning,
  // retrieval and memory all fragment across them.
  assert.notEqual(key('Logitech', 'G900'), key('Logitech G', 'G900'));
  assert.notEqual(key('Samsung', 'Galaxy S24 Ultra'), key('Samsung Electronics', 'Galaxy S24 Ultra'));

  // Worse: where the model splits brand from model changes the identity even
  // when the full string is character-identical ("ASUS ROG Strix").
  assert.notEqual(key('ASUS', 'ROG Strix'), key('ASUS ROG', 'Strix'));
});

test('B-04 [DEFECT-4 RETIRED] Stage 1 now has a sanctioned way to say "I cannot tell"', () => {
  // WAS: the Stage 1 prompt never offered "unidentified" while downstream code
  // gated on it everywhere, so Stage 1 was compelled to name a brand and model
  // on every scan. Fixed in "fix(recognition): improve Stage 1 uncertainty
  // handling" — this assertion is the inverse of its original form.
  const recognitionPrompt = ANALYZE_SRC.slice(
    ANALYZE_SRC.indexOf('function buildRecognitionPrompt'),
    ANALYZE_SRC.indexOf('export function buildVerificationPrompt'),
  );

  assert.match(recognitionPrompt, /unidentified/i,
    'Stage 1 must offer the "unidentified" vocabulary its consumers gate on');
  assert.match(recognitionPrompt, /empty|\[\]/i,
    'Stage 1 must be allowed to return an empty candidate list');
  assert.match(recognitionPrompt, /model_family/,
    'Stage 1 must be able to report family-level identity');
  assert.match(recognitionPrompt, /exact_model_ambiguous/,
    'Stage 1 must be able to flag an unresolvable sibling tie');
});

test('A-37 the Stage 1 response template is parseable JSON', () => {
  // Removing the LAST key of an object leaves a trailing comma, which is
  // invalid JSON. The template is a prompt string, so nothing in the build or
  // the type checker would catch it — but the model copies the shape it is
  // shown, and JSON.parse rejects a trailing comma, so the failure surfaces as
  // a Stage 1 parse error and a 503 with the quota refunded. Caught exactly this
  // way while trimming the write-only fields.
  const prompt = buildRecognitionPrompt('he');
  const block = prompt.slice(prompt.indexOf('{', prompt.indexOf('Respond ONLY with valid JSON')));
  const parsed = assert.doesNotThrow(() => JSON.parse(block)) ?? JSON.parse(block);

  // The identity-bearing keys must survive any future trim.
  for (const k of ['category', 'category_confidence', 'brand_candidates', 'model_candidates',
                   'ocr_text', 'visual_features', 'embedding_text', 'model_family', 'exact_model_ambiguous']) {
    assert.ok(k in parsed, `the Stage 1 template must still request "${k}"`);
  }
});

test('A-38 fields consumed downstream survive the output trim', () => {
  // The trim removes only PROVEN write-only fields. These are read — by the
  // embedding text, the confidence clamp, retrieval tokens, or the response —
  // so removing one would break a consumer silently rather than loudly.
  const prompt = buildRecognitionPrompt('he');
  const block = prompt.slice(prompt.indexOf('{', prompt.indexOf('Respond ONLY with valid JSON')));
  const parsed = JSON.parse(block);

  // visual_features feeds embedding_text construction; ocr_text feeds the
  // clamp, retrieval evidence tokens and result.ocr.
  for (const k of ['materials', 'colors', 'condition']) {
    assert.ok(k in parsed.visual_features, `visual_features.${k} is consumed and must remain`);
  }
  for (const k of ['raw_texts', 'logos_detected', 'labels_detected', 'has_readable_text']) {
    assert.ok(k in parsed.ocr_text, `ocr_text.${k} is consumed and must remain`);
  }
});

test('B-05 [DEFECT-5 RETIRED] the write-only Stage 1 output fields are gone', () => {
  // WAS: each appeared exactly twice — once in RECOGNITION_SCHEMA, once in the
  // prompt template — generated on the critical path of every scan and never
  // read. Stage 1 is output-token bound, so they cost wall-clock time per scan.
  // Removed in "perf(scan): trim unread Stage 1 output fields"; this assertion
  // is the inverse of its original form and now guards against reintroduction.
  const writeOnly = ['size_estimate', 'distinctive_elements', 'wear_level',
                     'needs_more_info', 'serial_numbers'];
  for (const f of writeOnly) {
    const hits = ANALYZE_SRC.split(f).length - 1;
    assert.equal(hits, 0, `${f} was removed as write-only; ${hits} occurrence(s) reintroduced`);
  }

  // labels_detected was on this list and LEFT it: the Stage 1 confidence clamp
  // now reads it as text evidence, so it earns its tokens and stays.
  assert.ok(ANALYZE_SRC.split('labels_detected').length - 1 > 2,
    'labels_detected is consumed by the model-confidence clamp and must remain');
});

test('B-06 [DEFECT-6] the JSON schemas are declared but never applied', () => {
  // Both schemas are exported and referenced by no executable code — no
  // validator, no structured-output request. Expected fix: they become
  // load-bearing (structured outputs would also remove the JSON-parse failure
  // class that currently routes to 503s and rescue pricing).
  //
  // Comments are stripped before counting: an earlier version of this test
  // counted raw substrings and flipped the moment a code comment MENTIONED a
  // schema by name, which is not the fact under test.
  const code = ANALYZE_SRC
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

  for (const name of ['RECOGNITION_SCHEMA', 'VERIFICATION_SCHEMA']) {
    const uses = code.split(name).length - 1;
    assert.equal(uses, 1, `${name} is declared once and never referenced by executable code; found ${uses}`);
  }
});


// ══════════════════════════════════════════════════════════════════════════════
// §C  SCAN-018 — weak OCR substrings must not become exact model evidence
//
// Production (GW-RC-PERF-003, scan "Ninja blender") proved the chain:
//   OCR token "duo"
//     -> match_products_by_ocr tier 1 (`p.model ILIKE '%duo%'`, 3+ chars, no
//        brand or category filter)
//     -> match_type = 'model_number'      (the SAME value a genuine
//        model_numbers equality produces; model_numbers is not in the RPC's
//        RETURNS TABLE, so the two are indistinguishable in JS)
//     -> _ocr_model_confirmed = true, similarity = 0.92
//     -> EVIDENCE_CLASS.MODEL_TEXT -> exact_match -> db_match_found
//     -> UI "DB MATCH - 6 found" for SodaStream rows on a NINJA scan.
//
// The defect had TWO entrances into MODEL_TEXT, and a fix that closed only the
// _ocr_model_confirmed one would not have worked: gradeRowEvidence graded the
// same row on ANY 3+ char token that was a substring of model/name/keywords/
// aliases, and classifyRowEvidence promotes `_evidence_grade && _source=ocr_*`
// to MODEL_TEXT independently. Both now route through the same specificity
// predicate.
// ══════════════════════════════════════════════════════════════════════════════

// The exact Production shapes.
const SODASTREAM_DUO = { brand: 'SodaStream', model: 'Duo', name: 'SodaStream Duo',
  keywords: [], aliases: [], match_type: 'model_number', _source: 'ocr_rpc' };
const SODASTREAM_DUO_WHITE = { brand: 'SodaStream', model: 'Duo White', name: 'SodaStream Duo White',
  keywords: [], aliases: [], match_type: 'model_number', _source: 'ocr_rpc' };
const LOGITECH_G502 = { brand: 'Logitech', model: 'G502', name: 'Logitech G502 Hero',
  keywords: [], aliases: [], match_type: 'model_number', _source: 'ocr_rpc' };

test('C-01 CASE 1: a plain OCR word matching a DIFFERENT brand is not evidence', () => {
  // Recognition said Ninja. "duo" hitting SodaStream's catalog is a dictionary
  // collision, not a reading of this product.
  assert.equal(gradeRowEvidence(SODASTREAM_DUO, ['duo'], ['duo'], 'ninja'), false);
  assert.equal(isSpecificTokenMatch(SODASTREAM_DUO, 'duo', 'ninja'), false);

  // ...and it therefore cannot reach MODEL_TEXT by EITHER entrance.
  const row = { ...SODASTREAM_DUO, _ocr_model_confirmed: false, _evidence_grade: false };
  assert.equal(classifyRowEvidence(row), EVIDENCE_CLASS.WEAK);

  // ...so retrieval reports NO model evidence, which is what db_match_found and
  // the fast path's `exact_match` gate both read.
  const ranked = rankCandidates([row]);
  assert.equal(ranked.exactMatch, false);
  assert.ok(ranked.topClass < EVIDENCE_CLASS.MODEL_TEXT);
});

test('C-02 CASE 2: an exact model-number read stays strong evidence', () => {
  // The whole point of the tier. This must survive the fix untouched.
  assert.equal(gradeRowEvidence(LOGITECH_G502, ['g502'], ['g502'], 'logitech'), true);

  const row = { ...LOGITECH_G502, _ocr_model_confirmed: true, _evidence_grade: true };
  assert.equal(classifyRowEvidence(row), EVIDENCE_CLASS.MODEL_TEXT);
  assert.equal(rankCandidates([row]).exactMatch, true);
});

test('C-03 CASE 2b: a model-shaped token outranks a WRONG Stage 1 brand', () => {
  // Production shows Stage 1 can read a label correctly and still name the
  // wrong brand/category. An alphanumeric code identifies a product on its
  // own, so it must NOT be discarded because the brand guess disagrees --
  // this is why the guard is brand-gated only for plain words.
  assert.equal(gradeRowEvidence(LOGITECH_G502, ['g502'], ['g502'], 'razer'), true);
  assert.equal(isSpecificTokenMatch(LOGITECH_G502, 'g502', 'razer'), true);
});

test('C-04 CASE 3: a plain word within the RIGHT brand stays evidence', () => {
  // No false negatives for genuine siblings: "duo" in SodaStream's own catalog
  // when the item WAS recognised as a SodaStream is real signal.
  assert.equal(gradeRowEvidence(SODASTREAM_DUO, ['duo'], ['duo'], 'sodastream'), true);
  assert.equal(gradeRowEvidence(SODASTREAM_DUO_WHITE, ['duo'], ['duo'], 'sodastream'), true);
});

test('C-05 CASE 4: with no recognised brand, a plain word must BE the model', () => {
  // Neither constraint is available, so the conservative fallback applies:
  // the token has to be the whole model string, not a fragment of it.
  assert.equal(isSpecificTokenMatch(SODASTREAM_DUO, 'duo', null), true);
  assert.equal(isSpecificTokenMatch(SODASTREAM_DUO_WHITE, 'duo', null), false);
  assert.equal(gradeRowEvidence(SODASTREAM_DUO_WHITE, ['duo'], ['duo'], null), false);

  assert.equal(brandCompatible('SodaStream', null), null, 'unknown brand must report unknown, not false');
  assert.equal(brandCompatible('', 'ninja'), null);
});

test('C-06 CASE 5: the model_numbers-equality INFERENCE is brand-gated', () => {
  // This branch fires when a tier-1 hit is not explained by any visible field,
  // and attributes it to the model_numbers array -- a column the RPC does not
  // return. It is an inference, so a brand contradiction refuses it.
  const ev = ['sf301'], kw = ['sf301'];   // model-shaped, matches no field here
  assert.equal(gradeRowEvidence(SODASTREAM_DUO, ev, kw, null), true,
    'legacy behaviour with no brand known is preserved');
  assert.equal(gradeRowEvidence(SODASTREAM_DUO, ev, kw, 'ninja'), false,
    'a brand-contradicting inferred equality is not evidence');
  assert.equal(gradeRowEvidence(SODASTREAM_DUO, ev, kw, 'sodastream'), true);
});

test('C-07 CASE 6: _ocr_model_confirmed is no longer the raw RPC tier', () => {
  // Source-level pin. `match_type === 'model_number'` alone must never again be
  // assigned straight to the flag: every downstream consumer
  // (calibrateVerification RULE 6 + corroboration, preQuoteFromCatalog's MEDIUM
  // grade, classifyRowEvidence) trusts it as "model text was READ".
  const code = ANALYZE_SRC
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.ok(!/_ocr_model_confirmed:\s*r\.match_type === 'model_number'\s*,/.test(code),
    'the raw-tier assignment is back; the substring/equality conflation is unguarded again');
  assert.ok(/_ocr_model_confirmed:\s*textConfirmed/.test(code));
  // ...and the demoted tier-1 row must not keep the 0.92 model-number weight.
  assert.ok(/OCR_MATCH_SIM\.ocr_keyword/.test(code));
});
