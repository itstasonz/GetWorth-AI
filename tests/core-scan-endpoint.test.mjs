// ══════════════════════════════════════════════════════════════════════════════
// CORE SCAN — THE ENDPOINT AND THE TWO PROVIDER CALLS
//
// What POST /api/scan refuses and in which order, what each provider request is
// allowed to carry, that market research belongs to the item and is reused
// rather than repeated, and that a provider failure is an honest status rather
// than a thrown error or an invented number.
//
// Every provider call is a fake. No test here spends a credit.
//
//   node --test tests/core-scan-endpoint.test.mjs
// ══════════════════════════════════════════════════════════════════════════════
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createScanHandler, config } from '../api/scan.js';
import { runIdentify, runPrice, resetMarketCache, SCAN_STATUS } from '../api/_lib/scan/service.js';
import { normalizeIdentity } from '../api/_lib/scan/identify.js';
import { resetFxCache } from '../api/_lib/scan/fx.js';
import { buildValuationRow, PRICE_METHOD, loadMarketResearch, saveMarketResearch, marketKeyHash, MARKET_EVENT } from '../api/_lib/scan/persist.js';
import { marketKey, buildValuation } from '../api/_lib/scan/valuation.js';
import * as CFG from '../api/_lib/scan/config.js';
import { IMG, RAW_IDENTITY, RAW_MARKET, GOOD_BAND, SOURCES, fakeProvider } from './helpers/core-scan-fakes.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const KEY = 'sk-test-not-a-real-key';
const UUID = '11111111-2222-3333-4444-555555555555';
const USER = { id: 'user-1' };

process.env.OPENAI_API_KEY = KEY;
process.env.SCAN_STATE_SECRET = 's'.repeat(48);
delete process.env.CORE_SCAN_ENABLED;

beforeEach(() => { resetMarketCache(); resetFxCache(); });

// ── THE TWO PROVIDER CALLS ──────────────────────────────────────────────────
describe('CE-1 step 1 is ONE vision call that cannot search', () => {
  test('CE-1a the photograph itself is sent, structured output is strict, nothing is stored', async () => {
    const fetchImpl = fakeProvider();
    const r = await runIdentify({ images: [IMG, IMG], lang: 'he', model: 'm-vision', apiKey: KEY, safetyIdentifier: 'gw-x', fetchImpl });
    assert.equal(r.status, SCAN_STATUS.IDENTIFIED);
    assert.equal(fetchImpl.calls.length, 1);
    const { body, url, headers } = fetchImpl.calls[0];
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(headers.authorization, `Bearer ${KEY}`);
    assert.equal(body.model, 'm-vision');
    const content = body.input[0].content;
    assert.equal(content.filter((c) => c.type === 'input_image').length, 2);
    assert.match(content[0].image_url, /^data:image\/jpeg;base64,/);
    assert.equal(body.tools, undefined, 'the identity call has no tool');
    assert.equal(body.store, false);
    assert.equal(body.text.format.type, 'json_schema');
    assert.equal(body.text.format.strict, true);
    assert.equal(body.stream, true);
    assert.equal(r.identity.display_name, 'Logitech G Pro X Superlight');
    assert.equal(r.default_condition, 'good');
    assert.equal(r.billed, true);
  });
  test('CE-1b a question counts against the scan\'s allowance, and a used-up allowance asks nothing', async () => {
    const asking = { ...RAW_IDENTITY, followup: { kind: 'choice', affects: 'price', question: 'Storage?', options: ['128 GB', '256 GB'] } };
    const first = await runIdentify({ images: [IMG], model: 'm', apiKey: KEY, fetchImpl: fakeProvider({ identities: [asking] }) });
    assert.equal(first.identity.followup.kind, 'choice');
    assert.equal(first.followups, 1);
    const spent = await runIdentify({ images: [IMG], model: 'm', apiKey: KEY, fetchImpl: fakeProvider({ identities: [asking] }), prior: { identity: first.identity, followups: CFG.MAX_FOLLOWUPS } });
    assert.equal(spent.identity.followup.kind, 'none');
  });
  test('CE-1c a correction is the owner\'s word, kept with the identity', async () => {
    const fetchImpl = fakeProvider();
    const r = await runIdentify({ images: [IMG], model: 'm', apiKey: KEY, fetchImpl, correction: 'Actually this is a Logitech G Pro Wireless', prior: { identity: normalizeIdentity(RAW_IDENTITY), followups: 0 } });
    assert.equal(r.identity.owner_stated, true);
    assert.equal(r.identity.owner_correction, 'Actually this is a Logitech G Pro Wireless');
    assert.match(fetchImpl.calls[0].body.input[0].content.at(-1).text, /OWNER_CORRECTION/);
  });
  test('CE-1d a provider refusal is a status with a reason, and is known not to have been billed', async () => {
    const r = await runIdentify({ images: [IMG], model: 'm', apiKey: KEY, fetchImpl: fakeProvider({ status: 500 }) });
    assert.equal(r.status, SCAN_STATUS.FAILED);
    assert.equal(r.failure, 'upstream_5xx');
    assert.equal(r.billed, false);
    assert.equal(r.identity, null);
  });
  test('CE-1e a photograph with nothing to sell is its own status', async () => {
    const r = await runIdentify({ images: [IMG], model: 'm', apiKey: KEY, fetchImpl: fakeProvider({ identities: [{ ...RAW_IDENTITY, is_sellable_item: false }] }) });
    assert.equal(r.status, SCAN_STATUS.NO_ITEM);
  });
});

