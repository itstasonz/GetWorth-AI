// ══════════════════════════════════════════════════════════════════════════════
// GW-BENCHMARK-001 M3 — THE CAPTURE HELPER, THE PREFLIGHT SET, THE CEILING,
// THE FREEZE, AND THE FOLLOW-UP PROTOCOL
//
//   node --test tests/scan-v2-capture-helper.test.mjs
// ══════════════════════════════════════════════════════════════════════════════
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { readFileSync, mkdtempSync, writeFileSync, rmSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

import { openManifest, createCaptureServer, imageInfo, PROVENANCE, CONDITIONS, CONFIGURATIONS } from '../scripts/dev/benchmark-capture.mjs';
import { loadManifest, planRun, runEngine, runLive, liveGate, freezeRecord, chargeOf, perItemMaximum, RATE, FROZEN_PATHS, LIVE_ENV } from '../scripts/market-benchmark.mjs';
import { scoreItem, datasetReadiness, classifyFailure } from '../scripts/market-benchmark-report.mjs';
import { RAW, RESULTS_PS5_VERIFIED, mockV2Provider } from './fixtures/scan-v2/fixtures.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const sha = (b) => createHash('sha256').update(b).digest('hex');
/** A JPEG whose SOF says 1024×768, padded past the readiness floor. */
const JPEG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xC0, 0x00, 0x11, 0x08, 0x03, 0x00, 0x04, 0x00, 0x03]), Buffer.alloc(900, 0x11)]);
const JPEG2 = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xC0, 0x00, 0x11, 0x08, 0x01, 0x00, 0x02, 0x00, 0x03]), Buffer.alloc(700, 0x22)]);

let realFetch;
const attempted = [];
before(() => { realFetch = globalThis.fetch; globalThis.fetch = async (url) => { attempted.push(String(url)); throw new Error('network call attempted'); }; });
after(() => { globalThis.fetch = realFetch; });

const EXACT = { exact_model_expected: true, family_only_acceptable: false, generic_only_acceptable: false };
const item = (id, over = {}) => ({
  benchmark_id: id, cohort: 'A', category: 'gaming', subcategory: 'console',
  photo: { photo_path: `photos/${id}.jpg`, photo_count: 1, photo_type: 't', photo_notes: 'n', followup_photo_path: null },
  identity: { brand: 'Sony', brand_alternatives: [], product_family: 'PlayStation 5', exact_model: 'PlayStation 5', model_number: null, variant: null, capacity_size: null, color: null, configuration: 'COMPLETE', configuration_alternatives: [] },
  condition: { condition: null, condition_notes: null },
  expected_recognition: { ...EXACT, decision: 'SEARCH_NOW', level: 'product' },
  market_identity: { canonical_market_name: 'Sony PlayStation 5', known_aliases: [], known_model_numbers: [], candidate_model_numbers_unverified: [], regional_name: null },
  must_not_be: null, special_case: 'complete_product', ground_truth_source: 'pending: x',
  valuation_ground_truth: { class: null, status: 'PENDING_HUMAN_COLLECTION', reference_ils: null }, notes: null, ...over,
});
/** A scratch dataset: a manifest with two items and their photographs on disk. */
function scratchDataset(extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'gw-m3-'));
  mkdirSync(join(dir, 'photos'));
  const m = { format: 'gw-benchmark-manifest/2', name: 'scratch', market: 'IL', items: [item('it-ps5'), item('it-logi', { category: 'computer_hardware', cohort: 'B', photo: { photo_path: 'photos/it-logi.jpg', photo_count: 2, photo_type: 't', photo_notes: 'n', followup_photo_path: 'photos/it-logi-followup.jpg' }, identity: { brand: 'Logitech', product_family: 'G Pro', exact_model: 'G Pro X Superlight', configuration: 'COMPLETE' }, expected_recognition: { exact_model_expected: false, family_only_acceptable: true, generic_only_acceptable: false, decision: 'NEED_FOLLOWUP', level: 'brand_class' } })], ...extra };
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(m, null, 1));
  if (extra.photos !== false) { writeFileSync(join(dir, 'photos/it-ps5.jpg'), JPEG); writeFileSync(join(dir, 'photos/it-logi.jpg'), JPEG); writeFileSync(join(dir, 'photos/it-logi-followup.jpg'), JPEG2); }
  return { dir, manifest: join(dir, 'manifest.json'), out: join(dir, 'out') };
}
const listen = (server) => new Promise((res) => server.listen(0, '127.0.0.1', () => res(server.address().port)));
const http = async (port, path, init) => { const r = await realFetch(`http://127.0.0.1:${port}${path}`, init); return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) }; };

