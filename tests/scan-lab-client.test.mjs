// ══════════════════════════════════════════════════════════════════════════════
// SCAN LAB — THE CLIENT: THE PHOTOGRAPH, THE QUEUE, AND WHAT THE PWA MAY DO
//
// src/lib/scanLab.js is plain JavaScript, so the capture queue is run for real
// against a scripted server and a scripted storage: offline, interrupted,
// closed-and-reopened, refused. The screen, the routing and the PWA shell are
// asserted from SOURCE, as tests/scan-v2-client.test.mjs does and for its
// reason: the properties that matter are what the code can and cannot do.
//
//   node --test tests/scan-lab-client.test.mjs
// ══════════════════════════════════════════════════════════════════════════════
import { test, describe as suite } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SCAN_LAB_ENABLED, LAB_ENDPOINT, LAB_SET, LAB_STAGE, LAB_FAILURE, labRequest, isScanLabAvailable, forgetScanLabAvailability,
  sniffImage, unsupportedKind, checkFile, sha256Hex, prepareCapture, queueCapture, runCapture, resumeCaptures, pendingCaptures, captureKey, bytesKey, draftKey,
} from '../src/lib/scanLab.js';
import { memoryLabDb, openLabDb } from '../src/lib/scanLabDb.js';
import { jpeg, sha } from './helpers/scan-lab-fakes.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\/|^\s*\/\/[^\n]*/gm, '');
const USER = '11111111-2222-3333-4444-555555555555';
const OTHER = '22222222-2222-3333-4444-555555555555';
const ab = (buf) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const dataUrl = (buf) => `data:image/jpeg;base64,${buf.toString('base64')}`;
const readDataUrl = async (blob) => `data:${blob.type};base64,${Buffer.from(await blob.arrayBuffer()).toString('base64')}`;

const ORIGINAL = jpeg(400_000, 0x11);
const PREPARED = jpeg(120_000, 0x22, 1280, 960);
const prepared = () => prepareCapture({ bytes: ab(ORIGINAL), readDataUrl, compress: async () => dataUrl(PREPARED) });

/** A scripted /api/scan-lab and a scripted storage, recording everything asked of them. */
function world({ begin = [], commit = [], uploads = [] } = {}) {
  const requests = []; const uploaded = [];
  let n = 0;
  const next = (list, fallback) => { const v = list.length ? list.shift() : fallback; if (v instanceof Error) throw v; return typeof v === 'function' ? v() : v; };
  return {
    requests, uploaded,
    request: async (action, body) => {
      requests.push({ action, body });
      if (action === 'begin') { n += 1; return next(begin, { status: 200, payload: { status: 'OK', capture_id: `capture-${n}`, bucket: 'scan-lab', uploads: { original: { path: `p/${n}/original.jpg`, token: `t${n}o` }, prepared: body.prepared ? { path: `p/${n}/prepared.jpg`, token: `t${n}p` } : null } } }); }
      return next(commit, { status: 200, payload: { status: 'OK', item: { item_id: body.item_id, readiness: { ready: false } } } });
    },
    upload: async (args) => { const r = next(uploads, { ok: true }); if (r.ok) uploaded.push(args); return r; },
  };
}
const queued = async (db, itemId = 'pf-appliance', userId = USER) => queueCapture({ db, userId, set: LAB_SET, itemId, capture: await prepared() });

// ── SLC-1 THE FLAG AND THE ENDPOINT ─────────────────────────────────────────
suite('SLC-1 the build flag only decides whether the browser asks', () => {
  test('SLC-1a without the build flag the lab is never asked about: no request, and the answer is no', async () => {
    assert.equal(SCAN_LAB_ENABLED, false, 'the flag is off unless a build sets it');
    let asked = 0;
    const ok = await isScanLabAvailable({ userId: USER, getToken: async () => 'tok', fetchImpl: async () => { asked += 1; return Response.json({ lab: 'scan-lab', status: 'READY' }); } });
    assert.deepEqual([ok, asked], [false, 0]);
    forgetScanLabAvailability();
    assert.match(read('src/lib/scanLab.js'), /import\.meta\.env\.VITE_SCAN_LAB_ENABLED === 'true'/, 'an exact match: an unset variable can arrive as the string "undefined"');
    assert.match(code('src/lib/scanLab.js'), /if \(!SCAN_LAB_ENABLED \|\| !userId\) return false;/);
    assert.match(code('src/lib/scanLab.js'), /ok = status === 200 && payload\?\.lab === 'scan-lab'/, 'anything but a clear yes from the server is a no');
  });
  test('SLC-1b a request is one POST to /api/scan-lab with the user\'s own session; without a session nothing is sent', async () => {
    const seen = [];
    const fetchImpl = async (path, init) => { seen.push({ path, init }); return Response.json({ status: 'OK' }); };
    const r = await labRequest('state', { set: LAB_SET }, { getToken: async () => 'user-session-token', fetchImpl });
    assert.deepEqual([r.status, seen[0].path, seen[0].init.method, seen[0].init.headers.Authorization], [200, LAB_ENDPOINT, 'POST', 'Bearer user-session-token']);
    assert.deepEqual(JSON.parse(seen[0].init.body), { set: LAB_SET, action: 'state' });
    const none = await labRequest('state', {}, { getToken: async () => null, fetchImpl });
    assert.deepEqual([none.status, seen.length], [401, 1]);
  });
});