/** An in-memory stand-in for the shared store, shaped like persist.js's two functions. */
function fakeStore(seed = {}) {
  const rows = new Map(Object.entries(seed));
  return { rows, loads: 0, saves: 0, async load(key) { this.loads += 1; return rows.get(key) ?? null; }, async save(key, record) { this.saves += 1; rows.set(key, JSON.parse(JSON.stringify(record))); } };
}
const band = (b) => ({ list: b.list, low: b.low, high: b.high });

describe('CE-2 step 2: the model finds evidence, the server prices it', () => {
  const identity = normalizeIdentity(RAW_IDENTITY);
  const price = (fetchImpl, extra = {}) => runPrice({ identity, model: 'm-market', apiKey: KEY, fetchImpl, store: fakeStore(), scanUuid: UUID, ...extra });
  test('CE-2a ONE call: the hosted web_search tool, located in Israel, required, asked for its own record; no photograph, and no field for a price', async () => {
    const fetchImpl = fakeProvider();
    const r = await price(fetchImpl);
    assert.equal(r.status, SCAN_STATUS.PRICED);
    assert.equal(fetchImpl.of('market').length, 1);
    const { body } = fetchImpl.of('market')[0];
    assert.equal(body.model, 'm-market');
    assert.deepEqual(body.tools.map((t) => t.type), ['web_search']);
    assert.equal(body.tools[0].user_location.country, 'IL');
    assert.equal(body.tool_choice, 'required');
    assert.ok(body.include.includes('web_search_call.action.sources'));
    assert.equal(body.max_tool_calls, CFG.MARKET_MAX_TOOL_CALLS);
    assert.equal(body.store, false);
    assert.equal(body.text.format.strict, true);
    assert.deepEqual(Object.keys(body.text.format.schema.properties), ['evidence'], 'the model cannot return a valuation');
    assert.equal(body.input[0].content.some((c) => c.type === 'input_image'), false, 'the photograph is not sent again');
    assert.deepEqual(band(r.valuation.prices.good), GOOD_BAND, 'the price is the server\'s arithmetic on the evidence');
    assert.equal(r.valuation.price_confidence, 'medium');
    assert.deepEqual([r.reused, r.call.tool_calls], [false, 1]);
  });
  test('CE-2b an answer with no search behind it is not a price', async () => {
    const r = await price(fakeProvider({ searched: false }));
    assert.deepEqual([r.status, r.valuation.withdrawn, r.valuation.prices], [SCAN_STATUS.INSUFFICIENT, 'no_search_recorded', null]);
  });
  test('CE-2c pages the model names but the search never reached do not make a price', async () => {
    const r = await price(fakeProvider({ reached: [SOURCES.IL_RETAIL] }));
    assert.deepEqual([r.status, r.valuation.withdrawn, r.valuation.retail_new_ils, r.valuation.counts.unverified], [SCAN_STATUS.INSUFFICIENT, 'no_verified_second_hand_reference', 550, 3]);
  });
  test('CE-2d a provider failure with nothing known about the item is a status, never a number', async () => {
    const r = await price(fakeProvider({ status: 429 }));
    assert.deepEqual([r.status, r.failure, r.valuation], [SCAN_STATUS.FAILED, 'rate_limited', null]);
  });
  test('CE-2e the bank\'s rates are fetched once per run and applied by the server; without them the scan still answers', async () => {
    const fetchImpl = fakeProvider();
    const r = await price(fetchImpl);
    assert.equal(fetchImpl.of('fx').length, 1);
    assert.equal(r.valuation.evidence.find((e) => e.currency === 'USD').price_ils, 245);
    assert.doesNotMatch(fetchImpl.of('market')[0].body.input[0].content[0].text, /3\.5/, 'the model is not asked to convert');
    resetMarketCache(); resetFxCache();
    const down = await price(fakeProvider({ fx: null }));
    assert.equal(down.status, SCAN_STATUS.PRICED);
    assert.equal(down.valuation.evidence.find((e) => e.currency === 'USD').price_ils, null);
    assert.equal(down.valuation.counts.resale, 2, 'a price with no rate takes no part in the arithmetic');
  });
});

