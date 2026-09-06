// ══════════════════════════════════════════════════════════════════════════════
// SCAN-022 — the evidence-gated Stage 2 fast path.
//
// Stage 2 costs ~19.7s in production (commit 0250e80). This gate skips it when
// independent evidence has already settled the identity — and a gate that fires
// when it should not is indistinguishable from the confident-wrong-answer bug
// SCAN-015/016/017 removed. So the disqualifying cases below matter more than
// the qualifying ones, and there are deliberately more of them.
//
// The central structural property: evaluateFastPath runs BEFORE verifyAndPrice,
// so `verification` does not exist when the gate is evaluated. Self-declared
// fields (brand_confidence, identification_method, match_confidence) are not
// merely ignored — they are unreachable. FP-20 pins that.
//
//   node --test tests/fast-path.test.mjs
// ══════════════════════════════════════════════════════════════════════════════
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Env-driven like every other target in this repo: the mutation check swaps in
// a deliberately broken copy, and a hard-coded import would test the pristine
// original while reporting on the mutant — a harness that always says PASS
// proves nothing.
const ANALYZE_URL = process.env.SCAN022_ANALYZE_PATH
  ? pathToFileURL(process.env.SCAN022_ANALYZE_PATH)
  : new URL('../api/analyze.js', import.meta.url);
const { evaluateFastPath, buildFastPathVerification, EVIDENCE_CLASS } = await import(ANALYZE_URL.href);
const SRC = readFileSync(ANALYZE_URL, 'utf8');

// ── Fixtures: the decisive case, which each test then degrades in ONE way ────
const IR = (o = {}) => ({
  level: 'exact', brand: 'Logitech', brand_confidence: 0.9,
  model: 'G502', model_confidence: 0.9, family: null,
  exact_model_ambiguous: false, ambiguous_between: [], text_confirmed: true, ...o,
});
const REC = (o = {}) => ({
  category: 'Electronics', subcategory: 'mouse', category_confidence: 0.85,
  ocr_text: { has_readable_text: true, raw_texts: ['Logitech G502'], labels_detected: [], logos_detected: [] },
  visual_features: { condition: 'Good' },
  brand_candidates: [{ brand: 'Logitech', confidence: 0.9, evidence: 'readable_text' }],
  model_candidates: [{ model: 'G502', confidence: 0.9, evidence: 'readable_text' }],
  identity_resolution: IR(), ...o,
});
const ROW = (o = {}) => ({
  id: 'r1', brand: 'Logitech', model: 'G502', name: 'Logitech G502',
  category: 'Electronics', subcategory: 'mouse',
  avg_used_price_ils: 300, price_low_ils: 250, price_high_ils: 350,
  similarity: 0.92, _evidence_class: EVIDENCE_CLASS.EXACT_MODEL,
  _evidence_grade: true, _ocr_model_confirmed: true, ...o,
});
const EV = (o = {}) => ({
  exact_match: true, top_class: EVIDENCE_CLASS.EXACT_MODEL,
  ambiguous: false, ambiguous_between: [], ...o,
});
const NO_TEXT = { has_readable_text: false, raw_texts: [], labels_detected: [], logos_detected: [] };
const decisive = (o = {}) => ({ recognition: REC(), candidates: [ROW()], retrievalEvidence: EV(), ...o });

// ══════════════════════════════════════════════════════════════════════════════
// QUALIFYING — the fast path MUST fire
// ══════════════════════════════════════════════════════════════════════════════

test('FP-01 exact model + OCR/model-text corroboration + priced exact anchor', () => {
  const r = evaluateFastPath(decisive());
  assert.equal(r.eligible, true);
  assert.equal(r.corroboration, 'stage1_ocr');
  assert.equal(r.anchor.id, 'r1');
  assert.ok(r.quote.price_estimate_mid > 0);
});

test('FP-02 exact model + independent Vision corroboration + priced exact anchor', () => {
  // Stage 1 read no text; Google Vision's separate pass supplies the evidence.
  const r = evaluateFastPath(decisive({
    recognition: REC({ ocr_text: NO_TEXT, identity_resolution: IR({ text_confirmed: false }) }),
    visionData: { text: ['G502'], logos: [{ description: 'Logitech' }] },
  }));
  assert.equal(r.eligible, true);
  assert.equal(r.corroboration, 'google_vision');
});

