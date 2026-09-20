// ══════════════════════════════════════════════════════════════════════════════
// EVIDENCE PROVENANCE  ·  api/_lib/pricing-authority.js
//
// R2-H2. WHAT KIND OF EVIDENCE DO WE ACTUALLY HAVE, AND WHO PRODUCED IT?
//
// The valuation guard decides what a piece of evidence ENTITLES you to. This
// module decides what evidence EXISTS. They are separated because they fail
// differently: the guard is a pure function of its arguments and must stay that
// way, while this module has to read the pipeline's messy real shapes — Vision's
// response, Stage 1's candidate arrays, the OCR block.
//
// THE FINDING THIS EXISTS TO CLOSE
// `resolveEnvelopeKey` read `subcategory`, `product_type`, `brand_candidates`
// and `model_candidates` to choose a pricing bucket. Every one of those is a
// string the MODEL WROTE about a photograph. With no brand recognised, no model
// recognised, no OCR and no catalog row, one field was enough:
//
//   subcategory: (none)      -> electronics          hard  6,400   ₪20,000 refused
//   subcategory: 'laptop'    -> electronics:laptop   hard 24,000   ₪20,000 ACCEPTED
//
// Twelve buckets sit above their category parent's ceiling, and the previous
// round's record said four. The gap was not a number that was too low; it was
// that entry to those buckets was governed by NOTHING.
//
// WHY NOT A CONFIDENCE THRESHOLD
// Two earlier attempts were withdrawn. The first gated on `evidence`, a
// free-form string the model writes about its own reasoning — relabelling
// 'readable_text' to 'shape_only' inverted the rule, handing WIDER permission to
// the WEAKER class. The second baselined on the canonical category and degraded
// a legitimate ₪12,000 laptop. Both failed the same way: they asked the model
// how sure it was, in different words.
//
// So nothing here reads a confidence, and nothing here reads a self-describing
// label. Each class is established by an artefact whose PRODUCER is known:
//
//   ANCHOR        a GetWorth-held catalog row the caller already proved
//                 compatible. GetWorth's own data, not the photograph.
//   OBJECT_CLASS  a classifier said what kind of object this is — Google Vision
//                 labels/logos/webEntities at or above the floor the recognition
//                 path already uses. A sticker cannot forge it.
//   BRAND_TEXT    a brand name that was READ OFF THE ITEM: the candidate string
//                 must actually occur in the text Vision/OCR returned. Not the
//                 candidate's own `evidence` field, which is model prose.
//   PRODUCT_TEXT  the same test for a model/product string.
//   DERIVED       everything Stage 1 or Stage 2 WROTE — subcategory,
//                 product_type, and the candidate strings themselves. Always
//                 present, and on its own it entitles you to nothing beyond the
//                 parent category.
//
// BRAND_TEXT AND PRODUCT_TEXT ARE STILL ATTACKER-REACHABLE, ON PURPOSE. Printing
// "ROLEX" on a sticker does establish BRAND_TEXT — that is what the class MEANS.
// The protection is that no bucket above its parent's ceiling accepts text
// alone: `watches:luxury` wants BRAND_TEXT *and* PRODUCT_TEXT, and the
// electronics buckets want OBJECT_CLASS, which is a classifier verdict about the
// object rather than about the writing on it. See BUCKET_AUTHORITY in
// api/_lib/valuation-guard.js, where the requirement is declared per bucket
// because the financial consequence differs per bucket.
//
// NO IMPORTS, NO CLOCK, NO ENV — a function of its arguments, like the guard.
// ══════════════════════════════════════════════════════════════════════════════

/** The five evidence classes. Declaration order is documentation, not precedence. */
export const EVIDENCE = Object.freeze({
  ANCHOR: 'ANCHOR',
  OBJECT_CLASS: 'OBJECT_CLASS',
  BRAND_TEXT: 'BRAND_TEXT',
  PRODUCT_TEXT: 'PRODUCT_TEXT',
  DERIVED: 'DERIVED',
});

export const EVIDENCE_CLASSES = Object.freeze(Object.values(EVIDENCE));

// The same floor the recognition path applies to Vision labels, logos and
// webEntities (api/analyze.js VISION_SIGNAL_FLOOR). Restated rather than imported
// because this module takes no imports; the two values are asserted equal in
// tests/envelope-authority.test.mjs so they cannot drift.
export const OBJECT_CLASS_SCORE_FLOOR = 0.5;

