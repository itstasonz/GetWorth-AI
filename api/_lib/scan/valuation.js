// ══════════════════════════════════════════════════════════════════════════════
// CORE SCAN — THE SERVER PRICES. THE MODEL DOES NOT.
//
// The question is what an item sells for SECOND-HAND IN ISRAEL. So Israeli
// second-hand evidence leads, and everything else is weighed by how much it
// says about that:
//
//   BOUND       before anything is weighed: a price takes part only when the
//               page's own text ties it to the product it is claimed for
//               (binding.js). A price that is merely on a page that also names
//               the product is counted as found, shown as unused, and moves
//               nothing — second-hand reference or new-price anchor alike.
//   WEIGH       each second-hand reference counts by FIVE things at once:
//                 where      Israel, or abroad (and abroad counts for less
//                            still when it could not be brought to Israeli
//                            price level)
//                 match      this item, a close comparable, a family member
//                 freshness  the LISTING's age: current, recent, unknown,
//                            older, archived
//                 kind       a completed sale, an asking price, refurbished
//                 page       one seller's listing, or a price read off a list
//               Two cheap listings abroad do not outvote one good Israeli
//               listing because 2 > 1; an old archived Israeli ad does not
//               outvote current evidence because it is Israeli.
//   LOCAL       when the Israeli evidence is good enough on its own (two or
//   DRIVES      three listings that stand, not old ones), the price is worked
//               out from Israel ALONE. Prices abroad are then context: shown,
//               not used. Abroad joins the arithmetic only when Israel is thin.
//   NORMALIZE   every reference is brought to shekels, Israeli price level
//               and a selling price. Its condition is NOT converted by a
//               ladder: a used unit's ad counts at its own price, whatever used
//               condition it states, and an ad for a sealed new unit or one in
//               poor condition is not the used market and is set aside
//               (2026-11-12: the ladder made a ₪1,050 "fair" iPhone worth more
//               than a ₪1,100 "like new" one).
//   AGGREGATE   outliers go where that is defensible; the centre is the
//               weighted median; the range is where the weight of the evidence
//               actually lies, so evidence that disagrees gives a wide range.
//   CONFIDENCE  is earned by local weight and agreement, and lost to dispersion.
//
// THE SAME EVIDENCE ALWAYS PRODUCES THE SAME VALUATION, in any order. There is
// no model and no randomness here.
//
// Every number below is a stated assumption, not a discovered fact. They are
// few, conservative and in one place so they can be read and argued with.
// ══════════════════════════════════════════════════════════════════════════════

import { CONDITIONS } from './config.js';
import { freshnessOf } from './evidence.js';
import { isBound, BIND_REASON } from './binding.js';
import { STRATEGY } from './strategy.js';
import { MAD_THRESHOLD, MAD_MIN_SAMPLE, median, clamp, round2, roundNice, weightedQuantile, dispersionOf, aggregate } from './aggregate.js';

// The arithmetic of a price — the weighted median, where the weight lies, how far apart it is — is aggregate.js.
export { roundNice, weightedQuantile, dispersionOf, aggregate } from './aggregate.js';

export { pageKey, verifyEvidence, mergeEvidence, requalify } from './evidence.js';

export const WITHDRAWN = Object.freeze({
  NO_SEARCH: 'no_search_recorded',
  /** The identity names a brand or a house, not one product: no search was made for it (identify.js identityGap). */
  IDENTITY_INCOMPLETE: 'identity_incomplete',
  NO_RESALE_EVIDENCE: 'no_verified_second_hand_reference',
  /** References were found, none of them an Israeli second-hand listing that is current and for a used unit. */
  NO_LOCAL_EVIDENCE: 'no_verified_israeli_second_hand_reference',
  /** This KIND of item (a car, a luxury watch, a collectible) is valued by methods this engine has no calibration for: no number. */
  NO_CALIBRATED_METHOD: 'no_calibrated_valuation_method_for_this_market',
  /** A range from SIMILAR items needs at least COMPARABLE_MIN Israeli comparables that stand: one similar thing's price is one seller's opinion of another thing. */
  TOO_FEW_COMPARABLES: 'too_few_comparable_items',
  /** The similar items that stand disagree too widely for a range to describe a market: shown, not priced from. */
  COMPARABLES_DISAGREE: 'comparable_items_disagree',
  /**
   * Exactly two references, further apart than DISPERSION.dispersed (Production E2E 2026-11-13: a Canon 5D Mark III priced
   * ₪42,500 from a ₪46,970 ad beside a ₪2,000 one): nothing says which is the market, so no number is made.
   */
  REFERENCES_DISAGREE: 'references_disagree',
});
/** What the valuation rests on: this item; the models it may be, when only its family is established; or similar items, for a thing identified by description. */
export const BASIS = Object.freeze({ ITEM: 'this_item', FAMILY: 'product_family', SIMILAR_ITEMS: 'similar_items' });
// How a kind of item is valued, and what makes two scans "the same thing": strategy.js, re-exported for the callers that read them here.
export { STRATEGY, strategyFor, marketKey } from './strategy.js';

// ── THE STATED ASSUMPTIONS ──────────────────────────────────────────────────
// There is NO condition ladder here (2026-11-12): a condition's price comes from ads for units in that condition, or the
// screen says it has none (conditionPrices). The legacy listing flow's ladder (valuation-guard.js CONDITION_LADDER) serves
// only the retired /api/analyze results and is not read by the core scan.
/**
 * An asking price is not a selling price. Listings are asking prices, and this
 * is the allowance for the usual negotiation: a conservative round figure, not
 * a measured one. A completed sale is taken as it is.
 */
