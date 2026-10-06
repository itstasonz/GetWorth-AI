// ══════════════════════════════════════════════════════════════════════════════
// SCAN LAB — THE CLIENT HALF
//
//   photograph -> hash -> prepare -> queue on this phone
//              -> begin (server signs upload tokens)
//              -> upload original + prepared straight to private storage
//              -> commit (server reads them back and hashes them itself)
//
// ── TWO FLAGS, ONE OF WHICH IS AUTHORITY ────────────────────────────────────
//
// `VITE_SCAN_LAB_ENABLED` (build time) decides whether the browser ASKS and
// whether the screen is in the bundle at all. `SCAN_LAB_ENABLED` and
// `SCAN_LAB_USER_IDS` on the server decide whether the server ANSWERS, per
// request. An account the server has not enrolled is told nothing and is shown
// nothing; the normal scan is untouched either way.
//
// ── NOTHING HERE CALLS THE ENGINE ───────────────────────────────────────────
//
// This module talks to /api/scan-lab and, with a token that endpoint signs, to
// the project's own storage. It never calls /api/analyze, /api/enrich or
// /api/v2/*, and the human ground truth it sends is read by nothing that
// recognises or prices.
//
// No secret is in this file or reachable from it: the only credential it
// handles is the user's own session token, passed in per call.
// ══════════════════════════════════════════════════════════════════════════════

export const SCAN_LAB_ENABLED = typeof import.meta.env !== 'undefined'
  && import.meta.env.VITE_SCAN_LAB_ENABLED === 'true';

export const LAB_ENDPOINT = '/api/scan-lab';
export const LAB_SET = 'preflight-5';

export const LAB_STAGE = Object.freeze({ QUEUED: 'queued', BEGUN: 'begun', UPLOADED: 'uploaded', FAILED: 'failed' });

export const LAB_FAILURE = Object.freeze({
  NOT_AN_IMAGE: 'NOT_AN_IMAGE',
  HEIC_NOT_SUPPORTED: 'HEIC_NOT_SUPPORTED',
  PHOTO_TOO_LARGE: 'PHOTO_TOO_LARGE',
  PREPARATION_FAILED: 'PREPARATION_FAILED',
  QUEUE_FAILED: 'QUEUE_FAILED',
  SUPERSEDED: 'SUPERSEDED',
  NO_SESSION: 'NO_SESSION',
  OFFLINE: 'OFFLINE',
  UPLOAD_FAILED: 'UPLOAD_FAILED',
  INTEGRITY_MISMATCH: 'INTEGRITY_MISMATCH',
  SERVER_REFUSED: 'SERVER_REFUSED',
});

export class LabClientError extends Error {
  constructor(code, detail = null) { super(detail ? `${code}: ${detail}` : code); this.code = code; this.detail = detail; }
}

const clip = (v, n = 160) => String(v ?? '').replace(/(eyJ|sk-)[A-Za-z0-9._-]{8,}/g, '[redacted]').slice(0, n);

// ── THE ENDPOINT ────────────────────────────────────────────────────────────
/** One authorized request. Resolves to { status, payload }; a network failure throws. */
export async function labRequest(action, body, { getToken, timeoutMs = 20_000, fetchImpl = globalThis.fetch } = {}) {
  const token = await getToken();
  if (!token) return { status: 401, payload: { error: 'unauthorized' } };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(LAB_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...body, action }),
      signal: ctrl.signal,
    });
    let payload = null;
    try { payload = await res.json(); } catch { /* not json */ }
    return { status: res.status, payload };
  } finally {
    clearTimeout(timer);
  }
}

// ── IS THE LAB OPEN FOR THIS ACCOUNT? A CLEAR ANSWER IS ASKED FOR ONCE ──────
const availability = new Map();   // user id -> boolean

/** False unless the build asks AND the server says yes. Any doubt is a no. */
export async function isScanLabAvailable({ userId, getToken, fetchImpl }) {
  if (!SCAN_LAB_ENABLED || !userId) return false;
  if (availability.has(userId)) return availability.get(userId);
  try {
    const { status, payload } = await labRequest('probe', {}, { getToken, timeoutMs: 6000, fetchImpl });
    // UNAVAILABLE is also "yours": an enrolled account must be able to see why storage is not ready.
    const ok = status === 200 && payload?.lab === 'scan-lab' && (payload.status === 'READY' || payload.status === 'UNAVAILABLE');
    // Only a definitive answer is remembered. A timeout, a lost session or a server fault is asked again next time.
    if (ok || status === 403) availability.set(userId, ok);
    return ok;
  } catch { return false; }
}
export const forgetScanLabAvailability = () => availability.clear();

