// ══════════════════════════════════════════════════════════════════════════════
// CORE SCAN — PRE-RESEARCH FOR PRODUCTS PEOPLE ACTUALLY SCAN
//
// A scan whose product was researched in the last day prices from the shared
// store in ~1 s instead of a ~14 s web search (service.js runPrice). This job
// keeps that true for the products with demonstrated demand: it reads the
// identities of recent core scans (valuations rows, written by the scan itself),
// groups them by the research they would run (service.js researchKey), ranks
// them by how often they were scanned, and re-runs the SAME research the scan
// would run for the top few whose research is about to go stale.
//
// What it is not: a source of prices. It runs the scan's own search and the
// scan's own evidence rules; what it stores is evidence with its provenance,
// and a product whose evidence does not qualify stays unpriced. Nothing is
// invented and nothing new is collected.
//
// COST-CONTROLLED (founder approval 2026-11-08: at most 10 products and $0.30 a
// day, only once OpenAI credit is restored, with monitoring, alerts and an
// immediate off switch). The limits are in this file, not only in settings:
//   • PREWARM_HARD_MAX products and PREWARM_USD_HARD_MAX dollars per UTC day —
//     the deployment's settings may lower them, never raise them;
//   • the day's spend is a LEDGER of every run's measured cost (scan_events
//     core_scan_prewarm), so a second run the same day gets only what is left;
//   • no research starts unless the worst it can cost still fits
//     (WORST_RESEARCH_USD: 2 stages × 1 search call × $0.01, 2 × 3,000 output
//     tokens, and a generous input allowance — measured mean $0.021);
//   • a one-token credit check runs first: no credit, no run, and an alert;
//   • an admin pause (core_scan_prewarm_control) is read before EVERY product.
// ══════════════════════════════════════════════════════════════════════════════
import { researchKey } from './service.js';
import { strategyFor, STRATEGY } from './strategy.js';
import { streamResponse } from '../v2/openai-stream.js';
import { classifyOpenAIFailure } from '../openai-recognition.js';

export const PREWARM_MAX_ENV = 'PREWARM_MAX_PRODUCTS';
/** The most a run may spend, in US dollars, measured from each call's own usage. 0 (unset) means the job does nothing. */
export const PREWARM_USD_ENV = 'PREWARM_DAILY_USD_CAP';
export const PREWARM_USD_HARD_MAX = 0.30;
/**
 * Published prices (developers.openai.com/api/docs/pricing, read 2026-11-08): gpt-6-luna $0.10 / $0.50 per million
 * input / output tokens; web search $10 per 1,000 calls, search content billed as input tokens. The 2026-11-08 controlled
 * test measured $0.012-0.024 per fresh research (mean $0.021 over 10 products).
 */
export const PRICES = Object.freeze({ input: 0.10 / 1e6, output: 0.50 / 1e6, search_call: 0.01 });
/** What one price-step call cost, from its own usage. A call with no usage reported is charged the worst case. */
export const costOf = (call) => (call?.usage
  ? (call.usage.input_tokens ?? 0) * PRICES.input + (call.usage.output_tokens ?? 0) * PRICES.output + (call.tool_calls ?? 0) * PRICES.search_call
  : (call?.ms ? WORST_RESEARCH_USD : 0));
/** The most one research has been seen to cost, with headroom: the run stops before a call that could cross the cap. */
export const WORST_RESEARCH_USD = 0.08;
/** The run's dollar cap: 0 unless the deployment sets one, never above the hard maximum. */
export function resolvePrewarmUsd(env = process.env) {
  const n = Number.parseFloat(String(env?.[PREWARM_USD_ENV] ?? ''));
  return Number.isFinite(n) && n > 0 ? Math.min(n, PREWARM_USD_HARD_MAX) : 0;
}
export const PREWARM_HARD_MAX = 10;
/**
 * THE TRIAL (founder approval: 10 days, at most $3 in all). Fixed dates in code, so no deployment, restart or setting can
 * restart it: the job runs only inside [start, end), and the trial's spend is the ledger of every run since `start`
 * (scan_events core_scan_prewarm), never a counter that a redeploy could zero. OpenAI credit returned 2026-11-10, after
 * that day's 03:00 UTC run; the first run that can spend is 2026-11-11 03:00 UTC, the last 2026-11-20 03:00 UTC.
 */
