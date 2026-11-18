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

import { lineReader } from './scanStream.js';
import { calculatedFor } from './calculatedEstimate.js';
import { conditionFromAnswers, factsFromAnswers, questionsFor } from './questionnaire.js';
export const STAGE = Object.freeze({
  IDLE: 'idle',
  PREPARING: 'preparing',       // the photograph is being readied
  IDENTIFYING: 'identifying',   // step 1 is in flight
  PRICING: 'pricing',           // step 2 is in flight; the identity is already shown
  PRICED: 'priced',
  INSUFFICIENT: 'insufficient', // identified, but no price it will stand behind
  NEEDS_DETAIL: 'needs_detail', // identified, but one detail the price needs is missing: the server asked for it before searching
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
/** The owner's own words as an answer to a choice whose options do not fit: short, and the server bounds it again. */
export const MAX_ANSWER_CHARS = 40;

// Learned from the server, once: the core scan is not available to this account
// (switched off, or the account is not on the rollout list). It outlives a
// reset, so the app stops asking and uses the older path — until the account
// changes, when it is forgotten: the answer belongs to an account, not a device.
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
  // The owner's answers to the product questions (questionnaire.js), by question id. They set the condition and add
  // facts to the listing; they never call the server.
  productAnswers: {},
  productSkipped: [],      // product questions the owner skipped: not asked again in this scan
  valuation: null,
  valuationId: null,
  // The price was answered from a product's older research while the server renews it (service.js stale-while-revalidate).
  refreshing: false,
  answered: null,          // the option index the owner picked, 'dismissed', or null
  reported: false,         // the phone's timings went to the server (once per scan)
  correction: null,        // what the owner said the item really is
  error: null,             // { message, code, step, retryable }
  // Milliseconds from the accepted photograph, measured here, on the phone.
  // Where the wait went (2026-11-15): photo ready (compressed + checked), identify request sent, price request sent.
  timings: { identity_shown_ms: null, price_shown_ms: null, prepared_ms: null, identify_sent_ms: null, price_sent_ms: null },
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
  /** A different account may get a different answer: drop the scan and forget what the last account was told. */
  forgetAvailability() { unavailable = false; scanStore.reset(); },
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
  unavailable: ['Scanning is temporarily unavailable. Please try again in a few minutes.', 'הסריקה אינה זמינה כרגע. נסו שוב בעוד כמה דקות.'],
  // The service behind the scan is down on our side (2026-11-08: the AI provider account ran out of credit). Nothing about
  // the photo or the person: say so, and say the attempt was not counted — true for exactly these codes (outageOf).
  outage: ['Scanning is unavailable right now because of a problem on our side. This attempt was not counted toward your daily scans. Please try again later.', 'הסריקה אינה זמינה כרגע בגלל תקלה אצלנו. הניסיון הזה לא נספר במכסת הסריקות היומית. נסו שוב מאוחר יותר.'],
};

/**
 * A provider failure the server did not bill (api/_lib/scan/service.js NOT_BILLED) is an outage on our side: the
 * daily allowance was given back. Of those, an account or configuration problem does not go away by trying again now.
 * Resolves to { key, retryable } or null for a failure that is not an outage (a timeout, an unreadable answer).
 */
const OUTAGE = /^(network|auth|rate_limited|credit_exhausted|upstream_5xx|not_configured|http_\d{3})$/;
const LASTING = /^(credit_exhausted|auth|not_configured)$/;
export function outageOf(code) {
  const c = String(code ?? '');
  return OUTAGE.test(c) ? { key: 'outage', retryable: !LASTING.test(c) } : null;
}
const say = (lang, key) => MESSAGES[key][lang === 'he' ? 1 : 0];

function fail(step, key, { code = key, retryable = true } = {}) {
  set({ stage: STAGE.ERROR, error: { message: say(deps?.lang, key), code, step, retryable } });
}

// ── TRANSPORT ───────────────────────────────────────────────────────────────
/** Thrown when an answer arrives for a scan the user has already left or replaced. */
const left = () => Object.assign(new Error('scan left'), { name: 'AbortError' });

async function post(body, timeoutMs, { chained = false } = {}) {
  const mine = controller;
  const token = await deps.getToken();
  if (mine !== controller) throw left();
  if (!token) return { status: 401, payload: null };
  const ctrl = new AbortController();
  let timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onAbort = () => ctrl.abort();
  mine?.signal.addEventListener('abort', onAbort);
  let streaming = false;
  try {
    const res = await fetch('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...body, scan_uuid: state.scanUuid, lang: deps.lang === 'he' ? 'he' : 'en' }),
      signal: ctrl.signal,
    });
    let payload = null;
    let rest = null;
    if (chained && res.body && /ndjson/.test(res.headers?.get?.('content-type') ?? '')) {
      // CHAINED (api/scan.js body.chain): the identity is the first line; the price follows on the same request, on the
      // price step's own clock and the same abort. `rest` is that second line, or null when the stream ends without it.
      const next = lineReader(res);
      payload = await next();
      if (mine !== controller) throw left();
      streaming = true;
      clearTimeout(timer);
      timer = setTimeout(() => ctrl.abort(), PRICE_TIMEOUT_MS);
      rest = next().catch(() => null).finally(() => { clearTimeout(timer); mine?.signal.removeEventListener('abort', onAbort); });
    } else {
      try { payload = await res.json(); } catch { /* not json */ }
    }
    // A late answer must not bring back a scan that was closed, or land in the next one.
    if (mine !== controller) throw left();
    return { status: res.status, payload, rest };
  } finally {
    if (!streaming) {
      clearTimeout(timer);
      mine?.signal.removeEventListener('abort', onAbort);
    }
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
  if (state.timings.prepared_ms === null) set({ timings: { ...state.timings, prepared_ms: elapsed() } });
  return compressed;
}

async function identify({ correction = null } = {}) {
  set({ stage: STAGE.IDENTIFYING, error: null, timings: { ...state.timings, identify_sent_ms: state.timings.identify_sent_ms ?? elapsed() } });
  const r = await post({ action: 'identify', chain: true, images: state.images, ...(state.token ? { token: state.token } : {}), ...(correction ? { correction } : {}) }, IDENTIFY_TIMEOUT_MS, { chained: true });
  // NO OTHER ENGINE STANDS BEHIND THIS ONE (2026-11-08): a scan that is switched off says so and offers a retry. The older
  // engine's model-invented prices are not a fallback.
  if (r.status === 503) { fail('identify', 'unavailable', { code: 'scan_unavailable' }); return 'unavailable'; }
  if (refused('identify', r)) return 'refused';
  const p = r.payload ?? {};
  if (p.status === 'failed') { const o = outageOf(p.failure); fail('identify', o?.key ?? 'other', { code: p.failure ?? 'failed', retryable: o ? o.retryable : true }); return 'failed'; }
  set({
    identity: p.identity, token: p.token, valuation: null, valuationId: null, answered: null,
    // NOT SPECIFIED until the owner says (2026-11-12): a photograph does not show whether a unit works, and "good" is
    // never assumed. The price then is the used market as advertised, and the screen says so.
    condition: CONDITIONS.includes(p.default_condition) ? p.default_condition : null,
    timings: { ...state.timings, identity_shown_ms: state.timings.identity_shown_ms ?? elapsed() },
  });
  if (p.status === 'no_item') { set({ stage: STAGE.NO_ITEM }); deps.onIdentified?.(); return 'no_item'; }
  // The server found the identity too thin to search for — a house of perfume, a brand of blender — or needs one answer
  // before the search (how much perfume is left). Its question comes first; no market request is made until it is met.
  if (p.identity?.incomplete || p.identity?.followup?.required === true) { set({ stage: STAGE.NEEDS_DETAIL }); deps.onIdentified?.(); return 'ok'; }
  // The identity goes on screen now; the price joins it when the search returns.
  set({ stage: STAGE.PRICING });
  deps.onIdentified?.();
  // The server already started the search on this request (p.chained): its answer is the stream's next line.
  await price({ pending: p.chained === true ? r.rest : null });
  return 'ok';
}

/**
 * ONE SILENT FOLLOW-UP when the price came from older research that the server is renewing: after REFRESH_FOLLOW_MS the
 * same token asks again (no quota, no new search if the renewal landed) and a newer valuation replaces the shown one in
 * place. Never more than once per scan, never an error on screen, abandoned if the scan is left or replaced.
 */
export const REFRESH_FOLLOW_MS = 18_000;
let followTimer = null;
function followUpOnce() {
  const mine = controller;
  clearTimeout(followTimer);
  followTimer = setTimeout(async () => {
    if (mine !== controller || !state.active || !state.refreshing) return;
    try {
      const r = await post({ action: 'price', token: state.token, client_elapsed_ms: elapsed() }, PRICE_TIMEOUT_MS);
      const p = r.payload ?? {};
      if (mine !== controller || r.status !== 200 || !p.valuation || p.status === 'failed') { set({ refreshing: false }); return; }
      set({
        stage: p.status === 'priced' ? STAGE.PRICED : STAGE.INSUFFICIENT,
        valuation: p.valuation, valuationId: p.valuation_id ?? state.valuationId,
        ...(p.token ? { token: p.token } : {}),
        refreshing: false,
      });
    } catch { if (mine === controller) set({ refreshing: false }); }
  }, REFRESH_FOLLOW_MS);
}

/** Tell the server how long this scan took on the phone. Best effort, fire and forget. */
function report(outcome) {
  const { identity_shown_ms, price_shown_ms, prepared_ms, identify_sent_ms, price_sent_ms } = state.timings;
  post({ action: 'report', token: state.token, report: { identity_shown_ms, price_shown_ms, prepared_ms, identify_sent_ms, price_sent_ms, outcome } }, 5_000).catch(() => {});
}

// ── STEP 2 — PRICE ──────────────────────────────────────────────────────────
// THE NEWEST PRICE REQUEST WINS (2026-11-15). The owner may answer the question while the first search is still running;
// that answer starts a second request. Whichever returns first, only the latest request's answer is ever shown: an older
// response that lands later is dropped, so a price without the owner's answer never overwrites the one with it.
let priceSeq = 0;
async function price({ answer = null, pending = null } = {}) {
  const seq = ++priceSeq;
  const mine = controller;
  set({ stage: STAGE.PRICING, error: null, ...(answer === null ? {} : { answered: answer }), timings: { ...state.timings, price_sent_ms: state.timings.price_sent_ms ?? elapsed() } });
  // A chained answer when there is one; when the stream ended without it, the phone asks for the price itself (the
  // server's research for this product is then joined or reused, not searched again).
  const line = pending ? await pending : null;
  if (seq !== priceSeq || mine !== controller) return;
  const r = line ? { status: 200, payload: line } : await post({ action: 'price', token: state.token, ...(answer === null ? {} : { answer }), client_elapsed_ms: elapsed() }, PRICE_TIMEOUT_MS);
  if (seq !== priceSeq) return;
  if (refused('price', r)) return;
  const p = r.payload ?? {};
  // The answer was recorded and another question stands before the search: the identity comes back with it, and the
  // market is not asked yet. One question at a time, each answer kept.
  if (p.status === 'identified' && p.identity) {
    set({ identity: p.identity, token: p.token ?? state.token, answered: null, stage: STAGE.NEEDS_DETAIL });
    return;
  }
  if (p.status === 'failed' || !p.valuation) { const o = outageOf(p.failure); fail('price', o?.key ?? 'other', { code: p.failure ?? 'failed', retryable: o ? o.retryable : true }); return; }
  set({
    stage: p.status === 'priced' ? STAGE.PRICED : STAGE.INSUFFICIENT,
    valuation: p.valuation,
    valuationId: p.valuation_id ?? null,
    // With an answer the server re-signed the token and the identity now carries the confirmed fact.
    ...(p.token ? { token: p.token } : {}),
    ...(p.identity ? { identity: p.identity } : {}),
    timings: { ...state.timings, price_shown_ms: elapsed() },
  });
  console.log(`[Scan] photo → identity ${state.timings.identity_shown_ms}ms · photo → price ${state.timings.price_shown_ms}ms (server ${p.timings?.total_ms ?? '?'}ms${p.reused ? ', market research reused' : ''})`);
  // The phone's own clock goes back to the server's telemetry: how long the person actually waited. Never awaited by the
  // screen, never retried, never an error on screen.
  // ONCE per scan, at the FIRST price shown (2026-11-15: a later report after the owner answered a question counted the
  // owner's own reading and tapping as price latency).
  if (!state.reported) { set({ reported: true }); report(p.status === 'priced' ? 'priced' : 'no_price'); }
  set({ refreshing: p.refreshing === true });
  if (p.refreshing === true) followUpOnce();
}

// ── ACTIONS ─────────────────────────────────────────────────────────────────
// ── WARM-UP WHILE THE CAMERA OPENS ──────────────────────────────────────────
// The first identification of a scan spent ~4 s outside the model (2026-11-08): a server instance and its connections
// being set up while the person waited. The camera opening is the moment to do that instead: one small request, no
// photograph, no quota, no paid call (api/scan.js 'warm'), at most once a minute, never in the way of the scan.
export const WARM_EVERY_MS = 60_000;
let warmedAt = -Infinity;
export function warmScan(getToken, { now = Date.now(), fetchImpl = (...a) => fetch(...a) } = {}) {
  if (now - warmedAt < WARM_EVERY_MS) return null;
  warmedAt = now;
  return (async () => {
    try {
      const token = await getToken();
      if (!token) return;
      const id = globalThis.crypto?.randomUUID?.();
      if (!id) return;
      await fetchImpl('/api/scan', {
        method: 'POST', keepalive: true,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'warm', scan_uuid: id, lang: 'en' }),
      });
    } catch { /* a warm-up never fails anything */ }
  })();
}
/** For the suites. */
export function resetWarm() { warmedAt = -Infinity; }

