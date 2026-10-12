// ══════════════════════════════════════════════════════════════════════════════
// CORE SCAN — REAL-WORLD RECOVERY (the founder's iPhone scans, 2026-10-11)
//
// Nine real scans identified well and priced little. These suites hold the
// code-side causes that could be fixed, each named for the scan that showed it.
// They prove code behaviour on fixtures: none of them is a real market, and a
// passing suite says nothing about what a live search will find.
//
//   RW-1  seller-reported is not observed: the owner's answer is "confirmed",
//         the model cannot promote it, it settles the model's own name for the
//         attribute, and a note about not knowing it comes down (the perfume)
//   RW-2  one more photograph after the search: a technical item with no model
//         code and no second-hand reference is offered the label, once, never
//         required; the code then leads the next search (the Ninja blender)
//   RW-3  a specialised market shows no new price as if it were a value, and
//         foreign listings are context, never a figure (the Yaris, the Funko)
//   RW-4  a phone listing that is old or above the new price prices nothing
//         (the Huawei), and the scan's own record says why
//   RW-5  a variant nobody asked about: a phone's storage the model called
//         unknown and high without a question is asked for by the server; left
//         unknown, the price is not presented as the exact product's (the Huawei)
//
//   node --test tests/core-scan-recovery.test.mjs
// ══════════════════════════════════════════════════════════════════════════════
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeIdentity, completeIdentity, questionAfterResearch, buildIdentityPrompt, openVariant, recordAnswer } from '../api/_lib/scan/identify.js';
import { buildSearchQueries } from '../api/_lib/scan/market.js';
import { buildValuation, STRATEGY, WITHDRAWN, SET_ASIDE } from '../api/_lib/scan/valuation.js';
import { BIND_REASON } from '../api/_lib/scan/binding.js';
import { runIdentify, runPrice, resetMarketCache, isApproximate } from '../api/_lib/scan/service.js';
import { resetFxCache } from '../api/_lib/scan/fx.js';
import { createScanHandler, diagnosticsOf } from '../api/scan.js';
import * as CFG from '../api/_lib/scan/config.js';
import { IMG, RAW_IDENTITY, TODAY, NOW, SOURCES, fakeProvider } from './helpers/core-scan-fakes.mjs';

const UUID = '11111111-2222-3333-4444-555555555555';
const BASE = { ...RAW_IDENTITY, visible_text: [], alternatives: [], followup: { kind: 'none', affects: 'none', question: null, options: [] }, attributes: [], clarifications: [], eligibility_notes: [] };
const raw = (over) => ({ ...BASE, ...over });
const scan = (over, opts = {}) => completeIdentity(normalizeIdentity(raw(over)), { lang: 'en', followupsLeft: CFG.MAX_FOLLOWUPS, ...opts });
const A = (name, value, basis = 'observed', matters = 'medium') => ({ name, value, basis, matters });
/** A verified reference as the pool holds it. */
const ref = (url, price, over = {}) => ({ url, domain: new URL(url).host, title: 't', price, currency: 'ILS', price_ils: price, kind: 'used_listing', match: 'exact', market: 'IL', condition: 'good', page: 'listing', listed: '2026-10-01', binding: 'strong', stock: 'unknown', shipping: null, seen: TODAY, ...over });

const PERFUME = raw({ category: 'Beauty', item_type: 'perfume', brand: 'Viktor&Rolf', product_family: 'Spicebomb', model: 'Spicebomb Extreme', size_or_capacity: '90 ml', canonical_name: 'viktor&rolf spicebomb extreme', display_name: 'Viktor&Rolf Spicebomb Extreme', market_class: 'fragrance_cosmetics', identity_precision: 'exact_model',
  attributes: [A('bottle size', '90 ml'), A('remaining volume', null, 'unknown', 'high'), A('sealed', 'no')], uncertainty_note: 'Remaining amount unknown' });
const NINJA = raw({ category: 'Home', item_type: 'blender', brand: 'Ninja', product_family: 'Power Blender', model: 'Power Blender Duo Pro', canonical_name: 'ninja power blender duo pro', display_name: 'Ninja Power Blender Duo Pro', exact_model_established: true, market_class: 'consumer_electronics', identity_precision: 'exact_model',
  search: { hebrew_name: 'בלנדר נינג\'ה', aliases: [], model_numbers: [] } });
const NO_RESALE = { status: 'insufficient_evidence', withdrawn: WITHDRAWN.NO_RESALE_EVIDENCE, counts: { resale: 0 } };
/** A phone whose storage the model called unknown and high — and proposed no question for. */
const PHONE = raw({ category: 'Electronics', item_type: 'smartphone', brand: 'Huawei', product_family: 'P30', model: 'P30 Pro', canonical_name: 'huawei p30 pro', display_name: 'Huawei P30 Pro', exact_model_established: true, market_class: 'consumer_electronics', identity_precision: 'exact_model',
  search: { hebrew_name: 'וואווי P30 פרו', aliases: [], model_numbers: [] }, attributes: [A('storage', null, 'unknown', 'high'), A('color', 'blue')] });
/** The shared store as the suites hold it: what the service's own `store` argument expects. */
const fakeStore = () => ({ rows: new Map(), async load(k) { return this.rows.get(k) ?? null; }, async save(k, r) { this.rows.set(k, JSON.parse(JSON.stringify(r))); } });
const listing = (url, title, price, over = {}) => ({ url, title, price, currency: 'ILS', kind: 'used_listing', match: 'exact', market: 'IL', condition: 'good', page: 'listing', listed: '2026-10-01', stock: 'unknown', shipping: null, ...over });

