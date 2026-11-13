// ══════════════════════════════════════════════════════════════════════════════
// CORE SCAN — GENUINE GETWORTH SALES AS ISRAELI EVIDENCE
//
// The database decides which completed sales may stand at all
// (marketplace_sale_evidence, service_role only): a buyer-confirmed final
// price, two genuine accounts (neither admin nor test), a listing priced by its
// seller — never GetWorth's own number — and a core-scan identity saying what
// was sold. This module keeps only the sales of THIS product (the same market
// identity the web research is keyed on: strategy.js marketKey) and turns each
// into one reference the valuation weighs like any other.
//
// What a reference says about itself: an Israeli completed sale ('sold'),
// `verification: 'buyer_confirmed'` — the buyer's word, not a payment record,
// so it does not carry the extra weight a verified sale would (valuation.js).
// It has no public page: its url is an opaque internal reference.
//
// Best effort and bounded: no database, an error or a slow answer is no sales,
// never a failed scan. Nothing about a person is read or kept.
// ══════════════════════════════════════════════════════════════════════════════
import { getServiceClient } from './quota.js';
import { marketKey } from './strategy.js';

export const SALE_SOURCE = 'getworth_sale';
export const SALE_URL_PREFIX = 'getworth:sale:';
export const SALE_LOOKBACK_DAYS = 365;
const SALE_TIMEOUT_MS = 1_500;
/** The marketplace's listing conditions in the scan's condition vocabulary. */
const CONDITION = Object.freeze({ newSealed: 'new_sealed', likeNew: 'like_new', used: 'good', poor: 'poor' });

/** The qualifying sales, or [] — never throws. */
export async function loadMarketplaceSales({ supa = getServiceClient(), now = Date.now(), timeoutMs = SALE_TIMEOUT_MS } = {}) {
  if (!supa) return [];
  const since = new Date(now - SALE_LOOKBACK_DAYS * 864e5).toISOString();
  try {
    const result = await Promise.race([
      supa.rpc('marketplace_sale_evidence', { p_since: since }),
      new Promise((resolve) => { setTimeout(() => resolve({ error: { message: 'timeout' } }), timeoutMs); }),
    ]);
    if (result?.error) { console.warn('[Scan] marketplace sales unavailable:', result.error.message); return []; }
    return Array.isArray(result?.data) ? result.data : [];
  } catch (err) {
    console.warn('[Scan] marketplace sales unavailable:', err?.message);
    return [];
  }
}

/** The sales of this product, as valuation references. One per sale; a row that does not say what it sold is skipped. */
export function salesEvidenceFor(identity, rows, { today = new Date().toISOString().slice(0, 10) } = {}) {
  if (!identity || !Array.isArray(rows) || rows.length === 0) return [];
  const key = marketKey(identity);
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const ref = typeof row?.sale_ref === 'string' && /^[0-9a-f]{8,32}$/.test(row.sale_ref) ? row.sale_ref : null;
    const price = Number(row?.final_price);
    if (!ref || seen.has(ref) || !(price > 0) || row?.verification !== 'buyer_confirmed') continue;
    if (!row.identity || typeof row.identity !== 'object' || marketKey(row.identity) !== key) continue;
    seen.add(ref);
    out.push({
      url: `${SALE_URL_PREFIX}${ref}`,
      domain: 'getworth',
      title: String(row.identity.display_name ?? '').slice(0, 120) || null,
      price, currency: 'ILS', price_ils: price,
      kind: 'sold', match: 'exact', market: 'IL',
      condition: CONDITION[row.condition] ?? 'unknown',
      page: 'listing',
      listed: String(row.completed_at ?? '').slice(0, 10) || null,
      binding: 'verified_row',
      seen: today,
      source: SALE_SOURCE,
      verification: 'buyer_confirmed',
    });
  }
  return out;
}

// ══════════════════════════════════════════════════════════════════════════════
// GENUINE GETWORTH ASKING PRICES (2026-11-13)
//
// marketplace_listing_evidence (service_role only) returns the active listings whose price the SELLER set — the database
// trigger marks a price within 2% / ₪5 of any number GetWorth showed as 'getworth_valuation', never evidence — from genuine
// accounts, one per seller per product. Each becomes an Israeli PRIVATE ASKING price of the same class as a Homeless ad:
// kind used_listing, never 'sold'. A listing is not a sale until a buyer confirms one (the sale evidence above).
// ══════════════════════════════════════════════════════════════════════════════
export const LISTING_SOURCE = 'getworth_listing';
export const LISTING_URL_PREFIX = 'getworth:listing:';
export const LISTING_LOOKBACK_DAYS = 120;

/** The qualifying listings, or [] — never throws. */
export async function loadMarketplaceListings({ supa = getServiceClient(), now = Date.now(), timeoutMs = SALE_TIMEOUT_MS } = {}) {
  if (!supa) return [];
  const since = new Date(now - LISTING_LOOKBACK_DAYS * 864e5).toISOString();
  try {
    const result = await Promise.race([
      supa.rpc('marketplace_listing_evidence', { p_since: since }),
      new Promise((resolve) => { setTimeout(() => resolve({ error: { message: 'timeout' } }), timeoutMs); }),
    ]);
    if (result?.error) { console.warn('[Scan] marketplace listings unavailable:', result.error.message); return []; }
    return Array.isArray(result?.data) ? result.data : [];
  } catch (err) {
    console.warn('[Scan] marketplace listings unavailable:', err?.message);
    return [];
  }
}

/** The asking prices of this product, as valuation references. One per listing reference; anything unidentified is skipped. */
export function listingEvidenceFor(identity, rows, { today = new Date().toISOString().slice(0, 10) } = {}) {
  if (!identity || !Array.isArray(rows) || rows.length === 0) return [];
  const key = marketKey(identity);
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const ref = typeof row?.listing_ref === 'string' && /^[0-9a-f]{8,32}$/.test(row.listing_ref) ? row.listing_ref : null;
    const price = Number(row?.price);
    if (!ref || seen.has(ref) || !(price > 0)) continue;
    if (!row.identity || typeof row.identity !== 'object' || marketKey(row.identity) !== key) continue;
    seen.add(ref);
    out.push({
      url: `${LISTING_URL_PREFIX}${ref}`,
      domain: 'getworth',
      title: String(row.identity.display_name ?? '').slice(0, 120) || null,
      price, currency: 'ILS', price_ils: price,
      kind: 'used_listing', match: 'exact', market: 'IL',
      condition: CONDITION[row.condition] ?? 'unknown',
      page: 'listing',
      listed: String(row.created_at ?? '').slice(0, 10) || null,
      binding: 'verified_row',
      seen: today,
      source: LISTING_SOURCE,
      verification: 'seller_entered',
    });
  }
  return out;
}
