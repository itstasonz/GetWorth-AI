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
  gradeRowEvidence, RECOGNITION_SCHEMA, VERIFICATION_SCHEMA,
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

test('B-04 [DEFECT-4] Stage 1 is never told it may return "unidentified"', () => {
  // Downstream code gates on brand/model !== 'unidentified' in many places, but
  // the Stage 1 prompt never offers that vocabulary, so Stage 1 is compelled to
  // name a brand and model on every scan. Expected fix: Stage 1 gains an
  // explicit "I cannot tell" path and this assertion inverts.
  const promptStart = ANALYZE_SRC.indexOf('function buildRecognitionPrompt');
  const promptEnd = ANALYZE_SRC.indexOf('export function buildVerificationPrompt');
  assert.ok(promptStart > -1 && promptEnd > promptStart, 'prompt bounds not found');
  const recognitionPrompt = ANALYZE_SRC.slice(promptStart, promptEnd);

  assert.equal(/unidentified/i.test(recognitionPrompt), false,
    'Stage 1 prompt currently offers no "unidentified" vocabulary');

  // Stage 2's prompt, by contrast, does offer it — proving the omission is
  // specific to Stage 1 rather than a project-wide convention.
  const verificationPrompt = ANALYZE_SRC.slice(promptEnd);
  assert.equal(/unidentified/i.test(verificationPrompt), true);
});

test('B-05 [DEFECT-5] Stage 1 pays output tokens for fields nothing reads', () => {
  // Every one of these appears exactly twice in the module: once in
  // RECOGNITION_SCHEMA, once in the prompt template. They are generated on the
  // critical path of every scan and never read. Stage 1 latency is output-token
  // bound, so these cost wall-clock time on each scan.
  const writeOnly = ['size_estimate', 'distinctive_elements', 'wear_level',
                     'needs_more_info', 'labels_detected', 'serial_numbers'];
  for (const f of writeOnly) {
    const hits = ANALYZE_SRC.split(f).length - 1;
    assert.equal(hits, 2, `${f} should appear exactly twice (schema + prompt) while unread; found ${hits}`);
  }
});

test('B-06 [DEFECT-6] the JSON schemas are declared but never applied', () => {
  // Both schemas are exported and then referenced by nothing — no validator, no
  // structured-output request. Model confidences are therefore unclamped: the
  // prompt's "NEVER >0.70 from silhouette alone" rule is unenforced.
  // Expected fix: the schemas become load-bearing.
  const uses = ANALYZE_SRC.split('RECOGNITION_SCHEMA').length - 1;
  assert.equal(uses, 1, 'RECOGNITION_SCHEMA is declared once and never referenced again');

  const verificationUses = ANALYZE_SRC.split('VERIFICATION_SCHEMA').length - 1;
  assert.equal(verificationUses, 1, 'VERIFICATION_SCHEMA is declared once and never referenced again');
});
