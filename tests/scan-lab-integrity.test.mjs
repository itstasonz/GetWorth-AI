// ══════════════════════════════════════════════════════════════════════════════
// SCAN LAB — WHAT HAPPENS WHEN THINGS GO WRONG AT THE SAME TIME
//
// tests/scan-lab-server.test.mjs holds the gate and the happy capture. This file
// holds the cases an independent review found the first version got wrong:
//
//   - a commit racing a newer begin must record nothing;
//   - "storage could not be read" must never be taken for "was never uploaded";
//   - a deletion that could not remove the bytes must fail, not say "deleted";
//   - a confirmation belongs to the photograph it was made for;
//   - a newer photograph on the phone must never lose to an older upload;
//   - an upload token that storage rejects must be renewed, not retried forever.
//
//   node --test tests/scan-lab-integrity.test.mjs
// ══════════════════════════════════════════════════════════════════════════════
import { test, describe as suite } from 'node:test';
import assert from 'node:assert/strict';

import { fakeLabStore, jpeg, describe, sha, SERVICE_KEY, USER, SET, act, capture } from './helpers/scan-lab-fakes.mjs';
import { createLabStore } from '../api/_lib/scan-lab/store.js';
import { LabError } from '../api/_lib/scan-lab/truth.js';
import {
  LAB_SET, LAB_STAGE, LAB_FAILURE, isScanLabAvailable, prepareCapture, queueCapture, discardCapture, runCapture, resumeCaptures,
  pendingCaptures, captureKey, bytesKey,
} from '../src/lib/scanLab.js';
import { memoryLabDb, openLabDb } from '../src/lib/scanLabDb.js';

const ORIGINAL = jpeg(900_000, 0x11);
const PREPARED = jpeg(180_000, 0x22, 1280, 960);
const TRUTH = { identity: { brand: 'Ninja' }, provenance: { brand: ['PHYSICAL_LABEL'] }, condition: 'Good' };
const KEY = `${USER}|${SET}|pf-appliance`;

