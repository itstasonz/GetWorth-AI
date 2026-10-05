// ══════════════════════════════════════════════════════════════════════════════
// GW-BENCHMARK-001 — THE BENCHMARK: THE ENGINE NEVER SEES THE TRUTH, NOTHING
// HERE COSTS A CALL, AND LIVE CANNOT HAPPEN BY ACCIDENT
//
//   node --test tests/scan-v2-benchmark.test.mjs
// ══════════════════════════════════════════════════════════════════════════════
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { loadManifest, loadCaptures, planRun, liveGate, liveItem, replayItem, replayEngine, runEngine, buildCapture, LIVE_ENV, MODE, RATE, CAPTURE_FORMAT, MAX_RUNTIME_PER_ITEM_S } from '../scripts/market-benchmark.mjs';
import { scoreItem, classifyFailure, failureOf, buildReport, summarizeCohort, percentiles, datasetReadiness, missesOf, compareRuns, FAILURE, COHORT, GT_CLASS, SCORABLE_GT, SPECIAL_CASE } from '../scripts/market-benchmark-report.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = join(REPO, 'tests/fixtures/scan-v2/benchmark-44.json');
const CAPTURES = join(REPO, 'tests/fixtures/scan-v2/captures');
const CANARY = 'ZQX-CANARY-7731';
const JPEG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(900, 7)]);

// Every test here runs with a global fetch that refuses: a network call is a failure.
let realFetch;
const attempted = [];
before(() => { realFetch = globalThis.fetch; globalThis.fetch = async (url) => { attempted.push(String(url)); throw new Error('network call attempted'); }; });
after(() => { globalThis.fetch = realFetch; });

const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
const fnSource = (src, name) => { const i = src.indexOf(`export async function ${name}(`); assert.ok(i >= 0, name); const ends = [src.indexOf('\n/**', i + 1), src.indexOf('\nexport ', i + 1)].filter((x) => x > 0); return src.slice(i, ends.length ? Math.min(...ends) : undefined); };

/** A manifest item whose every truth field carries the canary. */
const canaryItem = (over = {}) => ({
  benchmark_id: 'leak-probe', cohort: 'A', category: 'audio', subcategory: 'x',
  photo: { photo_path: 'photos/leak-probe.jpg', photo_path_resolved: 'photos/leak-probe.jpg', photo_count: 1, photo_type: 't', photo_notes: CANARY, followup_photo_path: null, followup_photo_path_resolved: null, present: true },
  identity: { brand: CANARY, product_family: CANARY, exact_model: CANARY, model_number: CANARY, variant: CANARY, capacity_size: CANARY, color: CANARY, configuration: 'COMPLETE' },
  condition: { condition: 'Good', condition_notes: CANARY },
  expected_recognition: { exact_model_expected: true, family_only_acceptable: false, generic_only_acceptable: false, decision: 'SEARCH_NOW', level: 'product' },
  market_identity: { canonical_market_name: CANARY, known_aliases: [CANARY], known_model_numbers: [CANARY], candidate_model_numbers_unverified: [CANARY], regional_name: CANARY },
  must_not_be: CANARY, special_case: 'complete_product', ground_truth_source: CANARY,
  valuation_ground_truth: { class: 'B', reference_ils: 777, evidence: [CANARY], methodology: CANARY }, notes: CANARY, ...over,
});

