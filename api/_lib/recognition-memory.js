// ═══════════════════════════════════════════════════════════════════════════
// SCAN-014 — Recognition Memory Layer: canonical key builder (Phase 1)
// ═══════════════════════════════════════════════════════════════════════════
// Shared by api/analyze.js (Node runtime) and api/submit-candidate.js (Edge
// runtime) — this module must stay dependency-free and side-effect-free.
//
// VERSION FREEZE: the v1 normalization below is intentionally a FROZEN COPY of
// the semantics analyze.js uses for retrieval (stripBrandPrefix +
// normalizeModelKey as of SCAN-013). It must NEVER be edited in place: stored
// canonical_key values are only reproducible while this code is byte-stable.
// When normalization needs to evolve, add buildRecognitionMemoryKeyV2 and bump
// MEMORY_KEY_VERSION — old rows keep their v1 keys and can be re-keyed by a
// migration job, never silently orphaned.
//
// Key format (v1):  "v1|<category>|<brand>|<model>"
//   - category IS key material in v1 (same brand+model in a different category
//     is a different memory row — fail-safe against cross-category collisions).
//   - brand and model are REQUIRED (fail closed). Brand-only memory is a
//     future, separately-keyed concept ("v1b|<category>|<brand>") and is NOT
//     produced or matched in Phase 1.
//   - Future attribute expansion (color / size / edition / variant / storage /
//     condition / authenticity / market context) belongs in a NEW key version
//     (and the recognition_memory.key_attrs jsonb column), never appended to v1.
// ═══════════════════════════════════════════════════════════════════════════

export const MEMORY_KEY_VERSION = 1;

// Lowercase, unicode-normalize, collapse every non-alphanumeric run to a single
// space. Keys are built from the Latin identity fields (brand/model are Latin
// by catalog convention); anything that folds to nothing fails closed.
function foldKeyPart(s) {
  return String(s || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

// Frozen copy of analyze.js stripBrandPrefix (SCAN-013 semantics): remove a
// leading brand prefix repeated any number of times, word-boundary safe.
function stripBrandPrefixV1(brand, value) {
  const v = (value || '').trim();
  const b = (brand || '').trim().toLowerCase();
  if (!v || !b) return v;
  let out = v;
  while (out.toLowerCase().startsWith(b + ' ')) out = out.slice(b.length + 1).trim();
  return out || v;
}

// Frozen copy of analyze.js normalizeModelKey: strip ONE trailing variant
// suffix so close family variants collapse ("G502 Hero" → "g502").
function normalizeModelKeyV1(model) {
  return (model || '')
    .toLowerCase()
    .replace(/\s+(hero\d?|x\s*plus|x\+|x\d?|\+|se|lite|rgb|gaming|wireless|lightspeed|edition|v\d|gen\d|mk\d|plus|pro)$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const isUnidentified = (s) => !s || String(s).trim().toLowerCase() === 'unidentified';

// Build the v1 exact-product memory key. Fail closed: every missing or
// degenerate input returns { ok: false, reason } and NO key.
//
// Returns:
//   { ok: true,  key, keyVersion, categoryKey, brandKey, modelKey }
//   { ok: false, reason: 'missing_category' | 'missing_brand' | 'missing_model'
//                       | 'empty_after_normalization' }
export function buildRecognitionMemoryKey({ category, brand, model } = {}) {
  if (!category || !String(category).trim()) return { ok: false, reason: 'missing_category' };
  if (isUnidentified(brand)) return { ok: false, reason: 'missing_brand' };
  if (isUnidentified(model)) return { ok: false, reason: 'missing_model' };

  const categoryKey = foldKeyPart(category);
  const brandKey = foldKeyPart(brand);
  // Model: strip a (possibly doubled) brand prefix first, then collapse the
  // variant suffix, then fold — mirrors what retrieval considers "same model".
  const modelKey = foldKeyPart(normalizeModelKeyV1(stripBrandPrefixV1(brand, model)));

  if (!categoryKey || !brandKey || !modelKey) {
    return { ok: false, reason: 'empty_after_normalization' };
  }
  // Degenerate: model folded down to the brand itself ("Sony" / "Sony") — that
  // is brand-only identity wearing a model's clothes; exact-product memory
  // must not key on it.
  if (modelKey === brandKey) return { ok: false, reason: 'missing_model' };

  return {
    ok: true,
    key: `v${MEMORY_KEY_VERSION}|${categoryKey}|${brandKey}|${modelKey}`,
    keyVersion: MEMORY_KEY_VERSION,
    categoryKey,
    brandKey,
    modelKey,
  };
}