// ── SLI-1 THE SERVER ────────────────────────────────────────────────────────
suite('SLI-1 the server under a race and under a storage fault', () => {
  test('SLI-1a a commit that a newer begin overtook records nothing, and the newer capture is still expected', async () => {
    const store = fakeLabStore();
    const first = await act('begin', { item_id: 'pf-appliance', original: describe(ORIGINAL) }, { store });
    store.putObject(first.payload.uploads.original.path, ORIGINAL);
    let second = null;
    // The first commit has read its bytes back and they match. Before it can write, another device
    // begins a retake of the same slot (which removes the first capture's objects).
    store.hooks.duringDownload = async () => { second = await act('begin', { item_id: 'pf-appliance', original: describe(jpeg(700_000, 0x44)) }, { store }); };
    const overtaken = await act('commit', { item_id: 'pf-appliance', capture_id: first.payload.capture_id }, { store });
    assert.deepEqual([overtaken.status, overtaken.payload.error], [409, 'no_pending_capture']);
    const row = store.rows.get(KEY);
    assert.deepEqual([row.photo, row.pending.capture_id], [null, second.payload.capture_id], 'a record was written over a capture that had been replaced');
    store.putObject(second.payload.uploads.original.path, jpeg(700_000, 0x44));
    const good = await act('commit', { item_id: 'pf-appliance', capture_id: second.payload.capture_id }, { store });
    assert.deepEqual([good.status, good.payload.item.photo.master.sha256], [200, sha(jpeg(700_000, 0x44))]);
  });
  test('SLI-1b a storage fault while reading back is a 502, never "upload missing": the capture and its objects are kept for a retry', async () => {
    const store = fakeLabStore();
    const begun = await act('begin', { item_id: 'pf-appliance', original: describe(ORIGINAL) }, { store });
    store.putObject(begun.payload.uploads.original.path, ORIGINAL);
    store.hooks.downloadFails = true;
    const down = await act('commit', { item_id: 'pf-appliance', capture_id: begun.payload.capture_id }, { store });
    assert.deepEqual([down.status, down.payload.error], [502, 'storage_failed']);
    assert.deepEqual([store.rows.get(KEY).pending.capture_id, store.objects.size], [begun.payload.capture_id, 1]);
    store.hooks.downloadFails = false;
    assert.equal((await act('commit', { item_id: 'pf-appliance', capture_id: begun.payload.capture_id }, { store })).status, 200);
  });
  test('SLI-1c a deletion that could not remove the bytes fails and keeps the record that names them', async () => {
    const store = fakeLabStore();
    await capture(store, 'pf-appliance', ORIGINAL, PREPARED);
    store.hooks.removeFails = true;
    for (const [action, body] of [['remove', { item_id: 'pf-appliance', what: 'photo' }], ['remove', { item_id: 'pf-appliance', what: 'item' }], ['remove_set', { confirm: SET }]]) {
      const r = await act(action, body, { store });
      assert.deepEqual([r.status, r.payload.error], [502, 'storage_failed'], `${action} ${body.what ?? ''}`);
      assert.deepEqual([store.rows.get(KEY).photo.master.sha256, store.objects.size], [sha(ORIGINAL), 2], 'the record was dropped while the photograph is still in storage');
    }
    store.hooks.removeFails = false;
    assert.equal((await act('remove', { item_id: 'pf-appliance', what: 'item' }, { store })).status, 200);
    assert.deepEqual([store.rows.size, store.objects.size], [0, 0]);
  });
  test('SLI-1d deleting removes everything under the item, including what an abandoned or replaced upload left behind', async () => {
    const store = fakeLabStore();
    await capture(store, 'pf-appliance', ORIGINAL, PREPARED);
    store.putObject(`${USER}/${SET}/pf-appliance/abandoned-capture/original.jpg`, ORIGINAL);
    store.putObject(`${USER}/${SET}/pf-generic/orphan/original.jpg`, ORIGINAL);
    store.putObject(`someone-else/${SET}/pf-appliance/x/original.jpg`, ORIGINAL);
    await act('remove', { item_id: 'pf-appliance', what: 'photo' }, { store });
    assert.deepEqual([...store.objects.keys()].sort(), [`${USER}/${SET}/pf-generic/orphan/original.jpg`, `someone-else/${SET}/pf-appliance/x/original.jpg`].sort());
    await act('remove_set', { confirm: SET }, { store });
    assert.deepEqual([...store.objects.keys()], [`someone-else/${SET}/pf-appliance/x/original.jpg`], 'only this account, only this set');
  });
  test('SLI-1e a confirmation belongs to its photograph: a retake needs it again, and a confirmation made while the first upload is in flight counts for it', async () => {
    const store = fakeLabStore();
    await capture(store, 'pf-appliance', ORIGINAL, PREPARED);
    const confirmed = await act('truth', { item_id: 'pf-appliance', ...TRUTH }, { store });
    assert.equal(confirmed.payload.item.readiness.ready, true);
    const retake = await capture(store, 'pf-appliance', jpeg(700_000, 0x44), null);
    assert.deepEqual(retake.committed.payload.item.readiness, { ready: false, problems: ['ground truth was confirmed for a different photograph: confirm it again'] });
    assert.equal((await act('truth', { item_id: 'pf-appliance', ...TRUTH }, { store })).payload.item.readiness.ready, true);
    // First photograph of another slot: confirmed while it is still uploading.
    const begun = await act('begin', { item_id: 'pf-generic', original: describe(ORIGINAL) }, { store });
    const early = await act('truth', { item_id: 'pf-generic', identity: {}, provenance: {}, condition: 'Unknown' }, { store });
    assert.equal(early.payload.item.truth.for_capture_id, begun.payload.capture_id);
    store.putObject(begun.payload.uploads.original.path, ORIGINAL);
    assert.equal((await act('commit', { item_id: 'pf-generic', capture_id: begun.payload.capture_id }, { store })).payload.item.readiness.ready, true);
  });
  test('SLI-1f a stored object that is not what was declared is a mismatch, never a crash: a truncated header, a format given as a list', async () => {
    const store = fakeLabStore();
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.alloc(10)]);
    const begun = await act('begin', { item_id: 'pf-appliance', original: { ...describe(ORIGINAL), format: 'png' } }, { store });
    store.putObject(begun.payload.uploads.original.path, png);
    const r = await act('commit', { item_id: 'pf-appliance', capture_id: begun.payload.capture_id }, { store });
    assert.deepEqual([r.status, r.payload.error, store.rows.get(KEY).pending], [409, 'integrity_mismatch', null]);
    assert.equal((await act('begin', { item_id: 'pf-appliance', original: { ...describe(ORIGINAL), format: ['jpeg'] } }, { store })).status, 415);
  });
  test('SLI-1g the real store: a missing object is "not there", a storage fault is thrown, the conditional write names the expected capture, and a listing walks the prefix', async () => {
    const seen = [];
    let mode = 'ok';
    const fetchImpl = async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input.url);
      const method = init?.method ?? 'GET';
      seen.push({ method, path: url.pathname, query: url.search, body: typeof init?.body === 'string' ? init.body : null });
      if (url.pathname.startsWith('/storage/v1/object/list/')) {
        const prefix = JSON.parse(init.body).prefix;
        if (prefix.endsWith('/c1')) return Response.json([{ name: 'original.jpg', id: 'obj-1', metadata: {} }, { name: 'prepared.jpg', id: 'obj-2', metadata: {} }]);
        return Response.json(prefix.endsWith('pf-appliance') ? [{ name: 'c1', id: null, metadata: null }] : []);
      }
      if (url.pathname.startsWith('/storage/v1/object/')) {
        if (mode === 'missing') return Response.json({ statusCode: '404', error: 'not_found', message: 'Object not found' }, { status: 400 });
        if (mode === 'down') return Response.json({ message: 'upstream unavailable' }, { status: 503 });
        return new Response(ORIGINAL);
      }
      return Response.json(mode === 'moved' ? [] : [{ owner_id: USER, set_name: SET, item_id: 'pf-appliance', pending: null }]);
    };
    const real = createLabStore({ url: 'https://proj.supabase.co', serviceKey: SERVICE_KEY, fetchImpl });
    const path = `${USER}/${SET}/pf-appliance/c1/original.jpg`;
    assert.ok((await real.download(path)).equals(ORIGINAL));
    mode = 'missing';
    assert.equal(await real.download(path), null);
    mode = 'down';
    await assert.rejects(() => real.download(path), (e) => e instanceof LabError && e.status === 502 && e.code === 'storage_failed');
    mode = 'ok';
    assert.equal((await real.putItemIfPending(USER, SET, 'pf-appliance', 'capture-1', { pending: null })).item_id, 'pf-appliance');
    const write = seen.at(-1);
    assert.equal(write.method, 'PATCH');
    assert.match(decodeURIComponent(write.query), /pending->>capture_id=eq\.capture-1/);
    assert.match(decodeURIComponent(write.query), new RegExp(`owner_id=eq\\.${USER}`));
    mode = 'moved';
    assert.equal(await real.putItemIfPending(USER, SET, 'pf-appliance', 'capture-1', { pending: null }), null, 'no row matched: nothing was written');
    mode = 'ok';
    assert.deepEqual(await real.listPaths(`${USER}/${SET}/pf-appliance`), [`${USER}/${SET}/pf-appliance/c1/original.jpg`, `${USER}/${SET}/pf-appliance/c1/prepared.jpg`]);
  });
});

