// ══════════════════════════════════════════════════════════════════════════════
// PHASE B — B1..B8 ORCHESTRATION
//
// §8 asks for explicit stages with observable timing and status. §25 asks that
// each stage be MEASURED before anything is optimised, and that the pipeline
// not be crammed into /api/analyze's budget. Both are why every stage records
// its own duration and outcome rather than only the total.
//
// ── ONE IMAGE CALL PER QUESTION (§38) ──────────────────────────────────────
//
// B1 and B2 are a SINGLE call: perception and structuring are one question, and
// splitting them would re-send the photograph to obtain fields the first call
// already returned. B5 (condition) is a second image call because it asks a
// genuinely different question and its answer must not be able to bend the
// identity answer. B3 and B4 are text-only. So: two image calls, two text
// calls, worst case — and the ledger in openai-client.js makes that countable
// rather than asserted.
//
// ── EVERY STAGE CAN FAIL WITHOUT CORRUPTING ANYTHING (§28) ─────────────────
//
// A stage failure degrades the candidate and is recorded; it never throws out
// of the pipeline and never touches the Phase-A result. The worst outcome is a
// candidate that says "identity yes, market no" — which §22 says is the
// correct answer when evidence is thin, not a degraded one.
// ══════════════════════════════════════════════════════════════════════════════
import { callStructured, createCallLedger, classifyOpenAIFailure } from './openai-client.js';
import { IDENTITY_SCHEMA, MARKET_QUERY_SCHEMA, CONDITION_SCHEMA } from './schemas.js';
import { buildIdentityPrompt, buildMarketQueryPrompt, buildConditionPrompt } from './prompts.js';
import { STAGE_TIMEOUT_MS, STAGE_MAX_OUTPUT_TOKENS, resolveEnrichmentModel } from './config.js';
import {
  createMarketResearch, MARKET_MECHANISM, normalizeObservations, rejectOutliers,
} from './market-research.js';
import { computeValuationCandidate, VALUATION_STATUS } from './valuation.js';
import { corroborateSubject, applyGuard, CORROBORATION, reconcileIdentity } from './validation.js';
import { qualifyMarketEvidence } from '../market-evidence.js';

export const PHASE_B_STATUS = Object.freeze({
  COMPLETE: 'COMPLETE',
  IDENTIFIED_PENDING_MARKET: 'IDENTIFIED_PENDING_MARKET',
  // ── A PRICED CANDIDATE THE GUARD DECLINED ────────────────────────────────
  //
  // Collapsing this into IDENTITY_ONLY would read as "Phase B found no price",
  // which is the opposite of what happened and hides the interesting half of
  // the result: the evidence was found, and GetWorth policy refused it anyway.
  //
  // HISTORY WORTH KEEPING, because the comment that used to sit here said
  // something that is no longer true. Before VERIFIED_MARKET existed, EVERY
  // priced candidate landed here with `V-MARKET-EVIDENCE: market evidence
  // pending` — not because the evidence was weak, but because the guard's only
  // class of market evidence was ANCHOR, a GetWorth-held priced row, which §1
  // forbids Phase B from ever producing. A correct Phase-B result was
  // unacceptable by construction.
  //
  // That is now resolved by giving GetWorth a word for the thing it actually
  // has (api/_lib/market-evidence.js), rather than by letting Phase B claim the
  // word it must not have. What still reaches this status is the honest
  // remainder: a qualified distribution that fails some OTHER policy — the
  // luxury-fragrance envelope conflict being the live example, where the
  // second-hand market genuinely exceeds the beauty ceiling and neither side is
  // wrong. Recorded in docs/PHASE_B_PRODUCTION_BLOCKERS.md.
  PRICED_GUARD_WITHHELD: 'PRICED_GUARD_WITHHELD',
  IDENTITY_ONLY: 'IDENTITY_ONLY',
  UNKNOWN: 'UNKNOWN',
  FAILED: 'FAILED',
});

const now = () => Date.now();

/**
 * Run Phase B end to end.
 *
 * `deps` exists so the whole pipeline is testable without a paid call: tests
 * inject `fetchImpl` or a mock market mechanism. §30 requires that no automated
 * test spend OpenAI credits, and dependency injection is what makes that a
 * structural fact rather than a promise.
 */
