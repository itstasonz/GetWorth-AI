// ═══════════════════════════════════════════════════════════════════════════
// SCAN-014 — Recognition Memory Layer: canonical key builder (Phase 1.1D: v2)
// ═══════════════════════════════════════════════════════════════════════════
// Shared by api/analyze.js (Node runtime) and api/confirm-identity.js (Edge
// runtime) — this module must stay dependency-free and side-effect-free.
//
// VERSION FREEZE: each key version's normalization is a FROZEN COPY once rows
// exist under it. v1 (stripBrandPrefixV1 + normalizeModelKeyV1 + foldKeyPart,
// SCAN-013 semantics) must NEVER be edited in place: stored v1 keys are only
// reproducible while that code is byte-stable. When normalization evolves, add
// a new vN layer and bump MEMORY_KEY_VERSION — old rows keep their keys and
// are re-keyed by an explicit migration, never silently orphaned.
//
// v2 (Phase 1.1D) = v1 pipeline + stripModelDecorationsV2 applied to the
// FOLDED v1 model key as a pure post-processing step. That "v2 is a function
// of the v1 result" property is deliberate: the re-key migration
// (20260718000001) can convert stored v1 keys to v2 exactly, by applying the
// same decoration strip to the stored model part — no re-normalization of raw
// identity needed. The SQL function rm_strip_decorations_v2 is the ONE
// sanctioned mirror of the decoration rules; if you change them here, bump to
// v3 instead (never edit v2 in place once v2 rows exist).
//
// Why v2 exists (production shadow finding, Phase 1.1C): the same perfume
// scanned 3× produced 'v1|beauty|afnan|rare reef' AND
// 'v1|beauty|afnan|rare reef edp' — Stage 2 sometimes includes the
// concentration suffix and sometimes not, fragmenting the learning history.
// Concentration/size/packaging are identity DECORATIONS: metadata about the
// same product family, not a different product. They are stripped from the
// key; when a future phase needs to distinguish them (EDP vs EDT pricing),
// they belong in recognition_memory.key_attrs under a v3 key — never as raw
// model-string variance.
//
// What v2 deliberately does NOT strip (fail-safe against wrong merges):
//   - flanker/variant words that denote genuinely different products:
//     intense, elixir, extreme, sport, noir, absolu, l'eau, night, summer…
//     (a Sauvage Elixir is NOT a Sauvage) — anything not in the explicit
//     decoration lists below survives.
//   - bare trailing numbers ("Chanel No 5" keeps its 5; only numbers glued to
//     a size unit are treated as sizes).
//   - anything whose removal would empty the model (falls back unstripped).
//
// Key format (v2):  "v2|<category>|<brand>|<model>"
//   - category IS key material (same brand+model in a different category is a
//     different memory row — fail-safe against cross-category collisions).
//   - brand and model are REQUIRED (fail closed). Brand-only memory is a
//     future, separately-keyed concept and is NOT produced or matched here.
// ═══════════════════════════════════════════════════════════════════════════

export const MEMORY_KEY_VERSION = 2;

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

// ─── v2 decoration stripping ────────────────────────────────────────────────
// Operates on the FOLDED v1 model key (lowercase, single-spaced, alnum-only
// tokens). Removes trailing identity decorations — metadata that varies scan
// to scan without changing which product this is. FROZEN once v2 rows exist;
// mirrored exactly by rm_strip_decorations_v2() in migration 20260718000001.
//
// Multi-token concentration phrases, stripped as a unit (so 'eau de parfum'
// never leaves a dangling 'eau de').
const DECORATION_PHRASES_V2 = [
  /\s+eau de (?:parfum|toilette|cologne)$/,
  /\s+eau fraiche$/,
  /\s+extrait de parfum$/,
];
// Single trailing tokens that are pure decorations. Deliberately small and
// conservative — flanker words (intense/elixir/extreme/sport/noir/absolu…)
// are real product distinctions and MUST stay out of this list.
const DECORATION_TOKENS_V2 = new Set([
  'edp', 'edt', 'edc', 'parfum', 'extrait', 'cologne', 'tester',
]);
const SIZE_UNIT_V2 = /^(?:ml|g|l|oz)$/;
const NUM_WITH_UNIT_V2 = /^\d+(?:ml|g|l|oz)$/;

// Pop one trailing size expression from tokens ("100 ml", "100ml", "3 4 oz"
// — the last being how foldKeyPart renders "3.4oz" — and "1 7 fl oz").
// Bare numbers are only consumed as part of a size, never alone: 'no 5' in
// "Chanel No 5" must survive. Returns true when something was popped.
function popTrailingSizeV2(tokens) {
  const n = tokens.length;
  if (n >= 2 && SIZE_UNIT_V2.test(tokens[n - 1])) {
    let j = n - 2;
    if (tokens[n - 1] === 'oz' && tokens[j] === 'fl') j--;
    let sawNumber = false;
    while (j >= 0 && /^\d+$/.test(tokens[j])) { j--; sawNumber = true; }
    if (sawNumber && j >= 0) { tokens.length = j + 1; return true; }
    return false; // unit without a number ("Solid Gold G") — not a size
  }
  if (n >= 2 && NUM_WITH_UNIT_V2.test(tokens[n - 1])) {
    tokens.pop();
    return true;
  }
  return false;
}

// Strip trailing decorations iteratively ("rare reef edp 100ml" needs two
// passes). Fail-safe: never returns empty — if stripping consumes the whole
// model ("EDP" alone), the input is returned unchanged.
function stripModelDecorationsV2(foldedModel) {
  let out = foldedModel;
  for (;;) {
    let next = out;
    for (const re of DECORATION_PHRASES_V2) {
      const stripped = next.replace(re, '').trim();
      if (stripped && stripped !== next) next = stripped;
    }
    const tokens = next.split(' ');
    while (tokens.length > 1 && DECORATION_TOKENS_V2.has(tokens[tokens.length - 1])) tokens.pop();
    while (tokens.length > 1 && popTrailingSizeV2(tokens)) { /* keep popping sizes */ }
    next = tokens.join(' ');
    if (next === out) break;
    out = next;
  }
  return out || foldedModel;
}

// Build the v2 exact-product memory key. Fail closed: every missing or
// degenerate input returns { ok: false, reason } and NO key.
//
// Pipeline: v1 (brand-prefix strip → variant-suffix collapse → fold), then
// stripModelDecorationsV2 on the folded result — see header for why v2 must
// stay a pure post-processing of v1.
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
  // variant suffix, then fold (v1) — then strip identity decorations (v2).
  const modelKey = stripModelDecorationsV2(
    foldKeyPart(normalizeModelKeyV1(stripBrandPrefixV1(brand, model)))
  );

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