// ── SLI-2 THE PHONE ─────────────────────────────────────────────────────────
const ab = (buf) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const readDataUrl = async (blob) => `data:${blob.type};base64,${Buffer.from(await blob.arrayBuffer()).toString('base64')}`;
const photo = (fill) => prepareCapture({ bytes: ab(jpeg(300_000, fill)), readDataUrl, compress: async (d) => d });
/** A scripted server and storage; `gate` lets a test hold an upload open. */
function world({ uploads = [], commit = [] } = {}) {
  const requests = []; const uploaded = [];
  let n = 0;
  const take = (list, fallback) => { const v = list.length ? list.shift() : fallback; return typeof v === 'function' ? v() : v; };
  return {
    requests, uploaded,
    request: async (action, body) => {
      requests.push({ action, body });
      if (action === 'begin') { n += 1; return { status: 200, payload: { status: 'OK', capture_id: `capture-${n}`, bucket: 'scan-lab', uploads: { original: { path: `p/${n}/original.jpg`, token: `t${n}` }, prepared: null } } }; }
      return take(commit, { status: 200, payload: { status: 'OK', item: { item_id: body.item_id, capture: body.capture_id } } });
    },
    upload: async (args) => { const r = await take(uploads, { ok: true }); if (r.ok) uploaded.push(args); return r; },
  };
}
const queue = async (db, fill) => queueCapture({ db, userId: USER, set: LAB_SET, itemId: 'pf-appliance', capture: await photo(fill) });
const onPhone = (db) => db.get(captureKey(USER, LAB_SET, 'pf-appliance'));

