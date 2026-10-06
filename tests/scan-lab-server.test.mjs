// ══════════════════════════════════════════════════════════════════════════════
// SCAN LAB — /api/scan-lab: THE GATE, THE CAPTURE, THE TRUTH, THE ISOLATION
//
// The properties that make a private capture surface safe to ship inside the
// public PWA:
//
//   - off by default, and closed to every account not named on the server;
//   - a refused request touches no storage and learns nothing;
//   - the owner of every read and write is the verified session, never a field;
//   - only bytes the SERVER hashed become a record, original and derivative apart;
//   - human ground truth needs a provenance, and reaches no recognition path;
//   - capture makes no paid call, and nothing here can start a benchmark.
//
// The handler is driven through its real export with the store replaced and
// `globalThis.fetch` trapped. No test here spends a credit or reaches a network.
//
//   node --test tests/scan-lab-server.test.mjs
// ══════════════════════════════════════════════════════════════════════════════
import { test, describe as suite } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve as resolvePath, dirname, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fakeLabStore, jpeg, describe, sha, SERVICE_KEY, ANON_KEY, USER, OTHER, SET, ON, call, act, capture } from './helpers/scan-lab-fakes.mjs';
import { LAB_ACTIONS, config as fnConfig } from '../api/scan-lab.js';
import { resolveLabMode, isLabPermitted, isServiceRoleKey, LAB_MODE, LAB_MAX_ORIGINAL_BYTES } from '../api/_lib/scan-lab/config.js';
import { LAB_SETS } from '../api/_lib/scan-lab/sets.js';
import * as labTruth from '../api/_lib/scan-lab/truth.js';
import { RUN_FIELDS } from '../api/_lib/scan-lab/service.js';
import { createLabStore } from '../api/_lib/scan-lab/store.js';
import { createServer } from 'node:http';
import { mintJWT } from './helpers/analyze-harness.mjs';
import labEndpoint from '../api/scan-lab.js';

const REPO = fileURLToPath(new URL('../', import.meta.url)).replace(/[\\/]$/, '');
const TRUTH = {
  identity: { brand: 'Ninja', exact_model: 'Foodi Power Blender', model_number: '', variant: null, configuration: 'COMPLETE' },
  provenance: { brand: ['PHYSICAL_LABEL'], exact_model: ['PACKAGING', 'OWNER_KNOWLEDGE'], configuration: ['OWNER_KNOWLEDGE'] },
  condition: 'Good', condition_notes: 'light scuffs', notes: null,
};
const ORIGINAL = jpeg(900_000, 0x11);
const PREPARED = jpeg(180_000, 0x22, 1280, 960);