export const NEGOTIATION = 0.9;
/** How much a second-hand reference counts: the product of one factor from each group. */
export const WEIGHT = Object.freeze({
  where: Object.freeze({ IL: 1, INTL_scaled: 0.4, INTL: 0.25 }),
  match: Object.freeze({ exact: 1, close_comparable: 0.6, sibling_model: 0.4 }),
  freshness: Object.freeze({ current: 1, recent: 0.85, unknown: 0.6, older: 0.4, archived: 0.15 }),
  kind: Object.freeze({ sold: 1.2, price_guide: 1, used_listing: 1, refurbished: 0.8 }),
  page: Object.freeze({ listing: 1, price_guide: 1, shop_product: 0.9, search_or_category: 0.7, other: 0.6 }),
  /** A shop's refurbished offer that the shop no longer has is a past offer: it counts for less. Private listings carry no stock. */
  stock: Object.freeze({ out_of_stock: 0.5 }),
});
/** A used unit asking more than the shop's price for a new one is not a second-hand reference. */
const ABOVE_NEW = 1.05;
/**
 * A SEALED unit offered privately for less than half of the shop's price for a new one is not taken at its word: a
 * genuine new unit does not change hands at half price, and on Israeli boards such an ad is a replica, a scam or a
 * mislabelled unit ("AirPods Pro 2, new in the box, never opened — ₪300" beside a ₪1,100 new price, Homeless,
 * 2026-11-12). A stated assumption like ABOVE_NEW; it applies only to asking prices that say "sealed", only in Israel,
 * and only where the new price is known.
 */
const SEALED_FLOOR = 0.5;
/** Israeli price level relative to abroad, when the same item's new price is known in both: kept within sane bounds. */
const SCALE_BOUNDS = [0.8, 2];
/** Where the weight of the evidence spans more than this (P90 / P10), the evidence disagrees. */
export const DISPERSION = Object.freeze({ agrees: 1.6, dispersed: 2.2 });
/** One Israeli ad this many times away from each of two others is an error, a joke or another product, not a market (a stated heuristic, 2026-11-13). */
export const ISOLATED_RATIO = 5;
/**
 * Local weight, in the units of WEIGHT: a current exact Israeli listing weighs 1.
 *   drives  from here the Israeli evidence prices the item alone (and the search does not go abroad)
 *   high    what a confident price needs: about three good current Israeli listings
 *   medium  one good current listing's worth, among at least two references
 */
