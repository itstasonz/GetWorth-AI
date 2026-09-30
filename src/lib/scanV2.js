// ══════════════════════════════════════════════════════════════════════════════
// SCAN ENGINE V2 — THE CLIENT HALF
//
//   photograph -> /api/v2/identify -> SEARCH_NOW     -> /api/v2/price -> result
//                                  -> NEED_FOLLOWUP  -> one specific photograph
//                                                    -> /api/v2/identify (+state)
//
// This module owns the V2 scan's state and nothing else in the app does. The V1
// pipeline in AppContext is untouched by it: a V2 scan never calls
// /api/analyze or /api/enrich, and a V1 scan never reads this store.
//
// ── TWO FLAGS, ONE OF WHICH IS AUTHORITY ────────────────────────────────────
//
// `VITE_SCAN_ENGINE_V2_ENABLED` (build time) decides whether the browser ASKS.
// It is a convenience switch and is visible to anyone who opens the bundle.
// `SCAN_ENGINE_V2_ENABLED` and `SCAN_ENGINE_V2_USER_IDS` on the server decide
// whether the server ANSWERS, per request. A build with the flag on, used by an
// account the server has not enrolled, is told DISABLED once per session and
// scans with V1 exactly as before.
//
// ── NO FAKE PROGRESS ────────────────────────────────────────────────────────
//
// A stage is shown while the request that performs it is in flight, and the
// timings are measured, not animated. Nothing here is a percentage.
//
// No secret is in this file or reachable from it: the only credential it
// handles is the user's own session token, passed in per call.
// ══════════════════════════════════════════════════════════════════════════════

// Exact match, as PHASE_B_ENABLED is: an unset variable can arrive as the string
// "undefined", and every non-empty string is truthy.
//
// Written as a direct `import.meta.env.VITE_…` read so the bundler replaces it
// with a literal. The `typeof` guard is for Node, where the tests import this
// module and `import.meta.env` does not exist.
export const SCAN_V2_ENABLED = typeof import.meta.env !== 'undefined'
  && import.meta.env.VITE_SCAN_ENGINE_V2_ENABLED === 'true';

export const V2_STAGE = Object.freeze({
  IDLE: 'idle',
  PREPARING: 'preparing',
  IDENTIFYING: 'identifying',
  NEED_FOLLOWUP: 'need_followup',
  SEARCHING: 'searching',
  DONE: 'done',
  ERROR: 'error',
});

const IDENTIFY_TIMEOUT_MS = 20_000;   // server ceiling 12s, plus upload
const PRICE_TIMEOUT_MS = 30_000;      // server ceiling 20s search

const initial = () => ({
  active: false,
  stage: V2_STAGE.IDLE,
  scanUuid: null,
  image: null,
  followupImage: null,
  identity: null,
  sufficiency: null,
  followupsUsed: 0,
  stateToken: null,
  valuation: null,
  search: null,
  evidence: null,
  calls: { identity: 0, search: 0 },
  // Offsets in ms from the moment the photograph was accepted.
  timings: {},
  server: { identify: null, followup: null, price: null },
  error: null,
});

// ── A TINY STORE ────────────────────────────────────────────────────────────
let state = initial();
const listeners = new Set();
const emit = () => { for (const l of listeners) l(); };
const set = (patch) => { state = { ...state, ...patch }; emit(); };

export const scanV2Store = {
  subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  getSnapshot() { return state; },
  reset() { controller?.abort(); controller = null; state = initial(); emit(); },
  /** Stamp a client-side moment, once. Used by the view for "result rendered". */
  mark(name) {
    if (!state.active || state.timings[name] !== undefined || !t0) return;
    set({ timings: { ...state.timings, [name]: Math.round(performance.now() - t0) } });
  },
};

let controller = null;
let t0 = 0;
const stamp = (name) => set({ timings: { ...state.timings, [name]: Math.round(performance.now() - t0) } });

/** Is a V2 scan waiting for its one follow-up photograph? */
export const awaitingFollowup = () => state.active && state.stage === V2_STAGE.NEED_FOLLOWUP;

// ── IS V2 ON FOR THIS USER? ASKED ONCE PER SESSION ──────────────────────────
const availability = new Map();   // user id -> boolean

async function post(path, body, token, timeoutMs, signal) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    let payload = null;
    try { payload = await res.json(); } catch { /* not json */ }
    return { status: res.status, payload };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Should this scan use V2? False unless the build asks AND the server agrees.
 *
 * The probe carries no image and makes no provider call. Any failure to get a
 * clear yes is a no, and the scan proceeds on V1.
 */
export async function isScanV2Available({ userId, getToken, scanUuid }) {
  if (!SCAN_V2_ENABLED || !userId) return false;
  if (availability.has(userId)) return availability.get(userId);
  let ok = false;
  try {
    const token = await getToken();
    if (token) {
      const { status, payload } = await post('/api/v2/identify', { scan_uuid: scanUuid, probe: true }, token, 6000);
      ok = status === 200 && payload?.engine === 'v2' && payload?.status === 'READY';
    }
  } catch { ok = false; }
  availability.set(userId, ok);
  return ok;
}

const text = (lang, en, he) => (lang === 'he' ? he : en);

function fail(lang, error, retryable = true) {
  set({ stage: V2_STAGE.ERROR, error: { message: error, retryable } });
}

