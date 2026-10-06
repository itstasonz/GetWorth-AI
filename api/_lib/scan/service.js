// ══════════════════════════════════════════════════════════════════════════════
// CORE SCAN — THE TWO STEPS
//
//   identify   photograph(s)            → what it is
//   price      that identity (+ answer) → what it sells for second-hand in Israel
//
// Two steps rather than one call, for the person holding the phone: the item's
// name is on the screen while the market is still being looked up.
//
// THE PRICE STEP SEARCHES ISRAEL FIRST. One search action looks for Israeli
// second-hand listings and the Israeli new price. The server then weighs the
// verified Israeli evidence in hand, and only when it is thin does a second
// search action look abroad and try the Israeli market again in other words.
// Enough good local evidence stops the search; the model does not decide.
//
// THE PRICE STEP IS STABLE BY CONSTRUCTION:
//   · market research belongs to the ITEM, not to the photograph. It is kept
//     under a key built from what the item is (valuation.js `marketKey`), so two
//     photographs of the same product read the same research;
//   · research younger than an hour is REUSED: no new search, the same evidence,
//     and therefore — the pricing being deterministic — the same price;
//   · older research is not thrown away when a new search runs: its evidence
//     joins the new evidence, so the pool grows and the price settles instead
//     of jumping with whichever listings appeared today;
//   · the price itself is computed by the server from that pool, never chosen
//     by the model.
//
// Both steps resolve in every case to a result with a `status`; a provider
// failure is a status with a classified reason, never a thrown error and never
// a made-up answer. Every provider call is made here and nowhere else.
// ══════════════════════════════════════════════════════════════════════════════
import { classifyOpenAIFailure } from '../openai-recognition.js';
import { identifyItem } from './identify.js';
import { researchMarket, marketDate } from './market.js';
import { buildValuation, verifyEvidence, mergeEvidence, requalify, marketKey, localStrength, LOCAL_STRENGTH } from './valuation.js';
import { getFxTable } from './fx.js';
import { loadMarketResearch, saveMarketResearch } from './persist.js';
import {
  CONDITIONS, DEFAULT_CONDITION, MARKET_FRESH_MS, MARKET_POOL_MS, MARKET_CACHE_MAX_ENTRIES, MAX_FOLLOWUPS, MAX_USER_TEXT,
} from './config.js';

export const SCAN_STATUS = Object.freeze({
  IDENTIFIED: 'identified',
  NO_ITEM: 'no_item',
  PRICED: 'priced',
  INSUFFICIENT: 'insufficient_evidence',
  FAILED: 'failed',
});

// The failures in which the provider answered with an error status or was never
// reached, so nothing was generated and nothing charged. A timeout is NOT here:
// it can strike mid-stream, after the tokens were billed.
const NOT_BILLED = /^(network|auth|rate_limited|upstream_5xx|not_configured|no_images|http_\d{3})$/;

/** The condition the screen starts on: what the photograph shows, else the middle of the ladder. */
export const startingCondition = (identity) => (CONDITIONS.includes(identity?.visible_condition) ? identity.visible_condition : DEFAULT_CONDITION);

/**
 * Step 1. `prior` is the scan so far when this is a correction or an added
 * photograph: { identity, followups }. Identification is never cached: every
 * photograph is looked at.
 */