describe('RW-1 seller-reported is not observed', () => {
  test('RW-1a the model\'s "confirmed" is read as inferred; only the server\'s record of the owner\'s answers makes a fact confirmed', () => {
    const i = normalizeIdentity(raw({ attributes: [A('storage', '128 GB', 'confirmed', 'high'), A('color', 'blue', 'observed')] }));
    assert.deepEqual(i.attributes.map((a) => [a.name, a.basis]), [['storage', 'inferred'], ['color', 'observed']]);
    const prompt = buildIdentityPrompt({ lang: 'en', prior: { display_name: 'x', confirmed: [{ attribute: 'remaining', value: 'About 75%' }] } });
    assert.match(prompt, /basis "confirmed" \(never "observed"/);
    assert.match(prompt, /do not call it unknown or uncertain anywhere/);
    assert.match(buildIdentityPrompt({ lang: 'en' }), /storage, capacity, generation, year, edition, size — is unknown and matters high, include a clarification/);
  });
  test('RW-1b the owner\'s "about 75%" settles the model\'s "remaining volume", is marked as the owner\'s word, and the note "remaining amount unknown" comes down; a note about something else stays', () => {
    const confirmed = [{ attribute: 'remaining', value: 'About 75%', question: 'How much perfume is left in the bottle?' }];
    const p = completeIdentity(normalizeIdentity(PERFUME), { lang: 'en', followupsLeft: 2, confirmed });
    assert.deepEqual(p.attributes.find((a) => a.name === 'remaining volume'), { name: 'remaining volume', value: 'About 75%', basis: 'confirmed', matters: 'high' });
    assert.equal(p.attributes.filter((a) => /remaining/.test(a.name)).length, 1, 'settled, not duplicated');
    assert.equal(p.uncertainty_note, null);
    assert.equal(p.followup.kind, 'none', 'answered: not asked again');
    const other = completeIdentity(normalizeIdentity({ ...PERFUME, uncertainty_note: 'Batch code not legible' }), { lang: 'en', followupsLeft: 2, confirmed });
    assert.equal(other.uncertainty_note, 'Batch code not legible');
    const he = completeIdentity(normalizeIdentity({ ...PERFUME, uncertainty_note: 'כמות הבושם שנותרה לא ידועה' }), { lang: 'he', followupsLeft: 2, confirmed });
    assert.equal(he.uncertainty_note, null);
  });
  test('RW-1c "model" is never "model number": a qualifier joins names, a different attribute does not', () => {
    const i = completeIdentity(normalizeIdentity(raw({ attributes: [A('model number', 'TB301', 'observed', 'high'), A('storage capacity', null, 'unknown', 'high')] })), {
      lang: 'en', followupsLeft: 2, confirmed: [{ attribute: 'model', value: 'Duo Pro', question: 'Which model?' }, { attribute: 'storage', value: '256 GB', question: 'Storage?' }],
    });
    assert.equal(i.attributes.find((a) => a.name === 'model number').value, 'TB301', 'untouched');
    assert.deepEqual([i.attributes.find((a) => a.name === 'storage capacity').value, i.attributes.find((a) => a.name === 'storage capacity').basis, i.size_or_capacity], ['256 GB', 'confirmed', '256 GB']);
    assert.ok(i.attributes.some((a) => a.name === 'model' && a.basis === 'confirmed'), 'the owner\'s model is kept as its own fact');
  });
  test('RW-1d the note about the unknown comes down only for what the owner answered: a note that still names something open stays; whole words, never substrings; "model" never settles "model number"; nothing inferred is promoted', () => {
    const settle = (over, confirmed, lang = 'en') => completeIdentity(normalizeIdentity(raw(over)), { lang, followupsLeft: 2, confirmed }).uncertainty_note;
    const q = (attribute, value) => ({ attribute, value, question: `${attribute}?` });
    // Storage confirmed; colour still unknown: the note stays. Both confirmed: it comes down.
    const twoThings = { attributes: [A('storage', null, 'unknown', 'high'), A('colour', null, 'unknown')], color: null, uncertainty_note: 'Storage and colour unknown' };
    assert.equal(settle(twoThings, [q('storage', '128 GB')]), 'Storage and colour unknown');
    assert.equal(settle(twoThings, [q('storage', '128 GB'), q('colour', 'blue')]), null);
    // Year confirmed; trim and mileage still unknown.
    const car = { category: 'Vehicles', item_type: 'car', market_class: 'vehicle', attributes: [A('year', null, 'unknown', 'high'), A('trim', null, 'unknown', 'high'), A('mileage', null, 'unknown', 'high')], uncertainty_note: 'Year, trim and mileage cannot be read' };
    assert.equal(settle(car, [q('year', '2019')]), 'Year, trim and mileage cannot be read');
    // "age" is not inside "storage": whole words only. Storage itself settles the note (its capacity is the core field).
    const storage = { attributes: [A('storage capacity', null, 'unknown', 'high'), A('age', null, 'unknown')], uncertainty_note: 'Storage capacity unknown' };
    assert.equal(settle(storage, [q('age', '2 years')]), 'Storage capacity unknown');
    assert.equal(settle(storage, [q('storage', '256 GB')]), null);
    // The owner's model is not the model number; the model number, once given, is.
    const code = { model_number: null, uncertainty_note: 'Model number not legible' };
    assert.equal(settle(code, [q('model', 'Duo Pro')]), 'Model number not legible');
    assert.equal(settle(code, [q('model number', 'BN751')]), null);
    // A size confirmed leaves the second clause standing; a word that happens to be "left" is not the fragrance's remaining amount.
    assert.equal(settle({ attributes: [A('size', null, 'unknown', 'high')], color: null, uncertainty_note: 'Size unknown; colour not visible' }, [q('size', '42')]), 'Size unknown; colour not visible');
    assert.equal(settle({ ...PERFUME, uncertainty_note: 'Left side of the label is torn' }, [q('remaining', 'About 75%')]), 'Left side of the label is torn');
    // A Hebrew note is not parsed for English attribute names: it stays (the fragrance's "remaining" is the one exception, RW-1b).
    assert.equal(settle({ attributes: [A('storage', null, 'unknown', 'high')], uncertainty_note: 'נפח אחסון לא ידוע' }, [q('storage', '128 GB')], 'he'), 'נפח אחסון לא ידוע');
    // An inferred attribute is still inferred after the owner answers something else.
    const i = completeIdentity(normalizeIdentity(raw({ attributes: [A('generation', '2nd', 'inferred', 'high'), A('storage', null, 'unknown', 'high')] })), { lang: 'en', followupsLeft: 2, confirmed: [q('storage', '128 GB')] });
    assert.deepEqual(i.attributes.map((a) => [a.name, a.basis]), [['generation', 'inferred'], ['storage', 'confirmed']]);
  });
});

describe('RW-2 one more photograph after the search', () => {
  test('RW-2a a technical item with no model code and no second-hand reference is offered the label photograph, not required; a code, a price, a specialised market, a spent allowance or an open question mean no', () => {
    const ninja = scan(NINJA);
    assert.equal(ninja.followup.kind, 'none', 'the identity named one product: the search ran');
    const q = questionAfterResearch(ninja, NO_RESALE, { lang: 'en', followupsLeft: 2 });
    assert.deepEqual([q.kind, q.affects, q.attribute, q.required], ['photo', 'identity', 'model label', undefined]);
    assert.match(q.question, /model label/);
    assert.match(questionAfterResearch(ninja, NO_RESALE, { lang: 'he', followupsLeft: 2 }).question, /תווית הדגם/);
    assert.equal(questionAfterResearch({ ...ninja, model_number: 'TB301' }, NO_RESALE, { lang: 'en', followupsLeft: 2 }), null, 'a code was read: the label would say nothing new');
    assert.equal(questionAfterResearch({ ...ninja, search: { ...ninja.search, model_numbers: ['BN751'] } }, NO_RESALE, { lang: 'en', followupsLeft: 2 }), null);
    assert.equal(questionAfterResearch(ninja, { ...NO_RESALE, status: 'priced', counts: { resale: 2 } }, { lang: 'en', followupsLeft: 2 }), null, 'priced: nothing to add');
    assert.equal(questionAfterResearch(ninja, NO_RESALE, { lang: 'en', followupsLeft: 0 }), null, 'the allowance is spent');
    assert.equal(questionAfterResearch({ ...ninja, asked_label: true }, NO_RESALE, { lang: 'en', followupsLeft: 2 }), null, 'asked once already');
    assert.equal(questionAfterResearch({ ...ninja, owner_stated: true }, NO_RESALE, { lang: 'en', followupsLeft: 2 }), null, 'the owner said what it is');
    assert.equal(questionAfterResearch(scan(raw({ category: 'Furniture', item_type: 'sofa', market_class: 'furniture', identity_precision: 'descriptive', model: null, canonical_name: 'grey sofa' })), NO_RESALE, { lang: 'en', followupsLeft: 2 }), null, 'a sofa has no model label');
    assert.equal(questionAfterResearch(scan(raw({ category: 'Vehicles', item_type: 'car', market_class: 'vehicle', model: 'Yaris Cross' })), NO_RESALE, { lang: 'en', followupsLeft: 2 }), null, 'a car gets no number either way');
  });
  test('RW-2b once the code is read it leads the search, and the model name follows', () => {
    const coded = scan({ ...NINJA, model_number: 'BN751', visible_text: ['BN751'] });
    const q = buildSearchQueries({ identity: coded });
    assert.match(q[0], /^BN751 יד שנייה/);
    assert.ok(q.some((s) => /Ninja Power Blender Duo Pro יד שנייה למכירה/.test(s)));
  });
  test('RW-2c the endpoint: no price → the label question rides back in a re-signed token with the scan\'s diagnostics recorded; the label photograph goes round, the code is read, the search runs under the code; a label with no code is not asked for twice', async () => {
    process.env.SCAN_STATE_SECRET = 's'.repeat(40); process.env.OPENAI_API_KEY = 'k'; process.env.SCAN_ENGINE_V2_USER_IDS = 'user-1';
    const identities = [scan(NINJA), scan({ ...NINJA, model_number: 'BN751', visible_text: ['BN751'] })];
    const log = { price: [], events: [] };
    const handler = createScanHandler({
      verify: async (h) => (h === 'Bearer good' ? { id: 'user-1' } : null),
      charge: async () => ({ allowed: true, charged: true, limitType: null, retryAfter: 0 }),
      refund: async () => {},
      // The service carries `asked_label` from the prior identity (RW-2d); this stand-in does the same.
      identify: async ({ prior }) => { const identity = { ...identities.shift(), ...(prior?.identity?.asked_label ? { asked_label: true } : {}) }; return { status: 'identified', identity, followups: prior?.followups ?? 0, default_condition: 'good', billed: true, call: { stage: 'identify', model: 'm', ms: 1, usage: null } }; },
      price: async (args) => {
        log.price.push(args);
        const sibling = { url: 'https://www.zap.co.il/model.aspx?modelid=1', domain: 'zap.co.il', title: 'Ninja CB103', price: 300, currency: 'ILS', price_ils: 300, kind: 'used_listing', match: 'sibling_model', market: 'IL', used: false, set_aside: 'different_model' };
        return { status: 'insufficient_evidence', valuation: { status: 'insufficient_evidence', prices: null, counts: { resale: 0, unverified: 1, unbound: 0 }, withdrawn: WITHDRAWN.NO_RESALE_EVIDENCE, no_price_reason: WITHDRAWN.NO_RESALE_EVIDENCE, evidence: [sibling], searched: { date: TODAY, queries: 6, planned: 8, pages: 14, stages: ['local', 'expand'] } }, reused: false, call: { stage: 'market', model: 'm', ms: 1, usage: null, tool_calls: 2 } };
      },
      record: async () => 'val-1',
      logEvent: async (s, type, payload) => { log.events.push({ type, payload }); },
    });
    const call = async (body) => { const res = await handler(new Request('https://getworth.test/api/scan', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer good' }, body: JSON.stringify(body) })); return { status: res.status, payload: await res.json() }; };
    const first = await call({ action: 'identify', scan_uuid: UUID, lang: 'en', images: [IMG] });
    assert.equal(first.payload.identity.followup.kind, 'none');
    const priced = await call({ action: 'price', scan_uuid: UUID, lang: 'en', token: first.payload.token });
    assert.deepEqual([priced.status, priced.payload.status, priced.payload.identity.followup.kind, priced.payload.identity.followup.attribute, priced.payload.identity.followup.required, priced.payload.identity.asked_label], [200, 'insufficient_evidence', 'photo', 'model label', undefined, true]);
    assert.ok(priced.payload.token && priced.payload.token !== first.payload.token, 'a re-signed token carries the question');
    const event = log.events.find((e) => e.type === 'core_scan_priced').payload;
    assert.deepEqual([event.asked_after, event.diagnostics.evidence, event.diagnostics.reasons, event.diagnostics.hosts, event.diagnostics.searched.planned, event.diagnostics.unverified], ['model label', 1, { different_model: 1 }, { 'zap.co.il': 1 }, 8, 1]);
    assert.ok(!JSON.stringify(event).includes('user-1') && !JSON.stringify(event).includes(IMG.slice(30, 60)), 'no person, no photograph in the record');
    // The label photograph: the same scan, one more image, the code read.
    const second = await call({ action: 'identify', scan_uuid: UUID, lang: 'en', images: [IMG, IMG], token: priced.payload.token });
    assert.deepEqual([second.payload.status, second.payload.identity.model_number, second.payload.identity.followup.kind, second.payload.identity.asked_label], ['identified', 'BN751', 'none', true]);
    const again = await call({ action: 'price', scan_uuid: UUID, lang: 'en', token: second.payload.token });
    assert.equal(log.price.length, 2);
    assert.equal(log.price[1].identity.model_number, 'BN751', 'the search runs with the code');
    assert.notEqual(buildSearchQueries({ identity: log.price[1].identity })[0], buildSearchQueries({ identity: log.price[0].identity })[0]);
    assert.deepEqual([again.payload.status, again.payload.identity?.followup?.kind ?? 'none', again.payload.token ?? null], ['insufficient_evidence', 'none', null], 'still no price, and the label is not asked for twice');
  });
  test('RW-2d the service carries "asked once" across the photograph round, and a spent allowance stops the question', async () => {
    const r = await runIdentify({ images: [IMG, IMG], lang: 'en', model: 'm', apiKey: 'k', prior: { identity: { ...scan(NINJA), asked_label: true }, followups: 1 }, fetchImpl: fakeProvider({ identities: [{ ...RAW_IDENTITY, ...NINJA }] }) });
    assert.equal(r.identity.asked_label, true);
    assert.equal(questionAfterResearch(r.identity, NO_RESALE, { lang: 'en', followupsLeft: CFG.MAX_FOLLOWUPS - r.followups }), null);
  });
  test('RW-2e the whole path through the REAL steps: photograph → identity → search finds only other Ninjas → the label is offered → the code is read → a SECOND search runs, under the code, and its fresh evidence prices the item (the hour-old research is not reused)', async () => {
    process.env.SCAN_STATE_SECRET = 's'.repeat(40); process.env.OPENAI_API_KEY = 'k'; process.env.SCAN_ENGINE_V2_USER_IDS = 'user-1';
    resetMarketCache(); resetFxCache();
    const SIBLING_URL = 'https://www.zap.co.il/model.aspx?modelid=1';
    const CODE_URL = 'https://www.secondhand.example.co.il/item/751';
    const sibling = listing(SIBLING_URL, 'Ninja CB103 בלנדר', 300, { match: 'sibling_model' });
    const fresh = listing(CODE_URL, 'Ninja BN751 Power Blender Duo Pro יד שנייה', 450);
    // One provider for both steps: the two identities in order, then the Israeli searches in order — the first finds a
    // sibling, the second (under the code) finds the item; the wider search finds nothing.
    const fetchImpl = fakeProvider({ identities: [{ ...RAW_IDENTITY, ...NINJA }, { ...RAW_IDENTITY, ...NINJA, model_number: 'BN751', visible_text: ['BN751'] }], markets: [{ evidence: [sibling] }, { evidence: [fresh] }], reached: [SIBLING_URL, CODE_URL], pageText: {} });
    const store = fakeStore();
    const results = [];
    const events = [];
    const handler = createScanHandler({
      verify: async (h) => (h === 'Bearer good' ? { id: 'user-1' } : null),
      charge: async () => ({ allowed: true, charged: true, limitType: null, retryAfter: 0 }),
      refund: async () => {},
      identify: (args) => runIdentify({ ...args, fetchImpl }),
      price: async (args) => { const r = await runPrice({ ...args, fetchImpl, store, now: () => NOW }); results.push(r); return r; },
      record: async () => 'val-1',
      logEvent: async (s, type, payload) => { events.push({ type, payload }); },
    });
    const call = async (body) => { const res = await handler(new Request('https://getworth.test/api/scan', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer good' }, body: JSON.stringify(body) })); return { status: res.status, payload: await res.json() }; };
    // 1. The photograph: one product by its marketing name, no code, nothing to ask.
    const first = await call({ action: 'identify', scan_uuid: UUID, lang: 'en', images: [IMG] });
    assert.deepEqual([first.status, first.payload.identity.model_number, first.payload.identity.followup.kind], [200, null, 'none']);
    // 2. The search: Israel, then further; only another Ninja found; no price; the label offered in a re-signed token.
    const priced = await call({ action: 'price', scan_uuid: UUID, lang: 'en', token: first.payload.token });
    assert.deepEqual([priced.payload.status, priced.payload.reused, priced.payload.identity.followup.kind, priced.payload.identity.followup.attribute], ['insufficient_evidence', false, 'photo', 'model label']);
    assert.deepEqual([results[0].reused, results[0].call.tool_calls, results[0].call.stages, results[0].valuation.counts.resale], [false, 2, ['local', 'expand'], 0]);
    assert.equal(fetchImpl.of('market').length, 2);
    const firstPrompt = fetchImpl.of('market')[0].body.input[0].content[0].text;
    assert.match(firstPrompt, /Ninja Power Blender Duo Pro יד שנייה למכירה/, 'the first search is for the name');
    assert.doesNotMatch(firstPrompt, /BN751/);
    // 3. The label photograph: the same scan, one more image, the code read off it.
    const second = await call({ action: 'identify', scan_uuid: UUID, lang: 'en', images: [IMG, IMG], token: priced.payload.token });
    assert.deepEqual([second.payload.status, second.payload.identity.model_number, second.payload.identity.asked_label, second.payload.identity.followup.kind], ['identified', 'BN751', true, 'none']);
    // 4. The price step again, within the hour: a NEW search, under the code, and a price from what it found.
    const again = await call({ action: 'price', scan_uuid: UUID, lang: 'en', token: second.payload.token });
    assert.equal(results.length, 2);
    assert.notEqual(results[1].market_key, results[0].market_key, 'the code is part of what the item is');
    assert.ok(results[1].market_key.endsWith('|code=bn751'), results[1].market_key);
    assert.deepEqual([results[1].reused, results[1].call.tool_calls > 0, results[1].call.stages[0]], [false, true, 'local'], 'the second search was made');
    assert.equal(fetchImpl.of('market').length, 4, 'two more searches, not zero');
    const secondPrompt = fetchImpl.of('market')[2].body.input[0].content[0].text;
    assert.match(secondPrompt, /BN751 יד שנייה OR למכירה OR משומש/, 'the second search leads with the code');
    assert.deepEqual([again.payload.status, again.payload.reused, again.payload.valuation.counts.resale, again.payload.valuation.approximate], ['priced', false, 1, false]);
    const used = again.payload.valuation.evidence.find((e) => e.url === CODE_URL);
    assert.deepEqual([used.used, used.match, used.binding, used.price_ils], [true, 'exact', 'strong', 450], 'fresh evidence, found under the code, bound and priced from');
    assert.ok(again.payload.valuation.prices.good.low > 0);
    assert.ok(!again.payload.valuation.evidence.some((e) => e.url === SIBLING_URL && e.used), 'the sibling from the first search is not priced from');
    assert.equal(again.payload.identity?.followup?.kind ?? 'none', 'none', 'nothing more to ask');
    // The scan's own record says what happened, twice.
    const recorded = events.filter((e) => e.type === 'core_scan_priced').map((e) => e.payload);
    assert.deepEqual(recorded.map((p) => [p.status, p.reused, p.tool_calls, p.asked_after]), [['insufficient_evidence', false, 2, 'model label'], ['priced', false, 2, null]]);
    // And a plain second look at the SAME identity, with no code, still reads the hour-old research: reuse is kept where the item did not change.
    const same = await runPrice({ identity: first.payload.identity, scanUuid: UUID, model: 'm', apiKey: 'k', fetchImpl, store, now: () => NOW + 60_000 });
    assert.deepEqual([same.reused, same.call.tool_calls, fetchImpl.of('market').length], [true, 0, 4]);
  });
});

describe('RW-3 a specialised market: context only, no figure of any kind', () => {
  test('RW-3a a car: the new car\'s price is not shown as the used car\'s value — no anchor, no retail line, the shop page is context', () => {
    const v = buildValuation({ strategy: STRATEGY.SPECIALISED, today: TODAY, evidence: [
      ref(SOURCES.IL_RETAIL, 161000, { kind: 'new_retail', condition: 'new_sealed', page: 'shop_product', stock: 'in_stock' }),
      ref(SOURCES.IL_USED_1, 120000), ref(SOURCES.IL_USED_2, 118000),
    ] });
    assert.deepEqual([v.status, v.withdrawn, v.prices, v.retail_new_ils, v.retail_new_in_stock, v.retail_new_range, v.counts.retail_il, v.counts.resale], ['insufficient_evidence', WITHDRAWN.NO_CALIBRATED_METHOD, null, null, null, null, 0, 0]);
    assert.ok(v.evidence.every((e) => e.set_aside === SET_ASIDE.SPECIALISED_CONTEXT && !e.used), 'every reference, the shop\'s included, is context');
    // The same evidence for an EXACT item has its anchor: the rule is the strategy's.
    assert.equal(buildValuation({ today: TODAY, evidence: [ref(SOURCES.IL_RETAIL, 1610, { kind: 'new_retail', condition: 'new_sealed', page: 'shop_product', stock: 'in_stock' }), ref(SOURCES.IL_USED_1, 1200)] }).retail_new_ils, 1600);
  });
  test('RW-3b a collectible: foreign listings are verified and shown, never a price, never an Israeli reference, and no spread is offered as a range', () => {
    const v = buildValuation({ strategy: STRATEGY.SPECIALISED, today: TODAY, evidence: [
      ref(SOURCES.INTL_USED, 440, { market: 'INTL', currency: 'USD', price: 125, kind: 'sold' }),
      ref('https://www.ebay.com/itm/2', 215, { market: 'INTL', currency: 'USD', price: 61.35 }),
      ref('https://www.ebay.com/itm/3', 245, { market: 'INTL', currency: 'USD', price: 69.71 }),
    ] });
    assert.deepEqual([v.status, v.withdrawn, v.prices, v.local_evidence, v.counts.resale, v.counts.intl_used_exact], ['insufficient_evidence', WITHDRAWN.NO_CALIBRATED_METHOD, null, false, 0, 0]);
    assert.ok(v.evidence.every((e) => e.set_aside === SET_ASIDE.SPECIALISED_CONTEXT && !e.used && e.weight === 0));
  });
});

describe('RW-4 a phone listing that is old or above the new price', () => {
  test('RW-4a one Israeli listing from 2024 is old: it opens no gate and is shown as such; one above the new price is not a second-hand price; one with no date still counts, at a lower weight', () => {
    const old = buildValuation({ today: TODAY, evidence: [ref(SOURCES.IL_USED_1, 1200, { listed: '2025-05-01' })] });
    assert.deepEqual([old.status, old.withdrawn, old.evidence[0].set_aside, old.evidence[0].freshness], ['insufficient_evidence', WITHDRAWN.NO_LOCAL_EVIDENCE, SET_ASIDE.NOT_CURRENT, 'older']);
    assert.equal(buildValuation({ today: TODAY, evidence: [ref(SOURCES.IL_USED_1, 1200, { listed: '2024-05-01' })] }).evidence[0].freshness, 'archived', 'two years on, the site\'s history');
    const dear = buildValuation({ today: TODAY, evidence: [ref(SOURCES.IL_USED_1, 3400), ref(SOURCES.IL_RETAIL, 2000, { kind: 'new_retail', condition: 'new_sealed', page: 'shop_product', stock: 'in_stock' })] });
    assert.deepEqual([dear.status, dear.evidence.find((e) => e.price === 3400).set_aside, dear.retail_new_ils], ['insufficient_evidence', SET_ASIDE.ABOVE_NEW, 2000]);
    const undated = buildValuation({ today: TODAY, evidence: [ref(SOURCES.IL_USED_1, 1200, { listed: null })] });
    assert.deepEqual([undated.status, undated.price_confidence, undated.evidence[0].freshness, undated.evidence[0].weight], ['priced', 'low', 'unknown', 0.6]);
  });
  test('RW-4b the scan\'s own record says why: reasons and hosts as counts, nothing else', () => {
    const v = buildValuation({ today: TODAY, evidence: [ref(SOURCES.IL_USED_1, 1200, { listed: '2024-05-01' }), ref(SOURCES.INTL_USED, 900, { market: 'INTL', currency: 'USD', price: 250 })], searched: { date: TODAY, queries: 4, planned: 8, pages: 28, stages: ['local'] } });
    const d = diagnosticsOf(v);
    assert.deepEqual(d, { searched: { date: TODAY, queries: 4, planned: 8, pages: 28, stages: ['local'] }, evidence: 2, reasons: { [SET_ASIDE.NOT_CURRENT]: 1, [SET_ASIDE.ABROAD_ONLY]: 1 }, hosts: { 'www.secondhand.example.co.il': 1, 'www.used.example.com': 1 }, unverified: 0, unbound: 0 });
    assert.equal(buildValuation({ today: TODAY, evidence: [ref(SOURCES.IL_USED_1, 1200, { listed: '2025-05-01' })] }).evidence[0].freshness, 'older');
    assert.deepEqual(diagnosticsOf(null), { searched: null, evidence: 0, reasons: {}, hosts: {}, unverified: null, unbound: null });
  });
});

describe('RW-5 a variant nobody asked about', () => {
  const phone = (over = {}, opts = {}) => scan({ ...PHONE, ...over }, opts);
  test('RW-5a a phone\'s storage the model called unknown and high, with no question for it, is asked for by the server — required, before the search; the answer settles the core field and joins the search, and the price is exact', () => {
    const p = phone();
    assert.equal(openVariant(p), 'storage');
    assert.deepEqual([p.followup.kind, p.followup.required, p.followup.attribute, p.followup.options, p.followup.question], ['choice', true, 'storage', ['64 GB', '128 GB', '256 GB', '512 GB'], 'How much storage does it have?']);
    assert.match(phone({}, { lang: 'he' }).followup.question, /נפח האחסון/);
    assert.equal(isApproximate(p, null), true, 'with the question open, nothing is exact yet');
    const { identity: answered, answer } = recordAnswer(p, 1, { lang: 'en', followupsLeft: 2 });
    assert.deepEqual([answered.size_or_capacity, answered.attributes.find((a) => a.name === 'storage').basis, answered.followup.kind, openVariant(answered), isApproximate(answered, answer)], ['128 GB', 'confirmed', 'none', null, false]);
    assert.ok(buildSearchQueries({ identity: answered, answer }).some((q) => /P30 Pro 128 GB/.test(q)), 'the storage is searched for');
    const own = recordAnswer(p, { other: '8 GB' }, { lang: 'en', followupsLeft: 2 }).identity;
    assert.deepEqual([own.size_or_capacity, openVariant(own)], ['8 GB', null], 'the owner\'s own value is as good as an offered one');
  });
  test('RW-5b left unknown — "not sure", or the allowance spent — it is not asked again, and the price is approximate, never exact', () => {
    const unsure = recordAnswer(phone(), 'unsure', { lang: 'en', followupsLeft: 2 });
    assert.deepEqual([unsure.identity.followup.kind, openVariant(unsure.identity), isApproximate(unsure.identity, unsure.answer)], ['none', 'storage', true]);
    const spent = phone({}, { followupsLeft: 0 });
    assert.deepEqual([spent.followup.kind, openVariant(spent), isApproximate(spent, null)], ['none', 'storage', true]);
  });
  test('RW-5c the model\'s own storage question wins; the server asks nothing where the photograph showed the storage, where it matters less, where the attribute is not a variant, or where the item is not a technical exact-model item', () => {
    const own = phone({ clarifications: [{ attribute: 'storage', kind: 'choice', question: 'What storage size is it?', options: ['128 GB', '256 GB'], unit: null, impact: 'high', affects: 'identity' }] });
    assert.deepEqual([own.followup.question, own.followup.required], ['What storage size is it?', true]);
    // The photograph showed it: a figure in the capacity field beside a storage the model OBSERVED (or did not list). The same
    // figure beside a storage the model itself called unknown is the model's word against its field, and the doubt wins (RW-5f).
    const seen = phone({ size_or_capacity: '128 GB', attributes: [A('storage', '128 GB', 'observed', 'high')] });
    assert.deepEqual([openVariant(seen), seen.followup.kind], [null, 'none'], 'the photograph showed it');
    assert.deepEqual([openVariant(phone({ size_or_capacity: '128 GB', attributes: [] })), phone({ size_or_capacity: '128 GB', attributes: [] }).followup.kind], [null, 'none']);
    assert.equal(openVariant(phone({ size_or_capacity: '128 GB' })), 'storage', 'the model called the storage unknown: its figure does not close it');
    // A camera is technical but not sold by storage: the model's "medium" is taken at its word there, and a high unknown that is not a variant asks nothing.
    const camera = (attributes) => scan(raw({ category: 'Electronics', item_type: 'camera', brand: 'Sony', model: 'A7 III', canonical_name: 'sony a7 iii', exact_model_established: true, market_class: 'consumer_electronics', identity_precision: 'exact_model', attributes }));
    assert.equal(openVariant(camera([A('storage', null, 'unknown', 'medium')])), null, 'matters less, and not a device sold by storage: no question, and exact');
    assert.equal(openVariant(camera([A('lens mount', null, 'unknown', 'high')])), null, 'not a variant the item is sold as');
    assert.equal(openVariant(scan(raw({ category: 'Tools', item_type: 'cordless drill', market_class: 'tools', attributes: [A('storage', null, 'unknown', 'high')] }))), null, 'not a technical item');
    assert.equal(openVariant(scan(raw({ category: 'Vehicles', item_type: 'car', market_class: 'vehicle', attributes: [A('year', null, 'unknown', 'high')] }))), null, 'a specialised market gets no number anyway');
    assert.equal(openVariant(scan(raw({ category: 'Furniture', item_type: 'sofa', market_class: 'furniture', identity_precision: 'descriptive', attributes: [A('size', null, 'unknown', 'high')] }))), null, 'similar items are approximate by construction');
    // A laptop's generation unknown and high, no question: no storage ladder fits it, so nothing is asked — and the price is approximate.
    const laptop = scan(raw({ item_type: 'laptop', canonical_name: 'apple macbook air', model: 'MacBook Air', attributes: [A('generation', null, 'unknown', 'high')] }));
    assert.deepEqual([laptop.followup.kind, openVariant(laptop), isApproximate(laptop, null)], ['none', 'generation', true]);
  });
  test('RW-5d through the real price step: with the storage confirmed a listing for another storage is a comparable, not the item, and the price is exact; with the storage unknown the Israeli evidence still prices it — as approximate — and no number is invented', async () => {
    resetMarketCache(); resetFxCache();
    const SAME = 'https://www.secondhand.example.co.il/item/128';
    const OTHER = 'https://market.example.co.il/ads/256';
    const market = { evidence: [listing(SAME, 'Huawei P30 Pro 128GB יד שנייה', 700), listing(OTHER, 'Huawei P30 Pro 256GB יד שנייה', 900)] };
    const price = (identity, answer = null) => runPrice({ identity, answer, scanUuid: UUID, model: 'm', apiKey: 'k', fetchImpl: fakeProvider({ markets: [market], reached: [SAME, OTHER], pageText: {} }), store: fakeStore(), now: () => NOW });
    const confirmed = [{ attribute: 'storage', value: '128 GB', question: 'How much storage does it have?' }];
    const known = await price(completeIdentity(normalizeIdentity(PHONE), { lang: 'en', followupsLeft: 2, confirmed }), { question: 'How much storage does it have?', text: '128 GB' });
    const other = known.valuation.evidence.find((e) => e.url === OTHER);
    assert.deepEqual([known.status, known.valuation.approximate, other.match, other.binding_reason, other.used], ['priced', false, 'close_comparable', BIND_REASON.OTHER_SIZE, true]);
    assert.equal(known.valuation.evidence.find((e) => e.url === SAME).match, 'exact');
    resetMarketCache();
    const unknown = await price(scan(PHONE, { followupsLeft: 0 }));
    assert.deepEqual([unknown.status, unknown.valuation.approximate, unknown.valuation.price_confidence, unknown.valuation.counts.resale], ['priced', true, 'low', 2]);
    assert.ok(unknown.valuation.prices.good.low > 0, 'a real price from real Israeli evidence, said to be approximate');
    assert.notEqual(known.market_key, unknown.market_key);
    // "Approximate" is not a substitute for matching: with the storage open, a row that states one is a listing for one
    // variant of several — a comparable, never exact evidence; a row that states none is the model itself.
    assert.deepEqual(unknown.valuation.evidence.filter((e) => e.used).map((e) => [e.match, e.binding_reason]), [['close_comparable', BIND_REASON.SIZE_OPEN], ['close_comparable', BIND_REASON.SIZE_OPEN]]);
    assert.deepEqual([unknown.valuation.counts.il_used_exact, unknown.valuation.counts.il_used_close], [0, 2]);
    resetMarketCache();
    const PLAIN = 'https://www.secondhand.example.co.il/item/plain';
    const plain = await runPrice({ identity: scan(PHONE, { followupsLeft: 0 }), scanUuid: UUID, model: 'm', apiKey: 'k', fetchImpl: fakeProvider({ markets: [{ evidence: [listing(PLAIN, 'Huawei P30 Pro יד שנייה', 800)] }], reached: [PLAIN], pageText: {} }), store: fakeStore(), now: () => NOW });
    assert.deepEqual([plain.valuation.evidence[0].match, plain.valuation.evidence[0].binding_reason, plain.valuation.approximate], ['exact', BIND_REASON.ONE_LISTING, true]);
    // With no Israeli listing at all, unknown storage buys nothing: the gate is the gate.
    resetMarketCache();
    const nothing = await runPrice({ identity: scan(PHONE, { followupsLeft: 0 }), scanUuid: UUID, model: 'm', apiKey: 'k', fetchImpl: fakeProvider({ markets: [{ evidence: [] }], reached: [], pageText: {} }), store: fakeStore(), now: () => NOW });
    assert.deepEqual([nothing.status, nothing.valuation.prices], ['insufficient_evidence', null]);
  });
  test('RW-5e THE SERVER DECIDES when a phone\'s storage is open, not the model\'s report (release gate 2026-10-12): omitted, guessed, or called medium, the storage is asked for, the price is approximate, and a row that states a size is a comparable — never the exact variant the item was not shown to be; settled by the owner or the photograph, it is exact', async () => {
    const S128 = 'https://www.secondhand.example.co.il/item/128';
    const S256 = 'https://market.example.co.il/ads/256';
    const PLAIN = 'https://www.secondhand.example.co.il/item/plain';
    const rows = { [S128]: listing(S128, 'Huawei P30 Pro 128GB יד שנייה', 700), [S256]: listing(S256, 'Huawei P30 Pro 256GB יד שנייה', 900), [PLAIN]: listing(PLAIN, 'Huawei P30 Pro יד שנייה', 800) };
    const price = async (identity, urls, answer = null) => { resetMarketCache(); resetFxCache(); return runPrice({ identity, answer, scanUuid: UUID, model: 'm', apiKey: 'k', fetchImpl: fakeProvider({ markets: [{ evidence: urls.map((u) => rows[u]) }], reached: urls, pageText: {} }), store: fakeStore(), now: () => NOW }); };
    const bound = (r, url) => { const e = r.valuation.evidence.find((x) => x.url === url); return [e.match, e.binding_reason, e.used]; };
    /** One way the model reported the storage: what the server asks, and how a 256 GB row and a silent row are priced with the allowance spent. */
    const unresolved = async (label, attributes) => {
      const asked = phone({ attributes });
      assert.deepEqual([asked.followup.required, asked.followup.attribute, openVariant(asked), isApproximate(asked, null)], [true, 'storage', 'storage', true], `${label}: the storage is asked for, required, before the search`);
      const spent = phone({ attributes }, { followupsLeft: 0 });
      const r = await price(spent, [S256]);
      assert.deepEqual([r.status, r.valuation.approximate, ...bound(r, S256), r.valuation.counts.il_used_exact], ['priced', true, 'close_comparable', BIND_REASON.SIZE_OPEN, true, 0], `${label}: a 256 GB row is a comparable, the price approximate, no exact variant`);
      const p = await price(spent, [PLAIN]);
      assert.deepEqual([p.status, p.valuation.approximate, ...bound(p, PLAIN)], ['priced', true, 'exact', BIND_REASON.ONE_LISTING, true], `${label}: a row that states no size is the model itself, and the price still approximate`);
    };
    await unresolved('storage omitted by the model', [A('color', 'blue')]);
    await unresolved('storage guessed (inferred 128 GB, high)', [A('storage', '128 GB', 'inferred', 'high'), A('color', 'blue')]);
    await unresolved('storage unknown, medium', [A('storage', null, 'unknown', 'medium')]);
    await unresolved('storage unknown, high', [A('storage', null, 'unknown', 'high')]);
    // The guess never becomes the item's storage: not the core field, not the search.
    const guessed = phone({ attributes: [A('storage', '128 GB', 'inferred', 'high')] });
    assert.deepEqual([guessed.size_or_capacity, guessed.attributes.find((a) => a.name === 'storage').basis], [null, 'inferred']);
    assert.ok(!buildSearchQueries({ identity: guessed }).some((q) => /128/.test(q)));
    // "Not sure": not asked again, still open, approximate, a 256 GB row a comparable.
    const unsure = recordAnswer(phone({ attributes: [A('color', 'blue')] }), 'unsure', { lang: 'en', followupsLeft: 2 });
    assert.deepEqual([unsure.identity.followup.kind, openVariant(unsure.identity), isApproximate(unsure.identity, unsure.answer)], ['none', 'storage', true]);
    const u = await price(unsure.identity, [S256], unsure.answer);
    assert.deepEqual([u.valuation.approximate, ...bound(u, S256), u.valuation.counts.il_used_exact], [true, 'close_comparable', BIND_REASON.SIZE_OPEN, true, 0]);
    // The owner confirmed 128 GB where the model had listed nothing: settled, exact, nothing more asked; a 128 GB row is the item, a 256 GB row another size.
    const confirmed = recordAnswer(phone({ attributes: [A('color', 'blue')] }), 1, { lang: 'en', followupsLeft: 2 });
    assert.deepEqual([confirmed.identity.size_or_capacity, confirmed.identity.followup.kind, openVariant(confirmed.identity), isApproximate(confirmed.identity, confirmed.answer)], ['128 GB', 'none', null, false]);
    const same = await price(confirmed.identity, [S128], confirmed.answer);
    assert.deepEqual([same.valuation.approximate, ...bound(same, S128), same.valuation.counts.il_used_exact], [false, 'exact', BIND_REASON.ONE_LISTING, true, 1]);
    const other = await price(confirmed.identity, [S256], confirmed.answer);
    assert.deepEqual([other.valuation.approximate, ...bound(other, S256), other.valuation.counts.il_used_exact, other.valuation.counts.il_used_close], [false, 'close_comparable', BIND_REASON.OTHER_SIZE, true, 0, 1]);
    // The photograph showed the storage: nothing asked, exact. A screen size in the capacity field is not storage: still open, and a 256 GB row still a comparable.
    const shown = phone({ size_or_capacity: '128 GB', attributes: [] });
    assert.deepEqual([shown.followup.kind, openVariant(shown)], ['none', null]);
    const screen = phone({ size_or_capacity: '6.1 inch', attributes: [] }, { followupsLeft: 0 });
    assert.equal(openVariant(screen), 'storage');
    const s = await price(screen, [S256]);
    assert.deepEqual([s.valuation.approximate, ...bound(s, S256)], [true, 'close_comparable', BIND_REASON.SIZE_OPEN, true]);
    // Storage is irrelevant to a mouse, a camera, a watch, or a phone's case: no storage question, nothing approximate.
    for (const item_type of ['gaming mouse', 'camera', 'phone case', 'laptop stand', 'smartwatch', 'feature phone']) {
      const o = scan(raw({ ...PHONE, item_type, attributes: [A('color', 'black')] }));
      assert.deepEqual([o.followup.kind, openVariant(o), isApproximate(o, null)], ['none', null, false], item_type);
    }
    // A tablet and a laptop are sold by storage too, under any of the plain nouns the model uses.
    for (const item_type of ['tablet', 'laptop', 'mobile phone', 'notebook computer', 'iPad', 'MacBook']) assert.equal(openVariant(scan(raw({ ...PHONE, item_type, attributes: [] }))), 'storage', item_type);
  });
  test('RW-5f THE MODEL\'S WORD AGAINST ITS FIELD: a GB figure in the capacity field beside a storage the model called inferred or unknown does not close the storage — asked, approximate, and a row stating THAT figure is a comparable, never the exact item; the owner\'s answer closes it; an observed storage, or an unrelated item, is as before', async () => {
    const S128 = 'https://www.secondhand.example.co.il/item/128';
    const S256 = 'https://market.example.co.il/ads/256';
    const rows = { [S128]: listing(S128, 'Huawei P30 Pro 128GB יד שנייה', 700), [S256]: listing(S256, 'Huawei P30 Pro 256GB יד שנייה', 900) };
    const price = async (identity, urls, answer = null) => { resetMarketCache(); resetFxCache(); return runPrice({ identity, answer, scanUuid: UUID, model: 'm', apiKey: 'k', fetchImpl: fakeProvider({ markets: [{ evidence: urls.map((u) => rows[u]) }], reached: urls, pageText: {} }), store: fakeStore(), now: () => NOW }); };
    const bound = (r, url) => { const e = r.valuation.evidence.find((x) => x.url === url); return [e.match, e.binding_reason, e.used]; };
    for (const [label, attribute] of [['inferred', A('storage', '128 GB', 'inferred', 'high')], ['unknown', A('storage', null, 'unknown', 'high')], ['inferred, medium', A('storage', '128 GB', 'inferred', 'medium')]]) {
      const asked = phone({ size_or_capacity: '128 GB', attributes: [attribute, A('color', 'blue')] });
      assert.deepEqual([asked.followup.required, asked.followup.attribute, openVariant(asked), isApproximate(asked, null), asked.attributes.find((a) => a.name === 'storage').basis], [true, 'storage', 'storage', true, attribute.basis], `${label}: open, asked, and the attribute keeps its basis`);
      const spent = phone({ size_or_capacity: '128 GB', attributes: [attribute] }, { followupsLeft: 0 });
      const r = await price(spent, [S128, S256]);
      assert.deepEqual([r.status, r.valuation.approximate, ...bound(r, S128), ...bound(r, S256), r.valuation.counts.il_used_exact, r.valuation.counts.il_used_close], ['priced', true, 'close_comparable', BIND_REASON.SIZE_OPEN, true, 'close_comparable', BIND_REASON.SIZE_OPEN, true, 0, 2], `${label}: the 128 GB row is no more the item than the 256 GB row`);
    }
    // The owner answers 128 GB: closed, exact; the 128 GB row is the item, the 256 GB row another size; the attribute is now the owner's.
    const answered = recordAnswer(phone({ size_or_capacity: '128 GB', attributes: [A('storage', '128 GB', 'inferred', 'high')] }), 1, { lang: 'en', followupsLeft: 2 });
    assert.deepEqual([answered.identity.size_or_capacity, answered.identity.attributes.find((a) => a.name === 'storage').basis, openVariant(answered.identity), isApproximate(answered.identity, answered.answer)], ['128 GB', 'confirmed', null, false]);
    const closed = await price(answered.identity, [S128, S256], answered.answer);
    assert.deepEqual([closed.valuation.approximate, ...bound(closed, S128), ...bound(closed, S256), closed.valuation.counts.il_used_exact], [false, 'exact', BIND_REASON.ONE_LISTING, true, 'close_comparable', BIND_REASON.OTHER_SIZE, true, 1]);
    // "Not sure" to that question: still open, the figure still not the item's.
    const unsure = recordAnswer(phone({ size_or_capacity: '128 GB', attributes: [A('storage', '128 GB', 'inferred', 'high')] }), 'unsure', { lang: 'en', followupsLeft: 2 });
    const u = await price(unsure.identity, [S128], unsure.answer);
    assert.deepEqual([openVariant(unsure.identity), u.valuation.approximate, ...bound(u, S128)], ['storage', true, 'close_comparable', BIND_REASON.SIZE_OPEN, true]);
    // Observed in the photograph: closed, exact, nothing asked.
    const seen = phone({ size_or_capacity: '128 GB', visible_text: ['128GB'], attributes: [A('storage', '128 GB', 'observed', 'high')] }, { followupsLeft: 0 });
    const s = await price(seen, [S128, S256]);
    assert.deepEqual([openVariant(seen), s.valuation.approximate, ...bound(s, S128), ...bound(s, S256)], [null, false, 'exact', BIND_REASON.ONE_LISTING, true, 'close_comparable', BIND_REASON.OTHER_SIZE, true]);
    // A camera with the same contradiction is not sold by storage: nothing asked, nothing approximate.
    const camera = scan(raw({ ...PHONE, item_type: 'camera', size_or_capacity: '128 GB', attributes: [A('storage', '128 GB', 'inferred', 'high')] }));
    assert.deepEqual([camera.followup.kind, openVariant(camera), isApproximate(camera, null)], ['none', null, false]);
  });
});
