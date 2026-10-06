// ══════════════════════════════════════════════════════════════════════════════
// SCAN LAB — THE SCREEN, END TO END, WITHOUT A NETWORK
//
// The real ScanLabView is rendered in jsdom. Its requests go to the REAL
// /api/scan-lab handler (in process) over the REAL service; only the bytes-in-
// a-bucket part is the in-memory store, and "uploading" is putting bytes at the
// path the server signed. So what is driven here is the whole capture:
//
//   pick a photograph -> hash -> prepare -> begin -> upload -> commit
//   -> confirm the truth -> ready -> delete
//
// and what an account that is not enrolled sees: nothing.
//
// jsdom has no camera, no IndexedDB and no layout. What it does have is the
// real event and state behaviour, which is where a screen like this breaks.
//
//   node --test tests/scan-lab-screen.test.mjs
// ══════════════════════════════════════════════════════════════════════════════
import { test, describe as suite, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { mintJWT } from './helpers/analyze-harness.mjs';
import { fakeLabStore, jpeg, sha, SERVICE_KEY, ANON_KEY } from './helpers/scan-lab-fakes.mjs';
import { createLabHandler } from '../api/scan-lab.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT_DIR = join(ROOT, 'node_modules/.cache', `scan-lab-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
const USER = '11111111-2222-3333-4444-555555555555';
const OTHER = '22222222-2222-3333-4444-555555555555';
const ENV = { SCAN_LAB_ENABLED: 'true', SCAN_LAB_USER_IDS: USER, SUPABASE_SERVICE_KEY: SERVICE_KEY, SUPABASE_JWT_SECRET: 'test-secret', SUPABASE_URL: 'https://fake.supabase.co', SUPABASE_ANON_KEY: ANON_KEY, VERCEL_GIT_COMMIT_SHA: 'abcdef1234567', VERCEL_ENV: 'production' };
const ORIGINAL = jpeg(400_000, 0x11);
const PREPARED = jpeg(120_000, 0x22, 1280, 960);

let React, createRoot, act, ScanLabView, dom, container, root, store, world;
const savedEnv = {};
const savedConsole = { log: console.log, warn: console.warn };

before(async () => {
  mkdirSync(OUT_DIR, { recursive: true });
  // The screen's two doors to the rest of the app, replaced: the app context and the storage client.
  writeFileSync(join(OUT_DIR, 'app-context.stub.mjs'), 'export const useApp = () => globalThis.__LAB__.app;\nexport const compressImage = (...a) => globalThis.__LAB__.compress(...a);\nexport const assessImageDataUrl = (...a) => globalThis.__LAB__.assess(...a);\n');
  writeFileSync(join(OUT_DIR, 'supabase.stub.mjs'), 'export const supabase = { storage: { from: (bucket) => ({ uploadToSignedUrl: (path, token, body, opts) => globalThis.__LAB__.upload({ bucket, path, token, body, opts }) }) } };\n');
  const { build } = await import('rolldown');
  await build({
    input: join(ROOT, 'src/views/ScanLabView.jsx'),
    external: ['react', 'react-dom', 'react/jsx-runtime', 'lucide-react'],
    plugins: [{
      name: 'lab-stubs',
      resolveId(source) {
        if (/contexts\/AppContext$/.test(source)) return join(OUT_DIR, 'app-context.stub.mjs');
        if (/lib\/supabase$/.test(source)) return join(OUT_DIR, 'supabase.stub.mjs');
        return null;
      },
    }],
    output: { dir: OUT_DIR, format: 'esm', entryFileNames: 'scan-lab-view.mjs' },
    logLevel: 'silent',
  });

  dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true, url: 'https://get-worth-ai.vercel.app/scan-lab' });
  for (const k of ['window', 'document', 'HTMLElement', 'Node', 'Event', 'KeyboardEvent', 'MouseEvent', 'getComputedStyle',
    'requestAnimationFrame', 'cancelAnimationFrame', 'MessageChannel', 'Element', 'FileReader', 'Blob', 'File']) globalThis[k] = dom.window[k];
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
  // jsdom has no object URLs and no scrolling; the screen only needs them not to throw.
  globalThis.URL.createObjectURL = () => 'blob:local-preview';
  globalThis.URL.revokeObjectURL = () => {};
  dom.window.scrollTo = () => {};
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  React = (await import('react')).default;
  act = React.act;
  ({ createRoot } = await import('react-dom/client'));
  ScanLabView = (await import(pathToFileURL(join(OUT_DIR, 'scan-lab-view.mjs')).href)).default;

  for (const [k, v] of Object.entries(ENV)) { savedEnv[k] = process.env[k]; process.env[k] = v; }
  console.log = () => {}; console.warn = () => {};
});