describe('CE-2R market research belongs to the item: reused, shared and pooled', () => {
  const identity = normalizeIdentity(RAW_IDENTITY);
  const T0 = Date.UTC(2026, 9, 6, 9, 0, 0);
  const at = (ms) => () => ms;
  const run = (fetchImpl, store, extra = {}) => runPrice({ identity, model: 'm', apiKey: KEY, fetchImpl, store, scanUuid: UUID, now: at(T0), ...extra });
  test('CE-2Ra a second scan of the same item within the hour makes no search and gets the same price', async () => {
    const fetchImpl = fakeProvider();
    const store = fakeStore();
    const first = await run(fetchImpl, store);
    const again = await run(fetchImpl, store, { now: at(T0 + 59 * 60_000) });
    assert.equal(fetchImpl.of('market').length, 1);
    assert.deepEqual([again.reused, again.status, again.call.tool_calls], [true, SCAN_STATUS.PRICED, 0]);
    assert.deepEqual(again.valuation.prices, first.valuation.prices);
    assert.deepEqual(again.valuation.evidence, first.valuation.evidence);
  });
  test('CE-2Rb a DIFFERENT photograph of the same product reads the same research', async () => {
    const fetchImpl = fakeProvider();
    const store = fakeStore();
    const first = await run(fetchImpl, store);
    const otherPhoto = normalizeIdentity({ ...RAW_IDENTITY, display_name: 'עכבר גיימינג Logitech G Pro X Superlight', color: 'White', visible_text: [], visible_condition: 'fair', canonical_name: 'Logitech G-Pro X Superlight', configuration: 'bundle', uncertainty_note: 'x' });
    const second = await run(fetchImpl, store, { identity: otherPhoto });
    assert.equal(fetchImpl.of('market').length, 1, 'no second search');
    assert.equal(second.reused, true);
    assert.deepEqual(second.valuation.prices, first.valuation.prices);
    assert.equal(second.market_key, first.market_key);
  });
  test('CE-2Rc a different item, or a different answer, is different research', async () => {
    const fetchImpl = fakeProvider();
    const store = fakeStore();
    await run(fetchImpl, store);
    await run(fetchImpl, store, { identity: normalizeIdentity({ ...RAW_IDENTITY, canonical_name: 'logitech g pro wireless' }) });
    await run(fetchImpl, store, { answer: { question: 'Which generation?', text: '2nd generation' } });
    assert.equal(fetchImpl.of('market').length, 3);
  });
  test('CE-2Rd the research is shared: another server instance reads it from the store instead of searching', async () => {
    const store = fakeStore();
    const first = await run(fakeProvider(), store);
    assert.equal(store.saves, 1);
    resetMarketCache();                       // a different instance: nothing in memory
    const elsewhere = fakeProvider();
    const second = await run(elsewhere, store, { now: at(T0 + 10 * 60_000) });
    assert.equal(elsewhere.of('market').length, 0);
    assert.deepEqual([second.reused, band(second.valuation.prices.good)], [true, band(first.valuation.prices.good)]);
  });
  test('CE-2Re after the hour a new search runs, and earlier evidence joins it: the pool grows instead of being replaced', async () => {
    const store = fakeStore();
    const NEW_URL = 'https://market.example.co.il/ads/999';
    await run(fakeProvider(), store);
    resetMarketCache();
    const later = fakeProvider({ markets: [{ evidence: [{ url: NEW_URL, title: 'Superlight יד שנייה', price: 270, currency: 'ILS', kind: 'used_listing', match: 'exact', market: 'IL', condition: 'good' }] }], reached: [NEW_URL] });
    const second = await run(later, store, { now: at(T0 + 3 * 3_600_000) });
    assert.equal(later.of('market').length, 1);
    assert.equal(second.reused, false);
    assert.equal(second.valuation.counts.resale, 4, 'three earlier references and one new');
    assert.equal(second.valuation.price_confidence, 'high', 'three Israeli references, exact, that agree');
    assert.equal(second.valuation.evidence[0].url, NEW_URL);
    assert.equal(store.rows.get(second.market_key).evidence.length, 5, 'the pooled evidence is what is kept');
  });
  test('CE-2Rf evidence older than the pooling window is not used', async () => {
    const store = fakeStore();
    await run(fakeProvider(), store);
    resetMarketCache();
    const NEW_URL = 'https://market.example.co.il/ads/999';
    const later = fakeProvider({ markets: [{ evidence: [{ url: NEW_URL, title: 't', price: 270, currency: 'ILS', kind: 'used_listing', match: 'exact', market: 'IL', condition: 'good' }] }], reached: [NEW_URL] });
    const r = await run(later, store, { now: at(T0 + CFG.MARKET_POOL_MS + 60_000) });
    assert.equal(r.valuation.counts.resale, 1);
  });
  test('CE-2Rg when the search fails, evidence gathered for this item in the last days still prices it', async () => {
    const store = fakeStore();
    const first = await run(fakeProvider(), store);
    resetMarketCache();
    const r = await run(fakeProvider({ status: 500 }), store, { now: at(T0 + 5 * 3_600_000) });
    assert.deepEqual([r.status, r.reused, r.stale], [SCAN_STATUS.PRICED, true, true]);
    assert.deepEqual(r.valuation.prices, first.valuation.prices);
  });
  test('CE-2Rh research that did not search is not kept, and a store that throws never fails a scan', async () => {
    const store = fakeStore();
    await run(fakeProvider({ searched: false }), store);
    assert.equal(store.saves, 0);
    const broken = { load: async () => { throw new Error('db down'); }, save: async () => { throw new Error('db down'); } };
    assert.equal((await run(fakeProvider(), broken)).status, SCAN_STATUS.PRICED);
  });
  test('CE-2Ri an open question about the exact model makes the price approximate; the answer makes it exact, under its own key', async () => {
    const asking = normalizeIdentity({ ...RAW_IDENTITY, canonical_name: 'apple airpods pro', exact_model_established: false, followup: { kind: 'choice', affects: 'price', question: 'Which generation?', options: ['1st generation', '2nd generation'] } });
    const store = fakeStore();
    const fetchImpl = fakeProvider();
    const open = await run(fetchImpl, store, { identity: asking });
    assert.deepEqual([open.valuation.approximate, open.valuation.family_level, open.valuation.price_confidence], [true, true, 'low']);
    const answered = await run(fetchImpl, store, { identity: asking, answer: { question: 'Which generation?', text: '2nd generation' } });
    assert.deepEqual([answered.valuation.approximate, answered.valuation.family_level], [false, false]);
    assert.notEqual(answered.market_key, open.market_key);
    assert.equal(fetchImpl.of('market').length, 2);
  });
});

