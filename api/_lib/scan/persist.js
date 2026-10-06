// ══════════════════════════════════════════════════════════════════════════════
// CORE SCAN — WHAT A SCAN LEAVES BEHIND
//
// All through the server's own database role, and all best effort: a scan that
// answered the person is never failed by a row that did not land.
//
//   valuations   one row per priced (or honestly unpriced) scan, through the
//                existing `record_scan` function. It is what a listing links
//                to, and where the owner's correction is kept.
//   scan_events  one row per priced scan with the measured timings, so "how
//                long does a scan take" is answered by the scans themselves;
//                and one row per market research with its qualified evidence,
//                which is the SHARED market cache: the next scan of the same
//                item, on any server instance, reads it back instead of
//                searching again. No new table: an event log is what this is.
//
// No photograph is stored here, and no token.
// ══════════════════════════════════════════════════════════════════════════════
import { getServiceClient } from './quota.js';
import { DEFAULT_CONDITION } from './config.js';

/** The core scan writes its own valuation version, so its rows can be told from the older engine's. */
export const VALUATION_VERSION = 3;
export const PRICE_METHOD = 'core_scan_web';
const WRITE_TIMEOUT_MS = 2_500;
const CONFIDENCE_SCORE = { high: 0.9, medium: 0.7, low: 0.4 };

const bounded = (promise, ms = WRITE_TIMEOUT_MS) => Promise.race([
  promise,
  new Promise((resolve) => { setTimeout(() => resolve({ error: { message: 'timeout' } }), ms); }),
]);

// ── THE SHARED MARKET CACHE ─────────────────────────────────────────────────
export const MARKET_EVENT = 'core_scan_market';
const READ_TIMEOUT_MS = 1_500;
/** A market identity as a short fixed-length key the event log can be filtered on. */
export async function marketKeyHash(key) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(key)));
  return Buffer.from(digest).toString('hex').slice(0, 40);
}

/** The most recent stored research for a market identity, or null. Never throws. */
export async function loadMarketResearch(key, { supa = getServiceClient() } = {}) {
  if (!supa) return null;
  try {
    const { data, error } = await bounded(supa.from('scan_events').select('payload')
      .eq('event_type', MARKET_EVENT).eq('payload->>key', await marketKeyHash(key))
      .order('created_at', { ascending: false }).limit(1), READ_TIMEOUT_MS);
    const record = !error && Array.isArray(data) ? data[0]?.payload?.record : null;
    return record && typeof record === 'object' ? record : null;
  } catch { return null; }
}

/** Keep a market research: the item's key, its readable identity, the evidence and when it was gathered. */
export async function saveMarketResearch(key, record, scanUuid, { supa = getServiceClient() } = {}) {
  if (!supa || !scanUuid) return;
  try {
    const { error } = await bounded(supa.from('scan_events').insert({
      scan_uuid: scanUuid, event_type: MARKET_EVENT, stage: 'core_scan',
      payload: { key: await marketKeyHash(key), market_identity: String(key).slice(0, 200), record },
    }));
    if (error) console.warn('[Scan] market research not stored:', error.message);
  } catch (err) { console.warn('[Scan] market research not stored:', err?.message); }
}

/** The valuations row for a scan. Prices are numbers only when the scan priced; never 0. */
export function buildValuationRow({ id, userId, scanUuid, identity, valuation, lang }) {
  const band = valuation?.status === 'priced' ? valuation.prices?.[DEFAULT_CONDITION] ?? null : null;
  return {
    id,
    user_id: userId,
    scan_uuid: scanUuid,
    valuation_version: VALUATION_VERSION,
    product_id: null,
    ai_name: identity?.display_name || 'Unknown',
    ai_name_hebrew: identity?.search?.hebrew_name || '',
    ai_category: identity?.category || 'Other',
    ai_confidence: CONFIDENCE_SCORE[identity?.identity_confidence] ?? 0,
    ai_raw_response: {
      engine: 'core_scan',
      identity,
      valuation: valuation ? {
        status: valuation.status, prices: valuation.prices, price_confidence: valuation.price_confidence,
        approximate: valuation.approximate, basis: valuation.basis, withdrawn: valuation.withdrawn, counts: valuation.counts,
        local_strength: valuation.local_strength, dispersion: valuation.dispersion, reference_range: valuation.reference_range,
        retail_new_ils: valuation.retail_new_ils, retail_new_in_stock: valuation.retail_new_in_stock, intl_scale: valuation.intl_scale, searched: valuation.searched,
        sources: (valuation.evidence ?? []).slice(0, 16).map((e) => ({ url: e.url, price: e.price, currency: e.currency, kind: e.kind, match: e.match, market: e.market, condition: e.condition, page: e.page, listed: e.listed, archived: e.archived === true, freshness: e.freshness, weight: e.weight, used: e.used, binding: e.binding, binding_reason: e.binding_reason, stock: e.stock, shipping: e.shipping })),
      } : null,
    },
    ocr_text: (identity?.visible_text ?? []).join(' ').slice(0, 500) || null,
    model_number: identity?.model_number ?? null,
    identified_by: identity?.owner_stated ? 'user_correction' : 'visual',
    alternatives: identity?.alternatives ?? [],
    price_low: band ? band.low : null,
    price_mid: band ? Math.round((band.low + band.high) / 2) : null,
    price_high: band ? band.high : null,
    new_retail: valuation?.retail_new_ils ?? null,
    price_method: band ? PRICE_METHOD : 'manual_required',
    comp_count: valuation?.counts?.resale ?? 0,
    lang,
  };
}

/** Record the scan's valuation. Resolves to the row id, or null when it did not land. */
export async function recordValuation(args, { supa = getServiceClient() } = {}) {
  if (!supa || !args?.userId) return null;
  const id = crypto.randomUUID();
  try {
    const { error } = await bounded(supa.rpc('record_scan', { p_valuation: buildValuationRow({ ...args, id }) }));
    if (error) { console.warn('[Scan] valuation not recorded:', error.message); return null; }
    return id;
  } catch (err) { console.warn('[Scan] valuation not recorded:', err?.message); return null; }
}

/** One scan_events row. Durations and outcomes only. */
export async function logScanEvent(scanUuid, eventType, payload, { supa = getServiceClient() } = {}) {
  if (!supa) return;
  try {
    const { error } = await bounded(supa.from('scan_events').insert({ scan_uuid: scanUuid, event_type: eventType, stage: 'core_scan', payload }));
    if (error) console.warn('[Scan] event not recorded:', error.message);
  } catch (err) { console.warn('[Scan] event not recorded:', err?.message); }
}
