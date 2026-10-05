// ══════════════════════════════════════════════════════════════════════════════
// SCAN ENGINE V2 — THE TWO STEPS
//
//   runV2Identify   photograph (+ signed state, for a follow-up)
//                     -> ONE vision call -> merge -> sufficiency gate
//   runV2Price      an identity the gate approved
//                     -> local plan -> ONE search call, stopped at the results
//                     -> deterministic extraction -> existing qualification
//                     -> price state
//
// Each step records where its time went, as offsets from its own start, and
// how many provider calls it made. A V2 scan is at most two identity calls and
// one search call; tests/scan-v2-pipeline.test.mjs holds it to that.
//
// Nothing here writes to a database, and nothing here imports the V1 handler.
// ══════════════════════════════════════════════════════════════════════════════
import { identifyItem } from './identity.js';
import { mergeIdentity } from './followup.js';
import { decideSufficiency, DECISION } from './sufficiency.js';
import { planV2Search, subjectOf } from './search-plan.js';
import { SEARCH_OUTCOME } from './search.js';
import { resolveV2Price } from './pricing.js';
import { classifyOpenAIFailure } from './openai-stream.js';
import { resolveMarketRegion } from '../phaseb/config.js';
import { resolveSearchProfiles } from './config.js';
import { runMarketData } from './market/orchestrator.js';
import { createSearchProvider } from './market/search-provider.js';
import { createEbayProvider, ebayConfig } from './market/ebay-provider.js';
import { createFxSource, FX_ENV } from './market/fx.js';

const now = () => Date.now();

/**
 * The providers a scan runs, from the environment: the search provider in
 * each configured profile ('local' alone by default), and eBay only when it
 * is switched on with credentials. Nothing here is reached by a request field.
 */
export function defaultMarketProviders({ env = process.env, model, apiKey, safetyIdentifier = null, fetchImpl = fetch } = {}) {
  const providers = resolveSearchProfiles(env).map((profile) => createSearchProvider({ profile, model, apiKey, safetyIdentifier, fetchImpl }));
  const ebay = ebayConfig(env);
  if (ebay.enabled) providers.push(createEbayProvider({ config: ebay, fetchImpl }));
  return providers;
}

/** The FX source from the environment: off unless the flag is exactly 'true'. */
export function defaultFxSource({ env = process.env, fetchImpl = fetch } = {}) {
  return createFxSource({ enabled: String(env?.[FX_ENV.ENABLED] ?? '').trim().toLowerCase() === 'true', fetchImpl });
}

/**
 * Identify, or re-identify with a follow-up photograph.
 *
 * `priorState` is a VERIFIED scan state (state.js) or null. Resolves to
 * { ok, identity, sufficiency, followups_used, timings, calls } and never
 * throws: a provider failure is `ok: false` with a classified reason.
 */
export async function runV2Identify({
  image, priorState = null, language = 'en', model, apiKey, safetyIdentifier = null, fetchImpl = fetch,
} = {}) {
  const t0 = now();
  const prior = priorState?.identity ?? null;
  const followupsUsed = prior ? (priorState.followups_used ?? 0) + 1 : 0;
  const requested = priorState?.sufficiency?.followup?.type ?? null;
  const timings = { identity_start_ms: 0 };
  try {
    const { identity: reading, meta } = await identifyItem({
      image, prior, requested, model, apiKey, safetyIdentifier, fetchImpl,
    });
    timings.identity_first_event_ms = meta.timings.first_event_ms;
    timings.identity_complete_ms = now() - t0;
    const identity = prior ? mergeIdentity(prior, reading) : reading;
    const sufficiency = decideSufficiency(identity, { followupsUsed, language });
    timings.sufficiency_decision_ms = now() - t0;
    return {
      ok: true, identity, sufficiency, followups_used: followupsUsed, timings,
      calls: { identity: 1, search: 0, model: meta.model, usage: meta.usage },
      failure: null,
    };
  } catch (err) {
    timings.identity_complete_ms = now() - t0;
    return {
      ok: false, identity: null, sufficiency: null, followups_used: followupsUsed, timings,
      calls: { identity: 1, search: 0, model, usage: null },
      failure: classifyOpenAIFailure(err?.message),
    };
  }
}

/**
 * Price an identity the gate approved.
 *
 * `state` is a VERIFIED scan state. An identity the gate did not approve is
 * answered NEED_MORE_INFORMATION without a search: the gate's decision is not
 * re-argued here, and no provider call is made for it.
 */
export async function runV2Price({
  state, model, apiKey, marketRegion = resolveMarketRegion(), safetyIdentifier = null, fetchImpl = fetch,
  // The market data layer. Defaults are read from the environment; tests hand in their own.
  providers = null, fx = null, cache = null, env = process.env,
} = {}) {
  const t0 = now();
  const identity = state?.identity ?? null;
  const sufficiency = state?.sufficiency ?? null;
  const timings = {};
  const base = { identity, sufficiency, plan: null, search: null, evidence: null, market_data: null };

  if (sufficiency?.decision !== DECISION.SEARCH_NOW) {
    return {
      ...base, valuation: resolveV2Price({ identity, sufficiency }),
      timings: { total_ms: now() - t0 }, calls: { identity: 0, search: 0 },
    };
  }

  const subject = subjectOf(identity, sufficiency.level);
  const plan = planV2Search(identity, sufficiency.level, marketRegion);
  timings.search_start_ms = now() - t0;
  const md = await runMarketData({
    identity, subject, level: sufficiency.level, market: marketRegion, plan,
    providers: providers ?? defaultMarketProviders({ env, model, apiKey, safetyIdentifier, fetchImpl }),
    fx: fx ?? defaultFxSource({ env, fetchImpl }), cache,
    model, apiKey, safetyIdentifier, fetchImpl,
  });
  // What the FIRST profile's search recorded: the shape every reader of `search` expects.
  const search = md.primary_search ?? { outcome: md.search_outcome, provenance: md.provenance, timings: null, usage: null, failure: null, stopped_early: false, billed: false };
  timings.search_first_event_ms = search.timings ? timings.search_start_ms + (search.timings.first_event_ms ?? 0) : null;
  timings.search_results_available_ms = search.timings?.results_available_ms != null
    ? timings.search_start_ms + search.timings.results_available_ms : null;
  timings.search_complete_ms = now() - t0;
  timings.market_data_ms = md.timings.elapsed_ms;

  const evidence = md.evidence;
  timings.qualification_complete_ms = now() - t0;
  const valuation = resolveV2Price({ identity, subject, sufficiency, evidence, searchOutcome: md.search_outcome });
  timings.valuation_complete_ms = now() - t0;
  timings.total_ms = now() - t0;

  return {
    identity, sufficiency, subject, plan, search, evidence, valuation, timings,
    market_data: {
      ledger: md.ledger, early_stop: md.early_stop, dedupe: md.dedupe, independence: md.independence, fx: md.fx, cached: md.cached,
      observations: md.observations, timings: md.timings, calls: md.calls,
    },
    calls: { identity: 0, search: md.calls.search_actions || (plan.queries.length > 0 && search.billed ? 1 : 0), usage: search.usage, billed: search.billed, providers: md.calls.billed_providers, cost_usd: md.calls.cost_usd },
  };
}
