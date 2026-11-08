// PW — pre-research for products with demonstrated demand: dormant until a cap is set, refused without the cron
// secret, ranked by real scans, bounded, and run through the scan's own price step (no other source of prices).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { demandFrom, planPrewarm, runPrewarm, resolvePrewarmMax, resolvePrewarmUsd, costOf, PREWARM_HARD_MAX, PREWARM_USD_HARD_MAX, WORST_RESEARCH_USD, EST_USD_PER_RESEARCH, REFRESH_AFTER_MS } from '../api/_lib/scan/prewarm.js';
import { createPrewarmHandler, sameSecret } from '../api/prewarm.js';
import { normalizeIdentity } from '../api/_lib/scan/identify.js';
import { RAW_IDENTITY } from './helpers/core-scan-fakes.mjs';

const NOW = Date.UTC(2026, 10, 8, 12);
const mouse = normalizeIdentity(RAW_IDENTITY);
const blender = normalizeIdentity({ ...RAW_IDENTITY, brand: 'Ninja', product_family: 'Ninja', model: 'BN750', canonical_name: 'ninja bn750', display_name: 'Ninja BN750', item_type: 'blender', category: 'Home' });
const car = normalizeIdentity({ ...RAW_IDENTITY, category: 'Vehicles', market_class: 'vehicle', item_type: 'car', brand: 'Toyota', model: 'Yaris Cross', canonical_name: 'toyota yaris cross' });
const row = (identity, hoursAgo, engine = 'core_scan') => ({ created_at: new Date(NOW - hoursAgo * 3_600_000).toISOString(), ai_raw_response: { engine, identity } });

describe('PW-1 demand is real scans, ranked', () => {
  test('PW-1a grouped by the research they would run, most scanned first; old scans, other engines, no-number markets left out', () => {
    const d = demandFrom([row(blender, 1), row(mouse, 2), row(mouse, 30), row(mouse, 24 * 40), row(car, 3), row(mouse, 4, 'legacy'), { created_at: 'x' }, null], { now: NOW });
    assert.deepEqual(d.map((x) => [x.identity.canonical_name, x.scans]), [[mouse.canonical_name, 2], ['ninja bn750', 1]]);
  });
  test('PW-1b the plan is bounded by the cap and the hard maximum, with its estimate stated', () => {
    const d = demandFrom([row(blender, 1), row(mouse, 2)], { now: NOW });
    assert.deepEqual([planPrewarm(d, { max: 1 }).products.length, planPrewarm(d, { max: 1 }).estimated_usd], [1, EST_USD_PER_RESEARCH]);
    assert.equal(planPrewarm(Array(60).fill(d[0]), { max: 999 }).products.length, PREWARM_HARD_MAX);
    assert.deepEqual([resolvePrewarmMax({}), resolvePrewarmMax({ PREWARM_MAX_PRODUCTS: '0' }), resolvePrewarmMax({ PREWARM_MAX_PRODUCTS: '10' }), resolvePrewarmMax({ PREWARM_MAX_PRODUCTS: '500' }), resolvePrewarmMax({ PREWARM_MAX_PRODUCTS: 'lots' })], [0, 0, 10, PREWARM_HARD_MAX, 0]);
  });
});

describe('PW-2 the run uses the scan\'s own price step', () => {
  test('PW-2a fresh research is reused, stale research is searched again inline; counts only come back', async () => {
    const seen = [];
    const price = async (a) => { seen.push(a); return a.identity === mouse ? { status: 'priced', reused: true } : { status: 'insufficient_evidence', reused: false }; };
    const out = await runPrewarm(planPrewarm(demandFrom([row(blender, 1), row(mouse, 2), row(mouse, 3)], { now: NOW }), { max: 5 }), { price, usdCap: 1, model: 'm', apiKey: 'k' });
    assert.deepEqual(out, { planned: 2, reused: 1, researched: 1, priced: 1, failed: 0, skipped: 0, spent_usd: 0 });
    assert.deepEqual(seen.map((a) => [a.freshMs, a.swr, a.model]), [[REFRESH_AFTER_MS, false, 'm'], [REFRESH_AFTER_MS, false, 'm']]);
  });
  test('PW-2b a failure is counted, and the time budget stops the run', async () => {
    let t = 0;
    const out = await runPrewarm({ products: [{ identity: mouse }, { identity: blender }] }, { price: async () => { t += 1000; throw new Error('x'); }, budgetMs: 500, usdCap: 1, now: () => t });
    assert.deepEqual([out.failed, out.skipped], [1, 1]);
  });
});

