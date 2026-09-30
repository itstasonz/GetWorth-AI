// ══════════════════════════════════════════════════════════════════════════════
// SCAN ENGINE V2 — ACTIVATION, MODEL AND BUDGETS
//
// V2 is a SEPARATE scan path that runs beside V1. One place decides whether it
// runs, for whom, on which model and for how long, and every answer is read
// from the server environment: there is no request field that turns V2 on,
// enrols a user, or lengthens a budget.
//
// ── THE ALLOWLIST FAILS CLOSED IN PRODUCTION ────────────────────────────────
//
// Phase B's allowlist treats "unset" as "everyone", because that was its
// pre-existing behaviour. V2 has no pre-existing behaviour to preserve, and the
// instruction it was built under is that turning the flag on must never enrol
// the whole user base. So in a production deployment an unset list admits
// NOBODY. Outside production (local development, a preview build) an unset
// list admits any signed-in user, which is what makes the path testable at all.
// ══════════════════════════════════════════════════════════════════════════════
import { resolveEnrichmentModel } from '../phaseb/config.js';

/** V2 is ON only when this is exactly 'true'. */
export const V2_FLAG = 'SCAN_ENGINE_V2_ENABLED';
/** Comma-separated user ids. Required in production. */
export const V2_ALLOWLIST_ENV = 'SCAN_ENGINE_V2_USER_IDS';
/** Signs the scan state handed to the client between the two requests. */
export const V2_STATE_SECRET_ENV = 'SCAN_ENGINE_V2_STATE_SECRET';
/** Optional model override; otherwise the model Phase B is configured with. */
export const V2_MODEL_ENV = 'SCAN_ENGINE_V2_MODEL';
export const V2_KEY_ENV = 'OPENAI_API_KEY';

export const V2_MODE = Object.freeze({
  ENABLED: 'enabled',
  DISABLED_FLAG: 'disabled_flag',
  DISABLED_NO_KEY: 'disabled_no_key',
  DISABLED_NO_SECRET: 'disabled_no_state_secret',
});

/** A secret shorter than this is a placeholder, not a secret. */
export const MIN_STATE_SECRET_LENGTH = 32;

/** May V2 run at all? Reads the environment and nothing else. */
export function resolveV2Mode(env = process.env) {
  if (String(env?.[V2_FLAG] ?? '').trim().toLowerCase() !== 'true') return V2_MODE.DISABLED_FLAG;
  if (!env?.[V2_KEY_ENV]) return V2_MODE.DISABLED_NO_KEY;
  if (String(env?.[V2_STATE_SECRET_ENV] ?? '').length < MIN_STATE_SECRET_LENGTH) return V2_MODE.DISABLED_NO_SECRET;
  return V2_MODE.ENABLED;
}

/** Is this deployment the production one? */
export function isProductionDeployment(env = process.env) {
  return String(env?.VERCEL_ENV ?? '').trim().toLowerCase() === 'production';
}

/** May THIS user's scan use V2? Takes an id and the environment, no request. */
export function isV2Permitted(userId, env = process.env) {
  if (!userId) return false;
  const allowed = String(env?.[V2_ALLOWLIST_ENV] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (allowed.length === 0) return !isProductionDeployment(env);
  return allowed.includes(String(userId));
}

export function resolveV2Model(env = process.env) {
  return String(env?.[V2_MODEL_ENV] ?? '').trim() || resolveEnrichmentModel(env);
}

// ── BUDGETS ─────────────────────────────────────────────────────────────────
//
// Ceilings, not targets. The product targets are 3–5s to an identity and
// 10–15s to a price; a stage that reaches its ceiling is a recorded failure of
// that stage and the scan answers with the strongest honest state it has.
//
// Both handlers declare `maxDuration: 30` as a literal (Vercel reads it
// statically), and tests/scan-v2-endpoints.test.mjs holds every ceiling below
// under it.
export const V2_FUNCTION_MAX_DURATION_S = 30;
export const V2_IDENTIFY_TIMEOUT_MS = 12_000;
export const V2_SEARCH_TIMEOUT_MS = 20_000;
export const V2_IDENTITY_MAX_OUTPUT_TOKENS = 700;
/** The search call is stopped when the results arrive; this only bounds a run that is not. */
export const V2_SEARCH_MAX_OUTPUT_TOKENS = 400;

/** How long a signed scan state may be presented back. */
export const V2_STATE_TTL_MS = 15 * 60 * 1000;
/** A scan asks for ONE more photograph, once. */
export const V2_MAX_FOLLOWUPS = 1;
