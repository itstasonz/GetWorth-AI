// SM — the scan monitor's arithmetic (src/lib/scanMonitor.js): rows → scans → numbers, nothing invented.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { groupScans, summarise, percentile, accountRefOf } from '../src/lib/scanMonitor.js';
import { accountRef } from '../api/_lib/scan/telemetry.js';

const row = (scan, at, payload) => ({ scan_uuid: scan, created_at: `2026-11-08T10:00:${String(at).padStart(2, '0')}Z`, payload });

describe('SM-1 one status per scan', () => {
  test('SM-1a identify + price + report → priced, durations summed, phone time from the report', () => {
    const [s] = groupScans([
      row('a', 1, { action: 'identify', http: 200, outcome: 'identified', total_ms: 5000, item: 'Mouse', tokens_in: 100, tokens_out: 20, ai_requests: 1, account: 'r1', deployment: { sha: 'abc' } }),
      row('a', 9, { action: 'price', http: 200, outcome: 'priced', priced: true, total_ms: 9000, searches: 8, evidence: 5, evidence_used: 3, ai_requests: 2, hosts: ['zap.co.il'] }),
      row('a', 10, { action: 'report', http: 200, outcome: 'reported', client: { identity_shown_ms: 6000, price_shown_ms: 15500 } }),
    ]);
    assert.equal(s.status, 'priced');
    assert.deepEqual([s.identify_ms, s.price_ms, s.server_ms, s.client_ms], [5000, 9000, 14000, 15500]);
    assert.deepEqual([s.item, s.ai_requests, s.tokens, s.deployment, s.account], ['Mouse', 3, 120, 'abc', 'r1']);
  });
  test('SM-1b no price, refusal, failure, waiting for an answer', () => {
    const scans = groupScans([
      row('n', 1, { action: 'identify', http: 200, outcome: 'identified' }),
      row('n', 2, { action: 'price', http: 200, outcome: 'insufficient_evidence', priced: false, withdrawn: 'no_verified_israeli_second_hand_reference' }),
      row('u', 1, { action: 'identify', http: 503, outcome: 'unavailable', reason: 'disabled_flag' }),
      row('r', 1, { action: 'identify', http: 429, outcome: 'rate_limited', reason: 'user_daily' }),
      row('f', 1, { action: 'identify', http: 200, outcome: 'failed', reason: 'provider_timeout' }),
      row('w', 1, { action: 'identify', http: 200, outcome: 'identified', question: 'storage' }),
      row('t', 1, { action: 'identify', http: 200, outcome: 'identified' }),
      row('t', 2, { action: 'price', http: 400, outcome: 'invalid_token' }),
    ]);
    const by = Object.fromEntries(scans.map((s) => [s.scan_uuid, s]));
    assert.equal(by.n.status, 'no_price');
    assert.equal(by.n.withdrawn, 'no_verified_israeli_second_hand_reference');
    assert.deepEqual([by.u.status, by.u.reason], ['unavailable', 'disabled_flag']);
    assert.equal(by.r.status, 'rate_limited');
    assert.equal(by.f.status, 'failed');
    assert.equal(by.w.status, 'awaiting_answer');
    assert.equal(by.t.status, 'error', 'a rejected price request is not a "no price" result');
  });
});

describe('SM-2 the summary', () => {
  test('SM-2a rates and percentiles only over what was measured', () => {
    const scans = [
      { status: 'priced', server_ms: 10000, client_ms: 12000, tokens: 100 },
      { status: 'no_price', server_ms: 20000, client_ms: null, tokens: 300 },
      { status: 'failed', server_ms: 3000, client_ms: null, tokens: null },
      { status: 'unavailable', server_ms: null, client_ms: null, tokens: null },
    ];
    const s = summarise(scans);
    assert.equal(s.total, 4);
    assert.equal(s.success_rate, 0.5);
    assert.equal(s.failure_rate, 0.25);
    assert.equal(s.evidence_coverage, 0.5);
    assert.deepEqual(s.client_ms, { p50: 12000, p90: 12000, p95: 12000, n: 1 });
    assert.equal(s.server_ms.n, 3);
    assert.equal(s.legacy_fallbacks, 1);
    assert.equal(s.tokens_per_scan, 200);
    assert.equal(s.accuracy, null, 'no confirmed labels, no accuracy figure');
    assert.equal(summarise([]).evidence_coverage, null);
  });
  test('SM-2b nearest-rank percentile', () => {
    assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90), 9);
    assert.equal(percentile([5], 95), 5);
    assert.equal(percentile([], 50), null);
  });
});

test('SM-3 the browser computes the same account reference the server writes', async () => {
  assert.equal(await accountRefOf('750149a6-0000-0000-0000-000000000000'), await accountRef('750149a6-0000-0000-0000-000000000000'));
  assert.equal(await accountRefOf(null), null);
});
