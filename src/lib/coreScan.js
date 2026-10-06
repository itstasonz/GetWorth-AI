// ══════════════════════════════════════════════════════════════════════════════
// THE CORE SCAN — CLIENT
//
// Photograph in, answer out. This module owns one scan from the moment a
// photograph is accepted to the moment the owner presses Sell:
//
//   photograph → what it is → what it sells for second-hand in Israel today
//   → condition → listing
//
// It never stops to ask. When one answer would sharpen the price, the question
// is offered ON the result, beside a price already given; answering re-prices.
//
// It talks to one endpoint, POST /api/scan, in two steps so the item's name is
// on the screen while the market search is still running. Its state lives in a
// tiny store the screen subscribes to; nothing here knows React.
//
// The condition is chosen AFTER the answer, on the result, and changing it
// never calls the server: the valuation carries a price for every condition,
// computed by the server from one body of evidence.
// ══════════════════════════════════════════════════════════════════════════════

export const STAGE = Object.freeze({
  IDLE: 'idle',
  PREPARING: 'preparing',       // the photograph is being readied
  IDENTIFYING: 'identifying',   // step 1 is in flight
  PRICING: 'pricing',           // step 2 is in flight; the identity is already shown
  PRICED: 'priced',
  INSUFFICIENT: 'insufficient', // identified, but no price it will stand behind
  NO_ITEM: 'no_item',
  ERROR: 'error',
});

export const CONDITIONS = Object.freeze(['new_sealed', 'like_new', 'good', 'fair', 'poor']);
/** The condition a listing stores, in the marketplace's own vocabulary. */
export const LISTING_CONDITION = Object.freeze({ new_sealed: 'newSealed', like_new: 'likeNew', good: 'used', fair: 'used', poor: 'poor' });

const IDENTIFY_TIMEOUT_MS = 35_000;   // server ceiling 20s, plus the upload
const PRICE_TIMEOUT_MS = 65_000;      // server ceiling 50s
const MIN_IMAGE_BYTES = 512;
export const MAX_SCAN_IMAGES = 3;
export const MAX_CORRECTION_CHARS = 160;

// Learned from the server, once: this deployment has the core scan switched off.
// It outlives a reset, so the app stops asking and uses the older path for the
// rest of the session.
let unavailable = false;

const initial = () => ({
  active: false,
  unavailable,
  stage: STAGE.IDLE,
  scanUuid: null,
  images: [],
  identity: null,
  token: null,
  condition: null,
  valuation: null,
  valuationId: null,
  answered: null,          // the option index the owner picked, 'dismissed', or null
  correction: null,        // what the owner said the item really is
  error: null,             // { message, code, step, retryable }
  // Milliseconds from the accepted photograph, measured here, on the phone.
  timings: { identity_shown_ms: null, price_shown_ms: null },
});

let state = initial();
let controller = null;
let deps = null;           // { getToken, compress, assess, lang, onIdentified }
let t0 = 0;
const listeners = new Set();
const emit = () => { for (const l of listeners) l(); };
const set = (patch) => { state = { ...state, ...patch }; emit(); };
const elapsed = () => Math.round(performance.now() - t0);

export const scanStore = {
  subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  getSnapshot() { return state; },
  reset() { controller?.abort(); controller = null; deps = null; state = initial(); emit(); },
  /** For the suites: forget that the server said the scan was off. */
  forgetAvailability() { unavailable = false; state = initial(); emit(); },
};

/** Is a scan on screen that a new photograph should be added to rather than replace? */
export const scanActive = () => state.active;