export async function runIdentify({ images, lang, correction = null, prior = null, model, apiKey, safetyIdentifier, fetchImpl = fetch } = {}) {
  const followupsUsed = prior?.followups ?? 0;
  const t0 = Date.now();
  try {
    const { identity, meta } = await identifyItem({
      images, lang, correction, prior: prior?.identity ?? null,
      followupsLeft: MAX_FOLLOWUPS - followupsUsed,
      model, apiKey, safetyIdentifier, fetchImpl,
    });
    // What the owner said the item is travels with the identity, so it is kept with the scan.
    if (correction) identity.owner_correction = String(correction).slice(0, MAX_USER_TEXT);
    return {
      status: identity.is_sellable_item ? SCAN_STATUS.IDENTIFIED : SCAN_STATUS.NO_ITEM,
      identity,
      followups: followupsUsed + (identity.followup.kind === 'none' ? 0 : 1),
      default_condition: startingCondition(identity),
      billed: meta.billed,
      call: { stage: 'identify', model: meta.model, ms: Date.now() - t0, usage: meta.usage, first_output_ms: meta.timings?.first_output_ms ?? null },
    };
  } catch (err) {
    const failure = classifyOpenAIFailure(err?.message);
    console.warn(`[Scan] identify failed code=${failure}`);
    return {
      status: SCAN_STATUS.FAILED, failure, identity: null, followups: followupsUsed,
      billed: !NOT_BILLED.test(String(failure)),
      call: { stage: 'identify', model, ms: Date.now() - t0, usage: null, first_output_ms: null },
    };
  }
}

// ── MARKET RESEARCH, KEPT BY ITEM ───────────────────────────────────────────
// Two layers under one key. This server instance's own memory answers first;
// the shared store (persist.js) is what makes a second instance, or a scan an
// hour from now, see the same research. A record holds the qualified evidence
// and when it was gathered — never a photograph, an account or a token.
const memory = new Map();
function remember(key, record) {
  memory.delete(key);
  if (memory.size >= MARKET_CACHE_MAX_ENTRIES) memory.delete(memory.keys().next().value);
  memory.set(key, record);
}
/** For the suites. */
export function resetMarketCache() { memory.clear(); }

const defaultStore = Object.freeze({ load: loadMarketResearch, save: saveMarketResearch });
// Kept research is read by today's rules (evidence.js `requalify`), whichever version of them gathered it.
const usable = (record, now) => (record && Array.isArray(record.evidence) && typeof record.at === 'number' && now - record.at <= MARKET_POOL_MS
  ? { ...record, evidence: record.evidence.map(requalify) } : null);

/** The most recent research for a market identity, from memory or the shared store, or null. */
async function recall(key, store, now) {
  const mine = usable(memory.get(key), now);
  if (mine && now - mine.at <= MARKET_FRESH_MS) return mine;
  let shared = null;
  try { shared = usable(await store.load(key), now); } catch { shared = null; }
  const latest = shared && (!mine || shared.at > mine.at) ? shared : mine;
  if (latest) remember(key, latest);
  return latest;
}

/**
 * Is the item's exact model or generation still an open question that would
 * move the price? Step 1 asks a question only then, so an unanswered question
 * means the price is for the family and must say so.
 */
export const isApproximate = (identity, answer) => !answer && !!identity?.followup?.kind && identity.followup.kind !== 'none';
/** Is only the item's family established, not its exact model? Then the family's members are its comparables. */
export const isFamilyLevel = (identity, answer) => !answer && identity?.exact_model_established !== true;

/**
 * Step 2. `answer` is { question, text } when the owner answered the question
 * step 1 asked; both strings come from the signed identity, never from a
 * request body.
 */