/**
 * Start a scan from one photograph.
 * Resolves to 'unavailable' when this deployment has the core scan switched
 * off — the error is on screen, with a retry; there is no fallback. Otherwise the outcome is in the store.
 */
export async function startScan({ dataUrl, scanUuid, lang, getToken, compress, assess, onIdentified = null }) {
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
    // THE FIRST PHOTOGRAPH IS THE ITEM. A label or a sticker photographed for the scan is supporting evidence: it joins
    // the identification and never takes the item's place as the photograph the screen and the listing lead with.
    // (The founder's perfume, 2026-10-11: the bottom label had replaced the bottle.) When the allowance is full, the
    // OLDEST supporting photograph makes way, never the first.
    else { const [first, ...rest] = state.images; set({ images: [first, ...[...rest, image].slice(-(MAX_SCAN_IMAGES - 1))] }); }
    await identify();
  });
}

/** Has the scan a question the owner has not answered or put aside? */
export const openQuestion = (s = state) => (s.identity?.followup?.kind && s.identity.followup.kind !== 'none' && s.answered === null ? s.identity.followup : null);
const settled = () => state.stage === STAGE.PRICED || state.stage === STAGE.INSUFFICIENT || state.stage === STAGE.NEEDS_DETAIL;

/** An answer in the owner's own words, as the server takes it, or null when there are no words in it. */
const ownWords = (value) => {
  const other = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, MAX_ANSWER_CHARS) : '';
  return other ? { other } : null;
};
const isAnswer = (a) => Number.isInteger(a) || (typeof a === 'number' && Number.isFinite(a)) || (!!a && typeof a === 'object' && typeof a.other === 'string');

