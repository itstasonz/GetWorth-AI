// ══════════════════════════════════════════════════════════════════════════════
// MARKET DATA LAYER — THE ORCHESTRATOR
//
//   identity
//      │
//      ├── discovery providers (search profiles)   ─┐
//      ├── listing providers (eBay …)               │  in parallel, each under
//      └── the FX table                             ─┘  its own deadline
//      │
//   merge pages → market identity → extraction → gate   (the existing evidence stage)
//      │
//   observations ← pages + listing providers, resolved against that market identity
//      │
//   dedupe → independence → cache
//
// Wall-clock is the slowest provider, bounded by V2_MARKET_BUDGET_MS. A
// provider that times out, fails or is aborted is a ledger row; the scan goes
// on with what completed.
//
// ── EARLY STOP, ON QUALIFIED EVIDENCE ───────────────────────────────────────
//
// When the discovery providers that have completed already yield a VERIFIED
// token (a tier-A quorum admitted by the gate), providers that can only ever
// supply lower tiers are aborted so they do not delay the answer. Nothing is
// aborted because results EXIST; only because the gate has already spoken.
// A provider that could still raise the verdict is never aborted.
//
// With one provider configured this is today's engine, step for step.
// ══════════════════════════════════════════════════════════════════════════════
import { runProvider, PROVIDER_STATUS, LOWER_TIER_CLASSES } from './provider.js';
import { assessV2Evidence, TIER } from '../evidence.js';
import { observationFromEntry, normalizeObservation, QUALIFICATION } from './observation.js';
import { dedupeObservations, sourceIndependence } from './dedupe.js';
import { withConversion } from './fx.js';
import { relationOf, RELATION } from '../market-identity.js';
import { classifyConfiguration, configurationCompatible } from '../configuration.js';
import { planV2Search } from '../search-plan.js';
import { canonicalListingUrl } from '../../listing-identity.js';
import { V2_MARKET_BUDGET_MS } from '../config.js';
import { SEARCH_OUTCOME } from '../search.js';

const EMPTY_PROVENANCE = () => ({
  tool: 'web_search', search_performed: false, web_search_call_count: 0, completed_call_count: 0, search_call_count: 0,
  queries: [], sources: [], source_domains: [], source_details: [], citations: [], pages_opened: [], results: [],
});

/**
 * One provenance from every completed discovery retrieval. A page returned
 * by two retrievals is one page with two `retrievals`; counts of actions and
 * queries are summed and unioned, never inflated per page.
 */
export function mergeProvenance(reports) {
  const merged = EMPTY_PROVENANCE();
  const byKey = new Map();
  const sources = new Map();
  for (const r of reports) {
    const p = r?.raw?.search?.provenance;
    if (!p?.search_performed) continue;
    merged.search_performed = true;
    merged.web_search_call_count += p.web_search_call_count ?? 0;
    merged.completed_call_count += p.completed_call_count ?? 0;
    merged.search_call_count += p.search_call_count ?? 0;
    for (const q of p.queries ?? []) if (!merged.queries.includes(q)) merged.queries.push(q);
    for (const s of p.source_details ?? []) { const k = canonicalListingUrl(s.url) ?? s.url; if (!sources.has(k)) sources.set(k, s); }
    for (const res of p.results ?? []) {
      const key = canonicalListingUrl(res.url) ?? res.url;
      const retrieval = { provider: r.provider, profile: r.profile, request_id: r.request_id ?? null };
      const seen = byKey.get(key);
      if (seen) {
        seen.retrievals.push(retrieval);
        // The same page with a different excerpt: more text, one page.
        if (res.text && seen.text && !seen.text.includes(res.text)) seen.text = `${seen.text}\n${res.text}`;
        continue;
      }
      byKey.set(key, { ...res, retrievals: [retrieval] });
    }
  }
  merged.results = [...byKey.values()];
  merged.source_details = [...sources.values()];
  merged.sources = merged.source_details.map((s) => s.url);
  merged.source_domains = [...new Set(merged.source_details.map((s) => s.domain))].sort();
  return merged;
}