export async function runPrice({
  identity, answer = null, scanUuid = null, model, apiKey, safetyIdentifier, fetchImpl = fetch, now = Date.now, store = defaultStore,
} = {}) {
  const t0 = now();
  const key = marketKey(identity, answer);
  const approximate = isApproximate(identity, answer);
  const familyLevel = isFamilyLevel(identity, answer);
  const priced = (record, extra) => {
    const valuation = buildValuation({
      evidence: record.evidence, searchPerformed: record.search_performed !== false, unverified: record.unverified ?? 0,
      approximate, familyLevel, searched: { ...record.searched, at: new Date(record.at).toISOString() },
      // A listing's age is measured to TODAY, not to the day it was retrieved: pooled and reused evidence ages.
      today: marketDate(t0),
    });
    return {
      status: valuation.status === 'priced' ? SCAN_STATUS.PRICED : SCAN_STATUS.INSUFFICIENT,
      valuation, market_key: key, fx_date: record.fx_date ?? null, ...extra,
    };
  };
  const noCall = { stage: 'market', model, ms: 0, usage: null, tool_calls: 0, first_search_ms: null };

  const earlier = await recall(key, store, t0);
  // Fresh research for this item: reuse it. No search, the same evidence, the same price.
  if (earlier && t0 - earlier.at <= MARKET_FRESH_MS) return priced(earlier, { reused: true, call: { ...noCall, ms: now() - t0 } });

  const fx = await getFxTable({ fetchImpl });
  const today = marketDate(t0);
  const stages = [];
  const usage = { input_tokens: 0, output_tokens: 0, reasoning_tokens: 0 };
  let found = [];
  let unverified = 0;
  let queries = 0;
  let pages = 0;
  let searched = false;
  let firstSearchMs = null;
  let usedModel = model;
  /** One search stage: its verified evidence joins what is in hand. Throws what the provider threw. */
  const search = async (stage) => {
    const { raw, provenance, meta } = await researchMarket({ identity, answer, stage, model, apiKey, safetyIdentifier, fetchImpl, now: t0 });
    const verified = verifyEvidence(raw?.evidence, provenance, fx, today, { identity, answer });
    found = mergeEvidence(found, verified.evidence);
    unverified += verified.unverified;
    queries += provenance.queries?.length ?? 0;
    pages += provenance.sources?.length ?? 0;
    searched = searched || provenance.search_performed;
    firstSearchMs ??= meta.timings?.first_search_ms ?? null;
    usedModel = meta.model ?? usedModel;
    for (const k of Object.keys(usage)) usage[k] += meta.usage?.[k] ?? 0;
    stages.push(stage);
  };
  const call = () => ({
    stage: 'market', model: usedModel, ms: now() - t0, usage: stages.length ? usage : null,
    tool_calls: stages.length, first_search_ms: firstSearchMs, stages: [...stages],
  });

  // ISRAEL FIRST.
  try { await search('local'); } catch (err) {
    const failure = classifyOpenAIFailure(err?.message);
    console.warn(`[Scan] market failed stage=local code=${failure}`);
    // The search failed, but evidence gathered for this item in the last days is still evidence.
    if (earlier) return priced(earlier, { reused: true, stale: true, call: call() });
    return { status: SCAN_STATUS.FAILED, failure, valuation: null, reused: false, call: call() };
  }
  // LOOK FURTHER ONLY WHEN ISRAEL DID NOT ANSWER. Decided here, from the verified
  // evidence in hand (this search and the pool), not left to the model: enough
  // good local evidence stops the search, thin local evidence widens it once.
  // The line is the one the valuation itself draws: from LOCAL_STRENGTH.drives the Israeli evidence prices
  // the item alone, so a search abroad would buy nothing.
  const local = localStrength(mergeEvidence(found, earlier?.evidence), { familyLevel, today });
  if (local < LOCAL_STRENGTH.drives) {
    try { await search('expand'); } catch (err) {
      // The wider search failing leaves the local search's evidence standing.
      console.warn(`[Scan] market failed stage=expand code=${classifyOpenAIFailure(err?.message)}`);
    }
  }

  const record = {
    at: t0,
    // What an earlier search found for this same item still counts: the pool grows, the price settles.
    evidence: mergeEvidence(found, earlier?.evidence),
    unverified,
    search_performed: searched,
    searched: { date: today, queries, pages, stages: [...stages] },
    fx_date: fx?.rate_date ?? null,
  };
  // Only research that really searched is worth keeping.
  if (searched) {
    remember(key, record);
    try { await store.save(key, record, scanUuid); } catch { /* the answer does not depend on the write */ }
  }
  return priced(record, { reused: false, call: call() });
}
