// ═══════════════════════════════════════════════════════════════════════════
// VAL-001 — Valuation Guard: the single validation choke point for every price
// ═══════════════════════════════════════════════════════════════════════════
// Every number reaching a user, `valuations`, `price_observations`, a
// Recognition-Memory sample, or later pricing logic passes validateQuote()
// first. Stage 2 and the Pricing Rescue Engine both go through it — PRE quotes
// are not trusted just because they came from the rescue path.
//
// CONTRACT (same as api/_lib/recognition-memory.js): PURE. No I/O, no network,
// no clock, no process.env, no IO — a function of its arguments only. The one
// import below is a PURE sibling holding the category token vocabulary, which
// api/_lib/category.js must share: two copies of that table agreeing by
// inspection is the defect this round closed, not a property worth preserving.
//
// WHY IT EXISTS (audited 2026-07-30 against api/analyze.js): VERIFICATION_SCHEMA
// (:452) is declared and never applied — the Stage 2 response is used unchecked
// (:1896); calibrateVerification (:1933-2044) never touches a price; :3173
// already computes `silent_fail` for "Stage 2 returned 0" and ships the ₪0
// anyway; and `price_method` is chosen by the model (:640-642) yet drives the
// grade, the price_observations write and the memory provenance — so provenance
// is DERIVED here and the model's claim kept only as `model_claimed_method`.
//
// FAIL-CLOSED: `action:'degrade'` returns 0/0/0 and the caller routes to the
// rescue engine. The guard never invents a price and never moves `mid` — an
// out-of-envelope mid degrades rather than being clamped into range, because
// clamping turns "the model is wrong" into a confidently wrong number.
// ═══════════════════════════════════════════════════════════════════════════

// VALIDATOR_VERSION 2 — the rule SET changed shape, not just its constants.
// Four new rules can now refuse a quote that version 1 accepted
// (V-IDENTITY-FLOOR, V-SOURCE-UNREGISTERED, V-ENVELOPE-BAND, V-FX) and the
// metadata gained `identity_tier`. A stored valuation from version 1 is not
// comparable to one from version 2, and drift is unmeasurable if both claim
// the same validator.
import { names, EVIDENCE_CLASSES } from './pricing-authority.js';

export const VALIDATOR_VERSION = 2;
// bump on ANY envelope/threshold change.
// 2026-08-05.1 — applyTransform now also rejects a post-multiply low <= 0, so a
// replica adjustment can no longer emit a band starting at ₪0 (a rule
// validateQuote already enforced; the transform path was weaker).
// 2026-09-18.1 — GW-OPENAI-INTELLIGENCE-002 foundation. Thresholds and envelope
// SELECTION both changed: CATEGORY_CONFIDENCE_FLOOR introduced at 0.60; the
// no-bucket fallback now resolves to MANUAL_ONLY rather than GLOBAL_ENVELOPE
// for any non-confirmed identity; `resolveEnvelopeKey` lets photographed OCR
// narrow but never widen the key; an anchor whose variant contradicts the item
// no longer sets the envelope; and `pre_haiku` grades LOW rather than MEDIUM.
export const RULESET_VERSION = '2026-09-18.1';

// ── Condition ladder (VAL-001 D1) ──────────────────────────────────────────
// Identical to the discounts in src/lib/utils.js:42 — this module is now the
// authority and the client applies a RESIDUAL delta against it. Stage 2 already
// prices at the observed condition (analyze.js:631 feeds it in; :678 says "Used
// items: 40-70% of new Israeli retail depending on condition"), so applying the
// full ladder a second time double-discounts.
export const CONDITION_LADDER = Object.freeze({
  newSealed: 0,
  likeNew: 0.15,
  used: 0.30,
  poor: 0.70,
});

// Stage 2 emits the RECOGNITION_SCHEMA vocabulary (analyze.js:442):
// New | Like New | Good | Fair | Poor. Good and Fair both map to `used`: the
// client ladder has no middle rung, and mapping Fair to `poor` would encode a
// 70% haircut the model never applied. Returns null when unmappable — callers
// MUST treat null as "no adjustment" (delta 0), never as a default rung.
export function normalizeConditionBasis(s) {
  const v = String(s ?? '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  switch (v) {
    case 'new': case 'newsealed': case 'sealed': case 'brandnew': return 'newSealed';
    case 'likenew': case 'asnew': case 'mint': case 'excellent': return 'likeNew';
    case 'good': case 'fair': case 'used': case 'verygood': return 'used';
    case 'poor': case 'damaged': case 'forparts': case 'broken': return 'poor';
    default: return null; // includes '', 'unknown', anything unrecognized
  }
}

// Residual discount to apply on top of a price ALREADY adjusted for `basis`.
// Returns 0 whenever either side is unknown — the fail-safe that makes
// "condition is applied exactly once, or not at all" provable here rather than
// in the client. Negative results are legitimate uplifts (the item is better
// than what was priced); callers clamp them to the validated band.
export function conditionDelta(basis, userCond) {
  const b = normalizeConditionBasis(basis);
  const u = normalizeConditionBasis(userCond);
  if (!b || !u) return 0;
  return CONDITION_LADDER[u] - CONDITION_LADDER[b];
}

// Convenience applier. `band` is the guard-validated { low, high }, so a
// condition adjustment can never walk a price outside the range the guard
// approved. extraPenalty carries the client's answer-driven deductions
// (scratches / issues / battery) — signals the model never saw, so genuinely
// additive rather than duplicative.
export function applyConditionDelta(base, basis, userCond, { band = null, extraPenalty = 0 } = {}) {
  if (!Number.isFinite(base) || base <= 0) return 0;
  const factor = 1 - (conditionDelta(basis, userCond) + (Number(extraPenalty) || 0));
  let out = Math.round(base * Math.max(factor, 0));
  if (band && Number.isFinite(band.low) && Number.isFinite(band.high)) {
    out = Math.min(Math.max(out, band.low), band.high);
  }
  return out;
}

// ── Category buckets ───────────────────────────────────────────────────────
// A COPY of FALLBACK_PRICE_MAP (analyze.js:3532-3571) — the only per-category
// ILS price evidence in the repository, already tuned by prior SCAN work for
// the Israeli used market. Envelopes are derived from it programmatically, so
// adding a bucket here yields an envelope automatically. `null` = "too variable
// to estimate from category alone" (analyze.js:3531) → manual_only class.
const BUCKETS = Object.freeze({
  'electronics:iphone':         { low: 400,  mid: 1200, high: 3000 },
  'electronics:macbook':        { low: 800,  mid: 2500, high: 5000 },
  'electronics:ipad':           { low: 200,  mid: 700,  high: 2000 },
  'electronics:smartwatch':     { low: 80,   mid: 350,  high: 1200 },
  'electronics:smartphone':     { low: 150,  mid: 450,  high: 1200 },
  'electronics:cordless phone': { low: 30,   mid: 60,   high: 150  },
  'electronics:home phone':     { low: 20,   mid: 50,   high: 120  },
  'electronics:laptop':         { low: 400,  mid: 1200, high: 3000 },
  'electronics:tablet':         { low: 150,  mid: 450,  high: 1500 },
  'electronics:headphones':     { low: 50,   mid: 200,  high: 600  },
  'electronics:earbuds':        { low: 30,   mid: 150,  high: 500  },
  'electronics:gaming console': { low: 400,  mid: 900,  high: 1800 },
  'electronics:gaming mouse':   { low: 50,   mid: 150,  high: 400  },
  'electronics:keyboard':       { low: 30,   mid: 100,  high: 400  },
  'electronics:monitor':        { low: 200,  mid: 600,  high: 1500 },
  'electronics:tv':             { low: 200,  mid: 700,  high: 2500 },
  'electronics:camera':         { low: 200,  mid: 700,  high: 2500 },
  'electronics:speaker':        { low: 50,   mid: 200,  high: 800  },
  'electronics:printer':        { low: 50,   mid: 150,  high: 500  },
  'electronics:drone':          { low: 200,  mid: 600,  high: 2000 },
  'electronics':                { low: 50,   mid: 200,  high: 800  },
  'watches:luxury':             { low: 500,  mid: 2500, high: 10000 },
  'watches':                    { low: 50,   mid: 200,  high: 800  },
  'home:kitchen appliance':     { low: 50,   mid: 200,  high: 600  },
  'home:cleaning':              null,
  'home':                       { low: 30,   mid: 150,  high: 600  },
  'furniture':                  { low: 100,  mid: 500,  high: 2000 },
  'sports':                     { low: 30,   mid: 150,  high: 600  },
  'clothing':                   { low: 20,   mid: 100,  high: 400  },
  'bags':                       { low: 30,   mid: 150,  high: 600  },
  'jewelry':                    null,
  'books':                      { low: 5,    mid: 20,   high: 60   },
  'toys':                       { low: 20,   mid: 80,   high: 300  },
  'tools':                      { low: 30,   mid: 150,  high: 600  },
  'beauty':                     { low: 10,   mid: 50,   high: 200  },
  'smoking':                    { low: 20,   mid: 80,   high: 300  },
  'vehicles':                   null,
  'food':                       null,
});

// Multipliers applied to every non-null bucket.
//   FLOOR 0.40 — 40% of the bucket's used-market LOW. Below this a "price" is a
//     unit error (agorot for shekels) or a fabricated small number, not a cheap
//     item; the bucket lows are already conservative.
//   SOFT 2.50  — above 2.5x the bucket HIGH the item is plausible but
//     exceptional (top-spec or limited variant): priced, but flagged and graded
//     down. Never silently capped.
//   HARD 8.00  — beyond 8x the bucket HIGH nothing in that category is real.
//     e.g. electronics:laptop high 3000 -> hard 24000 admits a maxed MacBook
//     Pro (~12-15k used) and rejects the ₪250,000 hallucination.
const ENVELOPE_MULTIPLIERS = Object.freeze({ FLOOR: 0.40, SOFT: 2.50, HARD: 8.00 });

// Buckets where the derived multipliers give the wrong answer, with the reason.
const ENVELOPE_OVERRIDES = Object.freeze({
  // A genuine Submariner/Daytona is ₪35-50k used; 8 x 10000 = 80000 would admit
  // it but 2.5 x 10000 = 25000 would flag every real one, and the category is
  // the single most-hallucinated. Widened, and above soft_max the guard demands
  // corroboration (see requiresAnchorAboveSoft) — which matches the posture the
  // authenticity path already takes on these brands (analyze.js:2023-2025 caps
  // confidence at 0.72; analyze.js:2259-2260 forces verification_required).
  'watches:luxury': { soft_max: 40000, hard_max: 250000, requiresAnchorAboveSoft: true },
});

// The four null buckets. No category price evidence exists, by an explicit
// earlier decision — so an unanchored price above a low threshold is not a
// valuation, it is a guess, and the honest output is manual_required.
//   SOFT 1000 / HARD 2000 — a ₪2,000 unanchored ring/cleaning-product/vehicle
//   price is already implausible enough to hand back to the user.
const MANUAL_ONLY = Object.freeze({ floor: 5, soft_max: 1000, hard_max: 2000 });

// No bucket matched. Ceiling ported verbatim from the ONE existing sanity gate
// in the codebase (analyze.js:3876, `mid > 500_000` rejects a rescue quote);
// floor 5 is the smallest bucket floor (books 5 x 0.40 = 2) rounded up.
// C-3. RETAINED AS A NAMED CEILING, NO LONGER REACHABLE AS A FALLBACK.
//
// This was the envelope an UNRESOLVED bucket fell through to whenever the
// identity was confirmed, on the reasoning that "a real product in a category we
// have not bucketed yet is a gap in BUCKETS, not a reason to refuse the user."
// That reasoning is wrong in the one direction that matters: it makes FAILING TO
// RESOLVE the most permissive outcome in the system, 500,000 against a books
// ceiling of 480.
//
// The §6 token matcher then made unresolved MUCH more common — 'Other', and
// every category word the matcher declines to place — so strings the N-4 fix was
// written to CORRECT ("Tablet", "Watchdog", "Caravan") went from a wrong-but-tight
// bucket to the loosest bounds in the system. The fix for a widening defect
// widened by 31x-250x. It also re-opened the global-envelope inversion this
// module had already closed once for the unidentified case.
//
// Uncertainty must reduce authority. An unresolved bucket is now MANUAL_ONLY
// whatever the identity is worth — and a confirmed identity in an unbucketed
// category is not refused, it is PENDING_MARKET, which is exactly the state that
// now exists to hold it.
const GLOBAL_ENVELOPE = Object.freeze({ floor: 5, soft_max: 20000, hard_max: 500000 });

// Anchor-relative envelope, used whenever the caller resolved a COMPATIBLE
// catalog row carrying a retail price. Tighter and evidence-backed:
//   0.08 — 8% of new retail; below that the identity or the price is wrong.
//   1.00 soft / 1.25 hard — the repo's own stated policy is "Used items: 40-70%
//     of new Israeli retail" (analyze.js:678, restated to Haiku at :3846). A
//     used price above new retail is a red flag (flagged at 1.0x); 1.25 leaves
//     headroom for genuine scarcity/discontinued premiums and rejects beyond.
const ANCHOR_MULTIPLIERS = Object.freeze({ FLOOR: 0.08, SOFT: 1.00, HARD: 1.25 });