/**
 * Answer the question: one of its options (by index) for a choice or yes/no, a number in its unit for a number
 * question, or — for a choice whose options do not fit — the owner's own short words. The price is done, or redone,
 * for that answer.
 */
export function answerQuestion(value, lang) {
  const q = openQuestion();
  // While the price is still being researched the owner may already answer (2026-11-15: the wait is theirs to use). A
  // photograph is asked for only once a result stands: a new photograph identifies the item again.
  const early = state.stage === STAGE.PRICING && q?.kind !== 'photo';
  if (!state.active || !(settled() || early) || !q || !deps) return Promise.resolve();
  let answer = null;
  if (q.kind === 'number') answer = typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
  else if (Number.isInteger(value)) answer = value;
  else if (q.kind === 'choice') answer = ownWords(value);
  if (answer === null) return Promise.resolve();
  deps.lang = lang;
  return guarded('price', () => price({ answer }));
}

/**
 * "Not sure": beside a price already shown it stands and the question goes away, with no request. Before the price,
 * when the question was required, "not sure" is the answer the search is run with, and the price stays approximate.
 * A required photograph has no "not sure": the owner can say what the item is, or sell at their own price.
 */
export function dismissQuestion() {
  const q = openQuestion();
  if (!state.active || !q) return Promise.resolve();
  if (state.stage === STAGE.NEEDS_DETAIL) {
    if (q.kind !== 'choice' || !deps) return Promise.resolve();
    return guarded('price', () => price({ answer: 'unsure' }));
  }
  set({ answered: 'dismissed' });
  return Promise.resolve();
}

