// ══════════════════════════════════════════════════════════════════════════════
// MARKET DATA LAYER — THE BENCHMARK: DRY-RUN AND REPLAY COST NOTHING; LIVE CANNOT BE ACCIDENTAL
//
//   node --test tests/scan-v2-benchmark.test.mjs
// ══════════════════════════════════════════════════════════════════════════════
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

import { loadManifest, loadCaptures, planRun, liveGate, replayItem, itemMetrics, summarize, LIVE_ENV, MODE, RATE } from '../scripts/market-benchmark.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = join(REPO, 'tests/fixtures/scan-v2/benchmark-44.json');
const CAPTURES = join(REPO, 'tests/fixtures/scan-v2/captures');

// Every test here runs with a global fetch that refuses: a network call is a failure.
let realFetch;
const attempted = [];
before(() => { realFetch = globalThis.fetch; globalThis.fetch = async (url) => { attempted.push(String(url)); throw new Error('network call attempted'); }; });
after(() => { globalThis.fetch = realFetch; });

describe('BM-1 the manifest', () => {
  const m = loadManifest(MANIFEST);
  test('BM-1a 44 items, four per category, eleven categories, every item with the fields the runner reads', () => {
    assert.equal(m.items.length, 44);
    const byCat = {};
    for (const i of m.items) byCat[i.category] = (byCat[i.category] ?? 0) + 1;
    assert.deepEqual(Object.values(byCat), new Array(11).fill(4));
    assert.deepEqual(Object.keys(byCat).sort(), ['audio', 'computer_hardware', 'furniture', 'gaming', 'household', 'perfume', 'phones', 'shoes', 'small_appliances', 'tools', 'watches']);
    for (const i of m.items) {
      assert.ok(i.id && i.label && i.photo && i.expect && i.ground_truth, i.id);
      assert.ok(['SEARCH_NOW', 'NEED_FOLLOWUP'].includes(i.expect.decision), i.id);
      assert.ok(['product', 'brand_class', 'generic', 'candidates'].includes(i.expect.level), i.id);
      assert.deepEqual(Object.keys(i.ground_truth), ['retail_ils', 'used_asking_ils', 'used_url', 'observed_on'], i.id);
    }
    assert.equal(new Set(m.items.map((i) => i.id)).size, 44, 'ids are unique');
    // Ground truth is recorded by a person, later: nothing is pre-filled.
    assert.ok(m.items.every((i) => i.ground_truth.used_asking_ils === null && i.ground_truth.retail_ils === null));
    // The adversarial and configuration cases are in the set.
    assert.ok(m.items.some((i) => i.expect.configuration === 'ACCESSORY_ONLY'));
    assert.ok(m.items.some((i) => i.expect.configuration === 'BOX_ONLY'));
    assert.ok(m.items.some((i) => i.expect.configuration === 'BASE_ONLY'));
    assert.ok(m.items.filter((i) => i.expect.level === 'generic').length >= 4);
    assert.ok(m.items.some((i) => i.expect.must_not_be));
  });
  test('BM-1b photographs are not in the repository yet, and the manifest says so per item', () => {
    assert.ok(m.items.every((i) => i.photo_present === false));
  });
});

describe('BM-2 dry-run: exactly what a live run would call, and no call', () => {
  const m = loadManifest(MANIFEST);
  test('BM-2a with one profile: one identity call per item plus one per follow-up, one search action per item, no eBay, no FX', () => {
    const plan = planRun(m, { profiles: ['local'] });
    assert.equal(plan.mode, MODE.DRY_RUN);
    assert.deepEqual([plan.items, plan.runnable], [44, 0]);
    assert.deepEqual(plan.calls, { identity: 0, search_actions: 0, ebay: 0, fx: 0, other: 0 }, 'nothing runnable today: no photographs');
    const followups = m.items.filter((i) => i.followup_photo).length;
    assert.deepEqual(plan.full_manifest.calls, { identity: 44 + followups, search_actions: 44, ebay: 0, fx: 0, other: 0 });
    assert.equal(plan.full_manifest.estimated_cost.total_usd, Number(((44 + followups) * RATE.identity_call + 44 * (RATE.search_action + RATE.search_tokens)).toFixed(2)));
    assert.equal(plan.full_manifest.max_runtime_s, 44 * 30);
  });
  test('BM-2b with the second profile and eBay on: two search actions and one eBay call per item; cost doubles for search and stays zero for eBay', () => {
    const plan = planRun(m, { profiles: ['local', 'local_used_domains'], ebayEnabled: true, fxEnabled: true });
    assert.deepEqual([plan.full_manifest.calls.search_actions, plan.full_manifest.calls.ebay, plan.full_manifest.calls.fx], [88, 44, 1]);
    assert.equal(plan.full_manifest.estimated_cost.ebay_usd, 0);
    assert.ok(plan.full_manifest.estimated_cost.total_usd < 3, `${plan.full_manifest.estimated_cost.total_usd}`);
    assert.equal(attempted.length, 0, 'the dry run made no network call');
  });
});

