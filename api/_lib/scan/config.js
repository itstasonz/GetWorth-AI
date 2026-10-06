// ══════════════════════════════════════════════════════════════════════════════
// CORE SCAN — MODELS, BUDGETS AND LIMITS
//
// The core scan is the one scan path: a photograph is identified by a vision
// model, the live web is searched for what that item sells for, and the answer
// is a second-hand price in Israel. Everything a deployment can tune is named
// here and read from the server environment; no request field changes a model,
// a budget or a limit.
//
// No new configuration is REQUIRED to turn it on: it runs with the OpenAI key
// and the Supabase settings the deployment already has.
// ══════════════════════════════════════════════════════════════════════════════

export const SCAN_KEY_ENV = 'OPENAI_API_KEY';
/** Optional overrides, so a model can be swapped without a code change. */
export const SCAN_IDENTITY_MODEL_ENV = 'CORE_SCAN_IDENTITY_MODEL';
export const SCAN_MARKET_MODEL_ENV = 'CORE_SCAN_MARKET_MODEL';
/** Set to exactly 'false' to switch the core scan off without a deploy of code. */
export const SCAN_FLAG_ENV = 'CORE_SCAN_ENABLED';

// MEASURED, NOT ASSUMED (live runs, 2026-10-06, three photographs):
//   identity  the larger model read the photographs better — a dim mouse as a
//             G502 rather than "a Logitech G mouse", a console as the original
//             model rather than "standard or OLED" — for 6-9 s against 3 s.
//             What the item IS drives everything after it, so it gets the
//             better eyes.
//   market    with the larger model one search action took ~8 s and a scan ran
//             40-50 s; the efficient model, asked for ONE wide search, answered
//             in ~10 s from the same kind of pages. The answer is checked by
//             valuation.js either way.
export const SCAN_IDENTITY_MODEL_DEFAULT = 'gpt-6.1-sol';
export const SCAN_MARKET_MODEL_DEFAULT = 'gpt-6-luna';

/** Secrets that may sign a scan token, in order of preference. */
export const SCAN_TOKEN_SECRET_ENVS = Object.freeze(['SCAN_STATE_SECRET', 'SCAN_ENGINE_V2_STATE_SECRET', 'SUPABASE_JWT_SECRET']);
export const MIN_TOKEN_SECRET_LENGTH = 32;

export const SCAN_MODE = Object.freeze({ ENABLED: 'enabled', DISABLED_FLAG: 'disabled_flag', DISABLED_NO_KEY: 'disabled_no_key', DISABLED_NO_SECRET: 'disabled_no_secret' });

export function resolveTokenSecret(env = process.env) {
  for (const name of SCAN_TOKEN_SECRET_ENVS) {
    const s = String(env?.[name] ?? '');
    if (s.length >= MIN_TOKEN_SECRET_LENGTH) return s;
  }
  return null;
}

/** May the core scan run at all? Reads the environment and nothing else. */
export function resolveScanMode(env = process.env) {
  if (String(env?.[SCAN_FLAG_ENV] ?? '').trim().toLowerCase() === 'false') return SCAN_MODE.DISABLED_FLAG;
  if (!env?.[SCAN_KEY_ENV]) return SCAN_MODE.DISABLED_NO_KEY;
  if (!resolveTokenSecret(env)) return SCAN_MODE.DISABLED_NO_SECRET;
  return SCAN_MODE.ENABLED;
}

/** Optional overrides for how much each step thinks before answering. */
export const SCAN_IDENTITY_EFFORT_ENV = 'CORE_SCAN_IDENTITY_EFFORT';
export const SCAN_MARKET_EFFORT_ENV = 'CORE_SCAN_MARKET_EFFORT';
const EFFORTS = ['none', 'low', 'medium', 'high'];

const modelOf = (env, name, fallback) => String(env?.[name] ?? '').trim() || fallback;
const effortOf = (env, name) => (EFFORTS.includes(String(env?.[name] ?? '').trim()) ? String(env[name]).trim() : 'low');
export const resolveIdentityEffort = (env = process.env) => effortOf(env, SCAN_IDENTITY_EFFORT_ENV);
export const resolveMarketEffort = (env = process.env) => effortOf(env, SCAN_MARKET_EFFORT_ENV);
export const resolveIdentityModel = (env = process.env) => modelOf(env, SCAN_IDENTITY_MODEL_ENV, SCAN_IDENTITY_MODEL_DEFAULT);
export const resolveMarketModel = (env = process.env) => modelOf(env, SCAN_MARKET_MODEL_ENV, SCAN_MARKET_MODEL_DEFAULT);

// ── BUDGETS ─────────────────────────────────────────────────────────────────
// Ceilings, not targets. The handler declares `maxDuration: 60` as a literal
// and every ceiling below stays under it.
export const SCAN_FUNCTION_MAX_DURATION_S = 60;
export const IDENTIFY_TIMEOUT_MS = 20_000;
export const MARKET_TIMEOUT_MS = 50_000;
export const IDENTIFY_MAX_OUTPUT_TOKENS = 1_200;
export const MARKET_MAX_OUTPUT_TOKENS = 3_000;
/** Searches, page opens and in-page finds all count. Bounds latency and cost. */
export const MARKET_MAX_TOOL_CALLS = 2;
export const MARKET_SEARCH_CONTEXT_SIZE = 'low';

// ── LIMITS ──────────────────────────────────────────────────────────────────
export const MAX_IMAGES = 3;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** Vercel refuses a request body above 4.5 MB before the function runs. */
export const MAX_BODY_BYTES = 4.4 * 1024 * 1024;
export const MAX_USER_TEXT = 160;
/** How long a signed scan token may be presented back. */
export const TOKEN_TTL_MS = 30 * 60 * 1000;
/** Re-identifications (a correction, a follow-up photograph) one scan may make. */
export const MAX_REVISIONS = 3;
/** The scan asks at most this many follow-up questions. */
export const MAX_FOLLOWUPS = 2;
/** Market research for the same item is reused, with no new search, for this long. */
export const MARKET_FRESH_MS = 60 * 60 * 1000;
/** Evidence older than fresh but younger than this still joins a new search's evidence. Prices do not move in days. */
export const MARKET_POOL_MS = 7 * 24 * 60 * 60 * 1000;
export const MARKET_CACHE_MAX_ENTRIES = 200;

/** The one market this product values for. */
export const MARKET = Object.freeze({ country: 'IL', timezone: 'Asia/Jerusalem', currency: 'ILS', name: 'Israel' });

/** The condition ladder, best first. The ids are the contract with the client. */
export const CONDITIONS = Object.freeze(['new_sealed', 'like_new', 'good', 'fair', 'poor']);
export const DEFAULT_CONDITION = 'good';