describe('CE-2F an item known only by its family is priced from the family', () => {
  const SIBLINGS = { evidence: [300, 450, 650].map((price, k) => ({ url: [SOURCES.IL_USED_1, SOURCES.IL_USED_2, SOURCES.IL_RETAIL][k], title: 'AirPods Pro 2', price, currency: 'ILS', kind: 'used_listing', match: 'sibling_model', market: 'IL', condition: 'new_sealed' })) };
  const family = normalizeIdentity({ ...RAW_IDENTITY, canonical_name: 'apple airpods pro', model: null, exact_model_established: false, alternatives: [{ name: 'Apple AirPods Pro (1st generation)', distinguishing: null }, { name: 'Apple AirPods Pro (2nd generation)', distinguishing: null }], followup: { kind: 'photo', affects: 'identity', question: 'Take a close-up photo of the text inside the lid', options: [] } });
  const run = (identity) => runPrice({ identity, model: 'm', apiKey: KEY, fetchImpl: fakeProvider({ markets: [SIBLINGS] }), store: fakeStore(), scanUuid: UUID });
  test('CE-2Fa listings the model called "sibling" price an item whose generation is unknown, as an approximate range', async () => {
    const r = await run(family);
    assert.deepEqual([r.status, r.valuation.approximate, r.valuation.family_level, r.valuation.price_confidence, r.valuation.counts.resale], [SCAN_STATUS.PRICED, true, true, 'low', 3]);
    assert.deepEqual(band(r.valuation.prices.good), { list: 320, low: 230, high: 310 });
  });
  test('CE-2Fb the same listings price nothing for an item whose exact model is known', async () => {
    resetMarketCache();
    const r = await run(normalizeIdentity(RAW_IDENTITY));
    assert.deepEqual([r.status, r.valuation.counts.resale], [SCAN_STATUS.INSUFFICIENT, 0]);
  });
  test('CE-2Fc the market prompt tells the model which models a family-level item may be', async () => {
    const fetchImpl = fakeProvider({ markets: [SIBLINGS] });
    resetMarketCache();
    await runPrice({ identity: family, model: 'm', apiKey: KEY, fetchImpl, store: fakeStore(), scanUuid: UUID });
    const prompt = fetchImpl.of('market')[0].body.input[0].content[0].text;
    assert.match(prompt, /exact_model_established: no/);
    assert.match(prompt, /could_also_be: Apple AirPods Pro \(1st generation\), Apple AirPods Pro \(2nd generation\)/);
    assert.match(prompt, /is close_comparable, not sibling_model/);
  });
});

