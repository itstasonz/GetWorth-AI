// ══════════════════════════════════════════════════════════════════════════════
// CORE SCAN — A PRICE COUNTS ONLY WHEN THE PAGE TIES IT TO THE PRODUCT
//
// The first Production scan priced a Logitech G Pro Wireless from "₪300" on a
// category page of many mice, where the ₪300 most likely belonged to a G703.
// Right identity, relevant page, wrong listing — and then a deterministic
// valuation of contaminated evidence.
//
// These suites hold the rule that closes it: the text the SEARCH PROVIDER
// returned for a page has to show the product and the price as one listing
// (api/_lib/scan/binding.js). The thirteen behaviours are numbered as they
// were asked for.
//
//   CB-1  one listing, one product, one price
//   CB-2  pages that list many things: a row binds, a page does not
//   CB-3  the exact item, and not something near it
//   CB-4  new-price anchors are held to the same rule
//   CB-5  what the valuation does with what is and is not bound
//
// Pure functions and fakes. No network, no credit.
//
//   node --test tests/core-scan-binding.test.mjs
// ══════════════════════════════════════════════════════════════════════════════
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { bindPrice, namesOf, isBound, BOUND, BIND_REASON } from '../api/_lib/scan/binding.js';
import { buildValuation, verifyEvidence, SET_ASIDE, WEIGHT } from '../api/_lib/scan/valuation.js';
import { runPrice, resetMarketCache, SCAN_STATUS } from '../api/_lib/scan/service.js';
import { normalizeIdentity } from '../api/_lib/scan/identify.js';
import { buildMarketPrompt, MARKET_SCHEMA } from '../api/_lib/scan/market.js';
import { resetFxCache, parseBoiRates } from '../api/_lib/scan/fx.js';
import { extractSearchProvenance } from '../api/_lib/phaseb/search-provenance.js';
import { RAW_IDENTITY, BOI_JSON, TODAY, NOW, fakeProvider } from './helpers/core-scan-fakes.mjs';

const identity = (over) => normalizeIdentity({ ...RAW_IDENTITY, visible_text: [], ...over });
const MOUSE = identity({ model: 'G Pro Wireless', display_name: 'Logitech G Pro Wireless', canonical_name: 'logitech g pro wireless' });
const PHONE = identity({ brand: 'Apple', product_family: 'iPhone', model: 'iPhone 13', display_name: 'Apple iPhone 13', canonical_name: 'apple iphone 13', item_type: 'smartphone', size_or_capacity: '128 GB' });
const SPEAKER = identity({ brand: 'Acme', product_family: 'Alpha', model: 'Alpha Speaker', display_name: 'Acme Alpha Speaker', canonical_name: 'acme alpha speaker', item_type: 'speaker' });

const claim = (over) => ({ price: 300, currency: 'ILS', title: 'Logitech G Pro Wireless', match: 'exact', shipping: null, ...over });
/** A page for one listing, as a search result gives it: a title and a snippet. */
const listing = (title, text = '') => ({ type: 'listing', title, text: [title, text].filter(Boolean).join('\n') });
/** A page that lists many things. */
const list = (text, title = 'עכברים למכירה') => ({ type: 'search_or_category', title, text: `${title}\n${text}` });
const bind = (c, page, who = MOUSE, answer = null) => bindPrice(claim(c), page, who, answer);
const level = (...args) => bind(...args).level;

// The Production shape: a category page of several mice, the ₪300 beside a G703 and the scanned mouse elsewhere.
const CATEGORY = [
  'Logitech G703 Lightspeed עכבר גיימינג · ₪300 · תל אביב',
  'Logitech G Pro Wireless עכבר גיימינג · ₪450 · חולון',
  'Razer Viper Ultimate · ₪280 · חיפה',
].join('\n');