after(() => {
  Object.assign(console, savedConsole);
  for (const k of Object.keys(ENV)) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
  try { rmSync(OUT_DIR, { recursive: true, force: true }); } catch { /* best effort */ }
});

afterEach(async () => {
  if (root) { await act(async () => { root.unmount(); }); root = null; }
  if (container) { container.remove(); container = null; }
});

/** Mount the screen for `user`, wired to the real handler over a fresh (or given) store. */
async function open({ user = USER, online = true, given = fakeLabStore() } = {}) {
  store = given;
  const handler = createLabHandler({ storeFor: () => store });
  world = { requests: [], uploads: [], toasts: [], online, outbound: [] };
  globalThis.fetch = async (url, init) => {
    world.outbound.push(String(url));
    if (!world.online) throw new TypeError('Failed to fetch');
    if (String(url) !== '/api/scan-lab') throw new Error(`unexpected request to ${url}`);
    world.requests.push(JSON.parse(init.body));
    return handler(new Request('https://get-worth-ai.vercel.app/api/scan-lab', { method: 'POST', headers: init.headers, body: init.body }));
  };
  globalThis.__LAB__ = {
    app: { user: user ? { id: user } : null, getFreshToken: async () => (user ? mintJWT(user) : null), showToastMsg: (message, type = 'success') => world.toasts.push({ message, type }) },
    assess: async () => { world.assessed = (world.assessed ?? 0) + 1; return { ok: true }; },
    compress: async (dataUrl, maxDim, quality) => { world.compressArgs = [maxDim, quality]; return `data:image/jpeg;base64,${PREPARED.toString('base64')}`; },
    upload: async ({ bucket, path, token, body, opts }) => {
      if (!world.online) return { error: { message: 'Failed to fetch' } };
      const bytes = Buffer.from(await body.arrayBuffer());
      world.uploads.push({ bucket, path, token, bytes, type: body.type, contentType: opts?.contentType });
      store.putObject(path, bytes);
      return { error: null };
    },
  };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(React.createElement(ScanLabView)); });
  await settle();
}
const text = () => container.textContent;
const settle = async (until = () => true, ms = 3000) => {
  const deadline = Date.now() + ms;
  for (;;) {
    await act(async () => { await new Promise((r) => setTimeout(r, 15)); });
    if (until() || Date.now() > deadline) return;
  }
};
const button = (label) => [...container.ownerDocument.querySelectorAll('button')].find((b) => b.textContent.trim() === label);
const click = async (el) => { assert.ok(el, 'the control exists'); await act(async () => { el.dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true })); el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); }); };
const type = async (el, value) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, value);
    el.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
};
const field = (label) => { const l = [...container.querySelectorAll('label')].find((x) => x.textContent.trim() === label); return l ? container.ownerDocument.getElementById(l.getAttribute('for')) : null; };
const pick = async (input, bytes, name = 'IMG_0001.jpeg', mime = 'image/jpeg') => {
  const file = new dom.window.File([bytes], name, { type: mime });
  await act(async () => {
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  });
};
const actions = () => world.requests.map((r) => r.action);

