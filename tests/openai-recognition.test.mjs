// ══════════════════════════════════════════════════════════════════════════════
// GW-OPENAI-RECOGNITION-001 — experimental OpenAI recognition path.
//
// WHAT THIS FILE IS DEFENDING
// The prototype swaps ONE thing: which model answers "what object is this?".
// The danger is not that it answers badly — it is that a confident answer gets
// mistaken for a verified one somewhere downstream. So most of these tests are
// not about the adapter at all. They take a deliberately over-confident OpenAI
// hypothesis and push it through the REAL, UNMODIFIED trust layer
// (calibrateRecognition → rankCandidates/classifyRowEvidence →
// isCompatibleAnchor → validateQuote) to prove the answer is still made to
// earn its status from catalog rows rather than from its own confidence.
//
// Where a test drives the live functions, it imports them — never a copy.
// Where the behaviour lives in an unexported closure inside handleRequest, the
// test reads api/analyze.js as text and asserts on the wiring, which is the
// repo's established idiom for that seam (see tests/pipeline-timings.test.mjs).
//
// No network, no DB, no credentials. The adapter takes an injectable
// `fetchImpl`, so every HTTP path is exercised against a stub.
//
//   node --test tests/openai-recognition.test.mjs
// ══════════════════════════════════════════════════════════════════════════════
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ANALYZE_URL = new URL('../api/analyze.js', import.meta.url);
const ADAPTER_URL = new URL('../api/_lib/openai-recognition.js', import.meta.url);
const GUARD_URL   = new URL('../api/_lib/valuation-guard.js', import.meta.url);

const O = await import(ADAPTER_URL.href);
const A = await import(ANALYZE_URL.href);
const G = await import(GUARD_URL.href);

const {
  normalizeOpenAIRecognition, extractOpenAIJson, recognizeWithOpenAI,
  resolveRecognitionEngine, scrubKey, classifyOpenAIFailure, OPENAI_IDENTITY_SCHEMA,
  buildOpenAIRecognitionPrompt, RECOGNITION_ENGINE_CURRENT, RECOGNITION_ENGINE_OPENAI,
} = O;
const {
  calibrateRecognition, rankCandidates, classifyRowEvidence, EVIDENCE_CLASS,
  isCompatibleAnchor, assessFallbackIdentity, evaluateFastPath,
} = A;
const { validateQuote } = G;

const analyzeSrc = readFileSync(ANALYZE_URL, 'utf8');
const adapterSrc = readFileSync(ADAPTER_URL, 'utf8');
const contractSrc = readFileSync(new URL('../api/_lib/openai-recognition-contract.js', import.meta.url), 'utf8');
const normalizeSrc = readFileSync(new URL('../api/_lib/openai-recognition-normalize.js', import.meta.url), 'utf8');
// Every server-only module of this feature. Source-level assertions below name
// the specific file they mean; this list is for the checks that must hold
// across ALL of them (credentials, VITE_ leakage).
const ALL_MODULE_SRC = [['adapter', adapterSrc], ['contract', contractSrc], ['normalize', normalizeSrc]];

// A well-formed OpenAI payload. `over` lets each test bend one thing.
const payload = (over = {}) => ({
  object_type: 'gaming mouse',
  category: 'Electronics',
  subcategory: 'computer mouse',
  brand: 'Logitech',
  brand_confidence: 0.94,
  product_family: 'Logitech G-series gaming mouse',
  model: 'G502 Hero',
  model_number: null,
  model_confidence: 0.91,
  visible_text: [],
  logos: ['Logitech G'],
  visual_attributes: {
    materials: ['plastic'], colors: ['black'],
    finish: 'matte', shape: 'ergonomic', condition: 'Good',
  },
  identity_confidence: 0.93,
  needs_confirmation: false,
  ambiguity_reason: null,
  candidate_models: [],
  ...over,
});

const okResponse = (obj) => ({
  ok: true,
  status: 200,
  json: async () => ({
    id: 'resp_test',
    status: 'completed',
    output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(obj) }] }],
    usage: { input_tokens: 1400, output_tokens: 210 },
  }),
  text: async () => '',
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. A structured response maps onto the GetWorth recognition shape
// ─────────────────────────────────────────────────────────────────────────────

test('OAI-01 a structured response maps onto the shape the pipeline already consumes', () => {
  // Everything downstream reads the recognize() shape. If the adapter produced
  // anything else, the failure would surface deep in retrieval as a silent
  // empty result rather than as a mapping bug.
  const r = normalizeOpenAIRecognition(payload({
    visible_text: ['G502 HERO', 'Logitech'], model_number: 'G502',
  }));

  assert.equal(r.category, 'Electronics');
  assert.equal(r.subcategory, 'computer mouse');
  assert.equal(r.model_family, 'Logitech G-series gaming mouse');
  assert.equal(r.brand_candidates[0].brand, 'Logitech');
  assert.equal(r.model_candidates[0].model, 'G502 Hero');
  assert.deepEqual(r.ocr_text.raw_texts, ['G502 HERO', 'Logitech']);
  assert.deepEqual(r.ocr_text.labels_detected, ['G502']);
  assert.equal(r.ocr_text.has_readable_text, true);
  assert.equal(r.visual_features.condition, 'Good');
  assert.ok(r.embedding_text.includes('Logitech'));

  // The shape must survive the real calibrator untouched — that is the actual
  // integration contract, not the field list above.
  const c = calibrateRecognition(r);
  assert.equal(c.confidence_calibrated, true);
  assert.ok(c.identity_resolution, 'calibrateRecognition must be able to derive identity_resolution from it');
});

test('OAI-02 siblings become ranked model candidates and force the ambiguity flag', () => {
  const r = normalizeOpenAIRecognition(payload({
    model: null, model_confidence: 0.3, needs_confirmation: true,
    ambiguity_reason: 'no legible label; G502/G903/G703 share this silhouette',
    candidate_models: [
      { model: 'G502', confidence: 0.33 },
      { model: 'G903', confidence: 0.31 },
      { model: 'G703', confidence: 0.30 },
    ],
  }));
  assert.equal(r.exact_model_ambiguous, true);
  assert.deepEqual(r.model_candidates.map((m) => m.model), ['G502', 'G903', 'G703']);

  // The calibrator's own ambiguity inference must agree — an ambiguous scan
  // that resolved to `level: 'exact'` would hand a coin-flip to pricing.
  const c = calibrateRecognition(r);
  assert.equal(c.identity_resolution.level, 'family');
  assert.equal(c.identity_resolution.model, null, 'no exact model may be claimed from a tie');
});

test('OAI-03 duplicate and junk candidates cannot inflate apparent breadth', () => {
  const r = normalizeOpenAIRecognition(payload({
    model: 'G502', candidate_models: [
      { model: 'g502', confidence: 0.4 },   // same model, different case
      { model: '  ', confidence: 0.4 },     // whitespace
      { model: 'unknown', confidence: 0.4 },// placeholder
      { model: 'G903', confidence: 0.4 },
    ],
  }));
  assert.deepEqual(r.model_candidates.map((m) => m.model), ['G502', 'G903']);
});

// ─────────────────────────────────────────────────────────────────────────────
// 2 & 3. Absence stays absence
// ─────────────────────────────────────────────────────────────────────────────

test('OAI-04 a missing brand does not become a fabricated one', () => {
  for (const missing of [null, '', '   ', 'unknown', 'Unidentified', 'N/A', 'no brand', 'generic']) {
    const r = normalizeOpenAIRecognition(payload({ brand: missing, brand_confidence: 0.9 }));
    assert.deepEqual(r.brand_candidates, [],
      `brand ${JSON.stringify(missing)} must produce NO candidate — a placeholder brand is a search term retrieval would act on`);
  }
});