export const PREWARM_TRIAL = Object.freeze({ start: '2026-11-11T00:00:00.000Z', end: '2026-11-21T00:00:00.000Z', usd: 3.00 });
/** Where the trial stands at `now`, given every run recorded since it started: { open, reason, spent_usd, left_usd }. */
export function trialState(runs, { now = Date.now(), trial = PREWARM_TRIAL } = {}) {
  const spent = spentToday((Array.isArray(runs) ? runs : []).filter((r) => String(r?.created_at ?? '') >= trial.start));
  const left = Math.round(Math.max(0, Math.min(trial.usd, PREWARM_TRIAL_USD_HARD_MAX) - spent) * 10000) / 10000;
  const at = new Date(now).toISOString();
  const reason = at < trial.start ? 'trial_not_started' : at >= trial.end ? 'trial_ended' : left < WORST_RESEARCH_USD ? 'trial_budget_spent' : null;
  return { open: reason === null, reason, spent_usd: spent, left_usd: left };
}
export const PREWARM_TRIAL_USD_HARD_MAX = 3.00;
export const DEMAND_WINDOW_DAYS = 30;
/**
 * The measured cost of one fresh research, in US dollars: the 2026-10-11 live probe of one market stage cost $0.014
 * (OpenAI usage), and a fresh research runs at most two stages. An ESTIMATE for planning, not a price list.
 */
export const EST_USD_PER_RESEARCH = 0.03;
/** Research younger than this is left alone: the scan itself reuses it for a day (config.js MARKET_FRESH_MS). */
export const REFRESH_AFTER_MS = 20 * 3_600_000;

/** How many products a run may research: 0 (off) unless the deployment says otherwise, never above the hard maximum. */
export function resolvePrewarmMax(env = process.env) {
  const n = Number.parseInt(String(env?.[PREWARM_MAX_ENV] ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, PREWARM_HARD_MAX) : 0;
}

/**
 * Demand from stored core scans: one entry per research key, with the most recent identity that asked for it.
 * `rows` are valuations rows ({ created_at, ai_raw_response }). Items whose market this engine prices no number for
 * (a car, a luxury watch, a collectible) are left out: researching them buys nothing.
 */
export function demandFrom(rows, { now = Date.now(), days = DEMAND_WINDOW_DAYS } = {}) {
  const since = now - days * 86_400_000;
  const byKey = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const raw = row?.ai_raw_response;
    const identity = raw?.engine === 'core_scan' ? raw.identity : null;
    const at = Date.parse(row?.created_at ?? '');
    if (!identity?.is_sellable_item || !Number.isFinite(at) || at < since) continue;
    if (strategyFor(identity) === STRATEGY.SPECIALISED) continue;
    let key;
    try { key = researchKey(identity); } catch { continue; }
    const have = byKey.get(key);
    if (!have) byKey.set(key, { key, identity, scans: 1, last_at: at });
    else { have.scans += 1; if (at > have.last_at) { have.last_at = at; have.identity = identity; } }
  }
  return [...byKey.values()].sort((a, b) => b.scans - a.scans || b.last_at - a.last_at);
}

/** The products a run researches, at most `max`, and what that is expected to cost. */
export function planPrewarm(demand, { max }) {
  const take = (Array.isArray(demand) ? demand : []).slice(0, Math.max(0, Math.min(max, PREWARM_HARD_MAX)));
  return { products: take, estimated_usd: Math.round(take.length * EST_USD_PER_RESEARCH * 100) / 100 };
}

/**
 * Run a plan: each product through the scan's own price step (`price` is service.js runPrice), research reused when it
 * is still fresh and searched again otherwise — inline, never in the background. Sequential, inside `budgetMs`.
 * Resolves to counts only: no identity, no account, no page text.
 */
