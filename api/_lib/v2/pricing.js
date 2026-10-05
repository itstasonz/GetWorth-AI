// ══════════════════════════════════════════════════════════════════════════════
// SCAN ENGINE V2 — THE PRICE STATE
//
// TWO THINGS ARE REPORTED, AND THEY ARE NEVER ADDED TOGETHER:
//
//   USED MARKET VALUE           what the item sells for second-hand. It has a
//                               state, and the state IS the claim.
//   RETAIL REPLACEMENT ANCHOR   what it costs to buy one new, here, today.
//                               Context beside the value. Not a value.
//
// The used-market states — each one a different claim, never merged:
//
//   VERIFIED_MARKET_VALUE      the evidence gate minted a VERIFIED_MARKET token
//                              for this product and the guard accepted the
//                              price computed from exactly those listings,
//                              with no material repair
//   USED_EVIDENCE_ESTIMATE     the same sufficient exact used evidence — and
//                              the deterministic guard materially adjusted the
//                              displayed range (widened or clamped it). The
//                              listings are verified; the numbers are the guard's
//   USED_EVIDENCE_BELOW_QUORUM real second-hand listings for THIS product were
//                              admitted, and the set did not reach the quorum
//                              or the source floor
//   COMPARABLE_MARKET_ESTIMATE the item is a KIND of object, priced from its
//                              verified comparables: that kind's market, never
//                              this product's
//   MARKET_INFORMED_ESTIMATE   the identity is product-level and strong, a
//                              local shop's new price for the exact product
//                              is in hand, the used market is thin — and a
//                              MEASURED resale factor exists for this kind of
//                              object in this condition (resale-factors.js).
//                              The estimate is the anchor times that factor,
//                              blended with whatever exact used listings were
//                              admitted below the quorum. Disclosed as an
//                              estimate, with its own pricing confidence.
//   NEED_MORE_INFORMATION      the identity cannot carry a product price
//   NO_PRICE_EVIDENCE          identified and searched, and no second-hand
//                              listing for it was admitted (or the search failed)
//
// The RETAIL_REPLACEMENT_ANCHOR is not a state: it is reported beside whichever
// state the used evidence earned, under `retail_anchor`, and is never promoted
// into one. "Retail evidence only" is NO_PRICE_EVIDENCE with an anchor — and a
// LIMITATION that says what the estimate is waiting for.
//
// ── THREE CLAIMS, ABOVE THE STATES ──────────────────────────────────────────
//
// `evidence_state` folds the finer states into the three answers the product
// makes: VERIFIED_USED_MARKET, MARKET_INFORMED_ESTIMATE, INSUFFICIENT_EVIDENCE.
//
// ── WHAT IS DELIBERATELY NOT HERE ───────────────────────────────────────────
//
// No universal percentage. The condition ladder discounts "used" by a fixed
// share of new and has never been measured against a market; it is not used
// to turn a shop price into a value. A resale factor enters only from the
// table scripts/valuation-calibration.mjs writes from observed pairs, per
// category and kind of object, and a group it did not measure yields nothing:
// the state says INSUFFICIENT_EVIDENCE and names the missing factor.
//
// ── TWO CONFIDENCES, NEVER ONE ──────────────────────────────────────────────
//
// How sure we are WHAT the item is and how well its PRICE is evidenced are
// separate answers, reported in separate fields, and neither is computed from
// the other. A blender read off its own panel at 0.98 may have no used market
// at all; that is a strong identity with no pricing evidence, not a weak scan.
//
// No catalog row takes part in V2, and no model produces a number anywhere.
// ══════════════════════════════════════════════════════════════════════════════
import { computeValuationCandidate, conditionMultiplier, VALUATION_STATUS } from '../phaseb/valuation.js';
import { rejectOutliers } from '../phaseb/market-research.js';
import { applyGuard, corroborateSubject } from '../phaseb/validation.js';
import { DECISION, IDENTITY_LEVEL } from './sufficiency.js';
import { SEARCH_OUTCOME } from './search.js';
import { ANCHOR_STRENGTH } from './evidence.js';
import { findResaleFactor, loadResaleFactors } from './resale-factors.js';