describe('PW-4 the dollar cap is enforced from each call\'s own usage', () => {
  test('PW-4a cost is measured at published prices; a call with no usage is charged the worst case', () => {
    // The 2026-11-08 controlled test's iPhone 13 research: 2 search calls, ~65k input and ~2.4k output tokens.
    assert.ok(Math.abs(costOf({ usage: { input_tokens: 65_000, output_tokens: 2_400 }, tool_calls: 0.5 }) - (0.0065 + 0.0012 + 0.005)) < 1e-9);
    assert.equal(costOf({ ms: 9000 }), WORST_RESEARCH_USD);
    assert.equal(costOf(null), 0);
  });
  test('PW-4b no research starts that could take the run past the cap; no cap, nothing runs', async () => {
    let calls = 0;
    const price = async () => { calls += 1; return { status: 'priced', reused: false, call: { usage: { input_tokens: 100_000, output_tokens: 2_000 }, tool_calls: 3 } } };
    const plan = { products: Array(10).fill({ identity: mouse }) };
    const out = await runPrewarm(plan, { price, usdCap: 0.25 });
    assert.ok(out.spent_usd <= 0.25, `spent ${out.spent_usd}`);
    assert.equal(calls + out.skipped, 10);
    assert.ok(calls >= 2 && calls < 10);
    calls = 0;
    const none = await runPrewarm(plan, { price, usdCap: 0 });
    assert.deepEqual([calls, none.skipped], [0, 10]);
    assert.deepEqual([resolvePrewarmUsd({}), resolvePrewarmUsd({ PREWARM_DAILY_USD_CAP: '0.5' }), resolvePrewarmUsd({ PREWARM_DAILY_USD_CAP: '99' }), resolvePrewarmUsd({ PREWARM_DAILY_USD_CAP: 'x' })], [0, 0.5, PREWARM_USD_HARD_MAX, 0]);
  });
});

describe('PW-3 the endpoint is dormant until approved', () => {
  const res = () => { const r = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = JSON.parse(b); } }; return r; };
  const call = async (env, auth, deps = {}) => { const r = res(); await createPrewarmHandler({ env, now: () => NOW, ...deps })({ headers: { authorization: auth } }, r); return r; };
  const SECRET = 's'.repeat(32);
  test('PW-3a no secret configured, a wrong one, or none given: 401 and nothing read', async () => {
    const supa = () => assert.fail('nothing is read');
    assert.equal((await call({}, `Bearer ${SECRET}`, { supa })).statusCode, 401);
    assert.equal((await call({ CRON_SECRET: SECRET }, 'Bearer wrong', { supa })).statusCode, 401);
    assert.equal((await call({ CRON_SECRET: SECRET }, undefined, { supa })).statusCode, 401);
    assert.equal(await sameSecret('a', 'a'), true);
    assert.equal(await sameSecret('a', 'b'), false);
  });
  test('PW-3b with the secret but without BOTH a product limit and a dollar cap: disabled, nothing read, nothing spent', async () => {
    for (const extra of [{}, { PREWARM_MAX_PRODUCTS: '10' }, { PREWARM_DAILY_USD_CAP: '0.5' }]) {
      const r = await call({ CRON_SECRET: SECRET, ...extra }, `Bearer ${SECRET}`, { supa: () => assert.fail('nothing is read'), price: () => assert.fail('nothing is spent') });
      assert.deepEqual([r.statusCode, r.body.status], [200, 'disabled']);
    }
  });
  test('PW-3c with a cap: demand read, the plan run, a summary of counts recorded', async () => {
    const rows = [row(mouse, 2), row(blender, 3)];
    const supa = () => ({ from: (t) => { assert.equal(t, 'valuations'); const q = { select: () => q, gte: () => q, order: () => q, limit: async () => ({ data: rows, error: null }) }; return q; } });
    const events = [];
    const r = await call({ CRON_SECRET: SECRET, PREWARM_MAX_PRODUCTS: '1', PREWARM_DAILY_USD_CAP: '0.5', OPENAI_API_KEY: 'k', SCAN_STATE_SECRET: 'x'.repeat(40) }, `Bearer ${SECRET}`, {
      supa, price: async () => ({ status: 'priced', reused: false }), logEvent: async (s, type, p) => { events.push({ type, p }); },
    });
    assert.deepEqual([r.statusCode, r.body.status, r.body.planned, r.body.researched, r.body.estimated_usd], [200, 'ran', 1, 1, EST_USD_PER_RESEARCH]);
    assert.equal(events[0].type, 'core_scan_prewarm');
    assert.ok(!JSON.stringify(events[0].p).includes('Logitech'), 'counts only');
  });
});
