// ═══════════════════════════════════════════════════════════════════════════
// GW-OPENAI-RECOGNITION-001 — TOKEN HELPERS
// ═══════════════════════════════════════════════════════════════════════════
//
// Two DIFFERENT questions are answered here, and keeping them apart is the
// whole point of this file:
//
//   "is this text worth anything at all?"  -> carriesIdentifyingText()
//       Boilerplate SHOULD be discarded. "CE", "OK", "12", "MADE IN CHINA"
//       identify nothing, and letting them count unlocked the silhouette clamp
//       on most of the fleet (CE is printed on every compliant device sold in
//       Israel).
//
//   "is this token a discriminator?"       -> isNoise() / LABEL_NOISE
//       Boilerplate should be discarded, but variant suffixes and category
//       nouns MUST NOT be: pro/max/plus separate siblings, and "Magic Mouse"
//       is a model name. A list tuned for the first question would rebuild the
//       undersell if reused for the second.
//
// Conflating the two is how both the original clamp bypass and the
// corroboration leaks happened. api/analyze.js's OCR_GENERIC_TOKENS answers
// the FIRST question and is correct for it; it must never be reused for the
// second. Unifying these with analyze.js behind one import is the natural
// follow-up — _lib modules deliberately do not import from analyze.js today
// (see the import-cycle note in valuation-guard.js), which is why this is a
// separate module rather than a shared one already.
// ═══════════════════════════════════════════════════════════════════════════

// ── SHARED TOKEN HELPERS ────────────────────────────────────────────────────
// Module scope because two different questions need them and one of those
// (is this text worth anything?) runs before corroboration does.
export const tokenize = (str) => String(str || '').toLowerCase()
  .split(/[^a-z0-9֐-׿]+/i).filter(Boolean);

// Tokens that appear ON labels but are never part of a model name. Kept
// DELIBERATELY SHORT. The obvious additions — pro, max, plus, mini, lite,
// ultra, air, wireless, se — are exactly the tokens that DISTINGUISH SIBLINGS
// ("G Pro Wireless" vs "G Pro", "iPhone 15" vs "15 Pro Max"), so dropping them
// would rebuild the undersell this check exists to prevent. Category nouns
// (gaming, mouse) are excluded for the same reason: "Magic Mouse" is a model
// name.
//
// api/analyze.js has an overlapping OCR_GENERIC_TOKENS list. It is NOT shared:
// _lib modules deliberately do not import from analyze.js (see the
// import-cycle note in valuation-guard.js), and that list drops the variant
// suffixes, which would be wrong for corroboration. Unifying them behind a
// shared module is a follow-up, noted so the duplication is a decision rather
// than an accident.
export const LABEL_NOISE = new Set([
  'model', 'serial', 'sn', 'no', 'number', 'made', 'in', 'by',
  'china', 'vietnam', 'taiwan', 'japan', 'korea', 'india', 'thailand',
  'warranty', 'certified', 'designed', 'assembled', 'patent', 'patents',
  'ce', 'fcc', 'rohs', 'ul', 'weee', 'caution', 'warning',
  'inc', 'ltd', 'llc', 'corp', 'co', 'gmbh',
  'the', 'and', 'for', 'with', 'of', 'ok', 'new',
]);
// Electrical ratings (5v, 1.5a, 3w, 60hz) and serial-shaped runs.
const isRating = (t) => /^\d+(\.\d+)?(v|a|ma|w|hz|khz|mah|wh)$/.test(t);
const isSerial = (t) => t.length >= 6 && (t.match(/\d/g) || []).length >= 6;
export const isNoise  = (t) => LABEL_NOISE.has(t) || isRating(t) || isSerial(t);
// Same shape rule analyze.js uses: an alphanumeric code identifies a product
// on its own (G502, WH-1000XM5, A2251).
export const isModelShapedToken = (t) => /[a-z][0-9]|[0-9][a-z]|[0-9]{3,}/i.test(t);

// REVIEW FINDING (recognition reviewer, round 3). `hasReadableText` asked only
// "is there a run of >=2 alphanumerics", so "CE", "OK", "12", "FC",
// "MADE IN CHINA" and "CERTIFIED" each unlocked the silhouette clamp and let a
// 0.96 guess resolve to `exact`. CE is printed on every compliant device sold
// in Israel, so that is not an edge case — it is most of the fleet.
//
// The question here is NOT "is this token a discriminator" (that is
// corroboration's job, where the noise list must stay small). It is "is this
// text worth anything at all", and for THAT question boilerplate should be
// discarded. A string carries identifying content when it has at least one
// token that is model-shaped, or is a real word we have no reason to treat as
// boilerplate.
export const carriesIdentifyingText = (entry) =>
  tokenize(entry).some((t) => isModelShapedToken(t) || (t.length >= 3 && !isNoise(t)));
