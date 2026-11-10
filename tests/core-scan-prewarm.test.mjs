// PW — pre-research for products with demonstrated demand (founder approval 2026-11-08: ≤10 products and ≤$0.30 per UTC
// day, only while OpenAI has credit, with monitoring, alerts and an immediate off switch). Refused without the cron
// secret; ranked by real scans; bounded in code; run through the scan's own price step (no other source of prices).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  demandFrom, planPrewarm, runPrewarm, resolvePrewarmMax, resolvePrewarmUsd, costOf, checkCredit, spentToday, isPaused, alertsFor, dayStart, trialState, PREWARM_TRIAL, PREWARM_TRIAL_USD_HARD_MAX,
  PREWARM_HARD_MAX, PREWARM_USD_HARD_MAX, WORST_RESEARCH_USD, EST_USD_PER_RESEARCH, REFRESH_AFTER_MS, ALERT, RUN_EVENT, CONTROL_EVENT, ALERT_EVENT,
} from '../api/_lib/scan/prewarm.js';
import { createPrewarmHandler, sameSecret } from '../api/prewarm.js';
import { normalizeIdentity } from '../api/_lib/scan/identify.js';
import { classifyOpenAIFailure } from '../api/_lib/openai-recognition.js';
import { summarisePrewarm } from '../src/lib/prewarmMonitor.js';
import { RAW_IDENTITY } from './helpers/core-scan-fakes.mjs';

const NOW = Date.UTC(2026, 10, 9, 3);
const mouse = normalizeIdentity(RAW_IDENTITY);
const blender = normalizeIdentity({ ...RAW_IDENTITY, brand: 'Ninja', product_family: 'Ninja', model: 'BN750', canonical_name: 'ninja bn750', display_name: 'Ninja BN750', item_type: 'blender', category: 'Home' });
const car = normalizeIdentity({ ...RAW_IDENTITY, category: 'Vehicles', market_class: 'vehicle', item_type: 'car', brand: 'Toyota', model: 'Yaris Cross', canonical_name: 'toyota yaris cross' });
const row = (identity, hoursAgo, engine = 'core_scan') => ({ created_at: new Date(NOW - hoursAgo * 3_600_000).toISOString(), ai_raw_response: { engine, identity } });
const SECRET = 's'.repeat(32);
const ENV = { CRON_SECRET: SECRET, PREWARM_MAX_PRODUCTS: '10', PREWARM_DAILY_USD_CAP: '0.30', OPENAI_API_KEY: 'k', SCAN_STATE_SECRET: 'x'.repeat(40) };
const call24k = { usage: { input_tokens: 60_000, output_tokens: 2_000 }, tool_calls: 2 }; // ≈ $0.027, the measured order

describe('PW-1 demand is real scans, ranked, and the limits are in code', () => {
  test('PW-1a grouped by the research they would run, most scanned first; old scans, other engines, no-number markets left out', () => {
    const d = demandFrom([row(blender, 1), row(mouse, 2), row(mouse, 30), row(mouse, 24 * 40), row(car, 3), row(mouse, 4, 'legacy'), { created_at: 'x' }, null], { now: NOW });
    assert.deepEqual(d.map((x) => [x.identity.canonical_name, x.scans]), [[mouse.canonical_name, 2], ['ninja bn750', 1]]);
  });
  test('PW-1b at most 10 products and $0.30 a day, whatever the settings say; unset or nonsense is off', () => {
    assert.deepEqual([PREWARM_HARD_MAX, PREWARM_USD_HARD_MAX], [10, 0.30]);
    assert.equal(planPrewarm(Array(60).fill({ identity: mouse }), { max: 999 }).products.length, 10);
    assert.deepEqual([resolvePrewarmMax({}), resolvePrewarmMax({ PREWARM_MAX_PRODUCTS: '0' }), resolvePrewarmMax({ PREWARM_MAX_PRODUCTS: '5' }), resolvePrewarmMax({ PREWARM_MAX_PRODUCTS: '500' }), resolvePrewarmMax({ PREWARM_MAX_PRODUCTS: 'lots' })], [0, 0, 5, 10, 0]);
    assert.deepEqual([resolvePrewarmUsd({}), resolvePrewarmUsd({ PREWARM_DAILY_USD_CAP: '0.1' }), resolvePrewarmUsd({ PREWARM_DAILY_USD_CAP: '99' }), resolvePrewarmUsd({ PREWARM_DAILY_USD_CAP: 'x' })], [0, 0.1, 0.30, 0]);
    assert.equal(planPrewarm([{ identity: mouse }], { max: 1 }).estimated_usd, EST_USD_PER_RESEARCH);
  });
});