describe('CE-2S the shared store is the existing event log', () => {
  /** A stand-in for the database client that records what was asked of it. */
  function fakeSupa(rows = []) {
    const log = { filters: [], inserted: [] };
    const query = { select() { return query; }, eq(col, val) { log.filters.push([col, val]); return query; }, order() { return query; }, limit() { return Promise.resolve({ data: rows, error: null }); } };
    return { log, from(table) { log.table = table; return { ...query, insert(row) { log.inserted.push(row); return Promise.resolve({ error: null }); } }; } };
  }
  const key = marketKey(normalizeIdentity(RAW_IDENTITY));
  const record = { at: 1, evidence: [{ url: 'https://a.example.co.il/1', price: 300 }], searched: { date: '2026-10-06' } };
  test('CE-2Sa saved as one event carrying the item\'s key and its evidence, and nothing about a person or a photograph', async () => {
    const supa = fakeSupa();
    await saveMarketResearch(key, record, UUID, { supa });
    const [row] = supa.log.inserted;
    assert.deepEqual([supa.log.table, row.event_type, row.scan_uuid, row.payload.key], ['scan_events', MARKET_EVENT, UUID, await marketKeyHash(key)]);
    assert.deepEqual(row.payload.record, record);
    assert.doesNotMatch(JSON.stringify(row), /user|token|data:image|base64/i);
  });
  test('CE-2Sb read back by the same key, newest first; nothing stored, or no database, is simply nothing', async () => {
    const supa = fakeSupa([{ payload: { key: await marketKeyHash(key), record } }]);
    assert.deepEqual(await loadMarketResearch(key, { supa }), record);
    assert.deepEqual(supa.log.filters, [['event_type', MARKET_EVENT], ['payload->>key', await marketKeyHash(key)]]);
    assert.equal(await loadMarketResearch(key, { supa: fakeSupa([]) }), null);
    assert.equal(await loadMarketResearch(key, { supa: null }), null);
    await saveMarketResearch(key, record, UUID, { supa: null });
    assert.match(await marketKeyHash(key), /^[0-9a-f]{40}$/);
    assert.notEqual(await marketKeyHash(key), await marketKeyHash(key + 'x'));
  });
});

// ── THE GATE ────────────────────────────────────────────────────────────────
function harness(over = {}) {
  const log = { identify: 0, price: 0, charge: 0, refund: 0, record: 0, events: [] };
  const identity = normalizeIdentity(over.rawIdentity ?? RAW_IDENTITY);
  const handler = createScanHandler({
    verify: async (h) => (h === 'Bearer good' ? USER : (h === 'Bearer other' ? { id: 'user-2' } : (h === 'Bearer old' ? { id: 'user-1', _expired: true } : null))),
    charge: async () => { log.charge += 1; return over.quota ?? { allowed: true, charged: true, limitType: null, retryAfter: 0 }; },
    refund: async () => { log.refund += 1; },
    identify: async (args) => { log.identify += 1; log.identifyArgs = args; return over.identifyResult ?? { status: 'identified', identity, followups: 0, default_condition: 'good', billed: true, call: { stage: 'identify', model: 'm', ms: 1200, usage: null } }; },
    price: async (args) => { log.price += 1; log.priceArgs = args; return over.priceResult ?? { status: 'priced', valuation: { status: 'priced', prices: {}, counts: { resale: 2 }, price_confidence: 'high', approximate: false }, reused: false, call: { stage: 'market', model: 'm', ms: 5000, usage: null, tool_calls: 2 } }; },
    record: async () => { log.record += 1; return 'val-1'; },
    logEvent: async (scan, type, payload) => { log.events.push({ scan, type, payload }); },
  });
  const call = async (body, { auth = 'Bearer good', method = 'POST' } = {}) => {
    const res = await handler(new Request('https://getworth.test/api/scan', {
      method, headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) },
      body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
    }));
    let payload = null;
    try { payload = await res.json(); } catch { /* empty */ }
    return { status: res.status, payload, headers: res.headers };
  };
  return { call, log };
}
const identifyBody = (extra = {}) => ({ action: 'identify', scan_uuid: UUID, lang: 'he', images: [IMG], ...extra });

describe('CE-3 a refused request costs nothing', () => {
  test('CE-3a method, then session: no quota is charged and no provider is called', async () => {
    const { call, log } = harness();
    assert.equal((await call(null, { method: 'GET' })).status, 405);
    assert.equal((await call(identifyBody(), { auth: null })).status, 401);
    assert.equal((await call(identifyBody(), { auth: 'Bearer nope' })).status, 401);
    const expired = await call(identifyBody(), { auth: 'Bearer old' });
    assert.deepEqual([expired.status, expired.payload.code], [401, 'SESSION_EXPIRED']);
    assert.deepEqual([log.charge, log.identify, log.price], [0, 0, 0]);
  });
  test('CE-3b a malformed request is refused before the quota', async () => {
    const { call, log } = harness();
    assert.equal((await call('{not json')).status, 400);
    assert.equal((await call(identifyBody({ scan_uuid: 'nope' }))).status, 400);
    assert.equal((await call(identifyBody({ action: 'run' }))).status, 400);
    assert.equal((await call(identifyBody({ images: [] }))).status, 400);
    assert.equal((await call(identifyBody({ images: ['data:image/jpeg;base64,AAAA'] }))).status, 400);
    assert.equal((await call(identifyBody({ images: Array(CFG.MAX_IMAGES + 1).fill(IMG) }))).status, 400);
    assert.equal((await call(identifyBody({ correction: 'it is a phone' }))).status, 400, 'a correction needs the scan it corrects');
    assert.deepEqual([log.charge, log.identify], [0, 0]);
  });
  test('CE-3c switched off or unconfigured answers 503 and touches nothing', async () => {
    for (const [name, value] of [['OPENAI_API_KEY', ''], ['CORE_SCAN_ENABLED', 'false'], ['SCAN_STATE_SECRET', '']]) {
      const before = process.env[name];
      const jwt = process.env.SUPABASE_JWT_SECRET; const v2 = process.env.SCAN_ENGINE_V2_STATE_SECRET;
      delete process.env.SUPABASE_JWT_SECRET; delete process.env.SCAN_ENGINE_V2_STATE_SECRET;
      process.env[name] = value;
      const { call, log } = harness();
      const r = await call(identifyBody());
      if (before === undefined) delete process.env[name]; else process.env[name] = before;
      if (jwt !== undefined) process.env.SUPABASE_JWT_SECRET = jwt;
      if (v2 !== undefined) process.env.SCAN_ENGINE_V2_STATE_SECRET = v2;
      assert.deepEqual([r.status, r.payload.status], [503, 'unavailable'], name);
      assert.deepEqual([log.charge, log.identify], [0, 0], name);
    }
  });
  test('CE-3d over the quota: 429 with when to retry, and no provider call', async () => {
    const { call, log } = harness({ quota: { allowed: false, charged: false, limitType: 'user_daily', retryAfter: 3600 } });
    const r = await call(identifyBody());
    assert.equal(r.status, 429);
    assert.deepEqual([r.payload.code, r.payload.limitType, r.payload.retryable], ['RATE_LIMITED', 'user_daily', false]);
    assert.equal(r.headers.get('retry-after'), '3600');
    assert.equal(log.identify, 0);
  });
});