describe('CB-1 one listing, one product, one price', () => {
  test('CB-1a [1] a listing page whose own title names the product and shows the price counts, as STRONG', () => {
    // The shape Homeless titles really have: the item, the city and the price in the title itself.
    const page = listing('g pro wireless עכבר גיימינג למכירה בפרדס חנה-כרכור 430 שח');
    assert.deepEqual(bind({ price: 430 }, page), { level: BOUND.STRONG, reason: BIND_REASON.ONE_LISTING, match: 'exact' });
    // The title names it, the snippet prices it, and it is the only price the page shows: still one listing.
    assert.equal(level({ price: 400 }, listing('Logitech G Pro Wireless - לוח מודעות', 'מחיר: 400 ₪ · מצב: כמו חדש · חולון')), BOUND.STRONG);
    assert.equal(level({ price: 250 }, listing('Logitech G Pro Wireless', 'משומש במצב טוב ... ₪250')), BOUND.STRONG, '[6] a result that IS the listing, with its one price');
    assert.equal(isBound({ binding: bind({ price: 430 }, page).level }), true);
  });
  test('CB-1b a listing page is not taken on its title when the page shows other prices too', () => {
    const page = listing('Logitech G Pro Wireless - לוח מודעות', 'מחיר: 400 ₪\nמודעות דומות: Logitech G703 ב-300 ₪');
    assert.deepEqual([level({ price: 400 }, page), level({ price: 300 }, page)], [BOUND.WEAK, BOUND.WEAK]);
  });
  test('CB-1c with no page text, or a price the text does not show with its currency, nothing is bound', () => {
    assert.deepEqual(bind({}, listing('', '')), { level: BOUND.WEAK, reason: BIND_REASON.NO_TEXT, match: 'exact' });
    assert.equal(bind({ price: 300 }, listing('Logitech G Pro Wireless', 'מספר מודעה 300')).reason, BIND_REASON.PRICE_ABSENT, 'a bare number is not a price');
    assert.equal(bind({ price: 300, currency: 'USD' }, listing('Logitech G Pro Wireless ₪300')).reason, BIND_REASON.PRICE_ABSENT, 'nor is the same number in another currency');
    assert.equal(level({ price: 56 }, listing('Logitech G Pro Wireless ILS 56.36')), BOUND.STRONG, 'agorot do not make it another price');
  });
  test('CB-1d the model\'s account of a page is never the proof: the same claim binds or not by the page\'s own text alone', () => {
    const said = { price: 300, title: 'Logitech G Pro Wireless gaming mouse', match: 'exact' };
    assert.equal(level(said, list(CATEGORY)), BOUND.WEAK);
    assert.equal(level(said, list('Logitech G Pro Wireless gaming mouse ₪300')), BOUND.VERIFIED_ROW);
  });
});