describe('PW-2 the run uses the scan\'s own price step, inside the cap', () => {
  test('PW-2a fresh research is reused, stale research is searched again inline; counts and measured spend come back', async () => {
    const seen = [];
    const price = async (a) => { seen.push(a); return a.identity === mouse ? { status: 'priced', reused: true, call: { ms: 0 } } : { status: 'insufficient_evidence', reused: false, call: { ms: 9000, ...call24k } }; };
    const out = await runPrewarm(planPrewarm(demandFrom([row(blender, 1), row(mouse, 2), row(mouse, 3)], { now: NOW }), { max: 5 }), { price, usdCap: 0.30, model: 'm', apiKey: 'k' });
    assert.deepEqual([out.planned, out.reused, out.researched, out.priced, out.failed, out.skipped, out.stopped], [2, 1, 1, 1, 0, 0, null]);
    assert.equal(out.spent_usd, Math.round(costOf(call24k) * 10000) / 10000);
    assert.deepEqual(seen.map((a) => [a.freshMs, a.swr, a.model]), [[REFRESH_AFTER_MS, false, 'm'], [REFRESH_AFTER_MS, false, 'm']]);
  });
  test('PW-2b no research starts that could take the run past the cap: the worst case is reserved first', async () => {
    let calls = 0;
    const price = async () => { calls += 1; return { status: 'priced', reused: false, call: { ms: 1, usage: { input_tokens: 200_000, output_tokens: 6_000 }, tool_calls: 2 } }; };
    const out = await runPrewarm({ products: Array(10).fill({ identity: mouse }) }, { price, usdCap: 0.30 });
    assert.ok(out.spent_usd <= 0.30, `spent ${out.spent_usd}`);
    assert.equal(out.stopped, 'cap');
    assert.equal(calls + out.skipped, 10);
    assert.ok(costOf({ usage: { input_tokens: 200_000, output_tokens: 6_000 }, tool_calls: 2 }) <= WORST_RESEARCH_USD, 'the reserved worst case covers two full stages');
    calls = 0;
    const none = await runPrewarm({ products: [{ identity: mouse }] }, { price, usdCap: 0 });
    assert.deepEqual([calls, none.skipped], [0, 1]);
    assert.equal(costOf({ ms: 9000 }), WORST_RESEARCH_USD, 'a call that reports no usage is charged the worst case');
  });
  test('PW-2c the off switch is read before every product: a pause stops a run in progress; an unreadable switch stops it too', async () => {
    let n = 0;
    const out = await runPrewarm({ products: Array(5).fill({ identity: mouse }) }, { price: async () => ({ status: 'priced', reused: false, call: { ms: 1, ...call24k } }), usdCap: 0.30, paused: async () => { n += 1; return n > 2; } });
    assert.deepEqual([out.researched, out.skipped, out.stopped], [2, 3, 'paused']);
    const broken = await runPrewarm({ products: [{ identity: mouse }] }, { price: () => assert.fail('no research'), usdCap: 0.30, paused: async () => { throw new Error('db down'); } });
    assert.equal(broken.stopped, 'paused');
  });
});

