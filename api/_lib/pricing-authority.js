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
  // C-1. ANCHOR IS MARKET-PRICE EVIDENCE. CATALOG_IDENTITY IS NOT.
  //
  // These were one class, and the conflation was the round-3 CRITICAL. A row
  // that merely LOOKS LIKE the same product was granted ANCHOR, which
  //   - satisfied every bucket entry requirement,
  //   - made derivePricingSource return stage2_comp_anchored / HIGH,
  //   - made resolveValuationVerdict return ANCHORED,
  //   - and therefore switched V-MARKET-EVIDENCE off entirely.
  //
  // So the model's own invented number shipped at the system's TOP grade
  // because somebody had once submitted a matching name. The entry point is
  // community-writable: api/analyze.js selects approved `product_candidates`
  // with no price column at all and pads `retail_price_ils: null`.
  //
  // A catalog row tells GetWorth "this looks like the same product". That is a
  // statement about IDENTITY. It says nothing whatever about what the product
  // is WORTH, and the two must not be spellable with the same word.
  ANCHOR: 'ANCHOR',
  CATALOG_IDENTITY: 'CATALOG_IDENTITY',
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

/**
 * The price an anchor may be trusted to carry, or null.
 *
 * C-1. Deliberately the SAME semantics as `positivePriceOrNull` in the guard,
 * and deliberately strict where the old code was not: `Number()` alone accepted
 * `"900"`, and `!!ctx.anchor` accepted `{}`, `[]`, a Date and `{retail_price_ils:
 * null}`. A price is a finite number strictly greater than zero; everything else
 * — null, 0, negative, NaN, Infinity, a numeric string, a missing field, an
 * object — is ABSENT, not small.
 *
 * Reads `retail_price_ils` then `avg_used_price_ils`, the two columns
 * api/analyze.js already treats as an anchor's price, in that order.
 */
export function anchorPrice(anchor) {
  if (!anchor || typeof anchor !== 'object' || Array.isArray(anchor)) return null;
  for (const key of ['retail_price_ils', 'avg_used_price_ils']) {
    const v = anchor[key];
    if (typeof v !== 'number') continue;       // no coercion: "900" is not a price
    if (!Number.isFinite(v) || v <= 0) continue;
    return v;
  }
  return null;
}

/** Does this row carry usable market-price evidence? */
export function isPricedAnchor(anchor) {
  return anchorPrice(anchor) !== null;
}

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