export const PRICE_STATE = Object.freeze({
  VERIFIED_MARKET_VALUE: 'VERIFIED_MARKET_VALUE',
  USED_EVIDENCE_ESTIMATE: 'USED_EVIDENCE_ESTIMATE',
  USED_EVIDENCE_BELOW_QUORUM: 'USED_EVIDENCE_BELOW_QUORUM',
  COMPARABLE_MARKET_ESTIMATE: 'COMPARABLE_MARKET_ESTIMATE',
  MARKET_INFORMED_ESTIMATE: 'MARKET_INFORMED_ESTIMATE',
  NEED_MORE_INFORMATION: 'NEED_MORE_INFORMATION',
  NO_PRICE_EVIDENCE: 'NO_PRICE_EVIDENCE',
});
/** Every state a scan can end in. */
export const PRODUCED_STATES = Object.freeze(Object.values(PRICE_STATE));
/** The three claims the product makes, above the finer states. */
export const EVIDENCE_STATE = Object.freeze({ VERIFIED_USED_MARKET: 'VERIFIED_USED_MARKET', MARKET_INFORMED_ESTIMATE: 'MARKET_INFORMED_ESTIMATE', INSUFFICIENT_EVIDENCE: 'INSUFFICIENT_EVIDENCE' });
/** Why no estimate: what it is waiting for. */
export const LIMITATION = Object.freeze({ IDENTITY: 'identity_below_product_level', SEARCH: 'search_did_not_complete', NO_ANCHOR: 'no_retail_anchor', NO_FACTOR: 'no_calibrated_resale_factor', NOT_BELOW_RETAIL: 'estimate_not_below_retail', GUARD: 'guard_declined_the_market_price' });

export const BASIS = Object.freeze({
  VERIFIED_LISTINGS: 'verified_used_listings',
  COMPARABLE_LISTINGS: 'verified_comparable_listings',
  ADMITTED_BELOW_QUORUM: 'admitted_used_listings_below_quorum',
  GUARD_ADJUSTED: 'verified_used_listings_range_adjusted',
  COMPARABLE_GUARD_ADJUSTED: 'verified_comparable_listings_range_adjusted',
  MARKET_INFORMED: 'retail_anchor_times_measured_resale_factor',
  NONE: 'none',
});

export const USED_EVIDENCE = Object.freeze({ NONE: 'NONE', BELOW_QUORUM: 'BELOW_QUORUM', COMPARABLE: 'COMPARABLE', MARKET_INFORMED: 'MARKET_INFORMED', VERIFIED: 'VERIFIED' });
export const IDENTITY_CONFIDENCE = Object.freeze({ VERY_HIGH: 'VERY_HIGH', HIGH: 'HIGH', MODERATE: 'MODERATE', LOW: 'LOW' });

const evidenceStateOf = (state) => {
  if (state === PRICE_STATE.VERIFIED_MARKET_VALUE || state === PRICE_STATE.USED_EVIDENCE_ESTIMATE) return EVIDENCE_STATE.VERIFIED_USED_MARKET;
  if (state === PRICE_STATE.MARKET_INFORMED_ESTIMATE) return EVIDENCE_STATE.MARKET_INFORMED_ESTIMATE;
  return EVIDENCE_STATE.INSUFFICIENT_EVIDENCE;
};

/** A kind of object needs a small sample before its comparables say anything. */
export const MIN_GENERIC_LISTINGS = 3;
const NO_ANCHOR = Object.freeze({
  kind: 'RETAIL_REPLACEMENT_ANCHOR', strength: ANCHOR_STRENGTH.NONE, currency: 'ILS',
  low: null, median: null, high: null, shops: 0, prices: [],
});

const median = (sorted) => (sorted.length % 2
  ? sorted[(sorted.length - 1) / 2]
  : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2);