// ── CH-1 THE HELPER ─────────────────────────────────────────────────────────
describe('CH-1 the capture helper stores the photograph as received, records integrity, and takes the founder\'s truth with provenance', () => {
  test('CH-1a image headers: JPEG, PNG and WEBP sizes from the bytes; anything else refused', () => {
    assert.deepEqual(imageInfo(JPEG), { format: 'jpeg', width: 1024, height: 768 });
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 200, 0, 0, 0, 100]), Buffer.alloc(16)]);
    assert.deepEqual(imageInfo(png), { format: 'png', width: 200, height: 100 });
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8X'), Buffer.alloc(4), Buffer.alloc(4), Buffer.from([0xFF, 0x01, 0x00, 0x7F, 0x00, 0x00]), Buffer.alloc(4)]);
    assert.deepEqual(imageInfo(webp), { format: 'webp', width: 512, height: 128 });
    assert.equal(imageInfo(Buffer.from('not an image at all, truly')), null);
  });
  test('CH-1b over HTTP on localhost: a photograph goes in byte-for-byte, its hash, format, bytes, pixels and timestamp are recorded, and the prepared derivative sits beside it', async () => {
    const ds = scratchDataset({ photos: false });
    const server = createCaptureServer(openManifest(ds.manifest));
    const port = await listen(server);
    try {
      const m0 = await http(port, '/helper/manifest');
      assert.equal(m0.body.status.length, 2);
      assert.deepEqual([m0.body.status[0].primary, m0.body.status[0].confirmed], [false, false]);
      const p = await http(port, '/helper/photo?id=it-ps5&kind=primary', { method: 'POST', body: JPEG });
      assert.equal(p.status, 200);
      assert.deepEqual([p.body.path, p.body.sha256, p.body.format, p.body.bytes, p.body.width, p.body.height], ['photos/it-ps5.jpg', sha(JPEG), 'jpeg', JPEG.length, 1024, 768]);
      assert.ok(Date.parse(p.body.imported_at) > 0);
      assert.ok(readFileSync(join(ds.dir, 'photos/it-ps5.jpg')).equals(JPEG), 'the master is the original, not a recompression');
      const d = await http(port, '/helper/photo?id=it-ps5&kind=prepared', { method: 'POST', body: JPEG2 });
      assert.equal(d.body.path, 'photos/it-ps5.prepared.jpg');
      assert.match(d.body.method, /1280 px, JPEG 0\.82/);
      const after = JSON.parse(readFileSync(ds.manifest, 'utf8')).items[0].photo;
      assert.deepEqual([after.photo_path, after.master.sha256, after.prepared.sha256], ['photos/it-ps5.jpg', sha(JPEG), sha(JPEG2)]);
      const bad = await http(port, '/helper/photo?id=it-ps5&kind=primary', { method: 'POST', body: Buffer.from('this is not a photograph, not at all') });
      assert.equal(bad.status, 415);
      const got = await http(port, '/helper/photo-file?id=it-ps5');
      assert.ok(got.body.equals(JPEG));
    } finally { server.close(); rmSync(ds.dir, { recursive: true, force: true }); }
  });
  test('CH-1c truth: a confirmed value needs a provenance from the list; UNKNOWN (empty) is accepted; the source becomes a confirmation; readiness then passes once a class is set', async () => {
    const ds = scratchDataset();
    const store = openManifest(ds.manifest);
    const server = createCaptureServer(store);
    const port = await listen(server);
    try {
      store.acceptPhoto('it-ps5', 'primary', JPEG);
      const noProv = await http(port, '/helper/truth?id=it-ps5', { method: 'POST', body: JSON.stringify({ identity: { exact_model: 'PlayStation 5 Slim' }, provenance: {} }) });
      assert.equal(noProv.status, 400);
      const ok = await http(port, '/helper/truth?id=it-ps5', { method: 'POST', body: JSON.stringify({ identity: { brand: 'Sony', exact_model: 'PlayStation 5 Slim', model_number: 'CFI-2016', variant: '', color: '' }, provenance: { brand: ['PHYSICAL_LABEL'], exact_model: ['PACKAGING', 'OWNER_KNOWLEDGE'], model_number: ['SERIAL_MODEL_LABEL'] }, condition: 'Good', condition_notes: 'scuff', valuation_ground_truth: { class: 'E' } }) });
      assert.equal(ok.status, 200);
      const it = JSON.parse(readFileSync(ds.manifest, 'utf8')).items[0];
      assert.deepEqual([it.identity.exact_model, it.identity.model_number, it.identity.variant, it.identity.color], ['PlayStation 5 Slim', 'CFI-2016', null, null]);
      assert.deepEqual(it.ground_truth_provenance, { brand: ['PHYSICAL_LABEL'], exact_model: ['PACKAGING', 'OWNER_KNOWLEDGE'], model_number: ['SERIAL_MODEL_LABEL'] });
      assert.match(it.ground_truth_source, /^confirmed by the founder/);
      assert.deepEqual(it.condition, { condition: 'Good', condition_notes: 'scuff' });
      assert.deepEqual([it.valuation_ground_truth.class, it.valuation_ground_truth.status], ['E', 'RECORDED']);
      const r = datasetReadiness(loadManifest(ds.manifest), { readFile: (p) => readFileSync(p) });
      assert.deepEqual(r.items[0].problems, []);
      assert.equal(r.items[0].ready, true);
      const badCond = await http(port, '/helper/truth?id=it-ps5', { method: 'POST', body: JSON.stringify({ identity: {}, condition: 'Mint' }) });
      assert.equal(badCond.status, 400);
      assert.deepEqual([PROVENANCE.length, CONDITIONS.length, CONFIGURATIONS.length], [7, 7, 8]);
    } finally { server.close(); rmSync(ds.dir, { recursive: true, force: true }); }
  });
  test('CH-1d the helper makes no outbound request: no fetch, no http client, no provider host, no engine import; nothing left this process', () => {
    const src = readFileSync(join(REPO, 'scripts/dev/benchmark-capture.mjs'), 'utf8');
    const page = readFileSync(join(REPO, 'scripts/dev/benchmark-capture.html'), 'utf8');
    for (const word of ['fetch(', 'http.request', 'https.request', 'node:https', 'openai', 'api.ebay', 'boi.org', '/api/v2', 'anthropic', '../../api/', 'api/_lib']) assert.ok(!src.includes(word), `server mentions ${word}`);
    for (const word of ['openai', 'api.ebay', 'boi.org', '/api/v2', 'https://', 'anthropic']) assert.ok(!page.includes(word), `page mentions ${word}`);
    assert.ok(/fetch\((path|`\/helper|'\/helper)/.test(page) && !/fetch\(\s*['"`]https?:/.test(page), 'the page fetches only relative helper paths');
    assert.equal(attempted.length, 0);
  });
});

