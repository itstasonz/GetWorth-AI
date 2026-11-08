// FP — the first public Production scan (2026-11-08, scan 03a02fcb, Logitech G PRO Wireless): identified, asked about
// the USB receiver, searched twice for the same queries, and withheld the price for lack of Israeli second-hand evidence.
// These pin what changed and what must not.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildValuation, marketKey, ESTIMATE_BASIS, WITHDRAWN, CONDITION_FACTOR } from '../api/_lib/scan/valuation.js';
import { buildSearchQueries } from '../api/_lib/scan/market.js';
import { normalizeIdentity } from '../api/_lib/scan/identify.js';
import { buildValuationRow } from '../api/_lib/scan/persist.js';
import { RAW_IDENTITY } from './helpers/core-scan-fakes.mjs';

const TODAY = '2026-11-08';
const CURRENT = '2026-10-25';
let serial = 0;
const item = (over = {}) => { serial += 1; return { url: `https://ex.example.co.il/ad/${serial}`, domain: 'ex.example.co.il', title: 't', price: 300, currency: 'ILS', price_ils: over.price ?? 300, kind: 'used_listing', match: 'exact', market: 'IL', condition: 'good', page: 'listing', listed: CURRENT, binding: 'strong', seen: TODAY, ...over }; };
const il = (price, over) => item({ price, ...over });
const abroad = (price, over) => item({ price, currency: 'USD', market: 'INTL', domain: 'www.ebay.com', url: `https://www.ebay.com/itm/${serial + 1000}`, ...over });
const shop = (price, over) => item({ price, kind: 'new_retail', condition: 'new_sealed', page: 'shop_product', listed: null, ...over });
const value = (evidence, opts = {}) => buildValuation({ evidence, today: TODAY, ...opts });

// What the founder's screen showed: new prices ₪389–₪659 in Israeli shops, one used listing abroad.
const IL_SHOPS = () => [shop(389, { url: 'https://www.bug.co.il/gpw', domain: 'www.bug.co.il' }), shop(659, { url: 'https://www.zap.co.il/gpw', domain: 'www.zap.co.il' })];

describe('FP-1 an answer that changes no query reuses the research', () => {
  const identity = normalizeIdentity(RAW_IDENTITY);
  const receiver = { ...identity, confirmed: [{ attribute: 'usb receiver included', value: 'No', stated: false }] };
  test('FP-1a the receiver answer: the same key and the same queries, so no second web search', () => {
    assert.equal(marketKey(receiver, { question: 'Is the USB receiver included?', text: 'No' }), marketKey(identity));
    for (const stage of ['local', 'expand']) {
      assert.deepEqual(buildSearchQueries({ identity: receiver, answer: { question: 'Is the USB receiver included?', text: 'No' }, stage }), buildSearchQueries({ identity, stage }));
    }
  });
  test('FP-1b an answer that names what the item IS still searches again', () => {
    const storage = { ...identity, confirmed: [{ attribute: 'storage', value: '256 GB' }] };
    assert.notEqual(marketKey(storage), marketKey(identity));
    assert.notEqual(marketKey(identity, { question: 'Which storage?', text: '256 GB' }), marketKey(identity));
    assert.equal(marketKey(identity, { question: 'Which storage?', text: '256 GB', unsure: true }), marketKey(identity), '"not sure" names nothing');
  });
});