// ── BM-1 THE DATASET ────────────────────────────────────────────────────────
describe('BM-1 the ground-truth manifest', () => {
  const m = loadManifest(MANIFEST);
  test('BM-1a 44 items, four per category, eleven categories, every record complete in structure', () => {
    assert.equal(m.format, 'gw-benchmark-manifest/2');
    assert.equal(m.items.length, 44);
    const byCat = {};
    for (const i of m.items) byCat[i.category] = (byCat[i.category] ?? 0) + 1;
    assert.deepEqual(Object.values(byCat), new Array(11).fill(4));
    assert.equal(new Set(m.items.map((i) => i.benchmark_id)).size, 44, 'ids are unique');
    for (const i of m.items) {
      for (const k of ['benchmark_id', 'cohort', 'category', 'subcategory', 'photo', 'identity', 'condition', 'expected_recognition', 'market_identity', 'special_case', 'ground_truth_source', 'valuation_ground_truth']) assert.ok(k in i, `${i.benchmark_id} ${k}`);
      for (const k of ['photo_path', 'photo_count', 'photo_type', 'photo_notes']) assert.ok(k in i.photo, `${i.benchmark_id} photo.${k}`);
      for (const k of ['brand', 'product_family', 'exact_model', 'model_number', 'variant', 'capacity_size', 'color', 'configuration']) assert.ok(k in i.identity, `${i.benchmark_id} identity.${k}`);
      for (const k of ['canonical_market_name', 'known_aliases', 'known_model_numbers', 'regional_name']) assert.ok(k in i.market_identity, `${i.benchmark_id} market_identity.${k}`);
      assert.ok(Object.values(COHORT).includes(i.cohort), i.benchmark_id);
      assert.ok(SPECIAL_CASE.includes(i.special_case), i.benchmark_id);
      const e = i.expected_recognition;
      assert.equal([e.exact_model_expected, e.family_only_acceptable, e.generic_only_acceptable].filter(Boolean).length, 1, `${i.benchmark_id}: exactly one expected level`);
      assert.ok(['SEARCH_NOW', 'NEED_FOLLOWUP'].includes(e.decision), i.benchmark_id);
    }
  });
  test('BM-1b cohorts: A obvious, B ambiguous, C generic, D configuration/adversarial; D holds every configuration and trap case', () => {
    const by = (c) => m.items.filter((i) => i.cohort === c);
    assert.deepEqual([by('A').length, by('B').length, by('C').length, by('D').length], [28, 4, 5, 7]);
    assert.ok(by('A').every((i) => i.expected_recognition.exact_model_expected && i.identity.configuration === 'COMPLETE' || i.identity.configuration === null));
    assert.ok(by('C').every((i) => i.identity.brand === null && i.expected_recognition.generic_only_acceptable));
    assert.deepEqual(by('D').map((i) => i.special_case).sort(), ['accessory_only', 'base_only', 'box_only', 'box_only', 'multiple_objects', 'sibling_trap', 'sibling_trap']);
    assert.ok(by('D').some((i) => i.identity.configuration === 'ACCESSORY_ONLY') && by('D').some((i) => i.identity.configuration === 'BASE_ONLY') && by('D').some((i) => i.identity.configuration === 'BOX_ONLY'));
    assert.ok(m.items.filter((i) => i.must_not_be).length >= 4);
  });
  test('BM-1c unknown stays unknown: no condition, no colour guessed; no price reference invented; only the witness carries recorded (retail-only) evidence', () => {
    const recorded = m.items.filter((i) => i.valuation_ground_truth.class !== null);
    assert.deepEqual(recorded.map((i) => i.benchmark_id), ['appl-ninja-tb301']);
    assert.equal(recorded[0].valuation_ground_truth.class, 'D');
    assert.equal(recorded[0].valuation_ground_truth.reference_ils, null, 'retail-only never yields a used reference');
    assert.ok(m.items.every((i) => i.valuation_ground_truth.reference_ils === null));
    assert.ok(m.items.filter((i) => i.benchmark_id !== 'appl-ninja-tb301').every((i) => i.condition.condition === null || i.special_case === 'box_only'));
    assert.ok(m.items.filter((i) => i.benchmark_id !== 'appl-ninja-tb301').every((i) => /^pending/.test(i.ground_truth_source)));
    // Model numbers: the only "known" ones are definitional (the model IS the number) or witnessed; the rest are flagged unverified.
    for (const i of m.items) for (const n of i.market_identity.known_model_numbers) assert.ok(i.identity.model_number === n || i.identity.exact_model?.includes(n) || i.benchmark_id === 'appl-ninja-tb301', `${i.benchmark_id}: ${n} is not definitional`);
  });
  test('BM-1d photographs are not in the repository yet, and the manifest says so per item', () => {
    assert.ok(m.items.every((i) => i.photo.present === false));
    assert.ok(m.photo_capture_checklist.length >= 5);
  });
});

// ── BM-2 LEAKAGE ────────────────────────────────────────────────────────────
describe('BM-2 the engine never sees the truth', () => {
  test('BM-2a live path: the engine receives the photograph and the environment only; no ground-truth value reaches it or the capture', async () => {
    const seen = [];
    const engine = async (args) => { seen.push(args); return { identify: { ok: false, identity: null, sufficiency: null, followups_used: 0, timings: { identity_complete_ms: 1 }, failure: 'synthetic' }, followup: null, price: null, timings: { identity_ms: 1, total_ms: 2 } }; };
    const { capture, row } = await liveItem(canaryItem(), { env: { X: '1' }, engine, readFile: () => JPEG, model: 'm', apiKey: 'k', build: 'b', config: { model: 'm' } });
    assert.equal(seen.length, 1);
    assert.deepEqual(Object.keys(seen[0]).sort(), ['apiKey', 'env', 'followupPhotoBase64', 'model', 'photoBase64', 'safetyIdentifier']);
    assert.equal(seen[0].photoBase64, JPEG.toString('base64'));
    assert.ok(!JSON.stringify(seen[0]).includes(CANARY), 'no truth in the engine call');
    assert.ok(!JSON.stringify(capture).includes(CANARY), 'no truth in the capture');
    assert.equal(row.photo_failure, 'synthetic');
    assert.equal(attempted.length, 0);
  });
  test('BM-2b runEngine, wired to a fetch spy: what leaves for the provider carries the photograph and no manifest field', async () => {
    const bodies = [];
    const fetchImpl = async (url, init) => { bodies.push(String(init?.body ?? '')); throw new Error('refused'); };
    const r = await runEngine({ photoBase64: 'AAAA', env: {}, model: 'm', apiKey: 'k', fetchImpl });
    assert.equal(r.identify.ok, false);
    assert.equal(r.price, null);
    assert.ok(bodies.length >= 1 && bodies.every((b) => b.includes('AAAA') && !b.includes(CANARY)));
  });
  test('BM-2c static: the engine door and the replay door read no item, manifest or truth field; the engine modules never mention the benchmark', () => {
    const src = readFileSync(join(REPO, 'scripts/market-benchmark.mjs'), 'utf8');
    for (const name of ['runEngine', 'replayEngine']) {
      const body = fnSource(src, name);
      for (const word of ['item', 'manifest', 'ground_truth', 'market_identity', 'expected', 'truth', 'must_not_be', 'known_', 'reference', 'cohort']) assert.ok(!body.includes(word), `${name} mentions ${word}`);
    }
    assert.equal(replayEngine.length, 1, 'replayEngine takes the capture and nothing else');
    const engineFiles = [...walk(join(REPO, 'api/_lib/v2')), ...walk(join(REPO, 'api/v2'))].filter((f) => f.endsWith('.js'));
    for (const f of engineFiles) {
      const t = readFileSync(f, 'utf8');
      for (const word of ['benchmark-44', 'ground_truth', 'known_aliases', 'known_model_numbers', 'valuation_ground_truth', 'market-benchmark', 'cohort']) assert.ok(!t.includes(word), `${f} mentions ${word}`);
    }
  });
  test('BM-2d the scorer, not the engine, is the only reader of the truth', () => {
    const row = scoreItem({ item: canaryItem(), identify: { ok: true, identity: { brand: { value: CANARY }, model: { value: CANARY }, configuration: 'COMPLETE' }, sufficiency: { decision: 'SEARCH_NOW', level: 'product' } }, price: null, timings: {} });
    assert.deepEqual([row.brand_correct, row.exact_model_correct, row.configuration_correct, row.must_not_be_respected], [true, true, true, false]);
  });
});

