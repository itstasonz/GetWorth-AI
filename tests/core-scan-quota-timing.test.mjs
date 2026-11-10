// QT — where the quota check's time goes (scan 16666e44, 2026-11-10: 4,122 ms in a call Postgres runs in <1 ms).
// Real HTTP on a local server, through Node's own fetch and the real Supabase client, so the diagnostics events the
// timing reads are the ones Production emits. The quota DECISION must not change; nothing identifying may be recorded.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createClient } from '@supabase/supabase-js';
import { traced, tracedFetch, summarise } from '../api/_lib/scan/net-timing.js';
import { chargeScan, warmQuota } from '../api/_lib/scan/quota.js';
import { instanceInfo } from '../api/_lib/scan/telemetry.js';
import { createScanHandler } from '../api/scan.js';
import { IMG } from './helpers/core-scan-fakes.mjs';

const IP = '203.0.113.9';
const USER = '6c3f2a10-1111-4222-8333-944455556666';
const KEY = 'test-service-key-not-real-0000';
let server; let base; const seen = [];
let behaviour = { delayMs: 0, upstream: '7', rows: [{ allowed: true, limit_type: null, daily_count: 1, charged: true }] };

before(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, trace: req.headers['x-gw-trace'] ?? null, body });
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/json', 'x-envoy-upstream-service-time': behaviour.upstream, 'x-envoy-attempt-count': '1' });
        res.end(JSON.stringify(req.url.includes('/rpc/') ? behaviour.rows : { count: 1 }));
      }, behaviour.delayMs);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }));

const client = () => createClient(base, KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: tracedFetch } });

describe('QT-1 the trace measures each phase of a real request', () => {
  test('QT-1a a new socket, then a reused one: connect time, idle time, send, headers, end, and the gateway\'s own time', async () => {
    const agentless = client();
    behaviour = { ...behaviour, delayMs: 0, upstream: '7' };
    const first = await traced(() => agentless.from('scan_daily_usage').select('count').eq('user_id', USER).maybeSingle());
    const a = first.timing.measured.attempts[0];
    assert.equal(first.timing.measured.fetch_calls, 1);
    assert.equal(first.timing.measured.attempts.length, 1);
    assert.equal(a.connect, 'new');
    assert.ok(a.connect_ms !== null && a.connect_ms >= 0, 'DNS+TCP(+TLS) measured for a new socket');
    assert.ok(a.fetch_ms <= a.sent_ms && a.sent_ms <= a.headers_ms && a.headers_ms <= a.done_ms && a.done_ms <= first.timing.measured.total_ms, 'monotonic order');
    assert.deepEqual([a.status, a.upstream_ms, a.gateway_attempts, a.error], [200, 7, 1, null]);
    await new Promise((r) => setTimeout(r, 20)); // the socket goes back to the pool after the response ends
    const second = await traced(() => agentless.from('scan_daily_usage').select('count').eq('user_id', USER).maybeSingle());
    const b = second.timing.measured.attempts[0];
    assert.equal(b.connect, 'reused');
    assert.equal(b.connect_ms, null);
    assert.ok(b.socket_idle_ms >= 0, 'how long the reused socket sat idle');
  });
  test('QT-1b a slow backend shows as upstream time; the inferred network share stays small', async () => {
    behaviour = { ...behaviour, delayMs: 250, upstream: '250' };
    const { timing } = await traced(() => client().rpc('check_and_increment_scan_rate', { p_ip: IP, p_user_id: USER }));
    const a = timing.measured.attempts[0];
    assert.ok(a.headers_ms - a.sent_ms >= 240, 'the wait is measured between send and headers');
    assert.equal(a.upstream_ms, 250);
    assert.ok(timing.inferred.attempts[0].network_ms < 120, 'and it is not blamed on the network');
    behaviour = { ...behaviour, delayMs: 0, upstream: '7' };
  });
  test('QT-1c every HTTP request the call makes is an attempt: a retry cannot hide', async () => {
    const db = client();
    const { timing } = await traced(async () => { await db.from('scan_daily_usage').select('count'); return db.from('scan_daily_usage').select('count'); });
    assert.deepEqual([timing.measured.fetch_calls, timing.measured.attempts.length], [2, 2]);
  });
  test('QT-1d a blocked event loop is measured, so it is never mistaken for the network', async () => {
    const { timing } = await traced(async () => { const t = Date.now(); while (Date.now() - t < 120) { /* block */ } return client().from('scan_daily_usage').select('count'); });
    assert.ok(timing.measured.loop_lag_ms >= 100, `loop lag ${timing.measured.loop_lag_ms}`);
  });
  test('QT-1e outside a trace the client sends nothing extra; inside, only a random trace id', async () => {
    seen.length = 0;
    await client().from('scan_daily_usage').select('count');
    assert.equal(seen.at(-1).trace, null);
    await traced(() => client().from('scan_daily_usage').select('count'));
    assert.match(seen.at(-1).trace, /^[0-9a-f]{32}$/);
  });
});