describe('FP-2 the evidence the scan had, and what each shape of it gives', () => {
  test('FP-2a new prices only: no price, the new price as context, and the gap says what is missing', () => {
    const v = value(IL_SHOPS());
    assert.deepEqual([v.status, v.prices, v.retail_new_ils], ['insufficient_evidence', null, 390]);
    assert.equal(v.retail_new_range.dispersed, true, '389 and 659 disagree: the cheapest shop sets the line');
  });
  test('FP-2b new prices in Israel + ONE used listing abroad (the founder\'s scan): no price; gap = 0 Israeli, 1 abroad as context', () => {
    const v = value([...IL_SHOPS(), abroad(60, { price_ils: 220 })]);
    assert.deepEqual([v.status, v.withdrawn], ['insufficient_evidence', WITHDRAWN.NO_LOCAL_EVIDENCE]);
    assert.deepEqual(v.evidence_gap, { israeli_private_found: 0, abroad_found: 1, price_level_measured: false, new_price_il: 390 });
  });
  test('FP-2c two exact used listings abroad, but no new price abroad to measure the level: still no number', () => {
    const v = value([...IL_SHOPS(), abroad(60, { price_ils: 220 }), abroad(65, { price_ils: 240 })]);
    assert.deepEqual([v.status, v.evidence_gap.price_level_measured, v.evidence_gap.abroad_found], ['insufficient_evidence', false, 2]);
  });
  test('FP-2d ISRAEL FIRST: two exact used listings abroad AND the level measured still make no Israeli price', () => {
    const v = value([...IL_SHOPS(), shop(130, { market: 'INTL', currency: 'USD', price_ils: 480, url: 'https://www.amazon.com/gpw', domain: 'www.amazon.com' }), abroad(60, { price_ils: 220 }), abroad(65, { price_ils: 240 })]);
    assert.deepEqual([v.status, v.prices, v.estimate_basis, v.withdrawn], ['insufficient_evidence', null, ESTIMATE_BASIS.ISRAEL, WITHDRAWN.NO_LOCAL_EVIDENCE]);
    assert.deepEqual(v.evidence_gap, { israeli_private_found: 0, abroad_found: 2, price_level_measured: true, new_price_il: 390 });
    assert.ok(v.evidence.filter((e) => e.market === 'INTL' && e.kind === 'used_listing').every((e) => !e.used && e.set_aside === 'abroad_without_israeli_reference'));
  });
  test('FP-2e a sealed or an old unit abroad, or a different model, never makes the estimate', () => {
    const level = shop(130, { market: 'INTL', currency: 'USD', price_ils: 480 });
    for (const over of [{ condition: 'new_sealed' }, { listed: '2024-01-01' }, { match: 'sibling_model' }, { match: 'close_comparable' }, { kind: 'refurbished' }]) {
      const v = value([...IL_SHOPS(), level, abroad(60, { price_ils: 220, ...over }), abroad(65, { price_ils: 240, ...over })]);
      assert.equal(v.status, 'insufficient_evidence', JSON.stringify(over));
    }
  });
  test('FP-2f one current Israeli used listing opens the ordinary gate: priced from Israel, with three prices in order', () => {
    const v = value([...IL_SHOPS(), il(250), abroad(60, { price_ils: 220 })]);
    assert.deepEqual([v.status, v.estimate_basis, v.evidence_gap], ['priced', ESTIMATE_BASIS.ISRAEL, null]);
    const g = v.prices.good;
    assert.ok(g.quick <= g.worth && g.worth <= g.list);
  });
});

describe('FP-3 condition moves all three prices together, by the stated ladder, with no new search', () => {
  test('FP-3a every condition has worth, quick and list, in order; worse condition is never worth more', () => {
    const v = value([il(250), il(270), il(260)]);
    let last = Infinity;
    for (const c of ['new_sealed', 'like_new', 'good', 'fair', 'poor']) {
      const b = v.prices[c];
      assert.ok(b.quick <= b.worth && b.worth <= b.list, `${c} ${JSON.stringify(b)}`);
      if (c !== 'new_sealed') { assert.ok(b.worth <= last, c); last = b.worth; }
    }
    assert.ok(CONDITION_FACTOR.fair < 1 && CONDITION_FACTOR.like_new > 1);
  });
});

test('FP-4 the stored row keeps where the number came from and what was missing', () => {
  const identity = normalizeIdentity(RAW_IDENTITY);
  const none = value([...IL_SHOPS(), abroad(60, { price_ils: 220 })]);
  const row = buildValuationRow({ id: 'v', userId: 'u', scanUuid: 's', identity, valuation: none, lang: 'he' });
  assert.equal(row.ai_raw_response.valuation.estimate_basis, ESTIMATE_BASIS.ISRAEL);
  assert.deepEqual(row.ai_raw_response.valuation.evidence_gap, none.evidence_gap);
  assert.equal(row.price_mid, null, 'no number stored for a withheld price');
});

