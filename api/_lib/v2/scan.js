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
import { runV2Search, SEARCH_OUTCOME } from './search.js';
import { assessV2Evidence } from './evidence.js';
import { resolveV2Price } from './pricing.js';
import { classifyOpenAIFailure } from './openai-stream.js';
import { resolveMarketRegion } from '../phaseb/config.js';

const now = () => Date.now();

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
} = {}) {
  const t0 = now();
  const identity = state?.identity ?? null;
  const sufficiency = state?.sufficiency ?? null;
  const timings = {};
  const base = { identity, sufficiency, plan: null, search: null, evidence: null };

  if (sufficiency?.decision !== DECISION.SEARCH_NOW) {
    return {
      ...base, valuation: resolveV2Price({ identity, sufficiency }),
      timings: { total_ms: now() - t0 }, calls: { identity: 0, search: 0 },
    };
  }

  const subject = subjectOf(identity, sufficiency.level);
  const plan = planV2Search(identity, sufficiency.level, marketRegion);
  timings.search_start_ms = now() - t0;
  const search = await runV2Search({ plan, market: marketRegion, model, apiKey, safetyIdentifier, fetchImpl });
  timings.search_first_event_ms = search.timings ? timings.search_start_ms + (search.timings.first_event_ms ?? 0) : null;
  timings.search_results_available_ms = search.timings?.results_available_ms != null
    ? timings.search_start_ms + search.timings.results_available_ms : null;
  timings.search_complete_ms = now() - t0;

  let evidence = null;
  if (search.outcome === SEARCH_OUTCOME.COMPLETED) {
    evidence = assessV2Evidence({ provenance: search.provenance, subject, level: sufficiency.level, identity });
  }
  timings.qualification_complete_ms = now() - t0;
  const valuation = resolveV2Price({ identity, subject, sufficiency, evidence, searchOutcome: search.outcome });
  timings.valuation_complete_ms = now() - t0;
  timings.total_ms = now() - t0;

  return {
    identity, sufficiency, subject, plan, search, evidence, valuation, timings,
    calls: { identity: 0, search: plan.queries.length > 0 ? 1 : 0, usage: search.usage, billed: search.billed },
  };
}
