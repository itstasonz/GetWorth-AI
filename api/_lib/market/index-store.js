// ══════════════════════════════════════════════════════════════════════════════
// MARKET INDEX — THE STORED OBSERVATIONS, BY PRODUCT
//
// public.market_observations (one row per listing per product, its sightings in
// public.market_observation_prices) through the server's own database role.
// Keyed by the PRODUCT (strategy.js marketKey: name, capacity, configuration,
// confirmed attributes, model number) — not by the words of a search — so two
// identifications of the same product that phrase it differently read the same
// evidence.
//
// Best effort and bounded, like every scan write: no database, an error or a
// slow answer is "nothing indexed", never a failed scan.
// ══════════════════════════════════════════════════════════════════════════════
import { getServiceClient } from '../scan/quota.js';
import { marketKey } from '../scan/strategy.js';
import { marketKeyHash } from '../scan/persist.js';
import { MARKET_POOL_MS } from '../scan/config.js';
import { observationsFrom, isCurrent, dedupeRelisted } from './observations.js';

export const READ_TIMEOUT_MS = 900;
const WRITE_TIMEOUT_MS = 2_500;
export const MAX_INDEXED_READ = 60;

const bounded = (promise, ms) => Promise.race([
  promise,
  new Promise((resolve) => { setTimeout(() => resolve({ error: { message: 'timeout' } }), ms); }),
]);

export async function productKeyOf(identity, answer = null) {
  const label = marketKey(identity, answer);
  return { key: await marketKeyHash(`product:${label}`), label };
}

/**
 * The current observations for a product: { rows, ms, error }. Rows carry `reference` (the verified reference as the
 * valuation reads it) and `last_seen_at`. Never throws.
 */
export async function loadIndexed(identity, answer, { supa = getServiceClient(), now = Date.now(), rulesVersion, timeoutMs = READ_TIMEOUT_MS } = {}) {
  const t0 = Date.now();
  if (!supa || !identity) return { rows: [], ms: 0, error: supa ? null : 'no_database' };
  try {
    const { key } = await productKeyOf(identity, answer);
    const { data, error } = await bounded(supa.from('market_observations')
      .select('fingerprint, source_id, permission, segment, market, title, price, currency, archived, rules_version, retain_until, last_seen_at, reference')
      .eq('product_key', key).gt('retain_until', new Date(now).toISOString())
      .order('last_seen_at', { ascending: false }).limit(MAX_INDEXED_READ), timeoutMs);
    if (error) return { rows: [], ms: Date.now() - t0, error: String(error.message ?? 'error').slice(0, 80) };
    const rows = dedupeRelisted((Array.isArray(data) ? data : []).filter((r) => isCurrent(r, { now, rulesVersion }) && r.reference && typeof r.reference === 'object'));
    return { rows, ms: Date.now() - t0, error: null };
  } catch (err) { return { rows: [], ms: Date.now() - t0, error: String(err?.message ?? 'error').slice(0, 80) }; }
}

/** Index a research's verified references. Resolves to { stored, refused } — never throws. */
export async function saveIndexed(identity, answer, refs, { supa = getServiceClient(), seenAt = Date.now(), rulesVersion, researchWindowMs = MARKET_POOL_MS } = {}) {
  if (!supa || !identity) return { stored: 0, refused: {} };
  try {
    const { key, label } = await productKeyOf(identity, answer);
    const { observations, refused } = observationsFrom(refs, { productKey: key, productLabel: label, rulesVersion, seenAt, researchWindowMs });
    if (!observations.length) return { stored: 0, refused };
    const { data, error } = await bounded(supa.rpc('record_market_observations', { p_rows: observations }), WRITE_TIMEOUT_MS);
    if (error) { console.warn('[Index] observations not stored:', error.message); return { stored: 0, refused }; }
    return { stored: Number(data) || observations.length, refused };
  } catch (err) { console.warn('[Index] observations not stored:', err?.message); return { stored: 0, refused: {} }; }
}

/** Delete observations past their retention. Resolves to the number removed, or null. Never throws. */
export async function purgeExpired({ supa = getServiceClient() } = {}) {
  if (!supa) return null;
  try {
    const { data, error } = await bounded(supa.rpc('purge_market_observations'), 10_000);
    if (error) { console.warn('[Index] purge failed:', error.message); return null; }
    return Number(data) || 0;
  } catch (err) { console.warn('[Index] purge failed:', err?.message); return null; }
}

/** The store the scan uses, as one injectable object. */
export const defaultIndex = Object.freeze({ load: loadIndexed, save: saveIndexed });
/** An index that holds nothing: for the suites and when the feature is switched off. */
export const nullIndex = Object.freeze({ load: async () => ({ rows: [], ms: 0, error: null }), save: async () => ({ stored: 0, refused: {} }) });