// ── CH-2 NOT IN PRODUCTION ──────────────────────────────────────────────────
describe('CH-2 the helper cannot enter the Production build', () => {
  test('CH-2a it lives under scripts/dev, which no entry point, no Vite config, no api function and no src module references', () => {
    assert.ok(existsSync(join(REPO, 'scripts/dev/benchmark-capture.mjs')) && existsSync(join(REPO, 'scripts/dev/benchmark-capture.html')));
    const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
    // The mutation harness runs this suite in a mirror that holds only api/, src/ and tests/: absent files are not shipped files.
    const roots = ['src', 'api', 'public'].map((d) => join(REPO, d)).filter(existsSync);
    const shipped = [join(REPO, 'index.html'), join(REPO, 'vite.config.js'), join(REPO, 'vercel.json')].filter(existsSync).concat(roots.flatMap(walk));
    assert.ok(shipped.length > 10, 'the shipped tree was found');
    for (const f of shipped) assert.ok(!readFileSync(f, 'utf8').includes('benchmark-capture'), `${f} references the helper`);
    if (existsSync(join(REPO, 'vercel.json'))) assert.equal(JSON.parse(readFileSync(join(REPO, 'vercel.json'), 'utf8')).outputDirectory, 'dist');
  });
  test('CH-2b the last build output (when present) carries no trace of the helper', () => {
    const dist = join(REPO, 'dist');
    if (!existsSync(dist)) return;
    const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
    for (const f of walk(dist).filter((f) => /\.(js|html|css|json)$/.test(f))) {
      const t = readFileSync(f, 'utf8');
      for (const word of ['benchmark-capture', 'helper/manifest', 'PHYSICAL_LABEL', 'gw-benchmark-manifest']) assert.ok(!t.includes(word), `${f} contains ${word}`);
    }
  });
});