function buildEnvelopes() {
  const out = {};
  for (const [key, b] of Object.entries(BUCKETS)) {
    if (!b) { out[key] = Object.freeze({ key, class: 'manual_only', ...MANUAL_ONLY }); continue; }
    out[key] = Object.freeze({
      key,
      class: 'derived',
      floor: Math.round(b.low * ENVELOPE_MULTIPLIERS.FLOOR),
      soft_max: Math.round(b.high * ENVELOPE_MULTIPLIERS.SOFT),
      hard_max: Math.round(b.high * ENVELOPE_MULTIPLIERS.HARD),
      requiresAnchorAboveSoft: false,
      ...(ENVELOPE_OVERRIDES[key] || {}),
    });
  }
  return Object.freeze(out);
}

export const ENVELOPES = buildEnvelopes();

/**
 * An envelope by key, or null — OWN PROPERTIES ONLY.
 *
 * VAL-6. `ENVELOPES[key]` walks the prototype chain, so `'__proto__'` returned
 * `Object.prototype` and `'constructor'` returned `Object`. Both are truthy, so
 * the `!env` guard passed, and floor / soft_max / hard_max were all `undefined`.
 * Every comparison against undefined is false, so ₪999,999,999 was ACCEPTED with
 * zero violations and the envelope reported as `undefined`.
 *
 * Latent today because no caller supplies `envelope_key` — but Phase B builds its
 * own ctx, and this is a total bypass of the entire envelope system.
 */
function envelopeFor(key) {
  if (typeof key !== 'string' || !key) return null;
  return Object.prototype.hasOwnProperty.call(ENVELOPES, key) ? ENVELOPES[key] : null;
}

// ── §6  A CATEGORY IS A WORD, NOT A SUBSTRING  ·  N-4 ──────────────────────
//
// THE PROPERTY
//   A bucket matcher fires because the category NAMES that category, never
//   because the category happens to CONTAIN those letters.
//
// THE FINDING
// Every matcher below was `cat.includes('…')`. The letters therefore decided
// the price, and English is full of coincidences:
//
//   "Tablet"     contains "table"  -> furniture, hard_max 16,000
//   "Watchdog"   contains "watch"  -> watches,   hard_max  6,400
//   "Scorecard"  contains "car"    -> vehicles
//   "Cardigan"   contains "car"    -> vehicles
//   "Caravan"    contains "car"    -> vehicles
//   "Bookcase"   contains "book"   -> books,     hard_max    480
//
// An iPad whose category came back "Tablet" was priced under the FURNITURE
// envelope. CB-12 could not see it, because CB-12 forbids canonicalisation from
// WIDENING what the raw string already selected — and here the raw string was
// already wrong, so both sides agreed and the property held over a defect.
//
// TOKENS ARE DECLARED, NOT INFERRED. Each token below says how it matches:
//   'word' — the whole word, tolerating a plural: `table` matches "table" and
//            "tables", never "tablet"; `watch` matches "watches", never
//            "watchdog"; `book` matches "books", never "bookcase".
//   'stem' — a word-INITIAL stem, for the cases where the category name is a
//            genuine inflection: `electron` must reach "Electronics", `furni`
//            must reach "Furniture", `jewel` must reach "Jewelry".
// The mode is written down per token because guessing it is what produced the
// bug: 'table' and 'electron' look alike and behave completely differently.
// TOKEN_MODE and `names()` now live in api/_lib/pricing-authority.js, imported
// below, because api/_lib/category.js needs the SAME predicate. Two tables that
// agree by inspection is how `/watch/` and `cat.includes(watch)` drifted into
// disagreeing about "Watchdog" in the first place — and the narrow-only property
// then reported the disagreement as a safe narrowing rather than as the defect.

// ── Category key matcher ───────────────────────────────────────────────────
// Ported from getCategoryFallbackPricing (analyze.js:3576-3625), ordered,
// first match wins. THIS module is the intended single authority for the
// taxonomy; analyze.js still carries its own copy for the PRE category
// fallback and should later delegate to resolveEnvelopeKey() so the envelope
// and the fallback price can never disagree about what an item is.
//
// `mode` selects how category/subcategory/product_type words are tested:
//   'token'     — the correct rule (see §6 above).
//   'substring' — the LEGACY rule, kept solely so resolveEnvelopeKey can prove
//                 the token rule never WIDENS anything. It is never used on its
//                 own to choose an envelope.
// Brand and model patterns (`sig`) are untouched by either mode: those are
// product names matched by explicit regexes, not category words.
function resolveEnvelopeKeyFrom(recognition, { trustOcr, mode = 'token' }) {
  const rawCat = (recognition.category || '').toLowerCase();
  const rawSub = (recognition.subcategory || '').toLowerCase();
  const rawPt = (recognition.product_type || '').toLowerCase();
  const has = mode === 'token'
    ? (text, token) => names(text, token)
    : (text, token) => String(text || '').includes(token);
  const cat = { includes: (t) => has(rawCat, t) };
  // HIGH-4, RECORDED RATHER THAN FIXED IN ROUND 2 — CLOSED IN ROUND 3 by
  // BUCKET_AUTHORITY below. Every field here except `cat` is a stage describing
  // the photograph, and ANY of them can carry the identity: a scan with no
  // candidates at all but `subcategory: 'iphone'` reaches the same bucket as one
  // naming Apple outright. The `trustOcr` split bounds `raw_texts` and nothing
  // else; what bounds the REST is now the evidence requirement each wide bucket
  // declares, applied in resolveEnvelopeKey.
  const sub = { includes: (t) => has(rawSub, t) };
  const pt = { includes: (t) => has(rawPt, t) };
  const mdl = (recognition.model_candidates?.[0]?.model || '').toLowerCase();
  const brnd = (recognition.brand_candidates?.[0]?.brand || '').toLowerCase();
  const ocr = trustOcr ? (recognition.ocr_text?.raw_texts || []).join(' ').toLowerCase() : '';
  const sig = `${rawSub} ${rawPt} ${mdl} ${ocr}`;
  const el = cat.includes('electron');

  const MATCHERS = [
    ['electronics:iphone',         () => el && (brnd.includes('apple') || sig.includes('iphone'))],
    ['electronics:macbook',        () => el && sig.includes('macbook')],
    ['electronics:ipad',           () => el && sig.includes('ipad')],
    ['electronics:smartwatch',     () => el && (sub.includes('smartwatch') || /garmin|fitbit|apple watch|galaxy watch/.test(sig))],
    ['electronics:smartphone',     () => el && (sub.includes('phone') || sub.includes('mobile') || sub.includes('smartphone') || pt.includes('smartphone') || /galaxy|pixel|oneplus/.test(sig))],
    ['electronics:cordless phone', () => el && (sig.includes('cordless') || /kx-t|kx-p|dect/.test(sig) || (brnd.includes('panasonic') && sig.includes('phone')))],
    ['electronics:home phone',     () => el && (sig.includes('home phone') || sig.includes('landline') || sig.includes('telephone'))],
    ['electronics:laptop',         () => el && (sub.includes('laptop') || sub.includes('notebook') || /thinkpad|latitude|elitebook|ideapad|zenbook/.test(sig))],
    ['electronics:tablet',         () => el && (sub.includes('tablet') || pt.includes('tablet'))],
    ['electronics:headphones',     () => el && (sub.includes('headphone') || sub.includes('earphone') || /wh-|qc\d|airpods|earbuds/.test(sig))],
    ['electronics:earbuds',        () => el && (sig.includes('earbuds') || sig.includes('tws') || sig.includes('in-ear'))],
    ['electronics:gaming console', () => el && /playstation|xbox|nintendo|ps4|ps5/.test(sig)],
    ['electronics:gaming mouse',   () => el && ((sig.includes('gaming') && sig.includes('mouse')) || /g502|g pro|g305|razer deathadder|steelseries/.test(sig))],
    ['electronics:keyboard',       () => el && (sub.includes('keyboard') || pt.includes('keyboard'))],
    ['electronics:monitor',        () => el && (sub.includes('monitor') || sub.includes('display') || pt.includes('monitor'))],
    ['electronics:tv',             () => el && (sub.includes('tv') || sub.includes('television') || pt.includes('television'))],
    ['electronics:camera',         () => el && (sub.includes('camera') || /canon|nikon|sony a\d|fuji/.test(sig))],
    ['electronics:speaker',        () => el && (sub.includes('speaker') || /sonos|jbl|bose/.test(sig))],
    ['electronics:printer',        () => el && (sub.includes('printer') || pt.includes('printer'))],
    ['electronics:drone',          () => el && (sig.includes('drone') || sig.includes('dji'))],
    ['electronics',                () => el],
    ['watches:luxury',             () => (cat.includes('watch') || sub.includes('watch')) && /rolex|omega|cartier|patek|audemars|breitling|tag heuer|hublot|iwc|tudor/.test(brnd)],
    ['watches',                    () => cat.includes('watch') || sub.includes('watch')],
    ['home:cleaning',              () => (cat.includes('home') || cat.includes('clean')) && (/ajax|fairy|ariel|persil|sano/.test(brnd) || /clean|detergent|soap|bleach|disinfect/.test(sig))],
    ['home:kitchen appliance',     () => (cat.includes('home') || cat.includes('kitchen')) && /blender|mixer|toaster|coffee|espresso|microwave|oven/.test(sig)],
    ['home',                       () => cat.includes('home') || cat.includes('household')],
    ['furniture',                  () => cat.includes('furni') || cat.includes('sofa') || cat.includes('chair') || cat.includes('table')],
    ['sports',                     () => cat.includes('sport') || cat.includes('fitness') || cat.includes('outdoor')],
    ['clothing',                   () => cat.includes('cloth') || cat.includes('fashion') || cat.includes('apparel')],
    ['bags',                       () => cat.includes('bag') || sub.includes('bag') || sub.includes('handbag') || sub.includes('backpack')],
    ['jewelry',                    () => cat.includes('jewel') || sub.includes('jewel') || /ring|necklace|bracelet/.test(rawSub)],
    ['books',                      () => cat.includes('book')],
    ['toys',                       () => cat.includes('toy') || (cat.includes('game') && !cat.includes('gaming'))],
    ['tools',                      () => cat.includes('tool') || cat.includes('hardware')],
    ['beauty',                     () => cat.includes('beauty') || cat.includes('cosmetic')],
    ['smoking',                    () => cat.includes('smoking') || cat.includes('tobacco') || cat.includes('vape')],
    ['vehicles',                   () => cat.includes('vehicle') || cat.includes('car') || cat.includes('motor')],
    ['food',                       () => cat.includes('food') || cat.includes('beverage')],
  ];

  for (const [key, test] of MATCHERS) if (test()) return key;
  return null;
}

// ── §3  PRICING ENVELOPE AUTHORITY  ·  R2-H2 ───────────────────────────────
//
// THE PROPERTY
//   DERIVED evidence alone may NEVER enter a bucket whose hard_max exceeds its
//   parent category's hard_max.
//
// Twelve buckets exceed their parent. `category` is bounded by an enum;
// `subcategory`, `product_type` and the candidate arrays are bounded by nothing,
// and any one of them selects a bucket. So with zero identity evidence:
//
//   subcategory: (none)    -> electronics         6,400   ₪20,000 refused
//   subcategory: 'laptop'  -> electronics:laptop 24,000   ₪20,000 ACCEPTED
//
// EACH BUCKET DECLARES WHAT IT COSTS TO ENTER, because the financial
// consequence differs per bucket: entering `electronics:laptop` wrongly costs a
// ₪24,000 ceiling, entering `watches:luxury` wrongly costs ₪250,000. A single
// global threshold would have to be set for the worst case and would then
// refuse every legitimate laptop — which is precisely how the two previous
// attempts at this rule failed.
//
// WHAT IS NOT HERE. No confidence value, and no reading of the `evidence`
// string the model writes about itself. The classes are established by
// provenance in api/_lib/pricing-authority.js: OBJECT_CLASS is a classifier's
// verdict, BRAND_TEXT/PRODUCT_TEXT require the name to actually OCCUR in the
// text read off the item. See that module for why each is attacker-reachable or
// not.
//
// ANCHOR SATISFIES EVERY BUCKET. A compatible GetWorth catalog row is data we
// hold, not an interpretation of the photograph, and it is strictly stronger
// than any signal in the image. It is also moot in practice: with an anchor
// present `resolveEnvelope` uses the anchor-relative bounds instead of the
// bucket's. Declared explicitly so the reason is on the record.
const BUCKET_AUTHORITY = Object.freeze({
  // A classifier must have said "laptop"/"television"/"camera" — a written
  // subcategory is not enough, because a written subcategory is what the attack
  // consists of.
  'electronics:laptop':         ['OBJECT_CLASS'],
  'electronics:tv':             ['OBJECT_CLASS'],
  'electronics:camera':         ['OBJECT_CLASS'],
  'electronics:monitor':        ['OBJECT_CLASS'],
  'electronics:drone':          ['OBJECT_CLASS'],
  'electronics:gaming console': ['OBJECT_CLASS'],
  'electronics:smartphone':     ['OBJECT_CLASS'],
  'electronics:smartwatch':     ['OBJECT_CLASS'],
  'electronics:tablet':         ['OBJECT_CLASS'],
  // The Apple buckets carry the highest electronics ceilings (24,000 / 40,000),
  // and their matchers fire on a single word — `sig.includes('macbook')` is
  // satisfied by OCR, by a subcategory, or by a model candidate. Object class
  // AND a brand actually read off the item.
  'electronics:iphone':         ['OBJECT_CLASS', 'BRAND_TEXT'],
  'electronics:macbook':        ['OBJECT_CLASS', 'BRAND_TEXT'],
  'electronics:ipad':           ['OBJECT_CLASS', 'BRAND_TEXT'],
  // ₪250,000, and the single most-hallucinated category in the system. Both
  // text classes: the brand AND a product string must have been read off the
  // item. requiresAnchorAboveSoft still applies on top, unchanged.
  //
  // ── AND OBJECT_CLASS, ADDED IN ROUND 6 ───────────────────────────────────
  //
  // An independent recognition reviewer pointed out that the defence written
  // down in api/_lib/pricing-authority.js — "an unrecognised line is SUBJECT,
  // and the classes they grant are bounded by BUCKET_AUTHORITY, which requires
  // OBJECT_CLASS from a classifier for every electronics bucket above its
  // parent" — is TRUE FOR ELECTRONICS AND FALSE FOR THIS BUCKET. Here the two
  // text classes were the whole requirement, so the compatibility-marker
  // vocabulary was the ONLY layer, and every gap in it was a ₪250,000 gap:
  //
  //   "Replacement strap for\nROLEX SUBMARINER"   refused
  //   "για\nROLEX SUBMARINER"                     watches:luxury GRANTED
  //   "ile uyumlu\nROLEX SUBMARINER"              watches:luxury GRANTED
  //   "สายสำรองสำหรับ\nROLEX SUBMARINER"            watches:luxury GRANTED
  //
  // Twelve unlisted languages did it, and so did every scriptio-continua script
  // outside the four the containment rule happens to name. A marker list cannot
  // be finished, which is exactly why this round's contract says phrase
  // recognition is EVIDENCE and the authority requirement is the PROTECTION.
  // This bucket had no protection, only evidence.
  //
  // A classifier saying "watch" is not something a printed sentence can forge,
  // and a genuine watch photograph has one. The cost of the gap is now the
  // ordinary `watches` ceiling rather than the luxury one.
  'watches:luxury':             ['OBJECT_CLASS', 'BRAND_TEXT', 'PRODUCT_TEXT'],
});