async function identify({ dataUrl, lang, getToken, compress, assess, followup }) {
  set({ stage: V2_STAGE.PREPARING, error: null });
  const compressed = await compress(dataUrl);
  stamp(followup ? 'followup_compression_complete' : 'compression_complete');
  const pixels = await assess(compressed);
  if (pixels && pixels.ok === false) {
    fail(lang, text(lang, 'Photo capture failed. Please retake the photo.', 'צילום התמונה נכשל. אנא צלם שוב.'));
    return;
  }
  set(followup ? { followupImage: compressed } : { image: compressed });

  const token = await getToken();
  if (!token) { fail(lang, text(lang, 'Sign in required to scan', 'יש להתחבר כדי לסרוק'), false); return; }

  set({ stage: V2_STAGE.IDENTIFYING });
  stamp(followup ? 'followup_request_start' : 'identity_request_start');
  const { status, payload } = await post('/api/v2/identify', {
    scan_uuid: state.scanUuid,
    image: compressed.split(',')[1],
    language: lang,
    ...(followup ? { state: state.stateToken } : {}),
  }, token, IDENTIFY_TIMEOUT_MS, controller.signal);
  stamp(followup ? 'followup_complete' : 'identity_complete');

  if (status !== 200 || payload?.status !== 'OK') {
    fail(lang, text(lang, 'Identification failed — please try again', 'הזיהוי נכשל — אנא נסה שוב'));
    return;
  }
  set({
    identity: payload.identity,
    sufficiency: payload.sufficiency,
    followupsUsed: payload.followups_used ?? 0,
    stateToken: payload.state,
    calls: { ...state.calls, identity: state.calls.identity + 1 },
    server: { ...state.server, [followup ? 'followup' : 'identify']: payload.timings ?? null },
  });
  stamp(followup ? 'followup_decision' : 'sufficiency_decision');

  if (payload.sufficiency?.decision === 'NEED_FOLLOWUP') { set({ stage: V2_STAGE.NEED_FOLLOWUP }); return; }
  if (payload.sufficiency?.decision !== 'SEARCH_NOW') {
    // INSUFFICIENT: nothing is searched, and the state says why there is no price.
    set({ stage: V2_STAGE.DONE, valuation: { state: 'NEED_MORE_INFORMATION', low: null, recommended: null, high: null, basis: { kind: 'none', listings: 0, sources: 0 } } });
    return;
  }
  await price({ lang, getToken });
}

async function price({ lang, getToken }) {
  const token = await getToken();
  if (!token) { fail(lang, text(lang, 'Sign in required to scan', 'יש להתחבר כדי לסרוק'), false); return; }
  set({ stage: V2_STAGE.SEARCHING });
  stamp('search_request_start');
  const { status, payload } = await post('/api/v2/price', { scan_uuid: state.scanUuid, state: state.stateToken }, token, PRICE_TIMEOUT_MS, controller.signal);
  stamp('price_complete');
  if (status !== 200 || payload?.status !== 'OK') {
    fail(lang, text(lang, 'The market check failed — please try again', 'בדיקת השוק נכשלה — אנא נסה שוב'));
    return;
  }
  set({
    stage: V2_STAGE.DONE,
    valuation: payload.valuation,
    search: payload.search,
    evidence: payload.evidence,
    calls: { ...state.calls, search: state.calls.search + (payload.calls?.search ?? 0) },
    server: { ...state.server, price: payload.timings ?? null },
  });
}

async function guarded(lang, work) {
  try {
    await work();
  } catch (err) {
    if (controller?.signal.aborted) return;       // the user left; the store was reset
    fail(lang, err?.name === 'AbortError'
      ? text(lang, 'Request timed out, please try again', 'הזמן הקצוב פג, נסה שוב')
      : text(lang, 'Something went wrong, please try again', 'משהו השתבש, נסה שוב'));
  }
}

/** Start a V2 scan from a freshly accepted photograph. */
export function startScanV2({ dataUrl, scanUuid, lang, getToken, compress, assess }) {
  controller?.abort();
  controller = new AbortController();
  t0 = performance.now();
  state = { ...initial(), active: true, scanUuid, image: dataUrl, timings: { photo_accepted: 0 } };
  emit();
  return guarded(lang, () => identify({ dataUrl, lang, getToken, compress, assess, followup: false }));
}

/** Continue the scan with the ONE follow-up photograph it asked for. */
export function followupScanV2({ dataUrl, lang, getToken, compress, assess }) {
  if (!awaitingFollowup()) return Promise.resolve();
  stamp('followup_photo_accepted');
  return guarded(lang, () => identify({ dataUrl, lang, getToken, compress, assess, followup: true }));
}

/** The user has no such label. Nothing is searched; the scan ends honestly. */
export function declineFollowupV2() {
  if (!awaitingFollowup()) return;
  set({
    stage: V2_STAGE.DONE,
    valuation: { state: 'NEED_MORE_INFORMATION', low: null, recommended: null, high: null, basis: { kind: 'none', listings: 0, sources: 0 } },
  });
}

/** Retry after an error: the price step if identity is in hand, else nothing to retry here. */
export function retryPriceV2({ lang, getToken }) {
  if (!state.active || !state.stateToken || state.sufficiency?.decision !== 'SEARCH_NOW') return Promise.resolve();
  return guarded(lang, () => price({ lang, getToken }));
}
