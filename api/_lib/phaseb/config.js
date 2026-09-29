// ══════════════════════════════════════════════════════════════════════════════
// PHASE B — ACTIVATION, MODEL SELECTION AND BUDGETS
//
// ONE PLACE THAT DECIDES WHETHER PHASE B RUNS AT ALL, and one place that names
// the model. §7 asks for the model not to be scattered through the code, and
// §4 asks for a server-owned flag that is OFF by default — both are here so
// there is exactly one answer to "is this on?" and one answer to "what did we
// call?".
//
// ── THE FLAG IS SERVER-OWNED, AND THAT IS A SECURITY PROPERTY ───────────────
//
// `resolveEnrichmentMode` reads ONLY `env`. It takes no request, no body and
// no header, so there is no parameter a client can send that turns Phase B on.
// That is deliberate and it is tested: a paid provider call that a caller can
// trigger is a billing hole, and the existing engine already learned this
// lesson once — `resolveRecognitionEngine` in api/_lib/openai-recognition.js
// has the same shape for the same reason, and this mirrors it rather than
// inventing a second convention.
//
// ── OFF MEANS NO CALL, NOT "CALL AND DISCARD" ───────────────────────────────
//
// Every disabled reason below short-circuits BEFORE any provider adapter is
// constructed. `DISABLED_*` is returned to the caller as a status, never as a
// fabricated result: §5 and §28 both forbid a silent fake, because a fake
// success is indistinguishable from a real one in every downstream reader.
// ══════════════════════════════════════════════════════════════════════════════

/** Phase B is ON only when this is exactly 'true'. Anything else is OFF. */
export const ENRICHMENT_FLAG = 'OPENAI_ENRICHMENT_ENABLED';
/** The key. Server-side only — never returned, logged, or persisted. */
export const ENRICHMENT_KEY_ENV = 'OPENAI_API_KEY';
/** Overrides the default model without a code change, for benchmarking. */
export const ENRICHMENT_MODEL_ENV = 'OPENAI_ENRICHMENT_MODEL';

// Vision-capable, and the same family the existing recognition adapter already
// runs against, so the benchmark compares intelligence rather than vendors.
// Phase B is a REASONING task — identity disambiguation, comparable matching
// and condition inference — so unlike the recognition adapter it does not set
// reasoning effort to 'none'. That choice is made per stage in the pipeline.
export const ENRICHMENT_MODEL_DEFAULT = 'gpt-5.6-luna';

export const ENRICHMENT_MODE = Object.freeze({
  ENABLED: 'enabled',
  DISABLED_FLAG: 'disabled_flag',
  DISABLED_NO_KEY: 'disabled_no_key',
});

/**
 * May Phase B call OpenAI at all?
 *
 * Reads the environment and NOTHING else. A caller cannot pass a flag, a
 * header, or a body field that reaches this function.
 *
 * A flag turned on without a key is DISABLED_NO_KEY rather than an error: the
 * scan path must not start failing because somebody set half the configuration
 * (§29). It is also not a fallback to a fake — Phase B simply does not run.
 */
export function resolveEnrichmentMode(env = process.env) {
  const raw = String(env?.[ENRICHMENT_FLAG] ?? '').trim().toLowerCase();
  if (raw !== 'true') return ENRICHMENT_MODE.DISABLED_FLAG;
  if (!env?.[ENRICHMENT_KEY_ENV]) return ENRICHMENT_MODE.DISABLED_NO_KEY;
  return ENRICHMENT_MODE.ENABLED;
}

/** The model Phase B will call. Recorded in candidate metadata (§7). */
export function resolveEnrichmentModel(env = process.env) {
  const raw = String(env?.[ENRICHMENT_MODEL_ENV] ?? '').trim();
  return raw || ENRICHMENT_MODEL_DEFAULT;
}

// ── BUDGETS ─────────────────────────────────────────────────────────────────
//
// §25 is explicit that Phase B must NOT be squeezed into /api/analyze's ~50s
// synchronous budget, and §37 says correctness first with latency MEASURED
// from day one. These are per-stage ceilings, not targets: an attempt that
// exceeds one is a recorded failure of that stage, not a silent truncation.
//
// ── NO STAGE MAY OUTLIVE THE FUNCTION THAT CONTAINS IT ──────────────────────
//
// These read 60s / 20s / 90s / 45s inside a function Vercel kills at 60s. A
// 90s research ceiling in a 60s function is not a ceiling: the platform's kill
// arrives first, as a 504 with no stage recorded and no candidate returned, so
// the one failure this table exists to NAME was the one it could never report.
//
// Two rules now hold, and tests/web-search-authority.test.mjs asserts both:
//
//   1. every ceiling is strictly below PIPELINE_BUDGET_MS, and
//   2. the pipeline clamps each stage to the budget that is actually LEFT
//      (`deadlineMs` in runPhaseB), because ceilings that are individually
//      legal can still sum past the function — identity + query + research
//      run end to end.
//
// This is a correctness fix. The ceilings were lowered to fit the container,
// not tuned for speed; the 5–8s target is a separate piece of work.
export const FUNCTION_MAX_DURATION_S = 60;
/** What the pipeline may spend. The remainder covers auth, body read, reply. */
export const PIPELINE_BUDGET_MS = 55_000;
/** Below this a stage is not started: it could not finish, only bill. */
export const MIN_STAGE_BUDGET_MS = 2_000;

