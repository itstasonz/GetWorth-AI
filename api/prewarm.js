// ══════════════════════════════════════════════════════════════════════════════
// /api/prewarm — the daily pre-research run, and its off switch
//
// GET   the platform's cron (vercel.json crons). Keeps the research of the
//       products people actually scan fresh, so their next scan prices from
//       the store in about a second (_lib/scan/prewarm.js says what it does
//       and what it does not). Authorization: Bearer CRON_SECRET, compared in
//       constant time; no secret configured means every request is refused.
// POST  { action: 'pause' | 'resume' } — an ADMIN's session (profiles.is_admin,
//       read by the server's own role). Records one control event; the job
//       reads it before every product, so a pause stops a run in progress
//       within one research. Nothing else is read or written.
//
// FOUNDER APPROVAL (2026-11-08): at most 10 products and $0.30 per UTC day,
// only while OpenAI has credit. Limits in code (prewarm.js); settings may only
// lower them. Every run, skip and alert is a scan_events row the admin monitor
// shows (src/components/PrewarmPanel.jsx), and alerts are logged at error level.
// ══════════════════════════════════════════════════════════════════════════════
import { verifyJWT } from './analyze.js';
import { getServiceClient } from './_lib/scan/quota.js';
import { runPrice } from './_lib/scan/service.js';
import { resolveScanMode, resolveMarketModel, SCAN_KEY_ENV, SCAN_MODE } from './_lib/scan/config.js';
import { logScanEvent } from './_lib/scan/persist.js';
import { accountRef } from './_lib/scan/telemetry.js';
import {
  resolvePrewarmMax, resolvePrewarmUsd, demandFrom, planPrewarm, runPrewarm, DEMAND_WINDOW_DAYS, WORST_RESEARCH_USD,
  RUN_EVENT, CONTROL_EVENT, ALERT_EVENT, ALERT, dayStart, spentToday, isPaused, alertsFor, checkCredit,
} from './_lib/scan/prewarm.js';

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

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return null; } }
  let raw = '';
  try { for await (const chunk of req) { raw += chunk; if (raw.length > 1024) return null; } } catch { return null; }
  try { return JSON.parse(raw || '{}'); } catch { return null; }
}

