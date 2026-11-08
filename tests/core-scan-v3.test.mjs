// V3 — Core Scan speed and clarification (2026-11-08): the measured identity configuration, the lean output, a choice
// instead of another photograph when the photograph already narrowed the item to named candidates, the owner's model
// answer establishing the product, the warm-up while the camera opens, and the per-request timing that explains where
// a first identification's time goes.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createScanHandler } from '../api/scan.js';
import { normalizeIdentity, completeIdentity, recordAnswer, asModelChoice, modelCandidates, IDENTITY_SCHEMA } from '../api/_lib/scan/identify.js';
import { buildIdentityPrompt, MODEL_MAX_ATTRIBUTES, MAX_CLARIFICATIONS } from '../api/_lib/scan/identity-prompt.js';
import { marketKey } from '../api/_lib/scan/strategy.js';
import { searchNames } from '../api/_lib/scan/market.js';
import { warmQuota } from '../api/_lib/scan/quota.js';
import { instanceInfo } from '../api/_lib/scan/telemetry.js';
import { warmScan, resetWarm, WARM_EVERY_MS } from '../src/lib/coreScan.js';
import * as CFG from '../api/_lib/scan/config.js';
import { RAW_IDENTITY } from './helpers/core-scan-fakes.mjs';

const UUID = '11111111-2222-3333-4444-555555555555';
const PHONE = (over = {}) => normalizeIdentity({
  ...RAW_IDENTITY, category: 'Electronics', item_type: 'smartphone', brand: 'Apple', product_family: 'iPhone', model: 'iPhone X', model_number: null,
  exact_model_established: false, identity_confidence: 'medium', canonical_name: 'apple iphone', display_name: 'Apple iPhone',
  market_class: 'consumer_electronics', identity_precision: 'exact_model',
  alternatives: [{ name: 'iPhone XS', distinguishing: 'gold colour option' }, { name: 'iPhone XS Max', distinguishing: 'larger' }],
  attributes: [{ name: 'storage', value: '256 GB', basis: 'observed', matters: 'high' }],
  clarifications: [{ attribute: 'generation', kind: 'photo', question: 'Take a photo of Settings → About', options: [], unit: null, impact: 'high', affects: 'identity' }],
  ...over,
}, { followupsLeft: 3 });

describe('V3-1 the identity configuration is the measured one', () => {
  test('V3-1a gpt-6.1-terra without a reasoning pass by default; both one variable away', () => {
    assert.equal(CFG.resolveIdentityModel({}), 'gpt-6.1-terra');
    assert.equal(CFG.resolveIdentityEffort({}), 'none');
    assert.equal(CFG.resolveIdentityEffort({ CORE_SCAN_IDENTITY_EFFORT: 'low' }), 'low');
    assert.equal(CFG.resolveMarketEffort({}), 'low', 'the market step keeps its own default');
  });
  test('V3-1b lean output: the model names at most four attributes and two questions, and the prompt says so', () => {
    assert.equal(IDENTITY_SCHEMA.properties.attributes.maxItems, MODEL_MAX_ATTRIBUTES);
    assert.equal(MODEL_MAX_ATTRIBUTES, 4);
    assert.equal(IDENTITY_SCHEMA.properties.clarifications.maxItems, MAX_CLARIFICATIONS);
    assert.equal(MAX_CLARIFICATIONS, 2);
    const p = buildIdentityPrompt({ lang: 'he' });
    assert.match(p, /up to 4 facts, only those that matter high or medium/);
    assert.match(p, /WHEN THE MODEL OR GENERATION IS THE OPEN QUESTION/);
  });
});

describe('V3-2 a choice among the candidates, not another photograph', () => {
  test('V3-2a a required photograph asked only to tell named candidates apart becomes a one-tap choice among them', () => {
    const id = completeIdentity(PHONE(), { lang: 'en', followupsLeft: 3 });
    assert.deepEqual([id.followup.kind, id.followup.attribute, id.followup.required], ['choice', 'model', true]);
    assert.deepEqual(id.followup.options, ['iPhone X', 'iPhone XS', 'iPhone XS Max']);
    assert.match(id.followup.question, /Which model is it\?/);
    assert.match(completeIdentity(PHONE(), { lang: 'he', followupsLeft: 3 }).followup.question, /איזה דגם/);
  });
  test('V3-2b with nothing narrowed, the photograph is still asked for; the identity gap\'s own photograph is never converted', () => {
    const none = completeIdentity(PHONE({ alternatives: [], model: null }), { lang: 'en', followupsLeft: 3 });
    assert.deepEqual([none.followup.kind, none.followup.required], ['photo', true]);
    assert.deepEqual(modelCandidates({ model: 'iPhone X', exact_model_established: true, alternatives: [{ name: 'iPhone XS' }] }), [], 'an established model is no candidate: one name is no choice');
    const gap = { kind: 'photo', affects: 'identity', attribute: 'identity', question: 'q', options: [] };
    assert.equal(asModelChoice(gap, { model: 'A 1', alternatives: [{ name: 'A 2' }] }, 'en'), gap);
    const price = { kind: 'photo', affects: 'price', attribute: 'model', question: 'q', options: [] };
    assert.equal(asModelChoice(price, { model: 'A 1', alternatives: [{ name: 'A 2' }] }, 'en'), price, 'only a question about WHAT the item is');
  });
  test('V3-2c candidates are de-duplicated and bounded', () => {
    const c = modelCandidates({ model: 'Series 4', alternatives: [{ name: 'series 4' }, { name: 'Series 5' }, { name: 'Series 6' }, { name: 'SE' }, { name: 'Series 7' }, { name: 'Series 8' }] });
    assert.deepEqual(c, ['Series 4', 'Series 5', 'Series 6', 'SE', 'Series 7']);
  });
  test('V3-2d an option that only means "none of these" is never offered: the app has its own "something else" box', () => {
    const id = completeIdentity(PHONE({ clarifications: [{ attribute: 'model', kind: 'choice', question: 'Which?', options: ['iPhone X', 'iPhone XS', 'דגם אחר', 'Other model', 'סדרה אחרת'], unit: null, impact: 'high', affects: 'identity' }] }), { lang: 'en', followupsLeft: 3 });
    assert.deepEqual(id.followup.options, ['iPhone X', 'iPhone XS']);
  });
});

