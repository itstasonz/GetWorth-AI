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
import { identifyItem, completeIdentity, openVariant } from './identify.js';
import { researchMarket, marketDate, buildSearchQueries } from './market.js';
import { buildValuation, incompleteValuation, strategyFor, STRATEGY, verifyEvidence, mergeEvidence, requalify, marketKey, localStrength, LOCAL_STRENGTH } from './valuation.js';
import { getFxTable } from './fx.js';
import { loadMarketResearch, saveMarketResearch } from './persist.js';
import { loadMarketplaceSales, salesEvidenceFor } from './marketplace.js';
import { afterResponse } from './telemetry.js';
import { resolveMarketFreshMs, resolveMarketSwr } from './config.js';
import {
  CONDITIONS, MARKET_FRESH_MS, MARKET_POOL_MS, MARKET_CACHE_MAX_ENTRIES, MAX_FOLLOWUPS, MAX_USER_TEXT,
  resolveMarketParallel,
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
export const NOT_BILLED = /^(network|auth|rate_limited|credit_exhausted|upstream_5xx|not_configured|no_images|http_\d{3})$/;

/** The condition the screen starts on: what the photograph shows, else the middle of the ladder. */
// The condition the screen starts with: NONE (2026-11-12). The photograph's impression (identity.visible_condition) is shown
// as a hint and never chosen for the owner: a photo does not show whether a unit works, and "good" is never assumed.
export const startingCondition = () => null;

/**
 * Step 1. `prior` is the scan so far when this is a correction or an added
 * photograph: { identity, followups }. Identification is never cached: every
 * photograph is looked at.
 */
export async function runIdentify({ images, lang, correction = null, prior = null, model, apiKey, safetyIdentifier, fetchImpl = fetch } = {}) {
  const followupsUsed = prior?.followups ?? 0;
  const t0 = Date.now();
  try {
    const { identity: seen, meta } = await identifyItem({
      images, lang, correction, prior: prior?.identity ?? null,
      followupsLeft: MAX_FOLLOWUPS - followupsUsed,
      model, apiKey, safetyIdentifier, fetchImpl,
    });
    // Does the identity name ONE product the market can be searched for, and which question, if any, comes next? What the
    // owner confirmed in earlier rounds is kept and written over the model's guesses: a confirmed fact is never lost.
    const identity = completeIdentity(seen, { lang, followupsLeft: MAX_FOLLOWUPS - followupsUsed, confirmed: prior?.identity?.confirmed ?? null });
    // What the owner said the item is travels with the identity, so it is kept with the scan.
    if (correction) identity.owner_correction = String(correction).slice(0, MAX_USER_TEXT);
    // The label photograph was asked for once already (identify.js questionAfterResearch): that is not asked again.
    if (prior?.identity?.asked_label) identity.asked_label = true;
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
 * means the price is for the family and must say so. So does a listing-defining
 * variant of a technical item — a phone's storage — that nobody asked about and
 * nobody settled (identify.js openVariant): the listings found may be for
 * another variant, and the price is not presented as the exact product's.
 */
export const isApproximate = (identity, answer) => ((!answer || answer.unsure === true) && !!identity?.followup?.kind && identity.followup.kind !== 'none') || (identity?.confirmed ?? []).some((c) => c.unsure === true) || openVariant(identity) !== null;
/** Is only the item's family established, not its exact model? Then the family's members are its comparables. */
export const isFamilyLevel = (identity, answer) => !answer && identity?.exact_model_established !== true && identity?.identity_precision !== 'descriptive';

/**
 * Step 2. `answer` is { question, text } when the owner answered the question
 * step 1 asked; both strings come from the signed identity, never from a
 * request body.
 */
/**
 * THE RESEARCH IS THE SEARCH THAT MADE IT. The shared market cache (an hour, across every deployment) was keyed on the
 * item alone, so a release that changed how an item is searched for went on serving research its old searches made:
 * the founder's second G PRO Wireless scan (2026-11-08 11:10, scan 6f0a57d4) on 01a9fc1 reused the 10:55 research from
 * b5a587a, and the new single-listing query abroad never ran. The key now carries the planned queries of both stages
 * (and RESEARCH_VERSION for changes to how pages are read and classified): change the search, and the next scan searches.
 * An answer that changes no query still changes no key (strategy.js marketKey, market.js searchNames).
 */
// 3: the Israel-first wider stage (2026-11-08).
// 4: pages read by the 2026-11-12 rules — a variant after the name is another model, another capacity is another
//    variant, a shop's product page is professional resale. Research read by the older rules (a DualSense priced from a
//    DualSense Edge ad) is not reused.
export const RESEARCH_VERSION = 4;
function fnv1a(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
export function researchKey(identity, answer = null) {
  const plan = ['local', 'expand'].map((stage) => buildSearchQueries({ identity, answer, stage }).join(' ; ')).join(' || ');
  return `${marketKey(identity, answer)}|r${RESEARCH_VERSION}:${fnv1a(plan)}`;
}

export async function runPrice({
  identity, answer = null, scanUuid = null, model, apiKey, safetyIdentifier, fetchImpl = fetch, now = Date.now, store = defaultStore,
  parallel = resolveMarketParallel(),
  // Genuine GetWorth sales (marketplace.js): read alongside the research, never cached with it, never blocking it.
  marketplace = loadMarketplaceSales,
  freshMs = resolveMarketFreshMs(), swr = resolveMarketSwr(),
  // Where a stale-while-revalidate refresh runs: after the response (telemetry.js afterResponse, Vercel's waitUntil).
  background = afterResponse,
} = {}) {
  const t0 = now();
  const key = researchKey(identity, answer);
  const approximate = isApproximate(identity, answer);
  const familyLevel = isFamilyLevel(identity, answer);
  // How this KIND of item is valued, chosen from what it is (valuation.js strategyFor), never from the evidence found.
  const strategy = strategyFor(identity);
  const salesPending = identity?.incomplete ? Promise.resolve([]) : Promise.resolve().then(() => marketplace({ now: t0 })).catch(() => []);
  const priced = async (record, extra) => {
    const sales = salesEvidenceFor(identity, await salesPending, { today: marketDate(t0) });
    const valuation = buildValuation({
      evidence: [...record.evidence, ...sales], searchPerformed: record.search_performed !== false, unverified: record.unverified ?? 0,
      approximate, familyLevel, strategy, searched: { ...record.searched, at: new Date(record.at).toISOString() },
      // A listing's age is measured to TODAY, not to the day it was retrieved: pooled and reused evidence ages.
      today: marketDate(t0),
    });
    return {
      status: valuation.status === 'priced' ? SCAN_STATUS.PRICED : SCAN_STATUS.INSUFFICIENT,
      valuation, market_key: key, fx_date: record.fx_date ?? null, ...extra,
    };
  };
  const noCall = { stage: 'market', model, ms: 0, usage: null, tool_calls: 0, first_search_ms: null };
  // AN IDENTITY THAT NAMES NO ONE PRODUCT IS NOT SEARCHED FOR. A house of perfume or a brand of blender is a catalogue;
  // a search for it buys other products' prices (2026-10-11). No call is made and no number is given: the scan asked
  // for the photograph that would settle it.
  if (identity?.incomplete) return { status: SCAN_STATUS.INSUFFICIENT, valuation: incompleteValuation(identity.incomplete), market_key: null, fx_date: null, reused: false, call: noCall };

  // The exchange rates are only needed once a search has answered: they are fetched alongside it, never before it
  // (a cold instance waited up to FX_TIMEOUT_MS here first). getFxTable never throws.
  const fxPending = getFxTable({ fetchImpl });
  const earlier = await recall(key, store, t0);
  // Fresh research for this item: reuse it. No search, the same evidence, the same price.
  if (earlier && t0 - earlier.at <= freshMs) return priced(earlier, { reused: true, call: { ...noCall, ms: now() - t0 } });
  // STALE WHILE REVALIDATE: older research for this product answers now, said to be refreshing; one background search
  // per product per instance renews it for the next request (the app asks once more: coreScan.js).
  if (earlier && swr) {
    if (!refreshing.has(key)) {
      refreshing.add(key);
      background(research().catch(() => null).finally(() => refreshing.delete(key)));
    }
    return priced(earlier, { reused: true, stale: true, refreshing: true, call: { ...noCall, ms: now() - t0 } });
  }
  return research();

  /** A fresh search for this product; its record joins the shared store. */
  async function research() {

  const today = marketDate(t0);
  const stages = [];
  const usage = { input_tokens: 0, output_tokens: 0, reasoning_tokens: 0 };
  let found = [];
  let unverified = 0;
  let queries = 0;
  let planned = 0;
  let pages = 0;
  // WHERE EVIDENCE IS LOST, stage by stage: the hosts the search reached, how many prices the model reported from them,
  // and how many of those the page text verified. (Scan 62a07b50, 2026-11-08: 83 pages reached, 5 references kept, and no
  // record of which hosts the 83 were — the loss could not be placed.) Hosts and counts only.
  const funnel = [];
  let searched = false;
  let firstSearchMs = null;
  let usedModel = model;
  /** One stage's provider request. Throws what the provider threw. */
  const request = (stage, signal = null) => researchMarket({ identity, answer, stage, model, apiKey, safetyIdentifier, fetchImpl, now: t0, signal });
  /** A stage's answer, verified: its evidence joins what is in hand. */
  const accept = async (stage, { raw, provenance, meta }) => {
    const fx = await fxPending;
    const verified = verifyEvidence(raw?.evidence, provenance, fx, today, { identity, answer });
    found = mergeEvidence(found, verified.evidence);
    unverified += verified.unverified;
    queries += provenance.queries?.length ?? 0;
    planned += meta.queries_planned ?? 0;
    pages += provenance.sources?.length ?? 0;
    const hosts = {};
    for (const u of provenance.sources ?? []) { const h = (String(typeof u === 'string' ? u : u?.url ?? '').match(/^https?:\/\/(?:www\.)?([^/?#:]+)/i)?.[1] ?? '?').toLowerCase(); hosts[h] = (hosts[h] ?? 0) + 1; }
    funnel.push({ stage, reached: provenance.sources?.length ?? 0, hosts: Object.fromEntries(Object.entries(hosts).sort((a, b) => b[1] - a[1]).slice(0, 15)), reported: Array.isArray(raw?.evidence) ? raw.evidence.length : 0, verified: verified.evidence.length, unverified: verified.unverified });
    searched = searched || provenance.search_performed;
    firstSearchMs ??= meta.timings?.first_search_ms ?? null;
    usedModel = meta.model ?? usedModel;
    for (const k of Object.keys(usage)) usage[k] += meta.usage?.[k] ?? 0;
    stages.push(stage);
  };
  const call = () => ({
    stage: 'market', model: usedModel, ms: now() - t0, usage: stages.length ? usage : null,
    tool_calls: stages.length, first_search_ms: firstSearchMs, stages: [...stages],
    // Stages that were started alongside the Israeli search and cancelled: their evidence is not in the price, but the
    // request was made and may have been billed.
    cancelled: [...cancelled],
  });

  // LOOK FURTHER ONLY WHEN ISRAEL DID NOT ANSWER. Decided by the server, from the verified evidence in hand (this
  // search and the pool), not left to the model: enough good local evidence stops the search, thin local evidence
  // widens it once. The line is the one the valuation itself draws: from LOCAL_STRENGTH.drives the Israeli evidence
  // prices the item alone, so a search abroad would buy nothing. A thing valued from SIMILAR items never goes abroad
  // either: a similar sofa in another country is never priced from (valuation.js), so the second search would buy
  // nothing but foreign context.
  const widens = (evidence) => strategy !== STRATEGY.COMPARABLE
    && localStrength(mergeEvidence(evidence, earlier?.evidence), { familyLevel, strategy, today }) < LOCAL_STRENGTH.drives;
  // The wider request depends on the identity alone, so it starts WITH the Israeli one (config.js
  // SCAN_MARKET_PARALLEL_ENV) whenever it could be needed at all; whether its evidence is used is still decided above.
  const cancel = new AbortController();
  const cancelled = [];
  const settle = (p) => p.then((res) => ({ res }), (err) => ({ err }));
  const early = parallel && widens([]) ? settle(request('expand', cancel.signal)) : null;
  const drop = () => { if (early && !cancel.signal.aborted) { cancel.abort(); cancelled.push('expand'); } };

  // ISRAEL FIRST.
  try { await accept('local', await request('local')); } catch (err) {
    drop();
    const failure = classifyOpenAIFailure(err?.message);
    console.warn(`[Scan] market failed stage=local code=${failure}`);
    // The search failed, but evidence gathered for this item in the last days is still evidence.
    if (earlier) return priced(earlier, { reused: true, stale: true, call: call() });
    return { status: SCAN_STATUS.FAILED, failure, valuation: null, reused: false, call: call() };
  }
  if (widens(found)) {
    const wide = early ?? settle(request('expand'));
    try {
      const { res, err } = await wide;
      if (err) throw err;
      await accept('expand', res);
    } catch (err) {
      // The wider search failing leaves the local search's evidence standing.
      console.warn(`[Scan] market failed stage=expand code=${classifyOpenAIFailure(err?.message)}`);
    }
  } else drop();
  const fx = await fxPending;

  const record = {
    at: t0,
    // What an earlier search found for this same item still counts: the pool grows, the price settles.
    evidence: mergeEvidence(found, earlier?.evidence),
    unverified,
    search_performed: searched,
    // `planned` is how many queries the server built; `queries` how many the tool's own record says it ran.
    searched: { date: today, queries, planned, pages, stages: [...stages], funnel },
    fx_date: fx?.rate_date ?? null,
  };
  // Only research that really searched is worth keeping.
  if (searched) {
    remember(key, record);
    try { await store.save(key, record, scanUuid); } catch { /* the answer does not depend on the write */ }
  }
  return priced(record, { reused: false, call: call() });
  }
}

/** Products whose research this instance is renewing in the background. */
const refreshing = new Set();