describe('PW-3 monitoring and alerts', () => {
  test('PW-3a the day\'s spend is the ledger of its runs; the latest control event decides paused', () => {
    assert.equal(spentToday([{ payload: { spent_usd: 0.1, preflight_usd: 0.0001 } }, { payload: { spent_usd: 0.05 } }, { payload: {} }]), 0.1501);
    assert.equal(isPaused([{ created_at: '2026-11-09T01:00:00Z', payload: { enabled: false } }, { created_at: '2026-11-09T02:00:00Z', payload: { enabled: true } }]), false);
    assert.equal(isPaused([{ created_at: '2026-11-09T03:00:00Z', payload: { enabled: false } }, { created_at: '2026-11-09T02:00:00Z', payload: { enabled: true } }]), true);
    assert.equal(isPaused([]), false);
    assert.equal(dayStart(NOW), '2026-11-09T00:00:00.000Z');
  });
  test('PW-3b alerts: half failed, the cap stopped a run, spend over the cap', () => {
    assert.deepEqual(alertsFor({ researched: 1, reused: 0, failed: 1, skipped: 0, spent_today_usd: 0.1 }, { usdCap: 0.3 }).map((a) => a.kind), [ALERT.FAILURES]);
    assert.deepEqual(alertsFor({ researched: 3, failed: 0, skipped: 2, stopped: 'cap', spent_today_usd: 0.25 }, { usdCap: 0.3 }).map((a) => a.kind), [ALERT.CAP]);
    assert.deepEqual(alertsFor({ researched: 3, failed: 0, skipped: 0, spent_today_usd: 0.31 }, { usdCap: 0.3 }).map((a) => a.kind), [ALERT.OVER_CAP]);
    assert.deepEqual(alertsFor({ researched: 3, failed: 0, skipped: 0, spent_today_usd: 0.1 }, { usdCap: 0.3 }), []);
  });
  test('PW-3c an out-of-credit provider has its own failure code (alerted on, never billed)', async () => {
    assert.equal(classifyOpenAIFailure('[OpenAI] API 429: {"error":{"type":"insufficient_quota","code":"credit_balance_exhausted"}}'), 'credit_exhausted');
    assert.equal(classifyOpenAIFailure('[OpenAI] API 429: slow down'), 'rate_limited');
    const exhausted = await checkCredit({ apiKey: 'k', model: 'm', stream: async () => { throw new Error('[OpenAI] API 429: {"error":{"type":"insufficient_quota","code":"credit_balance_exhausted"}}'); } });
    assert.deepEqual([exhausted.ok, exhausted.credit_exhausted, exhausted.status], [false, true, 429]);
    const fine = await checkCredit({ apiKey: 'k', model: 'm', stream: async (req) => { assert.equal(req.body.max_output_tokens, 16); return { usage: { input_tokens: 8, output_tokens: 5 } }; } });
    assert.deepEqual([fine.ok, fine.cost_usd < 0.0001], [true, true]);
    const offline = await checkCredit({ apiKey: 'k', model: 'm', stream: async () => { throw new Error('[OpenAI] network error'); } });
    assert.deepEqual([offline.ok, offline.credit_exhausted], [false, false]);
  });
  test('PW-3d the admin panel adds up today and the week, and shows the switch', () => {
    const at = (h) => new Date(NOW - h * 3_600_000).toISOString();
    const s = summarisePrewarm([
      { event_type: 'core_scan_prewarm', created_at: at(1), payload: { spent_usd: 0.2, preflight_usd: 0.001 } },
      { event_type: 'core_scan_prewarm', created_at: at(30), payload: { spent_usd: 0.25 } },
      { event_type: 'core_scan_prewarm_control', created_at: at(0.5), payload: { enabled: false } },
      { event_type: 'core_scan_alert', created_at: at(1), payload: { kind: ALERT.CREDIT } },
    ], NOW);
    assert.deepEqual([Math.round(s.today_usd * 1000), Math.round(s.week_usd * 1000), s.paused, s.alerts.length, s.runs.length], [201, 451, true, 1, 2]);
  });
});