/** `'electronics:laptop'` -> `'electronics'`; a top-level key -> null. */
function parentKey(key) {
  const i = typeof key === 'string' ? key.indexOf(':') : -1;
  return i === -1 ? null : key.slice(0, i);
}

// A requirement no evidence set can satisfy. A distinct ARRAY IDENTITY, not a
// string anyone could pass in as an evidence class: `req === UNSATISFIABLE` is
// an identity test, so no caller can construct a value that accidentally
// satisfies or spoofs it.
const UNSATISFIABLE = Object.freeze(['<unsatisfiable>']);

/**
 * What must be true to enter `key`.
 *
 * FAIL-CLOSED BY CONSTRUCTION, and this is the part the previous round claimed
 * and did not have. A bucket that exceeds its parent's ceiling and is NOT
 * declared above returns UNSATISFIABLE — it can never be entered, so adding a
 * wide bucket tomorrow without declaring its evidence does not silently inherit
 * permission; it becomes unreachable and its own test fails. The alternative,
 * defaulting undeclared buckets to "no requirement", is how every previous
 * version of this rule leaked.
 */
// `table` exists so the UNSATISFIABLE branch is REACHABLE.
//
// A mutation run replaced that branch with `return []` and the mutant SURVIVED —
// because every bucket that currently exceeds its parent is declared in
// BUCKET_AUTHORITY, so the fail-closed default had no input in the real table.
// It was the fifth "rule with no reachable input" in this work, and it was the
// one rule whose entire job is to catch a bucket somebody adds tomorrow.
//
// A test can now build a synthetic table containing an undeclared wide bucket
// and observe the refusal. That is the only honest way to verify a default whose
// purpose is to handle a case that does not exist yet: the alternative is adding
// a dead bucket to production so a test has something to look at.
export function bucketEntryRequirement(key, table = ENVELOPES) {
  if (!key) return [];
  if (BUCKET_AUTHORITY[key]) return BUCKET_AUTHORITY[key];
  const parent = parentKey(key);
  if (!parent) return [];
  const own = (t, k) => (Object.prototype.hasOwnProperty.call(t, k) ? t[k] : undefined);
  const self = own(table, key), up = own(table, parent);
  if (!self || !up) return [];
  return self.hard_max > up.hard_max ? UNSATISFIABLE : [];
}

// C-1. The guard may not import at will, so this mirrors `anchorPrice` in
// api/_lib/pricing-authority.js. tests/anchor-authority.test.mjs asserts the two
// agree over the whole malformed-price matrix rather than trusting that they do.
//
// NO COERCION. `Number()` accepted the string "900"; `!!ctx.anchor` accepted
// `{}`. A price is a finite number strictly above zero, and everything else is
// ABSENT rather than small.
function anchorPriceOf(anchor) {
  if (!anchor || typeof anchor !== 'object' || Array.isArray(anchor)) return null;
  for (const key of ['retail_price_ils', 'avg_used_price_ils']) {
    const v = anchor[key];
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) continue;
    return v;
  }
  return null;
}

/** Does this context carry MARKET-PRICE evidence, as opposed to a lookalike row? */
function hasMarketAnchor(ctx) {
  return anchorPriceOf(ctx?.anchor) !== null;
}

const DERIVED_ONLY = Object.freeze(new Set(['DERIVED']));

function asEvidenceSet(evidence) {
  if (evidence instanceof Set) return evidence;
  if (Array.isArray(evidence)) return new Set(evidence);
  return DERIVED_ONLY;
}

/** An evidence set as a stable, serialisable, sorted array. */
function evidenceNames(evidence) {
  const have = asEvidenceSet(evidence);
  // A5-1. THIS LIST WAS HAND-WRITTEN AND ALREADY WRONG.
  //
  // Round 4 added CATALOG_IDENTITY in api/_lib/pricing-authority.js and left this
  // copy untouched, so `evidenceList` returned CATALOG_IDENTITY+DERIVED and this
  // function returned DERIVED — two serialisers for one set, silently disagreeing,
  // and THIS is the copy that reaches the client, valuations.ai_raw_response and
  // the ledger. A scan where GetWorth holds a compatible row with no price is the
  // single best /api/enrich input, because it already carries a row id; it was
  // indistinguishable from a scan with no row at all.
  //
  // Imported from the producer now. A class added there appears here without
  // anyone remembering to add it, which is the only arrangement that survives.
  return EVIDENCE_CLASSES.filter((c) => have.has(c));
}

/** Does this evidence set satisfy `key`'s entry requirement? */
export function bucketEntryPermitted(key, evidence, table = ENVELOPES) {
  const req = bucketEntryRequirement(key, table);
  if (req === UNSATISFIABLE) return false;
  if (req.length === 0) return true;
  const have = asEvidenceSet(evidence);
  // C-1. ANCHOR now means "a row carrying a usable price", so this short-circuit
  // is sound again. It was not: the class was granted to any object, and its
  // justification — "moot in practice, because resolveEnvelope uses
  // anchor-relative bounds" — is false for a priceless row, which falls through
  // to the BUCKET envelope. An empty object opened all 13 gated buckets and
  // moved a watch from 6,400 to 250,000. CATALOG_IDENTITY deliberately does NOT
  // appear here: looking like a product is not evidence of its price class.
  if (have.has('ANCHOR')) return true;
  return req.every((c) => have.has(c));
}

/**
 * The bucket this evidence is actually entitled to.
 *
 * FALLS BACK TO THE PARENT, never forward and never to GLOBAL_ENVELOPE. A
 * laptop the classifier did not see is still electronics; it is not suddenly
 * unbounded. `null` in, `null` out.
 */
function applyBucketAuthority(key, evidence) {
  let k = key;
  while (k) {
    if (bucketEntryPermitted(k, evidence)) return k;
    k = parentKey(k);
  }
  return null;
}

// A null key is NOT "the loosest envelope": resolveEnvelope maps it to
// MANUAL_ONLY for a non-confirmed identity, and the CATEGORY_ONLY rule refuses
// to price on it at all. Using GLOBAL_ENVELOPE's 500,000 here was a real defect
// in the first version of the OCR comparison — every real bucket looked narrower
// than "no bucket" and was therefore accepted.
function ceilingOf(k) {
  if (!k) return MANUAL_ONLY.hard_max;
  const e = envelopeFor(k);
  return e ? e.hard_max : MANUAL_ONLY.hard_max;
}

/**
 * The §6 narrow-only floor: the token rule may correct a bucket, never widen it.
 *
 * "Bookcase" names no category under the token rule, and no bucket means
 * MANUAL_ONLY's 2,000 — ABOVE the books ceiling of 480 the substring rule gave
 * it. So a pure token swap would have widened three buckets while fixing six.
 * Resolving both ways and keeping the lower ceiling makes "only narrow or
 * preserve" true by construction rather than by inspection:
 *
 *   Tablet     token electronics:tablet 12,000  legacy furniture 16,000 -> tablet
 *   Watchdog   token (none)              2,000  legacy watches    6,400 -> none
 *   Bookcase   token (none)              2,000  legacy books        480 -> books
 *
 * Ties keep the TOKEN key: a same-ceiling bucket that names the item correctly
 * is a better description at no extra permission.
 */
function resolveRawKey(recognition, { trustOcr }) {
  const tokenKey = resolveEnvelopeKeyFrom(recognition, { trustOcr, mode: 'token' });
  const legacyKey = resolveEnvelopeKeyFrom(recognition, { trustOcr, mode: 'substring' });
  if (tokenKey === legacyKey) return tokenKey;
  return ceilingOf(tokenKey) <= ceilingOf(legacyKey) ? tokenKey : legacyKey;
}

/**
 * Which pricing envelope governs this item — with PHOTOGRAPHED TEXT ALLOWED TO
 * NARROW THE ANSWER, NEVER TO WIDEN IT, and with every bucket above its parent's
 * ceiling gated on the evidence it declares.
 *
 * `sig` used to include `ocr_text.raw_texts` unconditionally, so a string a
 * person PRINTS ON A STICKER selected the constraint that governs its own price.
 * Writing "macbook" on any electronics item moved the ceiling from electronics
 * (or global) to `electronics:macbook`, hard_max 40,000 — the attacker choosing
 * the ruler they are measured against.
 *
 * It is not simply removed, because OCR is genuinely the best evidence for
 * several buckets: `kx-t`/`dect` is how a cordless phone is recognised at all,
 * and those buckets are TIGHTER than the category they sit in. Removing OCR
 * would push real items into looser envelopes — the same inversion, mirrored.
 *
 * So both keys are resolved and the SAFER one wins:
 *   - resolve from trusted signals only (category / subcategory / product_type
 *     / brand / model — all classifier output, not raw pixels-to-text)
 *   - resolve again with OCR included
 *   - take the OCR-influenced key ONLY when it does not raise hard_max
 *
 * THEN the bucket authority runs, because narrowing-from-OCR and
 * entitled-to-the-bucket are different questions and answering them in one step
 * is what the two withdrawn versions of this rule tried to do.
 *
 * `evidence` is a Set or array of class names from
 * api/_lib/pricing-authority.js. THE DEFAULT IS DERIVED ONLY — a caller that
 * passes nothing gets no access to any bucket above its parent, which is the
 * fail-closed direction.
 */
export function resolveEnvelopeKey(recognition = {}, evidence = DERIVED_ONLY) {
  const trustedKey = resolveRawKey(recognition, { trustOcr: false });
  const ocrKey = resolveRawKey(recognition, { trustOcr: true });

  // Reproduced, and the reason the null case is special-cased: category
  // "Kitchen", confidence 0.9, no brand, no model. With no OCR the scan is
  // REFUSED (no bucket, nothing to price from). Print "DELONGHI ESPRESSO" on it
  // and the same scan resolves to home:kitchen appliance and is ACCEPTED at
  // ₪2,500 — a refusal converted into a price by a sticker, which is the whole
  // attack this function exists to stop, in its purest form.
  let key;
  if (trustedKey === null) key = null;
  else if (ocrKey === trustedKey) key = trustedKey;
  // Strictly narrowing only. Equal ceilings keep the OCR key, because a
  // same-ceiling bucket is a more specific description at no extra permission.
  else key = ceilingOf(ocrKey) <= ceilingOf(trustedKey) ? ocrKey : trustedKey;

  return applyBucketAuthority(key, evidence);
}

/** The bucket the matchers chose, BEFORE authority — provenance, not a price. */
export function resolveEnvelopeKeyUngated(recognition = {}) {
  const trustedKey = resolveRawKey(recognition, { trustOcr: false });
  if (trustedKey === null) return null;
  const ocrKey = resolveRawKey(recognition, { trustOcr: true });
  if (ocrKey === trustedKey) return trustedKey;
  return ceilingOf(ocrKey) <= ceilingOf(trustedKey) ? ocrKey : trustedKey;
}