test('FP-03 user correction + exact compatible catalog anchor', () => {
  // The user naming the item is external evidence, so it qualifies even though
  // identity_resolution was computed BEFORE the correction was injected and
  // still says 'family'. The anchor is still required — the correction alone
  // does not license catalog pricing.
  const r = evaluateFastPath(decisive({
    recognition: REC({
      _user_correction: 'Logitech G502', ocr_text: NO_TEXT,
      model_candidates: [{ model: 'G502', confidence: 0.96, evidence: 'user_correction' }],
      identity_resolution: IR({ level: 'family', model: null, text_confirmed: false }),
    }),
  }));
  assert.equal(r.eligible, true);
  assert.equal(r.corroboration, 'user_correction');
});

// ══════════════════════════════════════════════════════════════════════════════
// DISQUALIFYING — the fast path MUST NOT fire
// ══════════════════════════════════════════════════════════════════════════════

test('FP-04 sibling-only match does not qualify', () => {
  const r = evaluateFastPath(decisive({
    candidates: [ROW({ model: 'G502 X Plus', _evidence_class: EVIDENCE_CLASS.CATALOG_FUZZY, _evidence_grade: false, _ocr_model_confirmed: false, similarity: 0.85 })],
    retrievalEvidence: EV({ exact_match: false, top_class: EVIDENCE_CLASS.CATALOG_FUZZY }),
  }));
  assert.equal(r.eligible, false);
  assert.equal(r.reason, 'retrieval_lacks_model_evidence');
});

test('FP-05 semantic/vector-only match does not qualify at any cosine', () => {
  // 0.97 cosine is still resemblance, not evidence.
  const r = evaluateFastPath(decisive({
    candidates: [ROW({ _evidence_class: EVIDENCE_CLASS.SEMANTIC, _evidence_grade: false, _ocr_model_confirmed: false, similarity: 0.97 })],
    retrievalEvidence: EV({ exact_match: false, top_class: EVIDENCE_CLASS.SEMANTIC }),
  }));
  assert.equal(r.eligible, false);
});

test('FP-06 high visual confidence with no text or catalog corroboration', () => {
  // Requirement 6 stated directly: visual confidence alone never qualifies,
  // however high it climbs.
  const r = evaluateFastPath(decisive({
    recognition: REC({ ocr_text: NO_TEXT, identity_resolution: IR({ brand_confidence: 0.99, model_confidence: 0.99, text_confirmed: false }) }),
  }));
  assert.equal(r.eligible, false);
  assert.equal(r.reason, 'no_independent_corroboration');
});

test('FP-07 a family identity never qualifies', () => {
  const r = evaluateFastPath(decisive({ recognition: REC({ identity_resolution: IR({ level: 'family', model: null }) }) }));
  assert.equal(r.eligible, false);
  assert.equal(r.reason, 'identity_level_not_exact');
});

test('FP-08 a brand-only identity never qualifies', () => {
  const r = evaluateFastPath(decisive({ recognition: REC({ identity_resolution: IR({ level: 'brand', model: null }) }) }));
  assert.equal(r.eligible, false);
});

test('FP-09 an unknown identity never qualifies', () => {
  const r = evaluateFastPath(decisive({ recognition: REC({ identity_resolution: IR({ level: 'unknown', brand: null, model: null }) }) }));
  assert.equal(r.eligible, false);
});

test('FP-10 an ambiguous sibling tie disqualifies', () => {
  const both = [
    IR({ exact_model_ambiguous: true }),
    IR({ ambiguous_between: ['G502', 'G903'] }),
  ];
  for (const ir of both) {
    const r = evaluateFastPath(decisive({ recognition: REC({ identity_resolution: ir }) }));
    assert.equal(r.eligible, false);
    assert.equal(r.reason, 'identity_ambiguous');
  }
});

test('FP-11 retrieval ambiguity disqualifies even when the identity looks exact', () => {
  const r = evaluateFastPath(decisive({
    retrievalEvidence: EV({ ambiguous: true, ambiguous_between: ['Logitech G502', 'Logitech G502 X Plus'] }),
  }));
  assert.equal(r.eligible, false);
  assert.equal(r.reason, 'retrieval_ambiguous');
});

