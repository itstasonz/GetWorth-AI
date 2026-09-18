// ═══════════════════════════════════════════════════════════════════════════
// VAL-001 — Valuation Guard: the single validation choke point for every price
// ═══════════════════════════════════════════════════════════════════════════
// Every number reaching a user, `valuations`, `price_observations`, a
// Recognition-Memory sample, or later pricing logic passes validateQuote()
// first. Stage 2 and the Pricing Rescue Engine both go through it — PRE quotes
// are not trusted just because they came from the rescue path.
//
// CONTRACT (same as api/_lib/recognition-memory.js): PURE. No I/O, no network,
// no clock, no process.env, no imports — a function of its arguments only.
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

// ── EVIDENCE CLASSIFICATION (HIGH-4) ───────────────────────────────────────
// `evidence` on a brand/model candidate is a FREE-FORM STRING the model writes
// about its own reasoning — the schema declares `{ type: 'string' }` and nothing
// constrains it. It is therefore not a trust input by itself; it is only ever
// used here to answer one narrow question:
//
//   does this candidate rest on characters read off the item?
//
// If it does, the candidate is photographed text by another name, and the
// narrow-only rule applies to it exactly as it applies to `raw_texts`.
//
// FAILS CLOSED. An unrecognised evidence string is 'unknown', which is treated
// as read-off-the-item. A new value invented by a model, or by a future engine,
// cannot buy widening power by being unfamiliar — and 'unknown' is where an
// absent, empty, or non-string evidence field lands too.
//
// Only 'visual' — shape, silhouette, form factor, colour — is evidence that
// does NOT come from reading the item, and only 'visual' may widen an envelope.
const EVIDENCE_PATTERNS = [
  [/text|ocr|label|sticker|engrav|print|serial|marking|writ|read/, 'text'],
  [/logo|emblem|badge|wordmark/, 'logo'],
  [/packag|box|carton|blister/, 'packaging'],
  [/shape|silhouette|form|visual|appearance|colou?r|material|design/, 'visual'],
];

export function evidenceClass(evidence) {
  if (typeof evidence !== 'string') return 'unknown';
  const e = evidence.toLowerCase().trim();
  if (!e) return 'unknown';
  for (const [pattern, cls] of EVIDENCE_PATTERNS) if (pattern.test(e)) return cls;
  return 'unknown';
}

