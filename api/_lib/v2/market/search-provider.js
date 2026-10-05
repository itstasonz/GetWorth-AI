// ══════════════════════════════════════════════════════════════════════════════
// MARKET DATA LAYER — TODAY'S SEARCH, BEHIND THE PROVIDER CONTRACT
//
// A DISCOVERY provider: it returns PAGES (the search tool's own record of
// what it found), not observations. Observations are extracted after every
// discovery provider has answered, because the market identity — which
// number this product is sold under — is resolved from all of their results
// together (market-identity.js), and a page cannot be read without it.
//
// Two PROFILES of one provider:
//   local               today's four queries on the open web, located in the market
//   local_used_domains  the same queries narrowed to the market's used-marketplace
//                       hosts (config.js LOCAL_USED_HOSTS). OFF by default. A
//                       recall experiment, not a coverage claim.
//
// Two profiles are two RETRIEVALS of ONE provider. The dedupe module counts
// them as such; nothing here lets a second profile count as a second source.
// ══════════════════════════════════════════════════════════════════════════════
import { defineProvider, PROVIDER_CLASS, PROVIDER_STATUS, ERROR_CLASS } from './provider.js';
import { runV2Search, SEARCH_OUTCOME } from '../search.js';
import { planV2Search } from '../search-plan.js';
import { SEARCH_PROFILE, LOCAL_USED_HOSTS } from '../config.js';

/** One search action, as the provider bills it. */
export const SEARCH_ACTION_COST_USD = 0.01;

const OUTCOME_STATUS = Object.freeze({
  [SEARCH_OUTCOME.COMPLETED]: PROVIDER_STATUS.COMPLETED,
  [SEARCH_OUTCOME.NO_SEARCH_RECORDED]: PROVIDER_STATUS.EMPTY,
  [SEARCH_OUTCOME.TIMED_OUT]: PROVIDER_STATUS.TIMED_OUT,
  [SEARCH_OUTCOME.FAILED]: PROVIDER_STATUS.FAILED,
  [SEARCH_OUTCOME.NOT_ATTEMPTED]: PROVIDER_STATUS.SKIPPED,
});

export function createSearchProvider({ profile = SEARCH_PROFILE.LOCAL, model, apiKey, safetyIdentifier = null, fetchImpl = fetch, hosts = LOCAL_USED_HOSTS } = {}) {
  const narrowed = profile === SEARCH_PROFILE.LOCAL_USED_DOMAINS;
  return defineProvider({
    id: 'openai_web_search',
    kind: 'discovery',
    profile_name: profile,
    classes: narrowed
      ? [PROVIDER_CLASS.SEARCH_DISCOVERY, PROVIDER_CLASS.LOCAL_USED]
      : [PROVIDER_CLASS.SEARCH_DISCOVERY, PROVIDER_CLASS.LOCAL_USED, PROVIDER_CLASS.LOCAL_RETAIL, PROVIDER_CLASS.INTERNATIONAL_USED, PROVIDER_CLASS.INTERNATIONAL_RETAIL],
    profile: { cost_per_call_usd: SEARCH_ACTION_COST_USD, typical_ms: 3800, max_results: 40, timeout_ms: 4500 },
    supports(identity, market) {
      if (narrowed && !(hosts?.[market?.id]?.length)) return false;
      return !!identity && (!!identity.brand?.value || !!identity.object_class || !!identity.model?.value);
    },
    async search(identity, ctx = {}) {
      const plan = ctx.plan ?? planV2Search(identity, ctx.level, ctx.market);
      if (!plan.queries.length) return { status: PROVIDER_STATUS.SKIPPED };
      const r = await runV2Search({
        plan, market: ctx.market, model: ctx.model ?? model, apiKey: ctx.apiKey ?? apiKey,
        safetyIdentifier: ctx.safetyIdentifier ?? safetyIdentifier, fetchImpl: ctx.fetchImpl ?? fetchImpl,
        timeoutMs: ctx.deadlineMs, signal: ctx.signal,
        allowedDomains: narrowed ? hosts[ctx.market?.id] ?? [] : [],
      });
      if (r.provenance?.results?.length) ctx.onFirstResult?.();
      const actions = r.provenance?.search_call_count ?? 0;
      return {
        status: OUTCOME_STATUS[r.outcome] ?? PROVIDER_STATUS.FAILED,
        error: r.failure ?? null, error_class: r.failure === 'timeout' ? ERROR_CLASS.TIMEOUT : (r.failure ? ERROR_CLASS.HTTP : null),
        raw: { plan, search: r },
        result_count: r.provenance?.results?.length ?? 0,
        billed: r.billed === true, cost_usd: r.billed ? Math.max(1, actions) * SEARCH_ACTION_COST_USD : 0,
        request_id: `${profile}-${Date.now()}`, timings: r.timings,
      };
    },
    // Pages, not observations: see the header. The orchestrator extracts after merging.
    normalize() { return []; },
  });
}