test('FP-12 a DB-missing product never qualifies', () => {
  // Nothing in the catalog is this item. It must reach Stage 2 and then the
  // candidate-submission path — never be priced as the nearest row.
  const r = evaluateFastPath(decisive({ candidates: [], retrievalEvidence: EV({ exact_match: false, top_class: 0 }) }));
  assert.equal(r.eligible, false);
});

test('FP-13 an exact identity with no usable price anchor does not qualify', () => {
  const r = evaluateFastPath(decisive({ candidates: [ROW({ avg_used_price_ils: 0 })] }));
  assert.equal(r.eligible, false);
  assert.equal(r.reason, 'no_compatible_priced_anchor');
});

test('FP-14 a same-brand/same-category anchor whose MODEL never matched is refused', () => {
  // isCompatibleAnchor returns ok:true with reason 'brand_category_sibling' for
  // these. Accepting `ok` alone would let sibling substitution back in through
  // the pricing door, so the gate requires verdict.modelMatched === true.
  const r = evaluateFastPath(decisive({ candidates: [ROW({ model: 'G900', name: 'Logitech G900' })] }));
  assert.equal(r.eligible, false);
  assert.equal(r.reason, 'no_compatible_priced_anchor');
});

test('FP-14b a brand_category_sibling anchor is refused — the load-bearing case', () => {
  // FP-14 above does NOT actually exercise the modelMatched requirement:
  // isCompatibleAnchor's own R0 rule already rejects a G900 row for a G502
  // identity, so the gate's extra check is redundant there. A mutation run
  // proved it — dropping `&& verdict.modelMatched === true` kept all tests green.
  //
  // R0 is SKIPPED when the identity's model is not "usable" (too short and not
  // model-shaped), and that is where isCompatibleAnchor returns
  // ok:true / reason:'brand_category_sibling' / modelMatched:false.
  //
  // Concretely: a shoe whose visible text reads "S" is brand+category
  // compatible with "Nike Air Max 90" but is NOT that product. Accepting `ok`
  // alone would price the user's item as an Air Max 90. This test is the reason
  // the gate demands the stronger verdict.
  const rec = {
    category: 'Clothing', subcategory: 'shoes',
    ocr_text: { has_readable_text: true, raw_texts: ['Nike S'], labels_detected: [], logos_detected: [] },
    visual_features: { condition: 'Good' },
    brand_candidates: [{ brand: 'Nike', confidence: 0.9, evidence: 'readable_text' }],
    model_candidates: [{ model: 'S', confidence: 0.9, evidence: 'readable_text' }],
    identity_resolution: {
      level: 'exact', brand: 'Nike', brand_confidence: 0.9, model: 'S', model_confidence: 0.9,
      exact_model_ambiguous: false, ambiguous_between: [], text_confirmed: true,
    },
  };
  const sibling = {
    id: 'r9', brand: 'Nike', model: 'Air Max 90', name: 'Nike Air Max 90',
    category: 'Clothing', subcategory: 'shoes',
    avg_used_price_ils: 400, price_low_ils: 350, price_high_ils: 450, similarity: 0.92,
    _evidence_class: EVIDENCE_CLASS.EXACT_MODEL, _evidence_grade: true, _ocr_model_confirmed: true,
  };
  const r = evaluateFastPath({ recognition: rec, candidates: [sibling], retrievalEvidence: EV() });
  assert.equal(r.eligible, false, 'a brand/category sibling must never anchor the fast path');
  assert.equal(r.reason, 'no_compatible_priced_anchor');
});

test('FP-15 retrieval evidence below MODEL_TEXT disqualifies', () => {
  for (const klass of [EVIDENCE_CLASS.CATALOG_FUZZY, EVIDENCE_CLASS.SEMANTIC, EVIDENCE_CLASS.WEAK]) {
    const r = evaluateFastPath(decisive({ retrievalEvidence: EV({ top_class: klass }) }));
    assert.equal(r.eligible, false, `top_class ${klass} must not qualify`);
  }
});

test('FP-16 missing retrieval evidence disqualifies (fails closed)', () => {
  // A retrieval timeout yields null. Absence of evidence is not evidence.
  const r = evaluateFastPath(decisive({ retrievalEvidence: null }));
  assert.equal(r.eligible, false);
  assert.equal(r.reason, 'no_retrieval_evidence');
});