// ── SL-1 THE GATE ───────────────────────────────────────────────────────────
suite('SL-1 authorization is enforced by the server on every action', () => {
  const EVERY = LAB_ACTIONS.map((action) => ({ action, set: SET, item_id: 'pf-appliance', capture_id: USER, kind: 'original', what: 'item', confirm: SET, original: describe(ORIGINAL), ...TRUTH }));

  test('SL-1a no session is 401 before anything else, for every action', async () => {
    for (const body of EVERY) {
      const r = await call(body, { headers: { authorization: '' } });
      assert.equal(r.status, 401, body.action);
      assert.deepEqual([r.built, r.store.calls.length, r.outbound.length], [0, 0, 0], body.action);
    }
    assert.equal((await call(EVERY[1], { headers: { authorization: 'Bearer not.a.jwt' } })).status, 401);
  });
  test('SL-1b the lab is OFF by default, and only the exact word turns it on', async () => {
    for (const v of [undefined, '', 'false', '0', '1', 'yes', 'on', 'enabled', 'true!']) {
      assert.equal(resolveLabMode({ ...ON, SCAN_LAB_ENABLED: v, SUPABASE_URL: 'https://fake.supabase.co' }), LAB_MODE.DISABLED_FLAG, String(v));
      const r = await act('state', {}, { env: { ...ON, SCAN_LAB_ENABLED: v } });
      assert.deepEqual([r.status, r.payload, r.built], [403, { lab: 'scan-lab', status: 'DISABLED' }, 0], String(v));
    }
  });
  test('SL-1c an empty allowlist admits nobody, in production, in preview and locally', async () => {
    for (const VERCEL_ENV of ['production', 'preview', 'development', undefined]) {
      for (const list of [undefined, '', ' , ']) {
        assert.equal(isLabPermitted(USER, { SCAN_LAB_USER_IDS: list, VERCEL_ENV }), false);
        const r = await act('state', {}, { env: { ...ON, SCAN_LAB_USER_IDS: list, VERCEL_ENV } });
        assert.deepEqual([r.status, r.built], [403, 0], `${VERCEL_ENV}/${list}`);
      }
    }
    assert.equal(isLabPermitted(null, { SCAN_LAB_USER_IDS: USER }), false);
    assert.equal(isLabPermitted(USER, { SCAN_LAB_USER_IDS: ` ${OTHER} , ${USER}` }), true);
  });
  test('SL-1d a normal signed-in user is refused every action, touches no storage, and cannot tell "off" from "not you"', async () => {
    for (const body of EVERY) {
      const notListed = await call(body, { user: OTHER });
      const off = await call(body, { user: OTHER, env: {} });
      assert.equal(notListed.status, 403, body.action);
      assert.equal(notListed.text, off.text, `${body.action}: the refusal says whether the lab is on`);
      assert.deepEqual(notListed.payload, { lab: 'scan-lab', status: 'DISABLED' });
      assert.deepEqual([notListed.built, notListed.store.calls.length, notListed.outbound.length], [0, 0, 0], body.action);
    }
  });
  test('SL-1e no request field or header turns the lab on or enrols an account', async () => {
    const forged = { action: 'state', set: SET, SCAN_LAB_ENABLED: 'true', SCAN_LAB_USER_IDS: OTHER, enabled: true, allowlist: [OTHER], owner_id: USER, ownerId: USER, role: 'service_role' };
    for (const env of [{}, ON]) {
      const r = await call(forged, { user: OTHER, env, headers: { 'x-scan-lab-enabled': 'true', 'x-user-id': USER } });
      assert.deepEqual([r.status, r.store.calls.length], [403, 0]);
    }
  });
  test('SL-1f an enrolled account with no service-role key is told storage is not configured; the anon key is not a substitute', async () => {
    const anonRoleJwt = ANON_KEY.replace('c2lnbmF0dXJl', 'b3RoZXI');
    for (const key of [undefined, '', ANON_KEY, anonRoleJwt, 'short', 'plainly-not-a-key-of-any-kind-at-all']) {
      const r = await act('state', {}, { env: { ...ON, SUPABASE_SERVICE_KEY: key } });
      assert.deepEqual([r.status, r.payload.status, r.payload.reason, r.built], [200, 'UNAVAILABLE', 'storage_not_configured', 0], String(key).slice(0, 12));
    }
    assert.equal(isServiceRoleKey(SERVICE_KEY, {}), true);
    assert.equal(isServiceRoleKey('sb_secret_0123456789abcdefghij', {}), true);
    assert.equal(isServiceRoleKey(SERVICE_KEY, { SUPABASE_ANON_KEY: SERVICE_KEY }), false, 'a key that is also the configured anon key is not a service key');
    // No fallback: a service-role key that sits under ANOTHER variable name does not open the lab.
    const elsewhere = await act('state', {}, { env: { ...ON, SUPABASE_SERVICE_KEY: undefined, SUPABASE_KEY: SERVICE_KEY } });
    assert.deepEqual([elsewhere.payload.status, elsewhere.built], ['UNAVAILABLE', 0]);
    assert.equal(resolveLabMode({ ...ON, SUPABASE_URL: 'http://insecure.example' }), LAB_MODE.DISABLED_NO_STORAGE);
    // And an account that is NOT enrolled is not told even that.
    assert.equal((await act('state', {}, { user: OTHER, env: { ...ON, SUPABASE_SERVICE_KEY: undefined } })).status, 403);
  });
  test('SL-1g GET is 405, malformed JSON 400, an oversized body 413, an unknown action 400', async () => {
    assert.equal((await call(null, { method: 'GET' })).status, 405);
    assert.equal((await call(null, { raw: '{not json' })).status, 400);
    assert.equal((await call(null, { raw: JSON.stringify({ action: 'state', set: SET, pad: 'x'.repeat(70_000) }) })).status, 413);
    for (const action of ['run', 'execute', 'benchmark', 'identify', 'price', 'constructor', '__proto__', undefined]) {
      const r = await call({ action, set: SET });
      assert.deepEqual([r.status, r.payload.error, r.built], [400, 'bad_request', 0], String(action));
    }
    assert.equal((await act('state', {}, { env: ON })).cache, 'no-store');
    assert.equal((await act('state')).acao, null, 'no cross-origin reader is admitted');
  });
  test('SL-1h the owner is the session subject: a body naming another account is ignored, and every path sits under the caller', async () => {
    const store = fakeLabStore();
    const begun = await act('begin', { item_id: 'pf-appliance', owner_id: OTHER, ownerId: OTHER, original: describe(ORIGINAL), prepared: describe(PREPARED) }, { store });
    assert.equal(begun.status, 200);
    assert.deepEqual(store.owners(), [USER]);
    for (const part of ['original', 'prepared']) assert.ok(begun.payload.uploads[part].path.startsWith(`${USER}/${SET}/pf-appliance/`), part);
    assert.ok(![...store.rows.keys()].some((k) => k.startsWith(OTHER)));
  });
  test('SL-1j over real HTTP, as Vercel calls it (req, res): an authenticated account that is not enrolled gets 403 on every action; no session 401; GET 405', async () => {
    const saved = {};
    const env = { ...ON, SUPABASE_JWT_SECRET: 'test-secret', SUPABASE_URL: 'https://fake.supabase.co', SUPABASE_ANON_KEY: ANON_KEY, VERCEL_ENV: 'production' };
    for (const [k, v] of Object.entries(env)) { saved[k] = process.env[k]; process.env[k] = v; }
    const quiet = { log: console.log, warn: console.warn };
    console.log = () => {}; console.warn = () => {};
    const outbound = [];
    const realFetch = globalThis.fetch;
    const server = createServer((req, res) => labEndpoint(req, res));
    const port = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
    const post = async (body, token, method = 'POST') => {
      const r = await realFetch(`http://127.0.0.1:${port}/api/scan-lab`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: method === 'POST' ? JSON.stringify(body) : undefined });
      return { status: r.status, text: await r.text(), cache: r.headers.get('cache-control') };
    };
    // Any outbound request the handler itself makes is recorded: a refusal must make none.
    globalThis.fetch = async (url) => { outbound.push(String(url)); throw new Error('network call attempted'); };
    try {
      for (const action of LAB_ACTIONS) {
        const r = await post({ action, set: SET, item_id: 'pf-appliance', capture_id: USER, confirm: SET, what: 'item', original: describe(ORIGINAL), ...TRUTH }, mintJWT(OTHER));
        assert.deepEqual([r.status, r.text, r.cache], [403, '{"lab":"scan-lab","status":"DISABLED"}', 'no-store'], action);
      }
      assert.equal((await post({ action: 'state', set: SET })).status, 401);
      assert.equal((await post(null, mintJWT(USER), 'GET')).status, 405);
      // The enrolled account passes the gate; a probe touches no storage.
      const probe = await post({ action: 'probe' }, mintJWT(USER));
      assert.deepEqual([probe.status, JSON.parse(probe.text).status], [200, 'READY']);
      assert.deepEqual(outbound, [], 'a refused or probing request reached out');
      // A token the verifier cannot check locally is put to the project's own auth, and to nothing else.
      assert.equal((await post({ action: 'state', set: SET }, 'not.a.session')).status, 401);
      assert.deepEqual(outbound, ['https://fake.supabase.co/auth/v1/user']);
    } finally {
      globalThis.fetch = realFetch;
      Object.assign(console, quiet);
      await new Promise((r) => server.close(r));
      for (const k of Object.keys(env)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    }
  });
  test('SL-1i two enrolled accounts never see or touch each other\'s photographs or truth', async () => {
    const store = fakeLabStore();
    const both = { ...ON, SCAN_LAB_USER_IDS: `${USER},${OTHER}` };
    await capture(store, 'pf-appliance', ORIGINAL, PREPARED, { env: both });
    await act('truth', { item_id: 'pf-appliance', ...TRUTH }, { store, env: both });
    const theirs = await act('state', {}, { store, env: both, user: OTHER });
    assert.ok(theirs.payload.items.every((i) => i.photo === null && i.truth === null));
    assert.equal((await act('photo_url', { item_id: 'pf-appliance' }, { store, env: both, user: OTHER })).status, 404);
    await act('remove_set', { confirm: SET }, { store, env: both, user: OTHER });
    const mine = await act('state', {}, { store, env: both });
    assert.equal(mine.payload.items[0].readiness.ready, true, 'the other account deleted nothing of mine');
    assert.equal(store.objects.size, 2);
  });
});