/** The handler over injectable dependencies, for the suites. */
export function createPrewarmHandler({
  env = process.env, supa = () => getServiceClient(), price = runPrice, logEvent = logScanEvent, now = Date.now,
  verify = verifyJWT, credit = checkCredit,
} = {}) {
  const event = async (type, payload) => { try { await logEvent(crypto.randomUUID(), type, payload); } catch { /* best effort */ } };
  const alert = async (a) => { console.error(`[Prewarm][ALERT] ${JSON.stringify(a)}`); await event(ALERT_EVENT, { source: 'prewarm', ...a }); };
  const rows = async (db, type, since) => {
    const { data, error } = await db.from('scan_events').select('created_at, payload').eq('event_type', type).gte('created_at', since).order('created_at', { ascending: false }).limit(200);
    if (error) throw new Error('unreadable');
    return data ?? [];
  };

  // ── THE OFF SWITCH (admin) ────────────────────────────────────────────────
  async function control(req, res) {
    let user = null;
    try { user = await verify(req.headers?.authorization); } catch { user = null; }
    if (!user?.id || user._expired) return reply(res, 401, { error: 'unauthorized' });
    const db = supa();
    if (!db) return reply(res, 503, { error: 'no_database' });
    const { data: profile, error } = await db.from('profiles').select('is_admin').eq('id', user.id).maybeSingle();
    if (error || profile?.is_admin !== true) return reply(res, 403, { error: 'forbidden' });
    const body = await readBody(req);
    const action = body?.action;
    if (action !== 'pause' && action !== 'resume') return reply(res, 400, { error: 'bad_request' });
    const payload = { enabled: action === 'resume', by: await accountRef(user.id), at: new Date(now()).toISOString() };
    try { await logEvent(crypto.randomUUID(), CONTROL_EVENT, payload); } catch { return reply(res, 503, { error: 'not_recorded' }); }
    console.warn(`[Prewarm] ${action} by admin ${payload.by}`);
    return reply(res, 200, { status: action === 'resume' ? 'resumed' : 'paused' });
  }

  // ── THE DAILY RUN (cron) ──────────────────────────────────────────────────
  async function run(req, res) {
    const secret = String(env.CRON_SECRET ?? '');
    const given = String(req.headers?.authorization ?? '').replace(/^Bearer\s+/i, '');
    if (secret.length < 16 || !(await sameSecret(given, secret))) return reply(res, 401, { error: 'unauthorized' });
    const max = resolvePrewarmMax(env);
    const usdCap = resolvePrewarmUsd(env);
    // Both a product limit and a dollar cap must be set: either missing, nothing runs and nothing is spent.
    if (max === 0 || usdCap === 0) return reply(res, 200, { status: 'disabled' });
    if (resolveScanMode(env) !== SCAN_MODE.ENABLED) return reply(res, 200, { status: 'scan_unavailable' });
    const db = supa();
    if (!db) return reply(res, 200, { status: 'no_database' });
    const today = dayStart(now());
    const finish = async (summary) => { await event(RUN_EVENT, summary); console.log(`[Prewarm] ${JSON.stringify(summary)}`); return reply(res, 200, summary); };

    // The off switch and the day's ledger. Unreadable is a stop, never a run on a guess.
    let controls; let runs;
    try { [controls, runs] = await Promise.all([rows(db, CONTROL_EVENT, '1970-01-01T00:00:00Z'), rows(db, RUN_EVENT, today)]); } catch {
      return reply(res, 200, { status: 'ledger_unreadable' });
    }
    if (isPaused(controls)) return finish({ status: 'paused', spent_usd: 0, cap_usd: usdCap });
    const before = spentToday(runs);
    const left = Math.round((usdCap - before) * 10000) / 10000;
    if (left < WORST_RESEARCH_USD) { await alert({ kind: ALERT.CAP, spent_today_usd: before, cap_usd: usdCap }); return finish({ status: 'cap_reached', spent_usd: 0, spent_today_usd: before, cap_usd: usdCap }); }

    // Credit first: the approval is for a run only while OpenAI has credit.
    const model = resolveMarketModel(env);
    const apiKey = env[SCAN_KEY_ENV];
    const c = await credit({ apiKey, model });
    if (!c.ok) {
      if (c.credit_exhausted) await alert({ kind: ALERT.CREDIT, status: c.status });
      return finish({ status: c.credit_exhausted ? 'no_credit' : 'provider_unavailable', provider_status: c.status, spent_usd: 0, preflight_usd: 0, cap_usd: usdCap });
    }

    let data;
    try {
      const since = new Date(now() - DEMAND_WINDOW_DAYS * 86_400_000).toISOString();
      const r = await db.from('valuations').select('created_at, ai_raw_response').gte('created_at', since).order('created_at', { ascending: false }).limit(1000);
      if (r.error) throw new Error('unreadable');
      data = r.data;
    } catch { await alert({ kind: ALERT.DEMAND }); return finish({ status: 'demand_unreadable', spent_usd: 0, preflight_usd: c.cost_usd, cap_usd: usdCap }); }

    const plan = planPrewarm(demandFrom(data, { now: now() }), { max });
    const paused = async () => isPaused(await rows(db, CONTROL_EVENT, '1970-01-01T00:00:00Z'));
    const counts = await runPrewarm(plan, { price, usdCap: left - c.cost_usd, paused, model, apiKey, safetyIdentifier: 'gw-prewarm' });
    const spentTodayUsd = Math.round((before + c.cost_usd + counts.spent_usd) * 10000) / 10000;
    const summary = { status: 'ran', max, cap_usd: usdCap, estimated_usd: plan.estimated_usd, preflight_usd: c.cost_usd, ...counts, spent_today_usd: spentTodayUsd };
    const alerts = alertsFor(summary, { usdCap });
    for (const a of alerts) await alert(a);
    // A day over its cap should be impossible (each research is reserved at its worst case first). If it happens anyway,
    // the job pauses itself: an admin resumes it after looking.
    if (alerts.some((a) => a.kind === ALERT.OVER_CAP)) await event(CONTROL_EVENT, { enabled: false, by: 'auto:over_cap', at: new Date(now()).toISOString() });
    return finish({ ...summary, alerts: alerts.map((a) => a.kind) });
  }

  return async function handler(req, res) {
    if (req.method === 'POST') return control(req, res);
    if (req.method === 'GET' || !req.method) return run(req, res);
    return reply(res, 405, { error: 'method_not_allowed' });
  };
}

export default createPrewarmHandler();