// ── The second public scan of the same mouse (2026-11-08 11:10, scan 6f0a57d4, release 01a9fc1) ─────────────────────
// Its research was the 10:55 research of release b5a587a, reused from the shared hour-long cache: the new query for
// single used listings abroad never ran. These are its ten references exactly as the runtime log listed them.
const LOGGED_6F0A57D4 = [
  { url: 'https://www.zap.co.il/model.aspx?modelid=1005972', kind: 'new_retail', match: 'exact', market: 'IL', price_ils: 659, condition: 'new_sealed', binding: 'strong' },
  { url: 'https://www.bug.co.il/brand/logitech/gprowireless/', kind: 'new_retail', match: 'exact', market: 'IL', price_ils: 399, condition: 'new_sealed', binding: 'strong' },
  { url: 'https://www.wisebuy.co.il/product.aspx?category=c-mouse&productid=1005972', kind: 'new_retail', match: 'exact', market: 'IL', price_ils: 328, condition: 'new_sealed', binding: 'weak' },
  { url: 'https://www.logitechg.com/en-us/shop/p/pro-wireless-mouse', kind: 'new_retail', match: 'exact', market: 'INTL', price_ils: 351, condition: 'new_sealed', binding: 'strong' },
  { url: 'https://www.ad.co.il/archive/c/23?sp169=4614&view=list', kind: 'used_listing', match: 'exact', market: 'IL', price_ils: 400, condition: 'like_new', binding: 'weak', archived: true },
  { url: 'https://www.ad.co.il/archive/c/23?pageindex=6&sp169=4614&sp58=3588&withimage=1', kind: 'used_listing', match: 'exact', market: 'IL', price_ils: 500, condition: 'like_new', binding: 'weak', archived: true },
  { url: 'https://www.reddit.com/r/hardwareswap/comments/q6nzr1', kind: 'sold', match: 'exact', market: 'INTL', price_ils: 224, condition: 'unknown', binding: 'strong', archived: true },
  { url: 'https://www.reddit.com/r/hardwareswap/comments/wcxhhl', kind: 'sold', match: 'exact', market: 'INTL', price_ils: 192, condition: 'unknown', binding: 'strong', archived: true },
  { url: 'https://www.reddit.com/r/MouseMarket/comments/dz8ovb', kind: 'sold', match: 'exact', market: 'INTL', price_ils: 240, condition: 'unknown', binding: 'strong', archived: true },
  { url: 'https://www.reddit.com/r/MouseMarket/comments/owsyim', kind: 'used_listing', match: 'exact', market: 'INTL', price_ils: 256, condition: 'good', binding: 'strong', archived: true },
].map((e) => ({ domain: new URL(e.url).hostname, title: 't', price: e.price_ils, currency: 'ILS', page: e.kind === 'new_retail' ? 'shop_product' : 'listing', listed: null, seen: TODAY, ...e }));