describe('V3-3 the owner\'s answer establishes the model', () => {
  test('V3-3a the chosen model is the product: established, named in the search, kept under its own name, candidates gone', () => {
    const asked = completeIdentity(PHONE(), { lang: 'en', followupsLeft: 3 });
    const familyKey = marketKey(asked);
    const { identity } = recordAnswer(asked, 1, { lang: 'en', followupsLeft: 2 });
    assert.deepEqual([identity.model, identity.exact_model_established, identity.canonical_name], ['iPhone XS', true, 'apple iphone xs']);
    assert.deepEqual(identity.alternatives, []);
    assert.equal(identity.confirmed[0].attribute, 'model');
    assert.notEqual(marketKey(identity), familyKey, 'research for the family is never served as the chosen model\'s');
    const names = searchNames(identity);
    assert.match(names.name, /iPhone XS/);
    assert.deepEqual(names.alternatives, []);
  });
  test('V3-3b "not sure" settles nothing: the family stays the family and its price stays approximate', () => {
    const asked = completeIdentity(PHONE(), { lang: 'en', followupsLeft: 3 });
    const { identity } = recordAnswer(asked, 'unsure', { lang: 'en', followupsLeft: 2 });
    assert.equal(identity.exact_model_established, false);
    assert.equal(identity.canonical_name, 'apple iphone');
  });
});

describe('V3-4 the warm-up while the camera opens', () => {
  const harness = () => {
    const log = { charge: 0, identify: 0, price: 0, warm: 0, events: [] };
    const handler = createScanHandler({
      verify: async (h) => (h === 'Bearer good' ? { id: 'user-1' } : null),
      charge: async () => { log.charge += 1; return { allowed: true, charged: true }; },
      identify: async () => { log.identify += 1; throw new Error('no'); },
      price: async () => { log.price += 1; throw new Error('no'); },
      warm: async () => { log.warm += 1; return true; },
      logEvent: async (scan, type, payload) => { log.events.push({ type, payload }); },
    });
    const call = (body, auth = 'Bearer good') => handler(new Request('https://getworth.test/api/scan', { method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) }, body: JSON.stringify(body) }));
    return { call, log };
  };
  const env = { OPENAI_API_KEY: 'k', SCAN_STATE_SECRET: 'x'.repeat(40) };
  let saved;
  beforeEach(() => { saved = { ...process.env }; Object.assign(process.env, env); });
  const restore = () => { for (const k of Object.keys(env)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } };

  test('V3-4a a signed-in warm request: no quota, no provider, one telemetry row with its timing and the instance it reached', async () => {
    const { call, log } = harness();
    const res = await call({ action: 'warm', scan_uuid: UUID, lang: 'en' });
    const body = await res.json();
    restore();
    assert.deepEqual([res.status, body.status], [200, 'warm']);
    assert.deepEqual([log.charge, log.identify, log.price, log.warm], [0, 0, 0, 1]);
    const row = log.events.find((e) => e.type === 'core_scan_request').payload;
    assert.equal(row.action, 'warm');
    for (const k of ['warm_ms', 'instance_age_ms', 'instance_requests', 'auth_ms', 'body_ms']) assert.equal(typeof row[k], 'number', k);
  });
  test('V3-4b without a session the warm request is refused like any other', async () => {
    const { call, log } = harness();
    const res = await call({ action: 'warm', scan_uuid: UUID }, null);
    restore();
    assert.equal(res.status, 401);
    assert.equal(log.warm, 0);
  });
  test('V3-4c the server warm-up reads the account\'s own allowance row once a minute, writes nothing and never throws', async () => {
    const calls = [];
    const supa = { from: (t) => { calls.push(t); return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }; } };
    assert.equal(await warmQuota({ supa, userId: 'u-warm', now: 1_000_000 }), true);
    assert.equal(await warmQuota({ supa, userId: 'u-warm', now: 1_000_000 + 30_000 }), false, 'within the minute');
    assert.equal(await warmQuota({ supa, userId: 'u-warm', now: 1_000_000 + 61_000 }), true);
    assert.deepEqual(calls, ['scan_daily_usage', 'scan_daily_usage']);
    const broken = { from: () => { throw new Error('down'); } };
    assert.equal(await warmQuota({ supa: broken, userId: 'u-broken', now: 5 }), false);
    assert.equal(await warmQuota({ supa: null, userId: 'u' }), false);
  });
  test('V3-4d the app warms once a minute at most, with no photograph, and a failure is silent', async () => {
    resetWarm();
    const sent = [];
    const fetchImpl = async (url, init) => { sent.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization }); return { ok: true }; };
    await warmScan(async () => 'tok', { now: 10, fetchImpl });
    assert.equal(warmScan(async () => 'tok', { now: 10 + WARM_EVERY_MS - 1, fetchImpl }), null);
    await warmScan(async () => 'tok', { now: 10 + WARM_EVERY_MS, fetchImpl });
    assert.equal(sent.length, 2);
    assert.deepEqual([sent[0].url, sent[0].body.action, sent[0].auth, 'images' in sent[0].body], ['/api/scan', 'warm', 'Bearer tok', false]);
    resetWarm();
    await warmScan(async () => { throw new Error('no session'); }, { now: 1, fetchImpl });
    resetWarm();
    await warmScan(async () => 'tok', { now: 1, fetchImpl: async () => { throw new Error('offline'); } });
    resetWarm();
    await warmScan(async () => null, { now: 1, fetchImpl: () => assert.fail('no token, no request') });
  });
});