describe('CB-2 a page that lists many things: a row binds, a page does not', () => {
  test('CB-2a [2] product and price in the same structured row count, as VERIFIED_ROW', () => {
    assert.deepEqual(bind({ price: 450 }, list(CATEGORY)), { level: BOUND.VERIFIED_ROW, reason: BIND_REASON.ONE_LISTING, match: 'exact' });
    for (const rows of ['Logitech G703 ₪300 | Logitech G Pro Wireless ₪450 | Razer Viper ₪280', 'Logitech G703 ₪300 … Logitech G Pro Wireless ₪450 … Razer Viper ₪280', '• Logitech G703 ₪300 • Logitech G Pro Wireless ₪450']) {
      assert.equal(level({ price: 450 }, list(rows)), BOUND.VERIFIED_ROW, rows);
    }
    assert.equal(level({ price: 900, title: 'Logitech G Pro Wireless' }, list('900 ש"ח - Logitech G Pro Wireless')), BOUND.VERIFIED_ROW, 'a price that opens its row belongs to the row');
  });
  test('CB-2b [3] products and prices run together with nothing joining them: neither price is given to either product', () => {
    for (const text of ['Acme Alpha Speaker Acme Beta Speaker ₪300 ₪450', 'Acme Alpha Speaker ₪300 Acme Beta Speaker ₪450', '₪300 ₪450 Acme Alpha Speaker Acme Beta Speaker']) {
      for (const price of [300, 450]) {
        const r = bind({ price, title: 'Acme Alpha Speaker' }, list(text), SPEAKER);
        assert.equal(r.level, BOUND.UNBOUND, `${text} @ ${price}`);
        assert.ok([BIND_REASON.AMBIGUOUS, BIND_REASON.OTHER_PRICE].includes(r.reason));
      }
    }
  });
  test('CB-2c [4] the exact model named elsewhere on the page cannot take a sibling\'s price', () => {
    const page = list('Logitech G703 Lightspeed · ₪300 · תל אביב\nLogitech G Pro Wireless (נמכר)\nRazer Viper · ₪280');
    assert.deepEqual([level({ price: 300 }, page), bind({ price: 300 }, page).reason], [BOUND.WEAK, BIND_REASON.PRODUCT_ABSENT]);
    // Even inside one row: a row that names another model of the line is not this item's row.
    const same = bind({ price: 300 }, list('Logitech G703 Lightspeed ₪300 ראו גם Logitech G Pro Wireless'));
    assert.deepEqual([same.level, same.reason], [BOUND.UNBOUND, BIND_REASON.AMBIGUOUS]);
    const beside = bind({ price: 300 }, list('Logitech G Pro Wireless / G703 ₪300'));
    assert.deepEqual([beside.level, beside.reason], [BOUND.UNBOUND, BIND_REASON.OTHER_MODEL]);
  });
  test('CB-2d [5] the Production contamination: ₪300 beside a G703, claimed for the G Pro Wireless, is rejected', () => {
    const stored = { price: 300, title: 'Logitech G Pro Wireless gaming mouse', match: 'exact' };   // what that scan claimed
    assert.deepEqual([level(stored, list(CATEGORY)), bind(stored, list(CATEGORY)).reason], [BOUND.WEAK, BIND_REASON.PRODUCT_ABSENT]);
    assert.equal(level({ ...stored, price: 450 }, list(CATEGORY)), BOUND.VERIFIED_ROW, 'the page did hold this mouse\'s price: the other one');
    // The G703's own row binds as what it is — a sibling — and never as this item.
    assert.deepEqual(bind({ price: 300, title: 'Logitech G703 Lightspeed עכבר גיימינג', match: 'sibling_model' }, list(CATEGORY)), { level: BOUND.VERIFIED_ROW, reason: BIND_REASON.ONE_LISTING, match: 'sibling_model' });
    assert.equal(level({ price: 300, title: 'Logitech G703 Lightspeed עכבר גיימינג', match: 'exact' }, list(CATEGORY)), BOUND.WEAK, 'a true title does not make a false "exact"');
  });
  test('CB-2e [6][7] a snippet counts when it binds the product to the price itself, and not when it only mentions both', () => {
    assert.equal(level({ price: 250 }, list('Logitech G Pro Wireless יד שנייה במצב טוב ₪250')), BOUND.VERIFIED_ROW);
    // The founder's ambiguous example: the ₪300 is the G703's, and the snippet trails off after our mouse's name.
    const ambiguous = 'Logitech mice — G703 ₪300, G Pro Wireless...';
    assert.deepEqual([level({ price: 300 }, list(ambiguous)), bind({ price: 300 }, list(ambiguous)).reason], [BOUND.WEAK, BIND_REASON.PRODUCT_ABSENT]);
    // The same with names that are plain words: a price closes its clause, and what follows is another listing.
    assert.equal(level({ price: 300, title: 'Acme Alpha Speaker' }, list('Speakers: Beta Speaker ₪300, Alpha Speaker'), SPEAKER), BOUND.WEAK);
    assert.equal(bind({ price: 300, title: 'Acme Alpha Speaker' }, list('Beta Speaker ₪300 Alpha Speaker'), SPEAKER).reason, BIND_REASON.AMBIGUOUS, 'a price after another thing\'s name is that thing\'s');
    assert.equal(level({ price: 250 }, list('Logitech G Pro Wireless ... ₪250')), BOUND.WEAK, 'on a list page an ellipsis joins two fragments, not one listing');
  });
});