/** "Wrong item?" — the owner says what it really is; the scan looks again with that. */
export function correctItem(text, lang) {
  const correction = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_CORRECTION_CHARS);
  if (!state.active || !state.token || !correction || !deps) return Promise.resolve();
  deps.lang = lang;
  // Another product may need other questions: answers about the old one are not carried over.
  set({ correction, productAnswers: {}, productSkipped: [] });
  return guarded('identify', () => identify({ correction }));
}

/** Try the step that failed again. */
export function retryScan(lang) {
  if (!state.active || state.stage !== STAGE.ERROR || !deps) return Promise.resolve();
  deps.lang = lang;
  const step = state.error?.step;
  if (step === 'price' && state.token) return guarded('price', () => price({ answer: isAnswer(state.answered) ? state.answered : null }));
  if (state.images.length === 0) return Promise.resolve();
  return guarded('identify', () => identify({ correction: state.correction }));
}

export function setScanCondition(condition) {
  if (state.active && CONDITIONS.includes(condition)) set({ condition });
}

/**
 * The owner answers a product question (questionnaire.js). The answer is kept; when the answers bear on condition the
 * condition follows them, so the price on screen changes at once, from the valuation already in hand: no request, no
 * new research. `null` takes an answer back. The latest action wins: choosing a condition by hand afterwards stands.
 */