// ── THE ENDPOINT ────────────────────────────────────────────────────────────
function fakeDb({ events = {}, valuations = [], admin = false } = {}) {
  return () => ({
    from: (t) => {
      const filters = {};
      const q = {
        select: () => q, order: () => q, in: () => q,
        gte: (k, v) => { filters[`${k}>=`] = v; return q; },
        eq: (k, v) => { filters[k] = v; return q; },
        limit: async () => (t === 'valuations' ? { data: valuations, error: null }
          : { data: (events[filters.event_type] ?? []).filter((e) => !filters['created_at>='] || e.created_at >= filters['created_at>=']), error: null }),
        maybeSingle: async () => ({ data: t === 'profiles' ? { is_admin: admin } : null, error: null }),
      };
      return q;
    },
  });
}
// The suites' clock (NOW) sits inside this window; PW-6 tests the real trial dates.
const TEST_TRIAL = { start: '2026-11-01T00:00:00.000Z', end: '2026-12-01T00:00:00.000Z', usd: 3 };
const res = () => ({ headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = JSON.parse(b); } });
async function call({ env = ENV, method = 'GET', auth = `Bearer ${SECRET}`, body, ...deps } = {}) {
  const r = res();
  const logged = [];
  const req = { method, headers: { authorization: auth }, body };
  await createPrewarmHandler({ env, now: () => NOW, logEvent: async (s, type, payload) => { logged.push({ type, payload }); }, credit: async () => ({ ok: true, credit_exhausted: false, status: 200, cost_usd: 0.00001 }), trial: TEST_TRIAL, ...deps })(req, r);
  return { ...r, logged };
}

describe('PW-4 the cron run', () => {
  test('PW-4a no secret configured, a wrong one, or none given: 401 and nothing read', async () => {
    const supa = () => assert.fail('nothing is read');
    assert.equal((await call({ env: { ...ENV, CRON_SECRET: '' }, supa })).statusCode, 401);
    assert.equal((await call({ auth: 'Bearer wrong', supa })).statusCode, 401);
    assert.equal((await call({ auth: '', supa })).statusCode, 401);
    assert.deepEqual([await sameSecret('a', 'a'), await sameSecret('a', 'b')], [true, false]);
  });
  test('PW-4b without BOTH a product limit and a dollar cap: disabled, nothing read, nothing spent', async () => {
    for (const env of [{ ...ENV, PREWARM_MAX_PRODUCTS: '' }, { ...ENV, PREWARM_DAILY_USD_CAP: '' }]) {
      const r = await call({ env, supa: () => assert.fail('nothing is read'), price: () => assert.fail('nothing is spent') });
      assert.deepEqual([r.statusCode, r.body.status], [200, 'disabled']);
    }
  });
  test('PW-4c paused: no credit check, no research, the skip recorded', async () => {
    const r = await call({ supa: fakeDb({ events: { [CONTROL_EVENT]: [{ created_at: '2026-11-08T20:00:00Z', payload: { enabled: false } }] } }), credit: () => assert.fail('no call'), price: () => assert.fail('no research') });
    assert.equal(r.body.status, 'paused');
    assert.equal(r.logged[0].type, RUN_EVENT);
  });
  test('PW-4d out of credit: no research, an alert raised and the run recorded at $0', async () => {
    const r = await call({ supa: fakeDb({ valuations: [row(mouse, 2)] }), credit: async () => ({ ok: false, credit_exhausted: true, status: 429, cost_usd: 0 }), price: () => assert.fail('no research') });
    assert.equal(r.body.status, 'no_credit');
    assert.deepEqual(r.logged.map((e) => [e.type, e.payload.kind ?? e.payload.status]), [[ALERT_EVENT, ALERT.CREDIT], [RUN_EVENT, 'no_credit']]);
  });
  test('PW-4e the day\'s ledger: what earlier runs spent is subtracted; nothing left, nothing runs, and that is alerted', async () => {
    const spent = { [RUN_EVENT]: [{ created_at: '2026-11-09T01:00:00Z', payload: { spent_usd: 0.25 } }] };
    const r = await call({ supa: fakeDb({ events: spent, valuations: [row(mouse, 2)] }), credit: () => assert.fail('no call'), price: () => assert.fail('no research') });
    assert.equal(r.body.status, 'cap_reached');
    assert.ok(r.logged.some((e) => e.type === ALERT_EVENT && e.payload.kind === ALERT.CAP));
  });
  test('PW-4f a run: demand read, research inside what is left of the day, a summary of counts and measured spend', async () => {
    const r = await call({ supa: fakeDb({ valuations: [row(mouse, 2), row(blender, 3)] }), price: async () => ({ status: 'priced', reused: false, call: { ms: 1, ...call24k } }) });
    assert.deepEqual([r.statusCode, r.body.status, r.body.researched, r.body.priced], [200, 'ran', 2, 2]);
    assert.ok(r.body.spent_today_usd <= 0.30);
    const summary = r.logged.find((e) => e.type === RUN_EVENT).payload;
    assert.ok(!JSON.stringify(summary).includes('Logitech'), 'counts only');
  });
});