describe('V3-5 where a request\'s time goes', () => {
  test('V3-5a each request learns the age and request count of the instance it reached', () => {
    const a = instanceInfo(Date.now());
    const b = instanceInfo(Date.now());
    assert.equal(b.instance_requests, a.instance_requests + 1);
    assert.ok(a.instance_age_ms >= 0);
  });
});

// ── V3-6 (2026-11-08 controlled test, 10 products): what a price may stand on ─────────────────────────────────────────
import { buildValuation, SET_ASIDE, isFrontPage } from '../api/_lib/scan/valuation.js';
describe('V3-6 a site\'s estimate and a site\'s front page are never priced from', () => {
  const ev = (o) => ({ title: '', currency: 'ILS', match: 'exact', market: 'IL', condition: 'good', page: 'listing', binding: 'strong', stock: 'unknown', seen: '2026-11-08', listed: '2026-10-20', ...o, price_ils: o.price_ils ?? o.price });
  // The Switch OLED as the test found it: one current Israeli ad, a shop's new price, an "eBay sold" aggregator's front
  // page and an AI price estimator — the last two counted as sales before this fix.
  const pool = [
    ev({ url: 'https://m.homeless.co.il/yad2/viewad%2C1116926.aspx', domain: 'm.homeless.co.il', kind: 'used_listing', price: 1000, listed: '2026-09-28' }),
    ev({ url: 'https://ksp.co.il/mob/item/171374', domain: 'ksp.co.il', kind: 'new_retail', price: 1199, condition: 'new_sealed', page: 'shop_product' }),
    ev({ url: 'https://ebaysoldlistings.com/', domain: 'ebaysoldlistings.com', kind: 'sold', market: 'INTL', price: 910, binding: 'verified_row', listed: '2026-11-06' }),
    ev({ url: 'https://fliptip.ai/price/nintendo-switch-oled', domain: 'fliptip.ai', kind: 'price_guide', market: 'INTL', price: 578, page: 'price_guide', listed: null }),
  ];
  test('V3-6a the Israeli ad prices; the estimate is context and the front page is set aside, each saying why', () => {
    const v = buildValuation({ evidence: pool, today: '2026-11-08' });
    assert.equal(v.status, 'priced');
    const why = Object.fromEntries(v.evidence.map((e) => [e.domain, e.set_aside ?? (e.used ? 'used' : null)]));
    assert.equal(why['m.homeless.co.il'], 'used');
    assert.equal(why['fliptip.ai'], SET_ASIDE.PRICE_GUIDE_CONTEXT);
    assert.equal(why['ebaysoldlistings.com'], SET_ASIDE.NOT_SPECIFIC);
    assert.equal(v.evidence.filter((e) => e.used).length, 1);
  });
  test('V3-6b estimates alone never open the gate: no Israeli listing, no price', () => {
    const v = buildValuation({ evidence: [pool[3], { ...pool[3], url: 'https://aionrulez.net/price/x', domain: 'aionrulez.net', market: 'IL' }], today: '2026-11-08' });
    assert.notEqual(v.status, 'priced');
  });
  test('V3-6c a front page is a bare host, with or without a slash or query; any path is a page', () => {
    assert.deepEqual(['https://ebaysoldlistings.com/', 'https://x.com', 'https://x.com/?q=1', 'https://x.com/a/1', 'https://www.homeless.co.il/yad2/viewad%2C1.aspx'].map(isFrontPage), [true, true, true, false, false]);
  });
});
