// ══════════════════════════════════════════════════════════════════════════════
// MARKET DATA LAYER — THE NORMALISED MARKET OBSERVATION
//
// One shape for every price GetWorth has ever seen, whichever provider saw
// it. A search excerpt, an eBay API row and a cached listing all become this,
// and nothing downstream reads a provider's own field names again.
//
// ── FIVE THINGS THAT ARE NOT THE SAME ───────────────────────────────────────
//
//   a RETRIEVAL      one provider, one profile, one request that returned it
//   an ORIGIN        the site the listing lives on (registrable domain)
//   a LISTING        one advert, identified by the strongest key its origin gives
//   an OBSERVATION   that listing, seen once, with a price, at a time
//   a SOURCE         an origin counted once in the diversity floor
//
// Ten results from two search profiles pointing at one yad2 advert are ten
// retrievals of ONE observation from ONE origin. The dedupe module folds them;
// this module gives each observation the fields that make folding possible.
//
// Total: `normalizeObservation` accepts any partial and yields a well-formed
// observation; an absent field is null, never a default that looks like data.
// ══════════════════════════════════════════════════════════════════════════════
import { sourceSite } from '../../source-site.js';
import { canonicalListingUrl, listingIdFromUrl } from '../../listing-identity.js';
import { RELATION } from '../market-identity.js';
import { CONFIGURATION } from '../configuration.js';

/** How a listing relates to the photographed item. Superset of market-identity's RELATION. */
export const RELATION_KIND = Object.freeze({
  EXACT_PRODUCT: 'EXACT_PRODUCT', REGIONAL_VARIANT: 'REGIONAL_VARIANT', SIBLING_MODEL: 'SIBLING_MODEL',
  FAMILY: 'FAMILY', ACCESSORY: 'ACCESSORY', PART: 'PART', BUNDLE: 'BUNDLE', OTHER_PRODUCT: 'OTHER_PRODUCT', UNKNOWN: 'UNKNOWN',
});
/** What is being sold. Superset of configuration.js's CONFIGURATION, with the product-order names. */
export const CONFIGURATION_KIND = Object.freeze({
  COMPLETE_PRODUCT: 'COMPLETE_PRODUCT', BASE_ONLY: 'BASE_ONLY', ACCESSORY_ONLY: 'ACCESSORY_ONLY', BOX_ONLY: 'BOX_ONLY',
  PART: 'PART', PARTS: 'PARTS', BUNDLE: 'BUNDLE', UNKNOWN: 'UNKNOWN',
});
export const PRICE_TYPE = Object.freeze({ ASKING: 'ASKING', SOLD: 'SOLD', RETAIL: 'RETAIL', UNKNOWN: 'UNKNOWN' });
export const LISTING_STATUS = Object.freeze({ ACTIVE: 'ACTIVE', SOLD: 'SOLD', ENDED: 'ENDED', UNKNOWN: 'UNKNOWN' });
export const SALE_TYPE = Object.freeze({ CLASSIFIED: 'CLASSIFIED', FIXED_PRICE: 'FIXED_PRICE', AUCTION: 'AUCTION', RETAIL: 'RETAIL', UNKNOWN: 'UNKNOWN' });
export const FRESHNESS = Object.freeze({ LIVE: 'LIVE', RECENT: 'RECENT', STALE: 'STALE', CACHED: 'CACHED', UNKNOWN: 'UNKNOWN' });
export const QUALIFICATION = Object.freeze({ ADMITTED: 'ADMITTED', ANCHOR: 'ANCHOR', CONTEXT: 'CONTEXT', REJECTED: 'REJECTED', PENDING: 'PENDING' });

const RELATION_MAP = Object.freeze({
  [RELATION.EXACT]: RELATION_KIND.EXACT_PRODUCT, [RELATION.REGIONAL_VARIANT]: RELATION_KIND.REGIONAL_VARIANT,
  [RELATION.SIBLING]: RELATION_KIND.SIBLING_MODEL, [RELATION.FAMILY]: RELATION_KIND.FAMILY,
  [RELATION.OTHER_PRODUCT]: RELATION_KIND.OTHER_PRODUCT, [RELATION.UNVERIFIED]: RELATION_KIND.UNKNOWN,
});
const CONFIGURATION_MAP = Object.freeze({
  [CONFIGURATION.COMPLETE]: CONFIGURATION_KIND.COMPLETE_PRODUCT, [CONFIGURATION.BASE_ONLY]: CONFIGURATION_KIND.BASE_ONLY,
  [CONFIGURATION.ACCESSORY_ONLY]: CONFIGURATION_KIND.ACCESSORY_ONLY, [CONFIGURATION.BOX_ONLY]: CONFIGURATION_KIND.BOX_ONLY,
  [CONFIGURATION.REPLACEMENT_PART]: CONFIGURATION_KIND.PART, [CONFIGURATION.BUNDLE]: CONFIGURATION_KIND.BUNDLE,
  [CONFIGURATION.PARTS]: CONFIGURATION_KIND.PARTS, [CONFIGURATION.UNKNOWN]: CONFIGURATION_KIND.UNKNOWN,
});