test('FP-17 a brand-only user correction does not qualify', () => {
  // The correction must NAME A MODEL; naming only the brand leaves the exact
  // identity unresolved.
  const r = evaluateFastPath(decisive({
    recognition: REC({
      _user_correction: 'Logitech', ocr_text: NO_TEXT,
      model_candidates: [{ model: 'unidentified', confidence: 0.96, evidence: 'user_correction' }],
      identity_resolution: IR({ level: 'family', model: null, text_confirmed: false }),
    }),
  }));
  assert.equal(r.eligible, false);
});

test('FP-18 a recognition with no identity_resolution fails closed', () => {
  // A pre-SCAN-015 shape, or a calibration bug, must not open the fast path.
  const r = evaluateFastPath({ recognition: { category: 'Electronics' }, candidates: [ROW()], retrievalEvidence: EV() });
  assert.equal(r.eligible, false);
  assert.equal(r.reason, 'no_identity_resolution');
});

test('FP-19 an empty context fails closed rather than throwing', () => {
  const r = evaluateFastPath({});
  assert.equal(r.eligible, false);
});

// ══════════════════════════════════════════════════════════════════════════════
// SELF-DECLARATION — structurally unreachable
// ══════════════════════════════════════════════════════════════════════════════

test('FP-20 self-declared Stage 2 fields cannot influence the gate', () => {
  // The gate is evaluated BEFORE verifyAndPrice, so these fields do not exist
  // yet. Passing them anyway must change nothing — neither to qualify an
  // otherwise-failing scan, nor to alter a qualifying one.
  const selfDeclared = {
    brand_confidence: 'confirmed_by_text',
    identification_method: 'db_match',
    match_confidence: 0.99,
    final_brand: 'Logitech',
    final_model: 'G502',
  };

  // Cannot rescue a scan that lacks corroboration.
  const failing = decisive({
    recognition: REC({ ...selfDeclared, ocr_text: NO_TEXT, identity_resolution: IR({ text_confirmed: false }) }),
  });
  assert.equal(evaluateFastPath(failing).eligible, false,
    'a self-declared confirmed_by_text / db_matched must not qualify a scan');

  // And cannot change a scan that already qualifies on real evidence.
  const withClaims = evaluateFastPath(decisive({ recognition: REC(selfDeclared) }));
  const without = evaluateFastPath(decisive());
  assert.equal(withClaims.eligible, without.eligible);
  assert.equal(withClaims.corroboration, without.corroboration);
});