/** A listing provider's observation, resolved against the market identity the pages established. */
function resolveListing(o, { market, subjectConfiguration, fxTable, now }) {
  const text = `${o.title ?? ''}\n${o.snippet ?? ''}`;
  const relation = market ? relationOf(text, market) : 'UNKNOWN';
  const configuration = classifyConfiguration(text).configuration;
  const compatible = configurationCompatible(configuration, subjectConfiguration);
  const exact = relation === RELATION.EXACT;
  const used = o.price_type === 'ASKING' || o.price_type === 'SOLD';
  const resolved = normalizeObservation({
    ...o, relation, configuration, now,
    tier: exact && used && compatible ? (o.locale === 'local' ? TIER.A : TIER.B) : null,
    qualification_state: exact && used && compatible ? QUALIFICATION.CONTEXT : QUALIFICATION.REJECTED,
    rejection_reason: !exact ? `listing_relation_${String(relation).toLowerCase()}` : (!compatible ? `configuration_${String(configuration).toLowerCase()}` : (!used ? 'not_a_used_price' : null)),
    identity_confidence: exact ? 0.9 : (relation === RELATION.REGIONAL_VARIANT ? 0.7 : 0.2),
  });
  return fxTable ? withConversion(resolved, fxTable, { now }) : resolved;
}

/**
 * Run the market data layer for one identity.
 *
 * Resolves in every case; a scan with no provider at all returns an empty
 * report with `search_outcome: NOT_ATTEMPTED`.
 */
