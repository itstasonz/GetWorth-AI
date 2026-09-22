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
export const STAGE_TIMEOUT_MS = Object.freeze({
  identity: 60_000,        // B1+B2, one call, vision + reasoning
  market_query: 20_000,    // B3, text-only
  market_research: 90_000, // B4, the search tool round-trip
  condition: 45_000,       // B5, vision
});

/** Output caps. Phase B schemas are larger than recognition's, not unbounded. */
export const STAGE_MAX_OUTPUT_TOKENS = Object.freeze({
  identity: 3_000,
  market_query: 800,
  market_research: 6_000,
  condition: 1_500,
});

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
