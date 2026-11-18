// ══════════════════════════════════════════════════════════════════════════════
// A CALCULATED RESALE ESTIMATE FROM THE NEW PRICE (founder decision, 2026-11-18) — "Method C".
//
// When there is no Israeli second-hand valuation (State A) and no observed Israeli ads to show (State B), but the search
// found a verified Israeli NEW price for this exact product, the screen may show a number CALCULATED from it: the new price
// less a stated deduction for a used unit in good or like-new working condition. It is an ASSUMPTION, not a measurement
// of the market, and it is labelled so everywhere it appears ("אומדן מחושב לפי מחיר מוצר חדש — לא הערכת שוק מאומתת"),
// beside the shop it rests on and the deduction applied.
//
// Never for: a thing sold by description, a family or an open variant (the new price may be another model's), a market
// where condition and rarity dominate (collectibles, vintage and handmade, watches and jewellery, vehicles, fragrance,
// furniture, fashion), a unit that looks faulty or broken, a new price that is not this exact model's, not tied to it
// by the shop's own text, or only seen out of stock. The deduction is configurable (CORE_SCAN_RETAIL_DEDUCTION, 0.10–0.20)
// and is not a measured depreciation rate.
// ══════════════════════════════════════════════════════════════════════════════
import { isBound } from './binding.js';
import { roundNice } from './aggregate.js';

export const RETAIL_ESTIMATE_ENV = 'CORE_SCAN_RETAIL_DEDUCTION';
export const DEDUCTION_DEFAULT = 0.15;
export const DEDUCTION_MIN = 0.10;
export const DEDUCTION_MAX = 0.20;
/** Markets where a used unit's price follows its new price closely enough for a stated deduction to be a fair first guess. */
export const ELIGIBLE_MARKETS = Object.freeze(new Set(['consumer_electronics', 'household', 'tools']));
/**
 * The conditions an estimate is made for; a like-new unit takes the smallest deduction of the range. A FAIR unit (visible
 * wear, a weak battery, a missing part: questionnaire.js) takes a larger, per-market deduction (2026-11-18). These are
 * ASSUMPTIONS, configurable, and shown as such; a FAULTY unit is never priced from a new price.
 */
export const ESTIMATE_CONDITIONS = Object.freeze(['new_sealed', 'like_new', 'good', 'fair']);
export const FAIR_DEDUCTION_ENV = 'CORE_SCAN_RETAIL_FAIR_DEDUCTION';
export const FAIR_DEDUCTION_DEFAULT = Object.freeze({ consumer_electronics: 0.35, household: 0.30, tools: 0.30 });
export const FAIR_DEDUCTION_MIN = 0.25;
export const FAIR_DEDUCTION_MAX = 0.50;
export const METHOD = 'retail_anchored';

/** The fair-condition deduction for a market: the configured one within 25–50%, else the market's default. */
export function resolveFairDeduction(marketClass, env = process.env) {
  const v = Number(String(env?.[FAIR_DEDUCTION_ENV] ?? '').trim());
  if (Number.isFinite(v) && v >= FAIR_DEDUCTION_MIN && v <= FAIR_DEDUCTION_MAX) return v;
  return FAIR_DEDUCTION_DEFAULT[marketClass] ?? FAIR_DEDUCTION_MAX;
}

/** The good-condition deduction in force: the configured one within 10–20%, else 15%. */
export function resolveDeduction(env = process.env) {
  const v = Number(String(env?.[RETAIL_ESTIMATE_ENV] ?? '').trim());
  return Number.isFinite(v) && v >= DEDUCTION_MIN && v <= DEDUCTION_MAX ? v : DEDUCTION_DEFAULT;
}

/** Why an item may not get an estimate, or null when it may. Read from the identity alone, never from prices. */
export function ineligibility(identity, valuation) {
  const i = identity ?? {};
  if (!valuation || valuation.status === 'priced') return 'valued';
  if (valuation.comparative) return 'observed_ads_shown';
  if (valuation.strategy && valuation.strategy !== 'exact_model') return 'not_an_exact_product_strategy';
  if (valuation.basis && valuation.basis !== 'this_item') return 'not_this_item';
  if (valuation.approximate || valuation.family_level) return 'variant_open';
  if (i.incomplete || i.exact_model_established !== true || (i.identity_precision && i.identity_precision !== 'exact_model')) return 'exact_model_unknown';
  if (!ELIGIBLE_MARKETS.has(i.market_class)) return 'category_excluded';
  if (i.visible_condition === 'poor') return 'condition_excluded';
  if (i.configuration && !['complete_item', 'base_only'].includes(i.configuration)) return 'configuration_excluded';
  return null;
}

/** The exact-model Israeli shop prices behind the new price: bound to the product by the shop's own text. */
function exactRetail(valuation) {
  return (valuation?.evidence ?? []).filter((e) => e.kind === 'new_retail' && e.market === 'IL' && e.match === 'exact' && (isBound(e) || e.title_bound === true) && Number(e.price_ils) > 0);
}

/**
 * The estimate, or null. `estimates` holds the calculated figure for each eligible condition so the screen follows the
 * condition the owner picks; `condition` is the one assessed from the photograph ('unknown' when it could not be).
 */
export function retailEstimate(valuation, identity, { deduction = resolveDeduction(), fairDeduction = resolveFairDeduction(identity?.market_class) } = {}) {
  if (ineligibility(identity, valuation)) return null;
  const retail = Number(valuation.retail_new_ils);
  if (!(retail > 0) || valuation.retail_new_in_stock === false) return null;
  const shops = exactRetail(valuation);
  // The new price on the screen must be THIS model's: it lies within the exact shops' own prices.
  if (!shops.length) return null;
  const low = Math.min(...shops.map((e) => e.price_ils));
  const high = Math.max(...shops.map((e) => e.price_ils));
  if (retail < low * 0.95 || retail > high * 1.05) return null;
  const d = Math.min(DEDUCTION_MAX, Math.max(DEDUCTION_MIN, deduction));
  const fair = Math.min(FAIR_DEDUCTION_MAX, Math.max(FAIR_DEDUCTION_MIN, fairDeduction));
  const deductions = { new_sealed: DEDUCTION_MIN, like_new: DEDUCTION_MIN, good: d, fair };
  const estimates = Object.fromEntries(ESTIMATE_CONDITIONS.map((c) => [c, roundNice(retail * (1 - deductions[c]))]));
  const nearest = [...shops].sort((a, b) => Math.abs(a.price_ils - retail) - Math.abs(b.price_ils - retail));
  return {
    method: METHOD,
    retail_ils: retail,
    deductions,
    estimates,
    condition: ESTIMATE_CONDITIONS.includes(identity.visible_condition) ? identity.visible_condition : 'unknown',
    sources: nearest.slice(0, 3).map((e) => ({ url: e.url, domain: e.domain ?? null, title: e.title ?? null, price_ils: Math.round(e.price_ils), seen: e.seen ?? null })),
    validated: false,
  };
}
