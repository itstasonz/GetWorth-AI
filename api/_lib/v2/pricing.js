// ══════════════════════════════════════════════════════════════════════════════
// SCAN ENGINE V2 — THE PRICE STATE
//
// ONE state per scan, and the state IS the claim:
//
//   VERIFIED_MARKET_VALUE      the evidence gate minted a VERIFIED_MARKET token
//                              for this product and the guard accepted the
//                              price computed from exactly those listings
//   MARKET_INFORMED_ESTIMATE   real second-hand listings were admitted, and the
//                              set did not reach the quorum or the source floor
//                              — or the item is a kind of object, priced from
//                              its verified comparables
//   ESTIMATED_WORTH            nothing was admitted for this product; the
//                              number rests on weaker context, which is named
//   NEED_MORE_INFORMATION      the identity cannot carry a product price
//   NO_PRICE_EVIDENCE          the item was identified and searched, and
//                              nothing usable came back (or the search failed)
//
// The fifth state exists because the first four have no honest answer for "we
// know what it is and found nothing": calling that an estimate would need a
// number, and calling it a lack of information would blame the identity.
//
// ── AUTHORITY ───────────────────────────────────────────────────────────────
//
// Only the first state is an authoritative valuation, and it is reached only
// through the existing mint and the existing guard. No catalog row takes part
// in V2 at all, so no sibling product can anchor, cap or strengthen anything.
// Every other priced state carries `authority: 'none'` and a `basis` that says
// what it was computed from and from how many listings.
//
// No model produces a number anywhere in V2.
// ══════════════════════════════════════════════════════════════════════════════
import { computeValuationCandidate, conditionMultiplier, VALUATION_STATUS } from '../phaseb/valuation.js';
import { rejectOutliers } from '../phaseb/market-research.js';
import { applyGuard, corroborateSubject } from '../phaseb/validation.js';
import { CONDITION_LADDER, normalizeConditionBasis } from '../valuation-guard.js';
import { DECISION, IDENTITY_LEVEL } from './sufficiency.js';
import { SEARCH_OUTCOME } from './search.js';
import { MIN_CONTEXT_LISTINGS } from './evidence.js';

export const PRICE_STATE = Object.freeze({
  VERIFIED_MARKET_VALUE: 'VERIFIED_MARKET_VALUE',
  MARKET_INFORMED_ESTIMATE: 'MARKET_INFORMED_ESTIMATE',
  ESTIMATED_WORTH: 'ESTIMATED_WORTH',
  NEED_MORE_INFORMATION: 'NEED_MORE_INFORMATION',
  NO_PRICE_EVIDENCE: 'NO_PRICE_EVIDENCE',
});

export const BASIS = Object.freeze({
  VERIFIED_LISTINGS: 'verified_used_listings',
  COMPARABLE_LISTINGS: 'verified_comparable_listings',
  ADMITTED_BELOW_QUORUM: 'admitted_used_listings_below_quorum',
  BRAND_CLASS_LISTINGS: 'used_listings_for_brand_and_kind',
  RETAIL_DEPRECIATED: 'new_retail_price_less_condition_discount',
  NONE: 'none',
});

const median = (sorted) => (sorted.length % 2
  ? sorted[(sorted.length - 1) / 2]
  : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2);

const unpriced = (state, reason, extra = {}) => ({
  state, low: null, recommended: null, high: null, currency: 'ILS',
  authority: 'none', basis: { kind: BASIS.NONE, listings: 0, sources: 0 }, reason, guard: null, ...extra,
});

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

/**
 * Resolve the scan's price state.
 *
 * `evidence` is assessV2Evidence's report, or null when no search ran.
 */