suite('SLI-2 the phone\'s queue under a retake, a dead token and a closed database', () => {
  test('SLI-2a a retake while the earlier photograph is still uploading is uploaded itself: it is never answered with the old run, overwritten or deleted', async () => {
    const db = memoryLabDb();
    let release;
    const held = new Promise((r) => { release = r; });
    const w = world({ uploads: [() => held.then(() => ({ ok: true }))] });
    const a = await queue(db, 0x11);
    const runA = runCapture({ record: a, db, request: w.request, upload: w.upload });
    await new Promise((r) => setTimeout(r, 20));
    const b = await queue(db, 0x77);                       // the retake lands while A's upload is in flight
    const runB = runCapture({ record: b, db, request: w.request, upload: w.upload });
    assert.notEqual(runA, runB, 'the retake was handed the older photograph\'s run');
    release();
    const [ra, rb] = await Promise.all([runA, runB]);
    assert.deepEqual([ra.ok, ra.code], [false, LAB_FAILURE.SUPERSEDED], 'the older run must stand down, not commit over the retake');
    assert.equal(rb.ok, true);
    assert.equal(w.requests.at(-1).body.capture_id, 'capture-2');
    assert.ok(Buffer.from(w.uploaded.at(-1).bytes).equals(jpeg(300_000, 0x77)), 'the bytes that reached storage last are the retake\'s');
    assert.deepEqual([await onPhone(db), await db.get(bytesKey(USER, LAB_SET, 'pf-appliance'))], [null, null]);
  });
  test('SLI-2b a discard during a run is final: the run writes nothing more and does not bring the capture back', async () => {
    const db = memoryLabDb();
    let release;
    const held = new Promise((r) => { release = r; });
    const w = world({ uploads: [() => held.then(() => ({ ok: true }))] });
    const run = runCapture({ record: await queue(db, 0x11), db, request: w.request, upload: w.upload });
    await new Promise((r) => setTimeout(r, 20));
    await discardCapture({ db, userId: USER, set: LAB_SET, itemId: 'pf-appliance' });
    release();
    assert.equal((await run).code, LAB_FAILURE.SUPERSEDED);
    assert.equal(await onPhone(db), null);
    assert.ok(!w.requests.some((q) => q.action === 'commit'), 'a discarded capture was committed');
  });
  test('SLI-2c an upload token storage rejects is renewed with a fresh begin, and one older than its lifetime is not even tried', async () => {
    const db = memoryLabDb();
    const rejected = world({ uploads: [{ ok: false, status: 400, error: 'jwt expired' }] });
    const r = await runCapture({ record: await queue(db, 0x11), db, request: rejected.request, upload: rejected.upload });
    assert.equal(r.ok, true);
    assert.deepEqual(rejected.requests.map((q) => q.action), ['begin', 'begin', 'commit']);
    assert.equal(rejected.uploaded[0].token, 't2');
    // Begun, then the app was closed for three hours.
    const offline = world({ uploads: [{ ok: false, error: 'Load failed' }] });
    await runCapture({ record: await queue(db, 0x11), db, request: offline.request, upload: offline.upload });
    const stuck = await onPhone(db);
    assert.equal(stuck.stage, LAB_STAGE.BEGUN);
    const later = world();
    const resumed = await runCapture({ record: stuck, db, request: later.request, upload: later.upload, now: () => Date.now() + 3 * 3600 * 1000 });
    assert.equal(resumed.ok, true);
    assert.deepEqual(later.requests.map((q) => q.action), ['begin', 'commit'], 'the dead token was tried instead of renewed');
  });
  test('SLI-2d an upload that never answers is given up on, the photograph stays queued, and the next try can finish it', async () => {
    const db = memoryLabDb();
    const hung = world({ uploads: [() => new Promise(() => {})] });
    const r = await runCapture({ record: await queue(db, 0x11), db, request: hung.request, upload: hung.upload, uploadTimeoutMs: 30 });
    assert.deepEqual([r.ok, r.code, r.retryable], [false, LAB_FAILURE.UPLOAD_FAILED, true]);
    const w = world();
    assert.equal((await resumeCaptures({ db, userId: USER, set: LAB_SET, request: w.request, upload: w.upload }))[0].ok, true);
  });
  test('SLI-2e a storage fault at commit keeps what was uploaded: nothing is re-sent, the commit is simply tried again', async () => {
    const db = memoryLabDb();
    const w = world({ commit: [{ status: 502, payload: { error: 'storage_failed' } }] });
    const r = await runCapture({ record: await queue(db, 0x11), db, request: w.request, upload: w.upload });
    assert.deepEqual([r.ok, r.retryable, (await onPhone(db)).stage], [false, true, LAB_STAGE.UPLOADED]);
    assert.equal((await resumeCaptures({ db, userId: USER, set: LAB_SET, request: w.request, upload: w.upload }))[0].ok, true);
    assert.deepEqual([w.requests.map((q) => q.action), w.uploaded.length], [['begin', 'commit', 'commit'], 1]);
  });
  test('SLI-2f listing the queue reads records, never photographs, and a blank prepared copy is refused like a blank scan frame', async () => {
    const db = memoryLabDb();
    await queue(db, 0x11);
    const listed = await pendingCaptures({ db, userId: USER, set: LAB_SET });
    assert.deepEqual([listed.length, listed[0].original.bytes, Object.keys(listed[0].original).sort()], [1, undefined, ['format', 'sha256', 'size']]);
    assert.ok((await db.get(bytesKey(USER, LAB_SET, 'pf-appliance'))).original.byteLength === 300_000);
    const blank = () => prepareCapture({ bytes: ab(ORIGINAL), readDataUrl, compress: async () => `data:image/jpeg;base64,${PREPARED.toString('base64')}`, assess: async () => ({ ok: false, reason: 'black_frame' }) });
    await assert.rejects(blank, (e) => e.code === LAB_FAILURE.PREPARATION_FAILED && /black_frame/.test(e.detail));
    const unknown = await prepareCapture({ bytes: ab(ORIGINAL), readDataUrl, compress: async () => `data:image/jpeg;base64,${PREPARED.toString('base64')}`, assess: async () => null });
    assert.equal(unknown.prepared.sha256, sha(PREPARED), '"could not be inspected" is not a rejection');
  });
});

