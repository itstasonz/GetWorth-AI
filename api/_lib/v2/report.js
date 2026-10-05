// ══════════════════════════════════════════════════════════════════════════════
// SCAN ENGINE V2 — WHAT THE CLIENT IS TOLD
//
// The on-screen diagnostic panel is how a V2 scan is measured on a phone, so
// everything it needs is in the response: what was searched, what came back,
// where every result and every number went, what the product turned out to be
// sold as, and where the time went. No remote debugger.
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
    // One action is the budget. More than one is a finding, and it is visible.
    search_actions: p?.search_call_count ?? 0,
    search_calls: p?.search_call_count ?? 0,
    results: p?.results?.length ?? 0,
    sources: p?.sources?.length ?? 0,
    domains: (p?.source_domains ?? []).slice(0, 30),
    stopped_at_results: search?.stopped_early === true,
    timings: search?.timings ?? null,
  };
}

/** What the product is sold as, and what supports each name. */
function describeMarket(market) {
  if (!market) return null;
  return {
    visible_name: market.visible_name,
    proposed: market.proposed,
    corroborated: market.corroborated,
    exact_tokens: [...market.exact_roots, ...market.exact_phrases.map((p) => p.join(' '))],
    aliases: market.aliases.slice(0, MAX_LISTED).map((a) => ({
      value: a.value, kind: a.kind, relation: a.relation, proposed: a.proposed, weak: a.weak,
      sites_seen: a.sites_seen, also_used_for: a.also_used_for ?? [], short_form_of: a.short_form_of ?? null,
      // A name's positive evidence, and what was seen that does not count.
      tied_to: a.tied_to ?? [], seen_beside_read_name: a.seen_beside_read_name ?? 0, seen_as_fragment: a.seen_as_fragment ?? 0,
      evidence: (a.evidence ?? []).slice(0, 4).map((e) => e.site),
    })),
  };
}

/** The evidence half: the accounting, and the listings behind each count. */
export function describeEvidence(evidence) {
  if (!evidence) return null;
  const q = evidence.qualification;
  const row = (e) => ({
    class: e.evidence_class,
    tier: e.tier ?? null,
    relation: e.relation,
    configuration: e.configuration ?? null,
    source_type: e.source_type ?? null,
    currency_basis: e.currency_basis ?? null,
    role: e.role,
    binding: e.row_bound ? 'category_row' : e.binding,
    page_type: e.page_type,
    domain: e.observation.source_domain,
    url: clip(e.observation.source, 300),
    title: clip(e.observation.title),
    price: e.observation.observed_price,
    stated_price: e.stated_price,
    delivery_fee: e.delivery_fee,
    currency: e.observation.currency,
    outcome: e.admitted ? 'ADMITTED_USED' : (e.retail_anchor ? 'RETAIL_ANCHOR' : 'REJECTED'),
    admitted_as: e.admitted_as ?? null,
    reason: e.reason ?? null,
  });
  return {
    // TOTAL -> DUPLICATE / NO_PRICE_DATA / PRICE_CANDIDATE -> REFUSED / REJECTED / ADMITTED
    accounting: evidence.accounting,
    counts: evidence.counts,
    market_identity: describeMarket(evidence.market),
    qualification_runs: evidence.qualification_runs,
    distinct_sources: evidence.distinct_sources,
    qualified: q.qualified === true,
    comparable_qualified: q.comparable_qualified === true,
    set_failures: q.set_failures ?? [],
    admitted: evidence.entries.filter((e) => e.admitted).slice(0, MAX_LISTED).map(row),
    retail: evidence.entries.filter((e) => e.retail_anchor).slice(0, MAX_LISTED).map(row),
    rejected: evidence.entries.filter((e) => !e.admitted && !e.retail_anchor).slice(0, MAX_LISTED).map(row),
    // Every reason something did not price the item, with how often: the gate's
    // own disqualifiers, and what extraction refused before the gate saw it.
    rejection_reasons: tally([
      ...evidence.entries.filter((e) => !e.admitted && !e.retail_anchor).map((e) => e.reason),
      ...evidence.refused.map((r) => r.reason),
    ]),
    extraction_reasons: tally(evidence.refused.map((r) => r.reason)),
    refused_at_extraction: evidence.refused.slice(0, MAX_LISTED * 2).map((r) => ({
      reason: r.reason, role: r.role, value: r.value, currency: r.currency, relation: r.relation ?? null,
      url: clip(r.url, 300), text: clip(r.text),
    })),
    pages: evidence.pages.slice(0, 40).map((p) => ({
      bucket: p.bucket, page_type: p.page_type, source_type: p.source_type ?? null, locale: p.locale ?? null,
      title_relation: p.title_relation, result_level: p.result_level,
      domain: p.domain, title: clip(p.title, 80),
    })),
    subject_configuration: evidence.subject_configuration ?? null,
    timings: evidence.timings,
  };
}

/**
 * The ledger in one bounded line, for the server log: enough to reconstruct a
 * scan's evidence after the fact, which the production witness could not be.
 * Counts, every page's bucket and type, and the priced rows. No key, no token,
 * no user id; listing text is third-party page text and is clipped.
 */
export function ledgerLine(scanUuid, result) {
  const ev = result?.evidence ?? null;
  const v = result?.valuation ?? null;
  const p = result?.search?.provenance ?? null;
  return JSON.stringify({
    scan: String(scanUuid ?? '').slice(0, 8),
    state: v?.state ?? null, evidence_state: v?.evidence_state ?? null, limitation: v?.limitation?.code ?? null,
    identity_confidence: v?.confidence?.identity?.level ?? null, anchor: v?.retail_anchor ? [v.retail_anchor.strength, v.retail_anchor.shops, v.retail_anchor.low, v.retail_anchor.high] : null,
    plan: (result?.plan?.queries ?? []).map((q) => q.purpose), queries: (p?.queries ?? []).length, actions: p?.search_call_count ?? 0,
    results: p?.results?.length ?? 0, exact: ev?.market?.exact_roots ?? [], corroborated: ev?.market?.corroborated ?? [],
    accounting: ev?.accounting?.buckets ?? null, tiers: ev?.counts?.by_tier ?? null, configurations: ev?.counts?.by_configuration ?? null,
    pages: (ev?.pages ?? []).slice(0, 40).map((pg) => [pg.domain, pg.bucket, pg.source_type, pg.title_relation]),
    rows: (ev?.entries ?? []).slice(0, 16).map((e) => [e.observation.source_domain, e.observation.observed_price, e.observation.currency, e.kind, e.relation, e.configuration, e.tier, e.admitted ? 'ADMITTED' : (e.retail_anchor ? 'ANCHOR' : 'REJECTED'), e.reason, clip(e.observation.title, 60)]),
    timings: result?.timings ?? null,
  });
}
