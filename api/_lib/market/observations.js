// ══════════════════════════════════════════════════════════════════════════════
// MARKET OBSERVATIONS — ONE NORMALISED RECORD PER PRICE SEEN
//
// A reference the scan verified (scan/evidence.js) becomes an observation: what
// was seen, where, when, by which rules, under which permission, and how it
// relates to a product. Observations are what the market index keeps; the
// valuation reads them back as the same references it would have built itself.
//
// The SEGMENT keeps different kinds of price apart. They are never mixed:
//   private_asking     a private seller's (or second-hand dealer's) asking price
//   completed_sale     a completed sale (with how it was verified)
//   refurbished        a shop's renewed / ex-display unit
//   new_retail         a shop's price for a new unit — replacement context only
//   price_guide        a published average of sold prices — context only
// An asking price is not a sale; an ad that disappeared is not a sale; a new
// price is never a second-hand price.
//
// FEEDBACK LOOPS. Nothing GetWorth computed may enter as evidence: no estimate,
// no recommended price, no listing whose price GetWorth suggested. Internal
// observations are only the marketplace's qualified completed sales.
// ══════════════════════════════════════════════════════════════════════════════
import { sourceOf, mayIndex, retentionMs, PERMISSION } from './sources.js';

export const SEGMENT = Object.freeze({
  PRIVATE_ASKING: 'private_asking', COMPLETED_SALE: 'completed_sale', REFURBISHED: 'refurbished',
  NEW_RETAIL: 'new_retail', PRICE_GUIDE: 'price_guide',
});
export const SEGMENTS = Object.freeze(Object.values(SEGMENT));
const SEGMENT_OF_KIND = Object.freeze({ used_listing: SEGMENT.PRIVATE_ASKING, sold: SEGMENT.COMPLETED_SALE, refurbished: SEGMENT.REFURBISHED, new_retail: SEGMENT.NEW_RETAIL, price_guide: SEGMENT.PRICE_GUIDE });
/** Segments that are second-hand market evidence; the others are context and never price a used item by themselves. */
export const SECONDHAND_SEGMENTS = Object.freeze([SEGMENT.PRIVATE_ASKING, SEGMENT.COMPLETED_SALE, SEGMENT.REFURBISHED]);

/** Matches that describe THIS product or its declared comparable. Accessories, parts, bundles and other models are not kept. */
const KEEP_MATCH = new Set(['exact', 'close_comparable']);
/** Where a price came from GetWorth itself. Any of these markers excludes a reference. */
const SELF_SOURCES = new Set(['getworth_estimate', 'ai_estimate', 'engine', 'getworth_valuation', 'recommended_price']);

/** True when a reference is something GetWorth computed (or a listing priced by GetWorth), not market evidence. */
export function isSelfGenerated(ref) {
  if (!ref || typeof ref !== 'object') return true;
  if (SELF_SOURCES.has(ref.source) || SELF_SOURCES.has(ref.price_origin)) return true;
  if (ref.price_origin && ref.price_origin !== 'seller') return true;
  const url = String(ref.url ?? '');
  const sale = ref.source === 'getworth_sale' && ref.verification === 'buyer_confirmed' && ref.kind === 'sold';
  // A GetWorth seller's own asking price (the database trigger already excluded prices copied from GetWorth): an ask, never a sale.
  const ask = ref.source === 'getworth_listing' && ref.verification === 'seller_entered' && ref.kind === 'used_listing';
  if (/^getworth:/i.test(url) && !sale && !ask) return true;
  return false;
}