// ── A CONFIDENCE IS A PROBABILITY  ·  the canonical parser, and the only one ──
//
// This function was written inside the valuation guard after an independent
// reviewer walked through a gap: `brandC 0.30` refused, `brandC 30` reached
// EXACT_MODEL and a top-tier price. The guard's copy closed the PRICING path. It
// did not close `api/analyze.js`, which reads the same three fields through
// `topBrand?.confidence || 0` and compares `category_confidence` against the
// Vision trigger threshold directly — so a percent-scale confidence still steered
// which stages ran, while the guard correctly refused to price on it.
//
// Two interpretations of one field is the same defect in a quieter register. The
// parser lives here now and analyze.js reads it from here. The guard keeps its
// own byte-identical copy because it takes no imports, and a test asserts the two
// agree over the whole malformed matrix rather than trusting that they do.
//
// Returns NaN for anything malformed. Every comparison against NaN is false, so
// malformed fails closed BY CONSTRUCTION rather than by remembering to check.
// There is no truthiness anywhere in it: `true` is not 1, `"0.95"` is not 0.95.
export function confidence(value) {
  if (typeof value !== 'number') return NaN;      // strings, booleans, objects, arrays
  if (!Number.isFinite(value)) return NaN;        // NaN, Infinity
  if (value < 0 || value > 1) return NaN;         // a probability, not a percentage
  return value;
}