// ── BM-3 DRY RUN AND COST ───────────────────────────────────────────────────
describe('BM-3 dry run: the two configurations, the calls, the cost ceiling, and no call', () => {
  const m = loadManifest(MANIFEST);
  test('BM-3a PROFILE A: one search action per item; PROFILE B: two; identity calls plus two follow-ups; eBay and FX off unless enabled', () => {
    const plan = planRun(m);
    assert.equal(plan.mode, MODE.DRY_RUN);
    assert.deepEqual([plan.items, plan.runnable, plan.missing_photos.length], [44, 0, 44]);
    assert.deepEqual(plan.runnable_today.profile_a_one_search_profile.calls, { identity: 0, followup_identity: 0, search_actions: 0, ebay: 0, fx: 0, other: 0 });
    const a = plan.full_manifest.profile_a_one_search_profile;
    const b = plan.full_manifest.profile_b_two_search_profiles;
    assert.deepEqual(a.calls, { identity: 44, followup_identity: 2, search_actions: 44, ebay: 0, fx: 0, other: 0 });
    assert.deepEqual(b.calls, { identity: 44, followup_identity: 2, search_actions: 88, ebay: 0, fx: 0, other: 0 });
    assert.equal(a.estimated_cost_usd, Number((46 * RATE.identity_call + 44 * (RATE.search_action + RATE.search_tokens)).toFixed(2)));
    assert.equal(a.maximum_cost_usd, Number((46 * RATE.identity_call_max + 44 * (RATE.search_action + RATE.search_tokens_max)).toFixed(2)));
    assert.ok(a.maximum_cost_usd > a.estimated_cost_usd && b.estimated_cost_usd > a.estimated_cost_usd && b.maximum_cost_usd < 3);
    assert.equal(a.maximum_runtime_s, 44 * MAX_RUNTIME_PER_ITEM_S);
    assert.equal(plan.first_live_configuration, 'profile_a_one_search_profile');
  });
  test('BM-3b with eBay and FX enabled: one eBay call per item at zero cost, one FX fetch per run; --only narrows the plan', () => {
    const plan = planRun(m, { ebayEnabled: true, fxEnabled: true });
    assert.deepEqual([plan.full_manifest.profile_a_one_search_profile.calls.ebay, plan.full_manifest.profile_a_one_search_profile.calls.fx], [44, 1]);
    assert.equal(plan.full_manifest.profile_b_two_search_profiles.estimated_cost_usd, planRun(m).full_manifest.profile_b_two_search_profiles.estimated_cost_usd, 'eBay and FX add no cost');
    const only = planRun(m, { only: ['appl-ninja-tb301', 'audio-sony-xm5'] });
    assert.deepEqual([only.items, only.full_manifest.profile_a_one_search_profile.calls.search_actions], [2, 2]);
    assert.equal(attempted.length, 0, 'the dry run made no network call');
  });
  test('BM-3c npm test never runs live: no script carries --live or the live environment word', () => {
    const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'));
    for (const [name, cmd] of Object.entries(pkg.scripts)) assert.ok(!cmd.includes('--live') && !cmd.includes(LIVE_ENV), name);
    assert.ok(pkg.scripts.test.includes('tests/scan-v2-benchmark.test.mjs'));
    assert.ok(pkg.scripts['bench:market:readiness'].includes('--readiness'));
  });
});