// ── CH-3 THE PREFLIGHT SET ──────────────────────────────────────────────────
describe('CH-3 the preflight set is excluded from the benchmark and cannot be mixed into it', () => {
  test('CH-3a five slots, every one tagged, every truth pending; the dry run says excluded and costs 5 identity + 5 search actions', () => {
    const pf = loadManifest(join(REPO, 'tests/fixtures/scan-v2/preflight-5.json'));
    assert.equal(pf.excluded_from_benchmark, true);
    assert.equal(pf.items.length, 5);
    assert.ok(pf.items.every((i) => i.excluded_from_benchmark === true && /^pending/.test(i.ground_truth_source)));
    assert.deepEqual(pf.items.map((i) => i.cohort), ['A', 'A', 'A', 'C', 'D']);
    assert.ok(pf.items.every((i) => !i.photo.present));
    const plan = planRun(pf);
    assert.equal(plan.excluded_from_benchmark, true);
    assert.deepEqual(plan.full_manifest.profile_a_one_search_profile.calls, { identity: 5, followup_identity: 0, search_actions: 5, ebay: 0, fx: 0, other: 0 });
    assert.deepEqual([plan.full_manifest.profile_a_one_search_profile.estimated_cost_usd, plan.full_manifest.profile_a_one_search_profile.maximum_cost_usd, plan.full_manifest.profile_a_one_search_profile.maximum_runtime_s], [0.08, 0.12, 150]);
  });
  test('CH-3b the 44-item manifest holds no excluded item, and a manifest that mixes the two is refused', () => {
    const m = loadManifest();
    assert.equal(m.excluded_from_benchmark, false);
    assert.ok(m.items.every((i) => i.excluded_from_benchmark === false));
    assert.ok(!m.items.some((i) => i.benchmark_id.startsWith('pf-')));
    const ds = scratchDataset({ photos: false });
    try {
      const raw = JSON.parse(readFileSync(ds.manifest, 'utf8'));
      raw.items[1].excluded_from_benchmark = true;
      writeFileSync(ds.manifest, JSON.stringify(raw));
      assert.throws(() => loadManifest(ds.manifest), /excluded_from_benchmark must match/);
    } finally { rmSync(ds.dir, { recursive: true, force: true }); }
  });
});