// ── THE PHOTOGRAPH: WHAT IT IS, AND ITS HASH ────────────────────────────────
/** jpeg | png | webp from the first bytes, or null. HEIC is null: the engine does not take it. */
export function sniffImage(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length < 12) return null;
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'png';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp';
  return null;
}

// ISO-BMFF brands. HEIC/HEIF is what an iPhone stores; AVIF is its sibling.
const HEIF_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'hevm', 'hevs', 'mif1', 'msf1']);
const AVIF_BRANDS = new Set(['avif', 'avis']);

/**
 * What a file that cannot be stored actually IS, from its first bytes:
 * 'heic' | 'avif' | 'gif' | 'tiff' | 'video' | 'unknown' — or null for a JPEG,
 * PNG or WEBP, which can.
 *
 * The lab keeps the original exactly as received, and the benchmark tooling it
 * feeds takes JPEG, PNG and WEBP. A HEIC original is therefore named and
 * refused at once, with what to do instead; it is never converted behind the
 * person's back, because the converted file would not be the original.
 */
export function unsupportedKind(bytes) {
  if (sniffImage(bytes)) return null;
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const ascii = (from, to) => String.fromCharCode(...b.subarray(from, to));
  if (b.length >= 12 && ascii(4, 8) === 'ftyp') {
    const brand = ascii(8, 12).toLowerCase();
    if (HEIF_BRANDS.has(brand)) return 'heic';
    if (AVIF_BRANDS.has(brand)) return 'avif';
    return 'video';
  }
  if (b.length >= 4 && ascii(0, 4) === 'GIF8') return 'gif';
  if (b.length >= 4 && (ascii(0, 4) === 'II*\0' || ascii(0, 4) === 'MM\0*')) return 'tiff';
  return 'unknown';
}

/**
 * Look at a chosen file BEFORE reading all of it: sixteen bytes say whether it
 * can be stored. Throws the named refusal; resolves to the format otherwise.
 */
export async function checkFile(file) {
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const kind = unsupportedKind(head);
  if (kind === 'heic') throw new LabClientError(LAB_FAILURE.HEIC_NOT_SUPPORTED, 'HEIC/HEIF');
  if (kind) throw new LabClientError(LAB_FAILURE.NOT_AN_IMAGE, kind);
  return sniffImage(head);
}

export async function sha256Hex(buffer) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