// DECORATION IS NOT PART OF A WORD.
//
// Combining marks (Hebrew niqqud, Arabic harakat), the Arabic TATWEEL stretch
// mark and the zero-width joiners are all ornament on a letter, and none of
// them changes which word was written. Stripping them is a rule about WRITING
// SYSTEMS rather than about any particular phrase, which is why a marker list
// could never have enumerated its way past the witness that found it:
//
//   مناسب لـ   ->  the preposition ل followed by U+0640, matching no marker
//
// Built from an escape STRING rather than written as a regex literal, so the
// code points stay legible in the source instead of being invisible characters
// a reader has to hex-dump.
const DECORATION = new RegExp("[\\p{M}\\u0640\\u200B-\\u200F\\u2060\\uFEFF]", "gu");
/** Lower-cased alphanumeric words. The unit both sides of a text match use. */
function words(text) {
  // R5-H1. THIS ERASED EVERY NON-LATIN SCRIPT.
  //
  // Splitting on /[^a-z0-9]+/ after lowercasing treats every Hebrew, Arabic,
  // Cyrillic or CJK character as a SEPARATOR, so it is deleted rather than seen.
  // "תואם ל Apple iPhone" — "compatible with Apple iPhone", the ordinary wording
  // on accessory packaging in this product's primary market — tokenised to
  // ["apple","iphone"], a clean product label. The compatibility filter was not
  // merely English-only; the text it was supposed to read did not survive to it.
  //
  // NFKC first, so fullwidth "ｆｏｒ" and other compatibility forms fold to their
  // ASCII equivalents before anything looks at them. Unicode letter/number
  // classes so a script the author did not think of is TOKENISED rather than
  // deleted — a word in a language we cannot read is still a word, and the rules
  // below fail closed on words they do not recognise.
  // REC7-C1. AND COMBINING MARKS ARE NOT LETTERS.
  //
  // Found by this round's own negative-space pass, not by a reviewer: the
  // Arabic "مناسب لـ" ("suitable for") survived every rule, because `لـ` is the
  // preposition ل followed by TATWEEL (U+0640) — a typographic stretch mark
  // that carries no sound and no meaning. NFKC does not remove it, so the token
  // was `لـ`, which matches no marker, and a reference line was read as a
  // product label.
  //
  // Stripping \p{M} and the joiners is a rule about WRITING SYSTEMS rather than
  // about any particular phrase: Hebrew niqqud, Arabic harakat and tatweel,
  // zero-width joiners and Latin combining accents are all decoration on a
  // letter, and none of them changes which word was written. A marker list can
  // never enumerate its way past this, because the variants are not words.
  return String(text ?? '')
    .normalize('NFKD')
    .replace(DECORATION, '')
    .normalize('NFKC')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
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

// ── H-5 / H-6. WHO READ THE TEXT, AND WAS IT SAYING THIS IS THE PRODUCT? ─────
//
// `readText` used to pool THREE sources into one flat word list:
//   recognition.ocr_text.raw_texts   <- STAGE 1. The model's own transcription.
//   visionData.text                  <- Google Vision. An independent reader.
//   visionData.logos                 <- Google Vision.
//
// Two defects fell out of that, both reported independently.
//
// H-5 SELF-CORROBORATION. `raw_texts` is model output — RECOGNITION_SCHEMA
// declares it, the Stage-1 prompt asks for "exact text found", and the schema is
// never applied. So ONE model call wrote both the brand candidate AND the
// transcription that corroborated it, and BRAND_TEXT meant "the model said it
// twice". DERIVED + DERIVED is not independent corroboration. The bucket that
// falls to text alone is `watches:luxury`, so the class that was easiest to forge
// governed the ₪250,000 ceiling.
//
// api/analyze.js already had the right rule for its own identity upgrade and
// stated the reason: "the model grading its own homework, which is precisely what
// SCAN-022 exists to refuse". Two standards for one question is the defect §6
// removed for category tokens; this is the same move for text corroboration.
//
// H-6 COMPATIBILITY TEXT. Pooling also erased line boundaries, so tokens
// combined across separate detections: `['TAG','HEUER']` established "Tag Heuer".
// And a compatibility label contains the brand and model BY DESIGN — that is what
// it is for. "Compatible with Apple iPhone 15 Pro Max" on a ₪20 silicone case
// yielded BRAND_TEXT + PRODUCT_TEXT and, with the Vision label a case genuinely
// gets, `electronics:iphone` at 24,000 instead of `electronics` at 6,400.
//
// FOUR RULES, matching the predicate analyze.js already applies:
//   1. INDEPENDENT READER ONLY. Vision text and Vision logos. Not raw_texts.
//   2. PER LINE, CONTIGUOUS. Tokens may not pool across detections.
//   3. NO COMPATIBILITY LINES. A line saying "for X" is not a claim to be X.
//   4. A SINGLE-TOKEN MODEL NAME MUST MIX LETTERS AND DIGITS, so a warranty year
//      or a price tag cannot stand in for a model number. Multi-word names are
//      inherently specific and are exempt.
// ── R5-H1. COMPATIBILITY MARKERS, IN THE LANGUAGES THIS MARKET USES ──────────
//
// The previous version was an English-only regex, in a product whose primary
// market writes its accessory packaging in Hebrew. Every one of these passed
// straight through and yielded BRAND_TEXT + PRODUCT_TEXT:
//
//   תואם ל Apple iPhone     pour Apple iPhone     für Apple iPhone
//   מתאים ל Apple iPhone    para Apple iPhone     ｆｏｒ Apple iPhone
//
// A SET OF WHOLE TOKENS, not a regex over a joined string. The tokeniser has
// already applied NFKC and split on Unicode letter boundaries, so a marker is
// matched as a word: "for" matches, "form" and "forest" do not, and no
// backslash-escaped boundary is needed to say so.
//
// Hebrew writes the preposition as a PREFIX (ל + word), so לאייפון is one
// token meaning "for iPhone". `relationOf` handles that separately by prefix,
// because a set of whole words cannot.
//
// NOT A COMPLETE LIST, and it does not need to be: an unrecognised line is
// SUBJECT, and subject lines only ever establish that the NAMED brand was read
// off the item. The classes they grant are bounded by BUCKET_AUTHORITY, which
// requires OBJECT_CLASS from a classifier for every electronics bucket above its
// parent. This is one layer of several, not the only one.
const COMPATIBILITY = new Set([
  // English
  'compatible', 'compatibility', 'compatibles', 'for', 'fits', 'fit', 'fitting',
  'replacement', 'replaces', 'replace', 'suits', 'suitable', 'universal', 'spare',
  'works', 'accessory', 'accessories', 'aftermarket', 'adapter', 'adaptor',
  // Hebrew  (תואם = compatible, מתאים = suitable, ל = for, עבור = for,
  //          חלוף/חילוף = spare/replacement, מיועד = intended for,
  //          מתאימה/תואמת = feminine forms)
  //
  // BOTH SPELLINGS OF חלוף. Hebrew writes the same word with or without the
  // optional yod (ktiv male / ktiv haser), so חלוף and חילוף are one word and a
  // set of exact strings sees two. "חלק חילוף" — the ordinary phrase for a
  // spare part, and one this round's §5 names outright — was read as a product
  // label because only the shorter spelling was listed.
  'תואם', 'תואמת', 'תואמים', 'מתאים', 'מתאימה', 'ל', 'עבור',
  'חלוף', 'חילוף', 'חליפי', 'חליפית', 'אבזר', 'אבזרים', 'מתאימים',
  'מיועד', 'מיועדת', 'מיועדים',
  // Arabic  (متوافق = compatible, مناسب = suitable, ل = for, بديل = replacement)
  'متوافق', 'مناسب', 'يناسب', 'ل', 'بديل', 'ملحق',
  // European
  'pour', 'para', 'per', 'für', 'fur', 'voor', 'til', 'för', 'forå', 'kompatibel',
  'compatibile', 'compatibé', 'ricambio', 'repuesto', 'ersatz', 'zubehör',
  // Cyrillic
  'для', 'совместимый', 'запасной',
]);

// Hebrew and Arabic attach the "for" preposition as a PREFIX to the next word,
// so לאייפון ("for iPhone") is a single token that no whole-word set can
// match. Two letters minimum after the prefix, so the bare preposition and a
// one-letter fragment do not sweep in ordinary words.
// NARROWED after probing: the first draft also matched כ and מ, which mean
// "as/like" and "from", not "for". That suppressed any Hebrew line whose first
// word merely began with one of them — fail-closed, but it would have thrown
// away legitimate Hebrew product labels. ל and ل are the prepositions that
// actually mean "for/to".
const RTL_FOR_PREFIX = /^[לل][א-תء-ي]{2,}$/u;

// ── A SCRIPT WITHOUT SPACES HAS NO WHOLE WORDS TO MATCH ─────────────────────
//
// Found by this round's own adversarial pass. Japanese, Chinese and Korean
// accessory packaging is ordinary in this market — imported goods carry their
// origin labelling — and every one of these defeated the rule outright:
//
//   対応 \n ROLEX SUBMARINER          -> BRAND_TEXT + PRODUCT_TEXT
//   适用于 \n ROLEX SUBMARINER         -> BRAND_TEXT + PRODUCT_TEXT
//   交換用フィルター \n DYSON V15        -> BRAND_TEXT + PRODUCT_TEXT
//
// Two reasons, and only one of them is vocabulary. Han, Kana and Hangul are
// written WITHOUT word separators, so `交換用フィルター` ("replacement filter")
// tokenises to ONE token and a set of whole words cannot match any part of it.
// Adding words to COMPATIBILITY would not have helped; the matching mode is
// what is wrong.
//
// So a token containing CJK is tested by CONTAINMENT rather than by equality —
// which is the correct rule for scriptio continua and the WRONG rule for a
// spaced script, where it would make "form" match "for". The containment test
// is therefore gated on the script, not applied generally.
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
// Kept in the same two kinds as their spaced-script counterparts, so the
// retained record says WHICH relation a line carries rather than only that it
// carries one — §3 asks for the referenced product to stay available as
// structured metadata, and "it was one of the non-subject kinds" is not that.
const CJK_COMPATIBILITY = [
  // Japanese: 対応/互換 compatible, 交換 replacement, 予備 spare, 専用 dedicated-to
  '対応', '互換', '交換', '予備', '専用',
  // Chinese: 适用/適用 suitable for, 兼容 compatible, 替换/更换 replacement, 备用 spare
  '适用', '適用', '兼容', '替换', '替換', '更换', '备用', '備用',
  // Korean: 호환 compatible, 교체 replacement
  '호환', '교체',
];
const CJK_ACCESSORY = [
  'アクセサリ', 'ケース', 'ストラップ', 'フィルター', '充電器', 'カバー', 'バンド', 'ケーブル',
  '配件', '保护套', '手机壳', '表带', '滤芯', '充电器',
  '액세서리', '케이스', '스트랩', '필터', '충전기',
];

/** The relation a CJK token carries by CONTAINMENT, or null. */
function cjkRelation(word) {
  if (!CJK.test(word)) return null;
  if (CJK_COMPATIBILITY.some((m) => word.includes(m))) return RELATION.COMPATIBILITY_TARGET;
  if (CJK_ACCESSORY.some((m) => word.includes(m))) return RELATION.ACCESSORY_TARGET;
  return null;
}

// An ACCESSORY NOUN names what the photographed thing IS, and an accessory is
// defined by the product it attaches to — so a line whose subject is one of
// these is describing a relationship even with no preposition at all.
// "מטען MacBook Pro" and "Charger MacBook Pro" carry no marker word, and the
// host product is still not what was photographed.
//
// This is a REFUSAL list, so an accessory we have not named is treated as a
// subject — the bounded direction. BUCKET_AUTHORITY is the layer behind it: a
// charger cannot reach electronics:macbook without a classifier calling the
// object a laptop, whatever its label says.
const ACCESSORY_NOUN = new Set([
  'charger', 'chargers', 'cable', 'cables', 'adapter', 'adaptor', 'case', 'cases',
  'cover', 'covers', 'strap', 'straps', 'band', 'bands', 'filter', 'filters',
  'blade', 'blades', 'protector', 'protectors', 'ink', 'toner', 'cartridge',
  'sleeve', 'mount', 'holder', 'stand', 'dock', 'lens', 'battery', 'screen',
  // "Replacement Blade" already carries a marker; "Spare part" and "חלק חילוף"
  // name the RELATIONSHIP in the noun itself, which is what this list is for.
  'part', 'parts',
  'מטען', 'כבל', 'מתאם', 'כיסוי', 'רצועה', 'פילטר', 'להב', 'מגן',
  'סוללה', 'מעמד', 'מחסנית', 'עדשה', 'חלק', 'חלקים',
]);

/**
 * The lines an INDEPENDENT reader returned, each already rejected if it is
 * describing compatibility rather than identity.
 *
 * `recognition.ocr_text.raw_texts` is deliberately absent. It remains available
 * to the pipeline as a signal — it just cannot corroborate the same model's own
 * candidate, which is the only thing this function is used for.
 */
// ── R5-C1. THE FLAT `text` ARRAY IS PER-WORD, AND THAT DEFEATED EVERYTHING ────
//
// `parseVisionResponse` builds `visionData.text` as
// `textAnnotations.slice(1).map(t => t.description)`, and Vision's
// textAnnotations[1..] are INDIVIDUAL WORDS. The repo says so in two places. So
// round 4's "per line, contiguous" rule was applied to a list in which every
// "line" was one word:
//
//   ["Replacement","strap","for","ROLEX","SUBMARINER"]
//
// The compatibility token lands in its OWN detection, is dropped alone, and
// every other word survives as a clean single-word line. A replacement strap
// established BRAND_TEXT + PRODUCT_TEXT and entered watches:luxury — hard_max
// 250,000 — off a label that says it is a strap. Round 4's tests passed whole
// phrases as single detections, a shape the parser cannot emit, so they proved
// nothing about production.
//
// `ocr_context.full_text` is textAnnotations[0]: the block Vision returns with
// its reading order and newlines intact. The repo already captures it, and
// already says the flat array "loses" that structure. Lines come from there now.
//
// FAIL CLOSED WITHOUT IT. If full_text is absent the relationship between a
// marker and the words around it cannot be established at ALL, so the flat array
// establishes nothing. It may still refute (a contradiction is safe); it may not
// corroborate. Logos survive either way: a logo is a mark on the object, not a
// sentence about another product.
// ── REC7-C1. A LINE IS NOT A SEMANTIC SCOPE. THE BLOCK IS. ──────────────────
//
// THE VERIFIED FAILURE. Round 5 classified each OCR line on its own, so a
// relation marker protected only the line it happened to land on:
//
//   Replacement strap for ROLEX SUBMARINER      -> DERIVED           refused
//   Replacement strap for \n ROLEX SUBMARINER   -> BRAND+PRODUCT_TEXT  ACCEPTED
//
// Identical packaging, identical words, one newline apart — and the second one
// bought `watches:luxury` and a ₪250,000 ceiling. Every reverse layout did the
// same: the host name printed ABOVE its own relation marker was a clean subject
// line by construction. So did every Hebrew equivalent.
//
// The answer is NOT a newline regex and NOT a longer phrase list. Both of those
// are the same move that failed: enumerate the layouts we happened to think of.
//
// THE AUTHORITY CONTRACT, stated as a property:
//
//   OCR BODY TEXT ALONE MUST NOT UPGRADE A REFERENCED PRODUCT INTO SUBJECT
//   IDENTITY WHEN THE OCR BLOCK CONTAINS ACCESSORY / REFERENCE SEMANTICS.
//
// The unit of judgement is therefore the BLOCK, not the line. A marker anywhere
// in the block says the printed matter is about a relationship, and NOTHING
// printed in that block is permitted to establish subject identity — whichever
// line it sits on, in whichever order, in whichever script. A referenced product
// may still be RETAINED (the per-line relations below are kept in the record so
// a consumer can carry `compatible_with` as structured metadata); it may not
// become the subject.
//
// WHAT STILL CAN ESTABLISH IDENTITY IS AN INDEPENDENT SUBJECT SIGNAL — a
// classifier's verdict about the OBJECT rather than about the writing on it.
// `logos` survive a reference-bearing block for exactly that reason, and they
// are the only thing that does; see `classifiedLines`. The model cannot declare
// its own text to be a visual signal, because no model output reaches this
// function at all: `ocr_text.raw_texts` was removed in round 4 and is still
// absent.
//
// FAIL CLOSED ON AMBIGUITY. A block we could not see in full (see
// `blockProvenance`) is UNKNOWN, and UNKNOWN permits nothing. Authority may
// fall because provenance is uncertain; it may never rise.
export const RELATION = Object.freeze({
  SUBJECT: 'SUBJECT',
  REFERENCE: 'REFERENCE',                     // the block as a whole is about a relationship
  COMPATIBILITY_TARGET: 'COMPATIBILITY_TARGET', // "compatible with X" / "for X" / תואם ל-X
  ACCESSORY_TARGET: 'ACCESSORY_TARGET',       // the line's own subject is an accessory noun
  PACKAGING_REFERENCE: 'PACKAGING_REFERENCE', // "device not included" / "sold separately"
  UNKNOWN: 'UNKNOWN',                         // provenance could not be established
});

/** Bumped when the shape of the provenance record changes. */
export const OCR_PROVENANCE_VERSION = 1;

// The record is BOUNDED, because it is carried in `ocr_context`, serialised into
// `_debug`, and read by code that must not be handed an unbounded structure. The
// caps discard SUBJECT lines only: `block_relation` is decided over every line
// before any capping, so a reference marker in line 900 still governs.
const MAX_BLOCK_LINES = 80;
const MAX_LINE_WORDS = 40;

// PACKAGING_REFERENCE is a PHRASE rule, not a word set, and deliberately tiny.
// "included" and "separately" are ordinary words; "not included" and "sold
// separately" are statements that the thing named is NOT what you are buying —
// which is reference semantics in its purest form. A word-level list here would
// suppress legitimate product labels ("Includes 3 blades"), and suppression is
// not free: it costs real recognition.
const PACKAGING_NEGATION = new Set(['not', 'without', 'excluding', 'excl', 'לא', 'ללא', 'אינו', 'אינה', 'בלי']);
const PACKAGING_INCLUSION = new Set(['included', 'includes', 'include', 'כלול', 'כלולה', 'כלולים']);
const PACKAGING_SOLD = new Set(['sold', 'available', 'נמכר', 'נמכרת']);
const PACKAGING_SEPARATELY = new Set(['separately', 'separate', 'בנפרד']);

/**
 * What is this ONE line doing — describing the object, or naming something the
 * object relates to?
 *
 * Returns a member of RELATION. `SUBJECT` is the default, so a construction we
 * do not recognise is treated as ordinary product text; the protection against
 * an unrecognised marker is the BLOCK rule above plus BUCKET_AUTHORITY, not an
 * ever-growing phrase list.
 */
function relationOfLine(lineWords) {
  let negation = false, inclusion = false, sold = false, separately = false;
  for (const w of lineWords) {
    if (PACKAGING_NEGATION.has(w)) negation = true;
    if (PACKAGING_INCLUSION.has(w)) inclusion = true;
    if (PACKAGING_SOLD.has(w)) sold = true;
    if (PACKAGING_SEPARATELY.has(w)) separately = true;
  }
  if ((negation && inclusion) || (sold && separately)) return RELATION.PACKAGING_REFERENCE;
  for (const w of lineWords) {
    if (COMPATIBILITY.has(w)) return RELATION.COMPATIBILITY_TARGET;
    // Hebrew/Arabic attach the preposition to the following word.
    if (RTL_FOR_PREFIX.test(w)) return RELATION.COMPATIBILITY_TARGET;
    // Han/Kana/Hangul have no word separators, so the token IS the phrase.
    if (cjkRelation(w) === RELATION.COMPATIBILITY_TARGET) return RELATION.COMPATIBILITY_TARGET;
  }
  for (const w of lineWords) {
    if (ACCESSORY_NOUN.has(w)) return RELATION.ACCESSORY_TARGET;
    if (cjkRelation(w) === RELATION.ACCESSORY_TARGET) return RELATION.ACCESSORY_TARGET;
  }
  return RELATION.SUBJECT;
}

/**
 * The BOUNDED, block-level provenance record for one OCR block.
 *
 * `truncated` means "this string may not be the whole block". It is the one
 * input that cannot be recovered by looking harder at the text, so it is passed
 * in by the producer rather than guessed at here — and it forces UNKNOWN, which
 * permits nothing. See §4 (TRUNCATION MONOTONICITY): `parseVisionResponse`
 * calls this on the FULL annotation and caps `full_text` afterwards, so the
 * display cap cannot change what the text is entitled to.
 *
 * Returns `null` for a block with no words at all — there is nothing to say
 * about it, and `null` is distinguishable from "a block that permits nothing".
 */
export function classifyOcrBlock(text, { truncated = false } = {}) {
  const src = typeof text === 'string' ? text : '';
  const lines = [];
  let lineCount = 0;
  let referenceBearing = false;
  for (const raw of src.split(/[\r\n]+/)) {
    const w = words(raw);
    if (!w.length) continue;
    lineCount++;
    const relation = relationOfLine(w);
    if (relation !== RELATION.SUBJECT) referenceBearing = true;
    if (lines.length < MAX_BLOCK_LINES) {
      lines.push(Object.freeze({ words: Object.freeze(w.slice(0, MAX_LINE_WORDS)), relation }));
    }
  }
  if (lineCount === 0) return null;
  const block_relation = truncated
    ? RELATION.UNKNOWN
    : (referenceBearing ? RELATION.REFERENCE : RELATION.SUBJECT);
  return Object.freeze({
    version: OCR_PROVENANCE_VERSION,
    truncated: !!truncated,
    line_count: lineCount,
    block_relation,
    // THE ONE BIT THE EVIDENCE RULE READS. Named for what it authorises rather
    // than for what it observed, so a consumer cannot mistake "we saw a
    // relation" for "you may use this text".
    subject_text_permitted: block_relation === RELATION.SUBJECT,
    lines: Object.freeze(lines),
  });
}

/**
 * The provenance record for this scan's OCR block, or null.
 *
 * PREFERS THE PRODUCER'S RECORD. `parseVisionResponse` computes it from the
 * untruncated annotation, so when it is present the display cap is irrelevant.
 *
 * WITHOUT IT, FAIL CLOSED. A `visionData` assembled by hand — a test, a stale
 * cache row written before this record existed, a future Phase-B path — carries
 * a `full_text` we cannot prove is complete, so it is classified as TRUNCATED
 * and permits nothing. That is the bounded direction, and it is the direction
 * §4 requires: uncertainty may only ever cost authority.
 */
function blockProvenance(visionData) {
  const ctx = visionData?.ocr_context;
  if (!ctx || typeof ctx !== 'object') return null;
  const pre = ctx.provenance;
  if (pre && typeof pre === 'object' && pre.version === OCR_PROVENANCE_VERSION && Array.isArray(pre.lines)) {
    return pre;
  }
  const full = ctx.full_text;
  if (typeof full !== 'string' || !full.length) return null;
  return classifyOcrBlock(full, { truncated: true });
}

/**
 * May the SUBJECT lines of this record be used as identity evidence?
 *
 * THE FLAG IS CHECKED AND THEN RE-DERIVED, because the record does not always
 * come from this process. `parseVisionResponse` writes it, but the parsed
 * result is CACHED in `vision_cache` and comes back as plain JSON — so by the
 * time it reaches here it is a row from a database, and a row is data, not a
 * verdict. `subject_text_permitted: true` sitting beside a line whose relation
 * is COMPATIBILITY_TARGET is a contradiction, and the fail-closed reading of a
 * contradiction is to refuse.
 *
 * This is the same doctrine as everywhere else in this module: a claim about
 * evidence is not evidence. The producer's flag is necessary and not sufficient.
 */
function subjectLinesPermitted(prov) {
  if (!prov || prov.subject_text_permitted !== true) return false;
  if (prov.truncated === true) return false;
  if (!Array.isArray(prov.lines)) return false;
  for (const line of prov.lines) {
    if (!line || line.relation !== RELATION.SUBJECT) return false;
  }
  return true;
}

/**
 * The word arrays a name may be looked for in.
 *
 * TWO SOURCES, AND ONLY ONE OF THEM IS TEXT.
 *   · BODY TEXT — the OCR block's lines, and ONLY when block provenance says
 *     the block is about its own subject. A reference-bearing or UNKNOWN block
 *     contributes nothing at all, whichever line the name sits on.
 *   · LOGOS — a classifier's verdict that a mark is ON the object. This is the
 *     independent subject signal the contract permits, and it survives a
 *     reference-bearing block precisely because it is not body text.
 */
function classifiedLines(visionData) {
  const out = [];
  const prov = blockProvenance(visionData);
  if (prov && subjectLinesPermitted(prov)) {
    for (const line of prov.lines) {
      if (Array.isArray(line.words) && line.words.length) out.push(line.words);
    }
  }
  for (const l of (visionData?.logos || [])) {
    const d = l && l.description;
    if (typeof d !== 'string') continue;
    const w = words(d);
    if (w.length) out.push(w);
  }
  return out;
}

/**
 * Was this scan's OCR block permitted to speak about its own subject?
 *
 * Exported for api/analyze.js, whose Stage-2 identity upgrade asks the SAME
 * question about the SAME block and must not answer it a second way. Two
 * predicates for one question is the defect this file has closed twice already.
 */
export function subjectTextPermitted(visionData) {
  const prov = blockProvenance(visionData);
  return subjectLinesPermitted(prov);
}

/** The block-level relation for the record: SUBJECT, REFERENCE or UNKNOWN. */
export function blockRelation(visionData) {
  const prov = blockProvenance(visionData);
  return prov ? prov.block_relation : RELATION.UNKNOWN;
}

/** Is `needle` a contiguous run of whole words within ANY single line? */
function presentOnSomeLine(needle, lines) {
  const n = words(needle);
  if (n.length === 0) return false;
  return lines.some((line) => phrasePresent(needle, line));
}

/**
 * Is this model string specific enough that reading it off the item means
 * anything?
 *
 * NARROWED FROM ITS FIRST DRAFT, which required a single-token name to MIX
 * letters and digits. That rejected "Submariner", "Neverfull" and "Imagination"
 * — real product names that happen to be one word — and the Rolex witness went
 * from watches:luxury to watches for the wrong reason. The rule's actual purpose
 * in api/analyze.js is narrower and is stated there: bare digits let a warranty
 * year ("EXPIRES 2019") or a price tag ("NIS 1299") stand in for a model number.
 *
 * So: a single ALL-DIGIT token is not a model name. Anything else is, and the
 * question of whether it was genuinely READ is answered by provenance instead.
 */
function modelTokenIsSpecific(model) {
  const n = words(model);
  if (n.length === 0) return false;
  if (n.length > 1) return true;                  // "Detect Power Blender Pro"
  return !/^[0-9]+$/.test(n[0]);                  // "submariner" and "g502" yes, "126610" no
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
  const detail = { brand_text: null, product_text: null, anchor_id: null, anchor_price: null };

  // C-1. A compatible row earns CATALOG_IDENTITY. It earns ANCHOR only if it
  // carries a usable price. `{}`, `{id:'x'}`, a Date, and every approved
  // product_candidate (padded `retail_price_ils: null`) land in the first
  // bucket and stop there.
  if (anchor && typeof anchor === 'object' && !Array.isArray(anchor)) {
    classes.add(EVIDENCE.CATALOG_IDENTITY);
    detail.anchor_id = anchor.id ?? null;
    const price = anchorPrice(anchor);
    if (price !== null) {
      classes.add(EVIDENCE.ANCHOR);
      detail.anchor_price = price;
    }
  }

  const objectTokens = objectClassTokens(visionData);
  if (objectTokens.length > 0) classes.add(EVIDENCE.OBJECT_CLASS);

  // A NAME IS ESTABLISHED BY BEING READ, NOT BY BEING CLAIMED.
  // The candidate's own `evidence` string is deliberately unread: gating on it
  // was the first withdrawn version of this rule, and it inverted under
  // relabelling. The test here is whether the name OCCURS in the text that came
  // off the item, which is an artefact rather than an assertion.
  const lines = classifiedLines(visionData);
  const brand = recognition?.brand_candidates?.[0]?.brand;
  const model = recognition?.model_candidates?.[0]?.model;
  if (typeof brand === 'string' && presentOnSomeLine(brand, lines)) {
    classes.add(EVIDENCE.BRAND_TEXT);
    detail.brand_text = brand;
  }
  if (typeof model === 'string' && modelTokenIsSpecific(model) && presentOnSomeLine(model, lines)) {
    classes.add(EVIDENCE.PRODUCT_TEXT);
    detail.product_text = model;
  }

  return { classes, object_class_tokens: objectTokens, detail };
}

// ══════════════════════════════════════════════════════════════════════════════
// V5-2  ·  MODEL_OUTPUT ∩ SERVER_AUTHORITY = ∅
//
// THE DEFECT THE BLACKLIST COULD NOT CLOSE
// `verification` is raw `JSON.parse` of a model response, and the pipeline read
// `verification._pricing_meta.pricing_status` — the field that tells the client
// WHY a price was trusted. Round 5 answered with `MODEL_FORBIDDEN_KEYS`, a list
// of eighteen names to delete. A list of names is a list of the forgeries
// somebody thought of. The nineteenth key — `pricing_provenance`,
// `price_authority`, `_pricing_meta_v2`, a Cyrillic `а` in `pricing_status`, or
// whatever a future model invents — was authority again.
//
// THE CONTRACT, stated as a property rather than as a list:
//
//   AN AUTHORITATIVE PRICING FIELD IS ONE THIS MODULE MINTED.
//
// Not one that has the right NAME, or the right SHAPE, or survived the right
// filter. `sealServerAuthority` records the object's IDENTITY in a WeakSet that
// exists only inside this module's closure. `readServerAuthority` returns the
// object only if it is in that set.
//
// A model emits JSON. `JSON.parse` mints fresh objects. A fresh object is not in
// the WeakSet and cannot be put there — nothing exported adds to it except
// `sealServerAuthority`, whose call sites are server code by construction. So:
//
//   · an invented key the schema has never heard of  -> not authority
//   · a perfect byte-for-byte forgery of _pricing_meta -> not authority
//   · a Unicode confusable, a prototype-shaped name, a nested array -> not authority
//   · a key nobody has predicted, in a round nobody has run yet -> not authority
//
// and none of those facts depends on anyone maintaining a list. The allowlist in
// api/analyze.js (`sealModelVerification`) is the second layer: it bounds which
// keys a model may contribute AT ALL. This is the layer that decides which ones
// carry authority, and it is the one that stays correct when the allowlist is
// wrong.
//
// WHY A WeakSet AND NOT A SYMBOL PROPERTY. A symbol survives `structuredClone`
// and can be re-attached by any code holding the symbol; membership of a closed
// WeakSet cannot be forged, copied, or serialised into existence. It also means
// a seal does NOT survive JSON round-tripping — which is correct: a value that
// has been through the wire is no longer the object this server minted, and
// treating it as though it were is the whole defect.
const SERVER_AUTHORITY = new WeakSet();

/**
 * Mint an authoritative, server-owned pricing record.
 *
 * FROZEN, so the value cannot be mutated after it has been vouched for. Returns
 * the same object it sealed, so a call site reads `_pricing_meta: seal({...})`.
 */
export function sealServerAuthority(fields) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return null;
  const sealed = Object.freeze({ ...fields });
  SERVER_AUTHORITY.add(sealed);
  return sealed;
}

/** Was this value minted by `sealServerAuthority`? */
export function isServerAuthority(value) {
  return typeof value === 'object' && value !== null && SERVER_AUTHORITY.has(value);
}

/**
 * The authoritative record, or null.
 *
 * EVERY consumer of server pricing provenance reads through here. `null` is the
 * same answer a missing field gives, so a forged one degrades to "no
 * provenance" — the fail-closed direction — rather than to an error a caller
 * might swallow.
 */
export function readServerAuthority(value) {
  return isServerAuthority(value) ? value : null;
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
