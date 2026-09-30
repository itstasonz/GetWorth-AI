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
  // What happened to the photograph between the shutter and the provider, on
  // both sides of the request. Facts about the image — type, size, a pixel
  // verdict — and never the image.
  diag: { client: {}, server: null },
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
  // A caller that needs the exact request size serialises the body itself.
  const serialised = typeof body === 'string' ? body : JSON.stringify(body);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: serialised,
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

// ── EVERY FAILURE HAS A NAME ────────────────────────────────────────────────
//
// THE PRODUCTION WITNESS. Three valid photographs, each visibly rendered on the
// scan screen, each answered "Photo capture failed. Please retake the photo."
// The capture had not failed: the photograph was on screen. One predicate
// further down the pipeline had said no, and the screen reported it under the
// name of a different stage, with nothing to say which check, on which image,
// with what measurement.
//
// So a failure is now reported as the stage it happened in and a code for what
// happened there. The wording stays friendly; the code and the measurements
// behind it are on the diagnostic panel.
export const V2_FAILURE = Object.freeze({
  PHOTO_MISSING: 'PHOTO_MISSING',
  PHOTO_NOT_AN_IMAGE: 'PHOTO_NOT_AN_IMAGE',
  PHOTO_CONVERSION_FAILED: 'PHOTO_CONVERSION_FAILED',
  PHOTO_EMPTY: 'PHOTO_EMPTY',
  PHOTO_DECODE_FAILED: 'PHOTO_DECODE_FAILED',
  PHOTO_BLANK_FRAME: 'PHOTO_BLANK_FRAME',
  PHOTO_BLANK_AFTER_CONVERSION: 'PHOTO_BLANK_AFTER_CONVERSION',
  PHOTO_TOO_LARGE: 'PHOTO_TOO_LARGE',
  REQUEST_SERIALIZATION_FAILED: 'REQUEST_SERIALIZATION_FAILED',
  NO_SESSION: 'NO_SESSION',
  NETWORK_ERROR: 'NETWORK_ERROR',
  REQUEST_TIMEOUT: 'REQUEST_TIMEOUT',
  IDENTIFY_HTTP_ERROR: 'IDENTIFY_HTTP_ERROR',
  SERVER_PARSE_FAILED: 'SERVER_PARSE_FAILED',
  PROVIDER_IMAGE_REJECTED: 'PROVIDER_IMAGE_REJECTED',
  PROVIDER_FAILED: 'PROVIDER_FAILED',
  PRICE_HTTP_ERROR: 'PRICE_HTTP_ERROR',
  CLIENT_EXCEPTION: 'CLIENT_EXCEPTION',
});
const F = V2_FAILURE;

const MESSAGE = {
  photo: ['We could not prepare this photo. Please try again.', 'לא הצלחנו להכין את התמונה. אנא נסו שוב.'],
  blank: ['The photo came out blank. Please take it again.', 'התמונה יצאה ריקה. אנא צלמו שוב.'],
  large: ['The photo is too large to send. Please try again.', 'התמונה גדולה מדי לשליחה. אנא נסו שוב.'],
  session: ['Sign in required to scan', 'יש להתחבר כדי לסרוק'],
  network: ['No connection to the server. Please try again.', 'אין חיבור לשרת. אנא נסו שוב.'],
  timeout: ['Request timed out, please try again', 'הזמן הקצוב פג, נסה שוב'],
  identify: ['Identification failed — please try again', 'הזיהוי נכשל — אנא נסה שוב'],
  price: ['The market check failed — please try again', 'בדיקת השוק נכשלה — אנא נסה שוב'],
  other: ['Something went wrong, please try again', 'משהו השתבש, נסה שוב'],
};
const MESSAGE_FOR = {
  [F.PHOTO_MISSING]: 'photo', [F.PHOTO_NOT_AN_IMAGE]: 'photo', [F.PHOTO_CONVERSION_FAILED]: 'photo',
  [F.PHOTO_EMPTY]: 'photo', [F.PHOTO_DECODE_FAILED]: 'photo', [F.PHOTO_BLANK_AFTER_CONVERSION]: 'photo',
  [F.PHOTO_BLANK_FRAME]: 'blank', [F.PHOTO_TOO_LARGE]: 'large', [F.REQUEST_SERIALIZATION_FAILED]: 'photo',
  [F.NO_SESSION]: 'session', [F.NETWORK_ERROR]: 'network', [F.REQUEST_TIMEOUT]: 'timeout',
  [F.IDENTIFY_HTTP_ERROR]: 'identify', [F.SERVER_PARSE_FAILED]: 'identify',
  [F.PROVIDER_IMAGE_REJECTED]: 'identify', [F.PROVIDER_FAILED]: 'identify', [F.PRICE_HTTP_ERROR]: 'price',
};