suite('SLS-1 who sees what', () => {
  test('SLS-1a the enrolled account gets five slots, none ready, and the private-lab framing', async () => {
    await open();
    assert.match(text(), /Scan Lab/);
    assert.match(text(), /Preflight set · excluded from the benchmark/);
    assert.match(text(), /0 of 5 ready/);
    assert.equal(container.querySelectorAll('[role="group"][aria-label="Items"] button').length, 5);
    assert.match(text(), /1\. Branded appliance/);
    assert.match(text(), /no label, sticker, barcode or underside is to be exposed on purpose/);
    assert.deepEqual(actions(), ['state']);
    assert.ok(world.outbound.every((u) => u === '/api/scan-lab'));
  });
  test('SLS-1b an account that is not enrolled is shown "Not available" and not one fact about the lab', async () => {
    const given = fakeLabStore();
    await open({ given });
    await pick(container.querySelector('input[capture="environment"]'), ORIGINAL);
    await settle(() => /hash verified by the server/.test(text()));
    await act(async () => { root.unmount(); }); root = null; container.remove();
    await open({ user: OTHER, given });
    assert.match(text(), /Not available/);
    for (const leak of ['Preflight', 'Branded appliance', 'sha256', 'ready', 'DIAGNOSTICS', 'Take photo', 'Ground truth']) assert.ok(!text().includes(leak), `the refused screen shows "${leak}"`);
    assert.equal(container.querySelectorAll('input, img').length, 0);
    assert.equal(store.calls.filter((c) => c.args[0] === OTHER).length, 0, 'the refused account reached storage');
  });
  test('SLS-1c signed out: "Not available", and no request is made at all', async () => {
    await open({ user: null });
    assert.match(text(), /Not available/);
    assert.deepEqual(world.outbound, []);
  });
  test('SLS-1d an enrolled account without configured storage is told so, with diagnostics, and offered no capture', async () => {
    process.env.SUPABASE_SERVICE_KEY = ANON_KEY;
    try {
      await open();
      assert.match(text(), /Storage is not ready/);
      assert.match(text(), /storage_not_configured/);
      assert.equal(container.querySelectorAll('input[type="file"]').length, 0);
    } finally { process.env.SUPABASE_SERVICE_KEY = SERVICE_KEY; }
  });
});