const norm = (s) => String(s ?? '').toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
function fnv1a(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
/** The page, without scheme, www, tracking and fragment: one listing is one page however it was linked. */
export function canonicalUrl(raw) {
  const s = String(raw ?? '').trim();
  if (/^getworth:/i.test(s)) return s.toLowerCase();
  // Parsed by hand: this module reads addresses, it never requests one.
  const m = s.match(/^https?:\/\/([^/?#:]+)(?::\d+)?([^?#]*)(\?[^#]*)?/i);
  if (!m) return null;
  const drop = /^(utm_.*|fbclid|gclid|ref|srsltid)$/i;
  const params = (m[3] ?? '').slice(1).split('&').filter(Boolean).map((kv) => kv.split('=')).filter(([k]) => !drop.test(k)).sort(([a], [b]) => a.localeCompare(b));
  const q = params.length ? `?${params.map(([k, v = '']) => `${k}=${v}`).join('&')}` : '';
  return `${m[1].replace(/^(www|m)\./i, '').toLowerCase()}${m[2].replace(/\/+$/, '')}${q}`;
}

/**
 * One listing, however often it is seen: its page, and on a page that lists many things its own row's title. The price is
 * NOT part of it — a listing whose price changed is the same listing with a new price in its history.
 */
export function fingerprintOf(ref) {
  const page = canonicalUrl(ref?.url);
  if (!page) return null;
  const row = ref?.page === 'listing' ? '' : norm(ref?.title).slice(0, 80);
  return `${fnv1a(`${page}|${row}`)}${fnv1a(`${row}|${page}`)}`;
}

/**
 * A verified reference as an observation, or null with the reason it may not be kept.
 * `researchWindowMs` bounds how long a source without history permission may be kept.
 */
export function toObservation(ref, { productKey, productLabel = null, rulesVersion, seenAt, researchWindowMs }) {
  if (!ref || typeof ref !== 'object') return { observation: null, reason: 'invalid' };
  if (isSelfGenerated(ref)) return { observation: null, reason: 'self_generated' };
  const segment = SEGMENT_OF_KIND[ref.kind];
  if (!segment) return { observation: null, reason: 'not_a_price_kind' };
  if (!KEEP_MATCH.has(ref.match)) return { observation: null, reason: 'not_this_product' };
  const price = Number(ref.price);
  if (!(price > 0) || !Number.isFinite(price)) return { observation: null, reason: 'no_price' };
  const currency = String(ref.currency ?? '').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return { observation: null, reason: 'no_currency' };
  const source = sourceOf(ref.url);
  if (!mayIndex(source)) return { observation: null, reason: 'source_not_authorized' };
  const keepMs = retentionMs(source, researchWindowMs);
  if (!(keepMs > 0)) return { observation: null, reason: 'source_not_authorized' };
  const fingerprint = fingerprintOf(ref);
  if (!fingerprint || !productKey) return { observation: null, reason: 'invalid' };
  const seen = Number.isFinite(seenAt) ? seenAt : Date.now();
  return {
    observation: {
      fingerprint,
      product_key: productKey,
      product_label: productLabel ? String(productLabel).slice(0, 200) : null,
      source_id: source.id,
      permission: source.permission,
      segment,
      market: ref.market === 'IL' ? 'IL' : 'INTL',
      url: String(ref.url).slice(0, 500),
      title: ref.title ? String(ref.title).slice(0, 200) : null,
      condition: ref.condition ?? 'unknown',
      match: ref.match,
      price,
      currency,
      price_ils: Number.isFinite(ref.price_ils) ? ref.price_ils : null,
      listed_on: /^\d{4}-\d{2}-\d{2}$/.test(String(ref.listed ?? '')) ? ref.listed : null,
      archived: ref.archived === true,
      verification: ref.verification ?? null,
      seen_at: new Date(seen).toISOString(),
      retain_until: new Date(seen + keepMs).toISOString(),
      rules_version: rulesVersion,
      reference: ref,
    },
    reason: null,
  };
}

/** Every reference of a research as observations, deduplicated by fingerprint (the first sighting wins), with what was refused. */
export function observationsFrom(refs, opts) {
  const out = new Map();
  const refused = {};
  for (const ref of Array.isArray(refs) ? refs : []) {
    const { observation, reason } = toObservation(ref, opts);
    if (!observation) { refused[reason] = (refused[reason] ?? 0) + 1; continue; }
    if (!out.has(observation.fingerprint)) out.set(observation.fingerprint, observation);
    else refused.duplicate = (refused.duplicate ?? 0) + 1;
  }
  return { observations: [...out.values()], refused };
}

/** A relisted ad: the same seller-written title at the same price on the same site is one listing, kept once. */
export function dedupeRelisted(rows) {
  const seen = new Set();
  return (Array.isArray(rows) ? rows : []).filter((r) => {
    const t = norm(r?.title);
    if (!t) return true;
    const k = `${r.source_id}|${t}|${r.price}|${r.currency}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Is a stored observation still usable for a current price? Not archived, within its retention, read by the current rules. */
export function isCurrent(row, { now = Date.now(), rulesVersion }) {
  if (!row || row.archived === true) return false;
  if (rulesVersion != null && row.rules_version !== rulesVersion) return false;
  const until = Date.parse(row.retain_until ?? '');
  return Number.isFinite(until) && until > now && row.permission !== PERMISSION.NOT_AUTHORIZED;
}
