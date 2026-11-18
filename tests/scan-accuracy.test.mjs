// SA — ACCURACY FIXES FROM THE REAL-PHOTO RUNS (2026-11-18): an answered model becomes the model; "3S" is not "3"; a page
// whose address lists many things is a list page; the search says the product once, with its confirmed generation.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeIdentity, completeIdentity } from '../api/_lib/scan/identify.js';
import { namesTheModel } from '../api/_lib/scan/confirmed.js';
import { pageTypeOf } from '../api/_lib/scan/evidence.js';
import { bindPrice, isBound } from '../api/_lib/scan/binding.js';
import { buildSearchQueries, searchNames } from '../api/_lib/scan/market.js';
import { RAW_IDENTITY } from './helpers/core-scan-fakes.mjs';

const mouse = () => normalizeIdentity({ ...RAW_IDENTITY, brand: 'Logitech', product_family: 'MX Master', model: null, model_number: null, display_name: 'Logitech MX Master', canonical_name: 'logitech mx master', exact_model_established: false, alternatives: [{ name: 'MX Master 3' }], search: { hebrew_name: 'עכבר לוגיטק MX Master', aliases: [], model_numbers: [] } });
const answered = (identity, attribute, value) => completeIdentity({ ...identity, confirmed: [{ attribute, value, question: 'q' }] }, { lang: 'he', followupsLeft: 0 });

describe('SA-1 an answer that names the model is the model', () => {
  test('SA-1a "MX Master 3S" answered to a generation question: model set, exact, named once, alternatives gone', () => {
    const i = answered(mouse(), 'generation', 'MX Master 3S');
    assert.equal(i.model, 'MX Master 3S');
    assert.equal(i.exact_model_established, true);
    assert.equal(i.display_name, 'Logitech MX Master 3S');
    assert.deepEqual(i.alternatives, []);
  });
  test('SA-1b what does not name the model stays what it is: "Series 4", "DualSense רגיל", "דור שני"', () => {
    const watch = { brand: 'Apple', product_family: 'Apple Watch' };
    assert.equal(namesTheModel({ attribute: 'generation', value: 'Series 4' }, watch), false);
    assert.equal(namesTheModel({ attribute: 'edition', value: 'DualSense רגיל' }, { brand: 'Sony', product_family: 'DualSense' }), false);
    assert.equal(namesTheModel({ attribute: 'generation', value: 'דור שני' }, { brand: 'Apple', product_family: 'AirPods' }), false);
    assert.equal(namesTheModel({ attribute: 'camera model', value: 'EOS 5D Mark III' }, { brand: 'Canon', product_family: 'EOS' }), true);
    assert.equal(namesTheModel({ attribute: 'color', value: 'MX Master 3S' }, { brand: 'Logitech', product_family: 'MX Master' }), false, 'only identity questions');
  });
  test('SA-1c the search says it once: no "MX Master MX Master 3S", no "Apple Apple Watch"', () => {
    const q = buildSearchQueries({ identity: answered(mouse(), 'generation', 'MX Master 3S'), answer: { question: 'q', text: 'MX Master 3S' }, stage: 'local' });
    assert.ok(q.length > 0);
    for (const s of q) assert.doesNotMatch(s, /MX Master( 3S)? MX Master/);
    assert.ok(q.some((s) => s.startsWith('Logitech MX Master 3S ')));
    const watch = normalizeIdentity({ ...RAW_IDENTITY, brand: 'Apple', product_family: 'Apple Watch', model: null, model_number: null, display_name: 'Apple Watch', search: { hebrew_name: 'אפל ווטש', aliases: [], model_numbers: [] } });
    assert.equal(searchNames(watch).name, 'Apple Watch');
  });
  test('SA-1d a confirmed second generation is searched as "2", in both languages; the first stays unwritten', () => {
    const pods = normalizeIdentity({ ...RAW_IDENTITY, brand: 'Apple', product_family: 'AirPods', model: 'AirPods Pro', model_number: null, display_name: 'Apple AirPods Pro', exact_model_established: false, alternatives: [{ name: 'AirPods Pro (2nd generation)' }], search: { hebrew_name: 'איירפודס פרו', aliases: [], model_numbers: [] } });
    const two = searchNames({ ...pods, confirmed: [{ attribute: 'generation', value: 'דור שני' }] });
    assert.equal(two.name, 'Apple AirPods Pro 2');
    assert.equal(two.hebrew, 'איירפודס פרו 2');
    assert.deepEqual(two.alternatives, [], 'the other generation is no longer searched');
    const one = searchNames({ ...pods, confirmed: [{ attribute: 'generation', value: 'דור ראשון' }] });
    assert.equal(one.name, 'Apple AirPods Pro');
  });
});

describe('SA-4 one product, one option; a model number carried by a family word', () => {
  test('SA-4a "Nespresso Vertuo Pop" beside "Vertuo Pop" is one option; "iPhone 13 Pro Max" stays beside "iPhone 13 Pro"', async () => {
    const { distinctOptions } = await import('../api/_lib/scan/identify.js');
    assert.deepEqual(distinctOptions(['Vertuo Pop', 'Nespresso Vertuo Pop', 'Nespresso Vertuo Next']), ['Vertuo Pop', 'Nespresso Vertuo Next']);
    assert.deepEqual(distinctOptions(['iPhone 13 Pro', 'iPhone 13 Pro Max']), ['iPhone 13 Pro', 'iPhone 13 Pro Max']);
  });
  test('SA-4b "Galaxy S22 Ultra" answered for family "Galaxy S Ultra" names the model', () => {
    assert.equal(namesTheModel({ attribute: 'generation', value: 'Galaxy S22 Ultra' }, { brand: 'Samsung', product_family: 'Galaxy S Ultra' }), true);
    assert.equal(namesTheModel({ attribute: 'generation', value: 'Galaxy S Ultra' }, { brand: 'Samsung', product_family: 'Galaxy S Ultra' }), false, 'the family itself is not a model');
  });
});