describe('CE-4 the two actions', () => {
  test('CE-4a identify charges the quota once and returns the identity with a signed token', async () => {
    const { call, log } = harness();
    const r = await call(identifyBody());
    assert.equal(r.status, 200);
    assert.equal(r.payload.status, 'identified');
    assert.equal(r.payload.identity.display_name, 'Logitech G Pro X Superlight');
    assert.equal(r.payload.default_condition, 'good');
    assert.match(r.payload.token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    assert.equal(typeof r.payload.timings.total_ms, 'number');
    assert.deepEqual([log.charge, log.identify, log.price], [1, 1, 0]);
    assert.equal(log.identifyArgs.images.length, 1);
    assert.doesNotMatch(log.identifyArgs.images[0], /^data:/, 'the handler passes bare base64');
  });
  test('CE-4b a failed identification gives the quota back only when the provider did not bill', async () => {
    const failed = (billed) => ({ status: 'failed', failure: billed ? 'timeout' : 'upstream_5xx', identity: null, followups: 0, billed, call: { stage: 'identify', model: 'm', ms: 9, usage: null } });
    const a = harness({ identifyResult: failed(false) });
    const ra = await a.call(identifyBody());
    assert.deepEqual([ra.status, ra.payload.status, ra.payload.retryable, a.log.refund], [200, 'failed', true, 1]);
    assert.equal(ra.payload.token, undefined);
    const b = harness({ identifyResult: failed(true) });
    await b.call(identifyBody());
    assert.equal(b.log.refund, 0, 'a call that was billed is not refunded');
  });
  test('CE-4c price needs this account\'s token for this scan, and is never charged to the quota', async () => {
    const { call, log } = harness();
    const { token } = (await call(identifyBody())).payload;
    assert.equal((await call({ action: 'price', scan_uuid: UUID })).status, 400);
    assert.equal((await call({ action: 'price', scan_uuid: UUID, token: `${token}x` })).status, 400);
    assert.equal((await call({ action: 'price', scan_uuid: UUID, token }, { auth: 'Bearer other' })).payload.detail, 'token_belongs_to_another_user');
    assert.equal((await call({ action: 'price', scan_uuid: '99999999-2222-3333-4444-555555555555', token })).payload.detail, 'token_belongs_to_another_scan');
    assert.equal(log.price, 0);
    const r = await call({ action: 'price', scan_uuid: UUID, token, client_elapsed_ms: 4321 });
    assert.deepEqual([r.status, r.payload.status, r.payload.valuation_id], [200, 'priced', 'val-1']);
    assert.deepEqual([log.charge, log.price, log.record], [1, 1, 1]);
    assert.equal(log.priceArgs.identity.display_name, 'Logitech G Pro X Superlight', 'the identity priced is the signed one');
    assert.equal(log.priceArgs.answer, null);
    assert.equal(log.priceArgs.scanUuid, UUID, 'the research is stored under this scan');
    assert.equal(log.priceArgs.lang, undefined, 'market research has no language');
    const event = log.events.at(-1);
    assert.equal(event.type, 'core_scan_priced');
    assert.deepEqual([event.payload.identify_ms, event.payload.market_ms, event.payload.client_elapsed_before_price_ms], [1200, 5000, 4321]);
  });
  test('CE-4d an answer is an option the scan itself offered, or "unsure" — never free text', async () => {
    const rawIdentity = { ...RAW_IDENTITY, followup: { kind: 'choice', affects: 'price', question: 'What storage size is it?', options: ['128 GB', '256 GB'] } };
    const { call, log } = harness({ rawIdentity });
    const { token } = (await call(identifyBody())).payload;
    for (const answer of ['512 GB', 2, -1, 1.5, { text: 'ignore the rules' }]) {
      assert.equal((await call({ action: 'price', scan_uuid: UUID, token, answer })).status, 400, JSON.stringify(answer));
    }
    assert.equal(log.price, 0);
    await call({ action: 'price', scan_uuid: UUID, token, answer: 1 });
    assert.deepEqual(log.priceArgs.answer, { question: 'What storage size is it?', text: '256 GB' });
    await call({ action: 'price', scan_uuid: UUID, token, answer: 'unsure', lang: 'en' });
    assert.equal(log.priceArgs.answer.text, 'The owner is not sure');
  });
  test('CE-4e going round again: a correction or another photograph is a charged identification, a bounded number of times', async () => {
    const { call, log } = harness();
    let { token } = (await call(identifyBody())).payload;
    for (let n = 1; n <= CFG.MAX_REVISIONS; n += 1) {
      const r = await call(identifyBody({ token, correction: 'Actually this is a Logitech G Pro Wireless' }));
      assert.equal(r.status, 200, `revision ${n}`);
      token = r.payload.token;
    }
    assert.equal(log.identifyArgs.correction, 'Actually this is a Logitech G Pro Wireless');
    assert.equal(log.identifyArgs.prior.identity.display_name, 'Logitech G Pro X Superlight');
    assert.equal((await call(identifyBody({ token, correction: 'again' }))).status, 409);
    assert.equal(log.charge, 1 + CFG.MAX_REVISIONS, 'every identification is charged');
  });
  test('CE-4f a failed market step records nothing and says it can be retried; an unpriced scan is still recorded', async () => {
    const failed = harness({ priceResult: { status: 'failed', failure: 'timeout', valuation: null, reused: false, call: { stage: 'market', model: 'm', ms: 50000, usage: null } } });
    const { token } = (await failed.call(identifyBody())).payload;
    const r = await failed.call({ action: 'price', scan_uuid: UUID, token });
    assert.deepEqual([r.payload.status, r.payload.retryable, failed.log.record], ['failed', true, 0]);
    const thin = harness({ priceResult: { status: 'insufficient_evidence', valuation: { status: 'insufficient_evidence', prices: null, withdrawn: 'no_verified_second_hand_reference', counts: { resale: 0 } }, reused: false, call: { stage: 'market', model: 'm', ms: 1, usage: null } } });
    const t = (await thin.call(identifyBody())).payload.token;
    const u = await thin.call({ action: 'price', scan_uuid: UUID, token: t });
    assert.deepEqual([u.payload.status, u.payload.valuation.prices, thin.log.record], ['insufficient_evidence', null, 1]);
  });
  test('CE-4g a photograph with nothing to sell cannot be priced', async () => {
    const { call, log } = harness({ identifyResult: { status: 'no_item', identity: normalizeIdentity({ ...RAW_IDENTITY, is_sellable_item: false }), followups: 0, default_condition: 'good', billed: true, call: null } });
    const { token, status } = (await call(identifyBody())).payload;
    assert.equal(status, 'no_item');
    assert.equal((await call({ action: 'price', scan_uuid: UUID, token })).status, 400);
    assert.equal(log.price, 0);
  });
});

describe('CE-5 what a scan leaves behind', () => {
  const identity = normalizeIdentity(RAW_IDENTITY);
  const pricedValuation = buildValuation({ evidence: [
    { url: 'https://a.example.co.il/1', price: 260, currency: 'ILS', price_ils: 260, kind: 'used_listing', match: 'exact', market: 'IL', condition: 'good' },
    { url: 'https://a.example.co.il/2', price: 250, currency: 'ILS', price_ils: 250, kind: 'used_listing', match: 'exact', market: 'IL', condition: 'unknown' },
    { url: 'https://a.example.co.il/3', price: 549, currency: 'ILS', price_ils: 549, kind: 'new_retail', match: 'exact', market: 'IL', condition: 'new_sealed' },
  ] });
  test('CE-5a a priced scan writes real numbers in order; an unpriced one writes none, never 0', () => {
    const row = buildValuationRow({ id: 'v', userId: 'u', scanUuid: UUID, identity, lang: 'he', valuation: pricedValuation });
    const good = pricedValuation.prices.good;
    assert.deepEqual([row.price_low, row.price_high, row.new_retail, row.comp_count], [good.low, good.high, 550, 2]);
    assert.ok(row.price_low <= row.price_mid && row.price_mid <= row.price_high);
    assert.deepEqual([row.price_method, row.ai_name, row.ai_category, row.user_id, row.scan_uuid], [PRICE_METHOD, 'Logitech G Pro X Superlight', 'Electronics', 'u', UUID]);
    assert.equal(row.ai_raw_response.valuation.sources.length, 3);
    const none = buildValuationRow({ id: 'v', userId: 'u', scanUuid: UUID, identity, lang: 'he', valuation: buildValuation({ evidence: [] }) });
    assert.deepEqual([none.price_low, none.price_mid, none.price_high, none.price_method], [null, null, null, 'manual_required']);
  });
  test('CE-5b the row holds no photograph and no token', () => {
    const row = JSON.stringify(buildValuationRow({ id: 'v', userId: 'u', scanUuid: UUID, identity, lang: 'he', valuation: null }));
    assert.doesNotMatch(row, /data:image|base64|token/i);
  });
});

// ── STRUCTURE ───────────────────────────────────────────────────────────────
const walk = (dir) => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)])) : []);
const read = (p) => readFileSync(p, 'utf8');