const note = (patch) => set({ diag: { ...state.diag, client: { ...state.diag.client, ...patch } } });
const clip = (v, n = 160) => String(v ?? '').replace(/(eyJ|sk-)[A-Za-z0-9._-]{8,}/g, '[redacted]').slice(0, n);

/** Stop the scan at `stage`, for the reason `code`. */
function fail(lang, code, stage, detail = null, retryable = true) {
  const [en, he] = MESSAGE[MESSAGE_FOR[code] ?? 'other'];
  note({ failure_stage: stage, failure_code: code, failure_detail: detail });
  set({ stage: V2_STAGE.ERROR, error: { message: text(lang, en, he), retryable, code, stage, detail } });
}

/** What a captured value IS, without reading what is in it. */
export function describeCapture(value) {
  if (value === null || value === undefined || value === '') return { present: false, type: 'none', mime: null, bytes: 0 };
  if (typeof value !== 'string') {
    return { present: true, type: typeof Blob !== 'undefined' && value instanceof Blob ? 'blob' : typeof value, mime: value?.type ?? null, bytes: value?.size ?? 0 };
  }
  if (value.startsWith('blob:')) return { present: true, type: 'object_url', mime: null, bytes: 0 };
  const m = /^data:([^;,]*)[^,]*,/.exec(value);
  if (!m) return { present: true, type: 'string', mime: null, bytes: 0 };
  return { present: true, type: 'data_url', mime: m[1] || null, bytes: Math.round((value.length - m[0].length) * 0.75) };
}

const MIN_IMAGE_BYTES = 512;
const usableImage = (d) => d.type === 'data_url' && String(d.mime).startsWith('image/') && d.bytes >= MIN_IMAGE_BYTES;
const BLANK = new Set(['black_frame', 'uniform_frame', 'fully_transparent', 'zero_dimensions']);
const UNDECODABLE = new Set(['decode_failed', 'decoded_zero_dimensions']);