// ── BM-4 LIVE GATE ──────────────────────────────────────────────────────────
describe('BM-4 live cannot happen by accident', () => {
  const plan = planRun(loadManifest(MANIFEST));
  test('BM-4a no --live, no approval, no environment word, or no photograph: each alone refuses', () => {
    assert.equal(liveGate({ argv: [], env: {}, plan }).allowed, false);
    assert.equal(liveGate({ argv: ['--live'], env: { [LIVE_ENV]: 'yes' }, plan }).allowed, false);
    assert.equal(liveGate({ argv: ['--live', '--approve-usd', '5'], env: {}, plan }).allowed, false);
    assert.equal(liveGate({ argv: ['--live', '--approve-usd', '5'], env: { [LIVE_ENV]: 'true' }, plan }).reason, `${LIVE_ENV} must be exactly 'yes'`);
    assert.equal(liveGate({ argv: ['--live', '--approve-usd', '5'], env: { [LIVE_ENV]: 'yes' }, plan }).reason, 'no item has a photograph');
    const runnable = { ...plan, runnable: 44, runnable_today: { profile_a_one_search_profile: { estimated_cost_usd: 1.5 } } };
    assert.equal(liveGate({ argv: ['--live', '--approve-usd', '1'], env: { [LIVE_ENV]: 'yes' }, plan: runnable }).allowed, false, 'approval below the estimate');
    assert.equal(liveGate({ argv: ['--live', '--approve-usd', '1.5'], env: { [LIVE_ENV]: 'yes' }, plan: runnable }).allowed, true);
    assert.equal(attempted.length, 0);
  });
});

// ── BM-5 REPLAY AND THE CAPTURE FORMAT ──────────────────────────────────────
describe('BM-5 replay: the whole engine over a persisted capture, zero network; capture /2 round-trips', () => {
  const item = () => loadManifest(MANIFEST).items.find((i) => i.benchmark_id === 'appl-ninja-tb301');
  test('BM-5a the /1 capture resolves its $ref and replays to the measured witness result; discovery is the primary failure, calibration the secondary', async () => {
    const captures = loadCaptures(CAPTURES);
    const c = captures.get('appl-ninja-tb301');
    assert.ok(c && Array.isArray(c.providers[0].raw.output) && c.providers[0].raw.output.length === 3);
    const before = attempted.length;
    const row = await replayItem(item(), c);
    assert.equal(attempted.length, before, 'zero network calls');
    assert.deepEqual([row.brand_correct, row.exact_model_correct, row.configuration_correct, row.market_identity_correct, row.unnecessary_followup, row.recognition_correct], [true, true, true, true, false, true]);
    assert.deepEqual([row.raw_results, row.retail_anchor_coverage, row.local_used_coverage, row.qualified_exact_comparables, row.valuation_available, row.valuation_tier, row.limitation], [25, 2, 0, 0, false, 'INSUFFICIENT_EVIDENCE', 'no_calibrated_resale_factor']);
    assert.deepEqual([row.valuation_gt_class, row.reference_ils, row.absolute_error_ils, row.anchor_error_pct], ['D', null, null, 0], 'retail-only truth never scores a used value; the anchor is scored against the retail reference');
    assert.deepEqual(failureOf(row), { primary: 'DISCOVERY_COVERAGE', secondary: 'CALIBRATION' });
    const report = buildReport([row]);
    assert.deepEqual(Object.keys(report), ['items_measured', 'cohorts', 'rows'], 'no single accuracy number');
    assert.deepEqual(Object.keys(report.cohorts), ['A']);
    assert.deepEqual(report.cohorts.A.failures, { DISCOVERY_COVERAGE: 1 });
    assert.deepEqual(missesOf(report.rows), ['appl-ninja-tb301'], 'the second-profile experiment would run on this item');
  });
  test('BM-5b a /2 capture built from the engine result holds every section the order lists, no secret, and replays to the same row', async () => {
    const c1 = loadCaptures(CAPTURES).get('appl-ninja-tb301');
    const result = await replayEngine(c1);
    const cap = buildCapture({ item: { benchmark_id: 'appl-ninja-tb301' }, imageHash: 'a'.repeat(64), build: 'deadbeef', config: { model: 'replay', profiles: ['local'], ebay: false, fx: false }, engine: result, finalResult: { valuation: result.price.valuation } });
    assert.equal(cap.format, CAPTURE_FORMAT);
    for (const k of ['item_id', 'captured_at', 'build', 'input', 'configuration', 'timings', 'identity', 'providers', 'observations', 'dedupe', 'independence', 'qualification', 'valuation', 'final_result', 'fx']) assert.ok(k in cap, k);
    assert.equal(cap.input.image_sha256, 'a'.repeat(64));
    assert.ok(cap.identity.raw && cap.identity.normalized && cap.identity.sufficiency);
    assert.equal(cap.providers.length, 1);
    assert.ok(Array.isArray(cap.providers[0].executed_queries) && cap.providers[0].executed_queries.length >= 1, 'executed queries are recorded');
    assert.ok(cap.providers[0].raw.provenance.results.length >= 25, 'the provider raw is persisted');
    assert.equal(cap.observations.length, 5);
    assert.ok(cap.qualification.entries.length >= 1 && cap.qualification.accounting && cap.qualification.counts, 'every extracted listing is in the capture with its decision');
    assert.ok(cap.qualification.entries.every((e) => 'admitted' in e && 'tier' in e && 'reason' in e), 'every qualification decision is recorded');
    const text = JSON.stringify(cap);
    for (const s of ['OPENAI_API_KEY', 'sk-', 'Bearer ', 'STATE_SECRET']) assert.ok(!text.includes(s), s);
    const dir = mkdtempSync(join(tmpdir(), 'gw-cap-'));
    try {
      writeFileSync(join(dir, 'appl-ninja-tb301.capture.json'), text);
      const c2 = loadCaptures(dir).get('appl-ninja-tb301');
      const r1 = await replayItem(item(), c1);
      const r2 = await replayItem(item(), c2);
      for (const k of ['brand_correct', 'exact_model_correct', 'market_identity_correct', 'raw_results', 'normalized_observations', 'retail_anchor_coverage', 'qualified_exact_comparables', 'valuation_tier', 'limitation']) assert.deepEqual(r2[k], r1[k], k);
    } finally { rmSync(dir, { recursive: true, force: true }); }
    assert.equal(attempted.length, 0);
  });
});