describe('FP-5 the research is the search that made it', () => {
  test('FP-5a the logged evidence gives exactly what the screen said: no price, 0 Israeli, 0 usable abroad, level measured', () => {
    const v = value(LOGGED_6F0A57D4);
    assert.deepEqual([v.status, v.withdrawn], ['insufficient_evidence', WITHDRAWN.NO_LOCAL_EVIDENCE]);
    assert.deepEqual(v.evidence_gap, { israeli_private_found: 0, abroad_found: 0, price_level_measured: true, new_price_il: 400 }, 'the gap of scan 6f0a57d4 (logged then as 0 / 0 abroad usable)');
    // Archived Reddit posts (2019–2022) are history, not today's market; ad.co.il archive LIST pages tie no price to one ad.
    for (const e of v.evidence.filter((x) => /reddit/.test(x.url))) assert.equal(e.used, false);
    for (const e of v.evidence.filter((x) => /ad\.co\.il/.test(x.url))) assert.equal(e.set_aside, 'price_not_tied_to_product');
  });
  test('FP-5b ISRAEL FIRST: two current single used listings of the exact model abroad, beside that evidence, are context and price nothing', () => {
    const ebay = (n, ils) => ({ url: `https://www.ebay.com/itm/${n}`, domain: 'www.ebay.com', title: 't', price: ils, currency: 'USD', price_ils: ils, kind: 'used_listing', match: 'exact', market: 'INTL', condition: 'good', page: 'listing', listed: null, binding: 'strong', seen: TODAY });
    const v = value([...LOGGED_6F0A57D4, ebay(167883108555, 165), ebay(175809022704, 185)]);
    assert.deepEqual([v.status, v.prices, v.evidence_gap.abroad_found], ['insufficient_evidence', null, 2]);
    // ...and one current Israeli used listing beside them opens the gate: the Israeli listing leads, abroad joins at the measured level.
    const il = { url: 'https://m.homeless.co.il/yad2/viewad%2C1.aspx', domain: 'm.homeless.co.il', title: 't', price: 250, currency: 'ILS', price_ils: 250, kind: 'used_listing', match: 'exact', market: 'IL', condition: 'good', page: 'listing', listed: '2026-11-01', binding: 'strong', seen: TODAY };
    const opened = value([...LOGGED_6F0A57D4, ebay(167883108555, 165), ebay(175809022704, 185), il]);
    assert.deepEqual([opened.status, opened.estimate_basis, opened.local_evidence], ['priced', ESTIMATE_BASIS.ISRAEL, true]);
    assert.ok(opened.evidence.find((e) => e.url === il.url).used);
  });
  test('FP-5c the research key carries the query plan: a change to the search is a new key; an answer that changes no query is not', async () => {
    const { researchKey, RESEARCH_VERSION } = await import('../api/_lib/scan/service.js');
    const identity = normalizeIdentity(RAW_IDENTITY);
    const key = researchKey(identity);
    assert.ok(key.startsWith(`${marketKey(identity)}|r${RESEARCH_VERSION}:`), key);
    assert.equal(researchKey({ ...identity, confirmed: [{ attribute: 'usb receiver included', value: 'No' }] }, { question: 'Receiver?', text: 'No' }), key);
    assert.notEqual(researchKey({ ...identity, model_number: '910-005272' }), key);
  });
  test('FP-5d research stored under the old item-only key is not reused: the price step searches', async () => {
    const { runPrice, resetMarketCache } = await import('../api/_lib/scan/service.js');
    resetMarketCache();
    const identity = normalizeIdentity(RAW_IDENTITY);
    const old = { evidence: LOGGED_6F0A57D4, at: Date.now() - 15 * 60_000, searched: { date: TODAY }, fx_date: TODAY };
    const store = { load: async (k) => (k === marketKey(identity) ? old : null), save: async () => {} };
    let calls = 0;
    const fetchImpl = async () => { calls += 1; return new Response(JSON.stringify({ error: { message: 'offline' } }), { status: 503 }); };
    const r = await runPrice({ identity, store, fetchImpl, model: 'm', apiKey: 'k', safetyIdentifier: 's' });
    assert.ok(calls > 0, 'a search was attempted');
    assert.notEqual(r.reused, true);
    resetMarketCache();
  });
});

// ── The third public scan of the same mouse (2026-11-08 11:20, scan 62a07b50, release ac630a0): a fresh search, 83 pages
// reached, five references kept, and no record of WHERE the 78 others were lost. The research now says, stage by stage.
test('FP-6 the research records its funnel: hosts reached, prices the model reported, prices the page text verified', async () => {
  const { runPrice, resetMarketCache } = await import('../api/_lib/scan/service.js');
  const { fakeProvider, RAW_MARKET, RAW_EXPAND, NOW } = await import('./helpers/core-scan-fakes.mjs');
  const { resetFxCache } = await import('../api/_lib/scan/fx.js');
  resetMarketCache(); resetFxCache();
  const fetchImpl = fakeProvider({ markets: [{ evidence: [] }], expand: [RAW_EXPAND] });
  const store = { load: async () => null, save: async () => {} };
  const r = await runPrice({ identity: normalizeIdentity(RAW_IDENTITY), store, fetchImpl, model: 'm', apiKey: 'k', safetyIdentifier: 's', now: () => NOW });
  const funnel = r.valuation.searched.funnel;
  assert.deepEqual(funnel.map((f) => f.stage), ['local', 'expand']);
  for (const f of funnel) {
    assert.ok(f.reached > 0 && Object.values(f.hosts).reduce((a, b) => a + b, 0) === f.reached, JSON.stringify(f));
    assert.ok(f.verified + f.unverified <= f.reported || f.reported === 0, JSON.stringify(f));
    assert.ok(Object.keys(f.hosts).every((h) => !h.startsWith('www.')));
  }
  assert.equal(funnel[0].reported, 0);
  assert.equal(funnel[1].reported, RAW_EXPAND.evidence.length);
  resetMarketCache();
});