describe('PW-5 the off switch', () => {
  const admin = (isAdmin) => ({ verify: async (h) => (h === 'Bearer user' ? { id: 'u1' } : null), supa: fakeDb({ admin: isAdmin }) });
  test('PW-5a no session 401; a non-admin 403; nothing recorded', async () => {
    const a = await call({ method: 'POST', auth: 'Bearer nobody', body: { action: 'pause' }, ...admin(true) });
    const b = await call({ method: 'POST', auth: 'Bearer user', body: { action: 'pause' }, ...admin(false) });
    assert.deepEqual([a.statusCode, b.statusCode, a.logged.length + b.logged.length], [401, 403, 0]);
  });
  test('PW-5b an admin pauses and resumes; each is one control event with a non-reversible account reference', async () => {
    const p = await call({ method: 'POST', auth: 'Bearer user', body: { action: 'pause' }, ...admin(true) });
    assert.deepEqual([p.statusCode, p.body.status, p.logged[0].type, p.logged[0].payload.enabled], [200, 'paused', CONTROL_EVENT, false]);
    assert.match(p.logged[0].payload.by, /^[0-9a-f]{16}$/);
    const r = await call({ method: 'POST', auth: 'Bearer user', body: { action: 'resume' }, ...admin(true) });
    assert.deepEqual([r.body.status, r.logged[0].payload.enabled], ['resumed', true]);
    const bad = await call({ method: 'POST', auth: 'Bearer user', body: { action: 'spend' }, ...admin(true) });
    assert.equal(bad.statusCode, 400);
  });
});