describe('CE-6 structure', () => {
  test('CE-6a the function\'s time limit is a literal 60 and every ceiling fits inside it', () => {
    assert.deepEqual(config, { maxDuration: 60 });
    assert.match(read(join(ROOT, 'api/scan.js')), /export const config = \{ maxDuration: 60 \};/);
    assert.ok(CFG.MARKET_TIMEOUT_MS + 8000 <= CFG.SCAN_FUNCTION_MAX_DURATION_S * 1000);
    assert.ok(CFG.IDENTIFY_TIMEOUT_MS + 8000 <= CFG.SCAN_FUNCTION_MAX_DURATION_S * 1000);
    assert.ok(CFG.MAX_BODY_BYTES < 4.5 * 1024 * 1024, 'under the platform\'s request-body limit');
  });
  test('CE-6f the defaults are the measured ones, and each can be changed from the environment without code', () => {
    assert.equal(CFG.resolveIdentityModel({}), 'gpt-6.1-sol');
    assert.equal(CFG.resolveMarketModel({}), 'gpt-6-luna');
    assert.equal(CFG.resolveMarketModel({ CORE_SCAN_MARKET_MODEL: ' gpt-6.1-sol ' }), 'gpt-6.1-sol');
    assert.deepEqual([CFG.resolveIdentityEffort({}), CFG.resolveMarketEffort({ CORE_SCAN_MARKET_EFFORT: 'medium' }), CFG.resolveMarketEffort({ CORE_SCAN_MARKET_EFFORT: 'max!' })], ['low', 'medium', 'low']);
    assert.equal(CFG.MARKET_MAX_TOOL_CALLS, 2, 'each search action costs the owner several seconds');
    assert.equal(CFG.MARKET_FRESH_MS, 60 * 60 * 1000, 'the same item is not researched twice in an hour');
    assert.ok(CFG.MARKET_POOL_MS > CFG.MARKET_FRESH_MS);
  });
  test('CE-6b the scan reaches OpenAI through the one shared streaming client and nowhere else', () => {
    for (const file of [...walk(join(ROOT, 'api/_lib/scan')), join(ROOT, 'api/scan.js')]) {
      assert.doesNotMatch(read(file), /api\.openai\.com|api\.anthropic\.com/, `${file} must not name a provider host`);
    }
  });
  test('CE-6c the key stays on the server: no client file names it or a provider host', () => {
    for (const file of walk(join(ROOT, 'src')).filter((f) => /\.(js|jsx)$/.test(f))) {
      assert.doesNotMatch(read(file), /OPENAI_API_KEY|api\.openai\.com|SUPABASE_SERVICE_KEY|SCAN_STATE_SECRET/, file);
    }
  });
  test('CE-6d Scan Lab is gone: no file, no route, no flag, no mention in what ships or runs', () => {
    const files = [...walk(join(ROOT, 'api')), ...walk(join(ROOT, 'src')), ...walk(join(ROOT, 'scripts')), join(ROOT, 'package.json'), join(ROOT, 'vercel.json'), join(ROOT, 'vite.config.js')];
    for (const file of files) {
      assert.doesNotMatch(file.replace(ROOT, ''), /scan[-_]?lab/i, `${file} is a Scan Lab file`);
      assert.doesNotMatch(read(file), /scan[-_ ]?lab(?!el)|SCAN_LAB|scanLab/i, `${file} still mentions Scan Lab`);
    }
    assert.equal(walk(join(ROOT, 'tests')).some((f) => /scan[-_]lab/i.test(f)), false);
  });
  test('CE-6e there is one scan screen in the app, and it is this one', () => {
    const app = read(join(ROOT, 'src/App.jsx'));
    assert.match(app, /import\('\.\/views\/ScanView'\)/);
    assert.doesNotMatch(app, /ScanV2View|scanV2/);
    assert.equal(existsSync(join(ROOT, 'src/views/ScanV2View.jsx')), false);
    assert.match(read(join(ROOT, 'scripts/vite-dev-api.mjs')), /\['\/api\/scan', '\.\.\/api\/scan\.js'\]/);
  });
});
