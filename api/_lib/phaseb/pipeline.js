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
import { corroborateSubject, applyGuard, CORROBORATION } from './validation.js';

export const PHASE_B_STATUS = Object.freeze({
  COMPLETE: 'COMPLETE',
  IDENTIFIED_PENDING_MARKET: 'IDENTIFIED_PENDING_MARKET',
  // ── THE STATUS THAT THE FIRST BENCHMARK RUN FORCED INTO EXISTENCE ─────────
  //
  // A candidate that IS priced, from genuine filtered comparables, and that the
  // GetWorth guard declined to accept. Collapsing it into IDENTITY_ONLY — which
  // is what the first version did — reads as "Phase B found no price", and that
  // is false in a way that matters: it hides the single most important result
  // of this phase.
  //
  // Every priced benchmark lands here, and the reason is always the same:
  //
  //   V-MARKET-EVIDENCE: market evidence pending
  //
  // The guard's only class of market evidence is ANCHOR — a GetWorth catalog
  // row carrying a price. Research-derived comparables are not that class and
  // cannot be, because §1 forbids OpenAI output from becoming a trusted anchor.
  // So NO Phase-B valuation can be accepted by the current guard, by
  // construction. That is the correct outcome of the authority boundary, not a
  // defect in it, and working around it would mean granting exactly the
  // authority §1 exists to withhold.
  //
  // It is also the concrete question a promotion layer has to answer: what
  // evidence class do verified market observations belong to, and what does it
  // entitle you to? Recorded in docs/PHASE_B_PRODUCTION_BLOCKERS.md.
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

  const record = (name, status, ms, detail = null) => {
    timings[`${name}_ms`] = ms;
    stages.push({ stage: name, status, duration_ms: ms, detail });
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
      record('openai_identity', 'ok', now() - s);
    } catch (err) {
      identityFailure = classifyOpenAIFailure(err?.message);
      record('openai_identity', 'failed', now() - s, identityFailure);
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

  // ── B5 · CONDITION (parallel-safe, but sequential here for clear timing) ──
  let condition = null;
  {
    const s = now();
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
      condition = data;
      record('condition', 'ok', now() - s);
    } catch (err) {
      record('condition', 'failed', now() - s, classifyOpenAIFailure(err?.message));
    }
  }

  // ── B3 · MARKET QUERY INTENT ─────────────────────────────────────────────
  let query = null;
  {
    const s = now();
    if (corroboration.level === CORROBORATION.CONTRADICTED) {
      // The block says this name belongs to a REFERENCED product. Searching it
      // would retrieve the host's market, so the stage is skipped with a reason.
      record('market_query', 'skipped', now() - s, 'subject contradicted by block provenance');
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
        query = data;
        record('market_query', 'ok', now() - s);
      } catch (err) {
        record('market_query', 'failed', now() - s, classifyOpenAIFailure(err?.message));
      }
    }
  }

  // ── B4 · CURRENT MARKET EVIDENCE ─────────────────────────────────────────
  let research = null;
  {
    const s = now();
    if (!query) {
      record('market_research', 'skipped', now() - s, 'no search intent');
    } else {
      const adapter = createMarketResearch({
        mechanism: marketMechanism, model: chosenModel, apiKey, ledger, language, fetchImpl, mockSearch,
      });
      try {
        research = await adapter.search(query);
        record('market_research', 'ok', now() - s, research.mechanism);
      } catch (err) {
        record('market_research', 'failed', now() - s, classifyOpenAIFailure(err?.message));
      }
    }
  }

  // ── B6a · NORMALISATION AND QUALITY FILTERING ────────────────────────────
  const s6 = now();
  const normalized = normalizeObservations(research?.observations ?? []);
  const { kept, dropped } = rejectOutliers(normalized.accepted);
  record('market_normalization', 'ok', now() - s6,
    `${kept.length} accepted / ${normalized.rejected.length + dropped.length} rejected / ${normalized.context.length} context`);

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

  // ── B6 · DETERMINISTIC VALUATION CANDIDATE ───────────────────────────────
  const s7 = now();
  const valuation = computeValuationCandidate({
    accepted: kept,
    condition: condition?.grade ?? null,
    identityConfidence: identity?.confidence?.overall ?? 0,
    specificity: query?.specificity ?? null,
  });
  record('valuation', 'ok', now() - s7, valuation.status);

  // ── B7 · GETWORTH GUARD ──────────────────────────────────────────────────
  const s8 = now();
  const guard = applyGuard({
    valuationCandidate: valuation,
    identity,
    corroboration,
    recognition: existingRecognition,
  });
  record('guard', guard.applied ? 'ok' : 'skipped', now() - s8, guard.action ?? guard.reason);

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