// ctx.anchor — a catalog row the CALLER has already confirmed compatible via
// isCompatibleAnchor (analyze.js:3726). This module cannot import that function:
// it lives in api/analyze.js alongside the Vercel handler and module-level env
// reads, so importing it would create an import cycle and break the "no side
// effects" contract. The caller resolves compatibility; the guard consumes the
// verdict. Passing an INCOMPATIBLE row here silently widens the envelope to the
// wrong product — resolve it with isCompatibleAnchor or pass null.
// ── IDENTITY TIERS (GW-OPENAI-INTELLIGENCE-002 foundation) ─────────────────
//
// Pricing eligibility is a function of IDENTITY EVIDENCE, not of the model's
// stated confidence. The Ninja scan is why: category "Other" at 10%, brand
// none, model none, OCR empty — and it still received a product-specific
// ₪30/₪70/₪130. Nothing in the guard asked whether the item had been
// identified at all, because `validateQuote` never read `category_confidence`
// and `resolveEnvelopeKey` reads only category STRINGS.
//
// The floor mirrors VISION_TRIGGER_THRESHOLD (0.60, api/analyze.js) — the value
// the pipeline already uses to decide "this identity is too weak to trust".
// Reusing it keeps one definition of weak rather than inventing a second.
// Reachability matters as much as the number. `calibrateRecognition`
// (api/analyze.js) caps a BRANDLESS recognition at `min(conf, 0.55)` and then
// subtracts 0.15 more when there is no readable text — and the guard reads the
// CALIBRATED value. At 0.60 the CATEGORY_ONLY tier could therefore never be
// entered in production: the whole branch, and the longest comment in this
// file, described code that could not run. Its tests passed only because they
// call validateQuote directly with hand-built ctx — the same "verification
// artefact quietly not verifying" class as SEC-9.
//
// 0.50 sits below the 0.55 brandless ceiling and above the 0.40 a brandless,
// textless scan lands on, so the tier is reachable AND still refuses the Ninja
// shape (0.10).
export const CATEGORY_CONFIDENCE_FLOOR = 0.50;

// A NAME IS NOT EVIDENCE.
//
// `assessFallbackIdentity` derives `brandOk` as `brand !== 'unidentified'` — a
// string-PRESENCE test. So any non-empty name bought the EXACT_MODEL tier, and
// a hallucinated identity priced cleanly: brand "Nike" 0.55 from
// `evidence: visual_shape`, model "Air Max" 0.50 from shape alone, category
// Footwear — accepted at ₪35/70/130, grade MEDIUM, zero violations.
//
// That is the Ninja defect's sibling and it is the more dangerous half. The
// first draft of V-IDENTITY-FLOOR closed "no identity ⇒ no price" and left
// "INVENTED identity ⇒ priced" wide open, while applying a confidence floor to
// the category and none at all to the brand or the model. The recognition path
// — unscored Vision labels, and a Stage-2 prompt that is told to prefer them —
// is precisely the machine that manufactures a confident-sounding name.
//
// 0.60 is VISION_TRIGGER_THRESHOLD: the value the pipeline ALREADY uses to
// decide an identity is too weak to trust. Reusing it keeps one definition of
// weak rather than inventing a second.
export const IDENTITY_CONFIDENCE_FLOOR = 0.60;

export const IDENTITY_TIER = Object.freeze({
  EXACT_MODEL:   'exact_model',
  FAMILY:        'family',
  BRAND_ONLY:    'brand_only',
  CATEGORY_ONLY: 'category_only',
  UNIDENTIFIED:  'unidentified',
});

/**
 * What has actually been established about this item.
 *
 * Reads the identity assessment the caller already computed
 * (assessFallbackIdentity) plus the RAW category confidence. Both, because they
 * fail in different directions: identity can be empty while a category string
 * is confidently wrong, which is exactly the Ninja shape.
 */
// ── A CONFIDENCE IS A PROBABILITY, AND EVERY READ OF ONE GOES THROUGH HERE ──
//
// Round 1 probing found that `5`, `99` and `true` all read as strong, and the
// fix was written — and applied to `category_confidence` ALONE. The comment
// above that check stated the rule in general terms ("Out of [0,1], or not a
// number at all, is malformed input") while two feet below it `brandC` and
// `modelC` were still read through a bare `Number()` with no type check and no
// upper bound. An independent reviewer walked straight through the gap.
//
// The witness is not exotic. A model writing confidences on a 0-100 scale is
// the single most common malformation of this field, and `RECOGNITION_SCHEMA`
// is documentation — api/analyze.js says so itself: it is never applied. So:
//
//   brandC 0.30  ->  unidentified  ->  DEGRADE 0/0/0
//   brandC 30    ->  exact_model   ->  ACCEPT  250/380/520
//
// The same 30%, one scale apart, turning an honest refusal into a top-tier
// price on an invented Nike / "Air Max" identity with 0.20 category confidence.
//
// This is the fifth time in this work that a comment has asserted a rule the
// code applied in only one of the places it named. Hence ONE function, used by
// every confidence read in this module: a rule that exists in a single place
// cannot be applied to two thirds of its subjects.
//
// Returns NaN for anything malformed, and every comparison against NaN is
// false — so malformed fails closed by construction rather than by remembering.
function confidence(value) {
  if (typeof value !== 'number') return NaN;      // strings, booleans, objects, arrays
  if (!Number.isFinite(value)) return NaN;        // NaN, Infinity
  if (value < 0 || value > 1) return NaN;         // a probability, not a percentage
  return value;
}

export function resolveIdentityTier(ctx = {}) {
  // AN ABSENT IDENTITY IS NOT A NEUTRAL IDENTITY. With no `ctx.identity` at all
  // the tier used to fall through to CATEGORY_ONLY and price — so a caller that
  // simply forgot to pass identity got pricing, which is fail-OPEN on the one
  // input this whole rule is about. A caller who has not told us what was
  // identified has not identified anything.
  // `Array.isArray` matters: `typeof [] === 'object'`, so an array slipped
  // through the object check and then read `brandOk` as undefined, landing on
  // CATEGORY_ONLY and pricing. A malformed identity is an absent one.
  if (!ctx.identity || typeof ctx.identity !== 'object' || Array.isArray(ctx.identity)) {
    return IDENTITY_TIER.UNIDENTIFIED;
  }
  const id = ctx.identity;

  // STRICT BOOLEANS, not truthiness. `brandOk: 'yes'` — or any non-empty string
  // a future caller passes by accident — must not buy the top tier. Adversarial
  // probing found exactly that: `{ brandOk: 'yes', modelOk: 'yes' }` with a
  // nonsense category reached EXACT_MODEL and the global envelope.
  // PRESENCE **and** EVIDENCE. `brandOk`/`modelOk` only say a name is not the
  // literal string "unidentified"; the confidence is what says anyone had a
  // reason for it. A text-confirmed brand is accepted regardless of the numeric
  // score, because `confirmed_by_text` means the name was READ off the item —
  // which is stronger evidence than any number the model assigns itself.
  const textConfirmed = id.brandConfLabel === 'confirmed_by_text';
  const brandEvidenced = textConfirmed || confidence(id.brandC) >= IDENTITY_CONFIDENCE_FLOOR;
  const modelEvidenced = textConfirmed || confidence(id.modelC) >= IDENTITY_CONFIDENCE_FLOOR;

  const brandOk = id.brandOk === true && brandEvidenced;
  const modelOk = id.modelOk === true && modelEvidenced;

  // The same rule, on the same function's other confidence. See `confidence()`.
  const categoryTrusted = confidence(ctx.recognition?.category_confidence) >= CATEGORY_CONFIDENCE_FLOOR;

  // `model_family` is the field BOTH engines actually put on the recognition
  // root: the current engine declares it in RECOGNITION_SCHEMA, and the OpenAI
  // normalizer maps its own `product_family` onto that same name. The first
  // draft of this function read `product_family` — which exists only inside the
  // OpenAI identity object, never on the recognition — so the FAMILY tier was
  // unreachable on every path. It failed safe (those items fell to BRAND_ONLY,
  // which is stricter), but a branch nothing can enter is not a rule; it is a
  // comment that looks like one. `product_family` is kept as a tolerated alias
  // for a caller holding a raw OpenAI identity.
  const family = ctx.recognition?.model_family ?? ctx.recognition?.product_family;
  if (brandOk && modelOk) return IDENTITY_TIER.EXACT_MODEL;
  if (brandOk && typeof family === 'string' && family.trim()) return IDENTITY_TIER.FAMILY;
  if (brandOk) return IDENTITY_TIER.BRAND_ONLY;
  if (categoryTrusted) return IDENTITY_TIER.CATEGORY_ONLY;
  return IDENTITY_TIER.UNIDENTIFIED;
}

/** Tiers that may carry a product-specific price at all. */
const PRICEABLE_TIERS = new Set([
  IDENTITY_TIER.EXACT_MODEL, IDENTITY_TIER.FAMILY,
  IDENTITY_TIER.BRAND_ONLY, IDENTITY_TIER.CATEGORY_ONLY,
]);