describe('PW-6 the 10-day trial: fixed dates, $3 in all, never restarted by a deployment', () => {
  const at = (iso) => Date.parse(iso);
  const run = (iso, usd) => ({ created_at: iso, payload: { spent_usd: usd } });
  test('PW-6a the real trial is 10 days from 2026-11-11 and at most $3, in code', () => {
    assert.deepEqual([PREWARM_TRIAL.start, PREWARM_TRIAL.end, PREWARM_TRIAL.usd, PREWARM_TRIAL_USD_HARD_MAX], ['2026-11-11T00:00:00.000Z', '2026-11-21T00:00:00.000Z', 3, 3]);
    assert.equal((Date.parse(PREWARM_TRIAL.end) - Date.parse(PREWARM_TRIAL.start)) / 864e5, 10);
    assert.ok(Object.isFrozen(PREWARM_TRIAL));
  });
  test('PW-6b before the start and from the end on, closed; inside, open with what is left', () => {
    assert.equal(trialState([], { now: at('2026-11-10T03:00:00Z') }).reason, 'trial_not_started');
    assert.equal(trialState([], { now: at('2026-11-11T03:00:00Z') }).open, true);
    assert.equal(trialState([], { now: at('2026-11-20T03:00:00Z') }).open, true);
    assert.equal(trialState([], { now: at('2026-11-21T00:00:00Z') }).reason, 'trial_ended');
    assert.equal(trialState([], { now: at('2027-03-01T03:00:00Z') }).reason, 'trial_ended');
  });
  test('PW-6c the trial ledger is every run since the start (a redeploy cannot zero it); $3 spent closes it', () => {
    const runs = [run('2026-11-10T03:00:00Z', 9), ...Array.from({ length: 9 }, (_, i) => run(`2026-11-${11 + i}T03:00:00Z`, 0.3))];
    const s = trialState(runs, { now: at('2026-11-20T03:00:00Z') });
    assert.deepEqual([s.open, Math.round(s.spent_usd * 100), Math.round(s.left_usd * 100)], [true, 270, 30], 'spend before the start is not counted');
    const full = trialState([...runs, run('2026-11-19T05:00:00Z', 0.25)], { now: at('2026-11-20T03:00:00Z') });
    assert.equal(full.reason, 'trial_budget_spent');
  });
  test('PW-6d the cron outside the trial: nothing read for demand, no credit call, no research, an alert after it ends', async () => {
    const deps = { supa: fakeDb({ valuations: [row(mouse, 2)] }), credit: () => assert.fail('no call'), price: () => assert.fail('no research') };
    const ended = await call({ ...deps, trial: { ...TEST_TRIAL, end: '2026-11-09T00:00:00.000Z' } });
    assert.equal(ended.body.status, 'trial_ended');
    assert.ok(ended.logged.some((e) => e.type === ALERT_EVENT && e.payload.kind === ALERT.TRIAL_OVER));
    const early = await call({ ...deps, trial: { ...TEST_TRIAL, start: '2026-11-10T00:00:00.000Z' } });
    assert.equal(early.body.status, 'trial_not_started');
  });
  test('PW-6e a run inside the trial is bounded by what the trial has left, even when the day has more', async () => {
    // $2.90 spent on earlier days of the trial: today has its full $0.30, the trial only $0.10 — one research (worst case $0.08 reserved), then stop.
    const spent = { [RUN_EVENT]: [run('2026-11-08T03:00:00Z', 2.90)] };
    const seen = [];
    const r = await call({ supa: fakeDb({ events: spent, valuations: [row(mouse, 2), row(blender, 3)] }), price: async () => { seen.push(1); return { status: 'priced', reused: false, call: { ms: 1, ...call24k } }; } });
    assert.deepEqual([r.body.status, seen.length, r.body.stopped], ['ran', 1, 'cap']);
    assert.ok(r.body.trial_spent_usd <= 3);
    const closed = await call({ supa: fakeDb({ events: { [RUN_EVENT]: [run('2026-11-08T03:00:00Z', 2.95)] }, valuations: [row(mouse, 2)] }), credit: () => assert.fail('no call'), price: () => assert.fail('no research') });
    assert.equal(closed.body.status, 'trial_budget_spent');
  });
  test('PW-6f the admin health check: one few-token call with the deployment key, result recorded, key never returned', async () => {
    const admin = { verify: async (h) => (h === 'Bearer user' ? { id: 'u1' } : null), supa: fakeDb({ admin: true }) };
    let used = null;
    const r = await call({ method: 'POST', auth: 'Bearer user', body: { action: 'health' }, ...admin, env: { ...ENV, OPENAI_API_KEY: 'sk-secret-value' }, credit: async ({ apiKey }) => { used = apiKey; return { ok: true, credit_exhausted: false, status: 200, cost_usd: 0.00001 }; } });
    assert.deepEqual([r.statusCode, r.body.ok, r.body.key_configured, used], [200, true, true, 'sk-secret-value']);
    assert.ok(!JSON.stringify(r.body).includes('sk-secret') && !JSON.stringify(r.logged).includes('sk-secret'));
    assert.equal(r.logged[0].type, 'core_scan_health');
    const no = await call({ method: 'POST', auth: 'Bearer user', body: { action: 'health' }, verify: admin.verify, supa: fakeDb({ admin: false }), credit: () => assert.fail('no call') });
    assert.equal(no.statusCode, 403);
  });
});