// ── CH-4 THE FOLLOW-UP PROTOCOL THROUGH THE REAL ENGINE DOOR ────────────────
describe('CH-4 runEngine: the follow-up photograph is sent only when the engine asks; the first result is kept', () => {
  test('CH-4a an obvious item: one identity call; the follow-up never leaves even though it was available', async () => {
    const fetchImpl = mockV2Provider({ identities: [RAW.PS5], results: RESULTS_PS5_VERIFIED });
    const r = await runEngine({ photoBase64: JPEG.toString('base64'), followupPhotoBase64: JPEG2.toString('base64'), env: {}, model: 'test-model', apiKey: 'sk-test-not-a-real-key', fetchImpl });
    const identityCalls = fetchImpl.calls.filter((c) => c.kind === 'identity');
    assert.equal(identityCalls.length, 1);
    assert.ok(!JSON.stringify(identityCalls[0].body).includes(JPEG2.toString('base64')), 'the follow-up image was not sent');
    assert.equal(r.followup, null);
    assert.equal(r.first, r.identify);
    assert.equal(r.identify.sufficiency.decision, 'SEARCH_NOW');
    assert.ok(r.price && r.price.valuation, 'the price step ran');
    assert.ok(chargeOf(r) >= RATE.identity_call_max + RATE.search_action + RATE.search_tokens_max, `conservative charge ${chargeOf(r)}`);
  });
  test('CH-4b an ambiguous item: the first photograph asks, the follow-up is then sent as a second call, and both results survive', async () => {
    const fetchImpl = mockV2Provider({ identities: [RAW.LOGITECH, RAW.LOGITECH_LABEL], results: RESULTS_PS5_VERIFIED });
    const r = await runEngine({ photoBase64: JPEG.toString('base64'), followupPhotoBase64: JPEG2.toString('base64'), env: {}, model: 'test-model', apiKey: 'sk-test-not-a-real-key', fetchImpl });
    const identityCalls = fetchImpl.calls.filter((c) => c.kind === 'identity');
    assert.equal(identityCalls.length, 2);
    assert.ok(JSON.stringify(identityCalls[1].body).includes(JPEG2.toString('base64')), 'the second call carries the follow-up image');
    assert.equal(r.first.sufficiency.decision, 'NEED_FOLLOWUP');
    assert.ok(r.followup && r.identify === r.followup);
    const row = scoreItem({ item: item('x', { cohort: 'B', identity: { brand: 'Logitech', product_family: 'G Pro', exact_model: 'G Pro X Superlight', configuration: 'COMPLETE' }, expected_recognition: { exact_model_expected: false, family_only_acceptable: true, generic_only_acceptable: false, decision: 'NEED_FOLLOWUP', level: 'brand_class' } }), identify: r.identify, first: r.first, price: r.price, timings: r.timings });
    assert.deepEqual([row.followup_requested, row.followup_expected, row.followup_as_expected, row.followup_supplied, row.unnecessary_followup, row.decision_as_expected], [true, true, true, true, false, true]);
    assert.equal(row.first_photo.decision, 'NEED_FOLLOWUP');
    assert.ok(row.followup_result && row.followup_result.decision);
    const obvious = scoreItem({ item: item('y', { identity: { brand: 'Logitech', product_family: 'G Pro', exact_model: 'G Pro X Superlight', configuration: 'COMPLETE' } }), identify: r.identify, first: r.first, price: r.price, timings: r.timings });
    assert.deepEqual([obvious.unnecessary_followup, obvious.followup_as_expected, classifyFailure(obvious)], [true, false, 'UNNECESSARY_FOLLOWUP']);
  });
  test('CH-4c no follow-up photograph on file: the engine asks and the run records the ask, nothing more', async () => {
    const fetchImpl = mockV2Provider({ identities: [RAW.LOGITECH] });
    const r = await runEngine({ photoBase64: JPEG.toString('base64'), env: {}, model: 'test-model', apiKey: 'sk-test-not-a-real-key', fetchImpl });
    assert.deepEqual([fetchImpl.calls.length, r.followup, r.price, r.identify.sufficiency.decision], [1, null, null, 'NEED_FOLLOWUP']);
  });
});