// ── BM-6 SCORING RULES ──────────────────────────────────────────────────────
const id = (brand, model, configuration = 'COMPLETE') => ({ brand: { value: brand }, model: { value: model }, configuration });
const ok = (identity, decision = 'SEARCH_NOW', level = 'product') => ({ ok: true, identity, sufficiency: { decision, level }, timings: { identity_complete_ms: 2000 } });
const priced = (recommended, over = {}) => ({ valuation: { recommended, low: recommended - 10, high: recommended + 10, state: 'VERIFIED_MARKET_VALUE', evidence_state: 'VERIFIED_USED_MARKET', retail_anchor: { shops: 2, median: 600 }, confidence: { pricing: { used_market: 'VERIFIED' } }, limitation: null, ...over.valuation }, evidence: { counts: { admitted: 3, by_tier: { A_LOCAL_USED_EXACT: 3 } }, accounting: { total: 10 }, market: { exact_roots: ['TB301'] } }, market_data: { dedupe: { counts: { normalized_count: 5, duplicate_count: 1 } }, independence: { admitted: { distinct_origin_count: 2, distinct_provider_count: 1 } }, ledger: [{ provider: 'openai_web_search', profile: 'local', status: 'COMPLETED' }], observations: [{ relation: 'EXACT_PRODUCT' }], fx: { status: 'NOT_CONFIGURED' } }, timings: { market_data_ms: 3000, total_ms: 3100 }, calls: { cost_usd: 0.013 }, ...over.rest });
const base = (over = {}) => ({ ...canaryItem(), identity: { brand: 'Sony', product_family: 'WH-1000X', exact_model: 'WH-1000XM5', model_number: 'WH-1000XM5', variant: null, capacity_size: null, color: null, configuration: 'COMPLETE' }, must_not_be: null, market_identity: { known_model_numbers: ['TB301'], known_aliases: [] }, valuation_ground_truth: { class: 'B', reference_ils: 500 }, ...over });

