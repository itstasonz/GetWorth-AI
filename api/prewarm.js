// ══════════════════════════════════════════════════════════════════════════════
// GET /api/prewarm — the daily pre-research run (vercel.json crons)
//
// Keeps the research of the products people actually scan fresh, so their next
// scan prices from the store in about a second (_lib/scan/prewarm.js says what
// it does and what it does not).
//
// DORMANT UNTIL APPROVED. It answers 401 to anything but the platform's cron
// (Authorization: Bearer CRON_SECRET, compared in constant time; no secret
// configured means every request is refused), and with PREWARM_MAX_PRODUCTS
// unset or 0 it does nothing and spends nothing. The founder sets the cap.
//
// Reads: recent core-scan valuations (identities only) through the server's own
// database role. Writes: the research records the scan itself writes, and one
// summary event of counts. No account, photograph or page text leaves it.
// ══════════════════════════════════════════════════════════════════════════════
import { getServiceClient } from './_lib/scan/quota.js';
import { runPrice } from './_lib/scan/service.js';
import { resolveScanMode, resolveMarketModel, SCAN_KEY_ENV, SCAN_MODE } from './_lib/scan/config.js';
import { logScanEvent } from './_lib/scan/persist.js';
import { resolvePrewarmMax, demandFrom, planPrewarm, runPrewarm, DEMAND_WINDOW_DAYS } from './_lib/scan/prewarm.js';

// Must stay a literal: Vercel reads it statically.
export const config = { maxDuration: 300 };

const reply = (res, status, body) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(body)); };

/** Constant-time comparison of two secrets by their SHA-256 digests. */
export async function sameSecret(a, b) {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(String(a))), crypto.subtle.digest('SHA-256', enc.encode(String(b)))]);
  const ax = new Uint8Array(x); const by = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < ax.length; i += 1) diff |= ax[i] ^ by[i];
  return diff === 0;
}

/** The handler over injectable dependencies, for the suites. */
export function createPrewarmHandler({ env = process.env, supa = () => getServiceClient(), price = runPrice, logEvent = logScanEvent, now = Date.now } = {}) {
  return async function handler(req, res) {
    const secret = String(env.CRON_SECRET ?? '');
    const given = String(req.headers?.authorization ?? '').replace(/^Bearer\s+/i, '');
    if (secret.length < 16 || !(await sameSecret(given, secret))) return reply(res, 401, { error: 'unauthorized' });
    const max = resolvePrewarmMax(env);
    if (max === 0) return reply(res, 200, { status: 'disabled' });
    if (resolveScanMode(env) !== SCAN_MODE.ENABLED) return reply(res, 200, { status: 'scan_unavailable' });
    const db = supa();
    if (!db) return reply(res, 200, { status: 'no_database' });
    const since = new Date(now() - DEMAND_WINDOW_DAYS * 86_400_000).toISOString();
    const { data, error } = await db.from('valuations').select('created_at, ai_raw_response').gte('created_at', since).order('created_at', { ascending: false }).limit(1000);
    if (error) return reply(res, 200, { status: 'demand_unreadable' });
    const plan = planPrewarm(demandFrom(data, { now: now() }), { max });
    const counts = await runPrewarm(plan, { price, model: resolveMarketModel(env), apiKey: env[SCAN_KEY_ENV], safetyIdentifier: 'gw-prewarm' });
    const summary = { status: 'ran', max, estimated_usd: plan.estimated_usd, ...counts };
    try { await logEvent(crypto.randomUUID(), 'core_scan_prewarm', summary); } catch { /* the summary is best effort */ }
    console.log(`[Prewarm] ${JSON.stringify(summary)}`);
    return reply(res, 200, summary);
  };
}

export default createPrewarmHandler();