const str = (v, max = 200) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
const oneOf = (v, table, fallback) => (Object.values(table).includes(v) ? v : fallback);
const iso = (v) => { const d = v instanceof Date ? v : (v ? new Date(v) : null); return d && !Number.isNaN(d.getTime()) ? d.toISOString() : null; };

/**
 * The relation of a listing to the item: the market-identity relation, refined
 * by what the listing sells. A part or accessory of the exact product is an
 * ACCESSORY / PART relation, not an exact comparable.
 */
export function relationKindOf(relation, configuration) {
  const base = RELATION_MAP[relation] ?? RELATION_KIND.UNKNOWN;
  if (base !== RELATION_KIND.EXACT_PRODUCT && base !== RELATION_KIND.REGIONAL_VARIANT) return base;
  if (configuration === CONFIGURATION.ACCESSORY_ONLY) return RELATION_KIND.ACCESSORY;
  if (configuration === CONFIGURATION.REPLACEMENT_PART) return RELATION_KIND.PART;
  if (configuration === CONFIGURATION.BUNDLE) return RELATION_KIND.BUNDLE;
  return base;
}

/** How fresh an observation is, from its timestamp and `now`. */
export function freshnessOf(observedAt, now = Date.now(), { cached = false } = {}) {
  if (cached) return FRESHNESS.CACHED;
  const t = observedAt ? new Date(observedAt).getTime() : NaN;
  if (Number.isNaN(t)) return FRESHNESS.UNKNOWN;
  const age = now - t;
  if (age <= 7 * 24 * 3600 * 1000) return FRESHNESS.LIVE;
  if (age <= 60 * 24 * 3600 * 1000) return FRESHNESS.RECENT;
  return FRESHNESS.STALE;
}

/**
 * The strongest identity a listing has, for deduplication. In order: the id
 * its origin gave it, the id in its URL, the canonical URL itself. The key is
 * namespaced by ORIGIN SITE, never by retrieval provider: the same advert
 * returned by two providers has one key.
 */
export function listingKeyOf({ origin_site, listing_id, canonical_url }) {
  const site = origin_site ?? 'unknown';
  if (listing_id) return `id:${site}|${String(listing_id).toLowerCase()}`;
  if (canonical_url) return `url:${canonical_url}`;
  return null;
}

/**
 * Build one observation. Every field is read defensively; provider-specific
 * data stays in `raw_ref`, which valuation never reads.
 */