/** Lower-cased alphanumeric words. The unit both sides of a text match use. */
function words(text) {
  return String(text ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/**
 * Is `needle` present in `haystackWords` as a contiguous run of WHOLE words?
 *
 * Whole words, not substrings: "G502" must not be established by "G5020", and a
 * two-letter brand must not be established by a longer word that contains it.
 * Multi-word product names ("Detect Power Blender Pro") match as a phrase.
 */
function phrasePresent(needle, haystackWords) {
  const n = words(needle);
  if (n.length === 0) return false;
  for (let i = 0; i + n.length <= haystackWords.length; i++) {
    let ok = true;
    for (let j = 0; j < n.length; j++) {
      if (haystackWords[i + j] !== n[j]) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}

/** Every string Vision or OCR actually READ off the item, as one word list. */
function readText(recognition, visionData) {
  return words([
    ...(recognition?.ocr_text?.raw_texts || []),
    ...(visionData?.text || []),
    ...((visionData?.logos || []).map((l) => (l && l.description) || '')),
  ].join(' '));
}

/**
 * Every object-class token a CLASSIFIER produced, at or above the score floor.
 *
 * Filtered here as well as at the parse, because this module must not depend on
 * having been handed already-filtered data: `parseVisionResponse` filters, but a
 * caller that assembles `visionData` by hand — a test, a future Phase-B path —
 * would not. `webEntities` arrive as bare strings, already filtered at the same
 * floor by the parser.
 *
 * A model-written `subcategory` is NOT here. That is the whole point.
 */
function objectClassTokens(visionData) {
  const out = [];
  for (const l of (visionData?.labels || [])) {
    if (l && l.description && Number(l.score) >= OBJECT_CLASS_SCORE_FLOOR) out.push(l.description);
  }
  for (const l of (visionData?.logos || [])) {
    if (l && l.description && Number(l.score) >= OBJECT_CLASS_SCORE_FLOOR) out.push(l.description);
  }
  for (const e of (visionData?.webEntities || [])) {
    if (typeof e === 'string' && e) out.push(e);
  }
  return out;
}

/**
 * What evidence exists for this scan.
 *
 * Returns { classes: Set<string>, object_class_tokens: string[], detail }.
 * `classes` is what the guard consumes; the rest is provenance for the record.
 *
 * TOTAL and FAIL-CLOSED: any shape of input yields at least DERIVED, never
 * throws, and a missing or garbled field simply fails to establish its class.
 */
export function deriveEvidence({ recognition = null, visionData = null, anchor = null } = {}) {
  const classes = new Set([EVIDENCE.DERIVED]);
  const detail = { brand_text: null, product_text: null, anchor_id: null };

  if (anchor && typeof anchor === 'object' && !Array.isArray(anchor)) {
    classes.add(EVIDENCE.ANCHOR);
    detail.anchor_id = anchor.id ?? null;
  }

  const objectTokens = objectClassTokens(visionData);
  if (objectTokens.length > 0) classes.add(EVIDENCE.OBJECT_CLASS);

  // A NAME IS ESTABLISHED BY BEING READ, NOT BY BEING CLAIMED.
  // The candidate's own `evidence` string is deliberately unread: gating on it
  // was the first withdrawn version of this rule, and it inverted under
  // relabelling. The test here is whether the name OCCURS in the text that came
  // off the item, which is an artefact rather than an assertion.
  const read = readText(recognition, visionData);
  const brand = recognition?.brand_candidates?.[0]?.brand;
  const model = recognition?.model_candidates?.[0]?.model;
  if (typeof brand === 'string' && phrasePresent(brand, read)) {
    classes.add(EVIDENCE.BRAND_TEXT);
    detail.brand_text = brand;
  }
  if (typeof model === 'string' && phrasePresent(model, read)) {
    classes.add(EVIDENCE.PRODUCT_TEXT);
    detail.product_text = model;
  }

  return { classes, object_class_tokens: objectTokens, detail };
}

/** The serialisable form of an evidence set: a stable, sorted array of names. */
export function evidenceList(input) {
  const classes = input instanceof Set ? input : deriveEvidence(input || {}).classes;
  return EVIDENCE_CLASSES.filter((c) => classes.has(c));
}

// ── §6  A CATEGORY IS A WORD, NOT A SUBSTRING  ·  N-4 ────────────────────
//
// THE PROPERTY
//   A category matcher fires because the string NAMES that category, never
//   because it happens to CONTAIN those letters.
//
// TWO CONSUMERS, ONE PREDICATE. The valuation guard picks a pricing bucket and
// api/_lib/category.js picks a canonical name, and BOTH used substrings:
// `cat.includes('watch')` and `/watch/`. English obliged:
//
//   "Tablet"    contains "table"  -> FURNITURE, hard_max 16,000
//   "Watchdog"  contains "watch"  -> watches,   hard_max  6,400
//   "Scorecard" contains "car"    -> vehicles
//   "Bookcase"  contains "book"   -> books,     hard_max    480
//
// An iPad whose category came back "Tablet" was priced under the FURNITURE
// envelope. CB-12 — the property whose whole job is catching a category that
// gains an envelope it should not have — could not see it, because CB-12 compares
// the raw string against the canonical one and here BOTH were wrong in the same
// direction. A property can only observe a disagreement it is pointed at.
//
// It lives HERE, in the module both import, for the same reason. The one
// word-anchored alias the table already had (`\bcars?\b`) disagreed with the
// guard's `includes('car')`, and the corpus dutifully reported "Caravan" as a
// safe narrowing — recording the drift as a feature instead of finding the bug.
//
// TOKENS DECLARE HOW THEY MATCH. Guessing the mode is what produced the defect:
// 'table' and 'electron' look alike and behave completely differently.
//   'word' — the whole word, tolerating a plural: `table` matches "table" and
//            "tables", never "tablet"; `watch` matches "watches", never
//            "watchdog"; `book` matches "books", never "bookcase".
//   'stem' — a word-INITIAL stem, for the cases where the category name is a
//            genuine inflection: `electron` must reach "Electronics", `furni`
//            must reach "Furniture", `jewel` must reach "Jewelry".
export const TOKEN_MODE = Object.freeze({
  // category-level
  electron: 'stem', furni: 'stem', sofa: 'word', chair: 'word', table: 'word',
  vehicle: 'word', car: 'word', motor: 'stem', watch: 'word',
  cloth: 'stem', fashion: 'stem', apparel: 'word',
  sport: 'stem', fitness: 'word', outdoor: 'stem',
  smoking: 'word', tobacco: 'word', vape: 'stem',
  home: 'word', household: 'word', kitchen: 'word', clean: 'stem',
  beauty: 'word', cosmetic: 'stem',
  book: 'word', toy: 'word', game: 'word', gaming: 'word',
  tool: 'word', hardware: 'word',
  food: 'word', beverage: 'stem',
  bag: 'word', handbag: 'word', backpack: 'word', jewel: 'stem',
  // subcategory / product_type level
  laptop: 'word', notebook: 'word', tablet: 'word',
  monitor: 'word', display: 'word', tv: 'word', television: 'word',
  camera: 'word', speaker: 'word', printer: 'word', keyboard: 'word',
  headphone: 'stem', earphone: 'stem',
  phone: 'word', mobile: 'word', smartphone: 'word', smartwatch: 'word',
  ring: 'word', necklace: 'word', bracelet: 'word',
});

const WORD_SPLIT = /[^a-z0-9]+/;

/** Does `text` name `token`, under the token's DECLARED match mode? */
export function names(text, token) {
  const mode = TOKEN_MODE[token];
  // An undeclared token cannot match. Fail-closed: adding a matcher without
  // declaring how its word behaves must break loudly, not silently substring.
  if (!mode) return false;
  for (const w of String(text || '').toLowerCase().split(WORD_SPLIT)) {
    if (!w) continue;
    if (mode === 'stem') { if (w.startsWith(token)) return true; continue; }
    if (w === token || w === token + 's' || w === token + 'es') return true;
  }
  return false;
}

/** Every category token declared above. The corpus generator reads THIS. */
export const CATEGORY_TOKENS = Object.freeze(Object.keys(TOKEN_MODE));