/** low / recommended / high from a small set of real prices, condition-adjusted. */
function rangeOf(prices, grade) {
  const sorted = [...prices].filter((p) => Number.isFinite(p) && p > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const { multiplier } = conditionMultiplier(grade);
  const scale = (v) => Math.round(v * multiplier);
  return { low: scale(sorted[0]), recommended: scale(median(sorted)), high: scale(sorted[sorted.length - 1]) };
}

/** The identity in the shape the existing guard and corroboration read. */
function guardIdentity(identity, subject) {
  return {
    subject,
    confidence: { overall: Math.min(identity?.brand?.confidence ?? 0, identity?.model?.confidence ?? identity?.brand?.confidence ?? 0) },
    references: [],
  };
}

/** How sure we are WHAT it is. Reads the identity and the gate, and no price. */
export function identityConfidence(identity, sufficiency) {
  const model = identity?.model ?? {};
  const read = model.evidence === 'TEXT_READ' || model.evidence === 'LABEL_READ';
  let level = IDENTITY_CONFIDENCE.LOW;
  if (sufficiency?.decision === DECISION.SEARCH_NOW) {
    if (sufficiency.level === IDENTITY_LEVEL.PRODUCT) {
      level = read && (model.confidence ?? 0) >= 0.9 ? IDENTITY_CONFIDENCE.VERY_HIGH : IDENTITY_CONFIDENCE.HIGH;
    } else {
      level = IDENTITY_CONFIDENCE.MODERATE;
    }
  }
  return {
    level,
    brand: identity?.brand?.confidence ?? 0,
    model: model.confidence ?? 0,
    model_read_off_item: read,
    identity_level: sufficiency?.level ?? null,
  };
}

/**
 * Resolve the scan's price.
 *
 * `evidence` is assessV2Evidence's report, or null when no search ran.
 */
export function resolveV2Price({
  identity, subject, sufficiency, evidence = null, searchOutcome = SEARCH_OUTCOME.NOT_ATTEMPTED,
  // The factor table. Tests hand in a measured one; production reads the file.
  resaleFactors = undefined,
} = {}) {
  const anchor = evidence?.retail_anchor ?? NO_ANCHOR;
  const idConfidence = identityConfidence(identity, sufficiency);
  const finish = (used, usedEvidence, limitation = null) => ({
    ...used,
    currency: 'ILS',
    evidence_state: evidenceStateOf(used.state),
    // What the estimate is waiting for, when there is none. Null when priced.
    limitation,
    // The new price, beside the value and never inside it.
    retail_anchor: anchor,
    confidence: {
      identity: idConfidence,
      pricing: { used_market: usedEvidence, retail_anchor: anchor.strength },
    },
  });
  const unpriced = (state, reason, extra = {}, limitation = null) => finish({
    state, low: null, recommended: null, high: null, authority: 'none',
    basis: { kind: BASIS.NONE, listings: 0, sources: 0 }, reason, guard: null, ...extra,
  }, USED_EVIDENCE.NONE, limitation);

  if (sufficiency?.decision !== DECISION.SEARCH_NOW) {
    return unpriced(PRICE_STATE.NEED_MORE_INFORMATION, 'identity_insufficient_for_a_product_price', {}, { code: LIMITATION.IDENTITY, group: null });
  }
  if (searchOutcome !== SEARCH_OUTCOME.COMPLETED || !evidence) {
    return unpriced(PRICE_STATE.NO_PRICE_EVIDENCE, `search_${String(searchOutcome).toLowerCase()}`, {}, { code: LIMITATION.SEARCH, group: null });
  }

  const grade = identity?.condition?.grade ?? null;
  const q = evidence.qualification;
  const sources = q.distinct_sources ?? 0;

  // ── WHAT A MARKET-INFORMED ESTIMATE WOULD NEED, AND WHETHER IT IS HERE ────
  //
  // Decided up front so that every unpriced answer below can say which of the
  // three things is missing: the identity, the shop price, or the measured
  // factor. A product-level identity that the gate let through is HIGH or
  // VERY_HIGH by construction (identityConfidence); the factor is the one
  // input that cannot be earned inside a scan.
  const estimateIdentity = sufficiency.level === IDENTITY_LEVEL.PRODUCT;
  const factorLookup = estimateIdentity
    ? findResaleFactor({ category: identity?.category, object_class: identity?.object_class, condition: grade ?? 'Unknown' }, resaleFactors ?? loadResaleFactors())
    : null;
  const limitation = !estimateIdentity ? { code: LIMITATION.IDENTITY, group: null }
    : (anchor.strength === ANCHOR_STRENGTH.NONE ? { code: LIMITATION.NO_ANCHOR, group: null }
      : (factorLookup?.factor ? null : { code: LIMITATION.NO_FACTOR, group: factorLookup?.group ?? null, status: factorLookup?.status ?? null }));

  // ── A TOKEN WAS MINTED: price from exactly the listings that earned it ────
  const token = q.qualified ? q.token : (q.comparable_qualified ? q.comparable_token : null);
  if (token) {
    const candidate = computeValuationCandidate({
      accepted: rejectOutliers(token.observations).kept,
      condition: grade,
      identityConfidence: identity?.model?.confidence ?? 0,
    });
    const corroboration = corroborateSubject({
      identity: guardIdentity(identity, subject), ocrText: identity?.visible_text ?? null, catalogCandidates: [],
    });
    const guard = applyGuard({
      valuationCandidate: candidate,
      identity: guardIdentity(identity, subject),
      corroboration,
      marketEvidence: q,
    });
    const priced = candidate.status === VALUATION_STATUS.PRICED;
    // A MATERIAL repair moved a displayed number. The guard calls rounding a
    // repair too; a value rounded to the shekel is the value it accepted.
    const before = { low: candidate.low ?? null, mid: candidate.mid ?? null, high: candidate.high ?? null };
    const moved = ['low', 'mid', 'high'].filter((k) => Math.abs((guard.prices[k] ?? 0) - Math.round(before[k] ?? 0)) >= 1);
    const material = guard.action === 'repair' && moved.length > 0;
    const accepted = priced && (guard.action === 'accept' || (guard.action === 'repair' && !material));
    const guardView = {
      action: guard.action, violations: guard.violations, identity_tier: guard.identity_tier ?? null,
      pricing_grade: guard.pricing_grade ?? null, degraded_reason: guard.degraded_reason ?? null,
      // The range the listings gave, the range that is shown, and which edges differ.
      range_before: before, range_after: { ...guard.prices }, material_repair: material, moved,
    };
    const listings = token.observation_count ?? token.observations.length;
    if (accepted) {
      return finish({
        state: q.qualified ? PRICE_STATE.VERIFIED_MARKET_VALUE : PRICE_STATE.COMPARABLE_MARKET_ESTIMATE,
        low: guard.prices.low, recommended: guard.prices.mid, high: guard.prices.high,
        authority: q.qualified ? 'verified_market' : 'verified_comparable',
        basis: { kind: q.qualified ? BASIS.VERIFIED_LISTINGS : BASIS.COMPARABLE_LISTINGS, listings, sources },
        reason: null,
        guard: guardView,
      }, q.qualified ? USED_EVIDENCE.VERIFIED : USED_EVIDENCE.COMPARABLE);
    }
    // THE GUARD ADJUSTED THE RANGE AND REFUSED NOTHING. Three listings that
    // agree within a few percent give a band narrower than the guard allows; it
    // widens the band and says so. Those are its numbers and they are shown
    // under their own state: the evidence is sufficient and exact, the range is
    // the guard's. VERIFIED is kept for a price it accepted untouched, and the
    // reserved calibrated-fallback state is not this — nothing here was
    // estimated from a retail anchor.
    const adjusted = priced && material && guard.violations.length === 0 && guard.prices.mid > 0;
    if (adjusted) {
      return finish({
        state: q.qualified ? PRICE_STATE.USED_EVIDENCE_ESTIMATE : PRICE_STATE.COMPARABLE_MARKET_ESTIMATE,
        low: guard.prices.low, recommended: guard.prices.mid, high: guard.prices.high,
        authority: 'none',
        basis: { kind: q.qualified ? BASIS.GUARD_ADJUSTED : BASIS.COMPARABLE_GUARD_ADJUSTED, listings, sources },
        reason: null,
        guard: guardView,
      }, q.qualified ? USED_EVIDENCE.VERIFIED : USED_EVIDENCE.COMPARABLE);
    }
    // The guard declined a price the evidence supported. Its answer stands: a
    // number it refused is not shown under a weaker label.
    return unpriced(PRICE_STATE.NO_PRICE_EVIDENCE, 'guard_declined_the_market_price', { guard: guardView }, { code: LIMITATION.GUARD, group: null });
  }

  // Every listing here passed the evidence gate for THIS product, under the
  // name read off the item or a name the results corroborated as the same
  // product. One such listing is a real asking price for it.
  const admitted = (evidence.entries ?? []).filter((e) => e.admitted);
  const usedPrices = admitted.map((e) => e.observation.observed_price).filter((p) => Number.isFinite(p) && p > 0);

  // ── THE MARKET-INFORMED ESTIMATE ───────────────────────────────────────────
  //
  // The local shop price for the exact product, scaled by the share of new
  // that second-hand sellers of this KIND of object were MEASURED to ask, in
  // this condition; and, when a listing or two for this product was admitted
  // below the quorum, blended with those. Shown as an estimate, under its own
  // pricing confidence. It must sit below the new price: an estimate that does
  // not is refused rather than shown.
  if (limitation === null) {
    const f = factorLookup.factor;
    const est = { low: Math.round(anchor.low * f.p25), mid: Math.round(anchor.median * f.median), high: Math.round(anchor.high * f.p75) };
    const sorted = [est.mid, ...usedPrices].sort((a, b) => a - b);
    const recommended = Math.round(median(sorted));
    const low = Math.min(est.low, ...usedPrices);
    const high = Math.max(est.high, ...usedPrices);
    if (recommended > 0 && low > 0 && high < anchor.median) {
      return finish({
        state: PRICE_STATE.MARKET_INFORMED_ESTIMATE, low, recommended, high, authority: 'none',
        basis: {
          kind: BASIS.MARKET_INFORMED, listings: admitted.length, sources: evidence.used_admitted?.sources ?? sources,
          anchor_shops: anchor.shops, anchor_median: anchor.median,
          factor: { group: factorLookup.group, condition: factorLookup.condition, median: f.median, p25: f.p25, p75: f.p75, products: factorLookup.products ?? null },
        },
        reason: null, guard: null,
      }, USED_EVIDENCE.MARKET_INFORMED, null);
    }
    return unpriced(PRICE_STATE.NO_PRICE_EVIDENCE, 'estimate_not_below_retail', {}, { code: LIMITATION.NOT_BELOW_RETAIL, group: factorLookup.group });
  }

  // ── ADMITTED, BELOW THE FLOORS ──────────────────────────────────────────
  //
  // One listing for a KIND of object says almost nothing about another object
  // of that kind, so a generic subject needs a small sample.
  const floor = sufficiency.level === IDENTITY_LEVEL.GENERIC ? MIN_GENERIC_LISTINGS : 1;
  if (admitted.length >= floor) {
    const range = rangeOf(usedPrices, grade);
    if (range) {
      return finish({
        state: PRICE_STATE.USED_EVIDENCE_BELOW_QUORUM, ...range, authority: 'none',
        basis: {
          kind: BASIS.ADMITTED_BELOW_QUORUM, listings: admitted.length,
          sources: evidence.used_admitted?.sources ?? sources, set_failures: q.set_failures,
        },
        reason: null, guard: null,
      }, USED_EVIDENCE.BELOW_QUORUM, limitation);
    }
  }

  return unpriced(PRICE_STATE.NO_PRICE_EVIDENCE,
    q.set_failures?.length ? `no_admitted_listings: ${q.set_failures.join(', ')}` : 'no_admitted_listings', {}, limitation);
}