describe('QT-2 the quota decision is unchanged, and the timing carries nothing identifying', () => {
  test('QT-2a allowed and charged, with timing; the RPC and its arguments are exactly as before', async () => {
    seen.length = 0;
    behaviour = { ...behaviour, rows: [{ allowed: true, limit_type: null, daily_count: 3, charged: true }] };
    const q = await chargeScan({ supa: client(), ip: IP, userId: USER });
    assert.deepEqual([q.allowed, q.charged, q.limitType, q.retryAfter], [true, true, null, 0]);
    const call = seen.find((r) => r.url.includes('/rpc/check_and_increment_scan_rate'));
    assert.equal(call.method, 'POST');
    const args = JSON.parse(call.body);
    assert.deepEqual([args.p_ip, args.p_user_id, args.p_ip_limit, args.p_user_limit, args.p_daily_limit], [IP, USER, 5, 5, 50]);
    assert.equal(q.timing.measured.attempts[0].path, '/rest/v1/rpc/check_and_increment_scan_rate');
    assert.deepEqual(Object.keys(q.timing.client), ['created', 'init_ms']);
  });
  test('QT-2b refusals keep their kind and wait (daily, per-minute)', async () => {
    behaviour = { ...behaviour, rows: [{ allowed: false, limit_type: 'user_rate', daily_count: 0, charged: false }] };
    const r = await chargeScan({ supa: client(), ip: IP, userId: USER });
    assert.deepEqual([r.allowed, r.limitType, r.retryAfter, r.charged], [false, 'user_rate', 60, false]);
    behaviour = { ...behaviour, rows: [{ allowed: false, limit_type: 'user_daily', daily_count: 51, charged: false }] };
    const d = await chargeScan({ supa: client(), ip: IP, userId: USER });
    assert.deepEqual([d.allowed, d.limitType, d.charged], [false, 'user_daily', false]);
    behaviour = { ...behaviour, rows: [{ allowed: true, limit_type: null, daily_count: 1, charged: true }] };
  });
  test('QT-2c a timeout still fails closed, and keeps the trace of what had happened by then', async () => {
    behaviour = { ...behaviour, delayMs: 400 };
    const q = await chargeScan({ supa: client(), ip: IP, userId: USER, timeoutMs: 80 });
    assert.deepEqual([q.allowed, q.limitType, q.charged], [false, 'quota_timeout', false]);
    assert.ok(q.timing.measured.total_ms >= 70);
    assert.equal(q.timing.measured.attempts[0].headers_ms, null, 'no answer had arrived');
    assert.ok(q.timing.measured.attempts[0].sent_ms !== null, 'but the request had been sent: the wait was on the other side');
    behaviour = { ...behaviour, delayMs: 0 };
    await new Promise((r) => setTimeout(r, 450));
  });
  test('QT-2d no address, account, key, token or query string in the timing', async () => {
    const q = await chargeScan({ supa: client(), ip: IP, userId: USER });
    const text = JSON.stringify(q.timing);
    for (const secret of [IP, USER, KEY, 'apikey', 'authorization', 'Bearer', '?', 'eq.']) assert.ok(!text.includes(secret), `timing must not contain ${secret}`);
  });
  test('QT-2e no database, or no account: refused as before, never thrown', async () => {
    assert.equal((await chargeScan({ supa: null, ip: IP, userId: USER })).limitType, 'quota_error');
    assert.equal((await chargeScan({ supa: client(), ip: IP, userId: null })).allowed, false);
  });
});

