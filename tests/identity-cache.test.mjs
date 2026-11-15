// IC — THE SAME PHOTOGRAPH, AGAIN (2026-11-15, identity-cache.js): one vision call per photo per account per day on an
// instance; never a correction, never another account, never another language; the quota is charged as for any scan.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createScanHandler } from '../api/scan.js';
import { resetIdentityCache, recallIdentity, rememberIdentity, identityCacheKey } from '../api/_lib/scan/identity-cache.js';
import { normalizeIdentity } from '../api/_lib/scan/identify.js';
import { IMG, RAW_IDENTITY } from './helpers/core-scan-fakes.mjs';

process.env.OPENAI_API_KEY = 'sk-test-not-a-real-key';
process.env.SCAN_STATE_SECRET = 's'.repeat(48);
delete process.env.CORE_SCAN_ENABLED;
const UUID = '11111111-2222-3333-4444-555555555555';
beforeEach(() => resetIdentityCache());

function harness() {
  const log = { identify: 0, charge: 0, events: [] };
  const identity = normalizeIdentity(RAW_IDENTITY);
  const handler = createScanHandler({
    cacheIdentity: true,
    verify: async (h) => ({ 'Bearer a': { id: 'user-a' }, 'Bearer b': { id: 'user-b' } })[h] ?? null,
    charge: async () => { log.charge += 1; return { allowed: true, charged: true, limitType: null, retryAfter: 0 }; },
    refund: async () => {},
    identify: async () => { log.identify += 1; return { status: 'identified', identity, followups: 0, default_condition: null, billed: true, call: { stage: 'identify', model: 'm', ms: 5000, usage: null } }; },
    price: async () => ({ status: 'priced', valuation: { status: 'priced', prices: {}, counts: {} }, call: null }),
    record: async () => 'val-1',
    logEvent: async (scan, type, payload) => { log.events.push({ type, payload }); },
  });
  const call = async (body, auth = 'Bearer a') => {
    const res = await handler(new Request('https://getworth.test/api/scan', { method: 'POST', headers: { 'content-type': 'application/json', authorization: auth }, body: JSON.stringify({ scan_uuid: UUID, lang: 'he', ...body }) }));
    return { status: res.status, payload: await res.json() };
  };
  return { call, log };
}

describe('IC-1 the same photo, again', () => {
  test('IC-1a the second scan of the same photo makes no vision call, answers the same identity, and is charged like any scan', async () => {
    const { call, log } = harness();
    const first = await call({ action: 'identify', images: [IMG] });
    const again = await call({ action: 'identify', images: [IMG] });
    assert.equal(log.identify, 1);
    assert.equal(log.charge, 2, 'the quota is never skipped');
    assert.deepEqual(again.payload.identity, first.payload.identity);
    assert.equal(again.payload.timings.provider_ms, 0);
    assert.equal(log.events.filter((e) => e.payload.action === 'identify').at(-1).payload.identity_cached, true);
  });
  test('IC-1b another account, another photo or another language is identified afresh', async () => {
    const { call, log } = harness();
    await call({ action: 'identify', images: [IMG] });
    await call({ action: 'identify', images: [IMG] }, 'Bearer b');
    await call({ action: 'identify', images: [`${IMG}AAAA`] });
    await call({ action: 'identify', images: [IMG], lang: 'en' });
    assert.equal(log.identify, 4);
  });
  test('IC-1c a correction is never answered from the cache', async () => {
    const { call, log } = harness();
    const first = await call({ action: 'identify', images: [IMG] });
    await call({ action: 'identify', images: [IMG], token: first.payload.token, correction: 'It is a G Pro Wireless' });
    assert.equal(log.identify, 2);
  });
  test('IC-1d a day later it is identified afresh; only identifications are kept; the key never holds the photo', async () => {
    const key = await identityCacheKey('u', 'he', [IMG]);
    assert.match(key, /^[0-9a-f]{64}$/);
    rememberIdentity(key, { status: 'no_item', identity: null }, 0);
    assert.equal(recallIdentity(key, 1), null);
    rememberIdentity(key, { status: 'identified', identity: { display_name: 'x' } }, 0);
    assert.ok(recallIdentity(key, 1000));
    assert.equal(recallIdentity(key, 24 * 3600 * 1000 + 1), null);
  });
});