// ── CH-5 THE RUN: CEILING, FAILED ITEMS, BROKEN RUNNER, FREEZE ──────────────
describe('CH-5 the frozen run', () => {
  const gate = (ceiling) => ({ allowed: true, approved: 0.01, ceiling });
  const config = { model: 'test-model', profiles: ['local'], ebay: false, fx: false };
  const engineWith = (fetchImpl) => (args) => runEngine({ ...args, fetchImpl });
  test('CH-5a the ceiling stops the run BEFORE the call that could exceed it; completed items are kept; skipped ones are named', async () => {
    const ds = scratchDataset();
    try {
      const fetchImpl = mockV2Provider({ identities: [RAW.PS5, RAW.PS5], results: RESULTS_PS5_VERIFIED });
      const report = await runLive({ manifest: loadManifest(ds.manifest), env: {}, gate: gate(perItemMaximum(1) + 0.001), outDir: ds.out, model: 'test-model', apiKey: 'k', config, build: 't', engine: engineWith(fetchImpl) });
      assert.deepEqual([report.cost.items_completed, report.cost.stopped_by_ceiling, report.cost.items_skipped, report.cost.valid], [1, true, ['it-logi'], true]);
      assert.ok(report.cost.spent_conservative_usd <= report.cost.ceiling_usd);
      assert.equal(fetchImpl.calls.filter((c) => c.kind === 'identity').length, 1, 'no call was made for the skipped item');
      assert.ok(existsSync(join(ds.out, 'it-ps5.capture.json')) && !existsSync(join(ds.out, 'it-logi.capture.json')));
      assert.ok(existsSync(join(ds.out, 'report.json')) && existsSync(join(ds.out, 'freeze.json')));
      assert.equal(report.counts_toward_benchmark, true);
      assert.equal(report.rows[0].id, 'it-ps5');
      const cap = JSON.parse(readFileSync(join(ds.out, 'it-ps5.capture.json'), 'utf8'));
      assert.deepEqual([cap.input.image_sha256, cap.input.master_sha256, cap.input.preparation], [sha(JPEG), sha(JPEG), 'master_as_is']);
      assert.ok(cap.identity.first_photo && cap.identity.followup_requested === false && cap.identity.followup_supplied === false);
    } finally { rmSync(ds.dir, { recursive: true, force: true }); }
  });
  test('CH-5b a failed item is a row, and the run continues; a thrown runner aborts and marks the run invalid', async () => {
    const ds = scratchDataset();
    try {
      const fetchImpl = mockV2Provider({ identities: [RAW.LOGITECH, RAW.LOGITECH_LABEL], results: RESULTS_PS5_VERIFIED });
      let n = 0;
      const flaky = async (args) => { n += 1; if (n === 1) return { first: { ok: false, identity: null, sufficiency: null, failure: 'timeout', timings: { identity_complete_ms: 12000 } }, identify: { ok: false, identity: null, sufficiency: null, failure: 'timeout', timings: {} }, followup: null, price: null, timings: { identity_ms: 12000, total_ms: 12000 } }; return runEngine({ ...args, fetchImpl }); };
      const report = await runLive({ manifest: loadManifest(ds.manifest), env: {}, gate: gate(10), outDir: ds.out, model: 'test-model', apiKey: 'k', config, build: 't', engine: flaky });
      assert.deepEqual([report.cost.items_completed, report.cost.valid, report.rows[0].photo_failure, report.rows[0].failure, report.rows[1].followup_requested], [2, true, 'timeout', 'PHOTO_PIPELINE', true]);
      const broken = async () => { throw new Error('disk full'); };
      const r2 = await runLive({ manifest: loadManifest(ds.manifest), env: {}, gate: gate(10), outDir: join(ds.dir, 'out2'), model: 'test-model', apiKey: 'k', config, build: 't', engine: broken });
      assert.deepEqual([r2.cost.valid, r2.cost.items_completed, r2.cost.infrastructure_error.item, r2.cost.items_skipped], [false, 0, 'it-ps5', ['it-ps5', 'it-logi']]);
    } finally { rmSync(ds.dir, { recursive: true, force: true }); }
  });
  test('CH-5c the prepared derivative is what goes in when the helper stored one; the master hash travels beside it', async () => {
    const ds = scratchDataset();
    try {
      openManifest(ds.manifest).acceptPhoto('it-ps5', 'prepared', JPEG2);
      const fetchImpl = mockV2Provider({ identities: [RAW.PS5], results: RESULTS_PS5_VERIFIED });
      const seen = [];
      const spy = async (args) => { seen.push(args.photoBase64); return runEngine({ ...args, fetchImpl }); };
      const report = await runLive({ manifest: loadManifest(ds.manifest), env: {}, gate: gate(10), only: ['it-ps5'], outDir: ds.out, model: 'test-model', apiKey: 'k', config, build: 't', engine: spy });
      assert.equal(seen[0], JPEG2.toString('base64'));
      const cap = JSON.parse(readFileSync(join(ds.out, 'it-ps5.capture.json'), 'utf8'));
      assert.deepEqual([cap.input.image_sha256, cap.input.master_sha256, cap.input.preparation], [sha(JPEG2), sha(JPEG), 'pwa_prepared']);
      assert.equal(report.freeze.photo_set.hashes['it-ps5'].prepared, sha(JPEG2));
    } finally { rmSync(ds.dir, { recursive: true, force: true }); }
  });
  test('CH-5d the freeze record: git SHA, manifest hash, photo-set hash, timeouts, model, profiles, provider hosts; no secret', async () => {
    const ds = scratchDataset();
    try {
      const f = await freezeRecord({ manifest: loadManifest(ds.manifest), env: { OPENAI_API_KEY: 'sk-canary-9999', [LIVE_ENV]: 'yes' }, config });
      assert.equal(f.git_sha, spawnSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).stdout.trim());
      assert.equal(f.manifest.sha256, sha(readFileSync(ds.manifest)));
      assert.deepEqual([f.photo_set.items_with_photo, f.photo_set.hashes['it-logi'].followup], [2, sha(JPEG2)]);
      assert.deepEqual([f.configuration.identify_timeout_ms, f.configuration.search_timeout_ms, f.configuration.market_budget_ms, f.configuration.model, f.provider_configuration.search_profiles, f.provider_configuration.provider_hosts], [12000, 20000, 4500, 'test-model', ['local'], ['api.openai.com']]);
      assert.ok(!JSON.stringify(f).includes('sk-canary'), 'no secret in the freeze');
      assert.ok(Array.isArray(f.frozen_paths_dirty) && FROZEN_PATHS.length >= 5);
      assert.match(f.engine_version, /@1\.0\.0\+[0-9a-f]{7}/);
    } finally { rmSync(ds.dir, { recursive: true, force: true }); }
  });
  test('CH-5e the gate: the ceiling defaults to the plan maximum, never below the approval', () => {
    const plan = { runnable: 1, runnable_today: { profile_a_one_search_profile: { estimated_cost_usd: 0.71, maximum_cost_usd: 1.07 } } };
    const g = liveGate({ argv: ['--live', '--approve-usd', '0.71'], env: { [LIVE_ENV]: 'yes' }, plan });
    assert.deepEqual([g.allowed, g.approved, g.ceiling], [true, 0.71, 1.07]);
    assert.equal(liveGate({ argv: ['--live', '--approve-usd', '0.71', '--ceiling-usd', '0.5'], env: { [LIVE_ENV]: 'yes' }, plan }).allowed, false);
    assert.equal(liveGate({ argv: ['--live', '--approve-usd', '0.71', '--ceiling-usd', '2'], env: { [LIVE_ENV]: 'yes' }, plan }).ceiling, 2);
  });
  test('CH-5f readiness notices a photograph that changed after import', () => {
    const ds = scratchDataset();
    try {
      openManifest(ds.manifest).acceptPhoto('it-ps5', 'primary', JPEG);
      writeFileSync(join(ds.dir, 'photos/it-ps5.jpg'), JPEG2);
      const r = datasetReadiness(loadManifest(ds.manifest), { readFile: (p) => readFileSync(p) });
      assert.ok(r.items[0].problems.includes('photograph changed since it was imported'));
    } finally { rmSync(ds.dir, { recursive: true, force: true }); }
  });
  test('CH-5g nothing in this file reached the network', () => { assert.equal(attempted.length, 0); });
});

