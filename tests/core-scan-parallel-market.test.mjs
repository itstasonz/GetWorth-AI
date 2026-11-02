// ══════════════════════════════════════════════════════════════════════════════
// CORE SCAN — THE WIDER SEARCH RUNS ALONGSIDE THE ISRAELI ONE (config.js SCAN_MARKET_PARALLEL_ENV)
//
// The default since 2026-11-02. The rule of WHICH evidence prices the item is unchanged — the server decides from the
// Israeli evidence whether the wider search counts — only WHEN the wider request starts moves: with the Israeli one,
// so a thin-evidence scan waits for the slower of two searches, not their sum. The sequential suites
// (core-scan-local-market LM-4 and the others) pin CORE_SCAN_MARKET_PARALLEL=false and still hold the old order.
// ══════════════════════════════════════════════════════════════════════════════
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { runPrice, resetMarketCache, SCAN_STATUS } from '../api/_lib/scan/service.js';
import { normalizeIdentity } from '../api/_lib/scan/identify.js';
import { resetFxCache } from '../api/_lib/scan/fx.js';
import { resolveMarketParallel, SCAN_MARKET_PARALLEL_ENV } from '../api/_lib/scan/config.js';
import { RAW_IDENTITY, RAW_MARKET, RAW_EXPAND, NOW, fakeProvider } from './helpers/core-scan-fakes.mjs';

const THIN = { evidence: [RAW_MARKET.evidence[1], RAW_MARKET.evidence[2]] };
const identity = normalizeIdentity(RAW_IDENTITY);

function fakeStore(seed = {}) {
  const rows = new Map(Object.entries(seed));
  return { rows, async load(key) { return rows.get(key) ?? null; }, async save(key, record) { rows.set(key, JSON.parse(JSON.stringify(record))); } };
}

/** The fake provider behind a per-stage delay that honours the request's abort signal, as a real fetch does. */
function delayed(inner, { local = 0, expand = 0 } = {}) {
  const aborted = [];
  const fetchImpl = (url, init = {}) => {
    if (String(url).includes('boi.org.il')) return inner(url, init);
    const text = JSON.parse(init.body).input[0].content[0].text;
    const stage = /SEARCH — LOOK FURTHER/.test(text) ? 'expand' : 'local';
    const ms = stage === 'expand' ? expand : local;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(inner(url, init)), ms);
      init.signal?.addEventListener('abort', () => { clearTimeout(timer); aborted.push(stage); reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); }, { once: true });
    });
  };
  fetchImpl.inner = inner;
  fetchImpl.aborted = aborted;
  return fetchImpl;
}

const run = (fetchImpl, extra = {}) => runPrice({ identity, model: 'm', apiKey: 'k', fetchImpl, store: fakeStore(), scanUuid: '11111111-2222-3333-4444-555555555555', now: () => NOW, ...extra });
const comparable = (r) => ({ status: r.status, prices: r.valuation?.prices ?? null, counts: r.valuation?.counts ?? null, stages: r.call?.stages, withdrawn: r.valuation?.withdrawn ?? null });