async function identify({ dataUrl, lang, getToken, compress, assess, followup }) {
  set({ stage: V2_STAGE.PREPARING, error: null });

  // ── CAPTURE ──────────────────────────────────────────────────────────────
  const capture = describeCapture(dataUrl);
  note({
    followup: !!followup,
    capture_present: capture.present, capture_type: capture.type, capture_mime: capture.mime, capture_bytes: capture.bytes,
    preview_present: !!(followup ? dataUrl : state.image),
    compression_started: false, compression_succeeded: null, compressed_mime: null, compressed_bytes: null,
    pixel_check: null, raw_pixel_check: null, request_started: false, request_payload_bytes: null,
    identify_http_status: null, identify_roundtrip_ms: null, failure_stage: null, failure_code: null, failure_detail: null,
  });
  if (!capture.present) { fail(lang, F.PHOTO_MISSING, 'capture'); return; }
  if (!usableImage(capture)) {
    fail(lang, capture.bytes < MIN_IMAGE_BYTES && capture.type === 'data_url' ? F.PHOTO_EMPTY : F.PHOTO_NOT_AN_IMAGE,
      'capture', `${capture.type} ${capture.mime ?? 'no mime'} ${capture.bytes}B`);
    return;
  }

  // ── CONVERSION ───────────────────────────────────────────────────────────
  note({ compression_started: true });
  let compressed;
  try {
    compressed = await compress(dataUrl);
  } catch (err) {
    note({ compression_succeeded: false });
    fail(lang, F.PHOTO_CONVERSION_FAILED, 'compression', clip(err?.message));
    return;
  }
  stamp(followup ? 'followup_compression_complete' : 'compression_complete');
  const converted = describeCapture(compressed);
  note({
    compression_succeeded: usableImage(converted), compression_skipped: compressed === dataUrl,
    compressed_mime: converted.mime, compressed_bytes: converted.bytes,
  });
  // A canvas that could not be allocated encodes as "data:,": a string, and no image.
  if (!usableImage(converted)) {
    fail(lang, F.PHOTO_EMPTY, 'compression', `${converted.type} ${converted.mime ?? 'no mime'} ${converted.bytes}B`);
    return;
  }

  // ── DOES THE IMAGE THAT WILL BE SENT CONTAIN ANYTHING? ───────────────────
  //
  // null means "could not be inspected", which is not a rejection. An explicit
  // `ok: false` stops the scan — and says WHICH check said no, on WHICH image.
  // When the converted image fails, the captured one is inspected too, so a
  // photograph that was fine until it was converted is reported as exactly that.
  const pixels = await assess(compressed);
  note({ pixel_check: pixels ?? 'not_inspectable' });
  if (pixels && pixels.ok === false) {
    const raw = compressed === dataUrl ? pixels : await Promise.resolve(assess(dataUrl)).catch(() => null);
    note({ raw_pixel_check: raw ?? 'not_inspectable' });
    const reason = String(pixels.reason ?? 'unknown');
    const rawFine = compressed !== dataUrl && raw && raw.ok === true;
    const code = UNDECODABLE.has(reason) ? F.PHOTO_DECODE_FAILED
      : (BLANK.has(reason) ? (rawFine ? F.PHOTO_BLANK_AFTER_CONVERSION : F.PHOTO_BLANK_FRAME) : F.PHOTO_EMPTY);
    fail(lang, code, 'pixel_check', `converted: ${reason}; captured: ${raw ? (raw.ok ? 'ok' : raw.reason) : 'not inspectable'}`);
    return;
  }
  set(followup ? { followupImage: compressed } : { image: compressed });

  const token = await getToken();
  if (!token) { fail(lang, F.NO_SESSION, 'session', null, false); return; }

  // ── REQUEST ──────────────────────────────────────────────────────────────
  let body;
  try {
    body = JSON.stringify({
      scan_uuid: state.scanUuid,
      image: compressed.slice(compressed.indexOf(',') + 1),
      language: lang,
      ...(followup ? { state: state.stateToken } : {}),
    });
  } catch (err) {
    fail(lang, F.REQUEST_SERIALIZATION_FAILED, 'request', clip(err?.message));
    return;
  }
  set({ stage: V2_STAGE.IDENTIFYING });
  note({ request_started: true, request_payload_bytes: body.length });
  stamp(followup ? 'followup_request_start' : 'identity_request_start');
  const sentAt = performance.now();
  let response;
  try {
    response = await post('/api/v2/identify', body, token, IDENTIFY_TIMEOUT_MS, controller.signal);
  } catch (err) {
    if (controller?.signal.aborted) throw err;          // the user left
    note({ identify_roundtrip_ms: Math.round(performance.now() - sentAt) });
    fail(lang, err?.name === 'AbortError' ? F.REQUEST_TIMEOUT : F.NETWORK_ERROR, 'request', clip(err?.message));
    return;
  }
  const { status, payload } = response;
  stamp(followup ? 'followup_complete' : 'identity_complete');
  note({ identify_http_status: status, identify_roundtrip_ms: Math.round(performance.now() - sentAt) });
  if (payload?.diagnostics) set({ diag: { ...state.diag, server: payload.diagnostics } });

  if (status !== 200 || payload?.status !== 'OK') {
    const detail = clip([payload?.error, payload?.detail, payload?.failure, payload?.reason].filter(Boolean).join(' · ') || `HTTP ${status}`);
    const code = status === 413 ? F.PHOTO_TOO_LARGE
      : (status === 401 ? F.NO_SESSION
        : (status === 400 ? F.SERVER_PARSE_FAILED
          : (status === 200 && payload?.status === 'FAILED'
            ? (/^http_4/.test(String(payload.failure)) ? F.PROVIDER_IMAGE_REJECTED : F.PROVIDER_FAILED)
            : F.IDENTIFY_HTTP_ERROR)));
    fail(lang, code, status === 200 ? 'provider' : 'server', detail, status !== 401);
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
  if (!token) { fail(lang, F.NO_SESSION, 'session', null, false); return; }
  set({ stage: V2_STAGE.SEARCHING });
  stamp('search_request_start');
  const { status, payload } = await post('/api/v2/price', { scan_uuid: state.scanUuid, state: state.stateToken }, token, PRICE_TIMEOUT_MS, controller.signal);
  stamp('price_complete');
  if (status !== 200 || payload?.status !== 'OK') {
    fail(lang, F.PRICE_HTTP_ERROR, 'price', clip([payload?.error, payload?.detail].filter(Boolean).join(' · ') || `HTTP ${status}`));
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
    fail(lang, err?.name === 'AbortError' ? F.REQUEST_TIMEOUT
      : (err?.name === 'TypeError' && /fetch|network|load failed/i.test(String(err?.message)) ? F.NETWORK_ERROR : F.CLIENT_EXCEPTION),
    'client', clip(`${err?.name ?? 'Error'}: ${err?.message ?? ''}`));
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