// ── SLI-3 THE DATABASE ADAPTER ──────────────────────────────────────────────
/** The slice of IndexedDB the adapter uses, with a switch that closes the connection as iOS does. */
function fakeIndexedDb() {
  const data = new Map();
  const state = { opens: 0, closed: false, reads: [] };
  const req = (result) => { const r = {}; queueMicrotask(() => { r.result = result; r.onsuccess?.(); }); return r; };
  const inRange = (range) => [...data.keys()].sort().filter((k) => !range || (k >= range.lower && k <= range.upper));
  const store = (tx) => ({
    put(value, key) { data.set(key, structuredClone(value)); return req(undefined); },
    delete(key) { data.delete(key); return req(undefined); },
    get(key) { return req(data.get(key)); },
    getAllKeys(range) { state.reads.push(range ?? 'ALL'); return req(inRange(range)); },
    getAll(range) { return req(inRange(range).map((k) => data.get(k))); },
    tx,
  });
  const live = [];
  const connection = () => {
    const c = {
      dead: false,
      objectStoreNames: { contains: () => true },
      transaction() {
        if (c.dead) throw new Error('InvalidStateError: the database connection is closing');
        const tx = {};
        setTimeout(() => tx.oncomplete?.(), 0);
        tx.objectStore = () => store(tx);
        return tx;
      },
    };
    live.push(c);
    return c;
  };
  return { state, data, open() { state.opens += 1; return req(connection()); }, closeEveryConnection() { for (const c of live) c.dead = true; } };
}