function dataUrlToBytes(dataUrl) {
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * The original, untouched, and the derivative the PWA's own preparation makes.
 *
 * `compress` is the scan's own image preparation, handed in by the screen; when
 * it returns its input (the under-150 KB rule) there is no derivative, exactly
 * as a scan would send the original as it is. `assess` is the scan's own pixel
 * check, applied to the derivative as a scan applies it to what it sends.
 */
export async function prepareCapture({ bytes, compress, readDataUrl, maxBytes, assess = null }) {
  const format = sniffImage(bytes);
  if (!format) throw (unsupportedKind(bytes) === 'heic' ? new LabClientError(LAB_FAILURE.HEIC_NOT_SUPPORTED, 'HEIC/HEIF') : new LabClientError(LAB_FAILURE.NOT_AN_IMAGE, unsupportedKind(bytes)));
  if (maxBytes && bytes.byteLength > maxBytes) throw new LabClientError(LAB_FAILURE.PHOTO_TOO_LARGE, `${Math.round(bytes.byteLength / 1048576)} MB`);
  const original = { bytes, sha256: await sha256Hex(bytes), size: bytes.byteLength, format };

  let prepared = null;
  try {
    const dataUrl = await readDataUrl(new Blob([bytes], { type: `image/${format}` }));
    const compressed = await compress(dataUrl);
    if (compressed !== dataUrl) {
      // The scan refuses a frame its pixel check calls blank; a blank derivative is not stored either.
      // null means "could not be inspected", which is not a rejection — the scan's own rule.
      const verdict = assess ? await assess(compressed) : null;
      if (verdict && verdict.ok === false) throw new Error(`the prepared copy is blank (${verdict.reason ?? 'unknown'})`);
      const out = dataUrlToBytes(compressed);
      if (sniffImage(out) !== 'jpeg') throw new Error('the preparation did not produce a JPEG');
      const sha256 = await sha256Hex(out);
      if (sha256 !== original.sha256) prepared = { bytes: out.buffer, sha256, size: out.byteLength, format: 'jpeg' };
    }
  } catch (err) {
    throw new LabClientError(LAB_FAILURE.PREPARATION_FAILED, clip(err?.message));
  }
  return { original, prepared };
}

// ── THE QUEUE: ONE CAPTURE PER ITEM, RESUMABLE AT EVERY STEP ────────────────
//
// Two keys per item. The BYTES are written once; the small RECORD beside them
// is what gets rewritten as the upload advances, so a 10 MB photograph is not
// re-serialised at every step and reading the queue never loads a photograph.
// Both carry the same `localId`: it is how a run knows the slot is still its own.
export const captureKey = (userId, set, itemId) => `capture|${userId}|${set}|${itemId}`;
export const bytesKey = (userId, set, itemId) => `bytes|${userId}|${set}|${itemId}`;
export const draftKey = (userId, set, itemId) => `draft|${userId}|${set}|${itemId}`;

/** An upload token lives two hours. One this old is renewed rather than tried. */
const TOKEN_MAX_AGE_MS = 100 * 60 * 1000;
const UPLOAD_TIMEOUT_MS = 5 * 60 * 1000;
const newLocalId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** Put a prepared photograph on the phone's queue. Nothing has left the device yet. */
export async function queueCapture({ db, userId, set, itemId, capture, now = () => new Date() }) {
  const part = (p) => (p ? { sha256: p.sha256, size: p.size, format: p.format } : null);
  const localId = newLocalId();
  const record = {
    localId, userId, set, itemId, stage: LAB_STAGE.QUEUED, createdAt: now().toISOString(),
    original: part(capture.original), prepared: part(capture.prepared),
    captureId: null, bucket: null, uploads: null, begunAt: null, uploaded: { original: false, prepared: false }, error: null,
  };
  // If the phone cannot hold it (storage full, a database that refuses), nothing is sent:
  // a photograph that exists only in a request in flight is one dropped connection from lost.
  try {
    await db.put(bytesKey(userId, set, itemId), { localId, original: capture.original.bytes, prepared: capture.prepared?.bytes ?? null });
    await db.put(captureKey(userId, set, itemId), record);
  } catch (err) {
    throw new LabClientError(LAB_FAILURE.QUEUE_FAILED, clip(err?.message));
  }
  return record;
}

/** Take a capture off the phone. A run still driving it notices and writes nothing more. */
export async function discardCapture({ db, userId, set, itemId }) {
  await db.delete(captureKey(userId, set, itemId));
  await db.delete(bytesKey(userId, set, itemId));
}

class Superseded extends Error {}
const describe = (part) => ({ sha256: part.sha256, bytes: part.size, format: part.format });
const duplicate = (r) => r?.status === 409 || /already exists|duplicate/i.test(String(r?.error));
const settled = (promise, ms) => new Promise((resolve) => {
  const timer = setTimeout(() => resolve({ ok: false, error: 'the upload timed out' }), ms);
  Promise.resolve(promise).then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); resolve({ ok: false, error: e?.message }); });
});
const inFlight = new Map();   // queue key -> { localId, promise }

/**
 * Drive one queued capture as far as it will go.
 *
 * Resolves to { ok: true, item } when the server holds verified bytes, or to
 * { ok: false, code, retryable } with the record still on the queue. Calling it
 * again continues from the step that did not finish. The same capture is never
 * driven twice at once; a NEWER photograph for the slot waits for the older run
 * to let go and is then driven itself — it is never answered with the old one.
 */
export function runCapture(args) {
  const key = captureKey(args.record.userId, args.record.set, args.record.itemId);
  const running = inFlight.get(key);
  if (running) {
    if (running.localId === args.record.localId) return running.promise;
    return running.promise.catch(() => {}).then(() => runCapture(args));
  }
  const promise = drive(key, args).finally(() => { if (inFlight.get(key)?.promise === promise) inFlight.delete(key); });
  inFlight.set(key, { localId: args.record.localId, promise });
  return promise;
}