export function answerProductQuestion(id, value) {
  if (!state.active || !state.identity || typeof id !== 'string') return;
  const productAnswers = { ...state.productAnswers };
  if (value === null || value === undefined || value === '') delete productAnswers[id]; else productAnswers[id] = value;
  const derived = conditionFromAnswers(state.identity, productAnswers);
  // Taking an answer back (to change it) asks that question again.
  const productSkipped = state.productSkipped.filter((q) => q !== id);
  set({ productAnswers, productSkipped, ...(derived ? { condition: derived.condition } : {}) });
}

/** The owner skips a product question: it is not asked again in this scan. */
export function skipProductQuestion(id) {
  if (!state.active || typeof id !== 'string' || state.productSkipped.includes(id)) return;
  set({ productSkipped: [...state.productSkipped, id] });
}

/** The product question to ask now, or null when they are done (questionnaire.js). */
export function pendingProductQuestion(s = state) {
  if (!s.identity) return null;
  return questionsFor(s.identity, s.productAnswers ?? {}).find((q) => s.productAnswers?.[q.id] === undefined && !(s.productSkipped ?? []).includes(q.id)) ?? null;
}

// ── WHAT THE SCREEN AND THE LISTING READ ────────────────────────────────────
/**
 * The price band for a condition: the used market as advertised when no condition is chosen; the chosen condition's own
 * band otherwise — and null when there is none (no Israeli ads for units in that condition). Another condition's price is
 * never shown in its place: that was a guess wearing a number (2026-11-12).
 */
export function bandFor(valuation, condition) {
  const prices = valuation?.status === 'priced' ? valuation.prices : null;
  if (!prices) return null;
  if (!condition) return prices.good ?? null;
  return prices[condition] ?? null;
}
/** The used-market band, whatever condition is chosen. */
export const marketBandOf = (valuation) => (valuation?.status === 'priced' ? valuation.prices?.good ?? null : null);

/** The listing's title: the item's own name, as specific as the photograph allowed. */
function fallbackTitle(identity) {
  const name = identity?.display_name || [identity?.brand, identity?.model ?? identity?.product_family ?? identity?.item_type].filter(Boolean).join(' ') || '';
  // A CONFIRMED CAPACITY STAYS IN THE TITLE (Production E2E 2026-11-18: "Apple iPhone 12" after the owner chose 128 GB).
  const size = String(identity?.size_or_capacity ?? '').trim();
  const squash = (v) => v.toLowerCase().replace(/\s+/g, '');
  return name && size && size.length <= 20 && !squash(name).includes(squash(size)) ? `${name} ${size}` : name;
}

/**
 * Everything the listing form needs from a scan, in the listing's own terms.
 * `price` is '' when the scan did not price: an empty box the owner fills in,
 * never a 0.
 */