describe('BM-6 scoring: recognition independent of pricing; retail never scores a used value', () => {
  test('BM-6a a correct cohort-A row: every KPI true, the error against a class-B reference, and no failure', () => {
    const row = scoreItem({ item: base(), identify: ok(id('Sony', 'WH-1000XM5')), price: priced(450), timings: { total_ms: 5100, identity_ms: 2000 } });
    assert.deepEqual([row.brand_correct, row.exact_model_correct, row.configuration_correct, row.unnecessary_followup, row.recognition_correct, row.market_identity_correct], [true, true, true, false, true, true]);
    assert.deepEqual([row.absolute_error_ils, row.percentage_error, row.anchor_error_pct, row.within_8s, row.identity_latency_ms], [50, 10, null, true, 2000]);
    assert.equal(classifyFailure(row), null);
  });
  test('BM-6b class D (retail only) and class E never produce an error figure, whatever reference is written beside them', () => {
    for (const cls of ['D', 'E']) {
      const row = scoreItem({ item: base({ valuation_ground_truth: { class: cls, reference_ils: 500, retail_reference_ils: 650 } }), identify: ok(id('Sony', 'WH-1000XM5')), price: priced(450) });
      assert.deepEqual([row.reference_ils, row.absolute_error_ils, row.percentage_error], [null, null, null], cls);
      assert.equal(row.anchor_error_pct, 7.7, 'the retail anchor is scored against the retail reference');
    }
    assert.deepEqual([...SCORABLE_GT].sort(), ['A', 'B', 'C']);
    assert.deepEqual(Object.keys(GT_CLASS), ['A', 'B', 'C', 'D', 'E']);
  });
  test('BM-6c recognition KPIs stand when pricing is absent, and pricing KPIs stand when recognition is wrong', () => {
    const noPrice = scoreItem({ item: base(), identify: ok(id('Sony', 'WH-1000XM5')), price: null });
    assert.deepEqual([noPrice.recognition_correct, noPrice.valuation_available, noPrice.raw_results], [true, false, 0]);
    const wrongId = scoreItem({ item: base(), identify: ok(id('Bose', 'QC45')), price: priced(450) });
    assert.deepEqual([wrongId.brand_correct, wrongId.recognition_correct, wrongId.valuation_available, wrongId.qualified_exact_comparables], [false, false, true, 3]);
  });
  test('BM-6d an unnecessary follow-up on an obvious item is its own KPI; a follow-up on an ambiguous item is right', () => {
    const a = scoreItem({ item: base(), identify: ok(id('Sony', null), 'NEED_FOLLOWUP', 'brand_class'), price: null });
    assert.deepEqual([a.unnecessary_followup, a.recognition_correct, classifyFailure(a)], [true, false, 'UNNECESSARY_FOLLOWUP']);
    const b = scoreItem({ item: base({ cohort: 'B', identity: { brand: 'Seiko', product_family: 'Seiko 5 Sports', exact_model: null, configuration: 'COMPLETE' }, expected_recognition: { exact_model_expected: false, family_only_acceptable: true, generic_only_acceptable: false, decision: 'NEED_FOLLOWUP', level: 'brand_class' } }), identify: ok(id('Seiko', 'Seiko 5 Sports'), 'NEED_FOLLOWUP', 'brand_class'), price: null });
    assert.deepEqual([b.unnecessary_followup, b.model_correct, b.decision_as_expected, b.recognition_correct, classifyFailure(b)], [false, true, true, true, null]);
  });
  test('BM-6e configuration: COMPLETE accepts UNKNOWN; an accessory photographed alone must come back ACCESSORY_ONLY; alternatives count', () => {
    const complete = scoreItem({ item: base(), identify: ok(id('Sony', 'WH-1000XM5', 'UNKNOWN')), price: null });
    assert.equal(complete.configuration_correct, true);
    const caseOnly = base({ cohort: 'D', special_case: 'accessory_only', identity: { ...base().identity, configuration: 'ACCESSORY_ONLY' } });
    const wrong = scoreItem({ item: caseOnly, identify: ok(id('Sony', 'WH-1000XM5', 'COMPLETE')), price: priced(450) });
    assert.deepEqual([wrong.configuration_correct, wrong.recognition_correct, classifyFailure(wrong)], [false, false, 'RECOGNITION_CONFIGURATION']);
    const right = scoreItem({ item: caseOnly, identify: ok(id('Sony', 'WH-1000XM5', 'ACCESSORY_ONLY')), price: null });
    assert.deepEqual([right.configuration_correct, classifyFailure(right)], [true, null], 'cohort D is scored on recognition, never on a price it should not give');
    const alt = scoreItem({ item: base({ identity: { ...base().identity, configuration: 'BOX_ONLY', configuration_alternatives: ['PARTS'] } }), identify: ok(id('Sony', 'WH-1000XM5', 'PARTS')), price: null });
    assert.equal(alt.configuration_correct, true);
  });
  test('BM-6f must_not_be, brand alternatives, and the generic rule', () => {
    const trap = scoreItem({ item: base({ must_not_be: 'PlayStation 5 console' }), identify: ok(id('Sony', 'PlayStation 5 console')), price: null });
    assert.deepEqual([trap.must_not_be_respected, classifyFailure(trap)], [false, 'RECOGNITION_MODEL']);
    const partner = scoreItem({ item: base({ identity: { ...base().identity, brand: 'NVIDIA', brand_alternatives: ['ASUS'], exact_model: 'GeForce RTX 4070' } }), identify: ok(id('ASUS', 'GeForce RTX 4070')), price: null });
    assert.equal(partner.brand_correct, true);
    const generic = base({ cohort: 'C', identity: { brand: null, product_family: 'claw hammer', exact_model: null, configuration: 'COMPLETE' }, must_not_be: 'IKEA', expected_recognition: { exact_model_expected: false, family_only_acceptable: false, generic_only_acceptable: true, decision: 'SEARCH_NOW', level: 'generic' }, market_identity: { known_model_numbers: [], known_aliases: [] }, valuation_ground_truth: { class: 'E' } });
    const humble = scoreItem({ item: generic, identify: ok(id(null, 'claw hammer'), 'SEARCH_NOW', 'generic'), price: null });
    assert.deepEqual([humble.brand_correct, humble.model_correct, humble.recognition_correct, humble.market_identity_correct, classifyFailure(humble)], [true, true, true, null, null]);
    const confident = scoreItem({ item: generic, identify: ok(id('Stanley', 'FatMax hammer'), 'SEARCH_NOW', 'product'), price: null });
    assert.deepEqual([confident.brand_correct, confident.model_correct, classifyFailure(confident)], [false, false, 'RECOGNITION_BRAND']);
  });
});

