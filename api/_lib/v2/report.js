// ══════════════════════════════════════════════════════════════════════════════
// SCAN ENGINE V2 — WHAT THE CLIENT IS TOLD
//
// The on-screen diagnostic panel is how a V2 scan is measured on a phone, so
// everything it needs is in the response: what was searched, what came back,
// what each gate did with it, and where the time went. No remote debugger.
//
// BOUNDED, AND NO SECRET. Listing text is third-party content and is truncated;
// lists are capped; nothing here is a key, a token payload or an environment
// value. The signed state is returned by the handler, separately, and is opaque.
// ══════════════════════════════════════════════════════════════════════════════

const MAX_LISTED = 12;
const clip = (v, n = 120) => (typeof v === 'string' ? v.slice(0, n) : null);
const tally = (reasons) => {
  const out = {};
  for (const r of reasons) { const k = r || 'unspecified'; out[k] = (out[k] ?? 0) + 1; }
  return out;
};

/** The search half: what was planned, what the provider ran, what it returned. */
export function describeSearch(plan, search) {
  const p = search?.provenance ?? null;
  return {
    outcome: search?.outcome ?? null,
    failure: search?.failure ?? null,
    planned_queries: (plan?.queries ?? []).map((q) => ({ purpose: q.purpose, text: q.text, hypothesis: q.hypothesis ?? null })),
    executed_queries: (p?.queries ?? []).slice(0, 12),
    search_calls: p?.search_call_count ?? 0,
    results: p?.results?.length ?? 0,
    sources: p?.sources?.length ?? 0,
    domains: (p?.source_domains ?? []).slice(0, 30),
    stopped_at_results: search?.stopped_early === true,
    timings: search?.timings ?? null,
  };
}

/** The evidence half: counts, and the listings behind each count. */
export function describeEvidence(evidence) {
  if (!evidence) return null;
  const q = evidence.qualification;
  const row = (e) => ({
    class: e.evidence_class,
    domain: e.observation.source_domain,
    url: clip(e.observation.source, 300),
    title: clip(e.observation.title),
    price: e.observation.observed_price,
    currency: e.observation.currency,
    reason: e.reason ?? null,
  });
  return {
    counts: evidence.counts,
    distinct_sources: evidence.distinct_sources,
    qualified: q.qualified === true,
    comparable_qualified: q.comparable_qualified === true,
    set_failures: q.set_failures ?? [],
    admitted: evidence.entries.filter((e) => e.admitted).slice(0, MAX_LISTED).map(row),
    rejected: evidence.entries.filter((e) => !e.admitted).slice(0, MAX_LISTED).map(row),
    // Every reason something did not price the item, with how often: the gate's
    // own disqualifiers, and what extraction refused before the gate saw it.
    rejection_reasons: tally([
      ...evidence.entries.filter((e) => !e.admitted).map((e) => e.reason),
      ...evidence.refused.map((r) => r.reason),
    ]),
    refused_at_extraction: evidence.refused.slice(0, MAX_LISTED)
      .map((r) => ({ reason: r.reason, url: clip(r.url, 300), text: clip(r.text) })),
    timings: evidence.timings,
  };
}