async function drive(key, { record, db, request, upload, onStage = () => {}, uploadTimeoutMs = UPLOAD_TIMEOUT_MS, now = () => Date.now() }) {
  const dataKey = bytesKey(record.userId, record.set, record.itemId);
  // Every write first checks that the queue still holds THIS capture. A retake or a discard in the
  // meantime owns the slot now, and this run must not write over it or delete it.
  const mine = async () => (await db.get(key))?.localId === record.localId;
  const save = async (patch) => {
    if (!(await mine())) throw new Superseded();
    Object.assign(record, patch);
    await db.put(key, record);
    onStage(record);
  };
  const stop = async (code, detail, retryable) => {
    await save({ error: { code, detail: clip(detail) }, ...(retryable ? {} : { stage: LAB_STAGE.FAILED }) });
    return { ok: false, code, detail: clip(detail), retryable };
  };
  const restart = () => save({ stage: LAB_STAGE.QUEUED, captureId: null, uploads: null, bucket: null, begunAt: null, uploaded: { original: false, prepared: false } });
  const refused = (r) => (r.status === 401 ? stop(LAB_FAILURE.NO_SESSION, null, true)
    : stop(LAB_FAILURE.SERVER_REFUSED, [r.payload?.error, r.payload?.detail].filter(Boolean).join(' · ') || `HTTP ${r.status}`, r.status >= 500));
  const where = { set: record.set, item_id: record.itemId };

  try {
    if (record.error) await save({ error: null });
    // A capture that keeps being sent back to the start is failing for a reason a loop will not fix.
    for (let round = 0; round < 3; round += 1) {
      if (record.stage === LAB_STAGE.FAILED) await restart();
      if (record.stage === LAB_STAGE.BEGUN && now() - Date.parse(record.begunAt ?? 0) > TOKEN_MAX_AGE_MS) await restart();

      if (record.stage === LAB_STAGE.QUEUED) {
        const r = await request('begin', { ...where, original: describe(record.original), prepared: record.prepared ? describe(record.prepared) : null });
        if (r.status !== 200 || r.payload?.status !== 'OK') return await refused(r);
        await save({ stage: LAB_STAGE.BEGUN, captureId: r.payload.capture_id, bucket: r.payload.bucket, uploads: r.payload.uploads, begunAt: new Date(now()).toISOString(), error: null });
      }

      if (record.stage === LAB_STAGE.BEGUN) {
        const data = await db.get(dataKey);
        if (!data || data.localId !== record.localId) throw new Superseded();
        let tokenRejected = false;
        for (const part of ['original', 'prepared']) {
          if (!record[part] || record.uploaded[part]) continue;
          const target = record.uploads?.[part];
          const r = await settled(upload({ bucket: record.bucket, path: target?.path, token: target?.token, bytes: data[part], contentType: `image/${record[part].format}` }), uploadTimeoutMs);
          // Already there: an earlier attempt landed before the app closed. Commit hashes it either way.
          if (r?.ok || duplicate(r)) { await save({ uploaded: { ...record.uploaded, [part]: true } }); continue; }
          if (r?.status === 413 || r?.status === 415) return await stop(LAB_FAILURE.SERVER_REFUSED, `${part}: ${r.error ?? `HTTP ${r.status}`}`, false);
          // Storage answered and said no: the token is spent or expired. Only a new begin gets a new one.
          if (r?.status >= 400 && r.status < 500) { tokenRejected = true; break; }
          return await stop(LAB_FAILURE.UPLOAD_FAILED, `${part}: ${r?.error ?? 'no response'}`, true);
        }
        if (tokenRejected) { await restart(); continue; }
        await save({ stage: LAB_STAGE.UPLOADED });
      }

      const r = await request('commit', { ...where, capture_id: record.captureId });
      if (r.status === 200 && r.payload?.status === 'OK') {
        // The server holds it. The phone lets go — unless a newer photograph took the slot meanwhile.
        if (await mine()) {
          await db.delete(key);
          if ((await db.get(dataKey))?.localId === record.localId) await db.delete(dataKey);
        }
        return { ok: true, item: r.payload.item };
      }
      if (r.status === 409 && r.payload?.error === 'integrity_mismatch') return await stop(LAB_FAILURE.INTEGRITY_MISMATCH, r.payload.detail, false);
      // The server no longer expects this upload (a newer capture began, or the objects never landed): start it again.
      if (r.status === 409) { await restart(); continue; }
      return await refused(r);
    }
    return await stop(LAB_FAILURE.UPLOAD_FAILED, 'the upload did not complete after three attempts', true);
  } catch (err) {
    if (err instanceof Superseded) return { ok: false, code: LAB_FAILURE.SUPERSEDED, retryable: false };
    // fetch threw: no connection, or the request timed out. The record keeps its stage.
    try { return await stop(LAB_FAILURE.OFFLINE, err?.message, true); } catch (again) {
      return { ok: false, code: again instanceof Superseded ? LAB_FAILURE.SUPERSEDED : LAB_FAILURE.QUEUE_FAILED, retryable: false };
    }
  }
}

/** Every capture this account left on this phone for a set, oldest first. Records only: no photograph is read. */
export async function pendingCaptures({ db, userId, set }) {
  const found = await db.entries(`capture|${userId}|${set}|`);
  return found.map((e) => e.value).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

/**
 * Continue everything that did not finish: after reopening the app, or when the
 * connection returns. A capture the server REFUSED is left for the person to
 * retry or discard; it is not resent on its own.
 */
export async function resumeCaptures({ db, userId, set, request, upload, onStage }) {
  const results = [];
  for (const record of await pendingCaptures({ db, userId, set })) {
    if (record.stage === LAB_STAGE.FAILED) continue;
    results.push({ itemId: record.itemId, ...(await runCapture({ record, db, request, upload, onStage })) });
  }
  return results;
}