/**
 * THE LISTING KEEPS THE ENGINE'S PRICES. Each listing condition's suggested price is that condition's listing price from
 * the same valuation (valuation.js conditionPrices) — never the older listing flow's percentage ladder applied to a
 * scan's number (utils.js calcPrice), which gave a core-scan listing a price the engine never computed as soon as the
 * seller touched the condition. "used" is the engine's "good"; with no valuation there is no suggestion.
 */
const LISTING_BAND = Object.freeze({ newSealed: 'new_sealed', likeNew: 'like_new', used: 'good', poor: 'poor' });
export function listingPricesOf(valuation) {
  if (valuation?.status !== 'priced' || !valuation.prices) return null;
  return Object.fromEntries(Object.entries(LISTING_BAND).map(([k, c]) => [k, valuation.prices[c]?.list ?? null]));
}
/** The listing form's suggested price for a condition: the engine's, for a core scan; '' when it gave none. */
export function listingPriceFor(result, listingCondition) {
  const p = result?.listingPrices?.[listingCondition];
  return Number.isFinite(p) && p > 0 ? p : '';
}

/**
 * A unit the owner confirmed as MODIFIED (a custom or replacement shell, an aftermarket part): the market price found is for
 * a standard unit, and what the modification is worth is not known (founder's DualSense, 2026-11-13). Returns the confirmed
 * fact that says so, or null.
 */
const MODIFIED = /(custom|replacement|aftermarket|modified|modded|מותאם|הוחלף|החלפה|אפטרמרקט|שונה)/i;
export function unitModification(identity) {
  return (identity?.confirmed ?? []).find((c) => !c.unsure && c.value && MODIFIED.test(`${c.value}`) && !/^(original|מקורי)/i.test(String(c.value).trim())) ?? null;
}

export function buildListingDraft(s = state) {
  // A modified unit's draft starts with no price: the market price found is a standard unit's.
  const band = unitModification(s.identity) ? null : bandFor(s.valuation, s.condition);
  const i = s.identity ?? {};
  const lang = deps?.lang === 'en' ? 'en' : 'he';
  const facts = factsFromAnswers(i, s.productAnswers ?? {}, lang);
  // FAULTY ON THE SCAN IS SAID IN THE LISTING (2026-11-18): the listing's lowest condition reads "fair or worn", so a
  // unit the owner called faulty says so in its text unless an answer already did.
  const faultSaid = s.productAnswers?.works === 'fault' || s.productAnswers?.looks === 'broken' || s.productAnswers?.structure === 'yes';
  if (s.condition === 'poor' && !faultSaid) facts.unshift(lang === 'he' ? 'המוצר תקול' : 'Not working');
  return {
    title: fallbackTitle(i),
    // The facts the owner gave (box, warranty, battery, purity…) join the description; the owner can edit all of it.
    desc: [i.listing_description || '', ...facts.map((f) => `${f}.`)].filter(Boolean).join('\n'),
    price: band ? band.list : '',
    // No condition chosen on the scan: the listing asks for one — it is never assumed "used".
    condition: s.condition ? (LISTING_CONDITION[s.condition] ?? null) : null,
    // The shape the listing and its analytics already read off a scan result.
    result: {
      name: fallbackTitle(i),
      nameHebrew: i.search?.hebrew_name || '',
      category: i.category || 'Other',
      confidence: { high: 0.9, medium: 0.7, low: 0.4 }[i.identity_confidence] ?? 0,
      // mid is the engine's own worth for this condition, not an average of the range's ends.
      marketValue: band ? { low: band.low, mid: band.worth ?? Math.round((band.low + band.high) / 2), high: band.high, price_method: 'core_scan_web' } : null,
      listingPrices: listingPricesOf(s.valuation),
      // State B: the observed Israeli ads, shown in the listing form for reference only — never a prefilled price.
      comparative: s.valuation?.status === 'priced' ? null : (s.valuation?.comparative ?? null),
      // Method C: the calculated figure for the condition in force, for reference only — never the listing's price.
      calculatedEstimate: s.valuation?.status === 'priced' ? null : (calculatedFor(s.valuation?.calculated, s.condition)?.value ?? null),
      valuation_id: s.valuationId ?? undefined,
      coreScan: true,
    },
  };
}