suite('SLI-3 the phone\'s database: range reads, and a connection iOS closed is reopened', () => {
  const keyRange = { bound: (lower, upper) => ({ lower, upper }) };
  test('SLI-3a a prefix listing asks for that prefix only, so the queue is read without touching stored photographs or another account', async () => {
    const idb = fakeIndexedDb();
    const db = await openLabDb(idb, keyRange);
    assert.equal(db.persistent, true);
    await db.put(`capture|${USER}|${LAB_SET}|pf-appliance`, { stage: 'queued' });
    await db.put(`bytes|${USER}|${LAB_SET}|pf-appliance`, { original: new ArrayBuffer(8) });
    await db.put(`capture|someone-else|${LAB_SET}|pf-appliance`, { stage: 'queued' });
    const found = await db.entries(`capture|${USER}|${LAB_SET}|`);
    assert.deepEqual(found.map((e) => [e.key, e.value.stage]), [[`capture|${USER}|${LAB_SET}|pf-appliance`, 'queued']]);
    assert.deepEqual(idb.state.reads, [{ lower: `capture|${USER}|${LAB_SET}|`, upper: `capture|${USER}|${LAB_SET}|￿` }]);
    assert.equal((await db.get(`bytes|${USER}|${LAB_SET}|pf-appliance`)).original.byteLength, 8);
    await db.delete(`capture|${USER}|${LAB_SET}|pf-appliance`);
    assert.equal(await db.get(`capture|${USER}|${LAB_SET}|pf-appliance`), null);
  });
  test('SLI-3b after the connection is closed under it, the next read or write reconnects once and succeeds', async () => {
    const idb = fakeIndexedDb();
    const db = await openLabDb(idb, keyRange);
    await db.put('capture|a', { n: 1 });
    assert.equal(idb.state.opens, 1);
    // What a backgrounded PWA comes back to: the handle it holds is dead.
    idb.closeEveryConnection();
    assert.deepEqual(await db.get('capture|a'), { n: 1 });
    assert.equal(idb.state.opens, 2, 'the adapter did not reconnect');
    idb.closeEveryConnection();
    await db.put('capture|b', { n: 2 });
    idb.closeEveryConnection();
    assert.deepEqual((await db.entries('capture|')).map((e) => e.key), ['capture|a', 'capture|b']);
    assert.equal(idb.state.opens, 4);
  });
});

