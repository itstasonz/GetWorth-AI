// ══════════════════════════════════════════════════════════════════════════════
// PHASE B — DETERMINISTIC VALUATION CANDIDATE
//
// §20/§21: the LLM may help CLASSIFY observations. It may not be the thing that
// calculates the final number. Everything in this file is arithmetic over
// already-filtered observations — no model output reaches it except as data
// that market-research.js has already normalised and labelled.
//
// ── WHY DETERMINISM IS THE POINT, NOT A PREFERENCE ─────────────────────────
//
// A model asked "what is this worth" produces a number with no traceable
// relationship to any listing. It is unfalsifiable: you cannot ask which
// comparables moved it, and you cannot tell a good answer from a fluent one.
// A median over named observations can be wrong, but it is wrong in a way
// somebody can inspect — `sample_size` and the rejected list say exactly what
// it was computed from.
//
// ── §22 IS THE MOST IMPORTANT RULE IN THIS FILE ────────────────────────────
//
//   "No evidence is better than fake precision."
//
// With too few usable observations this returns PENDING_MARKET and NO price.
// That is not a degraded result; it is the correct one, and it is the same
// answer the Phase-A path already gives for the Ninja witness. The temptation
// this guards against is real: OpenAI will always produce a number if asked.
// ══════════════════════════════════════════════════════════════════════════════
import { CONDITION_LADDER, normalizeConditionBasis } from '../valuation-guard.js';

export const VALUATION_STATUS = Object.freeze({
  PRICED: 'PRICED',
  PENDING_MARKET: 'PENDING_MARKET',
  INSUFFICIENT_IDENTITY: 'INSUFFICIENT_IDENTITY',
});

/**
 * The floor for pricing at all.
 *
 * THREE, not one. A single listing is an anecdote: one optimistic seller
 * becomes "the market". Three is the smallest number from which a median means
 * anything, and it is deliberately stated as a constant rather than buried in a
 * comparison so the choice is visible and changeable.
 */
export const MIN_OBSERVATIONS_TO_PRICE = 3;

/** Quantile of a sorted array, linear interpolation. */
function quantile(sorted, q) {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * The condition multiplier, taken from GetWorth's OWN ladder.
 *
 * §18 says adapt to the existing condition vocabulary, and CONDITION_LADDER in
 * api/_lib/valuation-guard.js is it. Reusing it means a Phase-B "Good" and a
 * Phase-A "Good" mean the same thing — two ladders that agree by inspection is
 * how `/watch/` and `includes('watch')` drifted apart on the Phase-A side.
 *
 * The comparables are already used items, so the BASIS is 'used': an observed
 * second-hand median already reflects average wear. The adjustment is the
 * difference between this item's condition and that average, not a discount
 * from new.
 */
export function conditionMultiplier(grade) {
  const norm = normalizeConditionBasis(grade);
  if (!norm) return { multiplier: 1, applied: false, basis: 'used', reason: 'condition unknown or unmapped' };
  const base = CONDITION_LADDER.used;
  const target = CONDITION_LADDER[norm];
  if (typeof target !== 'number') {
    return { multiplier: 1, applied: false, basis: 'used', reason: `no ladder entry for ${norm}` };
  }
  // Ladder values are DISCOUNTS from new; a higher value is a worse item.
  const multiplier = (1 - target) / (1 - base);
  return {
    multiplier: Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1,
    applied: true,
    basis: 'used',
    reason: `condition ${norm} relative to used-market basis`,
  };
}

/**
 * Compute a candidate distribution from accepted ILS observations.
 *
 * low/mid/high are GetWorth's canonical field names; §20 maps them to
 * quick_sale / fair_market / optimistic_listing and explicitly says NOT to
 * introduce new columns for the naming. Both names travel together so the
 * product meaning is legible without a schema change.
 */
export function computeValuationCandidate({
  accepted = [],
  condition = null,
  identityConfidence = 0,
  specificity = null,
} = {}) {
  const prices = accepted
    .map((o) => o.normalized_ils_price)
    .filter((p) => typeof p === 'number' && Number.isFinite(p) && p > 0)
    .sort((a, b) => a - b);

  const base = {
    status: VALUATION_STATUS.PENDING_MARKET,
    currency: 'ILS',
    low: null, mid: null, high: null,
    sample_size: prices.length,
    specificity,
    condition_adjustment: null,
    reason: null,
    // §20's product vocabulary, alongside the canonical names.
    labels: { low: 'quick_sale', mid: 'fair_market', high: 'optimistic_listing' },
  };

  if (prices.length < MIN_OBSERVATIONS_TO_PRICE) {
    return {
      ...base,
      reason: `only ${prices.length} usable ILS observation(s); ${MIN_OBSERVATIONS_TO_PRICE} required. ` +
        'No evidence is better than fake precision.',
    };
  }

  // ROBUST CENTRAL TENDENCY. The median, not the mean — a marketplace price
  // distribution has a long right tail (optimistic listings that never sell)
  // and a mean follows it upward.
  const mid = quantile(prices, 0.5);
  const low = quantile(prices, 0.25);
  const high = quantile(prices, 0.85);

  const cond = conditionMultiplier(condition);
  const scale = (v) => (v === null ? null : Math.round(v * cond.multiplier));

  return {
    ...base,
    status: VALUATION_STATUS.PRICED,
    low: scale(low),
    mid: scale(mid),
    high: scale(high),
    condition_adjustment: cond,
    reason: `${prices.length} accepted ILS observations; p25/p50/p85 with ${cond.applied ? 'condition' : 'no condition'} adjustment`,
    identity_confidence: identityConfidence,
  };
}