export async function runMarketData({
  identity, subject, level, market, providers = [], fx = null, cache = null,
  deadlineMs = V2_MARKET_BUDGET_MS, earlyStop = true, now = Date.now, assess = assessV2Evidence,
  model = null, apiKey = null, safetyIdentifier = null, fetchImpl = fetch, plan = null,
} = {}) {
  const t0 = now();
  const thePlan = plan ?? planV2Search(identity, level, market);
  const controllers = new Map(providers.map((p) => [p, new AbortController()]));
  const ledger = [];
  const discovery = [];
  const earlyStopState = { triggered: false, at_ms: null, aborted: [], reason: null };
  const subjectConfiguration = subject?.configuration ?? 'UNKNOWN';

  // The cache is read first; a hit is CONTEXT for this scan, never fresh evidence.
  const cacheKey = cache ? cache.keyFor({ identity, market: market?.id, exactRoots: [] }) : null;
  const cached = cache ? await cache.get(cacheKey) : null;

  const onComplete = (provider, report) => {
    ledger.push(report);
    if (provider.kind === 'discovery') discovery.push(report);
    if (!earlyStop || earlyStopState.triggered || provider.kind !== 'discovery' || report.status !== PROVIDER_STATUS.COMPLETED) return;
    // Qualified evidence, from what has COMPLETED: never from result counts.
    const ev = assess({ provenance: mergeProvenance(discovery), subject, level, identity });
    if (!ev.qualification?.qualified) return;
    earlyStopState.triggered = true;
    earlyStopState.at_ms = now() - t0;
    earlyStopState.reason = 'tier_a_quorum_qualified';
    for (const [p, c] of controllers) {
      const done = ledger.some((r) => r.provider === p.id && r.profile === (p.profile_name ?? null));
      if (done || !p.classes.every((cls) => LOWER_TIER_CLASSES.has(cls))) continue;
      c.abort();
      earlyStopState.aborted.push(p.id);
    }
  };

  const fxRun = fx ? fx.rates().catch((err) => ({ status: 'FAILED', table: null, error: String(err?.message ?? err).slice(0, 120) })) : Promise.resolve(null);
  const runs = providers.map((p) => runProvider(p, identity, {
    market, level, subject, plan: thePlan, model, apiKey, safetyIdentifier, fetchImpl, now,
    deadlineMs: Math.max(0, deadlineMs - (now() - t0)), signal: controllers.get(p).signal, profile: p.profile_name ?? null,
    exactRoots: [],
  }).then((report) => { onComplete(p, report); return report; }));
  const [fxResult] = await Promise.all([fxRun, Promise.allSettled(runs)]);
  const fxTable = fxResult?.table ?? null;

  // ── THE EVIDENCE STAGE, ONCE, OVER EVERY PAGE ─────────────────────────────
  const provenance = mergeProvenance(discovery);
  const primary = discovery.find((r) => r.profile === 'local') ?? discovery[0] ?? null;
  const anyCompleted = discovery.some((r) => r.status === PROVIDER_STATUS.COMPLETED && r.raw?.search?.provenance?.search_performed);
  const searchOutcome = anyCompleted ? SEARCH_OUTCOME.COMPLETED : (primary?.raw?.search?.outcome ?? SEARCH_OUTCOME.NOT_ATTEMPTED);
  const evidence = anyCompleted ? assess({ provenance, subject, level, identity }) : null;
  const marketIdentity = evidence?.market ?? null;

  // ── OBSERVATIONS: PAGES THAT PRICED SOMETHING, AND LISTING PROVIDERS ──────
  const retrievalsByUrl = new Map(provenance.results.map((r) => [r.url, r.retrievals]));
  const fromPages = (evidence?.entries ?? []).map((e) => {
    const rets = retrievalsByUrl.get(e.observation.source) ?? [];
    return observationFromEntry({ ...e, canonical_brand: marketIdentity?.brand ?? null, canonical_model: marketIdentity?.visible_name ?? null, canonical_model_number: marketIdentity?.exact_roots?.[0] ?? null },
      { provider: rets[0]?.provider ?? 'openai_web_search', profile: rets[0]?.profile ?? null, request_id: rets[0]?.request_id ?? null, market: market?.id ?? null, now: now() });
  }).map((o, i) => ({ ...o, retrievals: retrievalsByUrl.get((evidence?.entries ?? [])[i]?.observation.source) ?? o.retrievals }));
  const fromListings = ledger.filter((r) => r.status === PROVIDER_STATUS.COMPLETED && (r.observations?.length ?? 0) > 0)
    .flatMap((r) => r.observations.map((o) => resolveListing(o, { market: marketIdentity, subjectConfiguration, fxTable, now: now() })));
  const live = [...fromPages, ...fromListings];
  const dedupe = dedupeObservations(live, { rawResultCount: provenance.results.length + ledger.reduce((n, r) => n + (r.kind === 'listings' ? r.result_count : 0), 0) });
  const independence = sourceIndependence(dedupe.unique);
  const anchorIndependence = sourceIndependence(dedupe.unique, { qualified: (o) => o.qualification_state === QUALIFICATION.ANCHOR });

  // Written through after a completed run; cached rows are context on the next.
  if (cache && cacheKey && anyCompleted) {
    const key = cache.keyFor({ identity, market: market?.id, exactRoots: marketIdentity?.exact_roots ?? [] });
    await cache.put(key, dedupe.unique, { provenance: { providers: ledger.map((r) => [r.provider, r.profile, r.status]), at: new Date(now()).toISOString() } });
  }

  const elapsed = now() - t0;
  return {
    plan: thePlan,
    provenance,
    evidence,
    search_outcome: searchOutcome,
    primary_search: primary?.raw?.search ?? null,
    observations: dedupe.unique,
    cached: cached ? { key: cached.key, hit: cached.hit, expired: cached.expired, count: cached.observations.length, stored_at: cached.stored_at } : null,
    dedupe: { counts: dedupe.counts, duplicates: dedupe.duplicates.slice(0, 40) },
    independence: { admitted: independence, anchors: anchorIndependence },
    fx: fxResult ? { status: fxResult.status, source: fx?.source ?? null, rate_date: fxTable?.rate_date ?? null, retrieved_at: fxTable?.retrieved_at ?? null, cached: fxResult.cached === true, error: fxResult.error ?? null } : null,
    early_stop: earlyStopState,
    ledger: ledger.map(({ raw, observations, ...rest }) => ({ ...rest, observations: observations?.length ?? 0 })),
    raw_ledger: ledger,
    timings: { started_at: t0, elapsed_ms: elapsed, deadline_ms: deadlineMs, within_deadline: elapsed <= deadlineMs + 250 },
    calls: {
      search_actions: provenance.search_call_count,
      billed_providers: ledger.filter((r) => r.billed).map((r) => `${r.provider}${r.profile ? `:${r.profile}` : ''}`),
      cost_usd: Number(ledger.reduce((n, r) => n + (r.cost_usd ?? 0), 0).toFixed(4)),
    },
  };
}
