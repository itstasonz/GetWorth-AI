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
//   NORMALIZE   every reference is brought to shekels, Israeli price level,
//               "good" condition and a selling price.
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
import { CONDITION_LADDER } from '../valuation-guard.js';
import { CONDITIONS } from './config.js';
import { freshnessOf } from './evidence.js';
import { isBound } from './binding.js';

export { pageKey, verifyEvidence, mergeEvidence, requalify } from './evidence.js';

export const WITHDRAWN = Object.freeze({
  NO_SEARCH: 'no_search_recorded',
  NO_RESALE_EVIDENCE: 'no_verified_second_hand_reference',
});
/** What the valuation rests on. */
export const BASIS = Object.freeze({ ITEM: 'this_item', FAMILY: 'product_family', SIMILAR: 'similar_models' });

// ── THE STATED ASSUMPTIONS ──────────────────────────────────────────────────
/**
 * What each condition sells for relative to "good": the app's own condition
 * ladder (valuation-guard.js: the discount from new for sealed / like new /
 * used / poor), re-based on "good", with "fair" halfway between used and poor.
 */
const LADDER = { new_sealed: CONDITION_LADDER.newSealed, like_new: CONDITION_LADDER.likeNew, good: CONDITION_LADDER.used, fair: (CONDITION_LADDER.used + CONDITION_LADDER.poor) / 2, poor: CONDITION_LADDER.poor };
export const CONDITION_FACTOR = Object.freeze(Object.fromEntries(CONDITIONS.map((c) => [c, (1 - LADDER[c]) / (1 - LADDER.good)])));
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
});
/** A used unit asking more than the shop's price for a new one is not a second-hand reference. */
const ABOVE_NEW = 1.05;
/** Israeli price level relative to abroad, when the same item's new price is known in both: kept within sane bounds. */
const SCALE_BOUNDS = [0.8, 2];
/** Median-absolute-deviation outlier rule, applied only when there is a distribution to be an outlier from. */
const MAD_THRESHOLD = 3.5;
const MAD_MIN_SAMPLE = 4;
/** The expected selling range around the centre: the least it may be by how much evidence there is, and the most. */
const RANGE = Object.freeze({ one: [0.25, 0.12], few: [0.18, 0.09], many: [0.08, 0.04], max: [0.5, 0.4] });
/** Where the weight of the evidence spans more than this (P90 / P10), the evidence disagrees. */
export const DISPERSION = Object.freeze({ agrees: 1.6, dispersed: 2.2 });
/**
 * Local weight, in the units of WEIGHT: a current exact Israeli listing weighs 1.
 *   drives  from here the Israeli evidence prices the item alone (and the search does not go abroad)
 *   high    what a confident price needs: about three good current Israeli listings
 *   medium  one good current listing's worth, among at least two references
 */
export const LOCAL_STRENGTH = Object.freeze({ drives: 1.5, high: 2.5, medium: 1 });
/** Why a reference that qualifies took no part in the price. */
export const SET_ASIDE = Object.freeze({ ABOVE_NEW: 'above_new_price', OUTLIER: 'outlier', LOCAL_SUFFICIENT: 'local_evidence_sufficient', UNBOUND: 'price_not_tied_to_product' });

const RESALE_KINDS = new Set(['used_listing', 'sold', 'refurbished', 'price_guide']);
const SOLD_KINDS = new Set(['sold', 'price_guide']);
const MATCHES = Object.freeze({
  [BASIS.ITEM]: new Set(['exact', 'close_comparable']),
  [BASIS.FAMILY]: new Set(['exact', 'close_comparable', 'sibling_model']),
  [BASIS.SIMILAR]: new Set(['exact', 'close_comparable', 'sibling_model']),
});
const ANCHOR_MATCHES = MATCHES[BASIS.ITEM];

const finite = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
/** Israeli evidence that can lead: a listing known to be old is Israeli, and still says little about today. */
const leads = (p) => p.evidence.market === 'IL' && p.freshness !== 'older' && p.freshness !== 'archived';
const localWeight = (points) => points.filter(leads).reduce((sum, p) => sum + p.weight, 0);
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round2 = (v) => Math.round(v * 100) / 100;

/** A natural price: ₪290, ₪900, ₪1,250. Never ₪847. */
export function roundNice(n) {
  const v = finite(n);
  if (!v) return null;
  const step = v < 100 ? 5 : v < 1000 ? 10 : v < 5000 ? 50 : v < 20000 ? 100 : 500;
  return Math.max(step, Math.round(v / step) * step);
}