describe('CB-3 the exact item, and not something near it', () => {
  test('CB-3a an "exact" claim needs the item\'s own name in the row; a title that does not name it proves a listing, not this item', () => {
    assert.deepEqual(namesOf(MOUSE), [['g', 'pro', 'wireless']]);
    assert.deepEqual(namesOf(identity({ model: 'G502 HERO', model_number: '910-005470', visible_text: ['910-005470'], search: { hebrew_name: 'עכבר גיימינג', aliases: ['Logitech G502 Hero 25K'], model_numbers: [] } })), [['g502', 'hero'], ['g502', 'hero', '25k'], ['910', '005470']]);
    assert.equal(level({ price: 300, title: 'עכבר גיימינג אלחוטי של לוגיטק' }, list('עכבר גיימינג אלחוטי של לוגיטק ₪300')), BOUND.WEAK, 'a Hebrew description of some wireless mouse is not this mouse');
    assert.equal(level({ price: 300 }, list('Logitech Wireless Pro G mouse ₪300')), BOUND.WEAK, 'the words of the name, not in its order, are not the name');
    assert.equal(level({ price: 300 }, list('Logitech G Pro X Superlight Wireless ₪300')), BOUND.WEAK, 'another product that shares its words');
    assert.equal(level({ price: 300 }, list('מק"ט 910-005470 ₪300'), identity({ model: 'G502 HERO', model_number: '910-005470', visible_text: ['910-005470'] })), BOUND.VERIFIED_ROW, 'its model number names it');
  });
  test('CB-3b [9] a variant or another size in the row cannot silently stay "exact": it counts as a comparable and says why', () => {
    const row = (text) => bind({ price: 2000, title: 'iPhone 13' }, list(text), PHONE);
    assert.deepEqual(row('Apple iPhone 13 128GB ₪2,000'), { level: BOUND.VERIFIED_ROW, reason: BIND_REASON.ONE_LISTING, match: 'exact' });
    assert.deepEqual(row('Apple iPhone 13 256GB ₪2,000'), { level: BOUND.VERIFIED_ROW, reason: BIND_REASON.OTHER_SIZE, match: 'close_comparable' });
    assert.deepEqual(row('Apple iPhone 13 Pro 128GB ₪2,000'), { level: BOUND.VERIFIED_ROW, reason: BIND_REASON.VARIANT, match: 'close_comparable' });
    assert.deepEqual(row('Apple iPhone 13 mini ₪2,000'), { level: BOUND.VERIFIED_ROW, reason: BIND_REASON.VARIANT, match: 'close_comparable' });
    assert.equal(row('Apple iPhone 14 128GB ₪2,000').level, BOUND.WEAK, 'another generation is not this item at all');
    // The size the OWNER gave counts as the item's size.
    const noSize = identity({ brand: 'Apple', model: 'iPhone 13', canonical_name: 'apple iphone 13', size_or_capacity: null });
    assert.equal(bindPrice(claim({ price: 2000, title: 'iPhone 13' }), list('Apple iPhone 13 128GB ₪2,000'), noSize, { question: 'Storage?', text: '256 GB' }).match, 'close_comparable');
    assert.equal(bindPrice(claim({ price: 2000, title: 'iPhone 13' }), list('Apple iPhone 13 128GB ₪2,000'), noSize, null).match, 'exact', 'with no size known there is nothing to contradict');
    // A later generation of a product named by words.
    assert.equal(bind({ price: 700, title: 'AirPods Pro' }, list('Apple AirPods Pro 2 ₪700'), identity({ brand: 'Apple', model: 'AirPods Pro', canonical_name: 'apple airpods pro' })).match, 'close_comparable');
  });
  test('CB-3c what verifyEvidence records: the row\'s word over the model\'s, and the claim kept beside it', () => {
    const url = 'https://market.example.co.il/c/phones';
    const provenance = extractSearchProvenance([{ type: 'web_search_call', id: 'ws', status: 'completed', action: { type: 'search', query: 'q', sources: [{ type: 'url', url }] }, results: [{ url, title: 'טלפונים למכירה', text: 'Apple iPhone 13 256GB ₪2,000\nApple iPhone 13 128GB ₪1,800' }] }]);
    const raw = (price) => ({ url, title: 'Apple iPhone 13', price, currency: 'ILS', kind: 'used_listing', match: 'exact', market: 'IL', condition: 'good', page: 'search_or_category', listed: null, stock: 'unknown', shipping: null });
    const { evidence } = verifyEvidence([raw(2000), raw(1800)], provenance, parseBoiRates(BOI_JSON), TODAY, { identity: PHONE, answer: null });
    assert.deepEqual(evidence.map((e) => [e.price, e.match, e.match_claimed ?? null, e.binding, e.binding_reason]), [
      [2000, 'close_comparable', 'exact', 'verified_row', BIND_REASON.OTHER_SIZE], [1800, 'exact', null, 'verified_row', BIND_REASON.ONE_LISTING],
    ]);
  });
});