// ── Category key matcher ───────────────────────────────────────────────────
// Ported from getCategoryFallbackPricing (analyze.js:3576-3625), ordered,
// first match wins. THIS module is the intended single authority for the
// taxonomy; analyze.js still carries its own copy for the PRE category
// fallback and should later delegate to resolveEnvelopeKey() so the envelope
// and the fallback price can never disagree about what an item is.
function resolveEnvelopeKeyFrom(recognition, { trustOcr, trustRead = true }) {
  const cat = (recognition.category || '').toLowerCase();
  const sub = (recognition.subcategory || '').toLowerCase();
  const pt = (recognition.product_type || '').toLowerCase();
  // ── HIGH-4: THE CANDIDATES ARE PHOTOGRAPHED TEXT TOO ─────────────────────
  // `resolveEnvelopeKey` resolves twice and keeps the lower ceiling, so
  // photographed text may narrow an envelope and never widen it. That rule was
  // defeated on BOTH passes, because `brand_candidates` and `model_candidates`
  // ARE distilled from photographed text — Stage 1 reads a sticker and emits
  // `{ brand: 'Rolex', evidence: 'readable_text' }`. The supposedly
  // OCR-independent resolution read that candidate and selected
  // `watches:luxury`, hard_max 250,000, from a baseline of 6,400. Excluding
  // `raw_texts` while trusting the candidates distilled from them is not a
  // boundary; it is the same input wearing a different field name.
  //
  // `trustRead: false` is the THIRD resolution — shape and category only, no
  // value that rests on characters read off the item. See resolveEnvelopeKey
  // for what is done with the difference, and for why the answer is not simply
  // "take the tighter one".
  const usable = (c) => (trustRead ? true : evidenceClass(c?.evidence) === 'visual');
  const topModel = recognition.model_candidates?.[0];
  const topBrand = recognition.brand_candidates?.[0];
  const mdl = (usable(topModel) ? topModel?.model || '' : '').toLowerCase();
  const brnd = (usable(topBrand) ? topBrand?.brand || '' : '').toLowerCase();
  const ocr = trustOcr ? (recognition.ocr_text?.raw_texts || []).join(' ').toLowerCase() : '';
  const sig = `${sub} ${pt} ${mdl} ${ocr}`;
  const el = cat.includes('electron');

  const MATCHERS = [
    ['electronics:iphone',         () => el && (brnd.includes('apple') || sig.includes('iphone'))],
    ['electronics:macbook',        () => el && sig.includes('macbook')],
    ['electronics:ipad',           () => el && sig.includes('ipad')],
    ['electronics:smartwatch',     () => el && (sig.includes('smartwatch') || /garmin|fitbit|apple watch|galaxy watch/.test(sig))],
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
    ['bags',                       () => cat.includes('bag') || sub.includes('bag') || sub.includes('backpack')],
    ['jewelry',                    () => cat.includes('jewel') || sub.includes('jewel') || /ring|necklace|bracelet/.test(sub)],
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

/**
 * Which pricing envelope governs this item — with PHOTOGRAPHED TEXT ALLOWED TO
 * NARROW THE ANSWER, NEVER TO WIDEN IT.
 *
 * `sig` used to include `ocr_text.raw_texts` unconditionally, so a string a
 * person PRINTS ON A STICKER selected the constraint that governs its own
 * price. Writing "macbook" on any electronics item moved the ceiling from
 * electronics (or global) to `electronics:macbook`, hard_max 40,000 — the
 * attacker choosing the ruler they are measured against. The photographed
 * label is the least trustworthy input in the pipeline and it had the most
 * leverage over the guard.
 *
 * It is not simply removed, because OCR is genuinely the best evidence for
 * several buckets: `kx-t`/`dect` is how a cordless phone is recognised at all,
 * and those buckets are TIGHTER than the category they sit in. Removing OCR
 * would push real items into looser envelopes, which is the same inversion in
 * the other direction.
 *
 * So both keys are resolved and the SAFER one wins:
 *   - resolve from trusted signals only (category / subcategory / product_type
 *     / brand / model — all classifier output, not raw pixels-to-text)
 *   - resolve again with OCR included
 *   - take the OCR-influenced key ONLY when it does not raise hard_max
 *
 * Same doctrine the rest of this module already applies to comparables and to
 * anchors: untrusted evidence may tighten a bound, never relax one.
 */
export function resolveEnvelopeKey(recognition = {}) {
  const trustedKey = resolveEnvelopeKeyFrom(recognition, { trustOcr: false });
  const ocrKey = resolveEnvelopeKeyFrom(recognition, { trustOcr: true });
  if (ocrKey === trustedKey) return trustedKey;

  // OCR MAY NARROW A BUCKET. IT MAY NOT CONJURE ONE.
  //
  // The first version compared ceilings and kept the lower, treating a null key
  // as GLOBAL_ENVELOPE's 500,000 — so ANY real bucket looked narrower and was
  // accepted. But a null key does not mean "the loosest envelope": for a
  // non-confirmed identity `resolveEnvelope` maps it to MANUAL_ONLY (2,000),
  // and the CATEGORY_ONLY rule refuses to price on it at all. So the two
  // disagreed, and "strictly narrowing" was false exactly where it mattered.
  //
  // Reproduced: category "Kitchen", confidence 0.9, no brand, no model. With no
  // OCR the scan is REFUSED (no bucket, nothing to price from). Print
  // "DELONGHI ESPRESSO" on it and the same scan resolves to
  // home:kitchen appliance and is ACCEPTED at ₪2,500 — a refusal converted into
  // a price by a sticker, which is the whole attack this function exists to
  // stop, in its purest form.
  if (trustedKey === null) return null;

  const ceiling = (k) => {
    if (!k) return GLOBAL_ENVELOPE.hard_max;      // no bucket -> the loosest
    const e = ENVELOPES[k];
    return e ? e.hard_max : GLOBAL_ENVELOPE.hard_max;
  };
  // Strictly narrowing only. Equal ceilings keep the OCR key, because a
  // same-ceiling bucket is a more specific description at no extra permission.
  return ceiling(ocrKey) <= ceiling(trustedKey) ? ocrKey : trustedKey;
}

/**
 * HIGH-4 — is the resolved envelope LOOSER than what shape alone would allow?
 *
 * WHY THIS IS NOT "just take the tighter one".
 * The obvious fix — resolve without the read-derived candidates and keep that —
 * is wrong, and measurably so. Specific envelopes are LOOSER than their generic
 * parents on purpose, because specific products are worth more:
 * `electronics:iphone` allows 24,000 where `electronics` allows 6,400. Almost
 * every legitimate identity is text-derived, so refusing all text-derived
 * escalation would cap every iPhone GetWorth ever sees at ₪6,400. That is a
 * pricing regression wearing a safety argument, and this round forbids exactly
 * that trade.
 *
 * So the escalation is ALLOWED and made CONDITIONAL. When the only reason a
 * looser bucket was selected is a value read off the item, the resulting
 * envelope requires an ANCHOR above its soft_max — real catalog corroboration,
 * not more photographed text.
 *
 * WHAT THIS DOES AND DOES NOT DO, stated plainly. It does NOT lower the Rolex
 * witness's 250,000 ceiling. `watches:luxury` already carried
 * `requiresAnchorAboveSoft`, so a sticker-only Rolex was already bounded at
 * 40,000 — which the review said, and which is why it was a HIGH and not a
 * CRITICAL. What changes is that the bound is now a RULE that follows from how
 * the identity was obtained, rather than a flag someone happened to set on one
 * row of a table. A luxury bucket added tomorrow without the flag inherits it.
 */
export function envelopeIsReadEscalated(recognition = {}) {
  const chosen = resolveEnvelopeKey(recognition);
  if (!chosen) return false;
  const visualKey = resolveEnvelopeKeyFrom(recognition, { trustOcr: false, trustRead: false });
  if (visualKey === chosen) return false;

  const soft = (k) => (k && ENVELOPES[k] ? ENVELOPES[k].soft_max : 0);
  const hard = (k) => (k && ENVELOPES[k] ? ENVELOPES[k].hard_max : 0);
  // Looser in either dimension. A tighter-or-equal escalation is not an
  // escalation, and must not acquire a requirement it does not need.
  return soft(chosen) > soft(visualKey) || hard(chosen) > hard(visualKey);
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
  const brandEvidenced = textConfirmed || Number(id.brandC) >= IDENTITY_CONFIDENCE_FLOOR;
  const modelEvidenced = textConfirmed || Number(id.modelC) >= IDENTITY_CONFIDENCE_FLOOR;

  const brandOk = id.brandOk === true && brandEvidenced;
  const modelOk = id.modelOk === true && modelEvidenced;

  // A confidence is a PROBABILITY, and it must arrive as a NUMBER. Probing
  // found two ways past a naive check: `5` and `99` are finite and above the
  // floor, and `true` coerces to exactly 1. Neither is a confidence; both bought
  // category trust. Out of [0,1], or not a number at all, is malformed input —
  // and malformed input must never read as strong.
  const raw = ctx.recognition?.category_confidence;
  const catConf = typeof raw === 'number' ? raw : NaN;
  const categoryTrusted = Number.isFinite(catConf)
    && catConf >= CATEGORY_CONFIDENCE_FLOOR
    && catConf <= 1;

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
  const retail = Number(ctx.anchor?.retail_price_ils);
  // A catalog anchor whose VARIANT contradicts the item does not describe this
  // unit, and an anchor sets the envelope — so the contradiction would hand the
  // wrong ceiling to the wrong product. Fall through to the category envelope
  // rather than trusting it. Silent on absence; only a real conflict rejects.
  const anchorText = `${ctx.anchor?.model ?? ''} ${ctx.anchor?.name ?? ''}`;
  const itemText = `${ctx.recognition?.model_candidates?.[0]?.model ?? ''} `
    + `${(ctx.recognition?.ocr_text?.raw_texts || []).join(' ')}`;
  const variantConflict = ctx.anchor ? variantContradiction(anchorText, itemText) : null;

  if (Number.isFinite(retail) && retail > 0 && !variantConflict) {
    return {
      key: ctx.anchor.id ? `anchor:${ctx.anchor.id}` : 'anchor',
      basis: 'anchor',
      floor: Math.round(retail * ANCHOR_MULTIPLIERS.FLOOR),
      soft_max: Math.round(retail * ANCHOR_MULTIPLIERS.SOFT),
      hard_max: Math.round(retail * ANCHOR_MULTIPLIERS.HARD),
      requiresAnchorAboveSoft: false,
    };
  }
  const key = ctx.envelope_key ?? resolveEnvelopeKey(ctx.recognition || {});
  const env = key ? ENVELOPES[key] : null;
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
    const tier = resolveIdentityTier(ctx);
    const identityConfirmed = tier === IDENTITY_TIER.EXACT_MODEL
      || tier === IDENTITY_TIER.FAMILY
      || tier === IDENTITY_TIER.BRAND_ONLY;
    if (!identityConfirmed) {
      return { key: key || 'global', basis: 'manual_only', ...MANUAL_ONLY, requiresAnchorAboveSoft: false };
    }
    return { key: key || 'global', basis: 'global', ...GLOBAL_ENVELOPE, requiresAnchorAboveSoft: false };
  }
  // HIGH-4. If the only reason this bucket is looser than the shape-only one is
  // a value READ OFF THE ITEM, everything above its soft_max needs an anchor —
  // catalog corroboration, not more photographed text. See
  // envelopeIsReadEscalated for why the escalation is permitted at all.
  //
  // `ctx.envelope_key` deliberately does NOT get this treatment: a
  // caller-supplied key is already refused as an identity answer by
  // V-IDENTITY-FLOOR, and re-deriving escalation from a key whose provenance we
  // do not know would be guessing.
  const readEscalated = ctx.envelope_key == null && envelopeIsReadEscalated(ctx.recognition || {});
  return {
    key: env.key,
    basis: env.class === 'manual_only' ? 'manual_only' : 'category',
    floor: env.floor,
    soft_max: env.soft_max,
    hard_max: env.hard_max,
    requiresAnchorAboveSoft: !!env.requiresAnchorAboveSoft || readEscalated,
    readEscalated,
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
  const anchored = !!ctx.anchor;
  if (ctx.stage === 'pre') {
    switch (ctx.pre_source) {
      // MEDIUM only when the row's MODEL column was hit by evidence, mirroring
      // the existing PRE grading rule (analyze.js:3795,3806).
      case 'catalog': return { source: 'pre_catalog', grade: ctx.anchorModelEvidence ? 'MEDIUM' : 'LOW' };
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

  const degrade = (rule, detail) => {
    violations.push({ rule, detail });
    return verdict({
      action: 'degrade',
      // 0/0/0 on degrade so a caller that ignores `action` fails loudly into the
      // manual-price UI rather than shipping the rejected number.
      prices: { ...ZERO },
      repairs,
      violations,
      meta: { ...base, pricing_grade: 'MANUAL_REQUIRED', degraded: true, degraded_reason: `${rule}: ${detail}` },
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

  const identityTier = resolveIdentityTier(ctx);
  base.identity_tier = identityTier;
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
      && resolveEnvelopeKey(ctx.recognition || {}) === null) {
    return degrade('V-IDENTITY-FLOOR',
      `category-only identity in "${ctx.recognition?.category ?? 'unknown'}", which matches no priced ` +
      'category bucket — there is no evidence to price from');
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
    if (env.requiresAnchorAboveSoft && !ctx.anchor) {
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