test('OAI-05 a missing model does not become a fabricated one', () => {
  for (const missing of [null, '', 'unknown', 'Unidentified', 'not visible']) {
    const r = normalizeOpenAIRecognition(payload({ model: missing, model_confidence: 0.95 }));
    assert.deepEqual(r.model_candidates, [], `model ${JSON.stringify(missing)} must produce NO candidate`);
  }
});

test('OAI-06 absent identity survives into the pipeline as absent, not as low confidence', () => {
  // assessFallbackIdentity is what PRE and the guard read. A placeholder brand
  // would set brandOk true and unlock anchor compatibility checks that should
  // never have been reachable.
  const r = calibrateRecognition(normalizeOpenAIRecognition(payload({
    brand: 'unknown', model: null, logos: [], identity_confidence: 0.88,
  })));
  const id = assessFallbackIdentity(r);
  assert.equal(id.brandOk, false);
  assert.equal(id.modelOk, false);
  assert.ok(id.identityConf <= 0.45, `brandless identity confidence must stay capped, got ${id.identityConf}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Confidence is not evidence
// ─────────────────────────────────────────────────────────────────────────────

test('OAI-07 has_readable_text is DERIVED, so the model cannot unlock its own ceiling', () => {
  // calibrateRecognition uses has_readable_text to decide whether a model
  // confidence above 0.70 was earned. If the adapter took the flag from the
  // model, a confident model could assert its way past the clamp. The flag is
  // computed from whether text was actually returned.
  const r = normalizeOpenAIRecognition(payload({ visible_text: [], has_readable_text: true }));
  assert.equal(r.ocr_text.has_readable_text, false);
  assert.equal('has_readable_text' in payload(), false, 'the model is not even asked for this field');
  assert.equal(/has_readable_text/.test(JSON.stringify(OPENAI_IDENTITY_SCHEMA)), false,
    'the schema must not offer the model a way to set the flag that gates its own confidence ceiling');
});

test('OAI-08 a 0.97-confidence silhouette guess is clamped to the silhouette ceiling', () => {
  const r = calibrateRecognition(normalizeOpenAIRecognition(payload({
    model: 'G502 Hero', model_confidence: 0.97, identity_confidence: 0.97,
    visible_text: [], logos: [],   // nothing was actually read
  })));
  assert.ok(r.model_candidates[0].confidence <= 0.70,
    `a shape-only identity must not exceed 0.70, got ${r.model_candidates[0].confidence}`);
  assert.equal(r.model_candidates[0]._clamp_reason, 'no_text_evidence');
  assert.notEqual(r.identity_resolution.level, 'exact', 'a clamped guess must not resolve as an exact identity');
});

test('OAI-08b REGRESSION a single junk glyph must not disable the silhouette clamp', () => {
  // Review finding C1, reproduced before the fix: `visible_text: ['·']` took a
  // 0.97 silhouette guess from clamped/`family` to unclamped/`exact`. The flag
  // was derived, but derived from an unvalidated array with a threshold of one
  // character — and a real photo almost always carries some incidental marking,
  // so the clamp would have been off on most scans.
  //
  // Both disjuncts must hold: `has_readable_text` AND `raw_texts.length` feed
  // calibrateRecognition's textConfirmed, so filtering only the flag would have
  // left the bypass open through raw_texts.
  for (const junk of ['·', 'x', '  .  ', '-', '|']) {
    const r = normalizeOpenAIRecognition(payload({
      model_confidence: 0.97, visible_text: [junk], logos: [],
    }));
    assert.equal(r.ocr_text.has_readable_text, false, `${JSON.stringify(junk)} is not readable text`);
    assert.deepEqual(r.ocr_text.raw_texts, [], 'junk must not reach raw_texts either');
    const c = calibrateRecognition(r);
    assert.ok(c.model_candidates[0].confidence <= 0.70,
      `${JSON.stringify(junk)} must not unlock the ceiling (got ${c.model_candidates[0].confidence})`);
    assert.equal(c.identity_resolution.text_confirmed, false);
  }
  // Two characters of real content is text, and must still count.
  const real = normalizeOpenAIRecognition(payload({ visible_text: ['G5'], logos: [] }));
  assert.equal(real.ocr_text.has_readable_text, true);
  // Hebrew must not be mistaken for junk.
  const hebrew = normalizeOpenAIRecognition(payload({ visible_text: ['מקלדת'], logos: [] }));
  assert.equal(hebrew.ocr_text.has_readable_text, true, 'Hebrew text is readable text');
  assert.deepEqual(hebrew.ocr_text.raw_texts, ['מקלדת']);
});

test('OAI-08c REGRESSION an uncorroborated model_number must not become a read label', () => {
  // Review finding C2 — a defect this adapter introduced. `labels_detected`
  // was a straight copy of the model-asserted `model_number`, placed into the
  // OCR evidence channel eleven lines after the adapter had already determined
  // the string does not appear in the text. Measured before the fix: it
  // unclamped a 0.97 guess to `level: 'exact'` AND satisfied the fast path's
  // 'stage1_ocr' corroboration gate, skipping Stage 2 and pricing off an anchor.
  const forged = normalizeOpenAIRecognition(payload({
    model: 'G502 Hero', model_confidence: 0.97, model_number: 'G903',
    visible_text: [], logos: [],
  }));
  assert.deepEqual(forged.ocr_text.labels_detected, [],
    'a model number nobody read is not a label');
  const c = calibrateRecognition(forged);
  assert.ok(c.model_candidates[0].confidence <= 0.70);
  assert.equal(c.identity_resolution.text_confirmed, false);

  // The fast path must stay shut: this is the gate that SKIPS Stage 2.
  const fp = evaluateFastPath({
    recognition: c,
    candidates: [{ id: 'x', brand: 'Logitech', model: 'G502 Hero', category: 'Electronics',
      subcategory: 'computer mouse', avg_used_price_ils: 300, similarity: 0.95 }],
    retrievalEvidence: { exact_match: true, top_class: EVIDENCE_CLASS.EXACT_MODEL },
    visionData: null,
  });
  assert.equal(fp.eligible, false, `fast path must not open on a self-asserted model number (reason=${fp.reason})`);

  // A model number that WAS read stays real evidence.
  const genuine = normalizeOpenAIRecognition(payload({
    model: 'G502 Hero', model_number: 'G502', visible_text: ['G502 HERO'],
  }));
  assert.deepEqual(genuine.ocr_text.labels_detected, ['G502']);
});

test('OAI-09 text the model actually read DOES earn the higher confidence', () => {
  // The clamp must not be indiscriminate — otherwise the prototype would be
  // strictly worse than the current engine on the scans that matter most.
  const r = calibrateRecognition(normalizeOpenAIRecognition(payload({
    model: 'G502 Hero', model_confidence: 0.92,
    visible_text: ['LOGITECH', 'G502 HERO'], model_number: 'G502',
  })));
  assert.equal(r.model_candidates[0].confidence, 0.92);
  assert.equal(r.model_candidates[0]._clamped_from, undefined);
});

test('OAI-10 corroboration is checked against the text, not accepted on assertion', () => {
  const lying = normalizeOpenAIRecognition(payload({ model: 'G903', visible_text: ['G502 HERO'] }));
  assert.equal(lying._openai.model_appears_in_returned_text, false,
    'a model naming G903 while the label reads G502 is not text-corroborated');
  assert.equal(lying.model_candidates[0].evidence, 'visual_match');

  const honest = normalizeOpenAIRecognition(payload({ model: 'G502 Hero', visible_text: ['G502 HERO'] }));
  assert.equal(honest._openai.model_appears_in_returned_text, true);
  assert.equal(honest.model_candidates[0].evidence, 'model_number_text');

  // The telemetry field must not CLAIM verification it cannot perform. The
  // model authors both the identity and the text, so an echo makes this a
  // tautology; the name has to say only what it measures (recognition review).
  assert.equal('model_text_corroborated' in honest._openai, false,
    'the old name asserted corroboration that had not happened');
});

test('OAI-10b REGRESSION corroboration needs a token match, not a substring', () => {
  // Review finding H1, HIGH. Bare `haystack.includes(claim)` stamped every one
  // of these `model_number_text` / level `exact` / 0.93 — the LESS specific
  // claim confirmed by the MORE specific label, so a base variant was
  // text-confirmed by a Pro Max sticker. Same class as the retrieval-layer fix
  // in 7d9aa69 (isSpecificTokenMatch), reopened one layer upstream.
  for (const [model, text] of [
    ['iPhone 15', ['iPhone 15 Pro Max']],
    ['MX', ['MX MASTER 3S']],
    ['XM4', ['WH-1000XM4']],
    ['G5', ['G502 HERO']],
  ]) {
    const r = normalizeOpenAIRecognition(payload({ model, visible_text: text, logos: [] }));
    assert.equal(r._openai.model_appears_in_returned_text, false,
      `"${model}" must not be corroborated by "${text[0]}" — it names a different variant`);
    assert.equal(r.model_candidates[0].evidence, 'visual_match');
  }
  // The claim that actually accounts for the label still corroborates.
  const exact = normalizeOpenAIRecognition(payload({ model: 'G502 Hero', visible_text: ['G502 HERO'], logos: [] }));
  assert.equal(exact._openai.model_appears_in_returned_text, true);
  // Brand tokens in the label do not block a model match.
  const withBrand = normalizeOpenAIRecognition(payload({
    brand: 'Logitech', model: 'G502 Hero', visible_text: ['Logitech G502 Hero'], logos: [],
  }));
  assert.equal(withBrand._openai.model_appears_in_returned_text, true);
  // And a one-letter brand is not "read" out of a longer word.
  const tinyBrand = normalizeOpenAIRecognition(payload({ brand: 'a', model: null, visible_text: ['abcdefg'], logos: [] }));
  assert.equal(tinyBrand._openai.brand_appears_in_returned_text, false);
});

test('OAI-10c REGRESSION corroboration must hold in BOTH directions', () => {
  // H1 fixed one direction; the reviewer then showed the fix leaked the other
  // way, which is the LIKELIER real shape: a moulding reads "G502", the model
  // reads it correctly, then names the ₪480 "G502 X Plus" and gets it stamped
  // text-confirmed. Same 2.8x harm as the undersell case, opposite operands.
  const claim = (model, visible_text) => normalizeOpenAIRecognition(payload({
    model, visible_text, logos: [], model_confidence: 0.96,
  }))._openai.model_appears_in_returned_text;

  // CLAIM MORE SPECIFIC THAN TEXT — unread specificity, must not corroborate.
  assert.equal(claim('G502 X Plus', ['G502']), false);
  assert.equal(claim('iPhone 15 Pro Max', ['iPhone']), false);
  assert.equal(claim('WH-1000XM5', ['WH']), false);
  // CLAIM LESS SPECIFIC THAN TEXT — unexplained variant tokens, must not either.
  assert.equal(claim('G5', ['G502 HERO']), false);
  assert.equal(claim('iPhone 15', ['iPhone 15 Pro Max']), false);

  // Real label shapes must STILL corroborate, or the check is useless in
  // production — a label line carries the model plus boilerplate.
  assert.equal(claim('G502 Hero', ['G502 HERO']), true);
  assert.equal(claim('G502 Hero', ['Logitech G502 Hero']), true, 'brand tokens are discounted');
  assert.equal(claim('G502 Hero', ['G502', 'HERO']), true, 'model split across entries');
  assert.equal(claim('G502 Hero', ['MODEL G502 HERO CE FCC']), true, 'regulatory boilerplate');
  assert.equal(claim('WH-1000XM5', ['MODEL WH-1000XM5 5V 1.5A MADE IN CHINA']), true, 'electrical ratings');
  assert.equal(claim('G502 Hero', ['G502 HERO SN12345678']), true, 'appended serial');

  // KNOWN, ACCEPTED false negative. Category nouns are NOT in the noise list
  // because "Magic Mouse" is a model name, so box copy under-corroborates.
  // Deliberate: a false positive prices the wrong product, a false negative
  // only costs 0.96 -> 0.70. If this ever flips to true, the noise list has
  // grown into variant-suffix territory and the undersell case is back.
  assert.equal(claim('G502 Hero', ['Logitech G502 HERO Gaming Mouse']), false,
    'conservative miss — see the asymmetry note in the adapter');

  // The variant suffixes must never be treated as noise on either side.
  const noiseStart = normalizeSrc.indexOf('const LABEL_NOISE');
  const noiseEnd = normalizeSrc.indexOf('const isRating');
  assert.ok(noiseStart > -1 && noiseEnd > noiseStart,
    'LABEL_NOISE not located — a bad slice would make the loop below pass vacuously');
  const adapterNoise = normalizeSrc.slice(noiseStart, noiseEnd);
  for (const variantToken of ['pro', 'max', 'plus', 'mini', 'lite', 'ultra', 'air', 'wireless', 'gaming', 'mouse']) {
    assert.equal(new RegExp(`'${variantToken}'`).test(adapterNoise), false,
      `'${variantToken}' distinguishes siblings and must not be filtered as label noise`);
  }
});

test('OAI-11 identity_confidence reaches telemetry only — nothing branches on it', () => {
  const r = normalizeOpenAIRecognition(payload({ identity_confidence: 0.99 }));
  assert.equal(r._openai.identity_confidence, 0.99);

  // Stronger than "only read in the debug block": after the architecture
  // review, api/analyze.js does not touch the private `_openai` namespace at
  // ALL. The only reader is the adapter's own telemetry shaper, so there is no
  // site in the pipeline where a decision could be taken on model confidence,
  // and no silent `?? null` coupling to rot when a field is renamed.
  // Property access specifically — `stage1_openai` is a timing span name, not
  // a namespace read.
  assert.equal(/\._openai\b/.test(analyzeSrc), false,
    'api/analyze.js must not reach into the adapter private namespace');
  assert.match(adapterSrc, /recognition\?\._openai/, 'the shaper is the single reader');

  // And the value genuinely reaches telemetry, so this is not vacuous.
  const t = O.buildOpenAITelemetry({ requested: 'openai', used: 'openai', recognition: r, meta: null });
  assert.equal(t.identity_confidence, 0.99);
});

test('OAI-12 confidences are clamped into range whatever the model emits', () => {
  const r = normalizeOpenAIRecognition(payload({
    brand_confidence: 7, model_confidence: -3, identity_confidence: 'high',
  }));
  assert.equal(r.brand_candidates[0].confidence, 1);
  assert.equal(r.model_candidates[0].confidence, 0);
  assert.equal(r.category_confidence, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// 5 & 6. Retrieval still decides identity; a suggested sibling cannot anchor
// ─────────────────────────────────────────────────────────────────────────────

test('OAI-13 retrieval evidence classification is unchanged by the engine', () => {
  // The catalog row, not the recogniser, decides what class of evidence exists.
  const r = calibrateRecognition(normalizeOpenAIRecognition(payload({
    model: 'G502 Hero', model_confidence: 0.96, visible_text: ['G502 HERO'],
  })));
  const ctx = { queryModel: r.model_candidates[0].model, brandHead: 'logitech' };

  // classifyRowEvidence returns the numeric class directly.
  const exact = classifyRowEvidence({ id: 'a', brand: 'Logitech', model: 'G502 Hero', similarity: 0.7, _source: 'vector' }, ctx);
  const sibling = classifyRowEvidence({ id: 'b', brand: 'Logitech', model: 'G903', similarity: 0.99, _source: 'vector' }, ctx);
  assert.equal(exact, EVIDENCE_CLASS.EXACT_MODEL,
    'the row whose model string IS the queried model is exact evidence — decided by the row, not the recogniser');
  assert.equal(sibling, EVIDENCE_CLASS.SEMANTIC,
    'a different model reached by vector similarity stays semantic, however similar and however confident OpenAI was');
});

test('OAI-14 a high-similarity sibling cannot outrank the true row because OpenAI was confident', () => {
  const ranked = rankCandidates([
    { id: 'sibling', brand: 'Logitech', model: 'G903', similarity: 0.99, _source: 'vector' },
    { id: 'truth',   brand: 'Logitech', model: 'G502 Hero', similarity: 0.61, _source: 'normalized_model' },
  ], { queryModel: 'G502 Hero', brandHead: 'logitech' });

  assert.equal(ranked.rows[0].id, 'truth', 'evidence class must beat raw similarity');
  assert.equal(ranked.exactMatch, true);
});

test('OAI-15 an OpenAI-suggested sibling is rejected as a pricing anchor', () => {
  // The core Phase-8 protection: OpenAI proposing "G903" must not let a G903
  // catalog row become the price of the G502 in the photo.
  const r = calibrateRecognition(normalizeOpenAIRecognition(payload({
    model: 'G502 Hero', model_confidence: 0.95, visible_text: ['G502 HERO'],
  })));
  const identity = assessFallbackIdentity(r);
  assert.equal(identity.modelOk, true);

  const sibling = {
    id: 'sib', brand: 'Logitech', model: 'G903', name: 'Logitech G903 Wireless',
    category: 'Electronics', subcategory: 'computer mouse', avg_used_price_ils: 340,
  };
  assert.equal(isCompatibleAnchor(sibling, identity, r)?.ok, false,
    'a sibling model must not pass the anchor compatibility gate');

  const real = { ...sibling, id: 'real', model: 'G502 Hero', name: 'Logitech G502 Hero' };
  assert.equal(isCompatibleAnchor(real, identity, r)?.ok, true,
    'the genuinely matching row must still anchor — the gate must reject siblings, not everything');
});

test('OAI-16 the fast path will not fire on an uncorroborated OpenAI identity', () => {
  // The fast path SKIPS Stage 2 and prices straight off a catalog anchor. An
  // OpenAI hypothesis with no text behind it must not be allowed to trigger it.
  const r = calibrateRecognition(normalizeOpenAIRecognition(payload({
    model: 'G502 Hero', model_confidence: 0.98, identity_confidence: 0.98,
    visible_text: [], logos: [],
  })));
  const fp = evaluateFastPath({
    recognition: r,
    candidates: [{ id: 'x', brand: 'Logitech', model: 'G502 Hero', category: 'Electronics',
      subcategory: 'computer mouse', avg_used_price_ils: 300, similarity: 0.95 }],
    retrievalEvidence: { exact_match: true, top_class: EVIDENCE_CLASS.EXACT_MODEL },
    visionData: null,
  });
  assert.equal(fp.eligible, false, `fast path must stay closed without real corroboration (reason=${fp.reason})`);
});

test('OAI-16b REGRESSION every envelope category is reachable through the strict enum', () => {
  // Valuation review F2, CRITICAL. The current engine types `category` as a
  // free-form string, so Sonnet can return "Jewelry" and resolveEnvelopeKey
  // selects the jewelry envelope. A strict enum is a HARD constraint, so any
  // category missing from it is coerced to 'Other', matches no matcher, and
  // falls through to GLOBAL_ENVELOPE — hard_max 500000 instead of jewelry's
  // 2000, and the manual_only grade-down and needs_review are lost with it.
  //
  // Measured before the fix on one ₪18,000 Cartier gold band:
  //   current : jewelry/manual_only → degrade → ₪0/0/0 MANUAL_REQUIRED
  //   openai  : global/global       → accept  → ₪18,000 at MEDIUM
  const enumCats = OPENAI_IDENTITY_SCHEMA.properties.category.enum;
  for (const needed of ['Bags', 'Jewelry']) {
    assert.ok(enumCats.includes(needed),
      `${needed} is an envelope category in valuation-guard and MUST be emittable`);
  }

  // Behavioural, not just a list check: the high-risk envelope must actually
  // be selected and must actually refuse the price.
  const jewel = calibrateRecognition(normalizeOpenAIRecognition(payload({
    category: 'Jewelry', subcategory: 'gold band', object_type: 'ring',
    brand: 'Cartier', model: null, model_number: null,
    visible_text: [], logos: [], candidate_models: [],
  })));
  assert.equal(jewel.category, 'Jewelry', 'Jewelry must survive normalization, not coerce to Other');
  const verdict = validateQuote(
    { low: 12000, mid: 18000, high: 24000, currency: 'ILS', price_method: 'ai_estimate' },
    { stage: 'stage2', identity: assessFallbackIdentity(jewel), recognition: jewel, anchor: null },
  );
  assert.equal(verdict.metadata.envelope_key, 'jewelry',
    `expected the jewelry envelope, got ${verdict.metadata.envelope_key}`);
  assert.equal(verdict.metadata.degraded, true, 'jewelry is a manual_only bucket and must not self-price');
  assert.deepEqual(verdict.prices, { low: 0, mid: 0, high: 0 });
});

test('OAI-16c REGRESSION runner-up brands arm forensics WITHOUT becoming the identity', () => {
  // Two opposing requirements, and the fix for the first opened the second.
  //
  // (1) Architecture review: brand_candidates was capped at 1 while
  //     needsAuthenticityForensics scans EVERY candidate, so a luxury
  //     runner-up no longer triggered counterfeit forensics.
  // (2) Valuation review, CRITICAL, caused by the fix for (1): runner-ups went
  //     through the same push as the primary, so a null brand let a SPECULATIVE
  //     runner-up land at brand_candidates[0] — the one slot
  //     assessFallbackIdentity and resolveEnvelopeKey read as THE brand.
  //
  // NOTE ON THE FIXTURE. An earlier version of this test used
  // category 'Watches' and passed for the wrong reason: needsAuthenticityForensics
  // returns true on its FIRST line for /watch|jewel|bag|handbag|sneak|collectib/
  // before brand_candidates is read at all, so deleting the whole feature left
  // the test green. 'Clothing' / 'leather belt' matches none of those, which is
  // what makes the assertion load-bearing — and the negative control below is
  // what proves it can fail.
  const belt = (over) => normalizeOpenAIRecognition(payload({
    category: 'Clothing', subcategory: 'leather belt', object_type: 'belt',
    brand: null, brand_confidence: 0, model: null, model_number: null,
    visible_text: [], logos: [], candidate_models: [], ...over,
  }));

  const withRunnerUp = belt({ candidate_brands: [{ brand: 'Rolex', confidence: 0.4 }] });
  assert.equal(A.needsAuthenticityForensics(withRunnerUp), true,
    'a luxury runner-up must arm counterfeit forensics');
  // NEGATIVE CONTROL — without this the test above can never fail.
  assert.equal(A.needsAuthenticityForensics(belt({ candidate_brands: [] })), false,
    'this fixture must not trigger forensics by category, or the assertion above proves nothing');

  // (2) The speculative brand must NOT become the identity.
  assert.equal(withRunnerUp.brand_candidates[0].brand, 'unidentified');
  assert.equal(withRunnerUp.brand_candidates[0].confidence, 0);
  assert.equal(assessFallbackIdentity(calibrateRecognition(withRunnerUp)).brandOk, false,
    'a 0.25 guess the model explicitly declined to make must not become brandOk');

  // End-to-end: the speculative brand must not unlock an anchor, an
  // anchor-relative envelope, or a priced verdict.
  const watch = normalizeOpenAIRecognition(payload({
    category: 'Watches', subcategory: 'wristwatch', object_type: 'wristwatch',
    brand: null, brand_confidence: 0, model: null, model_number: null,
    visible_text: [], logos: [], candidate_models: [],
    needs_confirmation: true, ambiguity_reason: 'no legible branding',
    candidate_brands: [{ brand: 'Rolex', confidence: 0.25 }],
  }));
  const wr = calibrateRecognition(watch);
  const id = assessFallbackIdentity(wr);
  const rolexRow = {
    id: 'r1', brand: 'Rolex', model: 'Submariner', name: 'Rolex Submariner',
    category: 'Watches', subcategory: 'wristwatch',
    avg_used_price_ils: 38000, retail_price_ils: 52000,
  };
  const anchor = [rolexRow].find((row) => isCompatibleAnchor(row, id, wr)?.ok === true) || null;
  assert.equal(anchor, null, 'a declined brand must not resolve a luxury anchor');
  const v = validateQuote(
    { low: 34000, mid: 38000, high: 44000, currency: 'ILS', price_method: 'comp_based' },
    { stage: 'stage2', identity: id, recognition: wr, anchor },
  );
  assert.equal(v.metadata.envelope_key, 'watches', 'must use the category envelope, not an anchor-relative one');
  assert.equal(v.metadata.degraded, true);
  assert.deepEqual(v.prices, { low: 0, mid: 0, high: 0 },
    'a speculative brand must not turn ₪0/MANUAL_REQUIRED into ₪38,000/HIGH');

  // Ordering, dedup and the empty case.
  const ordered = belt({ brand: 'Seiko', brand_confidence: 0.5, candidate_brands: [{ brand: 'Rolex', confidence: 0.95 }] });
  assert.deepEqual(ordered.brand_candidates.map((b) => b.brand), ['Seiko', 'Rolex'],
    'a more confident runner-up must not displace the primary');
  const noisy = normalizeOpenAIRecognition(payload({
    brand: 'Logitech',
    candidate_brands: [{ brand: 'logitech', confidence: 0.3 }, { brand: 'unknown', confidence: 0.3 }, { brand: '', confidence: 0.1 }],
  }));
  assert.deepEqual(noisy.brand_candidates.map((b) => b.brand), ['Logitech']);
  // No runner-ups: the list stays EMPTY, so calibrateRecognition's zero-length
  // clamp (0.55) applies exactly as it does for the current engine, rather
  // than the 0.65 topBrand branch a stray sentinel would select.
  assert.deepEqual(belt({ candidate_brands: [] }).brand_candidates, []);
});

test('OAI-16d REGRESSION Hebrew category names are populated on the degraded paths', () => {
  // Architecture review: category_hebrew was hardcoded ''. buildFastPathVerification
  // and buildFallback both derive final_category_hebrew and full_name_hebrew
  // from it, and final_category_hebrew is PERSISTED — so every OpenAI scan on
  // the fast path or the Stage 2 fallback stored empty Hebrew names in a
  // Hebrew-first product.
  for (const cat of OPENAI_IDENTITY_SCHEMA.properties.category.enum) {
    const r = normalizeOpenAIRecognition(payload({ category: cat }));
    assert.ok(r.category_hebrew && r.category_hebrew.length > 0,
      `${cat} has no Hebrew name`);
    assert.match(r.category_hebrew, /[֐-׿]/, `${cat} Hebrew name is not Hebrew`);
  }
});

test('OAI-16e logo-only brand evidence is labelled as a logo, not as read text', () => {
  // Valuation review F4: the corroboration haystack included `logos`, so the
  // 'logo_visual' branch was unreachable whenever the brand name appeared in
  // the logo string. Logo evidence and transcribed-text evidence are different
  // claims and calibrateVerification grades them differently.
  const logoOnly = normalizeOpenAIRecognition(payload({ visible_text: [], logos: ['Logitech G'] }));
  assert.equal(logoOnly.brand_candidates[0].evidence, 'logo_visual');
  const readText = normalizeOpenAIRecognition(payload({ visible_text: ['LOGITECH'], logos: [] }));
  assert.equal(readText.brand_candidates[0].evidence, 'readable_text');
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. VAL-001 still executes
// ─────────────────────────────────────────────────────────────────────────────

test('OAI-17 VAL-001 still adjudicates a price derived from an OpenAI identity', () => {
  const r = calibrateRecognition(normalizeOpenAIRecognition(payload({
    model: 'G502 Hero', visible_text: ['G502 HERO'],
  })));
  const verdict = validateQuote(
    { low: 200, mid: 300, high: 400, currency: 'ILS', price_method: 'comp_based' },
    { stage: 'stage2', identity: assessFallbackIdentity(r), recognition: r, anchor: null, model: 'gpt-5.6-luna' },
  );
  assert.ok(verdict, 'the guard must run for the OpenAI path exactly as for the current one');
  assert.ok(verdict.metadata.validator_version, 'the verdict must be stamped and auditable');
  assert.ok(verdict.metadata.ruleset_version);

  // REVIEW FINDING (valuation reviewer): the original assertion here was a
  // tautology. It passed `anchor: null`, and derivePricingSource returns
  // stage2_comp_anchored IFF ctx.anchor is truthy — so the assertion could not
  // fail for any input whatsoever. It never tested the thing that matters:
  // whether an OpenAI identity can PRODUCE an anchor it did not earn.
  //
  // The real question is answered by running the actual anchor resolution
  // analyze.js performs, over a candidate pool containing a sibling, and
  // feeding the guard whatever that yields.
  const resolveAnchor = (rec, rows) => {
    const id = assessFallbackIdentity(rec);
    return rows.find((row) => isCompatibleAnchor(row, id, rec)?.ok === true) || null;
  };
  const siblingRow = {
    id: 'sib', brand: 'Logitech', model: 'G903', name: 'Logitech G903',
    category: 'Electronics', subcategory: 'computer mouse',
    avg_used_price_ils: 480, retail_price_ils: 900,
  };
  const siblingOnly = validateQuote(
    { low: 380, mid: 480, high: 560, currency: 'ILS', price_method: 'comp_based' },
    { stage: 'stage2', identity: assessFallbackIdentity(r), recognition: r,
      anchor: resolveAnchor(r, [siblingRow]), model: 'gpt-5.6-luna' },
  );
  assert.equal(resolveAnchor(r, [siblingRow]), null,
    'a sibling must not become an anchor, so the guard must grade this unanchored');
  assert.notEqual(siblingOnly.metadata.pricing_source, 'stage2_comp_anchored',
    'an OpenAI identity must not earn anchored provenance off a sibling row');

  // And the genuinely matching row DOES earn it — otherwise the assertion
  // above would pass simply because nothing can ever anchor.
  const realRow = { ...siblingRow, id: 'real', model: 'G502 Hero', name: 'Logitech G502 Hero' };
  const anchored = validateQuote(
    { low: 380, mid: 480, high: 560, currency: 'ILS', price_method: 'comp_based' },
    { stage: 'stage2', identity: assessFallbackIdentity(r), recognition: r,
      anchor: resolveAnchor(r, [realRow]), anchorModelEvidence: true, model: 'gpt-5.6-luna' },
  );
  assert.ok(resolveAnchor(r, [realRow]), 'the matching row must resolve as an anchor');
  assert.equal(anchored.metadata.pricing_source, 'stage2_comp_anchored');

  // And an absurd number must still be refused when the identity is unverified.
  const absurd = validateQuote(
    { low: 1, mid: 999_999, high: 1_000_000, currency: 'ILS', price_method: 'ai_estimate' },
    { stage: 'stage2', identity: assessFallbackIdentity(r), recognition: r, anchor: null, model: 'gpt-5.6-luna' },
  );
  assert.equal(absurd.metadata.degraded, true, 'an unanchored six-figure mouse must not pass the guard');
  assert.deepEqual(absurd.prices, { low: 0, mid: 0, high: 0 },
    'a rejected quote must ship no number at all');
});

test('OAI-18 the guard choke point is still the only way a price ships', () => {
  // Structural: the engine branch must sit upstream of normalizeForUI, not
  // beside it. A second path to the response would bypass VAL-001 entirely.
  const branch = analyzeSrc.indexOf('const runStage1 = async () =>');
  const guard  = analyzeSrc.indexOf('let result = normalizeForUI(');
  assert.ok(branch > 0 && guard > branch, 'recognition selection must precede the single guard choke point');
  // One declaration + three call sites (initial, guard rescue, manual
  // terminator). If this count moves, a new path to the response exists and
  // every one of them must be re-verified against validateQuote.
  assert.equal((analyzeSrc.match(/normalizeForUI\(/g) || []).length, 4,
    'normalizeForUI call sites changed — re-verify every one still routes through validateQuote');
  assert.equal((analyzeSrc.match(/validateQuote\(/g) || []).length, 1,
    'the guard must keep exactly one call site — that is what makes it a choke point');
});

// ─────────────────────────────────────────────────────────────────────────────
// 8 & 12. Failure is safe; malformed output cannot crash a scan
// ─────────────────────────────────────────────────────────────────────────────

test('OAI-19 every upstream failure throws rather than returning a stub identity', async () => {
  const cases = [
    ['http 500', { ok: false, status: 500, text: async () => 'upstream exploded', json: async () => ({}) }],
    ['http 429', { ok: false, status: 429, text: async () => 'rate limited', json: async () => ({}) }],
    ['refusal', { ok: true, status: 200, text: async () => '', json: async () => ({
      output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }] }) }],
    ['incomplete', { ok: true, status: 200, text: async () => '', json: async () => ({
      status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [] }) }],
    ['no text part', { ok: true, status: 200, text: async () => '', json: async () => ({ output: [] }) }],
    ['bad json', { ok: true, status: 200, text: async () => '', json: async () => ({
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'not json {' }] }] }) }],
    ['body not json', { ok: true, status: 200, text: async () => '', json: async () => { throw new Error('boom'); } }],
  ];
  for (const [label, res] of cases) {
    await assert.rejects(
      () => recognizeWithOpenAI(['AAAA'], { apiKey: 'sk-test-key-value-1234', fetchImpl: async () => res }),
      (err) => err instanceof Error && /\[OpenAI\]/.test(err.message),
      `${label} must reject with a typed error, never resolve with a partial identity`,
    );
  }
});

test('OAI-20 a network fault and a timeout are distinguishable and both throw', async () => {
  await assert.rejects(
    () => recognizeWithOpenAI(['AAAA'], { apiKey: 'sk-x-1234567890', fetchImpl: async () => { throw new Error('ECONNRESET'); } }),
    /network error/,
  );
  await assert.rejects(
    () => recognizeWithOpenAI(['AAAA'], {
      apiKey: 'sk-x-1234567890', timeoutMs: 20,
      fetchImpl: (_u, opts) => new Promise((_res, rej) => {
        opts.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      }),
    }),
    /\[Timeout\]/,
  );
});

test('OAI-21 structurally malformed model output normalizes instead of throwing', () => {
  // Strict mode should make these unreachable. "Should" is not a runtime
  // guarantee, and a throw inside normalization would take a scan down.
  for (const junk of [null, undefined, 'a string', 42, [], { }, { brand: 42, visible_text: 'nope',
    candidate_models: 'nope', visual_attributes: null, category: 'Spaceships' }]) {
    const r = normalizeOpenAIRecognition(junk);
    assert.equal(typeof r, 'object');
    assert.ok(Array.isArray(r.brand_candidates) && Array.isArray(r.model_candidates));
    assert.ok(Array.isArray(r.ocr_text.raw_texts));
    // Valuation review F3: an unmappable condition must yield ABSENCE, not the
    // `used` rung. Defaulting to 'Good' installed a 0.30 rung that produced a
    // 30% uplift when the user later selected New — the current engine leaves
    // it null and the condition ladder no-ops.
    assert.equal(r.visual_features.condition, '', 'a malformed condition must not manufacture a rung');
    assert.ok(['Other', 'Electronics'].includes(r.category), 'an unknown category must fall back, not pass through');
    // And the real calibrator must accept the degenerate shape.
    assert.doesNotThrow(() => calibrateRecognition(r));
  }
});

test('OAI-22 model output cannot forge a pipeline-authored field', () => {
  // `recognition` carries internals the pipeline treats as facts about itself.
  // The adapter builds its result from an allowlist, so a model that emits
  // these keys cannot inject them.
  const r = normalizeOpenAIRecognition({
    ...payload(),
    _user_correction: 'Rolex Submariner',
    _correction_source: 'user_selected',
    identity_resolution: { level: 'exact', brand: 'Rolex' },
    confidence_calibrated: true,
    raw_category_confidence: 1,
  });
  assert.equal(r._user_correction, undefined);
  assert.equal(r._correction_source, undefined);
  assert.equal(r.identity_resolution, undefined);
  assert.equal(r.confidence_calibrated, undefined);
  assert.equal(r.brand_candidates[0].brand, 'Logitech', 'the forged identity must not have displaced the real one');
});

test('OAI-23 the fallback decision is budget-gated and never fabricates', () => {
  const region = analyzeSrc.slice(
    analyzeSrc.indexOf('const runStage1 = async () =>'),
    analyzeSrc.indexOf('let recognition;'),
  );
  assert.ok(region.length > 200, 'engine-selection block not found — this test is pinning nothing');
  assert.match(region, /fallbackCap < 8_000/, 'the fallback must refuse to run a starved Stage 1');
  assert.match(region, /throw new Error/, 'no-budget must throw into the existing 503 + refund path');
  assert.match(region, /recognitionEngineUsed = RECOGNITION_ENGINE_CURRENT/,
    'a fallback scan must be reported as the engine that actually answered');
  assert.equal(/price|marketValue|Unidentified|'Unknown'/.test(region), false,
    'the engine branch must not invent identity or touch pricing');
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. The API key never escapes the server
// ─────────────────────────────────────────────────────────────────────────────

test('OAI-24 the key is never returned, logged, or attached to an error', async () => {
  const KEY = 'sk-proj-SUPERSECRETVALUE0987654321';
  const logs = [];
  const orig = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = (...a) => logs.push(a.join(' '));
  try {
    // An upstream that echoes the Authorization header straight back — the
    // realistic worst case for a leak into a log sink.
    await assert.rejects(() => recognizeWithOpenAI(['AAAA'], {
      apiKey: KEY,
      env: { OPENAI_API_KEY: KEY },
      fetchImpl: async (_u, opts) => ({
        ok: false, status: 400,
        text: async () => `invalid request; received header ${opts.headers.Authorization}`,
        json: async () => ({}),
      }),
    }), (err) => {
      assert.equal(err.message.includes(KEY), false, 'the key must not reach the Error message');
      assert.match(err.message, /REDACTED/);
      return true;
    });
    const ok = await recognizeWithOpenAI(['AAAA'], {
      apiKey: KEY, env: { OPENAI_API_KEY: KEY }, fetchImpl: async () => okResponse(payload()),
    });
    assert.equal(JSON.stringify(ok).includes(KEY), false, 'the key must not ride out on the success result');
  } finally {
    Object.assign(console, orig);
  }
  assert.equal(logs.join('\n').includes(KEY), false, 'the key must not reach any log line');
});

test('OAI-25 the key is sent as a header and interpolated nowhere else', async () => {
  let seen = null;
  await recognizeWithOpenAI(['AAAA'], {
    apiKey: 'sk-abc1234567890', fetchImpl: async (url, opts) => { seen = { url, opts }; return okResponse(payload()); },
  });
  assert.equal(seen.url, 'https://api.openai.com/v1/responses');
  assert.equal(seen.opts.headers.Authorization, 'Bearer sk-abc1234567890');
  assert.equal(seen.opts.body.includes('sk-abc'), false, 'the key must never appear in the request body');

  // scrubKey must also catch a key it was not handed (rotated, or another
  // project's key echoed by the upstream).
  assert.match(scrubKey('leak sk-otherproject-ABCDEFGHIJKL here', {}), /\[REDACTED\]/);
});

test('OAI-26 the key is server-only and can never be bundled into the client', () => {
  assert.match(adapterSrc, /process\.env\.OPENAI_API_KEY/);
  for (const [name, src] of ALL_MODULE_SRC) {
    assert.equal(/VITE_/.test(src), false, `no VITE_ variable may appear in the server-only ${name} module`);
  }
  for (const [name, src] of [['contract', contractSrc], ['normalize', normalizeSrc]]) {
    assert.equal(/OPENAI_API_KEY/.test(src), false,
      `the ${name} module handles no credentials — only the transport module may touch the key`);
  }
  for (const file of ['src/App.jsx', 'src/contexts/AppContext.jsx', 'src/views/CameraResultsView.jsx']) {
    const s = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.equal(/OPENAI_API_KEY|api\.openai\.com/.test(s), false, `${file} must not reference the OpenAI key or endpoint`);
  }
  // The adapter lives under api/_lib/, which Vercel does not route or serve.
  assert.match(new URL(ADAPTER_URL).pathname, /\/api\/_lib\//);
});

test('OAI-27 the telemetry payload carries provenance, never credentials or upstream text', () => {
  // Shaped by the adapter (architecture review) so analyze.js does not reach
  // into a private namespace with silent `?? null` chains.
  const t = O.buildOpenAITelemetry({
    requested: 'openai', used: 'current',
    recognition: normalizeOpenAIRecognition(payload()),
    meta: { openai_recognition_ms: 3200, model: 'gpt-5.6-luna', input_tokens: 1, output_tokens: 2 },
    failureCode: 'rate_limited',
  });
  assert.equal(t.used, 'current');
  assert.equal(t.fallback_reason, 'rate_limited');
  assert.equal(/sk-|Bearer|API_KEY/.test(JSON.stringify(t)), false);
  // Degenerate input must not throw — this runs inside the response path.
  assert.doesNotThrow(() => O.buildOpenAITelemetry({}));
  assert.equal(O.buildOpenAITelemetry({}).openai_model, null);
});

test('OAI-27b REGRESSION raw upstream error text is never persisted or returned', () => {
  // Security review M2, reproduced: an OpenAI 400 echoing the offending
  // image_url wrote ~150 bytes of the user's own base64 into the client
  // response, valuations.ai_raw_response AND scan_events.payload.
  const leaky = '[OpenAI] API 400: Invalid image_url: data:image/jpeg;base64,/9j/4AAQSkZJRg org_abc proj_xyz';
  assert.equal(classifyOpenAIFailure(leaky), 'http_400');
  for (const [msg, code] of [
    ['[OpenAI] [Timeout] recognition aborted at 8000ms', 'timeout'],
    ['[OpenAI] API 429: slow down', 'rate_limited'],
    ['[OpenAI] API 503: upstream', 'upstream_5xx'],
    ['[OpenAI] API 401: bad key', 'auth'],
    ['[OpenAI] model refused the request', 'refusal'],
    ['[OpenAI] response incomplete (max_output_tokens)', 'incomplete'],
    ['[OpenAI] output was not valid JSON', 'parse'],
    ['[OpenAI] network error after 90ms: ECONNRESET', 'network'],
  ]) {
    assert.equal(classifyOpenAIFailure(msg), code);
    assert.equal(/base64|image_url|org_|proj_/.test(classifyOpenAIFailure(msg)), false);
  }
  // analyze.js must persist the CODE, not the message.
  assert.match(analyzeSrc, /openaiFallbackReason = classifyOpenAIFailure\(detail\)/);
  const region = analyzeSrc.slice(analyzeSrc.indexOf('const detail = scrubKey'),
    analyzeSrc.indexOf('recognitionEngineUsed = RECOGNITION_ENGINE_CURRENT;', analyzeSrc.indexOf('const detail = scrubKey')));
  assert.equal(/throw new Error\(`OpenAI recognition failed with no fallback budget: \$\{detail\}/.test(region), false,
    'the raw upstream detail must not travel on the thrown error, which reaches the 503 response');
});