test('FP-21 the gate reads no verification-authored field', () => {
  // Structural: the gate's source must not mention Stage 2's self-declared
  // vocabulary at all. Enforced in source because a future edit could
  // reintroduce it in a way the behavioural tests above would not notice.
  const fn = SRC.slice(SRC.indexOf('export function evaluateFastPath'), SRC.indexOf('export function buildFastPathVerification'));
  const code = fn.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  const forbidden = ['verification', 'match_confidence', 'brand_confidence', 'identification_method'];
  for (const f of forbidden) {
    assert.equal(code.includes(f), false, `the fast-path gate must not read "${f}"`);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// OUTPUT — identity preservation and non-degraded status
// ══════════════════════════════════════════════════════════════════════════════

test('FP-22 the fast path does not change the recognised brand/model', () => {
  // The regression that matters most: qualifying on exact evidence and then
  // returning a DIFFERENT identity would be the sibling-substitution bug wearing
  // a performance optimisation as a disguise.
  const rec = REC();
  const fp = evaluateFastPath(decisive({ recognition: rec }));
  assert.equal(fp.eligible, true);
  const v = buildFastPathVerification(rec, fp, 'en');

  assert.equal(v.final_brand, rec.identity_resolution.brand);
  assert.equal(v.final_model, rec.identity_resolution.model);
  assert.equal(v.final_brand, 'Logitech');
  assert.equal(v.final_model, 'G502');
  // And it matches the anchor that qualified it.
  assert.equal(v.final_model, fp.anchor.model);
  assert.deepEqual(v.matched_product_ids, ['r1']);
});

test('FP-23 a differently-spelled anchor declines rather than guessing', () => {
  // KNOWN CONSERVATISM, pinned deliberately. isCompatibleAnchor matches the
  // model by normalizeModelKey substring, so a catalog row spelled "G-502"
  // does NOT match a recognised "G502" — the hyphen survives normalization.
  //
  // The fast path therefore declines and the full Stage 2 runs. That costs a
  // missed optimisation, never a wrong answer, which is the correct direction
  // for this gate to fail. Recorded here so the behaviour is a decision rather
  // than a surprise: raising the fast-path hit rate means improving catalog
  // model matching, NOT loosening this gate.
  const rec = REC();
  const fp = evaluateFastPath(decisive({ recognition: rec, candidates: [ROW({ model: 'G-502', name: 'Logitech G-502' })] }));
  assert.equal(fp.eligible, false);
  assert.equal(fp.reason, 'no_compatible_priced_anchor');
});

test('FP-23b when it DOES fire, the recognised identity ships, not the row\'s', () => {
  // The catalog row supplies PRICE. Identity comes from recognition, so a row
  // whose name differs cannot rename the user's item.
  const rec = REC();
  const fp = evaluateFastPath(decisive({
    recognition: rec,
    candidates: [ROW({ name: 'Logitech Gaming Mouse G502 Proteus Spectrum' })],
  }));
  assert.equal(fp.eligible, true);
  const v = buildFastPathVerification(rec, fp, 'en');
  assert.equal(v.final_brand, 'Logitech');
  assert.equal(v.final_model, 'G502', 'the recognised model, never the row name');
  assert.equal(v.full_name, 'Logitech G502');
});

test('FP-24 the fast-path result is priced from the catalog and not degraded', () => {
  const rec = REC();
  const v = buildFastPathVerification(rec, evaluateFastPath(decisive({ recognition: rec })), 'en');

  assert.equal(v.price_method, 'comp_based');
  assert.equal(v.price_estimate_mid, 300, 'the anchor row\'s used price, unmodified');
  assert.equal(v.price_estimate_low, 250);
  assert.equal(v.price_estimate_high, 350);
  assert.equal(v._pricing_meta.pre_source, 'catalog');
  // The rescue engine's failure wording must not leak into a success.
  assert.equal(v._pricing_meta.pricing_warning, null);
  assert.equal(/failed/i.test(v.confidence_reasoning), false,
    'a successful fast path must not describe itself as a failure');
  assert.equal(/failed/i.test(v._pricing_meta.pricing_reason), false);
});

test('FP-25 no arbitrary pricing arithmetic is invented', () => {
  // Prices come from the catalog row via preQuoteFromCatalog. Only its existing
  // documented 0.75/1.25 derivation applies when a row lacks an explicit band.
  const rec = REC();
  const fp = evaluateFastPath(decisive({ recognition: rec, candidates: [ROW({ price_low_ils: null, price_high_ils: null })] }));
  const v = buildFastPathVerification(rec, fp, 'en');
  assert.equal(v.price_estimate_mid, 300);
  assert.equal(v.price_estimate_low, Math.round(300 * 0.75));
  assert.equal(v.price_estimate_high, Math.round(300 * 1.25));
});

test('FP-26 the pipeline marks a fast path as success, never as fallback', () => {
  // stage2FallbackUsed drives result.stage2_timeout and the guard's 'pre'
  // stage; setting it for a SUCCESSFUL skip would render the result degraded.
  const region = SRC.slice(SRC.indexOf('SCAN-022: EVIDENCE-GATED FAST PATH'), SRC.indexOf('} else if (rem() - STAGE2_RESERVE_MS'));
  assert.match(region, /stage2Status = 'fast_path'/);
  assert.equal(/stage2FallbackUsed = true/.test(region), false,
    'the fast-path branch must not set stage2FallbackUsed');
  assert.equal(/stage2FallbackReason =/.test(region), false,
    'the fast-path branch must not set a fallback reason');
});

test('FP-27 the guard is not told a model ran when none did', () => {
  // guardCtx.model is persisted with the valuation. Recording MODEL_VISION for
  // a path that made no Anthropic call would put a fiction in the ledger.
  assert.match(SRC, /model: stage2Status === 'fast_path' \? null :/);
});

test('FP-28 fast-path provenance reaches the response', () => {
  assert.match(SRC, /result\.stage2_status = stage2Status;/);
  assert.match(SRC, /stage2_skipped: true/);
  // stage2_timeout is derived from stage2FallbackUsed, which the fast path
  // never sets — so it stays false without needing a special case.
  assert.match(SRC, /result\.stage2_timeout = stage2FallbackUsed && /);
});
