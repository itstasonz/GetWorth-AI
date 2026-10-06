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
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
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

/**
 * May this scan proceed, and was the daily allowance charged for it?
 * Resolves to { allowed, limitType, retryAfter, charged }. Never throws.
 */
export async function chargeScan({ supa = getServiceClient(), ip, userId, timeoutMs = QUOTA_TIMEOUT_MS } = {}) {
  const deny = (limitType, retryAfter) => ({ allowed: false, limitType, retryAfter, charged: false });
  if (!supa || !userId) return deny('quota_error', 30);
  try {
    const { data, error } = await withTimeout(supa.rpc('check_and_increment_scan_rate', {
      p_ip: ip || 'unknown',
      p_user_id: userId,
      p_date: today(),
      p_ip_limit: IP_RATE_PER_MIN,
      p_user_limit: USER_RATE_PER_MIN,
      p_daily_limit: USER_DAILY_LIMIT,
    }), timeoutMs);
    if (error) { console.error('[Scan] quota denied reason=rpc_failed:', error.message); return deny('quota_error', 30); }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return deny('quota_error', 30);
    if (!row.allowed) return deny(row.limit_type, row.limit_type === 'user_daily' ? secondsUntilUtcMidnight() : 60);
    return { allowed: true, limitType: null, retryAfter: 0, charged: !!row.charged };
  } catch (err) {
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