suite('SLS-2 photograph, confirm, save', () => {
  test('SLS-2a the camera input takes the photograph as the phone made it: the original is stored byte for byte beside a separate prepared copy', async () => {
    await open();
    const camera = container.querySelector('input[type="file"][capture="environment"]');
    assert.equal(camera.getAttribute('accept'), 'image/*');
    await pick(camera, ORIGINAL);
    await settle(() => /hash verified by the server/.test(text()));
    assert.deepEqual(actions(), ['state', 'begin', 'commit']);
    assert.deepEqual(world.compressArgs, [1280, 0.82], 'the scan’s own preparation, with the scan’s numbers');
    assert.deepEqual(world.uploads.map((u) => [u.bucket, /original\.jpg$/.test(u.path) ? 'original' : 'prepared', u.contentType]), [['scan-lab', 'original', 'image/jpeg'], ['scan-lab', 'prepared', 'image/jpeg']]);
    assert.ok(world.uploads[0].bytes.equals(ORIGINAL), 'the uploaded original is the file');
    assert.ok(world.uploads[1].bytes.equals(PREPARED));
    const row = store.rows.get(`${USER}|preflight-5|pf-appliance`);
    assert.deepEqual([row.photo.master.sha256, row.photo.prepared.sha256, row.pending], [sha(ORIGINAL), sha(PREPARED), null]);
    assert.match(text(), new RegExp(`Original: jpeg · 4032×3024 · 391 KB · sha256 ${sha(ORIGINAL).slice(0, 12)}`));
    assert.match(text(), new RegExp(`Prepared copy: jpeg · 1280×960 · 117 KB · sha256 ${sha(PREPARED).slice(0, 12)}`));
    assert.equal(container.querySelector('img').getAttribute('src'), 'blob:local-preview', 'the preview is the original on this phone');
    assert.match(text(), /0 of 5 ready/, 'a photograph alone is not ready');
    assert.match(text(), /phone queue: 0 waiting/);
  });
  test('SLS-2b the library input offers only the formats that can be stored, and a file that is not a photograph is refused before anything is sent', async () => {
    await open();
    const library = container.querySelector('input[type="file"]:not([capture])');
    assert.equal(library.getAttribute('accept'), 'image/jpeg,image/png,image/webp');
    await pick(library, Buffer.concat([Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]), Buffer.alloc(4096, 1)]), 'IMG_0002.HEIC', 'image/heic');
    await settle(() => /HEIC/.test(text()));
    // Said on the screen, and it stays there: what it is, that nothing was sent, and what to do.
    assert.match(text(), /This photograph is HEIC\. Nothing was stored or sent\./);
    assert.match(text(), /Take photo\. The iPhone camera hands the app a JPEG\./);
    assert.match(text(), /Photos \(not Files\), and under Options set Format to Most Compatible/);
    assert.match(text(), /HEIC_NOT_SUPPORTED/);
    assert.deepEqual([actions(), world.uploads.length, store.rows.size, world.toasts.length], [['state'], 0, 0, 0]);
    assert.match(text(), /phone queue: 0 waiting/);
    await pick(library, Buffer.from('%PDF-1.7 this is not a photograph of anything at all'), 'manual.pdf', 'application/pdf');
    await settle(() => /cannot be stored/.test(text()));
    assert.match(text(), /This file cannot be stored\. Nothing was stored or sent\./);
    assert.ok(!/This photograph is HEIC/.test(text()), 'the earlier refusal is replaced, not stacked');
    // A good photograph afterwards clears the refusal and goes through.
    await pick(container.querySelector('input[capture="environment"]'), ORIGINAL);
    await settle(() => /hash verified by the server/.test(text()));
    assert.ok(!/cannot be stored/.test(text()));
    assert.match(text(), /Metadata: the original keeps what the phone wrote into it/);
  });
  test('SLS-2c the truth form: a value asks how it is known, an unanswered value is not saved, UNKNOWN is left empty, and Save moves on', async () => {
    await open();
    await pick(container.querySelector('input[capture="environment"]'), ORIGINAL);
    await settle(() => /hash verified by the server/.test(text()));
    assert.ok(!button('physical label'), 'no provenance is asked for an empty field');
    assert.equal(field('Brand').getAttribute('placeholder'), 'UNKNOWN');
    await type(field('Brand'), 'Ninja');
    assert.ok(button('physical label') && button('owner knowledge'), 'the provenance choices arrive from the server');
    await click(button('Save and continue'));
    assert.match(text(), /Brand: choose how you know this\./);
    assert.ok(!actions().includes('truth'));
    await click(button('physical label'));
    await type(field('Exact model'), 'Foodi Power Blender');
    await click(button('Save and continue'));
    assert.match(text(), /Exact model: choose how you know this\./, 'a provenance was ticked on the person\'s behalf');
    await click([...container.querySelectorAll('[aria-label="How Exact model was established"] button')].find((b) => b.textContent.trim() === 'packaging'));
    await click(button('Save and continue'));
    assert.match(text(), /Choose a condition\. Unknown is a choice\./);
    await click(button('Good'));
    await click(button('Save and continue'));
    await settle(() => actions().includes('truth') && /2\. Branded electronics/.test(text()));
    const sent = world.requests.find((r) => r.action === 'truth');
    assert.deepEqual(sent.identity, { brand: 'Ninja', product_family: null, exact_model: 'Foodi Power Blender', model_number: null, variant: null, capacity_size: null, color: null, configuration: null });
    assert.deepEqual([sent.provenance, sent.condition, sent.item_id], [{ brand: ['PHYSICAL_LABEL'], exact_model: ['PACKAGING'] }, 'Good', 'pf-appliance']);
    assert.equal(world.assessed, 1, 'the prepared copy went through the scan\'s own pixel check');
    assert.match(text(), /1 of 5 ready/);
    assert.match(text(), /2\. Branded electronics/, 'Save and continue moved to the next slot');
    const truth = store.rows.get(`${USER}|preflight-5|pf-appliance`).truth;
    assert.deepEqual([truth.identity.brand, truth.provenance.brand], ['Ninja', ['PHYSICAL_LABEL']]);
  });
  test('SLS-2d offline: the photograph is kept on the phone and said to be; when the connection returns it uploads without being retaken', async () => {
    await open();
    world.online = false;
    await pick(container.querySelector('input[capture="environment"]'), ORIGINAL);
    await settle(() => /Saved on this phone/.test(text()));
    assert.match(text(), /Saved on this phone\. It will upload when the connection returns\./);
    assert.match(text(), /phone queue: 1 waiting/);
    assert.equal(store.objects.size, 0);
    world.online = true;
    await act(async () => { dom.window.dispatchEvent(new dom.window.Event('online')); });
    await settle(() => /hash verified by the server/.test(text()));
    assert.ok(store.objects.size === 2 && world.uploads[0].bytes.equals(ORIGINAL));
    assert.match(text(), /phone queue: 0 waiting/);
  });
  test('SLS-2e a reopened screen shows what is stored, and opens the original only through a 60-second link', async () => {
    const given = fakeLabStore();
    await open({ given });
    await pick(container.querySelector('input[capture="environment"]'), ORIGINAL);
    await settle(() => /hash verified by the server/.test(text()));
    await act(async () => { root.unmount(); }); root = null; container.remove();
    await open({ given });
    assert.match(text(), new RegExp(`sha256 ${sha(ORIGINAL).slice(0, 12)}`));
    assert.equal(container.querySelector('img'), null, 'no photograph is fetched until asked');
    await click(button('View stored original'));
    await settle(() => !!container.querySelector('img'));
    assert.match(container.querySelector('img').getAttribute('src'), /\/object\/sign\/scan-lab\/.+original\.jpg\?token=signed-60s$/);
    assert.match(text(), /opened for 60 seconds/);
  });
});