// ── SL-2 CAPTURE ────────────────────────────────────────────────────────────
suite('SL-2 only bytes the server hashed become a record; the original and the derivative stay apart', () => {
  test('SL-2a begin signs two different one-object tokens and stores nothing but an expectation', async () => {
    const store = fakeLabStore();
    const r = await act('begin', { item_id: 'pf-appliance', original: describe(ORIGINAL), prepared: describe(PREPARED) }, { store });
    const { original, prepared } = r.payload.uploads;
    assert.match(original.path, new RegExp(`^${USER}/${SET}/pf-appliance/${r.payload.capture_id}/original\\.jpg$`));
    assert.match(prepared.path, /\/prepared\.jpg$/);
    assert.notEqual(original.path, prepared.path);
    assert.notEqual(original.token, prepared.token);
    assert.equal(r.payload.bucket, 'scan-lab');
    assert.equal(store.objects.size, 0, 'no photograph passed through the function');
    const state = await act('state', {}, { store });
    assert.deepEqual([state.payload.items[0].photo, state.payload.items[0].upload_pending, state.payload.items[0].readiness.problems[0]], [null, true, 'upload not finished']);
  });
  test('SL-2b commit records what the SERVER read back: hash, format, bytes and pixels of each, separately', async () => {
    const store = fakeLabStore();
    const { committed } = await capture(store, 'pf-appliance', ORIGINAL, PREPARED);
    assert.equal(committed.status, 200, committed.text);
    const { master, prepared } = committed.payload.item.photo;
    assert.deepEqual([master.sha256, master.format, master.bytes, master.width, master.height], [sha(ORIGINAL), 'jpeg', ORIGINAL.length, 4032, 3024]);
    assert.deepEqual([prepared.sha256, prepared.bytes, prepared.width, prepared.height], [sha(PREPARED), PREPARED.length, 1280, 960]);
    assert.ok(Date.parse(master.stored_at) > 0);
    const row = store.rows.get(`${USER}|${SET}|pf-appliance`);
    assert.equal(row.pending, null);
    assert.notEqual(row.photo.master.path, row.photo.prepared.path);
    assert.ok(store.objects.get(row.photo.master.path).equals(ORIGINAL), 'the original is stored byte for byte');
    assert.match(row.photo.prepared.method, /1280 px, JPEG 0\.82/);
    assert.ok(store.calls.filter((c) => c.method === 'download').length === 2, 'both objects were read back');
  });
  test('SL-2c an interrupted upload is not a record: commit says what is missing and the capture stays resumable', async () => {
    const store = fakeLabStore();
    const begun = await act('begin', { item_id: 'pf-generic', original: describe(ORIGINAL), prepared: describe(PREPARED) }, { store });
    const none = await act('commit', { item_id: 'pf-generic', capture_id: begun.payload.capture_id }, { store });
    assert.deepEqual([none.status, none.payload.error, none.payload.detail], [409, 'upload_missing', 'original']);
    store.putObject(begun.payload.uploads.original.path, ORIGINAL);
    const half = await act('commit', { item_id: 'pf-generic', capture_id: begun.payload.capture_id }, { store });
    assert.deepEqual([half.status, half.payload.detail], [409, 'prepared']);
    assert.equal((await act('state', {}, { store })).payload.items[3].photo, null);
    store.putObject(begun.payload.uploads.prepared.path, PREPARED);
    assert.equal((await act('commit', { item_id: 'pf-generic', capture_id: begun.payload.capture_id }, { store })).status, 200);
  });
  test('SL-2d one changed byte, a swapped file or a wrong size is an integrity mismatch: removed, never recorded, and the earlier photograph survives', async () => {
    const store = fakeLabStore();
    await capture(store, 'pf-appliance', ORIGINAL, PREPARED);
    const next = jpeg(900_000, 0x33);
    const flipped = Buffer.from(next); flipped[flipped.length - 1] ^= 0x01;
    const cases = [
      { storedOriginal: flipped }, { storedOriginal: jpeg(900_001, 0x33) }, { storedPrepared: next.subarray(0, PREPARED.length) },
      { storedOriginal: Buffer.concat([Buffer.from('%PDF-1.7'), Buffer.alloc(next.length - 8, 1)]) },
    ];
    for (const stored of cases) {
      const { begun, committed } = await capture(store, 'pf-appliance', next, PREPARED, stored);
      assert.deepEqual([committed.status, committed.payload.error], [409, 'integrity_mismatch'], JSON.stringify(Object.keys(stored)));
      assert.ok(!store.objects.has(begun.payload.uploads.original.path) && !store.objects.has(begun.payload.uploads.prepared.path), 'the mismatching objects were removed');
      const row = store.rows.get(`${USER}|${SET}|pf-appliance`);
      assert.deepEqual([row.pending, row.photo.master.sha256], [null, sha(ORIGINAL)]);
      assert.ok(store.objects.get(row.photo.master.path).equals(ORIGINAL));
    }
  });
  test('SL-2e what is not a storable photograph is refused at begin: the derivative as the original, a non-JPEG derivative, HEIC, too large, too small, a bad hash', async () => {
    const o = describe(ORIGINAL);
    const cases = [
      [{ original: o, prepared: o }, 400], [{ original: o, prepared: { ...describe(PREPARED), format: 'png' } }, 415],
      [{ original: { ...o, format: 'heic' } }, 415], [{ original: { ...o, format: 'constructor' } }, 415],
      [{ original: { ...o, bytes: LAB_MAX_ORIGINAL_BYTES + 1 } }, 413], [{ original: { ...o, bytes: 100 } }, 400],
      [{ original: { ...o, sha256: 'abc' } }, 400], [{ original: null }, 400], [{ original: { ...o, bytes: '900000' } }, 400],
    ];
    for (const [body, status] of cases) {
      const r = await act('begin', { item_id: 'pf-appliance', ...body });
      assert.equal(r.status, status, JSON.stringify(body).slice(0, 80));
      assert.equal(r.store.calls.filter((c) => c.method === 'signUpload').length, 0, 'no token for a refused declaration');
    }
    for (const where of [{ set: 'benchmark-44' }, { set: 'constructor' }, { item_id: 'appl-ninja-tb301' }, { item_id: '../x' }]) {
      assert.equal((await call({ action: 'begin', set: SET, item_id: 'pf-appliance', original: o, ...where })).status, 400, JSON.stringify(where));
    }
  });
  test('SL-2f a retake never overwrites: new capture, new paths, and the old objects go only after the new record stands', async () => {
    const store = fakeLabStore();
    const first = await capture(store, 'pf-consumer', ORIGINAL, PREPARED);
    const second = await capture(store, 'pf-consumer', jpeg(700_000, 0x44), jpeg(150_000, 0x55, 1280, 960));
    assert.notEqual(first.begun.payload.capture_id, second.begun.payload.capture_id);
    assert.notEqual(first.begun.payload.uploads.original.path, second.begun.payload.uploads.original.path);
    assert.equal(second.committed.payload.item.photo.master.sha256, sha(jpeg(700_000, 0x44)));
    assert.deepEqual([...store.objects.keys()].sort(), [second.begun.payload.uploads.original.path, second.begun.payload.uploads.prepared.path].sort());
    // An abandoned begin is cleaned by the next one, and a stale capture id commits nothing.
    const abandoned = await act('begin', { item_id: 'pf-consumer', original: describe(ORIGINAL) }, { store });
    store.putObject(abandoned.payload.uploads.original.path, ORIGINAL);
    await act('begin', { item_id: 'pf-consumer', original: describe(ORIGINAL) }, { store });
    assert.ok(!store.objects.has(abandoned.payload.uploads.original.path));
    const stale = await act('commit', { item_id: 'pf-consumer', capture_id: abandoned.payload.capture_id }, { store });
    assert.deepEqual([stale.status, stale.payload.error], [409, 'no_pending_capture']);
    assert.equal((await act('commit', { item_id: 'pf-consumer', capture_id: 'not-a-uuid' }, { store })).status, 400);
  });
  test('SL-2g a small original has no derivative, exactly as a scan would send it as it is', async () => {
    const store = fakeLabStore();
    const small = jpeg(90_000, 0x66, 800, 600);
    const { committed } = await capture(store, 'pf-generic', small, null);
    assert.deepEqual([committed.payload.item.photo.master.sha256, committed.payload.item.photo.prepared], [sha(small), null]);
    assert.equal(store.objects.size, 1);
  });
  test('SL-2h cleanup never reaches outside the caller\'s own prefix, even if a record were to name another path', async () => {
    const store = fakeLabStore();
    store.putObject(`${OTHER}/${SET}/pf-appliance/x/original.jpg`, ORIGINAL);
    store.rows.set(`${USER}|${SET}|pf-appliance`, { owner_id: USER, set_name: SET, item_id: 'pf-appliance', photo: { capture_id: 'x', master: { path: `${OTHER}/${SET}/pf-appliance/x/original.jpg`, sha256: sha(ORIGINAL), format: 'jpeg', bytes: ORIGINAL.length, stored_at: new Date().toISOString() }, prepared: null }, pending: { capture_id: 'y', original: { path: `${OTHER}/${SET}/pf-appliance/x/original.jpg` }, prepared: null }, truth: null, confirmed_at: null });
    assert.equal((await act('photo_url', { item_id: 'pf-appliance' }, { store })).status, 404, 'no link is signed for a path outside the caller');
    await act('begin', { item_id: 'pf-appliance', original: describe(ORIGINAL) }, { store });
    await act('remove', { item_id: 'pf-appliance', what: 'item' }, { store });
    assert.ok(store.objects.has(`${OTHER}/${SET}/pf-appliance/x/original.jpg`), 'another account\'s object was removed');
  });
});