test('OAI-27c user images are not retained by the provider', () => {
  // Security review H1: `store` defaults to TRUE on the Responses API and
  // stored requests are retained >=30 days in a browsable dashboard. Without
  // store:false every scanned photograph becomes a second copy outside any
  // GetWorth erasure path.
  assert.match(adapterSrc, /store: false/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. The flag is off by default and the current engine is untouched
// ─────────────────────────────────────────────────────────────────────────────

test('OAI-28 the default engine is the current one', () => {
  assert.equal(resolveRecognitionEngine({}), RECOGNITION_ENGINE_CURRENT);
  assert.equal(resolveRecognitionEngine({ OPENAI_API_KEY: 'sk-x' }), RECOGNITION_ENGINE_CURRENT,
    'a key present without the flag must change nothing');
  for (const v of ['', ' ', 'current', 'OPENAI_', 'true', '1', 'yes', 'openai-beta', 'anthropic']) {
    assert.equal(resolveRecognitionEngine({ RECOGNITION_ENGINE: v, OPENAI_API_KEY: 'sk-x' }),
      RECOGNITION_ENGINE_CURRENT, `RECOGNITION_ENGINE=${JSON.stringify(v)} must not enable the prototype`);
  }
});

test('OAI-29 the prototype requires BOTH the exact flag and a key', () => {
  assert.equal(resolveRecognitionEngine({ RECOGNITION_ENGINE: 'openai', OPENAI_API_KEY: 'sk-x' }),
    RECOGNITION_ENGINE_OPENAI);
  assert.equal(resolveRecognitionEngine({ RECOGNITION_ENGINE: ' OpenAI ', OPENAI_API_KEY: 'sk-x' }),
    RECOGNITION_ENGINE_OPENAI, 'trimmed + case-insensitive, so a tidy env value still works');
  assert.equal(resolveRecognitionEngine({ RECOGNITION_ENGINE: 'openai' }), RECOGNITION_ENGINE_CURRENT,
    'a flag without a key must degrade to the current engine, not 503 every scan');
});

test('OAI-30 the current engine is byte-for-byte unchanged', () => {
  // The ticket forbids modifying the existing engine. These are the exact
  // artefacts the current path is built from.
  assert.match(analyzeSrc, /const MODEL_VISION = 'claude-sonnet-4-6';/);
  assert.match(analyzeSrc, /async function recognize\(images, language, apiKey, attemptTimeoutMs = 12000\)/);
  assert.match(analyzeSrc, /model: MODEL_VISION,\s*\n\s*max_tokens: 1500,/);
  // And with the flag off, the ONLY call the branch can make is the old one.
  const region = analyzeSrc.slice(
    analyzeSrc.indexOf('if (recognitionEngine !== RECOGNITION_ENGINE_OPENAI)'),
    analyzeSrc.indexOf('const openaiCap ='),
  );
  assert.match(region, /timed\('stage1_vision', withTimeout\(\s*recognize\(imageList, lang, apiKey, stage1Cap\)/);
  // Assert on CODE, not commentary — a comment naming the constant is fine,
  // a call reaching it is not.
  const code = region
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n')
    .replace(/RECOGNITION_ENGINE_OPENAI/g, '');
  assert.equal(/openai/i.test(code), false,
    `the disabled path must not execute anything OpenAI-related: ${code.trim()}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. Timing fields persist
// ─────────────────────────────────────────────────────────────────────────────

test('OAI-31 the adapter measures the external call, not the local work around it', async () => {
  const { meta } = await recognizeWithOpenAI(['AAAA'], {
    apiKey: 'sk-x-1234567890',
    fetchImpl: async () => { await new Promise((r) => setTimeout(r, 60)); return okResponse(payload()); },
  });
  assert.ok(meta.openai_recognition_ms >= 55 && meta.openai_recognition_ms < 5_000,
    `expected ~60ms of measured upstream time, got ${meta.openai_recognition_ms}`);
  assert.equal(meta.input_tokens, 1400);
  assert.equal(meta.output_tokens, 210);
  assert.equal(meta.model, 'gpt-5.6-luna');
});

test('OAI-31b the body read is INSIDE the measured window', async () => {
  // fetch() resolves on headers; the body is still streaming. If the clock
  // stopped at headers, this scan would report ~0ms while really taking 80ms,
  // and the A/B benchmark would credit OpenAI with a head start the current
  // engine (which times through its own res.json()) does not get.
  const { meta } = await recognizeWithOpenAI(['AAAA'], {
    apiKey: 'sk-x-1234567890',
    fetchImpl: async () => ({
      ok: true, status: 200, text: async () => '',
      json: async () => {
        await new Promise((r) => setTimeout(r, 80));   // slow body
        return (await okResponse(payload()).json());
      },
    }),
  });
  assert.ok(meta.openai_recognition_ms >= 70,
    `body-read time must be inside the measured window, got ${meta.openai_recognition_ms}ms`);
});

test('OAI-31c local parsing and normalization are OUTSIDE the measured window', async () => {
  // The mirror of 31b: a slow local step must not be reported as OpenAI
  // latency, or the prototype gets blamed for our own CPU.
  const many = payload({ visible_text: Array.from({ length: 24 }, (_, i) => `TEXT-${i}`) });
  const { meta } = await recognizeWithOpenAI(['AAAA'], {
    apiKey: 'sk-x-1234567890', fetchImpl: async () => okResponse(many),
  });
  assert.ok(meta.openai_recognition_ms < 50,
    `a fast upstream must report fast, got ${meta.openai_recognition_ms}ms`);
});

test('OAI-32 usage telemetry degrades to null instead of throwing', async () => {
  const { meta } = await recognizeWithOpenAI(['AAAA'], {
    apiKey: 'sk-x-1234567890',
    fetchImpl: async () => ({
      ok: true, status: 200, text: async () => '',
      json: async () => ({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(payload()) }] }] }),
    }),
  });
  assert.equal(meta.input_tokens, null);
  assert.equal(meta.output_tokens, null);
});

test('OAI-33 the engine and its latency are persisted, not merely logged', () => {
  // ai_raw_response carries the pre-persist snapshot; scan_events carries the
  // complete one. Both must be wired, or the experiment produces no evidence.
  assert.match(analyzeSrc, /recognition_engine: recognitionEngineUsed/);
  assert.match(analyzeSrc, /openai_recognition_ms: openaiMeta\?\.openai_recognition_ms \?\? null/);
  const persist = analyzeSrc.indexOf("result._timings = snapshotTimings('pre_persist')");
  const write   = analyzeSrc.indexOf('recordScanWithRetry(supa, valuationRow, scanUuid)');
  assert.ok(persist > 0 && write > persist, 'the snapshot must be attached before the valuation is serialised');
  assert.match(analyzeSrc, /'openai_experiment_timings', 'pipeline'/,
    'persistence_ms and total_ms are unknowable at pre_persist and must be written afterwards');
  const ev = analyzeSrc.slice(analyzeSrc.indexOf("'openai_experiment_timings', 'pipeline'"));
  assert.match(ev.slice(0, 700), /openai_fallback_reason/);
  // The row must say which cohort it is. This event covers experiment traffic
  // only, and it is the sole home of persistence_ms/total_ms — a generic name
  // would let a future p95 over it be mistaken for a fleet-wide number.
  assert.match(ev.slice(0, 700), /cohort: 'openai_experiment'/);
});

// ─────────────────────────────────────────────────────────────────────────────
// Contract hygiene
// ─────────────────────────────────────────────────────────────────────────────

test('OAI-34 the schema is valid strict-mode JSON Schema', () => {
  // Strict mode rejects a schema that omits a property from `required`, allows
  // extra properties, or uses unsupported numeric keywords. A rejected schema
  // is a 400 on every scan.
  const walk = (node, path = '$') => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'object') {
      assert.equal(node.additionalProperties, false, `${path}: additionalProperties must be false`);
      const props = Object.keys(node.properties || {});
      assert.deepEqual([...(node.required || [])].sort(), props.sort(),
        `${path}: every property must be listed in required`);
      for (const [k, v] of Object.entries(node.properties || {})) walk(v, `${path}.${k}`);
    }
    if (node.type === 'array') walk(node.items, `${path}[]`);
    for (const kw of ['minimum', 'maximum', 'maxItems', 'minItems', 'pattern', 'format']) {
      assert.equal(kw in node, false, `${path}: ${kw} is not supported in strict mode`);
    }
  };
  walk(OPENAI_IDENTITY_SCHEMA);
});

test('OAI-35 the request matches the verified Responses API contract', async () => {
  let body = null;
  await recognizeWithOpenAI(['IMGDATA1', 'IMGDATA2'], {
    apiKey: 'sk-x-1234567890',
    fetchImpl: async (_u, opts) => { body = JSON.parse(opts.body); return okResponse(payload()); },
  });
  assert.equal(body.text.format.type, 'json_schema');
  assert.equal(body.text.format.strict, true);
  assert.ok(body.text.format.name && body.text.format.schema);
  assert.equal(body.reasoning.effort, 'none', 'reasoning tokens are latency this prototype cannot spend');
  assert.ok(body.max_output_tokens > 0);
  const parts = body.input[0].content;
  assert.equal(parts.filter((p) => p.type === 'input_image').length, 2);
  assert.match(parts[0].image_url, /^data:image\/jpeg;base64,IMGDATA1$/);
  assert.equal(parts.at(-1).type, 'input_text');
});

test('OAI-36 the prompt asks for data and forbids invention', () => {
  const p = buildOpenAIRecognitionPrompt('he');
  assert.match(p, /no prose/i);
  assert.match(p, /0\.70/, 'the silhouette ceiling must be stated to the model as well as enforced after it');
  assert.match(p, /null unless/i);
  // The ORDER OF WORK block is load-bearing, not padding: structured output
  // emits keys in schema order, so without an explicit "transcribe first,
  // decide second" instruction nothing opposes the model committing to an
  // identity and then generating the text it supposedly read (recognition
  // review). It is worth its ~300 characters. Still bounded — this is input
  // tokens on every scan.
  assert.match(p, /ORDER OF WORK/, 'the anti-echo ordering instruction must be present');
  assert.ok(p.length < 2000, `the prompt is input tokens on every scan; keep it tight (${p.length} chars)`);
});

test('OAI-37 extractOpenAIJson reads the raw HTTP shape, not the SDK convenience field', () => {
  for (const [name, src] of ALL_MODULE_SRC) {
    assert.equal(/body\.output_text|\.output_text/.test(src), false,
      `output_text does not exist on the raw HTTP body — reading it in ${name} would silently yield undefined`);
  }
  const obj = extractOpenAIJson({
    output: [
      { type: 'reasoning', summary: [] },
      { type: 'message', content: [{ type: 'output_text', text: '{"a":' }, { type: 'output_text', text: '1}' }] },
    ],
  });
  assert.deepEqual(obj, { a: 1 }, 'multi-part text must be concatenated, and non-message items skipped');
});
