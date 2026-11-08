// ══════════════════════════════════════════════════════════════════════════════
// CORE SCAN — ONE TELEMETRY ROW PER REQUEST
//
// Every request to /api/scan — an identification, a price, a refusal, the
// client's own report of how long the scan took on the phone — leaves one
// `core_scan_request` row in scan_events (admin-only reads under RLS), keyed by
// the scan's own scan_uuid. Together with `core_scan_priced` (research
// diagnostics) that is the whole scan, persistently, without Vercel's short
// runtime-log retention.
//
// What is in a row: durations, outcomes, model, token counts, search counts,
// the deployment's commit and id, and an account REFERENCE (a truncated SHA-256
// of the account id — the monitor can say "this is my scan", nobody can read an
// id back from it). Never a photograph, a token, a key, an email or page text.
//
// The write does not hold the response: on Vercel it is handed to the
// platform's waitUntil (the request context @vercel/functions itself reads), and
// only where that is absent is it awaited, bounded by persist.js's timeout.
// ══════════════════════════════════════════════════════════════════════════════
export const REQUEST_EVENT = 'core_scan_request';
export const ENGINE = 'core_scan';

/** A stable, non-reversible account reference. Same id → same reference. */
export async function accountRef(userId) {
  if (!userId) return null;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(userId)));
  return Buffer.from(digest).toString('hex').slice(0, 16);
}

/** Which build answered: commit and deployment, from Vercel's own system variables. */
export function deploymentOf(env = process.env) {
  return {
    sha: String(env?.VERCEL_GIT_COMMIT_SHA ?? '').slice(0, 12) || null,
    id: String(env?.VERCEL_DEPLOYMENT_ID ?? '').slice(0, 40) || null,
    env: String(env?.VERCEL_ENV ?? '').slice(0, 20) || null,
  };
}

const num = (v) => (Number.isFinite(v) ? Math.round(v) : null);

/** The row's payload. Every field bounded; unknown values are null, never guessed. */
export async function requestPayload({ action, http, outcome, reason = null, userId, totalMs, call = null, extra = {}, env = process.env }) {
  return {
    engine: ENGINE,
    action: String(action ?? 'unknown').slice(0, 20),
    http: num(http),
    outcome: String(outcome ?? 'unknown').slice(0, 40),
    reason: reason === null ? null : String(reason).slice(0, 80),
    account: await accountRef(userId),
    deployment: deploymentOf(env),
    total_ms: num(totalMs),
    provider_ms: num(call?.ms),
    first_output_ms: num(call?.first_output_ms),
    first_search_ms: num(call?.first_search_ms),
    model: call?.model ? String(call.model).slice(0, 60) : null,
    ai_requests: call ? (call.stage === 'market' ? (call.tool_calls ?? 0) : (call.ms ? 1 : 0)) : 0,
    tokens_in: num(call?.usage?.input_tokens),
    tokens_out: num(call?.usage?.output_tokens),
    ...extra,
  };
}

/** Run a write after the response when the platform allows it; otherwise wait for it (it is bounded). */
export async function afterResponse(promise) {
  try {
    const ctx = globalThis[Symbol.for('@vercel/request-context')]?.get?.();
    if (typeof ctx?.waitUntil === 'function') { ctx.waitUntil(Promise.resolve(promise).catch(() => {})); return; }
  } catch { /* fall through to waiting */ }
  try { await promise; } catch { /* telemetry never fails a scan */ }
}

/** Build the row and write it after the response. `logEvent` is persist.js logScanEvent (injectable for the suites). */
export function recordRequest(logEvent, scanUuid, args) {
  return afterResponse(requestPayload(args).then((payload) => logEvent(scanUuid, REQUEST_EVENT, payload)));
}
