// RR — product-level research reuse (2026-11-08): fresh for a day, then stale-while-revalidate within the pool window.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { runPrice, resetMarketCache, researchKey } from '../api/_lib/scan/service.js';
import { resetFxCache } from '../api/_lib/scan/fx.js';
import { normalizeIdentity } from '../api/_lib/scan/identify.js';
import * as CFG from '../api/_lib/scan/config.js';
import { RAW_IDENTITY, fakeProvider, NOW } from './helpers/core-scan-fakes.mjs';

const identity = normalizeIdentity(RAW_IDENTITY);
const HOUR = 3_600_000;
const today = new Date(NOW).toISOString().slice(0, 10);
const listing = (n, price) => ({ url: `https://www.homeless.co.il/yad2/viewad,${n}.aspx`, domain: 'homeless.co.il', title: 'Logitech G Pro X Superlight', price, currency: 'ILS', price_ils: price,
  kind: 'used_listing', match: 'exact', market: 'IL', condition: 'good', page: 'listing', listed: today, binding: 'strong', seen: today });
function store(record = null) {
  const rows = new Map();
  if (record) rows.set(researchKey(identity), record);
  return { rows, saves: 0, load: async (k) => rows.get(k) ?? null, save: async function (k, r) { this.saves += 1; rows.set(k, r); } };
}
const record = (ageMs) => ({ at: NOW - ageMs, evidence: [listing(1, 300), listing(2, 320)], unverified: 0, search_performed: true, searched: { date: today, queries: 3, planned: 3, pages: 5, stages: ['local'] }, fx_date: today });
const price = (s, fetchImpl, extra = {}) => runPrice({ identity, model: 'm', apiKey: 'k', fetchImpl, store: s, scanUuid: '11111111-2222-3333-4444-555555555555', now: () => NOW, marketplace: async () => [], ...extra });

beforeEach(() => { resetMarketCache(); resetFxCache(); });

describe('RR-1 a product\'s research is reused for a day', () => {
  test('RR-1a research from 20 hours ago prices at once, with no search', async () => {
    const fetchImpl = fakeProvider();
    const r = await price(store(record(20 * HOUR)), fetchImpl);
    assert.deepEqual([r.reused, r.stale ?? false, r.refreshing ?? false, r.status], [true, false, false, 'priced']);
    assert.equal(fetchImpl.of('market').length, 0);
    assert.equal(CFG.resolveMarketFreshMs({}), 24 * HOUR);
  });
});

describe('RR-2 older research answers now and is renewed in the background', () => {
  test('RR-2a two-day-old research: an immediate price marked refreshing; one background search stores new research; the next request is fresh', async () => {
    const s = store(record(48 * HOUR));
    const fetchImpl = fakeProvider();
    const jobs = [];
    let refreshed = false;
    const r = await price(s, fetchImpl, { background: (p) => { jobs.push(p.then(() => { refreshed = true; })); } });
    assert.deepEqual([r.reused, r.stale, r.refreshing, r.status], [true, true, true, 'priced']);
    assert.equal(refreshed, false, 'the answer did not wait for the search');
    assert.equal(s.saves, 0);
    assert.equal(r.valuation.searched.at, new Date(NOW - 48 * HOUR).toISOString(), 'the answer says when its prices were checked');
    assert.equal(jobs.length, 1);
    await jobs[0];
    assert.ok(fetchImpl.of('market').length >= 1, 'the background search ran');
    assert.equal(s.saves, 2, "kept under its search and under its product");
    const next = await price(s, fakeProvider(), { background: () => assert.fail('no second refresh') });
    assert.deepEqual([next.reused, next.stale ?? false, next.refreshing ?? false], [true, false, false]);
  });
  test('RR-2b concurrent requests for the same stale product start ONE refresh on this instance', async () => {
    const s = store(record(48 * HOUR));
    const jobs = [];
    const bg = (p) => { jobs.push(p); };
    await Promise.all([price(s, fakeProvider(), { background: bg }), price(s, fakeProvider(), { background: bg })]);
    assert.equal(jobs.length, 1);
    await Promise.all(jobs);
  });
  test('RR-2c a failed background search changes nothing and is never surfaced', async () => {
    const s = store(record(48 * HOUR));
    const jobs = [];
    const r = await price(s, fakeProvider({ status: 503 }), { background: (p) => { jobs.push(p); } });
    assert.equal(r.status, 'priced');
    await jobs[0];
    assert.equal(s.saves, 0);
  });
});

describe('RR-3 when the old path still runs', () => {
  test('RR-3a with stale-while-revalidate off, older research is searched again inline and pooled', async () => {
    const fetchImpl = fakeProvider();
    const r = await price(store(record(48 * HOUR)), fetchImpl, { swr: false });
    assert.equal(r.reused, false);
    assert.ok(fetchImpl.of('market').length >= 1);
  });
  test('RR-3b research older than the pool window is never served: a new search runs', async () => {
    const fetchImpl = fakeProvider();
    const r = await price(store(record(CFG.MARKET_POOL_MS + HOUR)), fetchImpl, { background: () => assert.fail('no background for expired research') });
    assert.equal(r.reused, false);
    assert.ok(fetchImpl.of('market').length >= 1);
  });
});