// ── SLC-2 THE PHOTOGRAPH ────────────────────────────────────────────────────
suite('SLC-2 the original is kept untouched and the prepared copy is a separate thing', () => {
  test('SLC-2a format from the bytes: JPEG, PNG, WEBP; HEIC and everything else is not a storable photograph', () => {
    assert.equal(sniffImage(ORIGINAL), 'jpeg');
    assert.equal(sniffImage(Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.alloc(16)])), 'png');
    assert.equal(sniffImage(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8X'), Buffer.alloc(8)])), 'webp');
    assert.equal(sniffImage(Buffer.concat([Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]), Buffer.alloc(64)])), null);
    assert.equal(sniffImage(Buffer.from('%PDF-1.7 not a photograph')), null);
    assert.equal(sniffImage(new Uint8Array(4)), null);
  });
  test('SLC-2e a file that cannot be stored is NAMED from its first sixteen bytes, before it is read, hashed or sent: HEIC is its own refusal', async () => {
    const ftyp = (brand) => Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftyp'), Buffer.from(brand), Buffer.alloc(64, 1)]);
    for (const brand of ['heic', 'heix', 'hevc', 'mif1', 'msf1']) assert.equal(unsupportedKind(ftyp(brand)), 'heic', brand);
    assert.deepEqual([unsupportedKind(ftyp('avif')), unsupportedKind(ftyp('isom')), unsupportedKind(Buffer.from('GIF89a..........')), unsupportedKind(Buffer.from('%PDF-1.7 not a photo')), unsupportedKind(ORIGINAL)], ['avif', 'video', 'gif', 'unknown', null]);
    const fileOf = (buf) => { let read = 0; return { read: () => read, slice: (a, b) => ({ arrayBuffer: async () => { read += b - a; return ab(buf.subarray(a, b)); } }), arrayBuffer: async () => { read += buf.length; return ab(buf); } }; };
    const heic = fileOf(ftyp('heic'));
    await assert.rejects(() => checkFile(heic), (e) => e.code === LAB_FAILURE.HEIC_NOT_SUPPORTED);
    assert.equal(heic.read(), 16, 'the whole file was read to learn it is HEIC');
    await assert.rejects(() => checkFile(fileOf(Buffer.from('%PDF-1.7 not a photograph at all'))), (e) => e.code === LAB_FAILURE.NOT_AN_IMAGE && e.detail === 'unknown');
    assert.equal(await checkFile(fileOf(ORIGINAL)), 'jpeg');
    // And the same answer if the bytes ever reach preparation another way.
    await assert.rejects(() => prepareCapture({ bytes: ab(ftyp('heic')), readDataUrl, compress: async (d) => d }), (e) => e.code === LAB_FAILURE.HEIC_NOT_SUPPORTED);
    const view = read('src/views/ScanLabView.jsx');
    assert.ok(view.indexOf('await checkFile(file);') > 0 && view.indexOf('await checkFile(file);') < view.indexOf('const bytes = await file.arrayBuffer();'), 'the screen checks the format before it reads the file');
    assert.ok(!/heic2any|libheif|heic-convert|heic-to/.test(read('package.json')), 'a HEIC conversion dependency was added');
  });
  test('SLC-2b the hash is SHA-256 of the exact bytes, and it is the hash the server will compute', async () => {
    assert.equal(await sha256Hex(ab(Buffer.from('abc'))), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    assert.equal(await sha256Hex(ab(ORIGINAL)), sha(ORIGINAL));
  });
  test('SLC-2c the original\'s bytes are the file\'s bytes; the prepared copy is what the scan\'s preparation returned, hashed separately', async () => {
    const given = [];
    const c = await prepareCapture({ bytes: ab(ORIGINAL), readDataUrl, compress: async (d) => { given.push(d); return dataUrl(PREPARED); } });
    assert.ok(Buffer.from(c.original.bytes).equals(ORIGINAL), 'the original was altered');
    assert.deepEqual([c.original.sha256, c.original.size, c.original.format], [sha(ORIGINAL), ORIGINAL.length, 'jpeg']);
    assert.ok(Buffer.from(c.prepared.bytes).equals(PREPARED));
    assert.deepEqual([c.prepared.sha256, c.prepared.size, c.prepared.format], [sha(PREPARED), PREPARED.length, 'jpeg']);
    assert.notEqual(c.prepared.sha256, c.original.sha256);
    assert.equal(given[0], dataUrl(ORIGINAL), 'the preparation is given the original photograph and nothing else');
  });
  test('SLC-2d when the preparation returns its input (the under-150 KB rule) there is no derivative; a non-image, an oversized file and a broken preparation are named', async () => {
    const small = await prepareCapture({ bytes: ab(ORIGINAL), readDataUrl, compress: async (d) => d });
    assert.equal(small.prepared, null);
    // A different string that decodes to the very same bytes: it must be recognised by its hash.
    const same = await prepareCapture({ bytes: ab(ORIGINAL), readDataUrl, compress: async () => `data:image/jpeg;name=copy;base64,${ORIGINAL.toString('base64')}` });
    assert.equal(same.prepared, null, 'a derivative identical to the original is not a second object');
    await assert.rejects(() => prepareCapture({ bytes: ab(Buffer.from('%PDF-1.7 not a photograph at all')), readDataUrl, compress: async (d) => d }), (e) => e.code === LAB_FAILURE.NOT_AN_IMAGE);
    await assert.rejects(() => prepareCapture({ bytes: ab(ORIGINAL), readDataUrl, compress: async (d) => d, maxBytes: 1000 }), (e) => e.code === LAB_FAILURE.PHOTO_TOO_LARGE);
    await assert.rejects(() => prepareCapture({ bytes: ab(ORIGINAL), readDataUrl, compress: async () => { throw new Error('Canvas 2D context unavailable'); } }), (e) => e.code === LAB_FAILURE.PREPARATION_FAILED);
    await assert.rejects(() => prepareCapture({ bytes: ab(ORIGINAL), readDataUrl, compress: async () => 'data:,' }), (e) => e.code === LAB_FAILURE.PREPARATION_FAILED);
  });
});

