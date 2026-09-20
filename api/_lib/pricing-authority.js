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
  return String(text ?? '')
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
  //          חלוף = spare/replacement, מתאימה/תואמת = feminine forms)
  'תואם', 'תואמת', 'תואמים', 'מתאים', 'מתאימה', 'ל', 'עבור',
  'חלוף', 'חליפי', 'אבזר', 'אבזרים', 'מתאימים',
  // Arabic  (متوافق = compatible, ل = for, بديل = replacement)
  'متوافق', 'ل', 'بديل', 'ملحق',
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
  'מטען', 'כבל', 'מתאם', 'כיסוי', 'רצועה', 'פילטר', 'להב', 'מגן',
  'סוללה', 'מעמד', 'מחסנית', 'עדשה',
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
const RELATION = Object.freeze({
  SUBJECT: 'SUBJECT',
  REFERENCE: 'REFERENCE',      // compatible-with / for / replacement-for / accessory-for
});

/**
 * Split the OCR block into lines, classify each line's RELATIONSHIP to the
 * photographed object, and return only the SUBJECT lines as word arrays.
 *
 * A line carrying a compatibility marker in ANY language is a REFERENCE: it
 * describes what the item works WITH, not what it IS. The whole line is dropped
 * rather than the marker alone, because accessory packaging writes the host
 * product beside the marker and splitting the difference is how the per-word
 * shape defeated the previous attempt.
 */
function classifiedLines(visionData) {
  const out = [];
  const full = visionData?.ocr_context?.full_text;
  if (typeof full === 'string' && full.length) {
    for (const raw of full.split(/[\r\n]+/)) {
      const w = words(raw);
      if (!w.length) continue;
      if (relationOf(w) === RELATION.REFERENCE) continue;
      out.push(w);
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

/** Does this line describe the object, or something the object works with? */
function relationOf(lineWords) {
  for (const w of lineWords) {
    if (COMPATIBILITY.has(w)) return RELATION.REFERENCE;
    if (ACCESSORY_NOUN.has(w)) return RELATION.REFERENCE;
    // Hebrew/Arabic attach the preposition to the following word.
    if (RTL_FOR_PREFIX.test(w)) return RELATION.REFERENCE;
  }
  return RELATION.SUBJECT;
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
