// ══════════════════════════════════════════════════════════════════════════════
// CORE SCAN — THE SCAN QUOTA
//
// The same guard every scan in this app has always passed, through the same
// database functions: a per-address and a per-account burst limit, and a daily
// allowance per account, decided and incremented atomically in one round trip
// (`check_and_increment_scan_rate`).
//
// EVERY identification is charged — the first look at a photograph, and each
// correction or added photograph after it — because each is a paid vision call.
// The price step is not charged separately: it can only be reached with a token
// an identification produced, for the answers that identification offered.
//
// FAILS CLOSED. No database, an error or a timeout is a refusal: an outage must
// not become an open door on a paid service.
// ══════════════════════════════════════════════════════════════════════════════
import { createClient } from '@supabase/supabase-js';
import { traced, tracedFetch, summarise } from './net-timing.js';

export const IP_RATE_PER_MIN = 5;
export const USER_RATE_PER_MIN = 5;
export const USER_DAILY_LIMIT = 50;
export const QUOTA_TIMEOUT_MS = 6_000;

let client = null;
/** The server's own database client, or null when this deployment has none. */
export function getServiceClient(env = process.env) {
  if (client) return client;
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_KEY || env.SUPABASE_KEY || env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  // tracedFetch is plain fetch outside a trace; inside one (the quota call, the warm-up read) it lets net-timing.js time it.
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: tracedFetch } });
  return client;
}

const today = () => new Date().toISOString().slice(0, 10);
function secondsUntilUtcMidnight() {
  const now = new Date();
  return Math.max(1, Math.ceil((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now.getTime()) / 1000));
}
const withTimeout = (promise, ms) => Promise.race([
  promise,
  new Promise((_, reject) => { setTimeout(() => reject(new Error('timeout')), ms); }),
]);

/** The server client, timed: whether this call created it, and how long that took (measured, monotonic). */
function clientFor(supa) {
  const t = performance.now();
  const fresh = supa === undefined && !client;
  const db = supa === undefined ? getServiceClient() : supa;
  return { db, client: { created: fresh && !!db, init_ms: Math.round((performance.now() - t) * 10) / 10 } };
}

/**
 * Run one quota-path database call under net-timing.js: resolves to { result, timing } where timing is null only when
 * the trace itself failed. A timeout keeps the trace taken so far (what had happened when the 6 s limit struck).
 */
async function timedCall(fn, timeoutMs) {
  let trace = null;
  const run = traced(fn, { onStart: (t) => { trace = t; } });
  try {
    return await withTimeout(run, timeoutMs);
  } catch (err) {
    err.timing = err.timing ?? (trace ? summarise(trace, performance.now()) : null);
    throw err;
  }
}

/** One log line per traced call: numbers and labels only. */
function logTiming(what, client, timing) {
  try {
    const m = timing?.measured;
    const a = m?.attempts?.at(-1);
    console.log(`[Scan] ${what} timing total_ms=${m?.total_ms ?? '-'} client_created=${client.created} client_init_ms=${client.init_ms} loop_lag_ms=${m?.loop_lag_ms ?? '-'} fetch_calls=${m?.fetch_calls ?? '-'} attempts=${m?.attempts?.length ?? '-'}`
      + (a ? ` connect=${a.connect} connect_ms=${a.connect_ms ?? '-'} socket_idle_ms=${a.socket_idle_ms ?? '-'} sent_ms=${a.sent_ms ?? '-'} headers_ms=${a.headers_ms ?? '-'} done_ms=${a.done_ms ?? '-'} upstream_ms=${a.upstream_ms ?? '-'} gateway_attempts=${a.gateway_attempts ?? '-'} status=${a.status ?? '-'} error=${a.error ?? '-'}` : ''));
  } catch { /* logging never fails a scan */ }
}

/**
 * May this scan proceed, and was the daily allowance charged for it?
 * Resolves to { allowed, limitType, retryAfter, charged, timing }. Never throws. `timing` says where the call's time went
 * (net-timing.js: measured and inferred, no identifiers); it changes nothing about the decision.
 */
export async function chargeScan({ supa, ip, userId, timeoutMs = QUOTA_TIMEOUT_MS } = {}) {
  const { db, client: clientInit } = clientFor(supa);
  let timing = null;
  const withTiming = (r) => ({ ...r, timing: { client: clientInit, ...(timing ?? {}) } });
  const deny = (limitType, retryAfter) => withTiming({ allowed: false, limitType, retryAfter, charged: false });
  if (!db || !userId) return deny('quota_error', 30);
  try {
    const out = await timedCall(() => db.rpc('check_and_increment_scan_rate', {
      p_ip: ip || 'unknown',
      p_user_id: userId,
      p_date: today(),
      p_ip_limit: IP_RATE_PER_MIN,
      p_user_limit: USER_RATE_PER_MIN,
      p_daily_limit: USER_DAILY_LIMIT,
    }), timeoutMs);
    timing = out.timing;
    logTiming('quota', clientInit, timing);
    const { data, error } = out.result;
    if (error) { console.error('[Scan] quota denied reason=rpc_failed:', error.message); return deny('quota_error', 30); }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return deny('quota_error', 30);
    if (!row.allowed) return deny(row.limit_type, row.limit_type === 'user_daily' ? secondsUntilUtcMidnight() : 60);
    return withTiming({ allowed: true, limitType: null, retryAfter: 0, charged: !!row.charged });
  } catch (err) {
    timing = err?.timing ?? null;
    logTiming('quota', clientInit, timing);
    console.error(`[Scan] quota denied reason=${err?.message === 'timeout' ? 'timeout' : 'check_failed'}`);
    return deny(err?.message === 'timeout' ? 'quota_timeout' : 'quota_error', 15);
  }
}

/**
 * Give the daily allowance back. Only for an identification the provider did
 * not bill — the caller decides that; this does not re-check. Best effort.
 */
export async function refundScan({ supa = getServiceClient(), userId } = {}) {
  if (!supa || !userId) return;
  try {
    const { error } = await supa.rpc('decrement_user_daily_scan', { p_user_id: userId, p_date: today() });
    if (error) console.error('[Scan] quota refund failed:', error.message);
  } catch (err) { console.error('[Scan] quota refund exception:', err?.message); }
}

// ── WARM-UP ─────────────────────────────────────────────────────────────────
// While the camera opens (api/scan.js 'warm'): the database client is created and its connection opened with one read of
// this account's own allowance row, so the charge made with the photograph does not pay for that set-up. Nothing is
// charged or written. At most once a minute per account on this instance; never throws.
export const WARM_EVERY_MS = 60_000;
const warmedAt = new Map();
// `onTiming` receives where the read's time went (net-timing.js), the same measurement the charge records.
export async function warmQuota({ supa, userId, now = Date.now(), timeoutMs = QUOTA_TIMEOUT_MS, onTiming = null } = {}) {
  const { db, client: clientInit } = clientFor(supa);
  if (!db || !userId) return false;
  if (now - (warmedAt.get(userId) ?? -Infinity) < WARM_EVERY_MS) return false;
  if (warmedAt.size > 1000) warmedAt.clear();
  warmedAt.set(userId, now);
  let timing = null;
  try {
    const out = await timedCall(() => db.from('scan_daily_usage').select('count').eq('user_id', userId).eq('date', today()).maybeSingle(), timeoutMs);
    timing = out.timing;
    return true;
  } catch (err) { timing = err?.timing ?? null; return false; } finally {
    logTiming('warm', clientInit, timing);
    try { onTiming?.({ client: clientInit, ...(timing ?? {}) }); } catch { /* never fails the warm-up */ }
  }
}