// ── BM-7 FAILURE TAXONOMY ───────────────────────────────────────────────────
describe('BM-7 one primary failure class per row, from the taxonomy', () => {
  const healthy = () => ({ cohort: 'A', engine_ok: true, brand_correct: true, model_correct: true, must_not_be_respected: null, configuration_correct: true, unnecessary_followup: false, decision: 'SEARCH_NOW', valuation_available: true, provider_failures: 0, provider_timeouts: 0, raw_results: 10, market_identity_correct: true, exact_product_observations: 3, retail_anchor_coverage: 2, normalized_observations: 5, qualified_exact_comparables: 3, local_used_coverage: 3, international_used_coverage: 0, fx_status: 'OK', limitation: null });
  const cases = [
    ['PHOTO_PIPELINE', { engine_ok: false }], ['RECOGNITION_BRAND', { brand_correct: false }], ['RECOGNITION_MODEL', { model_correct: false }], ['RECOGNITION_CONFIGURATION', { configuration_correct: false }],
    ['UNNECESSARY_FOLLOWUP', { unnecessary_followup: true }], ['MARKET_IDENTITY', { valuation_available: false, market_identity_correct: false }],
    ['PROVIDER_FAILURE', { valuation_available: false, provider_failures: 1, raw_results: 0 }], ['TIMEOUT', { valuation_available: false, provider_timeouts: 1, raw_results: 0 }],
    ['DISCOVERY_COVERAGE', { valuation_available: false, raw_results: 0 }], ['NORMALIZATION', { valuation_available: false, normalized_observations: 0 }],
    ['QUALIFICATION', { valuation_available: false, qualified_exact_comparables: 0 }], ['FX', { valuation_available: false, qualified_exact_comparables: 0, local_used_coverage: 0, international_used_coverage: 2, fx_status: 'FAILED' }],
    ['CALIBRATION', { valuation_available: false, qualified_exact_comparables: 0, local_used_coverage: 0, international_used_coverage: 1, limitation: 'no_calibrated_resale_factor' }],
    ['VALUATION', { valuation_available: false, limitation: 'guard_declined_the_market_price' }], ['OTHER', { valuation_available: false }],
  ];
  test('BM-7a every class in the taxonomy is reachable, and a healthy row has none', () => {
    assert.equal(classifyFailure(healthy()), null);
    for (const [expected, over] of cases) assert.equal(classifyFailure({ ...healthy(), ...over }), expected, expected);
    assert.deepEqual([...new Set(cases.map(([c]) => c))].length, FAILURE.length - 1, 'every class but DEDUPLICATION has a direct case');
    assert.ok(FAILURE.includes('DEDUPLICATION'), 'duplicates are visible as a column (duplicate_observations) and classified by a person');
  });
  test('BM-7b recognition classes come before market classes; cohorts C and D are never charged a pricing failure; no price asked, no failure', () => {
    assert.equal(classifyFailure({ ...healthy(), brand_correct: false, raw_results: 0, valuation_available: false }), 'RECOGNITION_BRAND');
    assert.equal(classifyFailure({ ...healthy(), cohort: 'D', valuation_available: false, raw_results: 0 }), null);
    assert.equal(classifyFailure({ ...healthy(), cohort: 'C', valuation_available: false, raw_results: 0 }), null);
    assert.equal(classifyFailure({ ...healthy(), decision: 'NEED_FOLLOWUP', unnecessary_followup: false, valuation_available: false }), null);
    assert.equal(classifyFailure({ ...healthy(), cohort: 'B', valuation_available: false, raw_results: 0 }), 'DISCOVERY_COVERAGE', 'cohort B is priced when it reached SEARCH_NOW');
  });
});

// ── BM-8 THE REPORT ─────────────────────────────────────────────────────────
describe('BM-8 the report: cohort summaries as X/N with median and P95, never one number', () => {
  test('BM-8a percentiles', () => {
    assert.deepEqual(percentiles([5, 1, 3, 2, 4, 6, 7, 8, 9, 10]), { n: 10, median: 5, p95: 10, max: 10 });
    assert.deepEqual(percentiles([]), { n: 0, median: null, p95: null, max: null });
    assert.deepEqual(percentiles([null, 7, undefined]), { n: 1, median: 7, p95: 7, max: 7 });
  });
  test('BM-8b cohort summaries carry recognition, market data, valuation, performance and the failure tally, each as n/of/pct', () => {
    const rows = [
      scoreItem({ item: base(), identify: ok(id('Sony', 'WH-1000XM5')), price: priced(450), timings: { total_ms: 5000 } }),
      scoreItem({ item: base({ benchmark_id: 'b' }), identify: ok(id('Bose', 'WH-1000XM5')), price: priced(450), timings: { total_ms: 9000 } }),
      scoreItem({ item: base({ benchmark_id: 'c', cohort: 'D', special_case: 'box_only', identity: { ...base().identity, configuration: 'BOX_ONLY' }, valuation_ground_truth: { class: 'E' } }), identify: ok(id('Sony', 'WH-1000XM5', 'COMPLETE')), price: null, timings: { total_ms: 3000 } }),
    ];
    const report = buildReport(rows);
    assert.deepEqual(Object.keys(report.cohorts), ['A', 'D']);
    const A = report.cohorts.A;
    assert.deepEqual(A.recognition.brand_correct, { n: 1, of: 2, pct: 50 });
    assert.deepEqual(A.recognition.unnecessary_followup, { n: 0, of: 2, pct: 0 });
    assert.deepEqual(A.valuation.available, { n: 2, of: 2, pct: 100 });
    assert.deepEqual(A.valuation.error_pct, { n: 2, median: 10, p95: 10, max: 10 });
    assert.deepEqual(A.performance.within_8s, { n: 1, of: 2, pct: 50 });
    assert.deepEqual(A.performance.total_latency_ms, { n: 2, median: 5000, p95: 9000, max: 9000 });
    assert.deepEqual(A.failures, { RECOGNITION_BRAND: 1 });
    assert.deepEqual(report.cohorts.D.failures, { RECOGNITION_CONFIGURATION: 1 });
    assert.equal(report.cohorts.D.valuation.scorable_rows, 0);
    assert.ok(!('accuracy' in report) && !('score' in report), 'no headline number');
    assert.deepEqual(summarizeCohort([]).recognition.brand_correct, { n: 0, of: 0, pct: null }, 'no row, no number');
  });
  test('BM-8c experiments: misses are identity-correct, searched, unpriced cohort A/B rows; compareRuns reports the increment item by item', () => {
    const b1 = scoreItem({ item: base(), identify: ok(id('Sony', 'WH-1000XM5')), price: priced(null, { valuation: { recommended: null, state: 'NO_PRICE_EVIDENCE', evidence_state: 'INSUFFICIENT_EVIDENCE' }, rest: { evidence: { counts: { admitted: 0, by_tier: {} }, accounting: { total: 4 }, market: { exact_roots: ['TB301'] } }, timings: { market_data_ms: 3000 }, calls: { cost_usd: 0.013 } } }) });
    const b2 = scoreItem({ item: base({ benchmark_id: 'wrong' }), identify: ok(id('Bose', 'x')), price: null });
    const b3 = scoreItem({ item: base({ benchmark_id: 'd', cohort: 'D' }), identify: ok(id('Sony', 'WH-1000XM5')), price: null });
    assert.deepEqual(missesOf([b1, b2, b3]), ['leak-probe']);
    const v1 = scoreItem({ item: base(), identify: ok(id('Sony', 'WH-1000XM5')), price: priced(450, { rest: { timings: { market_data_ms: 4200 }, calls: { cost_usd: 0.026 } } }) });
    const cmp = compareRuns([b1], [v1]);
    assert.deepEqual([cmp.items, cmp.new_valuations, cmp.totals.new_qualified_exact_comparables, cmp.totals.new_raw_results, cmp.added_cost_usd], [1, 1, 3, 6, 0.013]);
    assert.equal(cmp.per_item[0].added_latency_ms, 1200);
  });
});

