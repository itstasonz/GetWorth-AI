// ══════════════════════════════════════════════════════════════════════════════
// MARKET DATA LAYER — THE MARKET EVIDENCE CACHE (interface; persistence staged)
//
// What is cached is OBSERVATIONS, normalised and qualified, with the time each
// was observed — never only a price. A later scan of the same product can
// reproduce the valuation from them, and a reader can see why.
//
// ── THREE RULES ─────────────────────────────────────────────────────────────
//
//   1. The key is the CANONICAL MARKET IDENTITY: brand and the exact model
//      number the results corroborated, or failing that the read name; plus
//      the market. A read name and its market name share one entry once the
//      number is known.
//   2. A cached observation keeps its `observed_at` and is marked CACHED. It
//      is context: it may inform an estimate and the calibration dataset; it
//      never counts toward a VERIFIED state on its own (the orchestrator
//      requires a fresh completed retrieval for that).
//   3. Entries expire. An expired entry is returned as such (`expired: true`)
//      so a reader can see what was known, and is never served as current.
//
// The store is pluggable: the default is in-memory (per server instance). A
// durable store (a `market_listings` table) is a schema change and is staged
// behind the same interface: { get(key), set(key, value), delete(key) }.
// ══════════════════════════════════════════════════════════════════════════════
import { FRESHNESS } from './observation.js';

export const CACHE_VERSION = 1;
export const CACHE_TTL_MS = 72 * 60 * 60 * 1000;

const tokens = (v) => String(v ?? '').normalize('NFKC').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** The key for a product in a market. Exact numbers win over read names. */
export function cacheKeyFor({ identity = null, market = 'IL', exactRoots = [] } = {}) {
  const brand = tokens(identity?.brand?.value).join('-');
  const root = [...(Array.isArray(exactRoots) ? exactRoots : [])].sort()[0]
    ?? tokens(identity?.model_number?.value).join('');
  const name = root ? root.toLowerCase() : tokens(identity?.model?.value).join('-');
  if (!brand && !name) return null;
  return `v${CACHE_VERSION}|${String(market ?? '').toUpperCase()}|${brand || '-'}|${name || '-'}`;
}

/** The default store: a Map with the store interface. */
export function memoryStore() {
  const m = new Map();
  return {
    async get(key) { return m.has(key) ? m.get(key) : null; },
    async set(key, value) { m.set(key, value); },
    async delete(key) { m.delete(key); },
    size() { return m.size; },
  };
}

/**
 * The cache. `get` marks every observation it returns as CACHED and keeps the
 * observation's own `observed_at`; `put` stores observations with the
 * provenance of the run that produced them.
 */
export function createMarketEvidenceCache({ store = memoryStore(), ttlMs = CACHE_TTL_MS, now = Date.now } = {}) {
  const stats = { hits: 0, misses: 0, expired: 0, puts: 0 };
  return {
    keyFor: cacheKeyFor,
    ttl_ms: ttlMs,
    stats: () => ({ ...stats }),
    async get(key) {
      if (!key) { stats.misses += 1; return { hit: false, expired: false, key, observations: [], stored_at: null }; }
      const entry = await store.get(key);
      if (!entry) { stats.misses += 1; return { hit: false, expired: false, key, observations: [], stored_at: null }; }
      const expired = now() - new Date(entry.stored_at).getTime() > ttlMs;
      if (expired) stats.expired += 1; else stats.hits += 1;
      return {
        hit: !expired, expired, key, stored_at: entry.stored_at, provenance: entry.provenance ?? null,
        observations: (entry.observations ?? []).map((o) => ({
          ...o, from_cache: true, freshness: FRESHNESS.CACHED, cached_at: entry.stored_at,
          // A cached observation never carries a live qualification: it is re-qualified, or it is context.
          qualification_state: 'CONTEXT',
        })),
      };
    },
    async put(key, observations, { provenance = null } = {}) {
      if (!key || !Array.isArray(observations)) return false;
      const stored = observations.filter((o) => o && o.observed_at && o.price).map((o) => ({ ...o, from_cache: false }));
      await store.set(key, { version: CACHE_VERSION, key, stored_at: new Date(now()).toISOString(), provenance, observations: stored });
      stats.puts += 1;
      return true;
    },
    async invalidate(key) { if (key) await store.delete(key); },
  };
}