// ── SL-3 GROUND TRUTH ───────────────────────────────────────────────────────
suite('SL-3 human ground truth: a provenance for every value, UNKNOWN always allowed, nothing inferred', () => {
  test('SL-3a the vocabulary and the header reader are the capture helper\'s, unchanged', async (t) => {
    // The helper and the benchmark fixtures live with the benchmark, not in a release cut from Production.
    if (!existsSync(join(REPO, 'scripts/dev/benchmark-capture.mjs'))) return t.skip('the capture helper is not on this branch');
    const helper = await import('../scripts/dev/benchmark-capture.mjs');
    for (const k of ['PROVENANCE', 'CONDITIONS', 'CONFIGURATIONS', 'TRUTH_FIELDS']) assert.deepEqual([...labTruth[k]], [...helper[k]], k);
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 200, 0, 0, 0, 100]), Buffer.alloc(16)]);
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8X'), Buffer.alloc(4), Buffer.alloc(4), Buffer.from([0xFF, 0x01, 0x00, 0x7F, 0x00, 0x00]), Buffer.alloc(4)]);
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]), Buffer.alloc(64, 1)]);
    for (const buf of [ORIGINAL, PREPARED, png, webp, heic, Buffer.from('not an image at all, truly')]) assert.deepEqual(labTruth.imageInfo(buf), helper.imageInfo(buf));
    assert.equal(labTruth.imageInfo(heic), null);
  });
  test('SL-3b a value without a provenance is refused; an invented provenance does not count; lists are closed; a condition must be chosen', async () => {
    const bad = [
      { ...TRUTH, provenance: {} }, { ...TRUTH, provenance: { ...TRUTH.provenance, brand: ['GUESSED', 'AI_RECOGNITION'] } },
      { ...TRUTH, identity: { ...TRUTH.identity, configuration: 'MINT_IN_BOX' } }, { ...TRUTH, condition: 'Mint' },
      { ...TRUTH, condition: null }, { ...TRUTH, condition: undefined }, { ...TRUTH, identity: { brand: 42 }, provenance: { brand: ['OTHER'] } },
      { ...TRUTH, notes: 'x'.repeat(1001) },
    ];
    for (const body of bad) {
      const r = await act('truth', { item_id: 'pf-appliance', ...body });
      assert.equal(r.status, 400, JSON.stringify(body).slice(0, 90));
      assert.equal(r.store.calls.filter((c) => c.method === 'putItem').length, 0);
    }
  });
  test('SL-3c UNKNOWN is a complete answer: every field null, no provenance needed, condition Unknown', async () => {
    const store = fakeLabStore();
    const r = await act('truth', { item_id: 'pf-generic', identity: { brand: '', exact_model: null }, provenance: {}, condition: 'Unknown' }, { store });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.payload.item.truth.identity, { brand: null, product_family: null, exact_model: null, model_number: null, variant: null, capacity_size: null, color: null, configuration: null });
    assert.deepEqual([r.payload.item.truth.provenance, r.payload.item.truth.condition], [{}, 'Unknown']);
  });
  test('SL-3d a confirmation is stored as given, and an item is ready only with a verified photograph AND a confirmation', async () => {
    const store = fakeLabStore();
    const saved = await act('truth', { item_id: 'pf-appliance', ...TRUTH }, { store });
    assert.deepEqual(saved.payload.item.truth.identity, { brand: 'Ninja', product_family: null, exact_model: 'Foodi Power Blender', model_number: null, variant: null, capacity_size: null, color: null, configuration: 'COMPLETE' });
    assert.deepEqual(saved.payload.item.truth.provenance, TRUTH.provenance);
    assert.deepEqual([saved.payload.item.readiness.ready, saved.payload.item.readiness.problems], [false, ['photograph missing']]);
    await capture(store, 'pf-appliance', ORIGINAL, PREPARED);
    // Confirmed before any photograph existed: that confirmation is not of this photograph.
    assert.deepEqual((await act('state', {}, { store })).payload.items[0].readiness.problems, ['ground truth was confirmed for a different photograph: confirm it again']);
    await act('truth', { item_id: 'pf-appliance', ...TRUTH }, { store });
    const state = await act('state', {}, { store });
    assert.deepEqual([state.payload.items[0].readiness.ready, state.payload.readiness], [true, { ready: false, ready_items: 1, items_total: 5 }]);
    await capture(store, 'pf-generic', ORIGINAL, PREPARED);
    assert.deepEqual((await act('state', {}, { store })).payload.items[3].readiness.problems, ['ground truth not confirmed by a person']);
  });
  test('SL-3e the preflight slots mirror the committed preflight set, prescribe no product, and are not benchmark items', (t) => {
    const set0 = LAB_SETS[SET];
    assert.deepEqual([Object.keys(LAB_SETS), set0.excluded_from_benchmark, set0.slots.length, set0.slots.every((s) => s.id.startsWith('pf-'))], [[SET], true, 5, true]);
    assert.ok(set0.slots.every((s) => !/[A-Z][a-z]+ [A-Z0-9]/.test(s.hint.replace(/^[A-Z]/, '')) && s.hint.startsWith('a') ), 'a slot names a kind of object, never a product');
    if (!existsSync(join(REPO, 'tests/fixtures/scan-v2/preflight-5.json'))) return t.skip('the benchmark fixtures are not on this branch');
    const pf = JSON.parse(readFileSync(join(REPO, 'tests/fixtures/scan-v2/preflight-5.json'), 'utf8'));
    const set = LAB_SETS[SET];
    assert.deepEqual(set.slots.map((s) => [s.id, s.cohort, s.hint]), pf.items.map((i) => [i.benchmark_id, i.cohort, i.photo.photo_notes]));
    assert.deepEqual([set.excluded_from_benchmark, set.natural_photo_rule], [true, pf.natural_photo_rule]);
    assert.ok(pf.items.every((i) => i.excluded_from_benchmark === true));
    const b44 = JSON.parse(readFileSync(join(REPO, 'tests/fixtures/scan-v2/benchmark-44.json'), 'utf8'));
    const benchmarkIds = new Set(b44.items.map((i) => i.benchmark_id));
    assert.ok(set.slots.every((s) => !benchmarkIds.has(s.id) && s.id.startsWith('pf-')));
    assert.deepEqual(Object.keys(LAB_SETS), [SET], 'the 44-item benchmark is not a lab set until it is deliberately added');
  });
});