// ── CH-6 THE PREFLIGHT GATE, THE RESERVATION, AND REPLAY VERIFICATION ───────
import { preflightReadiness, compareReplay, REPLAY_DETERMINISTIC_FIELDS } from '../scripts/market-benchmark-report.mjs';
describe('CH-6 preflight readiness, the per-item reservation under the $0.12 ceiling, and replay verification', () => {
  const PF = join(REPO, 'tests/fixtures/scan-v2/preflight-5.json');
  test('CH-6a the committed preflight set: excluded, five slots, no product prescribed, no benchmark id, not ready until photographed and confirmed', () => {
    const pf = loadManifest(PF);
    const r = preflightReadiness(pf, { readFile: () => { throw new Error('ENOENT'); }, benchmarkIds: loadManifest().items.map((i) => i.benchmark_id) });
    assert.deepEqual([r.manifest_excluded, r.items_total, r.all_excluded, r.benchmark_items_mixed_in, r.ready, r.ready_items], [true, 5, true, [], false, 0]);
    assert.ok(pf.items.every((i) => i.identity.brand === null && i.identity.exact_model === null), 'no slot names a product');
    assert.ok(pf.natural_photo_rule.includes('no label'));
  });
  test('CH-6b a mixed-in benchmark id, a missing provenance, a replaced master: each is named', () => {
    const ds = scratchDataset();
    try {
      const store = openManifest(ds.manifest);
      store.acceptPhoto('it-ps5', 'primary', JPEG);
      store.confirm('it-ps5', { identity: { brand: 'Sony', exact_model: 'PlayStation 5' }, provenance: { brand: ['PHYSICAL_LABEL'], exact_model: ['OWNER_KNOWLEDGE'] }, condition: 'Good' });
      const raw = JSON.parse(readFileSync(ds.manifest, 'utf8'));
      raw.excluded_from_benchmark = true; for (const i of raw.items) i.excluded_from_benchmark = true;
      raw.items[0].identity.product_family = 'PlayStation 5';            // confirmed in the file, but no provenance for it
      raw.items[0].photo.prepared = { ...raw.items[0].photo.master, path: raw.items[0].photo.photo_path }; // the derivative "replaced" the master
      writeFileSync(ds.manifest, JSON.stringify(raw));
      const r = preflightReadiness(loadManifest(ds.manifest), { readFile: (p) => readFileSync(p), benchmarkIds: ['it-logi'] });
      assert.ok(r.items[0].problems.includes('product_family: confirmed without a provenance'));
      assert.ok(r.items[0].problems.includes('the derivative replaced the master'));
      assert.deepEqual(r.benchmark_items_mixed_in, ['it-logi']);
      assert.ok(r.items[1].problems.includes('a benchmark item is mixed into the preflight set'));
      assert.equal(r.ready, false);
    } finally { rmSync(ds.dir, { recursive: true, force: true }); }
  });
  test('CH-6c five items whose every call costs the ceiling rate fit exactly under $0.12; a sixth would not begin; the reservation is checked BEFORE the call', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gw-pf-')); mkdirSync(join(dir, 'photos'));
    try {
      const ids = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
      const m = { format: 'gw-benchmark-manifest/2', name: 'pf', market: 'IL', excluded_from_benchmark: true, items: ids.map((id) => ({ ...item(id), excluded_from_benchmark: true })) };
      writeFileSync(join(dir, 'manifest.json'), JSON.stringify(m));
      for (const id of ids) writeFileSync(join(dir, `photos/${id}.jpg`), JPEG);
      const started = [];
      // One mock per run (its identity queue is consumed in order); every item answers as a PS5 with one billed search action, i.e. the ceiling rate ($0.024).
      const engineFor = () => { const fetchImpl = mockV2Provider({ identities: ids.map(() => RAW.PS5), results: RESULTS_PS5_VERIFIED }); return async (args) => { started.push(args.safetyIdentifier); return runEngine({ ...args, fetchImpl }); }; };
      const five = await runLive({ manifest: loadManifest(join(dir, 'manifest.json')), env: {}, gate: { allowed: true, approved: 0.08, ceiling: 0.12 }, only: ids.slice(0, 5), outDir: join(dir, 'out5'), model: 'test-model', apiKey: 'k', config: { model: 'test-model', profiles: ['local'], ebay: false, fx: false }, build: 't', engine: engineFor() });
      assert.deepEqual([five.cost.items_completed, five.cost.stopped_by_ceiling, five.cost.spent_conservative_usd <= 0.12, five.excluded_from_benchmark, five.counts_toward_benchmark], [5, false, true, true, false]);
      assert.equal(perItemMaximum(1), 0.024);
      const six = await runLive({ manifest: loadManifest(join(dir, 'manifest.json')), env: {}, gate: { allowed: true, approved: 0.08, ceiling: 0.12 }, outDir: join(dir, 'out6'), model: 'test-model', apiKey: 'k', config: { model: 'test-model', profiles: ['local'], ebay: false, fx: false }, build: 't', engine: engineFor() });
      assert.deepEqual([six.cost.items_completed, six.cost.stopped_by_ceiling, six.cost.stopped_before, six.cost.items_skipped, six.cost.reserved_usd], [5, true, 'p6', ['p6'], 0.024]);
      assert.equal(started.length, 10, 'the sixth item never reached the engine');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  test('CH-6d replay verification names every deterministic field that differs, and none when the rows agree', () => {
    const a = { id: 'x', brand_engine: 'Sony', model_engine: 'PS5', decision: 'SEARCH_NOW', raw_results: 10, qualified_exact_comparables: 3, valuation_state: 'VERIFIED_MARKET_VALUE', recommended_ils: 1500, total_latency_ms: 5000 };
    const same = compareReplay([a], [{ ...a, total_latency_ms: 20 }]);
    assert.deepEqual([same.items_compared, same.matching, same.mismatching], [1, 1, []]);
    const diff = compareReplay([a], [{ ...a, recommended_ils: 1400, raw_results: 9 }]);
    assert.deepEqual(diff.mismatching[0].mismatches.map((m) => m.field).sort(), ['raw_results', 'recommended_ils']);
    assert.ok(REPLAY_DETERMINISTIC_FIELDS.includes('qualified_exact_comparables') && !REPLAY_DETERMINISTIC_FIELDS.includes('total_latency_ms'));
  });
});