suite('SLS-3 what the screen says about itself, and deletion', () => {
  test('SLS-3a diagnostics: the server’s build beside the app’s, the queue, zero paid calls, execution locked; the result block says "not run"', async () => {
    await open();
    assert.match(text(), /server build: abcdef1 · production/);
    assert.match(text(), /paid calls made by capture: 0/);
    assert.match(text(), /benchmark execution: locked · requires explicit authorization, the approved cost ceiling and a matching freeze/);
    assert.match(text(), /memory only: keep the app open/, 'without a database the screen says the queue will not survive');
    for (const f of ['recognition result', 'model accuracy', 'followup requirement', 'identity latency', 'market search results', 'qualified evidence', 'pricing tier', 'total latency', 'replay status']) assert.match(text(), new RegExp(`${f}: not run`));
    assert.ok(![...document.querySelectorAll('button')].some((b) => /run|execute|start benchmark/i.test(b.textContent)), 'the screen offers to run something');
  });
  test('SLS-3b deleting asks first, removes the photograph from storage, and keeps the confirmation unless the item is deleted', async () => {
    await open();
    await pick(container.querySelector('input[capture="environment"]'), ORIGINAL);
    await settle(() => /hash verified by the server/.test(text()));
    await click(button('Delete photo'));
    assert.match(document.body.textContent, /Delete this photograph\?/);
    assert.equal(store.objects.size, 2, 'nothing is deleted before the confirmation');
    await click(button('Keep'));
    assert.equal(store.objects.size, 2);
    await click(button('Delete photo'));
    await click(button('Delete'));
    await settle(() => store.objects.size === 0);
    assert.equal(store.objects.size, 0);
    assert.match(text(), /Original: not stored yet/);
    await click(button('Delete the whole set'));
    assert.match(document.body.textContent, /Every photograph and confirmation stored for this set is removed/);
    await click(button('Delete'));
    await settle(() => actions().includes('remove_set'));
    assert.equal(world.requests.find((r) => r.action === 'remove_set').confirm, 'preflight-5');
  });
  test('SLS-3c nothing the screen did reached anything but /api/scan-lab', () => {
    assert.ok(world.outbound.length > 0 && world.outbound.every((u) => u === '/api/scan-lab'));
  });
});