export function resolveV2Price({
  identity, subject, sufficiency, evidence = null, searchOutcome = SEARCH_OUTCOME.NOT_ATTEMPTED,
} = {}) {
  if (sufficiency?.decision !== DECISION.SEARCH_NOW) {
    return unpriced(PRICE_STATE.NEED_MORE_INFORMATION, 'identity_insufficient_for_a_product_price');
  }
  if (searchOutcome !== SEARCH_OUTCOME.COMPLETED || !evidence) {
    return unpriced(PRICE_STATE.NO_PRICE_EVIDENCE, `search_${String(searchOutcome).toLowerCase()}`);
  }

  const grade = identity?.condition?.grade ?? null;
  const q = evidence.qualification;
  const sources = q.distinct_sources ?? 0;

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
    const accepted = candidate.status === VALUATION_STATUS.PRICED && guard.action === 'accept';
    const guardView = {
      action: guard.action, violations: guard.violations, identity_tier: guard.identity_tier ?? null,
      pricing_grade: guard.pricing_grade ?? null, degraded_reason: guard.degraded_reason ?? null,
    };
    if (accepted) {
      return {
        state: q.qualified ? PRICE_STATE.VERIFIED_MARKET_VALUE : PRICE_STATE.MARKET_INFORMED_ESTIMATE,
        low: guard.prices.low, recommended: guard.prices.mid, high: guard.prices.high, currency: 'ILS',
        authority: q.qualified ? 'verified_market' : 'verified_comparable',
        basis: {
          kind: q.qualified ? BASIS.VERIFIED_LISTINGS : BASIS.COMPARABLE_LISTINGS,
          listings: token.observation_count ?? token.observations.length, sources,
        },
        reason: null,
        guard: guardView,
      };
    }
    // The guard declined a price the evidence supported. Its answer stands: a
    // number it refused is not shown under a weaker label.
    return unpriced(PRICE_STATE.NO_PRICE_EVIDENCE, 'guard_declined_the_market_price', { guard: guardView });
  }

  // ── ADMITTED, BELOW THE FLOORS ──────────────────────────────────────────
  //
  // One listing for THIS PRODUCT is a real asking price for it. One listing for
  // a KIND of object says almost nothing about another object of that kind, so
  // a generic subject needs the same small sample a context tier does.
  const floor = sufficiency.level === IDENTITY_LEVEL.GENERIC ? MIN_CONTEXT_LISTINGS : 1;
  if (q.admitted.length >= floor) {
    const range = rangeOf(q.admitted.map((a) => a.normalized_ils_price), grade);
    if (range) {
      return {
        state: PRICE_STATE.MARKET_INFORMED_ESTIMATE, ...range, currency: 'ILS', authority: 'none',
        basis: { kind: BASIS.ADMITTED_BELOW_QUORUM, listings: q.admitted.length, sources, set_failures: q.set_failures },
        reason: null, guard: null,
      };
    }
  }

  // ── NOTHING ADMITTED: WEAKER CONTEXT, NAMED ─────────────────────────────
  const context = evidence.brand_class_context ?? [];
  if (context.length >= MIN_CONTEXT_LISTINGS
      && (sufficiency.level === IDENTITY_LEVEL.BRAND_CLASS || sufficiency.level === IDENTITY_LEVEL.CANDIDATES)) {
    const range = rangeOf(context.map((e) => e.observation.observed_price), grade);
    if (range) {
      return {
        state: PRICE_STATE.ESTIMATED_WORTH, ...range, currency: 'ILS', authority: 'none',
        basis: { kind: BASIS.BRAND_CLASS_LISTINGS, listings: context.length, sources: evidence.context_sites.brand_class.length },
        reason: null, guard: null,
      };
    }
  }
  const retail = evidence.retail_context ?? [];
  if (retail.length > 0) {
    const newPrice = median(retail.map((e) => e.observation.observed_price).sort((a, b) => a - b));
    // GetWorth's own ladder: the discount from new for each condition. The
    // grade's rung gives the recommendation; the rungs beside it give the span.
    const rung = normalizeConditionBasis(grade) ?? 'used';
    const order = ['newSealed', 'likeNew', 'used', 'poor'];
    const i = order.indexOf(rung);
    const at = (k) => 1 - CONDITION_LADDER[order[Math.min(order.length - 1, Math.max(0, k))]];
    return {
      state: PRICE_STATE.ESTIMATED_WORTH,
      low: Math.round(newPrice * (at(i) + at(i + 1)) / 2),
      recommended: Math.round(newPrice * at(i)),
      high: Math.round(newPrice * at(i - 1)),
      currency: 'ILS', authority: 'none',
      basis: {
        kind: BASIS.RETAIL_DEPRECIATED, listings: retail.length, sources: evidence.context_sites.retail.length,
        new_retail_price: Math.round(newPrice), condition_rung: rung,
      },
      reason: null, guard: null,
    };
  }

  return unpriced(PRICE_STATE.NO_PRICE_EVIDENCE,
    q.set_failures?.length ? `no_admitted_listings: ${q.set_failures.join(', ')}` : 'no_admitted_listings');
}