describe('BM-3 live cannot happen by accident', () => {
  const m = loadManifest(MANIFEST);
  const plan = planRun(m, { profiles: ['local'] });
  test('BM-3a no --live, no approval, no environment word, or no photograph: each alone refuses', () => {
    assert.equal(liveGate({ argv: [], env: {}, plan }).allowed, false);
    assert.equal(liveGate({ argv: ['--live'], env: { [LIVE_ENV]: 'yes' }, plan }).allowed, false);
    assert.equal(liveGate({ argv: ['--live', '--approve-usd', '5'], env: {}, plan }).allowed, false);
    assert.equal(liveGate({ argv: ['--live', '--approve-usd', '5'], env: { [LIVE_ENV]: 'true' }, plan }).reason, `${LIVE_ENV} must be exactly 'yes'`);
    assert.equal(liveGate({ argv: ['--live', '--approve-usd', '5'], env: { [LIVE_ENV]: 'yes' }, plan }).reason, 'no item has a photograph');
    const runnable = { ...plan, runnable: 44, estimated_cost: { total_usd: 1.5 } };
    assert.equal(liveGate({ argv: ['--live', '--approve-usd', '1'], env: { [LIVE_ENV]: 'yes' }, plan: runnable }).allowed, false, 'approval below the estimate');
    assert.equal(liveGate({ argv: ['--live', '--approve-usd', '1.5'], env: { [LIVE_ENV]: 'yes' }, plan: runnable }).allowed, true);
    assert.equal(attempted.length, 0);
  });
});

describe('BM-4 replay: the whole engine over a persisted capture, with zero network calls', () => {
  test('BM-4a the capture resolves its $ref to the committed witness and replays to the measured witness result', async () => {
    const captures = loadCaptures(CAPTURES);
    assert.ok(captures.has('appl-ninja-tb301'));
    const c = captures.get('appl-ninja-tb301');
    assert.equal(c.format, 'gw-market-capture/1');
    assert.ok(Array.isArray(c.providers[0].raw.output) && c.providers[0].raw.output.length === 3, 'the $ref resolved to the witness output array');
    const item = loadManifest(MANIFEST).items.find((i) => i.id === 'appl-ninja-tb301');
    const before = attempted.length;
    const row = await replayItem(item, c);
    assert.equal(attempted.length, before, 'zero network calls');
    assert.deepEqual([row.brand_correct, row.exact_model_correct, row.configuration_correct, row.market_identity_correct, row.followup_required],
      [true, true, true, true, false]);
    assert.deepEqual([row.retail_anchor_coverage, row.local_used_coverage, row.qualified_exact_comparables, row.valuation_available, row.valuation_tier, row.limitation],
      [2, 0, 0, false, 'INSUFFICIENT_EVIDENCE', 'no_calibrated_resale_factor']);
    assert.deepEqual([row.distinct_sources, row.distinct_providers], [0, 0]);
    assert.equal(row.raw_results, 25);
    const s = summarize([row]);
    assert.deepEqual([s.items_measured, s.retail_anchor_pct, s.defensible_valuation_pct, s.local_used_evidence_pct], [1, 100, 0, 0]);
    assert.equal(summarize([]).identified_correctly_pct, null, 'no row, no number');
  });
  test('BM-4b every metric the order lists is a column of its own', () => {
    const row = itemMetrics({ item: { id: 'x', category: 'c', expect: {}, ground_truth: {} }, identify: null, price: null });
    for (const k of ['recognition_correct', 'brand_correct', 'exact_model_correct', 'configuration_correct', 'followup_required', 'identity_latency_ms', 'market_identity_correct',
      'raw_results', 'normalized_observations', 'duplicate_observations', 'local_used_coverage', 'international_used_coverage', 'retail_anchor_coverage',
      'qualified_exact_comparables', 'distinct_sources', 'distinct_providers', 'valuation_available', 'valuation_tier', 'valuation_confidence',
      'ground_truth_used_ils', 'absolute_error_ils', 'percentage_error', 'identity_latency_ms', 'market_data_latency_ms', 'total_latency_ms']) assert.ok(k in row, k);
  });
});