// What a price WOULD be, were it tied to its product — and what it IS, when it is.
const resaleLike = (e, basis) => RESALE_KINDS.has(e.kind) && MATCHES[basis].has(e.match);
const anchorLike = (e, market) => e.kind === 'new_retail' && ANCHOR_MATCHES.has(e.match) && e.market === market && !!e.price_ils;
const isResale = (e, basis) => resaleLike(e, basis) && isBound(e);
const isNewPrice = (e, market) => anchorLike(e, market) && isBound(e);
/**
 * The new price in a market: the exact item's when the search found one, else
 * the close comparable's. A shop that has it today says more about today's new
 * price than a page for a unit that is out of stock, so stocked offers are
 * used when there are any, and the answer says which it was.
 */
function newPrice(evidence, market) {
  const all = evidence.filter((e) => isNewPrice(e, market));
  const exact = all.filter((e) => e.match === 'exact');
  const use = exact.length ? exact : all;
  const stocked = use.filter((e) => e.stock !== 'out_of_stock');
  const from = stocked.length ? stocked : use;
  return from.length ? { price: median(from.map((e) => e.price_ils)), inStock: stocked.length > 0 } : null;
}

// ── WEIGH AND NORMALIZE ─────────────────────────────────────────────────────
/**
 * Each second-hand reference as a selling price in shekels, at Israeli price
 * level, in "good" condition — with its weight, the reasons for that weight,
 * and why it was set aside when it was.
 */
export function normalizeReferences(evidence, { basis = BASIS.ITEM, today = null } = {}) {
  const il = newPrice(evidence, 'IL');
  const anchorIl = il?.price ?? null;
  const anchorIntl = newPrice(evidence, 'INTL')?.price ?? null;
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
      kind: WEIGHT.kind[e.kind] ?? 1,
      page: WEIGHT.page[e.page] ?? WEIGHT.page.other,
    };
    // A used unit priced above a new one is a different thing: a bundle, a mislabelled new unit, a mistake.
    const aboveNew = anchorIl && (abroad ? e.price_ils * (scale ?? 1) : e.price_ils) > anchorIl * ABOVE_NEW;
    points.push({
      evidence: e, value: local / CONDITION_FACTOR[condition], condition, stated, freshness, asking,
      weight: factors.where * factors.match * factors.freshness * factors.kind * factors.page, factors,
      dropped: aboveNew ? SET_ASIDE.ABOVE_NEW : null,
    });
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
  return { points, anchorIl, anchorInStock: il ? il.inStock : null, scale, local, localDrives };
}

// ── AGGREGATE ───────────────────────────────────────────────────────────────
/**
 * The value below which `q` of the total weight lies. When the weight splits
 * exactly at a boundary the answer is the midpoint of the two neighbours, never
 * whichever happened to be lower. Deterministic: ties are ordered by value, then page.
 */
export function weightedQuantile(points, q) {
  const sorted = [...points].sort((a, b) => a.value - b.value || String(a.evidence?.url).localeCompare(String(b.evidence?.url)));
  const total = sorted.reduce((s, p) => s + p.weight, 0);
  if (!sorted.length || !(total > 0)) return null;
  const target = total * q;
  let acc = 0;
  for (let i = 0; i < sorted.length; i += 1) {
    acc += sorted[i].weight;
    if (Math.abs(acc - target) < total * 1e-9 && i + 1 < sorted.length) return (sorted[i].value + sorted[i + 1].value) / 2;
    if (acc > target) return sorted[i].value;
  }
  return sorted.at(-1).value;
}

/** How far apart the weight of the evidence lies: P90 over P10. 1 when it agrees or there is one reference. */
export function dispersionOf(kept) {
  if (kept.length < 2) return 1;
  const lo = weightedQuantile(kept, 0.1);
  const hi = weightedQuantile(kept, 0.9);
  return lo > 0 ? hi / lo : 1;
}