export async function runPrewarm(plan, { price, budgetMs = 240_000, usdCap = 0, paused = async () => false, now = Date.now, ...priceArgs }) {
  const t0 = now();
  const out = { planned: plan.products.length, reused: 0, researched: 0, priced: 0, failed: 0, skipped: 0, spent_usd: 0, stopped: null };
  for (const p of plan.products) {
    // THE SPENDING CAP: no research starts that could take the run past it. THE OFF SWITCH: read before every product.
    if (out.stopped) { out.skipped += 1; continue; }
    if (out.spent_usd + WORST_RESEARCH_USD > usdCap) { out.stopped = 'cap'; out.skipped += 1; continue; }
    if (now() - t0 > budgetMs) { out.stopped = 'time'; out.skipped += 1; continue; }
    let stop = true;
    try { stop = await paused(); } catch { stop = true; }
    if (stop) { out.stopped = 'paused'; out.skipped += 1; continue; }
    try {
      const r = await price({ identity: p.identity, answer: null, scanUuid: crypto.randomUUID(), freshMs: REFRESH_AFTER_MS, swr: false, ...priceArgs });
      out.spent_usd = Math.round((out.spent_usd + costOf(r?.call)) * 10000) / 10000;
      if (r?.status === 'failed') out.failed += 1;
      else if (r?.reused) out.reused += 1;
      else out.researched += 1;
      if (r?.status === 'priced') out.priced += 1;
    } catch { out.failed += 1; out.spent_usd = Math.round((out.spent_usd + WORST_RESEARCH_USD) * 10000) / 10000; }
  }
  return out;
}

// ── MONITORING, ALERTS AND THE OFF SWITCH ───────────────────────────────────
export const RUN_EVENT = 'core_scan_prewarm';
export const CONTROL_EVENT = 'core_scan_prewarm_control';
export const ALERT_EVENT = 'core_scan_alert';
export const ALERT = Object.freeze({
  CREDIT: 'openai_credit_exhausted', CAP: 'prewarm_daily_cap_reached', FAILURES: 'prewarm_failures',
  OVER_CAP: 'prewarm_spend_over_cap', DEMAND: 'prewarm_demand_unreadable', TRIAL_OVER: 'prewarm_trial_over',
});
/** The start of today, UTC: the day a daily cap is counted in. */
export const dayStart = (now = Date.now()) => new Date(Math.floor(now / 86_400_000) * 86_400_000).toISOString();
/** What today's runs spent, from their own recorded summaries. */
export const spentToday = (runs) => Math.round((Array.isArray(runs) ? runs : []).reduce((n, r) => n + (Number(r?.payload?.spent_usd) || 0) + (Number(r?.payload?.preflight_usd) || 0), 0) * 10000) / 10000;
/** Paused when the most recent control event says so. No control event: not paused. */
export const isPaused = (controls) => {
  const latest = [...(Array.isArray(controls) ? controls : [])].sort((a, b) => String(b?.created_at).localeCompare(String(a?.created_at)))[0];
  return latest?.payload?.enabled === false;
};
/** The alerts a finished run raises. */
export function alertsFor(summary, { usdCap }) {
  const out = [];
  const tried = (summary.researched ?? 0) + (summary.reused ?? 0) + (summary.failed ?? 0);
  if (tried > 0 && summary.failed * 2 >= tried) out.push({ kind: ALERT.FAILURES, failed: summary.failed, tried });
  if (summary.spent_today_usd > usdCap) out.push({ kind: ALERT.OVER_CAP, spent_today_usd: summary.spent_today_usd, cap_usd: usdCap });
  if (summary.skipped > 0 && summary.stopped === 'cap') out.push({ kind: ALERT.CAP, spent_today_usd: summary.spent_today_usd, cap_usd: usdCap });
  return out;
}

/**
 * Is there OpenAI credit? One request of a few tokens (a fraction of a hundredth of a cent), through the one shared
 * streaming client every scan call uses. Resolves to { ok, credit_exhausted, status, cost_usd }. Never throws; a network
 * failure is "not ok", not "no credit".
 */
export async function checkCredit({ apiKey, model, stream = streamResponse, timeoutMs = 10_000 }) {
  try {
    const r = await stream({ stage: 'prewarm_credit', apiKey, timeoutMs, body: { model, input: 'ok', max_output_tokens: 16, store: false } });
    return { ok: true, credit_exhausted: false, status: 200, cost_usd: costOf({ usage: r?.usage ?? { input_tokens: 50, output_tokens: 16 } }) };
  } catch (err) {
    const code = classifyOpenAIFailure(err?.message);
    const status = Number(String(err?.message ?? '').match(/API (\d{3})/)?.[1]) || null;
    return { ok: false, credit_exhausted: code === 'credit_exhausted', status, cost_usd: 0 };
  }
}
