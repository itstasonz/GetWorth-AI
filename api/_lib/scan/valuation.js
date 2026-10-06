// ══════════════════════════════════════════════════════════════════════════════
// CORE SCAN — THE SERVER PRICES. THE MODEL DOES NOT.
//
// The market step's model searches, extracts and classifies. It returns a list
// of prices it found, each with what it is. It returns NO valuation. Everything
// from there to the number on the screen happens here, in pure functions:
//
//   QUALIFY     a price counts only if the search tool's own record shows its
//               page was reached, and only if it is this item or a close
//               comparable. Accessories, parts, boxes and bundles never count.
//               A sibling model never counts for an item whose exact model is
//               known; when only the FAMILY is known, the family's members are
//               what there is to compare with, and the price says it is for
//               the family.
//   NORMALIZE   every second-hand reference is brought to one common footing:
//               shekels, Israeli price level, "good" condition, selling price.
//   AGGREGATE   outliers are removed where that is defensible, stronger
//               evidence weighs more, and the centre is a weighted median.
//   PRICE       an expected selling range around that centre, a natural asking
//               price above it, and each other condition by an explicit ladder.
//
// THE SAME EVIDENCE ALWAYS PRODUCES THE SAME VALUATION. There is no randomness
// and no model here, so a price can only change when the evidence does.
//
// Every constant below is a stated assumption, not a discovered fact. They are
// few, conservative and in one place so they can be read and argued with.
// ══════════════════════════════════════════════════════════════════════════════
import { hostOf } from '../phaseb/search-provenance.js';
import { CONDITION_LADDER } from '../valuation-guard.js';
import { toIls } from './fx.js';
import { CONDITIONS } from './config.js';
import { EVIDENCE_KINDS, EVIDENCE_MATCHES, EVIDENCE_CONDITIONS } from './market.js';

export const WITHDRAWN = Object.freeze({
  NO_SEARCH: 'no_search_recorded',
  NO_RESALE_EVIDENCE: 'no_verified_second_hand_reference',
});

// ── THE STATED ASSUMPTIONS ──────────────────────────────────────────────────
/**
 * What each condition sells for relative to "good".
 *
 * The app's own condition ladder (valuation-guard.js CONDITION_LADDER: the
 * discount from new for sealed / like new / used / poor), re-based on "good",
 * which is what a normal used listing is. "fair" sits halfway between used and
 * poor. It is used in both directions: to bring a listing stated as "like new"
 * down to its "good" equivalent, and to derive the other conditions' prices.
 */
const LADDER = { new_sealed: CONDITION_LADDER.newSealed, like_new: CONDITION_LADDER.likeNew, good: CONDITION_LADDER.used, fair: (CONDITION_LADDER.used + CONDITION_LADDER.poor) / 2, poor: CONDITION_LADDER.poor };
export const CONDITION_FACTOR = Object.freeze(Object.fromEntries(CONDITIONS.map((c) => [c, (1 - LADDER[c]) / (1 - LADDER.good)])));
/** An asking price is not a selling price: what a listing asks, less the usual negotiation. */
export const NEGOTIATION = 0.9;
/** How much a reference counts. Israel before abroad, exact before comparable, a completed sale before an asking price. */
export const WEIGHT = Object.freeze({ IL_exact: 1, IL_close: 0.6, INTL_exact: 0.5, INTL_close: 0.3, sold_bonus: 1.25 });
/** A used unit asking more than the shop's price for a new one is not a second-hand reference. */
const ABOVE_NEW = 1.05;
/** Israeli price level relative to abroad, when the same item's new price is known in both: kept within sane bounds. */
const SCALE_BOUNDS = [0.8, 2];
/** Median-absolute-deviation outlier rule, applied only when there is a distribution to be an outlier from. */
const MAD_THRESHOLD = 3.5;
const MAD_MIN_SAMPLE = 4;
/** The expected selling range around the centre, by how much evidence there is: [below, above]. */
const RANGE = Object.freeze({ one: [0.25, 0.12], few: [0.18, 0.09], min: [0.08, 0.04], max: [0.3, 0.25] });

const RESALE_KINDS = new Set(['used_listing', 'sold', 'refurbished', 'price_guide']);
const SOLD_KINDS = new Set(['sold', 'price_guide']);
const USABLE_MATCHES = new Set(['exact', 'close_comparable']);
/** May a reference with this match be priced from? At family level, the family's other models are its comparables. */
const usableMatch = (match, familyLevel) => USABLE_MATCHES.has(match) || (familyLevel && match === 'sibling_model');