// ── MESSAGES ────────────────────────────────────────────────────────────────
const MESSAGES = {
  photo: ['The photo could not be read. Please take it again.', 'לא הצלחנו לקרוא את התמונה. צלמו שוב.'],
  network: ['No connection. Check your internet and try again.', 'אין חיבור. בדקו את האינטרנט ונסו שוב.'],
  timeout: ['This is taking too long. Please try again.', 'זה לוקח יותר מדי זמן. נסו שוב.'],
  session: ['Your session expired. Please sign in again.', 'פג תוקף ההתחברות. התחברו מחדש.'],
  daily: ['You have reached today\'s scan limit. Try again tomorrow.', 'הגעתם למכסת הסריקות להיום. נסו שוב מחר.'],
  busy: ['Too many scans in a row. Wait a moment and try again.', 'יותר מדי סריקות ברצף. המתינו רגע ונסו שוב.'],
  too_large: ['The photo is too large. Please take it again.', 'התמונה גדולה מדי. צלמו שוב.'],
  expired: ['This scan expired. Please scan the item again.', 'פג תוקף הסריקה. סרקו את הפריט שוב.'],
  other: ['Something went wrong. Please try again.', 'משהו השתבש. נסו שוב.'],
};
const say = (lang, key) => MESSAGES[key][lang === 'he' ? 1 : 0];

function fail(step, key, { code = key, retryable = true } = {}) {
  set({ stage: STAGE.ERROR, error: { message: say(deps?.lang, key), code, step, retryable } });
}

// ── TRANSPORT ───────────────────────────────────────────────────────────────
/** Thrown when an answer arrives for a scan the user has already left or replaced. */
const left = () => Object.assign(new Error('scan left'), { name: 'AbortError' });

async function post(body, timeoutMs) {
  const mine = controller;
  const token = await deps.getToken();
  if (mine !== controller) throw left();
  if (!token) return { status: 401, payload: null };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onAbort = () => ctrl.abort();
  mine?.signal.addEventListener('abort', onAbort);
  try {
    const res = await fetch('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...body, scan_uuid: state.scanUuid, lang: deps.lang === 'he' ? 'he' : 'en' }),
      signal: ctrl.signal,
    });
    let payload = null;
    try { payload = await res.json(); } catch { /* not json */ }
    // A late answer must not bring back a scan that was closed, or land in the next one.
    if (mine !== controller) throw left();
    return { status: res.status, payload };
  } finally {
    clearTimeout(timer);
    mine?.signal.removeEventListener('abort', onAbort);
  }
}

/** Turn a transport outcome that is not an answer into an error on screen. True when it did. */
function refused(step, r) {
  if (r.status === 200) return false;
  if (r.status === 401) fail(step, 'session', { retryable: false });
  else if (r.status === 413) fail(step, 'too_large', { retryable: false });
  else if (r.status === 429) fail(step, r.payload?.limitType === 'user_daily' ? 'daily' : 'busy', { code: 'rate_limited', retryable: r.payload?.limitType !== 'user_daily' });
  else if (r.status === 400 && r.payload?.error === 'invalid_token') fail(step, 'expired', { retryable: false });
  else if (r.status === 400 && step === 'identify') fail(step, 'photo', { code: 'bad_request', retryable: false });
  else fail(step, 'other', { code: `http_${r.status}` });
  return true;
}

/** Run one step; a thrown transport error becomes an error on screen. Never rejects. */
async function guarded(step, work) {
  const mine = controller;
  try { await work(); } catch (err) {
    if (mine !== controller || mine?.signal.aborted) return;   // the scan was left or replaced: say nothing
    fail(step, err?.name === 'AbortError' ? 'timeout' : 'network');
  }
}

// ── STEP 1 — IDENTIFY ───────────────────────────────────────────────────────
const isImage = (d) => typeof d === 'string' && /^data:image\//.test(d) && d.length * 0.75 >= MIN_IMAGE_BYTES;

/** Ready a photograph for sending, or return null after reporting why it cannot be used. */
async function prepare(dataUrl) {
  const mine = controller;
  if (!isImage(dataUrl)) { fail('identify', 'photo', { retryable: false }); return null; }
  let compressed;
  try { compressed = await deps.compress(dataUrl); } catch { compressed = null; }
  if (mine !== controller) throw left();
  if (!isImage(compressed)) { fail('identify', 'photo', { retryable: false }); return null; }
  // null means "could not be inspected", which is not a rejection.
  let pixels = null;
  try { pixels = await deps.assess(compressed); } catch { pixels = null; }
  if (mine !== controller) throw left();
  if (pixels && pixels.ok === false) { fail('identify', 'photo', { code: `photo_${pixels.reason ?? 'blank'}`, retryable: false }); return null; }
  return compressed;
}