export async function runPhaseB({
  images = [],
  language = 'en',
  existingRecognition = null,
  ocrText = null,
  catalogCandidates = [],
  model = null,
  apiKey = process.env.OPENAI_API_KEY,
  fetchImpl = fetch,
  marketMechanism = MARKET_MECHANISM.UNAVAILABLE,
  mockSearch = null,
  safetyIdentifier = null,
} = {}) {
  const chosenModel = model || resolveEnrichmentModel();
  const ledger = createCallLedger();
  const timings = {};
  const stages = [];
  const t0 = now();

  // ── WHERE THE TIME WENT, NOT JUST HOW MUCH ───────────────────────────────
  //
  // §25 asks that every stage be MEASURED before anything is optimised, and a
  // list of durations does not answer the question optimisation actually asks.
  // Durations tell you a stage took 9s. They cannot tell you whether that 9s
  // was ON THE CRITICAL PATH or overlapped with something else, and the whole
  // of the 5–8s target is a question about the critical path.
  //
  // `at_ms` is the stage's start, relative to the top of the run. With a start
  // and a duration per stage the wall-clock structure is reconstructible: a
  // reader can see that four stages ran strictly end-to-end, compute what the
  // total would be if the independent ones overlapped, and argue about a real
  // number instead of an intuition. Today every `at_ms` equals the previous
  // stage's end — which IS the finding, stated in data rather than in prose.
  //
  // Recorded as an offset, never as a wall-clock timestamp: an absolute time
  // in a candidate is a fingerprint, and this object is returned to a caller.
  const record = (name, status, ms, detail = null, at = null) => {
    timings[`${name}_ms`] = ms;
    stages.push({
      stage: name,
      status,
      duration_ms: ms,
      at_ms: at === null ? Math.max(0, now() - t0 - ms) : at - t0,
      detail,
    });
  };

  // ── B1 + B2 · VISUAL UNDERSTANDING AND STRUCTURED IDENTITY ───────────────
  let identity = null;
  let identityFailure = null;
  {
    const s = now();
    try {
      const { data } = await callStructured({
        stage: 'identity',
        images,
        prompt: buildIdentityPrompt({ language, existingRecognition, ocrText }),
        schema: IDENTITY_SCHEMA,
        schemaName: 'getworth_phaseb_identity',
        model: chosenModel,
        apiKey,
        timeoutMs: STAGE_TIMEOUT_MS.identity,
        maxOutputTokens: STAGE_MAX_OUTPUT_TOKENS.identity,
        reasoningEffort: 'low',
        safetyIdentifier,
        ledger,
        fetchImpl,
      });
      identity = data;
      record('openai_identity', 'ok', now() - s, null, s);
    } catch (err) {
      identityFailure = classifyOpenAIFailure(err?.message);
      record('openai_identity', 'failed', now() - s, identityFailure, s);
    }
  }

  // Without an identity there is nothing to research, condition or price. This
  // is a clean stop, not a fallback to an invented one (§28).
  if (!identity) {
    return {
      status: PHASE_B_STATUS.FAILED,
      failure_reason: identityFailure || 'identity stage produced nothing',
      identity_candidate: null, condition_candidate: null,
      market_evidence: null, valuation_candidate: null, validation: null,
      timings: { ...timings, total_ms: now() - t0 },
      stages,
      model_metadata: { model: chosenModel, calls: ledger.summary() },
    };
  }

  // ── B7a · CORROBORATION, BEFORE ANYTHING IS PRICED ───────────────────────
  //
  // Deliberately EARLY. A subject the block contradicts must not drive a market
  // search: searching for a host product the item merely references is how an
  // accessory acquires the host's comparables, which is REC7-C1 re-entering
  // through the research stage instead of through the evidence set.
  const corroboration = corroborateSubject({ identity, ocrText, catalogCandidates });

  // ── B7b · DOES PHASE B AGREE WITH PHASE A ABOUT WHAT THIS IS? ────────────
  //
  // Both stages read the same photograph. When they name disjoint products,
  // that disagreement is the most important thing known about this scan, and
  // it must not be resolved silently in favour of whichever ran last.
  // See the contract in validation.js.
  const reconciliation = reconcileIdentity({ identity, existingRecognition });

  // ── B5 · CONDITION — STARTED HERE, AWAITED AFTER THE RESEARCH BRANCH ──────
  //
  // THE DEPENDENCY GRAPH, READ OFF THE CODE RATHER THAN ASSUMED:
  //
  //   identity   ← image + Phase-A hints
  //   condition  ← image, and `identity.subject` for PROMPT CONTEXT ONLY
  //                (object_class / brand / model, in buildConditionPrompt).
  //                Its output is consumed in exactly one place:
  //                computeValuationCandidate({ condition: condition?.grade }).
  //   market_query    ← identity
  //   market_research ← market_query
  //
  // So `condition` and the `market_query → market_research` chain share an
  // ancestor and nothing else. Neither reads the other's output. Running them
  // side by side removes min(condition, query+research) from the wall clock
  // and changes NOTHING about either answer: condition still receives the same
  // fully-resolved `identity` it received when it ran first.
  //
  // WHAT IS DELIBERATELY *NOT* DONE HERE. Starting condition concurrently with
  // IDENTITY would save more — they both only need the image — but the
  // condition prompt would then have no identity to reason about, and "assess
  // the condition of a thing you have not been told the identity of" is a
  // different question producing different grades. That is a semantic change
  // and it needs its own evidence, so it is not taken on a latency argument.
  // §25's rule is measure first; this change is the one that costs nothing.
  //
  // The promise is built so it ALWAYS RESOLVES. A rejection escaping before the
  // await below would be an unhandled rejection in a serverless runtime, which
  // is a process-level event rather than a stage failure — so the catch is
  // inside, and the outcome is carried back as data.
  const conditionStarted = now();
  const conditionTask = (async () => {
    try {
      const { data } = await callStructured({
        stage: 'condition',
        images,
        prompt: buildConditionPrompt({ identity, language }),
        schema: CONDITION_SCHEMA,
        schemaName: 'getworth_phaseb_condition',
        model: chosenModel,
        apiKey,
        timeoutMs: STAGE_TIMEOUT_MS.condition,
        maxOutputTokens: STAGE_MAX_OUTPUT_TOKENS.condition,
        reasoningEffort: 'low',
        safetyIdentifier,
        ledger,
        fetchImpl,
      });
      return { data, failure: null, endedAt: now() };
    } catch (err) {
      return { data: null, failure: classifyOpenAIFailure(err?.message), endedAt: now() };
    }
  })();

  // ── B3 · MARKET QUERY INTENT ─────────────────────────────────────────────
  let query = null;
  {
    const s = now();
    if (corroboration.level === CORROBORATION.CONTRADICTED) {
      // The block says this name belongs to a REFERENCED product. Searching it
      // would retrieve the host's market, so the stage is skipped with a reason.
      record('market_query', 'skipped', now() - s, 'subject contradicted by block provenance', s);
    } else {
      try {
        const { data } = await callStructured({
          stage: 'market_query',
          prompt: buildMarketQueryPrompt({ identity, language }),
          schema: MARKET_QUERY_SCHEMA,
          schemaName: 'getworth_phaseb_market_query',
          model: chosenModel,
          apiKey,
          timeoutMs: STAGE_TIMEOUT_MS.market_query,
          maxOutputTokens: STAGE_MAX_OUTPUT_TOKENS.market_query,
          reasoningEffort: 'low',
          safetyIdentifier,
          ledger,
          fetchImpl,
        });
        // ── A DISPUTED MODEL MAY NOT BE SEARCHED AS IF IT WERE SETTLED ────
        //
        // Applied HERE, deterministically, after the model has answered —
        // rather than by asking the prompt to be careful. The query stage
        // reasons from Phase B's identity alone and has no way to know Phase A
        // proposed a different family; a server-side cap is the only place
        // that fact exists. §13's rule that the model never gains pricing
        // authority by generating the query is the same principle: what it
        // writes is an intent, and the server decides what the intent is
        // allowed to be.
        query = reconciliation.search_specificity_cap === 'brand_category'
          ? {
            ...data,
            product_identity: [identity?.subject?.brand, identity?.subject?.object_class]
              .filter(Boolean).join(' ') || data.product_identity,
            variant: null,
            specificity: 'brand_category',
          }
          : data;
        record('market_query', 'ok', now() - s,
          reconciliation.conflict ? 'capped to brand_category: identity disputed' : null, s);
      } catch (err) {
        record('market_query', 'failed', now() - s, classifyOpenAIFailure(err?.message), s);
      }
    }
  }

  // ── B4 · CURRENT MARKET EVIDENCE ─────────────────────────────────────────
  let research = null;
  {
    const s = now();
    if (!query) {
      record('market_research', 'skipped', now() - s, 'no search intent', s);
    } else {
      const adapter = createMarketResearch({
        mechanism: marketMechanism, model: chosenModel, apiKey, ledger, language, fetchImpl, mockSearch,
      });
      try {
        research = await adapter.search(query);
        record('market_research', 'ok', now() - s, research.mechanism, s);
      } catch (err) {
        record('market_research', 'failed', now() - s, classifyOpenAIFailure(err?.message), s);
      }
    }
  }

  // ── B5 (joined) · THE CONDITION BRANCH REJOINS THE CRITICAL PATH ─────────
  //
  // Recorded with the start it ACTUALLY had, so `at_ms` shows the overlap
  // instead of pretending the stage began when it was awaited. A concurrency
  // change that reports itself as sequential is a change nobody can verify.
  // ── THE DURATION IS THE CALL'S, NOT THE JOIN'S ───────────────────────────
  //
  // A MEASUREMENT BUG THIS FILE INTRODUCED WHEN IT ADDED THE CONCURRENCY, and
  // the second production witness reported it as a product problem: condition
  // was logged at 21,222ms, which is 4ms away from market_query + research
  // (2,941 + 18,277 = 21,218). They match because the old line called `now()`
  // HERE — after `await` had already waited for the longer branch — so it
  // measured from condition's start to the moment it was collected rather than
  // to the moment it finished.
  //
  // The effect is to make the fast branch look exactly as slow as the slow one,
  // which is precisely backwards: it hides the real bottleneck behind the stage
  // that was already free. `endedAt` is stamped INSIDE the task, when the call
  // actually returns.
  const conditionOutcome = await conditionTask;
  const condition = conditionOutcome.data;
  record('condition', condition ? 'ok' : 'failed',
    conditionOutcome.endedAt - conditionStarted, conditionOutcome.failure, conditionStarted);

  // ── B6a · NORMALISATION AND QUALITY FILTERING ────────────────────────────
  const s6 = now();
  const normalized = normalizeObservations(research?.observations ?? []);
  const { kept, dropped } = rejectOutliers(normalized.accepted);
  record('market_normalization', 'ok', now() - s6,
    `${kept.length} accepted / ${normalized.rejected.length + dropped.length} rejected / ${normalized.context.length} context`,
    s6);

  const marketEvidence = {
    mechanism: research?.mechanism ?? MARKET_MECHANISM.UNAVAILABLE,
    search_performed: research?.search_performed ?? false,
    provenance: research?.provenance ?? { tool: null, sources: [] },
    query,
    accepted: kept,
    rejected: [...normalized.rejected, ...dropped],
    context_only: normalized.context,
    counts: {
      returned: research?.observations?.length ?? 0,
      accepted: kept.length,
      rejected: normalized.rejected.length + dropped.length,
      context_only: normalized.context.length,
    },
  };

  // ── B6b · MARKET-EVIDENCE QUALIFICATION ──────────────────────────────────
  //
  // A SECOND, INDEPENDENT READING OF THE SAME EVIDENCE. The input is the RAW
  // observations, deliberately not the `kept` set the stage above produced:
  // qualification re-derives price, currency, provenance and identity
  // compatibility from each listing itself, so an upstream filter that becomes
  // wrong or is bypassed cannot make this permissive. Authority requires both
  // readings to agree, and only this one mints anything.
  const sq = now();
  // ── A DISPUTED MODEL IS NOT A SUBJECT FOR QUALIFICATION EITHER ──────────
  //
  // Capping the QUERY was not enough, and the three-scenario trace proved it:
  // the search correctly dropped to brand + class, but qualification still
  // judged whatever came back against the disputed model — so listings naming
  // it were admitted at PRODUCT level and priced as though the model were
  // settled. The cap moved the question and left the answer where it was.
  //
  // With the model withheld, the subject is brand-without-model, which the
  // set-level gate already refuses for the reason it has always refused it:
  // listings for one specific model of a brand are not evidence about an
  // unknown model of that brand. The honest outcome for a disputed identity is
  // INSUFFICIENT_MARKET_EVIDENCE, not a confident number about whichever
  // family happened to be searched.
  const qualificationSubject = reconciliation.conflict
    ? { ...(identity?.subject || {}), model: null, variant: null }
    : (identity?.subject || {});
  const market = qualifyMarketEvidence({
    observations: research?.observations ?? [],
    subject: qualificationSubject,
  });
  // STATUS 'ok' EVEN WHEN NOTHING QUALIFIED, and the distinction lives in the
  // detail. The stage vocabulary is closed — ok / failed / skipped — because a
  // status that grows a new word per stage is how a consumer's switch acquires
  // a silent fall-through. "Ran, and granted nothing" is a successful stage.
  record('market_qualification', 'ok', now() - sq,
    (market.qualified || market.comparable_qualified)
      ? `${market.qualified ? 'VERIFIED_MARKET' : 'VERIFIED_COMPARABLE'}: `
        + `${market.counts.admitted} admitted across ${market.distinct_sources} sources`
      : `unqualified: ${market.set_failures.join(', ') || 'no admissible observation'}`,
    sq);

  // ── B6 · DETERMINISTIC VALUATION CANDIDATE ───────────────────────────────
  //
  // PRICED FROM THE OBSERVATIONS THAT GRANTED THE AUTHORITY. When the set
  // qualified, the distribution is computed from exactly the admitted listings
  // — otherwise GetWorth would be saying "these N observations imply this
  // price" about two different sets of listings, and the sentence in §21 would
  // be false in the one place it is supposed to be exactly true. Outlier
  // rejection still runs on top; qualification proves compatibility, not that
  // no admitted seller mistyped a zero.
  //
  // Unqualified sets still get a candidate, from Phase B's own accepted set,
  // because §12 requires "market found but guard rejected" to stay
  // distinguishable from "no market found". That candidate is simply never
  // granted anything.
  const s7 = now();
  //
  // A CLASS-LEVEL SET PRICES FROM ITS OWN ADMITTED LISTINGS too, for exactly
  // the reason the product-level one does: the sentence "these N observations
  // imply this price" has to be true about the same N observations that earned
  // the authority.
  const grantingSet = market.qualified ? market.token
    : (market.comparable_qualified ? market.comparable_token : null);
  const priceFrom = grantingSet ? rejectOutliers(grantingSet.observations).kept : kept;
  const valuation = computeValuationCandidate({
    accepted: priceFrom,
    condition: condition?.grade ?? null,
    identityConfidence: identity?.confidence?.overall ?? 0,
    specificity: query?.specificity ?? null,
  });
  record('valuation', 'ok', now() - s7, valuation.status, s7);

  // ── B7 · GETWORTH GUARD ──────────────────────────────────────────────────
  const s8 = now();
  const guard = applyGuard({
    valuationCandidate: valuation,
    identity,
    corroboration,
    recognition: existingRecognition,
    marketEvidence: market,
  });
  record('guard', guard.applied ? 'ok' : 'skipped', now() - s8, guard.action ?? guard.reason, s8);

  // ── B8 · STATUS ──────────────────────────────────────────────────────────
  const hasSubject = !!(identity?.subject?.brand || identity?.subject?.object_class);
  const priced = valuation.status === VALUATION_STATUS.PRICED;
  let status;
  if (!hasSubject) status = PHASE_B_STATUS.UNKNOWN;
  else if (priced && guard.action === 'accept') status = PHASE_B_STATUS.COMPLETE;
  // A price exists and the guard declined it. Reporting this as IDENTITY_ONLY
  // would claim Phase B found no market, which is the opposite of what
  // happened — see the note on PRICED_GUARD_WITHHELD.
  else if (priced) status = PHASE_B_STATUS.PRICED_GUARD_WITHHELD;
  else if (valuation.status === VALUATION_STATUS.PENDING_MARKET) status = PHASE_B_STATUS.IDENTIFIED_PENDING_MARKET;
  else status = PHASE_B_STATUS.IDENTITY_ONLY;

  return {
    status,
    failure_reason: null,
    identity_candidate: {
      ...identity,
      // BOTH READINGS TRAVEL TOGETHER. A consumer that wants to show the user
      // "we are not sure whether this is X or Y" now has the material to do it.
      reconciliation,
      // §11 made structural: the model's number and GetWorth's judgement are
      // different fields, so no reader can mistake one for the other.
      corroboration,
    },
    condition_candidate: condition,
    market_evidence: marketEvidence,
    valuation_candidate: valuation,
    validation: guard,
    timings: { ...timings, total_ms: now() - t0 },
    stages,
    model_metadata: { model: chosenModel, calls: ledger.summary() },
  };
}