export function normalizeObservation(raw = {}) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const url = str(o.url ?? o.canonical_url, 500);
  const canonical = canonicalListingUrl(url) ?? null;
  const originDomain = str(o.origin_domain, 120) ?? (url ? url.replace(/^https?:\/\//i, '').split(/[/?#]/)[0].toLowerCase() : null);
  const originSite = sourceSite(originDomain) ?? null;
  // The id in the URL first: it is the one every provider that saw the same
  // page agrees on (eBay's own `v1|<id>|0` and its URL's bare id are one
  // advert). The provider's own id is kept beside it as `provider_result_id`.
  const listingId = listingIdFromUrl(url) ?? str(o.listing_id, 64) ?? null;
  const configuration = oneOf(o.configuration_kind, CONFIGURATION_KIND, CONFIGURATION_MAP[o.configuration] ?? CONFIGURATION_KIND.UNKNOWN);
  const relation = oneOf(o.relation_kind, RELATION_KIND, relationKindOf(o.relation, o.configuration));
  const observedAt = iso(o.observed_at);
  const retrievals = Array.isArray(o.retrievals) ? o.retrievals.filter(Boolean) : [];
  const provider = str(o.provider, 60) ?? retrievals[0]?.provider ?? null;
  return {
    // who retrieved it, and from where
    provider,
    provider_result_id: str(o.provider_result_id, 120),
    retrievals: retrievals.length ? retrievals : (provider ? [{ provider, profile: str(o.profile, 40) ?? null, request_id: str(o.request_id, 80) ?? null }] : []),
    origin_domain: originDomain,
    origin_site: originSite,
    canonical_url: canonical,
    url,
    source_type: str(o.source_type, 40) ?? 'UNKNOWN',
    market: str(o.market, 8),
    country: str(o.country, 8),
    locale: str(o.locale, 16) ?? 'international',
    // what it says
    title: str(o.title, 220),
    snippet: str(o.snippet, 400),
    seller_ref: str(o.seller_ref, 80),
    listing_id: listingId,
    listing_key: listingKeyOf({ origin_site: originSite, listing_id: listingId, canonical_url: canonical }),
    // what it is
    canonical_identity: {
      brand: str(o.canonical_identity?.brand, 60), model: str(o.canonical_identity?.model, 80),
      model_number: str(o.canonical_identity?.model_number, 40), variant: str(o.canonical_identity?.variant, 60),
      capacity: str(o.canonical_identity?.capacity, 30), color: str(o.canonical_identity?.color, 30),
    },
    relation,
    configuration,
    condition: str(o.condition, 40),
    listing_status: oneOf(o.listing_status, LISTING_STATUS, LISTING_STATUS.UNKNOWN),
    sale_type: oneOf(o.sale_type, SALE_TYPE, SALE_TYPE.UNKNOWN),
    // what it costs
    price: num(o.price),
    currency: str(o.currency, 8)?.toUpperCase() ?? null,
    currency_basis: str(o.currency_basis, 20) ?? 'marker',
    shipping: num(o.shipping?.amount) ? { amount: o.shipping.amount, currency: str(o.shipping.currency, 8)?.toUpperCase() ?? null } : null,
    total_price_if_known: num(o.total_price_if_known),
    price_type: oneOf(o.price_type, PRICE_TYPE, PRICE_TYPE.UNKNOWN),
    converted: o.converted && typeof o.converted === 'object' ? { ...o.converted } : null,
    // when
    listed_at: iso(o.listed_at),
    observed_at: observedAt,
    freshness: oneOf(o.freshness, FRESHNESS, freshnessOf(observedAt, o.now ?? Date.now(), { cached: o.from_cache === true })),
    from_cache: o.from_cache === true,
    // how sure
    identity_confidence: typeof o.identity_confidence === 'number' ? Math.min(1, Math.max(0, o.identity_confidence)) : null,
    extraction_confidence: str(o.extraction_confidence, 12) ?? 'unknown',
    // what became of it
    qualification_state: oneOf(o.qualification_state, QUALIFICATION, QUALIFICATION.PENDING),
    tier: str(o.tier, 40),
    rejection_reason: str(o.rejection_reason, 120),
    // where to look
    raw_ref: str(o.raw_ref, 200),
    provenance: {
      provider, profile: str(o.profile, 40) ?? retrievals[0]?.profile ?? null,
      request_id: str(o.request_id, 80) ?? retrievals[0]?.request_id ?? null, retrieved_at: iso(o.retrieved_at) ?? observedAt,
    },
  };
}

/**
 * An observation from one of V2's labelled extraction entries (evidence.js):
 * the adapter for the search provider's excerpts.
 */
export function observationFromEntry(entry, { provider, profile = null, request_id = null, market = null, now = Date.now() } = {}) {
  const o = entry.observation;
  const retail = entry.kind === 'new_retail';
  return normalizeObservation({
    provider, profile, request_id,
    url: o.source, origin_domain: o.source_domain,
    source_type: entry.source_type, locale: entry.locale, market: entry.locale === 'local' ? market : null,
    title: o.title, snippet: null, listing_id: o.listing_id_or_reference ?? null,
    canonical_identity: { brand: entry.canonical_brand ?? null, model: entry.canonical_model ?? null, model_number: entry.canonical_model_number ?? null },
    relation: entry.relation, configuration: entry.configuration,
    condition: o.condition ?? null,
    listing_status: entry.kind === 'used_listing' ? LISTING_STATUS.ACTIVE : LISTING_STATUS.UNKNOWN,
    sale_type: retail ? SALE_TYPE.RETAIL : (entry.kind === 'used_listing' ? SALE_TYPE.CLASSIFIED : SALE_TYPE.UNKNOWN),
    price: o.observed_price, currency: o.currency, currency_basis: entry.currency_basis,
    price_type: retail ? PRICE_TYPE.RETAIL : (entry.kind === 'used_listing' ? PRICE_TYPE.ASKING : PRICE_TYPE.UNKNOWN),
    observed_at: now, retrieved_at: now,
    extraction_confidence: entry.currency_basis === 'site_locale' ? 'low' : (entry.row_bound || entry.binding === 'table_row' ? 'medium' : 'high'),
    identity_confidence: entry.relation === RELATION.EXACT ? 0.9 : (entry.relation === RELATION.REGIONAL_VARIANT ? 0.7 : (entry.relation === 'UNKNOWN' ? 0.2 : 0)),
    qualification_state: entry.admitted ? QUALIFICATION.ADMITTED : (entry.retail_anchor ? QUALIFICATION.ANCHOR
      : (entry.tier && !entry.admitted ? QUALIFICATION.CONTEXT : QUALIFICATION.REJECTED)),
    tier: entry.tier ?? null,
    rejection_reason: entry.reason ?? null,
    raw_ref: `page#${entry.page_index}`,
  });
}