describe('QT-3 the camera warm-up prepares without consuming', () => {
  test('QT-3a one read of the account\'s own row (GET), no RPC, no write; timing handed to the caller', async () => {
    seen.length = 0;
    let got = null;
    const ok = await warmQuota({ supa: client(), userId: `warm-${Date.now()}`, onTiming: (t) => { got = t; } });
    assert.equal(ok, true);
    assert.deepEqual(seen.map((r) => [r.method, r.url.split('?')[0]]), [['GET', '/rest/v1/scan_daily_usage']]);
    assert.ok(got.measured.attempts.length === 1 && got.client);
  });
  test('QT-3b at most once a minute per account; a broken database is "not warmed", never an error', async () => {
    const id = `warm2-${Date.now()}`;
    assert.equal(await warmQuota({ supa: client(), userId: id, now: 1_000 }), true);
    assert.equal(await warmQuota({ supa: client(), userId: id, now: 2_000 }), false);
    const broken = { from: () => { throw new Error('down'); } };
    assert.equal(await warmQuota({ supa: broken, userId: `b-${Date.now()}` }), false);
  });
});

describe('QT-4 the telemetry row carries it', () => {
  test('QT-4a instanceInfo says how long the instance sat idle before this request', () => {
    instanceInfo(1_000_000);
    const i = instanceInfo(1_007_000);
    assert.equal(i.instance_idle_ms, 7_000);
  });
  test('QT-4b the identify row records quota_timing; the warm row records warm_timing', async () => {
    const events = [];
    const timing = { client: { created: false, init_ms: 0.1 }, measured: { total_ms: 4122, attempts: [{ connect: 'reused', upstream_ms: 3 }] }, inferred: {} };
    const handler = createScanHandler({
      verify: async () => ({ id: 'user-1' }),
      charge: async () => ({ allowed: true, charged: true, timing }),
      refund: async () => {},
      warm: async ({ onTiming }) => { onTiming?.({ client: { created: true, init_ms: 2 }, measured: { total_ms: 1900 } }); return true; },
      identify: async () => ({ status: 'failed', failure: 'timeout', billed: true, identity: null, followups: 0, call: { stage: 'identify', model: 'm', ms: 5, usage: null } }),
      logEvent: async (s, type, payload) => { events.push(payload); },
    });
    const saved = { ...process.env };
    Object.assign(process.env, { OPENAI_API_KEY: 'k', SCAN_STATE_SECRET: 'x'.repeat(40) });
    try {
      const req = (body) => new Request('https://getworth.test/api/scan', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer good' }, body: JSON.stringify(body) });
      await handler(req({ action: 'warm', scan_uuid: '11111111-2222-4333-8444-555555555555' }));
      await handler(req({ action: 'identify', scan_uuid: '11111111-2222-4333-8444-555555555556', lang: 'en', images: [IMG] }));
    } finally { for (const k of ['OPENAI_API_KEY', 'SCAN_STATE_SECRET']) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
    const warmRow = events.find((e) => e.action === 'warm');
    const idRow = events.find((e) => e.action === 'identify');
    assert.equal(warmRow.warm_timing.measured.total_ms, 1900);
    assert.equal(idRow.quota_timing.measured.total_ms, 4122);
    assert.ok('instance_idle_ms' in idRow);
  });
});

test('QT-5 summarise labels measured and inferred apart, and caps loop lag when the timer never fired', () => {
  const s = summarise({ t0: 0, attempts: [], fetch_calls: [], lag: null }, 50);
  assert.deepEqual(Object.keys(s), ['measured', 'inferred']);
  assert.deepEqual([s.measured.loop_lag_ms, s.measured.loop_lag_capped], [50, true]);
});