const finite = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
const text = (v, max) => (typeof v === 'string' && v.replace(/\s+/g, ' ').trim() ? v.replace(/\s+/g, ' ').trim().slice(0, max) : null);
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** A natural price: ₪290, ₪900, ₪1,250. Never ₪847. */
export function roundNice(n) {
  const v = finite(n);
  if (!v) return null;
  const step = v < 100 ? 5 : v < 1000 ? 10 : v < 5000 ? 50 : v < 20000 ? 100 : 500;
  return Math.max(step, Math.round(v / step) * step);
}

/** Host and path of a page, without the visit's own decoration. */
export function pageKey(raw) {
  const m = /^https?:\/\/([^\s/?#]+)([^\s?#]*)/i.exec(String(raw ?? '').trim());
  const host = m ? hostOf(m[1]) : null;
  return host ? `${host}${m[2].replace(/\/+$/, '')}`.toLowerCase() : null;
}

function priceInText(price, pageText) {
  if (!pageText) return false;
  const grouped = String(Math.round(price)).replace(/\B(?=(\d{3})+(?!\d))/g, '[,.\\s]?');
  return new RegExp(`(^|[^\\d])${grouped}([^\\d]|$)`).test(pageText);
}

// ── QUALIFY ─────────────────────────────────────────────────────────────────
/**
 * Bind each claimed price to the search record.
 *
 * Returns the evidence that stands — each with `binding` ('content' when the
 * price itself is in the text the search returned for that page, 'url' when the
 * page was reached) and the date it was seen — and how many claims named a page
 * the search never reached. The shekel conversion is kept beside the original.
 */
export function verifyEvidence(rawEvidence, provenance, fx = null, seen = null) {
  const reached = new Map();
  for (const url of Array.isArray(provenance?.sources) ? provenance.sources : []) {
    const key = pageKey(url);
    if (key && !reached.has(key)) reached.set(key, url);
  }
  const pageText = new Map();
  for (const r of Array.isArray(provenance?.results) ? provenance.results : []) {
    const key = pageKey(r?.url);
    const body = [r?.title, r?.text].filter((v) => typeof v === 'string').join('\n');
    if (key && body) pageText.set(key, `${pageText.get(key) ?? ''}\n${body}`);
  }

  const evidence = [];
  const dedupe = new Set();
  let unverified = 0;
  for (const e of Array.isArray(rawEvidence) ? rawEvidence : []) {
    const price = finite(e?.price);
    const key = pageKey(e?.url);
    if (!price || !key || !provenance?.search_performed || !reached.has(key)) { unverified += 1; continue; }
    const currency = /^(ils|nis|₪|ש"?ח|שקל.*)$/i.test(String(e?.currency ?? '').trim()) ? 'ILS' : String(e?.currency ?? '').trim().toUpperCase().slice(0, 3);
    if (!/^[A-Z]{3}$/.test(currency)) { unverified += 1; continue; }
    const id = `${key}|${price}|${currency}`;
    if (dedupe.has(id)) continue;
    dedupe.add(id);
    const ils = toIls(price, currency, fx);
    evidence.push({
      url: reached.get(key),
      domain: hostOf(reached.get(key)),
      title: text(e?.title, 120),
      price,
      currency,
      price_ils: ils ? Math.round(ils) : null,
      kind: EVIDENCE_KINDS.includes(e?.kind) ? e.kind : 'other',
      match: EVIDENCE_MATCHES.includes(e?.match) ? e.match : 'irrelevant',
      market: e?.market === 'IL' ? 'IL' : 'INTL',
      condition: EVIDENCE_CONDITIONS.includes(e?.condition) ? e.condition : 'unknown',
      binding: priceInText(price, pageText.get(key)) ? 'content' : 'url',
      seen,
    });
  }
  return { evidence, unverified };
}

/**
 * Earlier evidence for the same item joined with what this search found: the
 * newer sighting of a page wins, and the pool is bounded. A valuation that
 * rests on more references moves less with whichever listings happened to
 * appear today.
 */
export function mergeEvidence(fresh, earlier, max = 16) {
  const byPage = new Map();
  for (const e of [...(Array.isArray(fresh) ? fresh : []), ...(Array.isArray(earlier) ? earlier : [])]) {
    const id = `${pageKey(e?.url)}|${e?.price}|${e?.currency}`;
    if (e?.url && !byPage.has(id)) byPage.set(id, e);
  }
  return [...byPage.values()].slice(0, max);
}

const isResale = (e, familyLevel = false) => RESALE_KINDS.has(e.kind) && usableMatch(e.match, familyLevel);
const isNewPrice = (e, market) => e.kind === 'new_retail' && USABLE_MATCHES.has(e.match) && e.market === market && !!e.price_ils;
/** The new price in a market: the exact item's when the search found one, else the close comparable's. */
function newPrice(evidence, market) {
  const all = evidence.filter((e) => isNewPrice(e, market));
  const exact = all.filter((e) => e.match === 'exact');
  const use = exact.length ? exact : all;
  return use.length ? median(use.map((e) => e.price_ils)) : null;
}

// ── NORMALIZE ───────────────────────────────────────────────────────────────
/**
 * Each second-hand reference as a selling price in shekels, at Israeli price
 * level, in "good" condition — with its weight, and why it was set aside when
 * it was.
 */
export function normalizeReferences(evidence, { familyLevel = false } = {}) {
  const anchorIl = newPrice(evidence, 'IL');
  const anchorIntl = newPrice(evidence, 'INTL');
  // Abroad is not Israel. The level is taken from the same item's new price in
  // both markets when both are known; otherwise foreign prices are left as
  // converted, and the valuation says so.
  const scale = anchorIl && anchorIntl ? clamp(anchorIl / anchorIntl, ...SCALE_BOUNDS) : null;

  const points = [];
  for (const e of evidence) {
    if (!isResale(e, familyLevel) || !e.price_ils) continue;
    // A listing that does not state its condition is taken as a normal used one; a refurbished unit as like new.
    const stated = CONDITIONS.includes(e.condition);
    const condition = stated ? e.condition : (e.kind === 'refurbished' ? 'like_new' : 'good');
    const selling = SOLD_KINDS.has(e.kind) ? e.price_ils : e.price_ils * NEGOTIATION;
    const local = e.market === 'IL' ? selling : selling * (scale ?? 1);
    const value = local / CONDITION_FACTOR[condition];
    const weight = WEIGHT[`${e.market}_${e.match === 'exact' ? 'exact' : 'close'}`] * (SOLD_KINDS.has(e.kind) ? WEIGHT.sold_bonus : 1);
    // A used unit priced above a new one is a different thing: a bundle, a mislabelled new unit, a mistake.
    const aboveNew = anchorIl && (e.market === 'IL' ? e.price_ils : e.price_ils * (scale ?? 1)) > anchorIl * ABOVE_NEW;
    points.push({ evidence: e, value, weight, condition, stated, dropped: aboveNew ? 'above_new_price' : null });
  }

  const kept = points.filter((p) => !p.dropped);
  if (kept.length >= MAD_MIN_SAMPLE) {
    const med = median(kept.map((p) => p.value));
    const mad = median(kept.map((p) => Math.abs(p.value - med)));
    if (mad > 0) for (const p of kept) if ((0.6745 * Math.abs(p.value - med)) / mad > MAD_THRESHOLD) p.dropped = 'outlier';
  }
  return { points, anchorIl, scale };
}

// ── AGGREGATE ───────────────────────────────────────────────────────────────
/** The value below which `q` of the total weight lies. Deterministic: ties are broken by value, then by page. */
export function weightedQuantile(points, q) {
  const sorted = [...points].sort((a, b) => a.value - b.value || String(a.evidence?.url).localeCompare(String(b.evidence?.url)));
  const total = sorted.reduce((s, p) => s + p.weight, 0);
  let acc = 0;
  for (const p of sorted) { acc += p.weight; if (acc >= total * q) return p.value; }
  return sorted.at(-1)?.value ?? null;
}

/** The centre and the expected selling range in "good" condition, from the references that stand. */
export function aggregate(kept) {
  if (kept.length === 0) return null;
  const centre = weightedQuantile(kept, 0.5);
  let below; let above;
  if (kept.length >= MAD_MIN_SAMPLE) {
    below = clamp(1 - weightedQuantile(kept, 0.25) / centre, RANGE.min[0], RANGE.max[0]);
    above = clamp(weightedQuantile(kept, 0.75) / centre - 1, RANGE.min[1], RANGE.max[1]);
  } else {
    [below, above] = kept.length === 1 ? RANGE.one : RANGE.few;
  }
  return { centre, low: centre * (1 - below), high: centre * (1 + above) };
}

// ── PRICE ───────────────────────────────────────────────────────────────────
/** How well the price is evidenced. Decided by the evidence alone. */
export function priceConfidence({ kept, scale, approximate, familyLevel = false }) {
  if (approximate) return 'low';
  const il = kept.filter((p) => p.evidence.market === 'IL');
  const ilExact = il.filter((p) => p.evidence.match === 'exact').length;
  const intlExact = kept.filter((p) => p.evidence.market === 'INTL' && p.evidence.match === 'exact').length;
  const spread = il.length ? Math.max(...il.map((p) => p.value)) / Math.min(...il.map((p) => p.value)) : Infinity;
  // A price for a family, not for a known model, is never "high".
  if (il.length >= 3 && ilExact >= 2 && spread <= 1.6 && !familyLevel) return 'high';
  if (il.length >= 2 || (il.length >= 1 && kept.length >= 3) || (intlExact >= 3 && scale)) return 'medium';
  return 'low';
}

/**
 * Every condition's band from the "good" one.
 *
 * `basis` says where a condition's price comes from: 'listings' when at least
 * one reference that stands STATED that condition itself, 'adjusted' when it is
 * the ladder applied to the others. A condition that was assumed vouches for
 * nothing. A new-sealed unit is never priced above the
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
 * Total and deterministic: any input yields { status, ... }, never throws, and
 * the same evidence always yields the same answer. `approximate` is true when
 * the item's exact model or generation is still an open question that moves the
 * price; `familyLevel` when only the family is established at all. Either way
 * the price is for the family, and it says so.
 */
export function buildValuation({ evidence: pool, searchPerformed = true, unverified = 0, approximate = false, familyLevel = false, searched = null } = {}) {
  const evidence = (Array.isArray(pool) ? pool : []).filter((e) => e && typeof e === 'object');
  const { points, anchorIl, scale } = normalizeReferences(evidence, { familyLevel });
  const kept = points.filter((p) => !p.dropped);
  const used = new Set(kept.map((p) => p.evidence));
  const dropped = new Map(points.filter((p) => p.dropped).map((p) => [p.evidence, p.dropped]));
  const count = (pred) => kept.filter((p) => pred(p.evidence)).length;
  const abroad = kept.some((p) => p.evidence.market === 'INTL');
  const base = {
    evidence: sortEvidence(evidence.map((e) => ({
      ...e,
      used: used.has(e),
      set_aside: dropped.get(e) ?? (used.has(e) || isNewPrice(e, 'IL') || isNewPrice(e, 'INTL') ? null : 'not_comparable'),
    }))),
    counts: {
      resale: kept.length,
      il_used_exact: count((e) => e.market === 'IL' && e.match === 'exact'),
      il_used_close: count((e) => e.market === 'IL' && e.match !== 'exact'),
      intl_used_exact: count((e) => e.market === 'INTL' && e.match === 'exact'),
      intl_used_close: count((e) => e.market === 'INTL' && e.match !== 'exact'),
      sold: count((e) => SOLD_KINDS.has(e.kind)),
      retail_il: evidence.filter((e) => isNewPrice(e, 'IL')).length,
      not_comparable: evidence.filter((e) => !usableMatch(e.match, familyLevel)).length,
      set_aside: dropped.size,
      unverified,
    },
    retail_new_ils: anchorIl ? roundNice(anchorIl) : null,
    // Foreign prices in the valuation: whether they were brought to Israeli price level, and by how much.
    intl_adjusted: abroad ? !!scale : null,
    intl_scale: abroad && scale ? Math.round(scale * 100) / 100 : null,
    approximate: !!approximate,
    family_level: !!familyLevel,
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
    price_confidence: priceConfidence({ kept, scale, approximate, familyLevel }),
    withdrawn: null,
  };
}

const RANK = (e) => (e.used ? 0 : e.kind === 'new_retail' && USABLE_MATCHES.has(e.match) ? 1 : 2) * 10 + (e.market === 'IL' ? 0 : 1) * 2 + (e.match === 'exact' ? 0 : 1);
/** What the price rests on first, the new-price anchors next, what was set aside last. Stable. */
function sortEvidence(evidence) { return evidence.map((e, i) => [e, i]).sort((a, b) => RANK(a[0]) - RANK(b[0]) || a[1] - b[1]).map(([e]) => e); }

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
