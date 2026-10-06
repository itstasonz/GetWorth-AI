// ══════════════════════════════════════════════════════════════════════════════
// SCAN LAB — TEST DOUBLES
//
// An in-memory store with the same seven methods as api/_lib/scan-lab/store.js,
// which records every call it receives. The suites drive the REAL gate and the
// REAL service against it; only the bytes-on-a-disk-somewhere part is faked.
// ══════════════════════════════════════════════════════════════════════════════
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { mintJWT } from './analyze-harness.mjs';
import { createLabHandler } from '../../api/scan-lab.js';
import { LabError } from '../../api/_lib/scan-lab/truth.js';

export const sha = (b) => createHash('sha256').update(b).digest('hex');
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

/** Shaped like the two kinds of project key; neither is a real credential. */
export const SERVICE_KEY = `${b64url({ alg: 'HS256' })}.${b64url({ role: 'service_role', iss: 'supabase' })}.c2lnbmF0dXJl`;
export const ANON_KEY = `${b64url({ alg: 'HS256' })}.${b64url({ role: 'anon', iss: 'supabase' })}.c2lnbmF0dXJl`;

/** A JPEG whose SOF says `w`×`h`, padded to `bytes`, distinguishable by `fill`. */
export const jpeg = (bytes = 200_000, fill = 0x11, w = 4032, h = 3024) => Buffer.concat([
  Buffer.from([0xFF, 0xD8, 0xFF, 0xC0, 0x00, 0x11, 0x08, h >> 8, h & 0xFF, w >> 8, w & 0xFF, 0x03]),
  Buffer.alloc(bytes - 12, fill),
]);
export const describe = (buf, format = 'jpeg') => ({ sha256: sha(buf), bytes: buf.length, format });

export function fakeLabStore() {
  const rows = new Map();      // owner|set|item -> row
  const objects = new Map();   // path -> Buffer
  const calls = [];
  const k = (o, s, i) => `${o}|${s}|${i}`;
  const note = (method, ...args) => calls.push({ method, args });
  let tokens = 0;
  /** Faults a test can switch on: a storage outage on read or on removal, and an interleaved request. */
  const hooks = { downloadFails: false, removeFails: false, duringDownload: null };
  return {
    rows, objects, calls, hooks,
    /** What the phone does with an upload token: put bytes at the signed path. */
    putObject(path, bytes) { objects.set(path, Buffer.from(bytes)); },
    owners() { return [...new Set(calls.filter((c) => ['listItems', 'getItem', 'putItem', 'deleteItem'].includes(c.method)).map((c) => c.args[0]))]; },
    async listItems(ownerId, setName) { note('listItems', ownerId, setName); return [...rows.values()].filter((r) => r.owner_id === ownerId && r.set_name === setName).map((r) => structuredClone(r)); },
    async getItem(ownerId, setName, itemId) { note('getItem', ownerId, setName, itemId); const r = rows.get(k(ownerId, setName, itemId)); return r ? structuredClone(r) : null; },
    async putItem(ownerId, setName, itemId, patch) {
      note('putItem', ownerId, setName, itemId, patch);
      const prev = rows.get(k(ownerId, setName, itemId)) ?? { owner_id: ownerId, set_name: setName, item_id: itemId, photo: null, pending: null, truth: null, confirmed_at: null };
      const next = { ...prev, ...structuredClone(patch) };
      rows.set(k(ownerId, setName, itemId), next);
      return structuredClone(next);
    },
    /** Only while the row still expects `captureId`; null when another request moved it on. */
    async putItemIfPending(ownerId, setName, itemId, captureId, patch) {
      note('putItemIfPending', ownerId, setName, itemId, captureId, patch);
      const prev = rows.get(k(ownerId, setName, itemId));
      if (!prev || prev.pending?.capture_id !== captureId) return null;
      const next = { ...prev, ...structuredClone(patch) };
      rows.set(k(ownerId, setName, itemId), next);
      return structuredClone(next);
    },
    async deleteItem(ownerId, setName, itemId) { note('deleteItem', ownerId, setName, itemId); rows.delete(k(ownerId, setName, itemId)); },
    async signUpload(path) { note('signUpload', path); tokens += 1; return { path, token: `upload-token-${tokens}` }; },
    async download(path) {
      note('download', path);
      if (hooks.downloadFails) throw new LabError(502, 'storage_failed', 'download: 503');
      const bytes = objects.get(path) ?? null;
      // Something else happening while this request is reading the bytes back.
      if (hooks.duringDownload) { const f = hooks.duringDownload; hooks.duringDownload = null; await f(); }
      return bytes;
    },
    async listPaths(prefix) { note('listPaths', prefix); return [...objects.keys()].filter((p) => p.startsWith(`${prefix}/`)); },
    async signDownload(path, seconds) { note('signDownload', path, seconds); return `https://fake.supabase.co/storage/v1/object/sign/scan-lab/${path}?token=signed-${seconds}s`; },
    async removeObjects(paths) {
      note('removeObjects', paths);
      if (hooks.removeFails) throw new LabError(502, 'storage_failed', 'remove: 503');
      for (const p of paths) objects.delete(p);
    },
  };
}