/** The centre and the expected selling range in "good" condition, from the references that stand. */
export function aggregate(kept) {
  if (kept.length === 0) return null;
  const centre = weightedQuantile(kept, 0.5);
  if (kept.length === 1) return { centre, low: centre * (1 - RANGE.one[0]), high: centre * (1 + RANGE.one[1]) };
  const least = kept.length >= MAD_MIN_SAMPLE ? RANGE.many : RANGE.few;
  // The range is where the weight of the evidence lies: evidence that disagrees gives a wide range.
  const below = clamp(1 - weightedQuantile(kept, 0.25) / centre, least[0], RANGE.max[0]);
  const above = clamp(weightedQuantile(kept, 0.75) / centre - 1, least[1], RANGE.max[1]);
  return { centre, low: centre * (1 - below), high: centre * (1 + above) };
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
  if (approximate || basis === BASIS.SIMILAR || kept.length < 2) return 'low';
  const dispersion = dispersionOf(kept);
  if (dispersion > DISPERSION.dispersed) return 'low';
  const local = localWeight(kept);
  const scaledExact = kept.filter((p) => p.evidence.market !== 'IL' && p.evidence.match === 'exact').length;
  if (local >= LOCAL_STRENGTH.high && kept.length >= 3 && dispersion <= DISPERSION.agrees && basis === BASIS.ITEM) return 'high';
  if (local >= LOCAL_STRENGTH.medium || (scale && scaledExact >= 3 && dispersion <= DISPERSION.agrees)) return 'medium';
  return 'low';
}

// ── PRICE ───────────────────────────────────────────────────────────────────
/**
 * Every condition's band from the "good" one, by the ladder.
 *
 * `basis` says where a condition's price comes from: 'listings' when at least
 * one reference that stands STATED that condition itself, 'adjusted' when it is
 * the ladder applied to the others. A new-sealed unit is never priced above the
 * shop's price for a new one.
 */
export function conditionPrices(good, kept, anchorIl) {
  const stated = new Set(kept.filter((p) => p.stated).map((p) => p.condition));
  const out = {};
  for (const c of CONDITIONS) {
    const f = CONDITION_FACTOR[c];
    let low = good.low * f; let high = good.high * f; let list = Math.max(good.centre / NEGOTIATION, good.high) * f;
    if (c === 'new_sealed' && anchorIl && list > anchorIl) { const k = anchorIl / list; low *= k; high *= k; list = anchorIl; }
    const band = { list: roundNice(list), low: roundNice(low), high: roundNice(high) };
    band.high = Math.max(band.high, band.low);
    band.list = Math.max(band.list, band.high);
    out[c] = { ...band, basis: stated.has(c) ? 'listings' : 'adjusted' };
  }
  return out;
}

/**
 * The valuation the app will show, from an evidence pool.
 *
 * Total and deterministic. `familyLevel` is true when only the item's family is
 * established; `approximate` when the exact model is an open question that
 * moves the price. When an item's exact model IS known but nothing was found
 * for it or a close comparable, the family's other models are used as a last
 * resort and the valuation says so: approximate, low confidence, "similar models".
 */