// ── SL-4 LINKS AND DELETION ─────────────────────────────────────────────────
suite('SL-4 no public photograph URL, and deletion is explicit', () => {
  test('SL-4a a stored photograph is opened only through a link the server signs for 60 seconds, and state exposes no storage path', async () => {
    const store = fakeLabStore();
    await capture(store, 'pf-appliance', ORIGINAL, PREPARED);
    const o = await act('photo_url', { item_id: 'pf-appliance' }, { store });
    const p = await act('photo_url', { item_id: 'pf-appliance', kind: 'prepared' }, { store });
    assert.deepEqual([o.payload.expires_in_s, o.payload.kind, p.payload.kind], [60, 'original', 'prepared']);
    assert.match(o.payload.url, /\/object\/sign\/scan-lab\/.+original\.jpg\?token=/);
    assert.ok(!o.payload.url.includes('/object/public/'));
    assert.deepEqual(store.calls.filter((c) => c.method === 'signDownload').map((c) => c.args[1]), [60, 60]);
    assert.equal((await act('photo_url', { item_id: 'pf-appliance', kind: 'thumbnail' }, { store })).status, 400);
    assert.equal((await act('photo_url', { item_id: 'pf-generic' }, { store })).status, 404);
    const state = await act('state', {}, { store });
    assert.ok(!state.text.includes(`${USER}/${SET}`) && !/"path"/.test(state.text), 'state carries a storage path');
  });
  test('SL-4b delete the photograph, the confirmation, the item or the whole set; the set only when its name is repeated', async () => {
    const store = fakeLabStore();
    await capture(store, 'pf-appliance', ORIGINAL, PREPARED);
    await act('truth', { item_id: 'pf-appliance', ...TRUTH }, { store });
    await capture(store, 'pf-generic', ORIGINAL, null);
    const noPhoto = await act('remove', { item_id: 'pf-appliance', what: 'photo' }, { store });
    assert.deepEqual([noPhoto.payload.item.photo, noPhoto.payload.item.truth.identity.brand, store.objects.size], [null, 'Ninja', 1]);
    const noTruth = await act('remove', { item_id: 'pf-appliance', what: 'truth' }, { store });
    assert.deepEqual([noTruth.payload.item.truth, noTruth.payload.item.confirmed_at], [null, null]);
    assert.equal((await act('remove', { item_id: 'pf-appliance', what: 'everything' }, { store })).status, 400);
    for (const confirm of [undefined, '', 'yes', 'PREFLIGHT-5']) {
      assert.equal((await act('remove_set', { confirm }, { store })).status, 400, String(confirm));
      assert.equal(store.objects.size, 1, 'nothing was deleted without the confirmation');
    }
    const all = await act('remove_set', { confirm: SET }, { store });
    assert.deepEqual([all.status, store.objects.size, store.rows.size], [200, 0, 0]);
  });
});