describe('SA-5 a shop seen out of stock is not "unknown" (Apple Watch Series 4, Ivory, 2026-11-18)', () => {
  test('SA-5a merged sightings: out_of_stock beats unknown; in_stock beats both', async () => {
    const { mergeEvidence } = await import('../api/_lib/scan/evidence.js');
    const e = (stock) => ({ url: 'https://www.ivory.co.il/catalog.php?id=27338', price: 1699, currency: 'ILS', kind: 'new_retail', match: 'exact', condition: 'new_sealed', binding: 'strong', binding_reason: 'x', stock });
    assert.equal(mergeEvidence([e('unknown')], [e('out_of_stock')])[0].stock, 'out_of_stock');
    assert.equal(mergeEvidence([e('out_of_stock')], [e('unknown')])[0].stock, 'out_of_stock');
    assert.equal(mergeEvidence([e('out_of_stock')], [e('in_stock')])[0].stock, 'in_stock');
  });
});

describe('SA-6 the identity block speaks Hebrew (live scan 2026-11-18)', () => {
  test('SA-6a no internal English field name before the owner\'s answer in Hebrew; the photo\'s doubt goes once the owner settled the model', async () => {
    const { readFileSync } = await import('node:fs');
    const view = readFileSync(new URL('../src/views/ScanView.jsx', import.meta.url), 'utf8');
    assert.match(view, /\(lang === 'he' && !\/\[[^\]]+\]\/\.test\(c\.attribute\)\) \? c\.value/, 'Hebrew shows the answer without an English field name');
    assert.ok(view.includes('identity.uncertainty_note && !(identity.exact_model_established && (identity.confirmed ?? []).some((c) => !c.unsure))'), 'the settled doubt is hidden');
  });
});

describe('SA-2 "3S" is not "3"', () => {
  const page = (t, price) => ({ type: 'search_or_category', title: 'list', text: `${t} ${price} ש"ח` });
  test('SA-2a a confirmed "MX Master 3S": a "3S" row binds, a "3" row does not', () => {
    const i = { ...mouse(), confirmed: [{ attribute: 'generation', value: 'MX Master 3S' }] };
    assert.equal(isBound({ binding: bindPrice({ price: 259, currency: 'ILS', title: 'Logitech MX Master 3S', match: 'close_comparable' }, page('Logitech MX Master 3S', 259), i).level }), true);
    assert.equal(bindPrice({ price: 199, currency: 'ILS', title: 'Logitech MX Master 3', match: 'close_comparable' }, page('Logitech MX Master 3', 199), i).reason, 'row_does_not_state_the_confirmed_generation');
  });
});

describe('SA-3 a page whose address lists many things is a list page, whatever it was called', () => {
  test('SA-3a category, search, paged and collection addresses; product pages stay product pages', () => {
    const list = ['https://www.ivory.co.il/catalog.php?act=cat&f=11397&id=29329', 'https://www.ksp.co.il/web/cat/573..1798', 'https://shop.example.co.il/collections/mice', 'https://x.co.il/search?q=switch', 'https://x.co.il/products?page=2'];
    for (const u of list) assert.equal(pageTypeOf(u, 'shop_product'), 'search_or_category', u);
    const one = ['https://www.ivory.co.il/catalog.php?id=27338', 'https://www.ksp.co.il/web/item/123', 'https://shop.example.co.il/collections/mice/products/mx-master-3s', 'https://www.itechmobile.co.il/product/galaxy-s23'];
    for (const u of one) assert.equal(pageTypeOf(u, 'shop_product'), 'shop_product', u);
    assert.equal(pageTypeOf('https://www.zap.co.il/model.aspx?modelid=1', 'other'), 'shop_product');
  });
  test('SA-3b on such a page a price binds only in its own row: one row, one price', () => {
    const switchLite = normalizeIdentity({ ...RAW_IDENTITY, brand: 'Nintendo', product_family: 'Switch', model: 'Switch Lite', model_number: 'HDH-001', display_name: 'Nintendo Switch Lite', search: { hebrew_name: 'נינטנדו סוויץ לייט', aliases: [], model_numbers: [] } });
    const type = pageTypeOf('https://www.ivory.co.il/catalog.php?act=cat&f=11397&id=29329', 'shop_product');
    const row = bindPrice({ price: 749, currency: 'ILS', title: 'Switch Lite', match: 'exact' }, { type, title: 'Nintendo Switch', text: 'Nintendo Switch Lite HDH-001 749₪ מחיר באילת: 634₪' }, switchLite);
    assert.equal(row.level, 'verified_row');
    const together = bindPrice({ price: 749, currency: 'ILS', title: 'Switch Lite', match: 'exact' }, { type, title: 'Nintendo Switch', text: 'Nintendo Switch Lite 749₪ 650₪' }, switchLite);
    assert.notEqual(together.level, 'strong');
    assert.equal(isBound({ binding: together.level }), false, 'two prices run together: neither is the product\'s');
  });
});