describe('CB-4 a new price is held to the same rule', () => {
  const grid = 'Logitech G502 X ₪249\nLogitech G Pro X Superlight 2 ₪549\nLogitech G Pro Wireless ₪399 במלאי';
  const shop = (text, title = 'Logitech G Pro Wireless') => ({ type: 'shop_product', title, text: `${title}\n${text}` });
  test('CB-4a [8] a shop\'s grid cannot give this product another product\'s price', () => {
    const anchor = (price) => bind({ price, title: 'Logitech G Pro Wireless' }, list(grid, 'עכברי גיימינג'));
    assert.deepEqual([anchor(399).level, anchor(549).level, anchor(249).level], [BOUND.VERIFIED_ROW, BOUND.WEAK, BOUND.WEAK]);
  });
  test('CB-4b the price without VAT is never the price, and does not get in the way of the one that is', () => {
    const page = shop('Logitech G Pro Wireless ₪399 מחיר אילת: ₪338.14');
    assert.deepEqual([bind({ price: 399 }, page).level, bind({ price: 338.14 }, page).level, bind({ price: 338.14 }, page).reason], [BOUND.STRONG, BOUND.UNBOUND, BIND_REASON.NO_VAT_PRICE]);
    assert.equal(bind({ price: 329 }, shop('מחיר: 389 ₪ · 329 ₪ ללא מע"מ')).reason, BIND_REASON.NO_VAT_PRICE);
  });
  test('CB-4c a refurbished unit, a variant and an accessory on a product page do not become the new price', () => {
    assert.equal(bind({ price: 549 }, shop('Logitech G Pro X Superlight 2 ₪549', 'Logitech G Pro X Superlight 2')).level, BOUND.WEAK);
    const parts = shop('רגליות טפלון ל-Logitech G Pro Wireless ₪60\nLogitech G Pro Wireless ₪399', 'אביזרים');
    assert.deepEqual([bind({ price: 60 }, parts).level, bind({ price: 60 }, parts).reason], [BOUND.UNBOUND, BIND_REASON.FOR_THE_PRODUCT], 'feet FOR the mouse are not the mouse');
    assert.equal(bind({ price: 399 }, parts).level, BOUND.STRONG);
    assert.equal(bind({ price: 45 }, list('Silicone case for Logitech G Pro Wireless $45', 'accessories'), MOUSE).reason, BIND_REASON.PRICE_ABSENT, 'and a dollar price is not a shekel one');
    assert.equal(bind({ price: 45, currency: 'USD' }, list('Silicone case for Logitech G Pro Wireless $45', 'accessories')).reason, BIND_REASON.FOR_THE_PRODUCT);
    assert.equal(MARKET_SCHEMA.properties.evidence.items.properties.stock.enum.join(), 'in_stock,out_of_stock,unknown');
    const prompt = buildMarketPrompt({ identity: MOUSE, today: TODAY });
    assert.match(prompt, /EACH ITEM IS ONE LISTING/);
    assert.match(prompt, /Never take a product's name from one place and a price from another/);
    assert.match(prompt, /copied exactly as the page shows it/);
    assert.match(prompt, /shipping: the shipping charge shown for THIS listing/);
  });
});

// ── WHAT THE VALUATION DOES WITH IT ─────────────────────────────────────────
let serial = 0;
const item = (over = {}) => { serial += 1; return { url: `https://ex.example.co.il/ad/${serial}`, domain: 'ex.example.co.il', title: 't', price: 300, currency: 'ILS', price_ils: over.price ?? 300, kind: 'used_listing', match: 'exact', market: 'IL', condition: 'good', page: 'listing', listed: '2026-09-20', binding: 'strong', stock: 'unknown', shipping: null, seen: TODAY, ...over }; };
const value = (evidence, opts = {}) => buildValuation({ evidence, today: TODAY, ...opts });

describe('CB-5 only a bound price moves the valuation', () => {
  test('CB-5a a price that is not bound changes nothing, at any price, and is counted as found', () => {
    const real = () => [item({ price: 300 }), item({ price: 320 })];
    const loose = [item({ price: 90, binding: 'weak' }), item({ price: 5000, binding: 'unbound', kind: 'sold' }), item({ price: 80, binding: undefined })];
    const v = value([...loose, ...real()]);
    assert.deepEqual(v.prices, value(real()).prices);
    assert.deepEqual([v.counts.resale, v.counts.unbound, v.counts.not_comparable, v.counts.set_aside], [2, 3, 0, 0]);
    assert.deepEqual(v.evidence.filter((e) => e.set_aside === SET_ASIDE.UNBOUND).map((e) => [e.price, e.used, e.weight]), [[90, false, 0], [5000, false, 0], [80, false, 0]]);
  });
  test('CB-5b [10] locality and freshness weigh bound evidence exactly as before', () => {
    const points = value([item({ price: 300 }), item({ price: 90, market: 'INTL', currency: 'USD', domain: 'used.example.com' }), item({ price: 600, listed: '2023-01-01', binding: 'verified_row', page: 'search_or_category' })]).evidence;
    assert.deepEqual(points.map((e) => [e.price, e.weight, e.freshness]), [
      [300, WEIGHT.where.IL, 'current'],
      [600, Math.round(WEIGHT.freshness.archived * WEIGHT.page.search_or_category * 100) / 100, 'archived'], [90, WEIGHT.where.INTL, 'current'],
    ]);
    assert.deepEqual(value([item({ price: 310, listed: null })]).evidence.map((e) => [e.weight, e.freshness]), [[WEIGHT.freshness.unknown, 'unknown']]);
  });
  test('CB-5c [11] the same evidence in any order gives the same valuation, bound and unbound alike', () => {
    const pool = [item({ price: 300 }), item({ price: 320, listed: null }), item({ price: 90, binding: 'weak' }), item({ price: 200, market: 'INTL', kind: 'sold' }), item({ price: 399, kind: 'new_retail', page: 'shop_product' }), item({ price: 250, kind: 'new_retail', binding: 'unbound' })];
    const facts = (v) => JSON.stringify([v.prices, v.price_confidence, v.counts, v.retail_new_ils, v.evidence.filter((e) => e.used).map((e) => e.url).sort()]);
    const first = facts(value(pool));
    for (const order of [[...pool].reverse(), [3, 5, 0, 4, 1, 2].map((k) => pool[k]), [...pool.slice(2), ...pool.slice(0, 2)]]) assert.equal(facts(value(order)), first);
    assert.equal(value(pool).retail_new_ils, 400, 'and the unbound ₪250 is not the new price');
  });
  test('CB-5d [12] when every Israeli price turns out unbound, evidence abroad prices the item, with less confidence', () => {
    const abroad = () => [200, 210, 220].map((price) => item({ price, market: 'INTL', currency: 'USD', domain: 'used.example.com', kind: 'sold' }));
    const local = (binding) => [item({ price: 300, binding }), item({ price: 310, binding }), item({ price: 320, binding })];
    const bound = value([...local('strong'), ...abroad()]);
    const unbound = value([...local('weak'), ...abroad()]);
    assert.deepEqual([bound.price_confidence, bound.local_drives, bound.counts.il_used_exact], ['high', true, 3]);
    assert.deepEqual([unbound.status, unbound.price_confidence, unbound.local_drives, unbound.local_strength], ['priced', 'low', false, 0]);
    assert.deepEqual([unbound.counts.il_used_exact, unbound.counts.intl_used_exact, unbound.counts.unbound], [0, 3, 3]);
    assert.ok(unbound.prices.good.list < bound.prices.good.list, 'the price is the foreign evidence\'s, not a blend with what could not be trusted');
  });
  test('CB-5e [13] when no trustworthy second-hand price is left, there is no second-hand price', () => {
    const v = value([item({ price: 300, binding: 'weak' }), item({ price: 89, market: 'INTL', binding: 'unbound' }), item({ price: 399, kind: 'new_retail', page: 'shop_product', stock: 'in_stock' })]);
    assert.deepEqual([v.status, v.prices, v.price_confidence, v.counts.resale, v.counts.unbound, v.retail_new_ils], ['insufficient_evidence', null, null, 0, 2, 400]);
    const nothing = value([item({ price: 300, binding: 'weak' }), item({ price: 399, kind: 'new_retail', binding: 'weak' })]);
    assert.deepEqual([nothing.status, nothing.retail_new_ils, nothing.counts.unbound], ['insufficient_evidence', null, 2], 'an unbound new price is not context either');
  });
  test('CB-5f a shop that has it today is today\'s new price; an out-of-stock page is used only when it is all there is, and says so', () => {
    const used = item({ price: 250 });
    const stocked = value([used, item({ price: 399, kind: 'new_retail', stock: 'out_of_stock' }), item({ price: 328, kind: 'new_retail', stock: 'in_stock' })]);
    assert.deepEqual([stocked.retail_new_ils, stocked.retail_new_in_stock], [330, true]);
    const stale = value([used, item({ price: 399, kind: 'new_retail', stock: 'out_of_stock' }), item({ price: 389, kind: 'new_retail', stock: 'out_of_stock' })]);
    assert.deepEqual([stale.retail_new_ils, stale.retail_new_in_stock], [390, false]);
    assert.equal(value([used]).retail_new_in_stock, null);
  });
});

describe('CB-6 through the whole price step', () => {
  const UUID = '11111111-2222-3333-4444-555555555555';
  const URLS = { category: 'https://www.board.example.co.il/c/23', listing: 'https://www.board.example.co.il/ad/777', shop: 'https://www.shop.example.co.il/p/gpw', abroad: 'https://www.used.example.com/itm/9' };
  const ev = (over) => ({ title: 'Logitech G Pro Wireless', currency: 'ILS', kind: 'used_listing', match: 'exact', market: 'IL', condition: 'unknown', page: 'listing', listed: null, stock: 'unknown', shipping: null, ...over });
  const store = () => ({ async load() { return null; }, async save() {} });
  const run = (fetchImpl) => runPrice({ identity: MOUSE, model: 'm', apiKey: 'k', fetchImpl, store: store(), scanUuid: UUID, now: () => NOW });
  beforeEach(() => { resetMarketCache(); resetFxCache(); });

  test('CB-6a the Production scan again, with what the page most likely said: the ₪300 is found, not used, and the search goes on', async () => {
    const local = { evidence: [
      ev({ url: URLS.category, title: 'Logitech G Pro Wireless gaming mouse', price: 300, page: 'search_or_category' }),
      ev({ url: URLS.shop, price: 399, kind: 'new_retail', condition: 'new_sealed', page: 'shop_product', stock: 'out_of_stock' }),
    ] };
    const expand = { evidence: [ev({ url: URLS.abroad, title: 'Logitech G Pro Wireless Gaming Mouse', price: 25, currency: 'USD', market: 'INTL', kind: 'sold', shipping: 26 })] };
    const pageText = { [URLS.category]: CATEGORY, [URLS.shop]: 'Logitech G Pro Wireless ₪399 חסר זמנית · מחיר אילת: ₪338.14', [URLS.abroad]: 'Logitech G Pro Wireless Gaming Mouse - Sold $25.00 + $26.00 shipping' };
    const fetchImpl = fakeProvider({ markets: [local], expand: [expand], reached: Object.values(URLS), pageText, rows: false });
    const r = await run(fetchImpl);
    assert.deepEqual(fetchImpl.stages(), ['local', 'expand'], 'an unbound Israeli price is not Israeli strength');
    const v = r.valuation;
    const by = (url) => v.evidence.find((e) => e.url === url);
    assert.deepEqual([by(URLS.category).binding, by(URLS.category).used, by(URLS.category).set_aside], ['weak', false, SET_ASIDE.UNBOUND]);
    assert.deepEqual([by(URLS.shop).binding, v.retail_new_ils, v.retail_new_in_stock], ['strong', 400, false], 'the new price is the one with VAT, and is known to be an out-of-stock page\'s');
    assert.deepEqual([by(URLS.abroad).binding, by(URLS.abroad).used, by(URLS.abroad).shipping, by(URLS.abroad).shipping_ils], ['strong', true, 26, 91], 'its shipping is kept beside it, and is not a second price');
    assert.deepEqual([r.status, v.price_confidence, v.counts.resale, v.counts.il_used_exact, v.counts.intl_used_exact, v.counts.unbound], [SCAN_STATUS.PRICED, 'low', 1, 0, 1, 1]);
    assert.ok(v.prices.good.list < 150, 'what is left is one sale abroad: a low-confidence price, not ₪300');
  });
  test('CB-6b the same search, with nothing bound at all: no price, and no new price either', async () => {
    const local = { evidence: [ev({ url: URLS.category, price: 300, page: 'search_or_category' }), ev({ url: URLS.shop, price: 399, kind: 'new_retail', page: 'shop_product' })] };
    const fetchImpl = fakeProvider({ markets: [local], reached: Object.values(URLS), pageText: { [URLS.category]: CATEGORY, [URLS.shop]: 'Logitech G502 X ₪399' }, rows: false });
    const r = await run(fetchImpl);
    assert.deepEqual([r.status, r.valuation.prices, r.valuation.retail_new_ils, r.valuation.counts.unbound, r.valuation.counts.unverified], [SCAN_STATUS.INSUFFICIENT, null, null, 2, 0]);
  });
});