export const LOCAL_STRENGTH = Object.freeze({ drives: 1.5, high: 2.5, medium: 1 });
/** Why a reference that qualifies took no part in the price. */
export const SET_ASIDE = Object.freeze({
  ABOVE_NEW: 'above_new_price', SEALED_FAR_BELOW_NEW: 'sealed_far_below_new_price', OUTLIER: 'outlier',
  /** One of exactly two references that disagree beyond DISPERSION.dispersed (WITHDRAWN.REFERENCES_DISAGREE). */
  DISAGREE: 'references_disagree',
  /** Another size or capacity than the item's (binding.js OTHER_SIZE): another variant, shown, never priced from. */
  OTHER_SIZE: 'different_size_or_capacity',
  /** Priced above an Israeli private ad for a LARGER capacity of the same model: not credible for this one. */
  ABOVE_LARGER_SIZE: 'above_larger_capacity_price',
  /** An ad for a sealed new unit, or one in poor condition / for parts: not what a normal used unit sells for. */
  NOT_USED_CONDITION: 'sealed_or_poor_condition', LOCAL_SUFFICIENT: 'local_evidence_sufficient', UNBOUND: 'price_not_tied_to_product',
  REFURBISHED_ALONE: 'retail_refurbished_without_private_resale',
  /** Context when the gate is closed: a listing abroad with no Israeli listing to compare it with; an Israeli listing that is old or for a sealed unit. */
  ABROAD_ONLY: 'abroad_without_israeli_reference', NOT_CURRENT: 'israeli_listing_old_or_sealed',
  /** Another model of the same brand or family: a different product, shown so, never priced from. */
  DIFFERENT_MODEL: 'different_model',
  /** Verified, shown, and not priced from: this kind of item is valued by methods this engine does not have. */
  SPECIALISED_CONTEXT: 'specialised_market_context',
  /** A shop's price for a SIMILAR item is not this item's new price: context, never a ceiling and never a level. */
  SIMILAR_RETAIL: 'retail_price_of_similar_item',
  /** A similar item abroad says nothing about what a similar item sells for in Israel. */
  SIMILAR_ABROAD: 'similar_item_abroad',
  /** A similar item that stood, when too few stood or they disagreed: shown as context, no number from it. */
  SIMILAR_CONTEXT: 'similar_item_context',
  /**
   * A SITE'S PUBLISHED ESTIMATE IS NOT A LISTING OR A SALE (2026-11-08 controlled test: fliptip.ai, aionrulez.net,
   * flippedradar.com, cameraworth.com reported as "price guides"). Its method cannot be checked and several are generated
   * by a model: shown as context, never priced from.
   */
  PRICE_GUIDE_CONTEXT: 'price_guide_context',
  /** A reference whose address is a site's front page names no listing and no sale: its provenance cannot be audited. */
  NOT_SPECIFIC: 'not_a_specific_listing',
});
/** Is this address only a site's front page (no path), so no one listing or sale can be pointed at? */
export const isFrontPage = (url) => /^https?:\/\/[^/?#]+\/?([?#].*)?$/i.test(String(url ?? '').trim());
/** How many Israeli comparables, current and for a used unit, a range from similar items needs. */
export const COMPARABLE_MIN = 2;
/**
 * ISRAEL FIRST (founder decision 2026-11-08). GetWorth values what an item sells for second-hand IN ISRAEL. Listings
 * abroad never stand in for that: with no Israeli second-hand reference standing they are context, and nothing is priced
 * from them (THE GATE in buildValuation). Once Israeli evidence opens the gate they may join it, brought to Israeli price
 * level only where that level is measured from the same item's new price in both markets. (01a9fc1 briefly priced from
 * listings abroad alone; that was withdrawn the same day.) `estimate_basis` names where a price comes from, for the
 * screen and the record; today it is always Israeli listings.
 */
export const ESTIMATE_BASIS = Object.freeze({ ISRAEL: 'israeli_listings' });

const RESALE_KINDS = new Set(['used_listing', 'sold', 'refurbished', 'price_guide']);
/**
 * THE SECOND-HAND MARKET IS PRIVATE RESALE: what people ask and get for their
 * own units, sealed ones included. A shop's refurbished offer is a different
 * market — a warranty, a return policy, a margin — so it may SUPPORT a price
 * that private listings already give, and never stand in for one: with no
 * private reference standing, a refurbished offer is set aside, shown, and
 * prices nothing. No percentage turns one market into the other.
 */
const PRIVATE_RESALE = new Set(['used_listing', 'sold', 'price_guide']);
const SOLD_KINDS = new Set(['sold', 'price_guide']);
/**
 * ANOTHER MODEL IS ANOTHER PRODUCT. A listing the model called sibling_model
 * never prices this item, at item level or at family level: the second real
 * scan (2026-10-11) brought other Ninja machines for a Ninja blender, and
 * their prices say nothing about this one. When only the family is
 * established, the models the photograph may show (could_also_be, reported as
 * close_comparable) are its comparables; any other model of the family is not.
 */
const MATCHES = Object.freeze({
  [BASIS.ITEM]: new Set(['exact', 'close_comparable']),
  [BASIS.FAMILY]: new Set(['exact', 'close_comparable']),
  // A thing identified by description has no "exact": a similar item of the same kind, size and material is its comparable.
  [BASIS.SIMILAR_ITEMS]: new Set(['exact', 'close_comparable']),
});
const ANCHOR_MATCHES = MATCHES[BASIS.ITEM];

/** Israeli PRIVATE evidence that can lead: a listing known to be old is Israeli, and still says little about today; a shop's refurbished offer supports, never leads. */
const leads = (p) => p.evidence.market === 'IL' && PRIVATE_RESALE.has(p.evidence.kind) && p.freshness !== 'older' && p.freshness !== 'archived';
const localWeight = (points) => points.filter(leads).reduce((sum, p) => sum + p.weight, 0);
// What a price WOULD be, were it tied to its product — and what it IS, when it is.
const resaleLike = (e, basis) => RESALE_KINDS.has(e.kind) && MATCHES[basis].has(e.match);
const anchorLike = (e, market) => e.kind === 'new_retail' && ANCHOR_MATCHES.has(e.match) && e.market === market && !!e.price_ils;
const isResale = (e, basis) => resaleLike(e, basis) && isBound(e);
const isNewPrice = (e, market) => anchorLike(e, market) && isBound(e);
/**
 * The new price in a market: the exact item's when the search found one, else
 * the close comparable's. A shop that has it today says more about today's new
 * price than a page for a unit that is out of stock, so offers not known to be
 * out of stock are used when there are any, and the answer says which it was.
 *
 * Shops that agree give their median. Shops that DISAGREE (the live search of
 * 2026-10-11 found the same mouse at ₪399 and ₪659) give the LOWEST offer: a
 * buyer pays the cheapest shop that has it, and one expensive shop must not
 * lift the line a used price is measured against. The range is returned so
 * the answer can say the shops disagreed. Retail is context, not used value.
 */
/**
 * A NEW PRICE CANNOT BE HALF OF WHAT USED UNITS FETCH (2026-11-13: a DualSense's "new price in Israel" showed ₪30 — the shop
 * page sells it for ₪275; the ₪29 was another number on the page). A new price below half of the median used, sold or
 * price-guide reference for the same product, or below half of the median of the other shops' new prices, is not this
 * product's new price. A stated sanity bound, not a market measurement.
 */
const NEW_BELOW_USED = 0.5;
function plausibleNew(candidates, evidence) {
  // Only references of THIS product: a comparable (another edition, another capacity) says nothing about its new price.
  const used = evidence.filter((e) => ['used_listing', 'sold', 'price_guide'].includes(e.kind) && e.match === 'exact' && e.price_ils > 0).map((e) => e.price_ils);
  const usedFloor = used.length ? median(used) * NEW_BELOW_USED : 0;
  return candidates.filter((e) => {
    if (e.price_ils < usedFloor) return false;
    const others = candidates.filter((o) => o !== e).map((o) => o.price_ils);
    return !(others.length && e.price_ils < median(others) * NEW_BELOW_USED);
  });
}
function newPrice(evidence, market) {
  const candidates = evidence.filter((e) => isNewPrice(e, market));
  // The Israeli new price is what the screen shows and what bounds used asks: it must be plausible. Abroad is context.
  const all = market === 'IL' ? plausibleNew(candidates, evidence) : candidates;
  const exact = all.filter((e) => e.match === 'exact');
  const use = exact.length ? exact : all;
  if (!use.length) return null;
  const prices = use.map((e) => e.price_ils);
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  // Disagreement is measured across EVERY shop, stocked or not. The first real scan (2026-10-11) had the mouse at
  // ₪399 in a shop that was temporarily out of it and ₪659 in the one shop that had it; reading only the stocked
  // shop made ₪659 "the new price", and a ₪430 sealed ad then passed as below new. The cheapest shop sets the
  // line, and the answer says whether that shop had it.
  if (high / low > DISPERSION.agrees) {
    const cheapest = use.reduce((a, b) => (b.price_ils < a.price_ils ? b : a));
    return { price: cheapest.price_ils, inStock: cheapest.stock !== 'out_of_stock', low, high, dispersed: true };
  }
  const stocked = use.filter((e) => e.stock !== 'out_of_stock');
  const from = stocked.length ? stocked : use;
  return { price: median(from.map((e) => e.price_ils)), inStock: stocked.length > 0, low, high, dispersed: false };
}

// ── WEIGH AND NORMALIZE ─────────────────────────────────────────────────────
/**
 * Each second-hand reference as a selling price in shekels, at Israeli price
 * level, at the price its own ad asked (no condition ladder) — with its weight,
 * the reasons for that weight, and why it was set aside when it was.
 */
export function normalizeReferences(evidence, { basis = BASIS.ITEM, today = null } = {}) {
  // SIMILAR ITEMS HAVE NO NEW PRICE. A shop's price for a similar sofa is not this sofa's new price: it is neither a
  // ceiling that sets a used price aside nor a level that brings a foreign price to Israel. For a thing valued from
  // similar items there is no anchor, and a similar item abroad is never a reference: it says nothing about Israel.
  const similar = basis === BASIS.SIMILAR_ITEMS;
  const il = similar ? null : newPrice(evidence, 'IL');
  const anchorIl = il?.price ?? null;
  const anchorIntl = similar ? null : (newPrice(evidence, 'INTL')?.price ?? null);
  // Abroad is not Israel. Converting the currency does not convert the market.
  // The level is taken from the same item's NEW price in both markets when both
  // are known; otherwise foreign prices stay as converted and count for less.
  const scale = anchorIl && anchorIntl ? clamp(anchorIl / anchorIntl, ...SCALE_BOUNDS) : null;

  const points = [];
  for (const e of evidence) {
    if (!isResale(e, basis) || !e.price_ils) continue;
    // A listing that does not state its condition is taken as a normal used one; a refurbished unit as like new.
    const stated = CONDITIONS.includes(e.condition);
    const condition = stated ? e.condition : (e.kind === 'refurbished' ? 'like_new' : 'good');
    const asking = !SOLD_KINDS.has(e.kind);
    const selling = asking ? e.price_ils * NEGOTIATION : e.price_ils;
    const abroad = e.market !== 'IL';
    const local = abroad ? selling * (scale ?? 1) : selling;
    const freshness = freshnessOf(e.listed, today, e.archived);
    const factors = {
      where: WEIGHT.where[abroad ? (scale ? 'INTL_scaled' : 'INTL') : 'IL'],
      match: WEIGHT.match[e.match] ?? WEIGHT.match.sibling_model,
      freshness: WEIGHT.freshness[freshness],
      // A sale only the buyer confirmed (a GetWorth sale: marketplace.js) is not a verified sale: it weighs as a listing does.
      kind: e.kind === 'sold' && e.verification === 'buyer_confirmed' ? WEIGHT.kind.used_listing : (WEIGHT.kind[e.kind] ?? 1),
      page: WEIGHT.page[e.page] ?? WEIGHT.page.other,
      stock: e.kind === 'refurbished' ? (WEIGHT.stock[e.stock] ?? 1) : 1,
    };
    // A used unit priced above a new one is a different thing: a bundle, a mislabelled new unit, a mistake.
    // A sealed unit a private seller asks more for than the shop does is not a second-hand price either.
    const aboveNew = anchorIl && (abroad ? e.price_ils * (scale ?? 1) : e.price_ils) > anchorIl * ABOVE_NEW;
    const sealedFarBelow = !!anchorIl && !abroad && asking && e.condition === 'new_sealed' && e.price_ils < anchorIl * SEALED_FLOOR;
    // The used market is a used unit in a usable state. A sealed new unit and a broken one are other markets: no
    // invented ladder turns either into a used price (they are shown, and the condition picker on the screen says when
    // it adjusts).
    const notUsed = e.condition === 'new_sealed' || e.condition === 'poor';
    const dropped = isFrontPage(e.url) ? SET_ASIDE.NOT_SPECIFIC
      : e.kind === 'price_guide' ? SET_ASIDE.PRICE_GUIDE_CONTEXT
        : e.binding_reason === BIND_REASON.OTHER_SIZE ? SET_ASIDE.OTHER_SIZE
          : aboveNew ? SET_ASIDE.ABOVE_NEW
            : sealedFarBelow ? SET_ASIDE.SEALED_FAR_BELOW_NEW
              : notUsed ? SET_ASIDE.NOT_USED_CONDITION
                : (similar && abroad ? SET_ASIDE.SIMILAR_ABROAD : null);
    points.push({
      evidence: e, value: local, condition, stated, freshness, asking,
      weight: factors.where * factors.match * factors.freshness * factors.kind * factors.page * factors.stock, factors, dropped,
    });
  }

  // A LARGER VERSION BOUNDS A SMALLER ONE. An Israeli private ad for this model with MORE capacity is not this item's
  // price, but the item does not sell for more than it: a 128 GB Galaxy S23 is not worth ₪1,800 when 256 GB ones ask ₪870
  // and ₪1,200 (Homeless 2026-11-12). The cheapest such ad is the ceiling; a reference above it is set aside.
  const larger = points.filter((p) => p.dropped === SET_ASIDE.OTHER_SIZE && p.evidence.size_relation === 'larger' && p.evidence.market === 'IL' && PRIVATE_RESALE.has(p.evidence.kind));
  if (larger.length) {
    const ceiling = Math.min(...larger.map((p) => p.value));
    for (const p of points) if (!p.dropped && p.value > ceiling) p.dropped = SET_ASIDE.ABOVE_LARGER_SIZE;
  }

  // A SHOP'S REFURBISHED OFFER SUPPORTS PRIVATE RESALE AND NEVER REPLACES IT: with no ISRAELI private reference
  // standing it is set aside. One private listing abroad does not make an Israeli shop's offer the Israeli used market.
  if (!points.some((p) => !p.dropped && PRIVATE_RESALE.has(p.evidence.kind) && p.evidence.market === 'IL')) {
    for (const p of points) if (!p.dropped && p.evidence.kind === 'refurbished') p.dropped = SET_ASIDE.REFURBISHED_ALONE;
  }

  // LOCAL DRIVES. Good Israeli evidence prices an Israeli item by itself; what was found abroad is then context.
  const local = localWeight(points.filter((p) => !p.dropped));
  const localDrives = local >= LOCAL_STRENGTH.drives;
  if (localDrives) for (const p of points) if (!p.dropped && p.evidence.market !== 'IL') p.dropped = SET_ASIDE.LOCAL_SUFFICIENT;

  const kept = points.filter((p) => !p.dropped);
  if (kept.length >= MAD_MIN_SAMPLE) {
    const med = median(kept.map((p) => p.value));
    const mad = median(kept.map((p) => Math.abs(p.value - med)));
    if (mad > 0) for (const p of kept) if ((0.6745 * Math.abs(p.value - med)) / mad > MAD_THRESHOLD) p.dropped = SET_ASIDE.OUTLIER;
  }
  // AN ISOLATED ISRAELI AD AMONG THREE (2026-11-13). Too few for the MAD rule, and the weighted median follows the heaviest:
  // a "Canon 5D Mark III" ad at ₪46,970 beside ₪3,000 and ₪2,000 ones priced the camera ≈₪42,500. An Israeli reference
  // more than ISOLATED_RATIO times away from EVERY other Israeli reference is set aside. Israeli against Israeli only: an
  // Israeli listing above cheaper ones abroad is a price level, not an outlier. A stated heuristic, like the MAD rule.
  const ilKept = points.filter((p) => !p.dropped && p.evidence.market === 'IL');
  if (ilKept.length === 3) {
    const apart = (a, b) => Math.max(a.value, b.value) / Math.min(a.value, b.value) > ISOLATED_RATIO;
    const isolated = ilKept.filter((p) => ilKept.every((q) => q === p || apart(p, q)));
    if (isolated.length === 1) isolated[0].dropped = SET_ASIDE.OUTLIER;
  }
  return { points, anchorIl, anchorInStock: il ? il.inStock : null, anchorRange: il ? { low: il.low, high: il.high, dispersed: il.dispersed } : null, scale, local, localDrives };
}

// ── CONFIDENCE ──────────────────────────────────────────────────────────────
/**
 * How well the price is evidenced. Decided by the evidence alone:
 *
 *   high    strong local weight (about three good current Israeli listings for
 *           this exact item) from at least three references that agree
 *   medium  at least two references, with one good local reference's worth of
 *           weight among them, or several exact sales abroad brought to Israeli
 *           price level, without real disagreement
 *   low     everything else: one reference (one seller's opinion, wherever it
 *           is), foreign and unscaled, old, read off list pages, a family
 *           rather than a model, or evidence that disagrees
 */
export function priceConfidence({ kept, scale, approximate = false, basis = BASIS.ITEM }) {
  // Confidence is earned by PRIVATE references: a shop's refurbished offers support a price and vouch for none.
  const privately = kept.filter((p) => PRIVATE_RESALE.has(p.evidence.kind)).length;
  // A price for a FAMILY, or from SIMILAR items, rests on things that are not this item: never more than low.
  if (approximate || basis !== BASIS.ITEM || privately < 2) return 'low';
  const dispersion = dispersionOf(kept);
  if (dispersion > DISPERSION.dispersed) return 'low';
  const local = localWeight(kept);
  const scaledExact = kept.filter((p) => p.evidence.market !== 'IL' && p.evidence.match === 'exact').length;
  if (local >= LOCAL_STRENGTH.high && privately >= 3 && dispersion <= DISPERSION.agrees && basis === BASIS.ITEM) return 'high';
  if (local >= LOCAL_STRENGTH.medium || (scale && scaledExact >= 3 && dispersion <= DISPERSION.agrees)) return 'medium';
  return 'low';
}

// ── PRICE ───────────────────────────────────────────────────────────────────
/**
 * How many ads that STATE a condition a price for that condition needs. One ad is one seller's opinion of one unit; a
 * condition's own price needs at least two. A stated assumption, like NEGOTIATION.
 */
export const CONDITION_MIN_REFS = 2;

/** One band from an aggregate: worth, list, quick, and the range — rounded, ordered, and never above `cap`. */
function bandOf(agg, cap = null) {
  let { low, high, centre } = agg;
  let list = Math.max(centre / NEGOTIATION, high);
  if (cap && list > cap) { const k = cap / list; low *= k; high *= k; centre *= k; list = cap; }
  const band = { list: roundNice(list), low: roundNice(low), high: roundNice(high), worth: roundNice(centre) };
  band.high = Math.max(band.high, band.low);
  band.list = Math.max(band.list, band.high);
  // THREE PRICES, ONE EVIDENCE. worth = the weighted median selling price of the references (asking prices less the
  // negotiation allowance); quick = the low end of where that weight lies (weighted 25th percentile, bounded by how much
  // evidence there is: aggregate.js); list = what to ask so a normal negotiation lands near worth.
  band.worth = Math.min(Math.max(band.worth, band.low), band.high);
  band.quick = band.low;
  return band;
}

/**
 * THE PRICE FOR EACH CONDITION — FROM ADS FOR UNITS IN THAT CONDITION, OR NOT AT ALL (2026-11-12). No ladder: the fixed
 * percentages of the old listing flow (like new −15%, used −30%, poor −70% from new) were never measured, and they made a
 * worse unit cost more than a better one.
 *
 *   good        the Israeli used market as its ads ask, whatever used condition they state: basis 'market'.
 *   like_new    from at least CONDITION_MIN_REFS standing ads that say "like new" — when their price does not contradict
 *   fair        the market's order (a like-new price below the market's, a fair one above it, says the labels are
 *               noise): basis 'listings'. Otherwise the market price itself, basis 'market' — NOT adjusted, and the
 *               screen says so.
 *   new_sealed  from at least CONDITION_MIN_REFS current Israeli private ads for a sealed unit (set aside from the used
 *   poor        market, kept here), never above the shop's new price; a faulty or broken unit only from ads for faulty
 *               units. Without them: null — no number. A broken unit's price is not a percentage of a working one's.
 *
 * Each band says how many ads it rests on (`references`).
 */
export function conditionPrices(good, kept, points, anchorIl) {
  const market = bandOf(good);
  const out = { good: { ...market, basis: 'market', references: kept.length } };
  for (const c of ['like_new', 'fair']) {
    const own = kept.filter((p) => p.stated && p.condition === c);
    const agg = own.length >= CONDITION_MIN_REFS ? aggregate(own) : null;
    const consistent = !!agg && (c === 'like_new' ? agg.centre >= good.centre : agg.centre <= good.centre);
    out[c] = consistent ? { ...bandOf(agg), basis: 'listings', references: own.length } : { ...market, basis: 'market', references: 0 };
  }
  for (const c of ['new_sealed', 'poor']) {
    const own = points.filter((p) => p.dropped === SET_ASIDE.NOT_USED_CONDITION && p.condition === c && p.evidence.market === 'IL'
      && PRIVATE_RESALE.has(p.evidence.kind) && p.freshness !== 'older' && p.freshness !== 'archived');
    const agg = own.length >= CONDITION_MIN_REFS ? aggregate(own) : null;
    const consistent = !!agg && (c === 'new_sealed' ? agg.centre >= good.centre : agg.centre <= good.centre);
    out[c] = consistent ? { ...bandOf(agg, c === 'new_sealed' ? anchorIl : null), basis: 'listings', references: own.length } : null;
  }
  return out;
}

/**
 * The valuation the app will show, from an evidence pool.
 *
 * Total and deterministic. `familyLevel` is true when only the item's family is
 * established; `approximate` when the exact model is an open question that
 * moves the price. Another model of the family is never this item's price:
 * with nothing found for the item or a close comparable there is no price.
 */
export function buildValuation({ evidence: pool, searchPerformed = true, unverified = 0, approximate = false, familyLevel = false, strategy = STRATEGY.EXACT, searched = null, today = null } = {}) {
  const evidence = (Array.isArray(pool) ? pool : []).filter((e) => e && typeof e === 'object');
  const day = today ?? new Date().toISOString().slice(0, 10);
  const basis = strategy === STRATEGY.COMPARABLE ? BASIS.SIMILAR_ITEMS : (familyLevel ? BASIS.FAMILY : BASIS.ITEM);
  const norm = normalizeReferences(evidence, { basis, today: day });
  const { points, scale, localDrives } = norm;
  let { anchorIl, anchorInStock, anchorRange } = norm;
  // A SPECIALISED MARKET: every reference is verified and shown, and none is priced from — the engine has no method for it.
  // That includes the NEW price: a new Toyota's price beside a photographed used Toyota reads as its value (the founder's
  // Yaris Cross, 2026-10-11), and a new price is a ceiling only where a used price is made under it. Context, not a figure.
  const specialised = strategy === STRATEGY.SPECIALISED;
  if (specialised) { for (const p of points) if (!p.dropped) p.dropped = SET_ASIDE.SPECIALISED_CONTEXT; anchorIl = null; anchorInStock = null; anchorRange = null; }
  const specialisedRetail = (e) => specialised && e.kind === 'new_retail' && ANCHOR_MATCHES.has(e.match) && !!e.price_ils;
  const similar = basis === BASIS.SIMILAR_ITEMS;
  // A shop's price for a SIMILAR item: shown as context, never an anchor, never counted as this item's new price.
  const similarRetail = (e) => similar && e.kind === 'new_retail' && ANCHOR_MATCHES.has(e.match) && !!e.price_ils;
  // Found, and of the right kind, but not tied to the product by the page's own text: counted, never priced from.
  const loose = new Set(evidence.filter((e) => !isBound(e) && e.price_ils && (resaleLike(e, basis) || (!similar && (anchorLike(e, 'IL') || anchorLike(e, 'INTL'))))));
  // THE GATE. An Israeli second-hand price rests on at least one Israeli PRIVATE reference that is current (not known
  // to be old) and for a USED unit, tied to this product. Listings abroad, a shop's refurbished units, new prices and
  // old or sealed Israeli ads are context: with none standing they price nothing, each marked with why; once one
  // stands, every reference that qualified takes part as before. (The first real scan, 2026-10-11: one sealed ad from
  // April 2025, one refurbished unit, one listing in the United States — and ₪430 on the screen.)
  const qualifies = (p) => p.evidence.market === 'IL' && PRIVATE_RESALE.has(p.evidence.kind) && p.freshness !== 'older' && p.freshness !== 'archived' && p.condition !== 'new_sealed';
  const localEvidence = points.some((p) => !p.dropped && qualifies(p));
  // What abroad offered, for the record and the screen only: exact private references for a used unit, not old. Context.
  const abroadFound = points.filter((p) => !p.dropped && p.evidence.market !== 'IL' && PRIVATE_RESALE.has(p.evidence.kind) && p.evidence.match === 'exact'
    && p.freshness !== 'older' && p.freshness !== 'archived' && p.condition !== 'new_sealed').length;
  if (!localEvidence) {
    for (const p of points) {
      if (p.dropped) continue;
      p.dropped = p.evidence.kind === 'refurbished' ? SET_ASIDE.REFURBISHED_ALONE : (p.evidence.market === 'IL' ? SET_ASIDE.NOT_CURRENT : SET_ASIDE.ABROAD_ONLY);
    }
  }
  // SIMILAR ITEMS ARE NOT THIS ITEM. A range from them is honest only when several Israeli comparables stand and
  // roughly agree: one similar thing's price is one seller's opinion of another thing, and similar things that
  // disagree widely describe no market. Otherwise they are shown as context and no number is made from them.
  const standing = points.filter((p) => !p.dropped);
  const comparableReason = similar && standing.length
    ? (standing.filter(qualifies).length < COMPARABLE_MIN ? WITHDRAWN.TOO_FEW_COMPARABLES : (dispersionOf(standing) > DISPERSION.dispersed ? WITHDRAWN.COMPARABLES_DISAGREE : null))
    : null;
  if (comparableReason) for (const p of standing) p.dropped = SET_ASIDE.SIMILAR_CONTEXT;
  // TWO REFERENCES THAT DISAGREE (WITHDRAWN.REFERENCES_DISAGREE): both are shown, neither prices. The pair is the two
  // references that stand, or the two ISRAELI ones beside any abroad (an Israeli reference outweighs one abroad, so two
  // Israeli ads 23× apart decide the price between them: Canon 5D Mark III, ₪46,970 and ₪2,000 beside $399, 2026-11-13).
  const standingNow = points.filter((p) => !p.dropped);
  const israeliNow = standingNow.filter((p) => p.evidence.market === 'IL');
  const pair = standingNow.length === 2 ? standingNow : israeliNow.length === 2 ? israeliNow : [];
  const disagree = pair.length === 2 && Math.max(pair[0].value, pair[1].value) / Math.min(pair[0].value, pair[1].value) > DISPERSION.dispersed;
  if (disagree) for (const p of standingNow) p.dropped = SET_ASIDE.DISAGREE;
  const kept = points.filter((p) => !p.dropped);
  const unused = points.filter((p) => p.dropped === SET_ASIDE.LOCAL_SUFFICIENT).length;
  const byEvidence = new Map(points.map((p) => [p.evidence, p]));
  const count = (pred) => kept.filter((p) => pred(p.evidence)).length;
  const abroad = kept.some((p) => p.evidence.market !== 'IL');
  // A family-level valuation, or one from similar items, is approximate by construction, question or no question: the
  // listings are not for this item. (Found 2026-10-11: with no open question a family price showed as an exact one.)
  const rough = approximate || basis !== BASIS.ITEM;
  // When similar items were set aside for being too few or too far apart, their spread is still what was found.
  const shown = comparableReason ? standing : kept;
  const dispersion = dispersionOf(shown);
  const prices = shown.map((p) => p.evidence.price_ils);

  const base = {
    evidence: sortEvidence(evidence.map((e) => {
      const p = byEvidence.get(e);
      const anchor = !similar && !specialised && (isNewPrice(e, 'IL') || isNewPrice(e, 'INTL'));
      return {
        ...e,
        freshness: freshnessOf(e.listed, day, e.archived),
        used: !!p && !p.dropped,
        weight: p && !p.dropped ? round2(p.weight) : 0,
        set_aside: p?.dropped ?? (loose.has(e) ? SET_ASIDE.UNBOUND : (similarRetail(e) ? SET_ASIDE.SIMILAR_RETAIL : (specialisedRetail(e) ? SET_ASIDE.SPECIALISED_CONTEXT : (p || anchor ? null : (e.match === 'sibling_model' ? SET_ASIDE.DIFFERENT_MODEL : 'not_comparable'))))),
      };
    })),
    counts: {
      resale: kept.length,
      il_used_exact: count((e) => e.market === 'IL' && e.match === 'exact'),
      il_used_close: count((e) => e.market === 'IL' && e.match !== 'exact'),
      intl_used_exact: count((e) => e.market !== 'IL' && e.match === 'exact'),
      intl_used_close: count((e) => e.market !== 'IL' && e.match !== 'exact'),
      sold: count((e) => SOLD_KINDS.has(e.kind)),
      retail_il: similar || specialised ? 0 : evidence.filter((e) => isNewPrice(e, 'IL')).length,
      // A shop's refurbished offers that qualified: supporting evidence at most, never the used market by themselves.
      retail_refurbished: points.filter((p) => p.evidence.kind === 'refurbished').length,
      // Of the references priced from, how many are a shop's refurbished offers: the screen counts second-hand listings without them.
      refurbished_used: kept.filter((p) => p.evidence.kind === 'refurbished').length,
      // Israeli private references, current and for a used unit: what opens the gate.
      il_qualifying: kept.filter(qualifies).length,
      not_comparable: evidence.filter((e) => !loose.has(e) && !similarRetail(e) && !specialisedRetail(e) && (e.kind !== 'new_retail' ? !byEvidence.has(e) : !ANCHOR_MATCHES.has(e.match))).length,
      unbound: loose.size,
      // Found abroad and not needed, because the Israeli evidence was enough: context, not a rejected result.
      abroad_unused: unused,
      set_aside: points.length - kept.length - unused,
      unverified,
    },
    basis,
    retail_new_ils: anchorIl ? roundNice(anchorIl) : null,
    // false when every shop page behind the new price showed the item out of stock: an older price, not today's.
    retail_new_in_stock: anchorIl ? anchorInStock : null,
    // What the shops behind it asked, lowest to highest; `dispersed` when they disagreed and the lowest was taken.
    retail_new_range: anchorRange ? { low: roundNice(anchorRange.low), high: roundNice(anchorRange.high), dispersed: anchorRange.dispersed } : null,
    // The references priced from, as they were found: the spread a person would see looking at the same pages.
    reference_range: prices.length ? { low: Math.min(...prices), high: Math.max(...prices) } : null,
    local_strength: round2(localWeight(kept)),
    local_drives: localDrives,
    // Whether an Israeli second-hand reference stands behind the price at all.
    local_evidence: localEvidence,
    dispersion: round2(dispersion),
    dispersed: dispersion > DISPERSION.dispersed,
    // Foreign prices in the valuation: whether they were brought to Israeli price level, and by how much.
    intl_adjusted: abroad ? !!scale : null,
    intl_scale: abroad && scale ? round2(scale) : null,
    approximate: rough,
    // Where the number comes from (ISRAEL FIRST above).
    estimate_basis: ESTIMATE_BASIS.ISRAEL,
    // Exactly what was missing when there is no price, so the screen can say it and say what would help.
    evidence_gap: localEvidence ? null : {
      israeli_private_found: points.filter((p) => p.evidence.market === 'IL' && PRIVATE_RESALE.has(p.evidence.kind)).length,
      // Context only: used listings of this exact model abroad. They do not make an Israeli price.
      abroad_found: abroadFound,
      price_level_measured: !!scale,
      new_price_il: anchorIl ? roundNice(anchorIl) : null,
    },
    family_level: basis === BASIS.FAMILY,
    strategy,
    searched,
    // Everything besides the evidence that this calculation read: with `evidence` it reproduces the valuation exactly (persist.js reproduceValuation).
    inputs: { search_performed: searchPerformed, unverified, approximate, family_level: familyLevel, strategy, today: day },
  };
  // `no_price_reason` is the same code under the name the screen reads it by.
  const withdraw = (reason) => ({ ...base, status: 'insufficient_evidence', prices: null, price_confidence: null, withdrawn: reason, no_price_reason: reason });

  if (!searchPerformed && evidence.length === 0) return withdraw(WITHDRAWN.NO_SEARCH);
  if (strategy === STRATEGY.SPECIALISED) return withdraw(WITHDRAWN.NO_CALIBRATED_METHOD);
  if (comparableReason) return withdraw(comparableReason);
  if (disagree) return withdraw(WITHDRAWN.REFERENCES_DISAGREE);
  const good = aggregate(kept);
  // References were found and none of them is an Israeli second-hand listing that stands: say that, not "nothing found".
  if (!good) return withdraw(points.length > 0 && !localEvidence ? WITHDRAWN.NO_LOCAL_EVIDENCE : WITHDRAWN.NO_RESALE_EVIDENCE);

  return {
    ...base,
    status: 'priced',
    prices: conditionPrices(good, kept, points, anchorIl),
    price_confidence: priceConfidence({ kept, scale, approximate: rough, basis }),
    withdrawn: null,
    no_price_reason: null,
  };
}

/** The answer when the identity names no one product and no search was made: the empty no-price state, and what was missing (identify.js INCOMPLETE). */
export function incompleteValuation(missing) {
  const empty = buildValuation({ evidence: [], searchPerformed: true });
  return { ...empty, withdrawn: WITHDRAWN.IDENTITY_INCOMPLETE, no_price_reason: WITHDRAWN.IDENTITY_INCOMPLETE, missing: typeof missing === 'string' ? missing.slice(0, 40) : null };
}

const RANK = (e) => (e.used ? 0 : e.kind === 'new_retail' && ANCHOR_MATCHES.has(e.match) ? 1 : 2) * 100 + (e.market === 'IL' ? 0 : 1) * 10 + (e.match === 'exact' ? 0 : 1);
/** What the price rests on first (Israel before abroad), the new-price anchors next, what was set aside last. Stable. */
function sortEvidence(evidence) { return evidence.map((e, i) => [e, i]).sort((a, b) => RANK(a[0]) - RANK(b[0]) || b[0].weight - a[0].weight || a[1] - b[1]).map(([e]) => e); }

/** How strong the Israeli second-hand evidence in a pool is: what decides whether to look further afield. */
export function localStrength(evidence, { familyLevel = false, strategy = STRATEGY.EXACT, today = null } = {}) {
  const basis = strategy === STRATEGY.COMPARABLE ? BASIS.SIMILAR_ITEMS : (familyLevel ? BASIS.FAMILY : BASIS.ITEM);
  return normalizeReferences(Array.isArray(evidence) ? evidence : [], { basis, today: today ?? new Date().toISOString().slice(0, 10) }).local;
}