// ── SLI-4 THE PROBE ─────────────────────────────────────────────────────────
suite('SLI-4 only a clear answer about availability is remembered', () => {
  test('SLI-4a the code remembers a yes and a 403, and asks again after a timeout, a lost session or a server fault', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../src/lib/scanLab.js', import.meta.url), 'utf8');
    assert.match(src, /if \(ok \|\| status === 403\) availability\.set\(userId, ok\);/);
    assert.match(src, /\} catch \{ return false; \}/, 'a failed probe must not be cached as "no"');
    assert.ok(!/availability\.set\(userId, false\)/.test(src));
    assert.equal(await isScanLabAvailable({ userId: USER, getToken: async () => 'tok' }), false, 'and a build without the flag still never asks');
  });
});

// ── SLI-5 THE CONFIGURATION CHECK ───────────────────────────────────────────
suite('SLI-5 the configuration check says whether the lab would run, in shapes and never in values', () => {
  test('SLI-5a present and suitable, absent, an anon key in the service slot, a service key under another name, an empty allowlist', async (t) => {
    const { existsSync, readFileSync } = await import('node:fs');
    const path = new URL('../scripts/scan-lab-config-check.mjs', import.meta.url);
    if (!existsSync(path)) return t.skip('the configuration check is not in this tree (harness mirror)');
    const { checkLabConfig } = await import(path.href);
    const { ANON_KEY } = await import('./helpers/scan-lab-fakes.mjs');
    const base = { SCAN_LAB_ENABLED: 'true', SCAN_LAB_USER_IDS: USER, SUPABASE_URL: 'https://proj-ref-123.supabase.co', SUPABASE_ANON_KEY: ANON_KEY, VITE_SCAN_LAB_ENABLED: 'true' };
    const good = checkLabConfig({ ...base, SUPABASE_SERVICE_KEY: SERVICE_KEY });
    assert.equal(good.ok, true);
    assert.match(good.lines.join('\n'), /SUPABASE_SERVICE_KEY shape: +service-role/);
    const cases = [
      [{ ...base }, /SUPABASE_SERVICE_KEY shape: +absent/],
      [{ ...base, SUPABASE_SERVICE_KEY: ANON_KEY.replace('c2lnbmF0dXJl', 'b3RoZXI') }, /SUPABASE_SERVICE_KEY shape: +anon/],
      [{ ...base, SUPABASE_SERVICE_KEY: ANON_KEY }, /accepted by Scan Lab: +NO/],
      [{ ...base, SUPABASE_KEY: SERVICE_KEY }, /does not fall back: add it under SUPABASE_SERVICE_KEY/],
      [{ ...base, SUPABASE_SERVICE_KEY: SERVICE_KEY, SCAN_LAB_USER_IDS: '' }, /0 id\(s\), all UUID-shaped: NO/],
      [{ ...base, SUPABASE_SERVICE_KEY: SERVICE_KEY, SCAN_LAB_ENABLED: '1' }, /is exactly 'true': +NO/],
    ];
    for (const [env, says] of cases) {
      const r = checkLabConfig(env);
      assert.equal(r.ok, false, String(says));
      assert.match(r.lines.join('\n'), says);
    }
    // Whatever it is given, it gives none of it back.
    for (const [env] of [[{ ...base, SUPABASE_SERVICE_KEY: SERVICE_KEY, SUPABASE_KEY: 'sb_secret_abcdefghijklmnopqrstuv' }], ...cases]) {
      const out = checkLabConfig(env).lines.join('\n');
      for (const secret of [SERVICE_KEY, ANON_KEY, SERVICE_KEY.split('.')[2], SERVICE_KEY.slice(0, 16), 'abcdefghijklmnop', USER, 'proj-ref-123']) assert.ok(!out.includes(secret), 'the check printed part of a value');
    }
    const src = readFileSync(path, 'utf8');
    assert.ok(!/fetch\(|writeFile|appendFile|console\.(log|error)/.test(src), 'the check reaches out, writes a file or logs');
  });
});