// ── SL-5 ISOLATION ──────────────────────────────────────────────────────────
suite('SL-5 capture makes no paid call, cannot start a benchmark, and the engine cannot read the truth', () => {
  const RE = /(?:^|[^\w$])(?:import|export)[\s\S]{0,400}?from\s*['"]([^'"\n]*)['"]/g;
  const code = (f) => readFileSync(resolvePath(REPO, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  const LAB = ['api/scan-lab.js', ...readdirSync(resolvePath(REPO, 'api/_lib/scan-lab')).map((f) => `api/_lib/scan-lab/${f}`)];
  const closure = (entry) => {
    const seen = new Set(); const out = []; const queue = [resolvePath(REPO, entry)];
    while (queue.length) {
      const file = queue.shift();
      if (seen.has(file) || !existsSync(file)) continue;
      seen.add(file);
      out.push(relative(REPO, file).split('\\').join('/'));
      for (const m of readFileSync(file, 'utf8').matchAll(RE)) if (m[1].startsWith('.')) for (const cand of [m[1], `${m[1]}.js`, `${m[1]}.mjs`]) { const abs = resolvePath(dirname(file), cand); if (existsSync(abs)) { queue.push(abs); break; } }
    }
    return out;
  };

  test('SL-5a a whole capture — state, begin, upload, commit, truth, link, delete — makes zero outbound requests of its own', async () => {
    const store = fakeLabStore();
    const env = { ...ON, OPENAI_API_KEY: 'sk-test-not-a-real-key-000000', ANTHROPIC_API_KEY: 'sk-ant-test' };
    const seen = [(await act('probe', {}, { store, env })).outbound, (await act('state', {}, { store, env })).outbound];
    const { begun, committed } = await capture(store, 'pf-appliance', ORIGINAL, PREPARED, { env });
    seen.push(begun.outbound, committed.outbound, (await act('truth', { item_id: 'pf-appliance', ...TRUTH }, { store, env })).outbound,
      (await act('photo_url', { item_id: 'pf-appliance' }, { store, env })).outbound, (await act('remove', { item_id: 'pf-appliance', what: 'item' }, { store, env })).outbound);
    assert.deepEqual(seen.flat(), [], 'the lab reached a host outside its store');
  });
  test('SL-5b the lab\'s own modules name no host and import nothing that recognises, searches or prices', () => {
    const allowed = new Set(['./analyze.js', './_lib/v2/http.js', '@supabase/supabase-js', './_lib/scan-lab/config.js', './_lib/scan-lab/store.js', './_lib/scan-lab/service.js', './_lib/scan-lab/truth.js', './config.js', './sets.js', './truth.js']);
    for (const f of LAB) {
      const src = code(f);
      assert.deepEqual([...src.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1]), [], `${f} names a host`);
      for (const m of src.matchAll(RE)) assert.ok(allowed.has(m[1]), `${f} imports ${m[1]}`);
      for (const word of ['openai', 'anthropic', 'api.ebay', 'web_search', 'runV2Identify', 'runPhaseB', '/api/v2/', '/api/analyze', '/api/enrich', 'valuations']) assert.ok(!src.toLowerCase().includes(word.toLowerCase()), `${f} mentions ${word}`);
    }
    const entry = readFileSync(resolvePath(REPO, 'api/scan-lab.js'), 'utf8');
    assert.match(entry, /import \{ verifyJWT \} from '\.\/analyze\.js';/, 'the session verifier is the only symbol taken from the V1 scan');
    assert.match(entry, /import \{ json, nodeHandler \} from '\.\/_lib\/v2\/http\.js';/, 'the HTTP adapter is the only thing taken from V2');
    assert.ok(!existsSync(resolvePath(REPO, 'api/_lib/v2/scan-lab')) && !LAB.some((f) => f.includes('/v2/')), 'the lab does not live inside the V2 tree');
  });
  test('SL-5c no recognition or pricing entry point can reach the lab, its table or its bucket', () => {
    const entries = ['api/analyze.js', 'api/enrich.js', 'api/confirm-identity.js', 'api/submit-candidate.js', 'api/v2/identify.js', 'api/v2/price.js'];
    for (const entry of entries) {
      const reached = closure(entry);
      assert.deepEqual(reached.filter((p) => p.includes('scan-lab')), [], `${entry} reaches Scan Lab`);
      for (const p of reached) assert.ok(!/scan_lab|scan-lab|SCAN_LAB/.test(readFileSync(resolvePath(REPO, p), 'utf8')), `${p} (reached from ${entry}) mentions Scan Lab`);
    }
    const walk = (d) => readdirSync(resolvePath(REPO, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]));
    const mentions = walk('api').filter((f) => /scan_lab_items|createLabStore/.test(readFileSync(resolvePath(REPO, f), 'utf8'))).sort();
    assert.deepEqual(mentions, ['api/_lib/scan-lab/config.js', 'api/_lib/scan-lab/store.js', 'api/scan-lab.js'], 'the table and the store are reachable from exactly these files');
  });
  test('SL-5d there is no action that runs the engine; a result is shown as not run, with the nine fields a future run will fill', async () => {
    assert.deepEqual([...LAB_ACTIONS], ['probe', 'state', 'begin', 'commit', 'truth', 'photo_url', 'remove', 'remove_set']);
    const store = fakeLabStore();
    await capture(store, 'pf-appliance', ORIGINAL, PREPARED);
    const state = await act('state', {}, { store });
    assert.deepEqual([state.payload.execution.available, state.payload.execution.paid_calls_made_by_capture], [false, 0]);
    assert.ok(state.payload.items.every((i) => i.run === null));
    assert.deepEqual([...RUN_FIELDS], ['recognition_result', 'model_accuracy', 'followup_requirement', 'identity_latency', 'market_search_results', 'qualified_evidence', 'pricing_tier', 'total_latency', 'replay_status']);
    assert.match(state.payload.execution.requires, /explicit authorization.*cost ceiling.*freeze/);
  });
  test('SL-5e no secret, token or ground truth is logged or returned', async () => {
    const store = fakeLabStore();
    const lines = [];
    const onLog = (l) => lines.push(l);
    const { begun, committed } = await capture(store, 'pf-appliance', ORIGINAL, PREPARED, { onLog });
    const truth = await act('truth', { item_id: 'pf-appliance', ...TRUTH }, { store, onLog });
    const state = await act('state', {}, { store, onLog, env: { ...ON, VERCEL_GIT_COMMIT_SHA: 'abcdef1234567890', VERCEL_ENV: 'production' } });
    assert.deepEqual(state.payload.deployment, { sha: 'abcdef1', environment: 'production' });
    const own = lines.filter((l) => l.startsWith('[ScanLab]'));
    assert.ok(own.length >= 4);
    for (const l of own) for (const secret of [SERVICE_KEY, 'upload-token', 'Ninja', 'Foodi', sha(ORIGINAL), USER]) assert.ok(!l.includes(secret), `a log line carries ${secret.slice(0, 12)}`);
    for (const r of [begun, committed, truth, state]) for (const secret of [SERVICE_KEY, 'test-secret', ANON_KEY]) assert.ok(!r.text.includes(secret));
  });
  test('SL-5f the function declares its budget as a literal and the real store speaks only to the project\'s own storage, with the service key', async () => {
    assert.match(readFileSync(resolvePath(REPO, 'api/scan-lab.js'), 'utf8'), /export const config = \{ maxDuration: 30 \};/);
    assert.equal(fnConfig.maxDuration, 30);
    const seen = [];
    const fetchImpl = async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input.url);
      const headers = new Headers(init?.headers ?? input.headers);
      seen.push({ origin: url.origin, path: url.pathname, method: init?.method ?? 'GET', auth: headers.get('authorization'), apikey: headers.get('apikey') });
      if (url.pathname.startsWith('/storage/v1/object/upload/sign/')) return Response.json({ url: `/object/upload/sign/scan-lab/x?token=tok` });
      if (url.pathname.startsWith('/storage/v1/object/sign/')) return Response.json({ signedURL: '/object/sign/scan-lab/x?token=tok' });
      if (url.pathname.startsWith('/storage/v1/object/')) return (init?.method ?? 'GET') === 'DELETE' ? Response.json([]) : new Response(ORIGINAL);
      return Response.json((init?.method ?? 'GET') === 'GET' && !String(headers.get('accept')).includes('object') ? [] : { owner_id: USER, set_name: SET, item_id: 'pf-appliance' });
    };
    const real = createLabStore({ url: 'https://proj.supabase.co', serviceKey: SERVICE_KEY, fetchImpl });
    await real.listItems(USER, SET);
    await real.putItem(USER, SET, 'pf-appliance', { truth: null });
    const signed = await real.signUpload(`${USER}/${SET}/pf-appliance/c/original.jpg`);
    const bytes = await real.download(`${USER}/${SET}/pf-appliance/c/original.jpg`);
    const link = await real.signDownload(`${USER}/${SET}/pf-appliance/c/original.jpg`, 60);
    await real.removeObjects([`${USER}/${SET}/pf-appliance/c/original.jpg`]);
    assert.deepEqual([signed.token, bytes.equals(ORIGINAL)], ['tok', true]);
    assert.ok(link.startsWith('https://proj.supabase.co/storage/v1/object/sign/scan-lab/'));
    assert.ok(seen.length >= 6);
    assert.deepEqual([...new Set(seen.map((s) => s.origin))], ['https://proj.supabase.co']);
    assert.ok(seen.every((s) => s.auth === `Bearer ${SERVICE_KEY}` && s.apikey === SERVICE_KEY));
    assert.ok(seen.filter((s) => s.path.startsWith('/rest/v1/')).every((s) => s.path === '/rest/v1/scan_lab_items'));
    assert.ok(seen.filter((s) => s.path.startsWith('/storage/')).every((s) => s.path.includes('/scan-lab')), 'only the private bucket');
  });
});