export const STAGE_TIMEOUT_MS = Object.freeze({
  identity: 40_000,        // B1+B2, one call, vision + reasoning
  market_query: 20_000,    // B3, text-only
  market_research: 45_000, // B4, the search tool round-trip
  condition: 40_000,       // B5, vision
});

/** Output caps. Phase B schemas are larger than recognition's, not unbounded. */
export const STAGE_MAX_OUTPUT_TOKENS = Object.freeze({
  identity: 3_000,
  market_query: 800,
  market_research: 6_000,
  condition: 1_500,
});

// ── THE MARKET BEING RESEARCHED ─────────────────────────────────────────────
//
// WHERE the search happens is a fact about the user's marketplace, not about
// the evidence engine. It lives here, as data, so that nothing downstream has
// to know what Israel is: the research adapter is handed a region and passes
// its location to the search tool; the prompts are handed a region and phrase
// the search in its language.
//
// `country` and `timezone` are the ONLY location fields, deliberately. The
// search tool accepts a city and a region too, and GetWorth has no honest
// source for either — a scan carries no consented position, and a city guessed
// from an IP address is precision nobody measured.
//
// ONE REGION TODAY. `resolveMarketRegion` takes an id so the caller can later
// pass the region of the user's own marketplace; an id it does not recognise
// resolves to the default rather than to an unlocated search, because a search
// with no location is exactly the defect this table was added to remove.
export const MARKET_REGIONS = Object.freeze({
  IL: Object.freeze({
    id: 'IL',
    name: 'Israel',
    country: 'IL',
    timezone: 'Asia/Jerusalem',
    currency: 'ILS',
    search_language: 'Hebrew',
    // INTENT WORDS, not queries. What a person in this market types beside a
    // product name when they want to know what it sells for second-hand.
    search_hints: Object.freeze(['יד שנייה', 'יד2', 'למכירה', 'מחיר']),
    // The same words by ROLE, for a query that is assembled rather than
    // written. A market supplies its own; nothing downstream knows a language.
    terms: Object.freeze({ second_hand: 'יד שנייה', for_sale: 'למכירה', price: 'מחיר' }),
  }),
});
export const MARKET_REGION_DEFAULT = 'IL';

/** The region to research. Unknown or absent ids resolve to the default. */
export function resolveMarketRegion(id = MARKET_REGION_DEFAULT) {
  const key = String(id ?? '').trim().toUpperCase();
  return MARKET_REGIONS[key] || MARKET_REGIONS[MARKET_REGION_DEFAULT];
}

// ── AN OPTIONAL ALLOWLIST, FOR A CONTROLLED PRODUCTION TEST ─────────────────
//
// Turning Phase B on in production means every authenticated scan, by every
// user, spends real OpenAI credit. The flag alone is all-or-nothing: on, and
// the whole user base is enrolled in an experiment nobody asked them to join;
// off, and the person running the test cannot test.
//
// This narrows it without adding a second authority. It is SERVER-SIDE, like
// the flag, and it composes with it rather than replacing it — a user on this
// list still gets nothing unless OPENAI_ENRICHMENT_ENABLED is exactly 'true'.
//
// UNSET MEANS EVERYONE, which is the pre-existing behaviour and therefore the
// safe default for a value nobody has configured. A list that defaulted to
// "nobody" would look identical to a broken flag from the outside: enabled,
// authenticated, and silently returning DISABLED to every request.
export const ENRICHMENT_ALLOWLIST_ENV = 'OPENAI_ENRICHMENT_USER_IDS';

/**
 * May THIS user's scan reach the provider?
 *
 * Reads `env` and a user id. Like `resolveEnrichmentMode`, it takes no request
 * and no header, so there is no field a caller can send to enrol themselves.
 */
export function isEnrichmentPermitted(userId, env = process.env) {
  const raw = String(env?.[ENRICHMENT_ALLOWLIST_ENV] ?? '').trim();
  if (!raw) return true;                       // unset → unrestricted
  if (!userId) return false;                   // restricted → an id is required
  const allowed = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return allowed.includes(String(userId));
}