// ── VARIANT / CAPACITY CHANNEL (GW-OPENAI-INTELLIGENCE-002 foundation) ─────
//
// AUDIT RESULT: there is no structured channel for variant, capacity, storage,
// size or generation ANYWHERE in the pipeline. `variant` appears in this repo
// only in prose and comments; `capacity`, `storage` and `size_ml` appear
// nowhere at all. `model_number` exists in the OpenAI identity schema and is
// dropped by the time anything prices. So a 128 GB and a 1 TB phone, a 50 ml
// and a 100 ml fragrance, a 27" and a 32" monitor are INDISTINGUISHABLE to the
// valuation path — and those are the largest single price discriminators in
// their categories.
//
// Making that worse, `normalizeModelKey` (api/analyze.js) deliberately STRIPS
// variant suffixes — `x`, `plus`, `pro`, `se`, `gen\d`, `mk\d` — so
// "iPhone 15 Pro" collapses to "iphone 15". That tolerance is CORRECT for
// finding a sibling anchor and WRONG for deciding the anchor describes this
// unit.
//
// Per the ticket: repair the minimum safe channel, do not invent fields with no
// consumer. So this adds exactly one thing, with one real consumer today — the
// anchor, which sets the envelope and is therefore the highest-leverage place a
// variant confusion turns into a wrong ceiling. The rest of the channel belongs
// with the Phase-B identity object, where it will have consumers.
// `\d{1,4}` on storage, not `\d{2,4}`: "1TB" is one digit and is exactly the
// case that matters most. And the screen-size pattern must not end in `\b`,
// because `"` is not a word character, so `27"` never matched. Both were caught
// by the tests below rather than by reading — which is the point of having them.
const VARIANT_PATTERNS = [
  /\b(\d{1,4})\s?(gb|tb)\b/gi,          // storage
  /\b(\d{1,4})\s?(ml|l)\b/gi,           // volume
  /\b(\d{2,3})\s?(?:"|''|inch\b|in\b)/gi, // screen size
  /\bgen\s?(\d)\b/gi,                   // generation
  /\b(mk\s?\d)\b/gi,                    // mark
];

/** Deterministic variant tokens read out of a free-text product string. */
export function extractVariantTokens(text) {
  const s = String(text ?? '').toLowerCase();
  const out = new Set();
  for (const re of VARIANT_PATTERNS) {
    re.lastIndex = 0;
    for (const m of s.matchAll(re)) out.add(m[0].replace(/\s+/g, ''));
  }
  return [...out].sort();
}

/**
 * Do two product strings CONTRADICT each other on a variant dimension?
 *
 * Absence is never a contradiction — most rows carry no variant token at all,
 * and treating "unknown" as "different" would reject every legitimate anchor.
 * Only a token of the SAME KIND with a DIFFERENT VALUE contradicts.
 */
export function variantContradiction(aText, bText) {
  const kind = (t) => (/gb|tb/.test(t) ? 'storage' : /ml|l$/.test(t) ? 'volume'
    : /"|inch|in$/.test(t) ? 'size' : /^gen/.test(t) ? 'generation' : 'mark');
  const a = extractVariantTokens(aText);
  const b = extractVariantTokens(bText);
  for (const ta of a) {
    for (const tb of b) {
      if (kind(ta) === kind(tb) && ta !== tb) return { kind: kind(ta), a: ta, b: tb };
    }
  }
  return null;
}

export function resolveEnvelope(ctx = {}) {
  // C-1 / VAL-9. Was `Number(ctx.anchor?.retail_price_ils)`, which accepted the
  // STRING "900" and — found by this round's own property test — coerced
  // `retail_price_ils: true` to 1, producing an anchor-relative envelope of
  // floor 0.08 / soft 1 / hard 1.25. A boolean became a one-shekel ceiling.
  // One predicate for what a price is, shared with the evidence class.
  const retail = anchorPriceOf(ctx.anchor);
  // A catalog anchor whose VARIANT contradicts the item does not describe this
  // unit, and an anchor sets the envelope — so the contradiction would hand the
  // wrong ceiling to the wrong product. Fall through to the category envelope
  // rather than trusting it. Silent on absence; only a real conflict rejects.
  const anchorText = `${ctx.anchor?.model ?? ''} ${ctx.anchor?.name ?? ''}`;
  const itemText = `${ctx.recognition?.model_candidates?.[0]?.model ?? ''} `
    + `${(ctx.recognition?.ocr_text?.raw_texts || []).join(' ')}`;
  const variantConflict = ctx.anchor ? variantContradiction(anchorText, itemText) : null;

  if (retail !== null && !variantConflict) {
    return {
      key: ctx.anchor.id ? `anchor:${ctx.anchor.id}` : 'anchor',
      basis: 'anchor',
      floor: Math.round(retail * ANCHOR_MULTIPLIERS.FLOOR),
      soft_max: Math.round(retail * ANCHOR_MULTIPLIERS.SOFT),
      hard_max: Math.round(retail * ANCHOR_MULTIPLIERS.HARD),
      requiresAnchorAboveSoft: false,
    };
  }
  // VAL-5. A caller-supplied key is a request, not an authority. It goes through
  // the SAME bucket gate as a resolved one — otherwise `envelope_key:
  // 'watches:luxury'` with DERIVED-only evidence hands over floor 200 / soft
  // 40,000 / hard 250,000, which is precisely what BUCKET_AUTHORITY exists to
  // refuse. §3 stated the rule unconditionally and checked it in one of the two
  // places a key can come from.
  const requestedKey = ctx.envelope_key ?? resolveEnvelopeKey(ctx.recognition || {}, ctx.evidence);
  const key = ctx.envelope_key != null
    ? applyBucketAuthority(envelopeFor(ctx.envelope_key) ? ctx.envelope_key : null, ctx.evidence)
    : requestedKey;
  const env = envelopeFor(key);
  if (!env) {
    // ── THE GLOBAL-ENVELOPE INVERSION, CLOSED ────────────────────────────────
    //
    // GLOBAL_ENVELOPE is floor 5 / soft 20,000 / hard 500,000 — by a wide
    // margin the LOOSEST set of bounds in the system. It was reached by
    // falling through: no bucket matched the category string. So the item we
    // knew LEAST about received the WIDEST permission to be priced, while a
    // confidently-identified gaming mouse was held to 20/1000/3200.
    //
    // That is backwards, and it is how "Footwear" (which matches no matcher at
    // all) let ₪30-130 through without a single violation. Unknown must NARROW
    // capability, not expand it.
    //
    // A confirmed identity still gets the global fallback — a real product in
    // a category we have not bucketed yet is a gap in BUCKETS, not a reason to
    // refuse the user. Everything weaker gets MANUAL_ONLY.
    // C-3. NO IDENTITY TIER EARNS THE GLOBAL CEILING ANY MORE.
    //
    // This used to branch: a confirmed identity got GLOBAL_ENVELOPE (500,000), a
    // weak one got MANUAL_ONLY (2,000). The branch is gone, because "we could not
    // work out which bucket this is" is a statement about OUR knowledge, and
    // strengthening the identity does not make the bucket any better known.
    //
    // This does NOT refuse the user. A confirmed identity in an unbucketed
    // category resolves to PENDING_MARKET — we know what it is and hold no price
    // evidence for its class — which is a better answer than a number bounded
    // only by 500,000, and it is the state /api/enrich will resolve.
    return { key: key || 'unresolved', basis: 'manual_only', ...MANUAL_ONLY, requiresAnchorAboveSoft: false };
  }
  return {
    key: env.key,
    basis: env.class === 'manual_only' ? 'manual_only' : 'category',
    floor: env.floor,
    soft_max: env.soft_max,
    hard_max: env.hard_max,
    requiresAnchorAboveSoft: !!env.requiresAnchorAboveSoft,
  };
}

// ── Provenance (derived, never the model's price_method) ───────────────────
const GRADES = ['MANUAL_REQUIRED', 'LOW', 'MEDIUM', 'HIGH'];
const gradeDown = (g) => {
  const i = GRADES.indexOf(g);
  return i > 1 ? GRADES[i - 1] : g; // never demotes below LOW; MANUAL_REQUIRED is terminal
};

// ctx: { stage:'stage2'|'pre', pre_source, anchor, anchorModelEvidence, identity }
// `anchor` present ⇒ the caller found a compatible catalog row; that — not the
// model's self-declared "comp_based" — is what earns the HIGH grade.
export function derivePricingSource(ctx = {}) {
  // C-1. Was `!!ctx.anchor`. A lookalike row with no price graded HIGH —
  // stage2_comp_anchored — a BETTER grade than a real priced catalog row whose
  // model column was not hit (pre_catalog -> LOW). The model's unmeasured number
  // outranked a measured one because somebody had submitted a matching name.
  const anchored = hasMarketAnchor(ctx);
  if (ctx.stage === 'pre') {
    switch (ctx.pre_source) {
      // MEDIUM only when the row's MODEL column was hit by evidence, mirroring
      // the existing PRE grading rule (analyze.js:3795,3806).
      // V5-1b. FOUND BY THE MECHANICAL INVENTORY, not by a reviewer.
      // `anchorModelEvidence` is set by the caller as `!!guardAnchor?.model`, so a
      // PRICELESS row that merely carries a model column lifted pre_catalog from
      // LOW to MEDIUM. The brief forbids a priceless row increasing the valuation
      // grade, and this did exactly that through a second field.
      //
      // The model column is evidence about IDENTITY — it says the row names the
      // same product. Grading the PRICE on it requires the row to have a price.
      case 'catalog': return {
        source: 'pre_catalog',
        grade: (ctx.anchorModelEvidence && hasMarketAnchor(ctx)) ? 'MEDIUM' : 'LOW',
      };
      // GRADE LOWERED MEDIUM -> LOW, and the reason is an ordering defect, not
      // a taste preference. `pre_haiku` is an UNANCHORED model estimate; it
      // carries no catalog row, no comparable and no retail reference. It was
      // graded MEDIUM unconditionally, while `pre_catalog` — a REAL compatible
      // catalog row — dropped to LOW whenever the row's model column was not
      // hit by evidence. So a guess outranked an observation, and the pricing
      // provenance the UI shows was ordered backwards against the evidence.
      //
      // B-15 already forbids a category bucket from pricing a confident
      // identity; nothing forbade the model from simply guessing one instead.
      // An estimate may still price — it just may not outrank evidence.
      case 'ai_haiku': return { source: 'pre_haiku', grade: 'LOW' };
      case 'category_anchor': return { source: 'category_bucket', grade: 'LOW' };
      case 'none': return { source: 'manual_required', grade: 'MANUAL_REQUIRED' };
      // FAIL CLOSED. This returned { source:'unknown', grade:'LOW' } — a
      // pricing source nobody registered was PRICED BY DEFAULT, against this
      // module's own fail-closed doctrine. It also meant a future source could
      // ship prices silently by forgetting to touch this switch, which is
      // exactly how an unreviewed market-comparable path would have arrived.
      // An unregistered source is not a low-confidence source; it is an
      // unknown one, and unknown does not price.
      default: return { source: 'unknown', grade: 'MANUAL_REQUIRED' };
    }
  }
  if (ctx.stage === 'stage2') {
    return anchored
      ? { source: 'stage2_comp_anchored', grade: 'HIGH' }
      : { source: 'stage2_ai', grade: 'MEDIUM' };
  }
  // THE SIBLING HOLE, CLOSED. The `default:` inside the PRE switch was changed
  // to MANUAL_REQUIRED on the reasoning that an unregistered source is not a
  // low-confidence source but an unknown one — and then this line, three
  // statements later, kept returning LOW for an unrecognised STAGE and priced
  // it. Same doctrine, same module, one branch applied and one not; it was
  // carried as a MEDIUM when it is the same root class as the HIGH above it.
  //
  // An unrecognised stage means the caller is a code path this module has never
  // been reasoned about. That is the definition of unknown.
  return { source: 'unknown', grade: 'MANUAL_REQUIRED' };
}


// ── §4  CATEGORY AUTHORITY  ·  R2-H3 ───────────────────────────────────────
//
// THE PROPERTY
//   A later stage may CORRECT what we believe the item is. It may not, by
//   returning a different string, choose a larger price ceiling.
//
// THE FINDING, AND THE HALF-FIX THAT PRECEDED THIS
// For one commit `gctx.recognition` read
//   `{ ...recognition, category: verification.final_category || recognition.category }`
// so Stage 2 — the stage whose prompt carries OCR raw_texts, Vision labels,
// catalog rows and the user's refineModel — chose its own envelope:
//
//   paperback, Stage 1 Books (hard 480), Stage 2 asking 4,000
//     final_category Books        -> books        MANUAL_REQUIRED
//     final_category Electronics  -> electronics  LOW      4,000
//     final_category Furniture    -> furniture    MEDIUM   4,000
//
// That line was reverted, which closed the widening and opened something else:
// the envelope then came from Stage 1 forever, so a WRONG Stage 1 became
// permanent, and the client was still shown Stage 2's label. A displayed
// category that disagrees with the priced one is a lie in the direction nobody
// checks.
//
// FOUR NAMES, BECAUSE THEY ARE FOUR DIFFERENT QUESTIONS
//   display_category        what the UI may show.
//   recognition_category    our best current belief about what this is.
//   pricing_category        the ONLY category allowed to choose an envelope.
//   pricing_envelope_source why that category has that authority.
//
// THE TRANSITION RULE IS MONOTONE IN CEILINGS, NOT IN TRUST
//   NARROWING     new hard_max <= incumbent  -> always allowed, no evidence
//                 needed. Being more careful costs nothing.
//   WIDENING      new hard_max >  incumbent  -> requires a NEW EVIDENCE
//                 ARTEFACT: ANCHOR or OBJECT_CLASS. A different category STRING
//                 is not new evidence, which is the entire finding.
//   DISAGREEMENT  widening without that evidence -> pricing_category is
//                 UNCHANGED, display_category may still move, the disagreement
//                 is RECORDED, and the valuation becomes MANUAL_REQUIRED.
//
// Rule C is the part that took two rounds to get right. The tempting answers
// are "trust the later string" (the CRITICAL) and "keep pricing on Stage 1
// silently" (the reopened finding). Both ship a number. The honest answer is
// that two stages disagreeing about what an object IS means nobody should be
// quoted a price for it, so the disagreement is surfaced instead of resolved.
//
// WHY BRAND_TEXT AND PRODUCT_TEXT DO NOT WIDEN A CATEGORY. A brand name printed
// on a book jacket is genuinely read off the item and says nothing whatever
// about whether the object is a book or a laptop. Only a classifier's verdict
// about the OBJECT (OBJECT_CLASS) or GetWorth's own catalog row (ANCHOR) speaks
// to that question. They can still fail to be enough: the widened bucket must
// ALSO pass its own BUCKET_AUTHORITY check, which is what makes the two rules
// compose instead of overriding each other.
export const CATEGORY_WIDENING_EVIDENCE = Object.freeze(['ANCHOR', 'OBJECT_CLASS']);

export const ENVELOPE_SOURCE = Object.freeze({
  STAGE1: 'stage1',
  STAGE2_NARROWING: 'stage2_narrowing',
  STAGE2_EVIDENCED: 'stage2_widening_evidenced',
  STAGE1_HELD_ON_DISAGREEMENT: 'stage1_held_on_disagreement',
});

/**
 * Decide the four categories and the provenance of the pricing one.
 *
 * `stage1` and `stage2` are recognition-shaped: only `category` is read from
 * `stage2`, and every other field used to resolve a bucket keeps coming from
 * `stage1`. That is deliberate — allowing Stage 2 to also supply `subcategory`
 * would reopen the widening through a different field, which is exactly how the
 * first version of the envelope rule was defeated.
 *
 * Pure: no throw for any input shape, and `category_disagreement` is the only
 * output that changes a verdict.
 */
export function resolveCategoryAuthority({ stage1 = {}, stage2 = null, evidence = DERIVED_ONLY } = {}) {
  const s1 = (stage1 && typeof stage1 === 'object' && !Array.isArray(stage1)) ? stage1 : {};
  const s2cat = (stage2 && typeof stage2 === 'object' && !Array.isArray(stage2))
    ? stage2.category : null;
  const have = asEvidenceSet(evidence);

  const incumbentKey = resolveEnvelopeKey(s1, have);
  const s1cat = s1.category ?? null;
  const out = {
    display_category: s1cat,
    recognition_category: s1cat,
    pricing_category: s1cat,
    pricing_envelope_key: incumbentKey,
    pricing_envelope_source: ENVELOPE_SOURCE.STAGE1,
    category_disagreement: false,
  };

  if (typeof s2cat !== 'string' || !s2cat.trim()) return out;
  out.display_category = s2cat;
  out.recognition_category = s2cat;
  if (String(s2cat).toLowerCase() === String(s1cat ?? '').toLowerCase()) return out;

  const laterKey = resolveEnvelopeKey({ ...s1, category: s2cat }, have);

  if (ceilingOf(laterKey) <= ceilingOf(incumbentKey)) {
    out.pricing_category = s2cat;
    out.pricing_envelope_key = laterKey;
    out.pricing_envelope_source = ENVELOPE_SOURCE.STAGE2_NARROWING;
    return out;
  }

  if (CATEGORY_WIDENING_EVIDENCE.some((c) => have.has(c))) {
    out.pricing_category = s2cat;
    out.pricing_envelope_key = laterKey;
    out.pricing_envelope_source = ENVELOPE_SOURCE.STAGE2_EVIDENCED;
    return out;
  }

  // The paperback. Stage 1 says Books, Stage 2 says Electronics, and nothing
  // new was seen. We do not price it as Electronics, and we do not quietly
  // price it as Books under an "Electronics" label either.
  out.pricing_envelope_source = ENVELOPE_SOURCE.STAGE1_HELD_ON_DISAGREEMENT;
  out.category_disagreement = true;
  return out;
}

// ── §5  RECOGNITION AND VALUATION ARE TWO VERDICTS  ·  R2-H5 ───────────────
//
// THE PROPERTY
//   Knowing WHAT an item is does not establish WHAT IT IS WORTH. A strong
//   identity must not, by itself, authorise a price.
//
// THE FINDING
// `derivePricingSource` returned `{ source:'stage2_ai', grade:'MEDIUM' }` for
// any Stage-2 result without a catalog anchor. So a real scan of a real product
// GetWorth had never seen:
//
//   Ninja Detect Power Blender Pro, brand 0.94 read off the item,
//   model 0.88 read off the item, no catalog row
//     -> identity EXACT_MODEL, and ACCEPT ₪400 graded MEDIUM, source stage2_ai
//
// ₪400 is a number the model wrote down. Nothing measured it, nothing compared
// it to anything, and the user sees it in the same shape, with a better grade,
// than a price backed by an actual catalog row. There was no state in the system
// meaning "we know what this is and we do not yet know what it costs", so the
// pipeline had nowhere to put the truth and put a guess there instead.
//
// THE DATABASE IS EVIDENCE AND MEMORY, NOT A WHITELIST. An item absent from the
// catalog is not unrecognisable and must not be treated as unrecognised. It is
// un-PRICED. Those are different sentences and now they are different fields.
//
// PENDING_MARKET is the state /api/enrich will resolve. It is deliberately NOT
// the same as MANUAL: MANUAL means a human has to decide, PENDING_MARKET means
// market research has to run and we already know exactly what to research.
// Phase B is NOT built here; this round only makes the state exist so Phase B
// has something to resolve instead of a price it has to argue with.
export const RECOGNITION_VERDICT = Object.freeze({
  IDENTIFIED: 'IDENTIFIED',
  FAMILY: 'FAMILY',
  CATEGORY: 'CATEGORY',
  UNKNOWN: 'UNKNOWN',
});

export const VALUATION_VERDICT = Object.freeze({
  ANCHORED: 'ANCHORED',
  BOUNDED: 'BOUNDED',
  PENDING_MARKET: 'PENDING_MARKET',
  MANUAL: 'MANUAL',
});

// Five identity tiers, four recognition verdicts. BRAND_ONLY folds into FAMILY
// because both mean "we know the maker and not the product", which is the same
// thing to say to a user and the same thing to hand to Phase B.
const TIER_TO_RECOGNITION = Object.freeze({
  [IDENTITY_TIER.EXACT_MODEL]: RECOGNITION_VERDICT.IDENTIFIED,
  [IDENTITY_TIER.FAMILY]: RECOGNITION_VERDICT.FAMILY,
  [IDENTITY_TIER.BRAND_ONLY]: RECOGNITION_VERDICT.FAMILY,
  [IDENTITY_TIER.CATEGORY_ONLY]: RECOGNITION_VERDICT.CATEGORY,
  [IDENTITY_TIER.UNIDENTIFIED]: RECOGNITION_VERDICT.UNKNOWN,
});

/** What we believe this item IS. Reads identity evidence only — never a price. */
export function resolveRecognitionVerdict(ctx = {}) {
  return TIER_TO_RECOGNITION[resolveIdentityTier(ctx)] || RECOGNITION_VERDICT.UNKNOWN;
}

/** Recognition verdicts that name a PRODUCT rather than a kind of thing. */
const PRODUCT_LEVEL = new Set([RECOGNITION_VERDICT.IDENTIFIED, RECOGNITION_VERDICT.FAMILY]);

/** Pricing sources whose number is GetWorth-held evidence rather than a guess. */
const ANCHORED_SOURCES = new Set(['pre_catalog', 'stage2_comp_anchored']);

/**
 * What we are entitled to SAY about the price.
 *
 *   ANCHORED        a GetWorth-held catalog/retail reference governs the number.
 *   BOUNDED         no product-level identity, but the CATEGORY is one we hold
 *                   price evidence for, and the envelope bounds the answer. An
 *                   honest "this kind of thing costs about this much".
 *   PENDING_MARKET  we know what the product is and hold nothing that prices it.
 *                   Phase B resolves this. NO NUMBER SHIPS.
 *   MANUAL          neither identified nor bounded; a person decides.
 *
 * The asymmetry is intentional and is the point of the whole round: better
 * recognition moves you from BOUNDED to PENDING_MARKET, i.e. from a category
 * guess to an honest refusal, not to a better-looking number. A product-level
 * claim requires product-level evidence.
 */
export function resolveValuationVerdict(ctx = {}) {
  const derived = derivePricingSource(ctx);
  if (derived.grade === 'MANUAL_REQUIRED') return VALUATION_VERDICT.MANUAL;
  if (ctx.category_disagreement === true) return VALUATION_VERDICT.MANUAL;

  const have = asEvidenceSet(ctx.evidence);
  // C-1. Was `ctx.anchor || have.has('ANCHOR') || ...`. Two defects in one
  // line: the bare `ctx.anchor` accepted any object, and `have.has('ANCHOR')`
  // accepted the CALLER'S ASSERTION of the class rather than the anchor itself.
  // ANCHORED is derived from the anchor OBJECT now, so a caller cannot assert
  // its way past V-MARKET-EVIDENCE by passing evidence: ['ANCHOR'].
  if (hasMarketAnchor(ctx) || ANCHORED_SOURCES.has(derived.source)) {
    return VALUATION_VERDICT.ANCHORED;
  }

  const rec = resolveRecognitionVerdict(ctx);
  if (PRODUCT_LEVEL.has(rec)) return VALUATION_VERDICT.PENDING_MARKET;
  if (rec === RECOGNITION_VERDICT.CATEGORY && resolveEnvelopeKey(ctx.recognition || {}, have) !== null) {
    return VALUATION_VERDICT.BOUNDED;
  }
  return VALUATION_VERDICT.MANUAL;
}

// ── Spread limits (from the prompt's own rules, analyze.js:680-681) ────────
// "If brand unidentified: WIDE range (±50% from mid)" -> ratio 3.0, allowed 4.0
// "If brand confirmed by text: NARROW range (±20% from mid)" -> ratio 1.5, allowed 2.5
const SPREAD_MIN_RATIO = 1.05; // a zero-width range on an estimate is false precision
const SPREAD_MAX_CONFIRMED = 2.5;
const SPREAD_MAX_IDENTIFIED = 4.0;
const SPREAD_MAX_WEAK = 6.0;

function maxSpreadRatio(identity) {
  if (!identity) return SPREAD_MAX_IDENTIFIED; // unknown context -> mainline limit
  if (identity.brandConfLabel === 'confirmed_by_text' || identity.brand_confidence === 'confirmed_by_text') {
    return SPREAD_MAX_CONFIRMED;
  }
  if (identity.identityHigh || identity.brandOk) return SPREAD_MAX_IDENTIFIED;
  return SPREAD_MAX_WEAK;
}

// ── Quote adapter ─────────────────────────────────────────────────────────
// Stage 2 and every PRE source speak `price_estimate_low/mid/high`; the guard
// contract speaks `low/mid/high`. Accept both so no caller has to remap.
export function toQuote(o = {}) {
  const pick = (a, b) => (o[a] !== undefined ? o[a] : o[b]);
  return {
    low: pick('low', 'price_estimate_low'),
    mid: pick('mid', 'price_estimate_mid'),
    high: pick('high', 'price_estimate_high'),
    currency: o.currency,
    pricing_status: o.pricing_status,
    price_method: o.price_method,
    condition: o.condition,
  };
}

const ZERO = Object.freeze({ low: 0, mid: 0, high: 0 });

function verdict({ action, prices, repairs, violations, meta }) {
  return {
    action,
    prices,
    currency: 'ILS',
    repairs,
    violations,
    metadata: {
      validator_version: VALIDATOR_VERSION,
      ruleset_version: RULESET_VERSION,
      ...meta,
    },
  };
}

/**
 * The choke point. Returns a Verdict; never throws on bad data.
 *
 * @param quote {low,mid,high,currency,pricing_status,price_method,condition}
 *              (price_estimate_* aliases accepted via toQuote)
 * @param ctx   { stage, pre_source, anchor, anchorModelEvidence, identity,
 *                recognition, envelope_key, model, condition }
 */
export function validateQuote(rawQuote, ctx = {}) {
  const q = toQuote(rawQuote || {});
  const repairs = [];
  const violations = [];
  const env = resolveEnvelope(ctx);
  const derived = derivePricingSource(ctx);
  const base = {
    pricing_source: derived.source,
    pricing_grade: derived.grade,
    envelope_key: env.key,
    envelope_basis: env.basis,
    degraded: false,
    degraded_reason: null,
    needs_review: false,
    // Recorded for drift measurement ONLY. Nothing branches on it.
    model_claimed_method: rawQuote?.price_method ?? null,
    // The condition the price was produced FOR, in priority order: the quote's
    // own field (Stage 2 echoes it, analyze.js:708), then an explicit ctx
    // override, then Stage 1's visual read (analyze.js:631 is where the prompt
    // sources it). null when none is mappable — callers MUST treat null as
    // "no adjustment", never as a default rung.
    condition_basis: normalizeConditionBasis(
      q.condition ?? ctx.condition ?? ctx.recognition?.visual_features?.condition,
    ),
    model: ctx.model ?? null,
  };

  // ── H-1. WHAT WE ESTABLISHED IS RECORDED BEFORE ANYTHING CAN REFUSE ────────
  //
  // These five used to be assigned two hundred lines below, just before the
  // identity-floor check — and the comment there claimed they were "computed
  // here rather than at each exit so that a refusal still carries what we DID
  // establish". Every exit ABOVE that point contradicted it:
  //
  //   V-ZERO-STATE   accept    all five ABSENT
  //   V-FINITE       degrade   four absent, valuation_verdict FABRICATED
  //   V-CURRENCY     degrade   same
  //   V-POSITIVE     degrade   same
  //
  // Fabricated, not merely missing: degrade() force-sets valuation_verdict to
  // MANUAL, so a scan that was IDENTIFIED + PENDING_MARKET reported MANUAL for a
  // verdict that had never been computed, beside an undefined recognition_verdict.
  // A record that invents a field is worse than one that omits it.
  //
  // They are pure functions of ctx, so computing them first costs nothing and
  // makes the comment true. `identityTier` is reused below rather than recomputed.
  const identityTier = resolveIdentityTier(ctx);
  base.identity_tier = identityTier;
  base.recognition_verdict = resolveRecognitionVerdict(ctx);
  base.valuation_verdict = resolveValuationVerdict(ctx);
  base.evidence = evidenceNames(ctx.evidence);
  base.pricing_envelope_source = ctx.pricing_envelope_source ?? null;

  const degrade = (rule, detail) => {
    violations.push({ rule, detail });
    return verdict({
      action: 'degrade',
      // 0/0/0 on degrade so a caller that ignores `action` fails loudly into the
      // manual-price UI rather than shipping the rejected number.
      prices: { ...ZERO },
      repairs,
      violations,
      // A DEGRADED SCAN IS NOT BOUNDED, AND IT IS NOT ANCHORED. A quote that
      // fails an envelope or ordering check must not keep a verdict that claims
      // the number was backed. Recognition survives a refusal; valuation
      // authority does not.
      //
      // PENDING_MARKET is the one verdict a refusal may KEEP, because it is
      // itself a refusal and it is the only one /api/enrich can act on. Flattening
      // it to MANUAL here is what made a pending scan indistinguishable from an
      // unrecognisable one.
      meta: { ...base, pricing_grade: 'MANUAL_REQUIRED', degraded: true,
        valuation_verdict: base.valuation_verdict === VALUATION_VERDICT.PENDING_MARKET
          ? VALUATION_VERDICT.PENDING_MARKET : VALUATION_VERDICT.MANUAL,
        degraded_reason: `${rule}: ${detail}` },
    });
  };

  // V-ZERO-STATE — the deliberate degraded state produced by preManualQuote
  // (analyze.js:3901-3915) and the null-bucket path (analyze.js:3630-3645).
  // ACCEPTED, not a violation: the pipeline is correctly saying "I don't know",
  // and the UI already renders it as "Set your own price"
  // (CameraResultsView.jsx:1212). Only an exact numeric 0/0/0 with the matching
  // status qualifies; every other zero falls through to V-POSITIVE.
  if (q.pricing_status === 'manual_required' && q.low === 0 && q.mid === 0 && q.high === 0) {
    return verdict({
      action: 'accept',
      prices: { ...ZERO },
      repairs,
      violations,
      meta: {
        ...base,
        pricing_source: 'manual_required',
        pricing_grade: 'MANUAL_REQUIRED',
        degraded: true,
        degraded_reason: 'manual_required_zero_state',
      },
    });
  }

  // V-FINITE / V-POSITIVE on mid. Number.isFinite on the RAW value, so the
  // string "1200" fails here rather than being coerced somewhere downstream.
  if (!Number.isFinite(q.mid)) return degrade('V-FINITE', `mid is not a finite number (${typeof q.mid}: ${String(q.mid)})`);
  if (q.mid <= 0) return degrade('V-POSITIVE', `mid must be > 0, got ${q.mid}`);

  // V-CURRENCY — absent is fine (ILS is the pipeline default); a different
  // currency is NEVER silently relabelled, which is what normalizeForUI does
  // today by hardcoding 'ILS' (analyze.js:2455).
  if (q.currency != null && String(q.currency).trim().toUpperCase() !== 'ILS') {
    return degrade('V-CURRENCY', `expected ILS, got ${String(q.currency)}`);
  }

  // ── V-FX — THE CURRENCY BOUNDARY (GW-OPENAI-INTELLIGENCE-002 foundation) ──
  //
  // V-CURRENCY above checks the FINAL quote's LABEL. It has no visibility into
  // where the number came from, so a fully USD-derived price labelled "ILS"
  // passes it cleanly. There is no currency conversion anywhere in this
  // repository — `currency` is `const: 'ILS'` in the Stage-2 schema and every
  // write hardcodes ILS — and conversion is currently performed IN THE MODEL'S
  // HEAD, instructed by prose ("Electronics retail is typically 20-40% above US
  // prices").
  //
  // That is survivable only while every input is already ILS. The moment
  // international comparables are admitted it stops being survivable, and the
  // failure is SILENT: a $120 comp read as ₪120 is a 3.7x under-price, and
  // envelopes span 0.40x-8.00x, so a unit error is indistinguishable from a
  // plausible price. The user is under-paid, systematically, with a confident
  // grade attached and nothing to detect it.
  //
  // NO LIVE FX IS IMPLEMENTED HERE — that is deliberate and out of scope. What
  // exists now is the BOUNDARY: any evidence carrying money must declare its
  // currency and, if not ILS, the exact conversion used. Evidence that cannot
  // prove its own conversion does not contribute a number. Phase B supplies
  // `ctx.comps`; until then this loop simply never runs, which is the correct
  // behaviour for a rule whose job is to refuse unproven money.
  for (const comp of (Array.isArray(ctx.comps) ? ctx.comps : [])) {
    const cur = String(comp?.currency ?? '').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(cur)) {
      return degrade('V-FX', 'a comparable carries money with no explicit ISO 4217 currency — ' +
        'a bare "$" is not a currency, and an unlabelled amount may never contribute to a price');
    }
    if (cur === 'ILS') continue;
    const rate = Number(comp?.fx_rate);
    const normalized = Number(comp?.normalized_amount);
    if (!Number.isFinite(rate) || rate <= 0
        || String(comp?.normalized_currency ?? '').toUpperCase() !== 'ILS'
        || !Number.isFinite(normalized) || normalized <= 0
        || !comp?.fx_timestamp || !comp?.fx_source) {
      return degrade('V-FX',
        `a ${cur} comparable is missing its conversion record (fx_rate / normalized_amount / ` +
        'normalized_currency / fx_timestamp / fx_source). Conversion happens in GetWorth code ' +
        'before the guard, never in the model, and never implicitly.');
    }
    // The conversion must also be ARITHMETICALLY TRUE, not merely present.
    const expected = Number(comp.price_amount) * rate;
    if (!Number.isFinite(expected) || Math.abs(expected - normalized) > Math.max(1, expected * 0.01)) {
      return degrade('V-FX',
        `a ${cur} comparable's normalized_amount ${normalized} does not equal ` +
        `price_amount x fx_rate (${expected}) — the conversion record is not self-consistent`);
    }
  }

  // ── V-IDENTITY-FLOOR ───────────────────────────────────────────────────────
  //
  // NO MEANINGFUL IDENTITY ⇒ NO PRODUCT-SPECIFIC PRICE.
  //
  // This rule exists because the guard had no opinion about whether the item
  // had been identified. Every other rule asks "is this NUMBER defensible?" —
  // none asked "is there a PRODUCT to attach a number to?". A scan with no
  // brand, no model, empty OCR and category "Other" at 10% produced ₪30/₪70/₪130
  // and passed every check, because 70 is a perfectly plausible number for
  // something.
  //
  // Deliberately NOT a confidence check the model can argue with: the inputs
  // are `brandOk`/`modelOk` (derived from candidate strings, not self-reported
  // certainty) and the raw category confidence. A model claiming 0.99 while
  // returning brand null and model null still lands in UNIDENTIFIED. That is
  // the point — the LLM must not be able to buy pricing eligibility with an
  // assertion.
  // ── V-SOURCE-UNREGISTERED ──────────────────────────────────────────────────
  //
  // MANUAL_REQUIRED is a REFUSAL, and it has to refuse the NUMBER, not merely
  // label it. derivePricingSource was changed so an unregistered `pre_source`
  // grades MANUAL_REQUIRED instead of LOW — but probing showed the quote was
  // still ACCEPTED with mid 200 and a MANUAL_REQUIRED grade stapled to it. A
  // grade nothing enforces is a caption, and a future market source would have
  // shipped real prices under it.
  if (derived.grade === 'MANUAL_REQUIRED') {
    return degrade('V-SOURCE-UNREGISTERED',
      `pricing source "${ctx.pre_source ?? 'absent'}" resolves to ${derived.source}/MANUAL_REQUIRED — ` +
      'an unregistered or refusing source may not carry a price. Register it in ' +
      'derivePricingSource with a deliberate grade before it can price.');
  }

  // identity_tier and the two verdicts are already on `base` — see H-1 above.
  if (!PRICEABLE_TIERS.has(identityTier)) {
    return degrade('V-IDENTITY-FLOOR',
      `identity tier ${identityTier} cannot carry a product-specific price ` +
      `(brand=${ctx.identity?.brandOk ? 'ok' : 'none'} model=${ctx.identity?.modelOk ? 'ok' : 'none'} ` +
      `category_confidence=${ctx.recognition?.category_confidence ?? 'absent'})`);
  }

  // CATEGORY_ONLY prices FROM A CATEGORY, so the category has to be one we hold
  // price evidence for. If it matches no bucket there is nothing to price from
  // — only a confident-sounding string.
  //
  // This is the second half of the Ninja case, and it is the half a pure
  // confidence check would have missed. "Footwear" at 10% fails the tier test
  // above; "Footwear" at 99% passes it, because the model IS confident — it is
  // confidently reporting a category GetWorth has no price evidence for. Both
  // must refuse, and for the same reason: no brand, no model, and no bucket is
  // not a product, however certain the sentence sounds.
  //
  // Resolved from the RECOGNITION, deliberately NOT from `ctx.envelope_key`.
  // Honouring a caller-supplied key here would let one be handed in to answer a
  // question about a different category — probing confirmed it:
  // `envelope_key:'electronics'` with category "Footwear" at 0.99 priced
  // cleanly. The caller may choose which envelope BOUNDS a price; it may not
  // choose the evidence that decides whether there is a price at all.
  if (identityTier === IDENTITY_TIER.CATEGORY_ONLY
      && resolveEnvelopeKey(ctx.recognition || {}, ctx.evidence) === null) {
    return degrade('V-IDENTITY-FLOOR',
      `category-only identity in "${ctx.recognition?.category ?? 'unknown'}", which matches no priced ` +
      'category bucket — there is no evidence to price from');
  }

  // ── V-CATEGORY-DISAGREEMENT  ·  §4 ────────────────────────────────────────
  //
  // Two stages disagree about what the object IS, and nothing new was seen that
  // would settle it. `resolveCategoryAuthority` has already refused to move the
  // pricing category; this refuses to ship a number under either label.
  //
  // Pricing on Stage 1 while DISPLAYING Stage 2 is the failure mode that made
  // the original defect invisible — the envelope and the caption came from
  // different sentences and no test compared them. A user shown "Electronics"
  // and quoted a Books-bounded number has been told two things, one of which is
  // false, and cannot tell which.
  if (ctx.category_disagreement === true) {
    return degrade('V-CATEGORY-DISAGREEMENT',
      `stage categories disagree (pricing="${ctx.pricing_category ?? 'unknown'}", ` +
      `display="${ctx.display_category ?? 'unknown'}") and no ANCHOR or OBJECT_CLASS ` +
      'evidence justifies the wider envelope — the item is not priced under either label');
  }

  let mid = Math.round(q.mid);
  if (mid !== q.mid) repairs.push({ rule: 'R-ROUND', field: 'mid', from: q.mid, to: mid });

  // R-DERIVE-BAND — missing or zero band edges derived from mid. Same 0.75/1.25
  // constants the catalog rescue source already uses (analyze.js:3802-3804).
  let low = q.low, high = q.high;
  if (low == null || low === 0) {
    const d = Math.round(mid * 0.75);
    repairs.push({ rule: 'R-DERIVE-BAND', field: 'low', from: q.low ?? null, to: d });
    low = d;
  }
  if (high == null || high === 0) {
    const d = Math.round(mid * 1.25);
    repairs.push({ rule: 'R-DERIVE-BAND', field: 'high', from: q.high ?? null, to: d });
    high = d;
  }
  if (!Number.isFinite(low)) return degrade('V-FINITE', `low is not a finite number (${String(q.low)})`);
  if (!Number.isFinite(high)) return degrade('V-FINITE', `high is not a finite number (${String(q.high)})`);

  const rLow = Math.round(low), rHigh = Math.round(high);
  if (rLow !== low) repairs.push({ rule: 'R-ROUND', field: 'low', from: low, to: rLow });
  if (rHigh !== high) repairs.push({ rule: 'R-ROUND', field: 'high', from: high, to: rHigh });
  low = rLow; high = rHigh;

  // V-ORDER — unfixable without moving mid, and mid is never moved.
  if (!(low <= mid && mid <= high)) {
    return degrade('V-ORDER', `require low <= mid <= high, got ${low}/${mid}/${high}`);
  }
  if (low <= 0) return degrade('V-POSITIVE', `low must be > 0, got ${low}`);

  // V-ENVELOPE-HARD — out of range degrades. NEVER clamped into range.
  if (mid < env.floor) return degrade('V-ENVELOPE-HARD', `mid ${mid} < floor ${env.floor} (${env.key}/${env.basis})`);
  if (mid > env.hard_max) return degrade('V-ENVELOPE-HARD', `mid ${mid} > hard_max ${env.hard_max} (${env.key}/${env.basis})`);

  // V-SOURCE-POLICY — B-15: a confidently identified product is never priced
  // from a category bucket (analyze.js:3894-3897 is the primary guard; this is
  // the backstop that survives a refactor of that function).
  if (derived.source === 'category_bucket' && ctx.identity?.identityHigh) {
    return degrade('V-SOURCE-POLICY', 'category bucket may not price a confidently identified product (B-15)');
  }

  let grade = derived.grade;
  let needsReview = false;

  // A CATEGORY-ONLY PRICE MAY NOT CLAIM MORE THAN CATEGORY-LEVEL CONFIDENCE.
  //
  // CATEGORY_ONLY prices are legitimate — generic clothing really does have a
  // category price — but nothing distinguished one from a fully identified
  // product. A brandless, modelless "Clothing" scan and a forged identity both
  // surfaced as MEDIUM, which is the collision that makes the grade useless as
  // a signal. The grade is the machine-readable field the spread limits and
  // downstream logic key on, so capping it here is what actually changes
  // behaviour; the matching UI label is a frontend change against
  // `identity_tier`, which is already on the wire.
  // Flagged for EVERY category-only price, not only when the grade needs
  // lowering. Some sources already grade LOW, and "this describes the category,
  // not the product" is worth surfacing whichever source produced it —
  // otherwise the signal appears or vanishes depending on an unrelated detail.
  if (identityTier === IDENTITY_TIER.CATEGORY_ONLY) {
    if (grade === 'HIGH' || grade === 'MEDIUM') grade = 'LOW';
    needsReview = true;
    violations.push({
      rule: 'V-IDENTITY-GRADE-CAP',
      detail: 'category-only identity — no brand and no model were established, so the price ' +
              'describes the category rather than the product',
    });
  }

  // V-ENVELOPE-SOFT — plausible but exceptional. Priced and flagged, graded
  // down one step. For the buckets flagged requiresAnchorAboveSoft, an
  // exceptional price with no corroborating anchor is not priced at all.
  if (mid > env.soft_max) {
    // V5-1. THIS WAS THE ONE CONSUMER C-1 MISSED, twelve lines below where
    // hasMarketAnchor is defined. It read `!ctx.anchor` — the old truthiness
    // test — so a community-submitted row with no price satisfied the gate that
    // exists to police a 6.25x ceiling lift, in the category this module itself
    // calls the single most-hallucinated:
    //
    //   no anchor                 degrade  0
    //   PRICELESS community row   accept   240,000
    //   genuinely priced row      degrade  0        <- the real anchor refuses it
    //
    // My own comment in BUCKET_AUTHORITY said this rule "still applies on top,
    // unchanged". It was unchanged in the worst sense: unchanged means it still
    // applied to any object at all.
    if (env.requiresAnchorAboveSoft && !hasMarketAnchor(ctx)) {
      return degrade('V-ENVELOPE-SOFT', `mid ${mid} > soft_max ${env.soft_max} for ${env.key} with no compatible anchor`);
    }
    needsReview = true;
    grade = gradeDown(grade);
    violations.push({ rule: 'V-ENVELOPE-SOFT', detail: `mid ${mid} > soft_max ${env.soft_max} (${env.key}) — priced, flagged` });
  }
  if (env.basis === 'manual_only') {
    needsReview = true;
    grade = gradeDown(grade);
  }

  // V-SPREAD-MIN / V-SPREAD-MAX — repair, then re-check.
  const maxRatio = maxSpreadRatio(ctx.identity);
  let ratio = high / low;
  if (ratio < SPREAD_MIN_RATIO) {
    const nl = Math.min(low, Math.round(mid * 0.90));
    const nh = Math.max(high, Math.round(mid * 1.10));
    if (nl !== low) repairs.push({ rule: 'R-SPREAD-WIDEN', field: 'low', from: low, to: nl });
    if (nh !== high) repairs.push({ rule: 'R-SPREAD-WIDEN', field: 'high', from: high, to: nh });
    low = nl; high = nh; ratio = high / low;
  } else if (ratio > maxRatio) {
    // Multiplicative clamp toward mid. Guarantees high/low <= maxRatio and
    // preserves low <= mid <= high, because mid/sqrt(r) <= mid <= mid*sqrt(r).
    const s = Math.sqrt(maxRatio);
    const nl = Math.max(low, Math.round(mid / s));
    const nh = Math.min(high, Math.round(mid * s));
    if (nl !== low) repairs.push({ rule: 'R-SPREAD-CLAMP', field: 'low', from: low, to: nl });
    if (nh !== high) repairs.push({ rule: 'R-SPREAD-CLAMP', field: 'high', from: high, to: nh });
    low = nl; high = nh; ratio = high / low;
  }
  if (!(low <= mid && mid <= high)) return degrade('V-ORDER', `spread repair broke ordering: ${low}/${mid}/${high}`);
  if (ratio < SPREAD_MIN_RATIO) return degrade('V-SPREAD-MIN', `high/low ${ratio.toFixed(3)} < ${SPREAD_MIN_RATIO} after repair`);
  if (ratio > maxRatio) return degrade('V-SPREAD-MAX', `high/low ${ratio.toFixed(2)} > ${maxRatio} after repair`);

  // ── V-ENVELOPE-BAND ────────────────────────────────────────────────────────
  //
  // The hard envelope bounded `mid` and NOTHING ELSE. `low` was checked for
  // positivity and ordering; `high` only for ordering and the spread ratio. So
  // high <= low * maxRatio <= mid * maxRatio, and with SPREAD_MAX_WEAK = 6.0 a
  // DISPLAYED high could legally reach SIX TIMES hard_max.
  //
  // That was survivable only while `high` was read as a fuzzy upper edge nobody
  // quotes. It stops being survivable the moment the band is presented as a
  // distribution — quick_sale / fair_market / optimistic_listing — because
  // `optimistic_listing` is then a named, user-facing price that no envelope
  // ever checked. That is precisely the unguarded-number class VAL-001 exists
  // to close, re-entering through the presentation layer.
  //
  // Checked AFTER the spread repair, because the repair is what moves `high`;
  // validating before it would bless a number the caller never sees. Degrades
  // rather than clamps, like every other envelope rule here — clamping would
  // turn "this band is wrong" into a confidently wrong band.
  if (high > env.hard_max) {
    return degrade('V-ENVELOPE-BAND',
      `displayed high ${high} > hard_max ${env.hard_max} (${env.key}/${env.basis}) — ` +
      'the whole displayed distribution must fit the envelope, not just mid');
  }

  // ── V-MARKET-EVIDENCE  ·  §5 ─────────────────────────────────────────────
  //
  // A PRODUCT-LEVEL IDENTITY REQUIRES PRODUCT-LEVEL PRICE EVIDENCE.
  //
  // This is the rule that stops `stage2_ai` from masquerading as a valuation.
  // The Ninja witness: brand and model both READ OFF THE ITEM, EXACT_MODEL
  // identity, no catalog row anywhere in GetWorth — and the old code returned
  // ACCEPT ₪400 graded MEDIUM. The number came from the model. Nothing measured
  // it, and it was displayed in the same shape as an anchored price.
  //
  // PENDING_MARKET IS NOT A FAILURE. `action` is `pending`, not `degrade`, and
  // the identity survives in the metadata for /api/enrich to research. The
  // prices are zeroed and `degraded` is set true so that every EXISTING consumer
  // — all of which test `action === 'accept'` or read `degraded` — refuses the
  // number without being taught a new state first. A new state that old callers
  // silently treat as priced would be worse than the defect it replaces.
  //
  // Note the direction: this fires BECAUSE recognition succeeded. A weaker,
  // category-only identity still prices as BOUNDED, because a category estimate
  // that is labelled a category estimate is honest. What is not honest is a
  // product-specific number with no product-specific evidence.
  if (base.valuation_verdict === VALUATION_VERDICT.PENDING_MARKET) {
    violations.push({
      rule: 'V-MARKET-EVIDENCE',
      detail: `recognition_verdict=${base.recognition_verdict} with pricing source ` +
        `${derived.source} and no anchor — GetWorth holds no market evidence for this ` +
        'product, so no price is issued. Resolvable by /api/enrich (NOT BUILT).',
    });
    return verdict({
      action: 'pending',
      prices: { ...ZERO },
      repairs,
      violations,
      meta: {
        ...base,
        pricing_grade: 'MANUAL_REQUIRED',
        pricing_status: MANUAL_REQUIRED_STATUS,
        degraded: true,
        degraded_reason: 'V-MARKET-EVIDENCE: market evidence pending',
        needs_review: false,
      },
    });
  }

  return verdict({
    action: repairs.length ? 'repair' : 'accept',
    prices: { low, mid, high },
    repairs,
    violations,
    meta: { ...base, pricing_grade: grade, needs_review: needsReview },
  });
}

/**
 * Re-assert the invariants after a deterministic post-validation transform.
 *
 * The replica multiplier (analyze.js:2434-2438) scales an already-validated
 * triple by 0.07 / 0.15 / 0.28. Without this, the envelope guarantee is void
 * for exactly the items where it matters most: a ₪150 item at 0.07 becomes ₪11,
 * a number no envelope would ever have accepted. Degrades if the transformed
 * mid falls out of the envelope, so a replica-adjusted price is either
 * defensible or the item goes to manual pricing.
 */
export function applyTransform(v, { multiplier, reason, ctx = {} } = {}) {
  if (!v || v.action === 'degrade') return v;
  const m = Number(multiplier);
  if (!Number.isFinite(m) || m === 1) return v;
  if (m <= 0) {
    return {
      ...v, action: 'degrade', prices: { ...ZERO },
      violations: [...v.violations, { rule: 'V-TRANSFORM', detail: `non-positive multiplier ${String(multiplier)}` }],
      metadata: { ...v.metadata, pricing_grade: 'MANUAL_REQUIRED', degraded: true, degraded_reason: 'V-TRANSFORM: non-positive multiplier' },
    };
  }
  const env = resolveEnvelope(ctx);
  const prices = {
    low: Math.round(v.prices.low * m),
    mid: Math.round(v.prices.mid * m),
    high: Math.round(v.prices.high * m),
  };
  const transform = { rule: 'T-MULTIPLY', field: 'all', from: v.prices.mid, to: prices.mid, multiplier: m, reason: reason || null };
  // `low <= 0` is re-checked here because validateQuote enforces it strictly
  // (V-POSITIVE) and a multiplier must not be able to weaken a rule the quote
  // already passed: at small mids the replica multipliers round `low` to 0 while
  // mid/high stay valid and ordered, which would emit a band starting at ₪0.
  // Name the rule that actually failed. A single catch-all message ("mid below
  // floor") misreported every other cause, which makes a degrade in production
  // unattributable — and `degraded_reason` is what the rescue path logs.
  const cause =
    prices.mid <= 0 ? `mid ${prices.mid} is not positive`
    : prices.low <= 0 ? `low ${prices.low} rounded to zero or below`
    : prices.mid < env.floor ? `mid ${prices.mid} < floor ${env.floor}`
    : !(prices.low <= prices.mid && prices.mid <= prices.high)
      ? `unordered ${prices.low}/${prices.mid}/${prices.high}`
      : null;
  if (cause) {
    return {
      ...v, action: 'degrade', prices: { ...ZERO },
      transforms: [...(v.transforms || []), transform],
      violations: [...v.violations, { rule: 'V-TRANSFORM', detail: `post-transform ${cause} (x${m})` }],
      metadata: { ...v.metadata, pricing_grade: 'MANUAL_REQUIRED', degraded: true, degraded_reason: `V-TRANSFORM: post-transform ${cause}` },
    };
  }
  return {
    ...v,
    action: 'repair',
    prices,
    transforms: [...(v.transforms || []), transform],
    metadata: { ...v.metadata, needs_review: true },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// PRESENTATION BOUNDARY — the single decision of "is there a real price here?"
// ═══════════════════════════════════════════════════════════════════════════
// A verdict carries two INDEPENDENT facts, and conflating them is the UI-003
// Wave 0 defect:
//   • WHERE the number was derived from — `pricing_source`. degrade()
//     deliberately preserves the derived source (`stage2_ai`, `pre_haiku`, …)
//     so a rejection stays attributable in the ledger. It is a DIAGNOSTIC.
//   • WHETHER the number survived — `action`, `degraded`, `pricing_grade`, and
//     the emitted triple. That is the PERMISSION.
//
// api/analyze.js gated the manual-pricing status on
// `degraded && pricing_source === 'manual_required'`, i.e. it read the
// diagnostic as the permission. Every degrade() verdict — degraded:true, grade
// MANUAL_REQUIRED, prices 0/0/0 — failed the second half and was published as
// `pricing_status: 'ai_estimate'` carrying a ₪0 mid: a fabricated provenance
// claim over a price the guard had just rejected.
//
// These helpers make that unrepresentable. NO provenance field is read here, so
// no value of `pricing_source` — present or future — can defeat the invariant.

export const MANUAL_REQUIRED_STATUS = 'manual_required';
// The label for a priced result whose caller offered none. Only ever reached
// AFTER isPricedVerdict has said yes, so it can never manufacture provenance
// for a non-price.
export const DEFAULT_PRICED_STATUS = 'ai_estimate';

/**
 * True only when the verdict authorises presenting a real market price.
 *
 * Deliberately over-determined: the flag checks and the numeric check are each
 * INDEPENDENTLY sufficient to say no. A triple that is not strictly positive
 * and ordered is unpriced even if every flag claims otherwise, and a degraded
 * verdict is unpriced even if it somehow carries numbers. Zero is not an
 * estimate.
 */
export function isPricedVerdict(v) {
  if (!v) return false;                    // no verdict ⇒ the guard vouched for nothing
  if (v.action === 'degrade') return false;
  const md = v.metadata || {};
  if (md.degraded) return false;
  if (md.pricing_grade === 'MANUAL_REQUIRED') return false;
  const { low, mid, high } = v.prices || {};
  if (!Number.isFinite(mid) || mid <= 0) return false;
  if (!Number.isFinite(low) || low <= 0) return false;
  if (!Number.isFinite(high) || high < mid) return false;
  return true;
}

/**
 * The same invariant applied to a normalized `marketValue` (the WIRE shape),
 * for readers holding the response rather than the verdict — the persistence
 * sinks, and any client. Kept here so the server and the client are testably
 * asserting one rule; src/lib/utils.js mirrors this body and the contract
 * suite fails on drift (see also CONDITION_LADDER / C-10).
 *
 * The numeric half is NOT redundant with the status half: a response persisted
 * or cached by an older deploy can carry a priced status over a 0 mid, and this
 * rejects it without needing that deploy to be fixed first.
 */
export function isPricedMarketValue(mv) {
  if (!mv) return false;
  if (mv.pricing_status === MANUAL_REQUIRED_STATUS) return false;
  const mid = Number(mv.mid), low = Number(mv.low), high = Number(mv.high);
  if (!Number.isFinite(mid) || mid <= 0) return false;
  if (!Number.isFinite(low) || low <= 0) return false;
  if (!Number.isFinite(high) || high < mid) return false;
  return true;
}

/**
 * A STANDALONE reference price, normalized to "a real number or unknown".
 *
 * UI-003 Wave 0 (Gap B). `new_retail` is the only price column that is not part
 * of the valuation band, and it was the one column the band's guard never
 * covered. It was built as `verification.new_retail_price_ils || 0`
 * (analyze.js), which ALWAYS yields a number — so the `?? null` at both
 * persistence sites was unreachable code, and every scan without a retail signal
 * stored `new_retail = 0`. Zero is not a retail price: nothing is sold new for
 * ₪0, so the value could only ever mean "we don't know", encoded as a number
 * that averages, sums and sorts like a fact.
 *
 * NOT a substitute for isPricedMarketValue. That predicate answers "did the
 * guard approve a priced BAND?" and reads low/mid/high together; this normalizes
 * ONE independent number. They are deliberately unlinked: a degraded valuation
 * can still have a perfectly good known retail price, and suppressing it would
 * discard a real fact about the product. Use this ONLY for a lone reference
 * figure, never to decide whether an item is priced.
 *
 * Accepts numeric strings for the same reason hasRealPrice does — an upstream
 * JSON number may arrive quoted — and rejects everything that is not a finite
 * value strictly greater than zero.
 */
export function positivePriceOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * The user-facing pricing_status. `candidate` is the caller's preferred LABEL
 * for a priced result: it can only ever narrow. There is no argument to this
 * function that promotes an unpriced verdict into a priced status.
 */
export function resolvePricingStatus(v, candidate) {
  if (!isPricedVerdict(v)) return MANUAL_REQUIRED_STATUS;
  const c = typeof candidate === 'string' ? candidate.trim() : '';
  return c || DEFAULT_PRICED_STATUS;   // a caller that itself says manual_required is honoured
}

/**
 * The user-facing pricing_confidence, gated by the SAME predicate so the grade
 * and the status can never disagree about whether a price exists. (A grade of
 * MEDIUM beside a status of manual_required is the same lie in a smaller font.)
 */
export function resolvePricingGrade(v, candidate) {
  if (!isPricedVerdict(v)) return 'MANUAL_REQUIRED';
  const g = v?.metadata?.pricing_grade;
  if (GRADES.includes(g)) return g;
  const c = typeof candidate === 'string' ? candidate.trim() : '';
  return GRADES.includes(c) ? c : 'MEDIUM';
}