// ── BM-9 READINESS ──────────────────────────────────────────────────────────
describe('BM-9 dataset readiness: photographs load, hashes recorded, truth confirmed, class assigned', () => {
  const ready = () => ({ ...canaryItem(), ground_truth_source: 'confirmed by the founder from the item on 2026-10-06', valuation_ground_truth: { class: 'B', reference_ils: 500 } });
  test('BM-9a a complete item with a loading JPEG is ready and hashed; PNG loads; a text file does not', () => {
    const files = { 'photos/leak-probe.jpg': JPEG, 'photos/png.jpg': Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47]), Buffer.alloc(600)]), 'photos/txt.jpg': Buffer.alloc(700, 65) };
    const readFile = (p) => { if (!files[p]) throw new Error('ENOENT'); return files[p]; };
    const r = datasetReadiness({ items: [ready(), { ...ready(), benchmark_id: 'p', photo: { ...ready().photo, photo_path: 'photos/png.jpg', photo_path_resolved: 'photos/png.jpg' } }, { ...ready(), benchmark_id: 't', photo: { ...ready().photo, photo_path: 'photos/txt.jpg', photo_path_resolved: 'photos/txt.jpg' } }] }, { readFile });
    assert.deepEqual([r.items_total, r.ready_items, r.photos_present, r.photos_loading, r.ready], [3, 2, 3, 2, false]);
    assert.equal(r.hashes['leak-probe'].length, 64);
    assert.deepEqual(r.items[2].problems, ['photograph does not load as a JPEG, PNG or WEBP']);
  });
  test('BM-9b each gap alone blocks: missing photograph, pending source, no class, class B without a reference, two expected levels, unknown configuration', () => {
    const probe = (over) => datasetReadiness({ items: [{ ...ready(), ...over }] }, { readFile: () => JPEG }).items[0].problems;
    assert.deepEqual(datasetReadiness({ items: [ready()] }, { readFile: () => null }).items[0].problems, ['photograph missing']);
    assert.deepEqual(probe({ ground_truth_source: 'pending: x' }), ['ground truth not yet confirmed by a person']);
    assert.deepEqual(probe({ valuation_ground_truth: { class: null } }), ['valuation ground-truth class not A-E']);
    assert.deepEqual(probe({ valuation_ground_truth: { class: 'B', reference_ils: null } }), ['class B needs a reference value']);
    assert.deepEqual(probe({ valuation_ground_truth: { class: 'D', reference_ils: null, retail_reference_ils: 600 } }), [], 'retail-only needs no used reference');
    assert.deepEqual(probe({ expected_recognition: { exact_model_expected: true, family_only_acceptable: true, generic_only_acceptable: false } }), ['expected recognition level must name exactly one of exact / family / generic']);
    assert.deepEqual(probe({ identity: { ...ready().identity, configuration: null } }), ['identity.configuration unknown']);
    assert.deepEqual(probe({ identity: { ...ready().identity, brand: null } }), ['identity.brand unknown']);
  });
  test('BM-9c the committed manifest today: 44 items, none ready, every one missing its photograph; the witness lacks only the photograph', () => {
    const r = datasetReadiness(loadManifest(MANIFEST), { readFile: () => { throw new Error('ENOENT'); } });
    assert.deepEqual([r.items_total, r.ready_items, r.photos_present, r.ready], [44, 0, 0, false]);
    assert.ok(r.items.every((i) => i.problems.includes('photograph missing')));
    assert.deepEqual(r.items.find((i) => i.id === 'appl-ninja-tb301').problems, ['photograph missing']);
    assert.equal(r.missing_photos.length, 44);
  });
});