describe('PM-1 the wider search starts with the Israeli one; which evidence prices the item does not change', () => {
  beforeEach(() => { resetMarketCache(); resetFxCache(); });

  test('PM-1a on by default; exactly "false" turns it off', () => {
    assert.equal(resolveMarketParallel({}), true);
    assert.equal(resolveMarketParallel({ [SCAN_MARKET_PARALLEL_ENV]: 'false' }), false);
    assert.equal(resolveMarketParallel({ [SCAN_MARKET_PARALLEL_ENV]: 'FALSE ' }), false);
    assert.equal(resolveMarketParallel({ [SCAN_MARKET_PARALLEL_ENV]: '0' }), true);
  });

  test('PM-1b Israel answers: the wider request is cancelled, its evidence never joins, and the price is the sequential one', async () => {
    const seq = await run(fakeProvider({ expand: [RAW_EXPAND] }), { parallel: false });
    resetMarketCache(); resetFxCache();
    const fetchImpl = delayed(fakeProvider({ expand: [RAW_EXPAND] }), { local: 20, expand: 400 });
    const par = await run(fetchImpl, { parallel: true });
    assert.deepEqual(comparable(par), comparable(seq));
    assert.deepEqual([par.status, par.call.stages, par.call.cancelled, par.call.tool_calls], [SCAN_STATUS.PRICED, ['local'], ['expand'], 1]);
    assert.deepEqual(fetchImpl.aborted, ['expand'], 'the wider request was cut, not left running');
    assert.equal(par.valuation.counts.intl_used_exact ?? 0, 0, 'nothing from abroad is in the price');
  });

  test('PM-1c Israel is thin: both searches\' evidence prices the item, exactly as one after the other did', async () => {
    const seq = await run(fakeProvider({ markets: [THIN], expand: [RAW_EXPAND] }), { parallel: false });
    resetMarketCache(); resetFxCache();
    const par = await run(delayed(fakeProvider({ markets: [THIN], expand: [RAW_EXPAND] }), { local: 30, expand: 10 }), { parallel: true });
    assert.deepEqual(comparable(par), comparable(seq));
    assert.deepEqual([par.call.stages, par.call.cancelled, par.valuation.intl_adjusted], [['local', 'expand'], [], true]);
    assert.equal(par.call.usage.input_tokens, seq.call.usage.input_tokens, 'both calls are accounted for');
  });

  test('PM-1d thin Israel: the wait is the slower search, not the sum', async () => {
    const STAGE_MS = 300;
    const t1 = Date.now();
    await run(delayed(fakeProvider({ markets: [THIN], expand: [RAW_EXPAND] }), { local: STAGE_MS, expand: STAGE_MS }), { parallel: false });
    const sequential = Date.now() - t1;
    resetMarketCache(); resetFxCache();
    const t2 = Date.now();
    await run(delayed(fakeProvider({ markets: [THIN], expand: [RAW_EXPAND] }), { local: STAGE_MS, expand: STAGE_MS }), { parallel: true });
    const parallel = Date.now() - t2;
    assert.ok(sequential >= 2 * STAGE_MS, `sequential ${sequential}ms`);
    assert.ok(parallel < 2 * STAGE_MS - 100, `parallel ${parallel}ms against sequential ${sequential}ms`);
  });

  test('PM-1e the Israeli search failing is still a failure: the wider request is cancelled and no number is made up', async () => {
    const fetchImpl = delayed(fakeProvider({ status: 500 }), { local: 10, expand: 400 });
    const r = await run(fetchImpl, { parallel: true });
    assert.deepEqual([r.status, r.failure, r.valuation, r.call.cancelled], [SCAN_STATUS.FAILED, 'upstream_5xx', null, ['expand']]);
  });

  test('PM-1f the wider search failing leaves the Israeli evidence standing', async () => {
    const r = await run(delayed(fakeProvider({ markets: [THIN], expandStatus: 500 }), { local: 20, expand: 5 }), { parallel: true });
    assert.deepEqual([r.status, r.valuation.counts.resale, r.call.stages], [SCAN_STATUS.PRICED, 1, ['local']]);
  });

  test('PM-1g kept Israeli evidence that already prices the item: no wider request is even started', async () => {
    const store = fakeStore();
    await run(fakeProvider(), { store, parallel: false });
    resetMarketCache();
    const later = fakeProvider({ markets: [{ evidence: [] }] });
    const r = await run(later, { store, now: () => NOW + 3 * 3_600_000, parallel: true });
    assert.deepEqual([later.stages(), r.call.cancelled, r.valuation.local_drives], [['local'], [], true]);
  });

  test('PM-1h a thing valued from similar items never asks abroad, in parallel either', async () => {
    const sofa = normalizeIdentity({ ...RAW_IDENTITY, market_class: 'furniture', identity_precision: 'descriptive', brand: null, model: null, model_number: null, exact_model_established: false });
    const fetchImpl = fakeProvider({ markets: [THIN] });
    const r = await runPrice({ identity: sofa, model: 'm', apiKey: 'k', fetchImpl, store: fakeStore(), scanUuid: '11111111-2222-3333-4444-555555555555', now: () => NOW, parallel: true });
    assert.deepEqual([fetchImpl.stages(), r.call.cancelled], [['local'], []]);
  });

  test('PM-1i the exchange rates no longer wait in front of the search', async () => {
    const SLOW = 300;
    const inner = fakeProvider({ markets: [THIN], expand: [RAW_EXPAND] });
    const slowFx = async (url, init) => {
      if (String(url).includes('boi.org.il')) await new Promise((r) => { setTimeout(r, SLOW); });
      return inner(url, init);
    };
    const t0 = Date.now();
    const r = await run(delayed(slowFx, { local: SLOW, expand: SLOW }), { parallel: true });
    const took = Date.now() - t0;
    assert.equal(r.status, SCAN_STATUS.PRICED);
    assert.ok(took < 2 * SLOW - 100, `rates and searches overlapped: ${took}ms`);
    assert.equal(r.valuation.intl_adjusted, true, 'the foreign sale was still converted with the rate');
  });
});
