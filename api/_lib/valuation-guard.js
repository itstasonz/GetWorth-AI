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

export const VALIDATOR_VERSION = 1;
// bump on ANY envelope/threshold change.
// 2026-08-05.1 — applyTransform now also rejects a post-multiply low <= 0, so a
// replica adjustment can no longer emit a band starting at ₪0 (a rule
// validateQuote already enforced; the transform path was weaker).
export const RULESET_VERSION = '2026-08-05.1';

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

// ── Category key matcher ───────────────────────────────────────────────────
// Ported from getCategoryFallbackPricing (analyze.js:3576-3625), ordered,
// first match wins. THIS module is the intended single authority for the
// taxonomy; analyze.js still carries its own copy for the PRE category
// fallback and should later delegate to resolveEnvelopeKey() so the envelope
// and the fallback price can never disagree about what an item is.
export function resolveEnvelopeKey(recognition = {}) {
  const cat = (recognition.category || '').toLowerCase();
  const sub = (recognition.subcategory || '').toLowerCase();
  const pt = (recognition.product_type || '').toLowerCase();
  const mdl = (recognition.model_candidates?.[0]?.model || '').toLowerCase();
  const brnd = (recognition.brand_candidates?.[0]?.brand || '').toLowerCase();
  const ocr = (recognition.ocr_text?.raw_texts || []).join(' ').toLowerCase();
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

// ctx.anchor — a catalog row the CALLER has already confirmed compatible via
// isCompatibleAnchor (analyze.js:3726). This module cannot import that function:
// it lives in api/analyze.js alongside the Vercel handler and module-level env
// reads, so importing it would create an import cycle and break the "no side
// effects" contract. The caller resolves compatibility; the guard consumes the
// verdict. Passing an INCOMPATIBLE row here silently widens the envelope to the
// wrong product — resolve it with isCompatibleAnchor or pass null.
export function resolveEnvelope(ctx = {}) {
  const retail = Number(ctx.anchor?.retail_price_ils);
  if (Number.isFinite(retail) && retail > 0) {
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
  if (!env) return { key: key || 'global', basis: 'global', ...GLOBAL_ENVELOPE, requiresAnchorAboveSoft: false };
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
  const anchored = !!ctx.anchor;
  if (ctx.stage === 'pre') {
    switch (ctx.pre_source) {
      // MEDIUM only when the row's MODEL column was hit by evidence, mirroring
      // the existing PRE grading rule (analyze.js:3795,3806).
      case 'catalog': return { source: 'pre_catalog', grade: ctx.anchorModelEvidence ? 'MEDIUM' : 'LOW' };
      case 'ai_haiku': return { source: 'pre_haiku', grade: 'MEDIUM' };
      case 'category_anchor': return { source: 'category_bucket', grade: 'LOW' };
      case 'none': return { source: 'manual_required', grade: 'MANUAL_REQUIRED' };
      default: return { source: 'unknown', grade: 'LOW' };
    }
  }
  if (ctx.stage === 'stage2') {
    return anchored
      ? { source: 'stage2_comp_anchored', grade: 'HIGH' }
      : { source: 'stage2_ai', grade: 'MEDIUM' };
  }
  return { source: 'unknown', grade: 'LOW' };
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