export function buildValuation({ evidence: pool, searchPerformed = true, unverified = 0, approximate = false, familyLevel = false, searched = null, today = null } = {}) {
  const evidence = (Array.isArray(pool) ? pool : []).filter((e) => e && typeof e === 'object');
  const day = today ?? new Date().toISOString().slice(0, 10);
  let basis = familyLevel ? BASIS.FAMILY : BASIS.ITEM;
  let norm = normalizeReferences(evidence, { basis, today: day });
  if (basis === BASIS.ITEM && !norm.points.some((p) => !p.dropped)) {
    const similar = normalizeReferences(evidence, { basis: BASIS.SIMILAR, today: day });
    if (similar.points.some((p) => !p.dropped)) { basis = BASIS.SIMILAR; norm = similar; }
  }
  const { points, anchorIl, anchorInStock, scale, localDrives } = norm;
  // Found, and of the right kind, but not tied to the product by the page's own text: counted, never priced from.
  const loose = new Set(evidence.filter((e) => !isBound(e) && e.price_ils && (resaleLike(e, basis) || anchorLike(e, 'IL') || anchorLike(e, 'INTL'))));
  const kept = points.filter((p) => !p.dropped);
  const unused = points.filter((p) => p.dropped === SET_ASIDE.LOCAL_SUFFICIENT).length;
  const byEvidence = new Map(points.map((p) => [p.evidence, p]));
  const count = (pred) => kept.filter((p) => pred(p.evidence)).length;
  const abroad = kept.some((p) => p.evidence.market !== 'IL');
  const rough = approximate || basis === BASIS.SIMILAR;
  const dispersion = dispersionOf(kept);
  const prices = kept.map((p) => p.evidence.price_ils);

  const base = {
    evidence: sortEvidence(evidence.map((e) => {
      const p = byEvidence.get(e);
      const anchor = isNewPrice(e, 'IL') || isNewPrice(e, 'INTL');
      return {
        ...e,
        freshness: freshnessOf(e.listed, day, e.archived),
        used: !!p && !p.dropped,
        weight: p && !p.dropped ? round2(p.weight) : 0,
        set_aside: p?.dropped ?? (loose.has(e) ? SET_ASIDE.UNBOUND : (p || anchor ? null : 'not_comparable')),
      };
    })),
    counts: {
      resale: kept.length,
      il_used_exact: count((e) => e.market === 'IL' && e.match === 'exact'),
      il_used_close: count((e) => e.market === 'IL' && e.match !== 'exact'),
      intl_used_exact: count((e) => e.market !== 'IL' && e.match === 'exact'),
      intl_used_close: count((e) => e.market !== 'IL' && e.match !== 'exact'),
      sold: count((e) => SOLD_KINDS.has(e.kind)),
      retail_il: evidence.filter((e) => isNewPrice(e, 'IL')).length,
      not_comparable: evidence.filter((e) => !loose.has(e) && (e.kind !== 'new_retail' ? !byEvidence.has(e) : !ANCHOR_MATCHES.has(e.match))).length,
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
    // The references priced from, as they were found: the spread a person would see looking at the same pages.
    reference_range: prices.length ? { low: Math.min(...prices), high: Math.max(...prices) } : null,
    local_strength: round2(localWeight(kept)),
    local_drives: localDrives,
    dispersion: round2(dispersion),
    dispersed: dispersion > DISPERSION.dispersed,
    // Foreign prices in the valuation: whether they were brought to Israeli price level, and by how much.
    intl_adjusted: abroad ? !!scale : null,
    intl_scale: abroad && scale ? round2(scale) : null,
    approximate: rough,
    family_level: basis !== BASIS.ITEM,
    searched,
  };
  const withdraw = (reason) => ({ ...base, status: 'insufficient_evidence', prices: null, price_confidence: null, withdrawn: reason });

  if (!searchPerformed && evidence.length === 0) return withdraw(WITHDRAWN.NO_SEARCH);
  const good = aggregate(kept);
  if (!good) return withdraw(WITHDRAWN.NO_RESALE_EVIDENCE);

  return {
    ...base,
    status: 'priced',
    prices: conditionPrices(good, kept, anchorIl),
    price_confidence: priceConfidence({ kept, scale, approximate: rough, basis }),
    withdrawn: null,
  };
}

const RANK = (e) => (e.used ? 0 : e.kind === 'new_retail' && ANCHOR_MATCHES.has(e.match) ? 1 : 2) * 100 + (e.market === 'IL' ? 0 : 1) * 10 + (e.match === 'exact' ? 0 : 1);
/** What the price rests on first (Israel before abroad), the new-price anchors next, what was set aside last. Stable. */
function sortEvidence(evidence) { return evidence.map((e, i) => [e, i]).sort((a, b) => RANK(a[0]) - RANK(b[0]) || b[0].weight - a[0].weight || a[1] - b[1]).map(([e]) => e); }

/** How strong the Israeli second-hand evidence in a pool is: what decides whether to look further afield. */
export function localStrength(evidence, { familyLevel = false, today = null } = {}) {
  return normalizeReferences(Array.isArray(evidence) ? evidence : [], { basis: familyLevel ? BASIS.FAMILY : BASIS.ITEM, today: today ?? new Date().toISOString().slice(0, 10) }).local;
}

// ── THE MARKET IDENTITY ─────────────────────────────────────────────────────
const STOP = new Set(['the', 'a', 'an', 'and', 'with', 'series', 'model', 'edition']);
const tokens = (v) => String(v ?? '').normalize('NFKC').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t && !STOP.has(t));
/** Whether the thing being sold is the whole product or a lesser part of it: what the configuration means for the price. */
const SCOPE = { complete_item: 'complete', bundle: 'complete', unknown: 'complete' };

/**
 * A key for "the same thing on the market".
 *
 * Built from what the item IS — its catalogue name, its capacity, whether it is
 * the whole product, and the owner's answer when one was given — and from
 * nothing about the photograph: not the image, not the colour, not the
 * language, not the wording of a display name. Two photographs of the same
 * product share one key, and so share one market research.
 */
export function marketKey(identity, answer = null) {
  const i = identity ?? {};
  const name = tokens(i.canonical_name || [i.brand, i.model ?? i.product_family ?? i.item_type, i.variant].filter(Boolean).join(' '));
  return [
    [...new Set(name)].sort().join(' '),
    tokens(i.size_or_capacity).join(''),
    SCOPE[i.configuration] ?? i.configuration ?? 'complete',
    tokens(answer?.text).join(' '),
  ].join('|');
}