// ── THE HANDLER HARNESS: the real gate and the real service, a fake store, a trapped network ──
export const USER = '11111111-2222-3333-4444-555555555555';
export const OTHER = '22222222-2222-3333-4444-555555555555';
export const SET = 'preflight-5';
export const ON = { SCAN_LAB_ENABLED: 'true', SCAN_LAB_USER_IDS: USER, SUPABASE_SERVICE_KEY: SERVICE_KEY };
const ENV_KEYS = ['SCAN_LAB_ENABLED', 'SCAN_LAB_USER_IDS', 'SUPABASE_SERVICE_KEY', 'SUPABASE_KEY', 'VERCEL_ENV', 'VERCEL_GIT_COMMIT_SHA',
  'SUPABASE_JWT_SECRET', 'SUPABASE_URL', 'VITE_SUPABASE_URL', 'SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'];

/** Call the real handler with a controlled environment, a fake store and a trapped network. */
export async function call(body, { env = ON, user = USER, headers = {}, method = 'POST', store = fakeLabStore(), raw = null, onLog = null } = {}) {
  const saved = {};
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env.SUPABASE_JWT_SECRET = 'test-secret';
  process.env.SUPABASE_URL = 'https://fake.supabase.co';
  process.env.SUPABASE_ANON_KEY = ANON_KEY;
  for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v;
  const realFetch = globalThis.fetch;
  const outbound = [];
  globalThis.fetch = async (url) => { outbound.push(String(url)); throw new Error('network call attempted'); };
  const orig = { log: console.log, warn: console.warn, error: console.error };
  const lines = [];
  for (const k of ['log', 'warn', 'error']) console[k] = (...a) => { lines.push(a.map(String).join(' ')); if (onLog) onLog(a.map(String).join(' ')); };
  let built = 0;
  try {
    const handler = createLabHandler({ storeFor: () => { built += 1; return store; } });
    const res = await handler(new Request('https://get-worth-ai.vercel.app/api/scan-lab', {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${mintJWT(user)}`, ...headers },
      body: method === 'POST' ? (raw ?? JSON.stringify(body)) : undefined,
    }));
    const text = await res.text();
    let payload = null;
    try { payload = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, payload, text, outbound, store, built, lines, cache: res.headers.get('cache-control'), acao: res.headers.get('access-control-allow-origin') };
  } finally {
    Object.assign(console, orig);
    globalThis.fetch = realFetch;
    for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}
export const act = (action, body = {}, opts) => call({ action, set: SET, ...body }, opts);
/** begin -> the phone uploads -> commit, through the real handler. */
export async function capture(store, itemId, original, prepared, opts = {}) {
  const begun = await act('begin', { item_id: itemId, original: describe(original), prepared: prepared ? describe(prepared) : null }, { store, ...opts });
  assert.equal(begun.status, 200, begun.text);
  store.putObject(begun.payload.uploads.original.path, opts.storedOriginal ?? original);
  if (prepared) store.putObject(begun.payload.uploads.prepared.path, opts.storedPrepared ?? prepared);
  const committed = await act('commit', { item_id: itemId, capture_id: begun.payload.capture_id }, { store, ...opts });
  return { begun, committed };
}
