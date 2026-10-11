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
//
//   node --test tests/core-scan-recovery.test.mjs
// ══════════════════════════════════════════════════════════════════════════════
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeIdentity, completeIdentity, questionAfterResearch, buildIdentityPrompt } from '../api/_lib/scan/identify.js';
import { buildSearchQueries } from '../api/_lib/scan/market.js';
import { buildValuation, STRATEGY, WITHDRAWN, SET_ASIDE } from '../api/_lib/scan/valuation.js';
import { runIdentify } from '../api/_lib/scan/service.js';
import { createScanHandler, diagnosticsOf } from '../api/scan.js';
import * as CFG from '../api/_lib/scan/config.js';
import { IMG, RAW_IDENTITY, TODAY, SOURCES, fakeProvider } from './helpers/core-scan-fakes.mjs';

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
