// ══════════════════════════════════════════════════════════════════════════════
// MARKET DATA LAYER — DEDUPLICATION AND SOURCE INDEPENDENCE
//
// Ten results pointing at one advert are one observation. Two search profiles
// of one provider are two retrievals, not two sources. Two sellers on one site
// asking the same round price are two listings. The rules, in order of
// strength, and a fallback that is deliberately conservative:
//
//   1. provider listing id, namespaced by ORIGIN SITE       id:<site>|<id>
//   2. canonical URL (device subdomain, tracking removed)   url:<canonical>
//   3. origin site + the id in the URL                      (same as 1, derived)
//   4. FINGERPRINT, only when 1–3 are absent: origin site + normalised title
//      + price + currency + configuration (+ seller when both have one, which
//      must then agree). The same product at the same price with a DIFFERENT
//      title, or a different seller, stays two listings.
//
// Syndication across sites (the same advert re-posted by an aggregator) is
// recorded, not merged — and only on a SELLER or LISTING-ID signal: the same
// words, price and configuration on two origins, from the same seller
// reference or under the same listing id, marks the later one
// `syndicated_from`, and the independence count treats the pair as one
// origin. The same words and price alone are what two honest sellers of one
// product write, and they stay two origins.
// ══════════════════════════════════════════════════════════════════════════════
import { QUALIFICATION } from './observation.js';

const norm = (v) => String(v ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** The dedupe key of an observation, and how strong it is. */
export function dedupeKeyOf(o) {
  if (o.listing_key) return { key: o.listing_key, method: o.listing_key.startsWith('id:') ? 'listing_id' : 'canonical_url' };
  const title = norm(o.title).slice(0, 80);
  if (!o.origin_site || !title || !o.price || !o.currency) return { key: null, method: 'none' };
  const seller = o.seller_ref ? `|s:${norm(o.seller_ref)}` : '';
  return { key: `fp:${o.origin_site}|${title}|${o.price}|${o.currency}|${o.configuration}${seller}`, method: 'fingerprint' };
}

/** A syndication key: the advert's words, price and its seller or id, without its origin. Null without a seller or id. */
const syndicationKey = (o) => {
  const title = norm(o.title).slice(0, 80);
  const who = o.seller_ref ? `s:${norm(o.seller_ref)}` : (o.listing_id ? `l:${String(o.listing_id).toLowerCase()}` : null);
  if (!title || !o.price || !o.currency || !who) return null;
  return `syn:${o.market ?? ''}|${title}|${o.price}|${o.currency}|${o.configuration}|${who}`;
};

/**
 * Fold duplicates. Returns { unique, duplicates, counts }. Each unique
 * observation carries every retrieval that returned it and the number of
 * duplicates folded into it; the first-seen observation is kept (earliest
 * `observed_at`, then input order).
 */
export function dedupeObservations(observations, { rawResultCount = null } = {}) {
  const list = Array.isArray(observations) ? observations.filter(Boolean) : [];
  const byKey = new Map();
  const unique = [];
  const duplicates = [];
  for (const o of list) {
    const { key, method } = dedupeKeyOf(o);
    const retrieval = o.retrievals?.[0] ?? (o.provider ? { provider: o.provider, profile: o.provenance?.profile ?? null } : null);
    if (key && byKey.has(key)) {
      const kept = byKey.get(key);
      if (retrieval && !kept.retrievals.some((r) => r.provider === retrieval.provider && r.profile === retrieval.profile && r.request_id === retrieval.request_id)) {
        kept.retrievals.push(retrieval);
      }
      kept.duplicates_folded += 1;
      duplicates.push({ key, method, provider: o.provider, url: o.url, folded_into: kept.listing_key ?? key });
      continue;
    }
    const copy = { ...o, retrievals: [...(o.retrievals ?? (retrieval ? [retrieval] : []))], dedupe_key: key, dedupe_method: method, duplicates_folded: 0, syndicated_from: null };
    if (key) byKey.set(key, copy);
    unique.push(copy);
  }
  // Syndication: same words and price on two origins. Recorded, never merged.
  const seenSyn = new Map();
  for (const o of unique) {
    const k = syndicationKey(o);
    if (!k) continue;
    const first = seenSyn.get(k);
    if (first && first.origin_site !== o.origin_site) o.syndicated_from = first.origin_site;
    else if (!first) seenSyn.set(k, o);
  }
  const counts = {
    raw_result_count: rawResultCount ?? list.length,
    normalized_count: list.length,
    duplicate_count: duplicates.length,
    unique_count: unique.length,
    syndicated_count: unique.filter((o) => o.syndicated_from).length,
  };
  return { unique, duplicates, counts };
}

/**
 * Source independence, on the QUALIFIED observations only.
 *
 *   providers    retrieval providers that contributed a qualified observation
 *   retrievals   provider × profile pairs
 *   origins      distinct origin sites, with syndicated copies collapsed
 *   observations distinct qualified listings
 *
 * A quorum reads `qualified_observation_count`; a diversity floor reads
 * `distinct_origin_count`. Neither reads a result count.
 */
export function sourceIndependence(observations, { qualified = (o) => o.qualification_state === QUALIFICATION.ADMITTED } = {}) {
  const list = (Array.isArray(observations) ? observations : []).filter(Boolean);
  const q = list.filter(qualified);
  const providers = new Set();
  const retrievals = new Set();
  const origins = new Set();
  for (const o of q) {
    for (const r of o.retrievals ?? []) { providers.add(r.provider); retrievals.add(`${r.provider}|${r.profile ?? ''}`); }
    if (o.provider) providers.add(o.provider);
    origins.add(o.syndicated_from ?? o.origin_site ?? 'unknown');
  }
  return {
    qualified_observation_count: q.length,
    distinct_origin_count: origins.size,
    distinct_provider_count: providers.size,
    distinct_retrieval_count: retrievals.size,
    origins: [...origins].sort(),
    providers: [...providers].sort(),
  };
}