async function identify({ correction = null } = {}) {
  set({ stage: STAGE.IDENTIFYING, error: null });
  const r = await post({ action: 'identify', images: state.images, ...(state.token ? { token: state.token } : {}), ...(correction ? { correction } : {}) }, IDENTIFY_TIMEOUT_MS);
  if (r.status === 503) return 'unavailable';
  if (refused('identify', r)) return 'refused';
  const p = r.payload ?? {};
  if (p.status === 'failed') { fail('identify', 'other', { code: p.failure ?? 'failed' }); return 'failed'; }
  set({
    identity: p.identity, token: p.token, valuation: null, valuationId: null, answered: null,
    condition: CONDITIONS.includes(p.default_condition) ? p.default_condition : 'good',
    timings: { ...state.timings, identity_shown_ms: state.timings.identity_shown_ms ?? elapsed() },
  });
  if (p.status === 'no_item') { set({ stage: STAGE.NO_ITEM }); deps.onIdentified?.(); return 'no_item'; }
  // The identity goes on screen now; the price joins it when the search returns.
  set({ stage: STAGE.PRICING });
  deps.onIdentified?.();
  await price();
  return 'ok';
}

// ── STEP 2 — PRICE ──────────────────────────────────────────────────────────
async function price({ answer = null } = {}) {
  set({ stage: STAGE.PRICING, error: null, ...(answer === null ? {} : { answered: answer }) });
  const r = await post({ action: 'price', token: state.token, ...(answer === null ? {} : { answer }), client_elapsed_ms: elapsed() }, PRICE_TIMEOUT_MS);
  if (refused('price', r)) return;
  const p = r.payload ?? {};
  if (p.status === 'failed' || !p.valuation) { fail('price', 'other', { code: p.failure ?? 'failed' }); return; }
  set({
    stage: p.status === 'priced' ? STAGE.PRICED : STAGE.INSUFFICIENT,
    valuation: p.valuation,
    valuationId: p.valuation_id ?? null,
    timings: { ...state.timings, price_shown_ms: elapsed() },
  });
  console.log(`[Scan] photo → identity ${state.timings.identity_shown_ms}ms · photo → price ${state.timings.price_shown_ms}ms (server ${p.timings?.total_ms ?? '?'}ms${p.reused ? ', market research reused' : ''})`);
}

// ── ACTIONS ─────────────────────────────────────────────────────────────────
/**
 * Start a scan from one photograph.
 * Resolves to 'unavailable' when this deployment has the core scan switched
 * off, so the caller can fall back; otherwise the outcome is in the store.
 */
export async function startScan({ dataUrl, scanUuid, lang, getToken, compress, assess, onIdentified = null }) {
  if (unavailable) return 'unavailable';
  controller?.abort();
  controller = new AbortController();
  deps = { getToken, compress, assess, lang, onIdentified };
  t0 = performance.now();
  state = { ...initial(), active: true, stage: STAGE.PREPARING, scanUuid };
  emit();
  let outcome = null;
  await guarded('identify', async () => {
    const image = await prepare(dataUrl);
    if (!image) return;
    set({ images: [image] });
    outcome = await identify();
  });
  if (outcome === 'unavailable') { unavailable = true; scanStore.reset(); return 'unavailable'; }
  return outcome;
}

/** Add the photograph the scan asked for (or one the owner chose to add) and look again. */
export function addScanPhoto({ dataUrl, lang, onIdentified = null }) {
  if (!state.active || !deps) return Promise.resolve();
  deps.lang = lang;
  if (onIdentified) deps.onIdentified = onIdentified;
  return guarded('identify', async () => {
    const before = state.stage;
    set({ stage: STAGE.PREPARING, error: null });
    const image = await prepare(dataUrl);
    if (!image) return;
    if (before === STAGE.ERROR && state.images.length === 0) set({ images: [image] });
    else set({ images: [...state.images, image].slice(-MAX_SCAN_IMAGES) });
    await identify();
  });
}

