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
// COST-CONTROLLED. Every research is a paid call. The job does NOTHING unless
// the deployment names how many products a run may research
// (PREWARM_MAX_PRODUCTS, 0 by default, at most PREWARM_HARD_MAX), and the
// estimate is stated before a run. Enabling it is the founder's decision.
// ══════════════════════════════════════════════════════════════════════════════
import { researchKey } from './service.js';
import { strategyFor, STRATEGY } from './strategy.js';

export const PREWARM_MAX_ENV = 'PREWARM_MAX_PRODUCTS';
export const PREWARM_HARD_MAX = 25;
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
export async function runPrewarm(plan, { price, budgetMs = 240_000, now = Date.now, ...priceArgs }) {
  const t0 = now();
  const out = { planned: plan.products.length, reused: 0, researched: 0, priced: 0, failed: 0, skipped: 0 };
  for (const p of plan.products) {
    if (now() - t0 > budgetMs) { out.skipped += 1; continue; }
    try {
      const r = await price({ identity: p.identity, answer: null, scanUuid: crypto.randomUUID(), freshMs: REFRESH_AFTER_MS, swr: false, ...priceArgs });
      if (r?.status === 'failed') out.failed += 1;
      else if (r?.reused) out.reused += 1;
      else out.researched += 1;
      if (r?.status === 'priced') out.priced += 1;
    } catch { out.failed += 1; }
  }
  return out;
}