// ── SLC-3 THE QUEUE ─────────────────────────────────────────────────────────
suite('SLC-3 a capture survives a dropped connection, an interrupted upload and a closed app', () => {
  test('SLC-3a the whole path: on the phone first, then begin, two uploads to the signed paths, commit; the phone forgets it only after the server confirms', async () => {
    const db = memoryLabDb(); const w = world();
    const record = await queued(db);
    assert.equal((await db.get(captureKey(USER, LAB_SET, 'pf-appliance'))).stage, LAB_STAGE.QUEUED, 'on the phone before any request');
    assert.equal(w.requests.length, 0);
    const r = await runCapture({ record, db, request: w.request, upload: w.upload });
    assert.equal(r.ok, true);
    assert.deepEqual(w.requests.map((q) => q.action), ['begin', 'commit']);
    assert.deepEqual(w.requests[0].body, { set: LAB_SET, item_id: 'pf-appliance', original: { sha256: sha(ORIGINAL), bytes: ORIGINAL.length, format: 'jpeg' }, prepared: { sha256: sha(PREPARED), bytes: PREPARED.length, format: 'jpeg' } });
    assert.deepEqual(w.requests[1].body, { set: LAB_SET, item_id: 'pf-appliance', capture_id: 'capture-1' });
    assert.deepEqual(w.uploaded.map((u) => [u.bucket, u.path, u.token, u.contentType]), [['scan-lab', 'p/1/original.jpg', 't1o', 'image/jpeg'], ['scan-lab', 'p/1/prepared.jpg', 't1p', 'image/jpeg']]);
    assert.ok(Buffer.from(w.uploaded[0].bytes).equals(ORIGINAL) && Buffer.from(w.uploaded[1].bytes).equals(PREPARED), 'each object is sent to its own path');
    assert.equal(await db.get(captureKey(USER, LAB_SET, 'pf-appliance')), null);
  });
  test('SLC-3b offline: the photograph stays queued on the phone; when the app is reopened with a connection it uploads without being retaken', async () => {
    const db = memoryLabDb();
    const offline = world({ begin: [new TypeError('Failed to fetch')] });
    const first = await runCapture({ record: await queued(db), db, request: offline.request, upload: offline.upload });
    assert.deepEqual([first.ok, first.code, first.retryable], [false, LAB_FAILURE.OFFLINE, true]);
    const kept = (await pendingCaptures({ db, userId: USER, set: LAB_SET }))[0];
    assert.deepEqual([kept.stage, kept.error.code], [LAB_STAGE.QUEUED, LAB_FAILURE.OFFLINE]);
    assert.ok(Buffer.from((await db.get(bytesKey(USER, LAB_SET, 'pf-appliance'))).original).equals(ORIGINAL), 'the bytes are still on the phone');
    // The app was closed: nothing survives but the database.
    const online = world();
    const resumed = await resumeCaptures({ db, userId: USER, set: LAB_SET, request: online.request, upload: online.upload });
    assert.deepEqual(resumed.map((r) => [r.itemId, r.ok]), [['pf-appliance', true]]);
    assert.equal(online.uploaded.length, 2);
    assert.deepEqual(await pendingCaptures({ db, userId: USER, set: LAB_SET }), []);
  });
  test('SLC-3c interrupted between the two uploads: the next run sends only what is missing, under the same capture', async () => {
    const db = memoryLabDb();
    const w1 = world({ uploads: [{ ok: true }, { ok: false, error: 'Load failed' }] });
    const r1 = await runCapture({ record: await queued(db), db, request: w1.request, upload: w1.upload });
    assert.deepEqual([r1.ok, r1.code, r1.retryable], [false, LAB_FAILURE.UPLOAD_FAILED, true]);
    const kept = (await pendingCaptures({ db, userId: USER, set: LAB_SET }))[0];
    assert.deepEqual([kept.stage, kept.uploaded, kept.captureId], [LAB_STAGE.BEGUN, { original: true, prepared: false }, 'capture-1']);
    const w2 = world();
    const r2 = await resumeCaptures({ db, userId: USER, set: LAB_SET, request: w2.request, upload: w2.upload });
    assert.equal(r2[0].ok, true);
    assert.deepEqual(w2.requests.map((q) => q.action), ['commit'], 'no second begin');
    assert.deepEqual(w2.uploaded.map((u) => u.path), ['p/1/prepared.jpg'], 'the original was not sent twice');
    assert.equal(w2.requests[0].body.capture_id, 'capture-1');
  });
  test('SLC-3d an upload that had already landed counts, because commit hashes it anyway; a capture the server no longer expects starts again', async () => {
    const db = memoryLabDb();
    const dup = world({ uploads: [{ ok: false, status: 409, error: 'The resource already exists' }, { ok: true }] });
    assert.equal((await runCapture({ record: await queued(db), db, request: dup.request, upload: dup.upload })).ok, true);
    const again = world({ commit: [{ status: 409, payload: { error: 'upload_missing', detail: 'original' } }] });
    const r = await runCapture({ record: await queued(db), db, request: again.request, upload: again.upload });
    assert.equal(r.ok, true);
    assert.deepEqual(again.requests.map((q) => q.action), ['begin', 'commit', 'begin', 'commit']);
    assert.equal(again.requests[3].body.capture_id, 'capture-2', 'a fresh capture, with fresh tokens');
    assert.equal(again.uploaded.length, 4);
    const stuck = world({ commit: Array.from({ length: 5 }, () => ({ status: 409, payload: { error: 'no_pending_capture' } })) });
    const s = await runCapture({ record: await queued(db), db, request: stuck.request, upload: stuck.upload });
    assert.deepEqual([s.ok, s.retryable, stuck.requests.filter((q) => q.action === 'begin').length], [false, true, 3]);
  });
  test('SLC-3e an integrity mismatch is never a success: it is kept, marked, not resent on its own, and retried only when asked', async () => {
    const db = memoryLabDb();
    const w = world({ commit: [{ status: 409, payload: { error: 'integrity_mismatch', detail: 'original' } }] });
    const r = await runCapture({ record: await queued(db), db, request: w.request, upload: w.upload });
    assert.deepEqual([r.ok, r.code, r.retryable], [false, LAB_FAILURE.INTEGRITY_MISMATCH, false]);
    const kept = (await pendingCaptures({ db, userId: USER, set: LAB_SET }))[0];
    assert.equal(kept.stage, LAB_STAGE.FAILED);
    const idle = world();
    assert.deepEqual(await resumeCaptures({ db, userId: USER, set: LAB_SET, request: idle.request, upload: idle.upload }), []);
    assert.equal(idle.requests.length, 0);
    const asked = world();
    assert.equal((await runCapture({ record: kept, db, request: asked.request, upload: asked.upload })).ok, true);
    assert.deepEqual(asked.requests.map((q) => q.action), ['begin', 'commit']);
  });
  test('SLC-3f a refusal and a lost session are told apart, and neither loses the photograph', async () => {
    const db = memoryLabDb();
    const refused = world({ begin: [{ status: 415, payload: { error: 'unsupported_format', detail: 'original must be a JPEG, PNG or WEBP' } }] });
    const r = await runCapture({ record: await queued(db), db, request: refused.request, upload: refused.upload });
    assert.deepEqual([r.code, r.retryable], [LAB_FAILURE.SERVER_REFUSED, false]);
    assert.match(r.detail, /unsupported_format/);
    const expired = world({ begin: [{ status: 401, payload: { error: 'unauthorized' } }] });
    const e = await runCapture({ record: await queued(db, 'pf-generic'), db, request: expired.request, upload: expired.upload });
    assert.deepEqual([e.code, e.retryable], [LAB_FAILURE.NO_SESSION, true]);
    assert.equal((await pendingCaptures({ db, userId: USER, set: LAB_SET })).length, 2);
    const down = world({ begin: [{ status: 502, payload: { error: 'storage_failed' } }] });
    assert.equal((await runCapture({ record: await queued(db, 'pf-consumer'), db, request: down.request, upload: down.upload })).retryable, true);
  });
  test('SLC-3g one capture is driven once at a time, and one account never sees another\'s queue or drafts', async () => {
    const db = memoryLabDb(); const w = world();
    const record = await queued(db);
    const [a, b] = await Promise.all([runCapture({ record, db, request: w.request, upload: w.upload }), runCapture({ record, db, request: w.request, upload: w.upload })]);
    assert.deepEqual([a.ok, b.ok, w.requests.filter((q) => q.action === 'begin').length], [true, true, 1]);
    await queued(db, 'pf-appliance', USER);
    await db.put(draftKey(USER, LAB_SET, 'pf-appliance'), { identity: { brand: 'Ninja' } });
    assert.deepEqual(await pendingCaptures({ db, userId: OTHER, set: LAB_SET }), []);
    assert.deepEqual(await db.entries(`draft|${OTHER}|`), []);
    assert.equal((await db.entries(`draft|${USER}|${LAB_SET}|`)).length, 1);
    assert.equal((await openLabDb(undefined)).persistent, false, 'no database: memory, and the screen says so');
  });
  test('SLC-3i a phone that cannot hold the photograph sends nothing: the failure is named and no request is made', async () => {
    const full = { ...memoryLabDb(), put: async () => { throw new Error('QuotaExceededError'); } };
    const w = world();
    await assert.rejects(() => queueCapture({ db: full, userId: USER, set: LAB_SET, itemId: 'pf-appliance', capture: { original: { bytes: new ArrayBuffer(8), sha256: 'x', size: 8, format: 'jpeg' }, prepared: null } }), (e) => e.code === LAB_FAILURE.QUEUE_FAILED);
    assert.equal(w.requests.length, 0);
    assert.match(read('src/views/ScanLabView.jsx'), /const record = await queueCapture\([\s\S]{0,1500}?const result = await runCapture\(/, 'the screen queues before it sends');
  });
  test('SLC-3h what the queue sends the server is the photograph\'s declaration and nothing about what the item is', async () => {
    const db = memoryLabDb(); const w = world();
    await db.put(draftKey(USER, LAB_SET, 'pf-appliance'), { identity: { brand: 'Ninja' }, condition: 'Good' });
    await runCapture({ record: await queued(db), db, request: w.request, upload: w.upload });
    const sent = JSON.stringify(w.requests);
    for (const word of ['Ninja', 'identity', 'provenance', 'condition', 'brand']) assert.ok(!sent.includes(word), `the capture requests carry ${word}`);
  });
});

// ── SLC-4 WHAT THE PWA MAY DO ───────────────────────────────────────────────
suite('SLC-4 the screen, the routing and the shell', () => {
  const srcFiles = () => { const out = []; const walk = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (/\.(jsx?|mjs)$/.test(n)) out.push(p); } }; walk(join(ROOT, 'src')); return out; };

  test('SLC-4a the lab calls /api/scan-lab and its own storage upload, and never a scan, enrichment or V2 endpoint', () => {
    for (const f of ['src/lib/scanLab.js', 'src/lib/scanLabDb.js', 'src/views/ScanLabView.jsx', 'src/components/ScanLabTruthForm.jsx']) {
      const src = code(f);
      for (const word of ['/api/analyze', '/api/enrich', '/api/v2', '/api/confirm-identity', 'startScanV2', 'handleFile', 'runPipeline', 'openai']) assert.ok(!src.includes(word), `${f} mentions ${word}`);
      assert.ok(!/https?:\/\//.test(src), `${f} names a host`);
    }
    assert.deepEqual([...code('src/lib/scanLab.js').matchAll(/fetchImpl\(([A-Z_]+)/g)].map((m) => m[1]), ['LAB_ENDPOINT'], 'one endpoint');
    const view = code('src/views/ScanLabView.jsx');
    assert.match(view, /supabase\.storage\.from\(bucket\)\.uploadToSignedUrl\(path, token,/, 'uploads use the one-object token the server signed');
    assert.ok(!/\.from\(['"`]/.test(view) && !/getPublicUrl|\.upload\(/.test(view), 'the screen reads or writes storage or a table directly');
  });
  test('SLC-4b the prepared copy is made by the scan\'s own preparation, with the scan\'s own numbers', () => {
    const ctx = read('src/contexts/AppContext.jsx');
    assert.match(ctx, /export function compressImage\(dataUrl, maxDim = 800, quality = 0\.65\)/);
    assert.match(ctx, /compress: \(d\) => compressImage\(d, 1280, 0\.82\)/, 'what a V2 scan sends');
    assert.match(read('src/views/ScanLabView.jsx'), /compress: \(d\) => compressImage\(d, 1280, 0\.82\)/, 'what Scan Lab stores');
    assert.match(read('src/views/ScanLabView.jsx'), /import \{ useApp, compressImage, assessImageDataUrl \} from '\.\.\/contexts\/AppContext';/);
    assert.match(ctx, /assess: assessImageDataUrl,/, 'the pixel check a V2 scan applies');
    assert.match(read('src/views/ScanLabView.jsx'), /assess: assessImageDataUrl, compress:/, 'and the one Scan Lab applies to the copy it stores');
  });
  test('SLC-4c the iPhone camera path: a capture input for the camera and a second input for the library, both handing over the file as it is', () => {
    const view = read('src/views/ScanLabView.jsx');
    assert.match(view, /type="file" accept="image\/\*" capture="environment"/);
    assert.match(view, /type="file" accept="image\/jpeg,image\/png,image\/webp"/);
    assert.match(view, /const bytes = await file\.arrayBuffer\(\);/, 'the bytes are read from the file, not from a canvas');
    assert.ok(!/getUserMedia|toDataURL|drawImage/.test(code('src/views/ScanLabView.jsx')), 'the screen re-encodes the photograph itself');
  });
  test('SLC-4d the normal scan does not know the lab exists', () => {
    for (const f of ['src/views/CameraResultsView.jsx', 'src/views/ScanV2View.jsx', 'src/lib/scanV2.js', 'src/views/HomeView.jsx']) assert.ok(!/scanLab|ScanLab|scan-lab/.test(read(f)), `${f} mentions Scan Lab`);
    const ctx = read('src/contexts/AppContext.jsx');
    assert.ok(!/scanLab|ScanLab|scan-lab|SCAN_LAB/.test(ctx.replace(/\/\/ EXPORTED for Scan Lab[\s\S]*?\n(?=export function compressImage)/, '')), 'the app context imports or branches on Scan Lab');
  });
  test('SLC-4e the screen is in the bundle only when the build flag is set, is reached only at /scan-lab, and its entry is drawn only after the server said yes', () => {
    const app = read('src/App.jsx');
    assert.match(app, /const LazyScanLabView = import\.meta\.env\.VITE_SCAN_LAB_ENABLED === 'true'\s*\? React\.lazy\(\(\) => import\('\.\/views\/ScanLabView'\)\)\s*: null;/);
    assert.match(app, /\{view === 'scanLab' && LazyScanLabView && <LazyScanLabView \/>\}/);
    assert.equal(srcFiles().filter((p) => /import\(['"][^'"]*ScanLabView['"]\)|from ['"][^'"]*ScanLabView['"]/.test(readFileSync(p, 'utf8'))).length, 1, 'one import site, and it is the gated one');
    const url = read('src/lib/urlSync.js');
    assert.match(url, /if \(p === '\/scan-lab' && SCAN_LAB_ENABLED\) return \{ view: 'scanLab', tab: 'profile' \};/);
    const profile = read('src/views/AuthProfileView.jsx');
    assert.match(profile, /isScanLabAvailable\(\{ userId: user\.id, getToken: getFreshToken \}\)\.then\(\(ok\) => \{ if \(alive\) setScanLabOpen\(ok\); \}\);/);
    assert.match(profile, /\{scanLabOpen && \(\s*<button\s+onClick=\{\(\) => setView\('scanLab'\)\}/);
    assert.equal(profile.split("setView('scanLab')").length - 1, 1);
    assert.ok(!/is_admin[^\n]*scanLab|scanLab[^\n]*is_admin/.test(profile), 'the marketplace admin flag must not open the lab');
  });
  test('SLC-4f the client bundle carries no ground-truth vocabulary, slot or bucket definition: the server sends them after authorizing', () => {
    for (const p of srcFiles()) {
      const src = readFileSync(p, 'utf8');
      for (const word of ['PHYSICAL_LABEL', 'OWNER_KNOWLEDGE', 'SERIAL_MODEL_LABEL', 'ACCESSORY_ONLY', 'pf-appliance', 'pf-configuration', 'scan_lab_items']) assert.ok(!src.includes(word), `${p.slice(ROOT.length)} contains ${word}`);
    }
    for (const f of ['src/lib/scanLab.js', 'src/lib/scanLabDb.js', 'src/views/ScanLabView.jsx', 'src/components/ScanLabTruthForm.jsx']) {
      assert.ok(!/SUPABASE_SERVICE|service_role|sb_secret/.test(read(f)), `${f} names a server credential`);
    }
  });
  test('SLC-4g the service worker never caches a lab answer or a stored photograph, and an update still waits for approval', (t) => {
    if (!existsSync(join(ROOT, 'vite.config.js'))) return t.skip('vite.config.js not present (harness mirror)');
    const cfg = read('vite.config.js');
    assert.match(cfg, /urlPattern: \/supabase\\\.co\/,\s*handler: 'NetworkOnly'/);
    assert.match(cfg, /urlPattern: \/\\\/api\\\/\/,\s*handler: 'NetworkOnly'/);
    assert.match(cfg, /navigateFallbackDenylist: \[\/\^\\\/api\\\/\/\]/);
    assert.match(cfg, /registerType: 'prompt'/);
    assert.ok(cfg.indexOf("urlPattern: /supabase\\.co/") < cfg.indexOf('CacheFirst'), 'storage must be matched before the image cache rule');
    const csp = JSON.parse(read('vercel.json')).headers.find((h) => h.headers.some((x) => x.key === 'Content-Security-Policy' && x.value.includes('connect-src'))).headers[0].value;
    assert.match(csp, /connect-src 'self' https:\/\/\*\.supabase\.co/);
    assert.match(csp, /img-src 'self' data: blob: https:\/\/\*\.supabase\.co/);
    assert.match(read('scripts/vite-dev-api.mjs'), /\['\/api\/scan-lab', '\.\.\/api\/scan-lab\.js'\]/);
  });
  test('SLC-4h the screen shows the build it is running beside the build that answered, and says the benchmark has not run', () => {
    const view = read('src/views/ScanLabView.jsx');
    assert.match(view, /const BUILD = typeof __BUILD_SHA__ !== 'undefined' \? __BUILD_SHA__ : 'local';/);
    assert.match(view, /<Fact label="builds match" value=\{differs \? 'NO: update the app'/);
    assert.match(view, /item\.run\?\.\[f\] \?\? 'not run'/);
    assert.ok(!/request\('(run|execute|benchmark|identify|price)'/.test(view), 'the screen can start a run');
  });
});