/** Has the scan a question the owner has not answered or put aside? */
export const openQuestion = (s = state) => (s.identity?.followup?.kind && s.identity.followup.kind !== 'none' && s.answered === null ? s.identity.followup : null);
const settled = () => state.stage === STAGE.PRICED || state.stage === STAGE.INSUFFICIENT;

/** Answer the question with one of its options (by index): the price is redone for that answer. */
export function answerQuestion(index, lang) {
  if (!state.active || !settled() || !openQuestion() || !Number.isInteger(index) || !deps) return Promise.resolve();
  deps.lang = lang;
  return guarded('price', () => price({ answer: index }));
}

/** "Not sure": the price already shown stands, and the question goes away. No request. */
export function dismissQuestion() {
  if (state.active && openQuestion()) set({ answered: 'dismissed' });
}

/** "Wrong item?" — the owner says what it really is; the scan looks again with that. */
export function correctItem(text, lang) {
  const correction = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_CORRECTION_CHARS);
  if (!state.active || !state.token || !correction || !deps) return Promise.resolve();
  deps.lang = lang;
  set({ correction });
  return guarded('identify', () => identify({ correction }));
}

/** Try the step that failed again. */
export function retryScan(lang) {
  if (!state.active || state.stage !== STAGE.ERROR || !deps) return Promise.resolve();
  deps.lang = lang;
  const step = state.error?.step;
  if (step === 'price' && state.token) return guarded('price', () => price({ answer: Number.isInteger(state.answered) ? state.answered : null }));
  if (state.images.length === 0) return Promise.resolve();
  return guarded('identify', () => identify({ correction: state.correction }));
}

export function setScanCondition(condition) {
  if (state.active && CONDITIONS.includes(condition)) set({ condition });
}

// ── WHAT THE SCREEN AND THE LISTING READ ────────────────────────────────────
/** The price band for a condition, or the nearest condition that has one. */
export function bandFor(valuation, condition) {
  const prices = valuation?.status === 'priced' ? valuation.prices : null;
  if (!prices) return null;
  if (prices[condition]) return prices[condition];
  const at = CONDITIONS.indexOf(condition);
  const nearest = [...CONDITIONS].sort((a, b) => Math.abs(CONDITIONS.indexOf(a) - at) - Math.abs(CONDITIONS.indexOf(b) - at)).find((c) => prices[c]);
  return nearest ? prices[nearest] : null;
}

/** The listing's title: the item's own name, as specific as the photograph allowed. */
function fallbackTitle(identity) {
  return identity?.display_name || [identity?.brand, identity?.model ?? identity?.product_family ?? identity?.item_type].filter(Boolean).join(' ') || '';
}

/**
 * Everything the listing form needs from a scan, in the listing's own terms.
 * `price` is '' when the scan did not price: an empty box the owner fills in,
 * never a 0.
 */
export function buildListingDraft(s = state) {
  const band = bandFor(s.valuation, s.condition);
  const i = s.identity ?? {};
  return {
    title: fallbackTitle(i),
    desc: i.listing_description || '',
    price: band ? band.list : '',
    condition: LISTING_CONDITION[s.condition] ?? 'used',
    // The shape the listing and its analytics already read off a scan result.
    result: {
      name: fallbackTitle(i),
      nameHebrew: i.search?.hebrew_name || '',
      category: i.category || 'Other',
      confidence: { high: 0.9, medium: 0.7, low: 0.4 }[i.identity_confidence] ?? 0,
      marketValue: band ? { low: band.low, mid: Math.round((band.low + band.high) / 2), high: band.high, price_method: 'core_scan_web' } : null,
      valuation_id: s.valuationId ?? undefined,
      coreScan: true,
    },
  };
}
