// SR — fewer paid searches without a different price (2026-11-15): one search per product at a time on an instance, and
// research found again when the same product is named in other words (product-key.js, the twin of the database's
// gw_product_base). Plus the phone's own timing breakdown reaching telemetry.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { productBase, productCapacity, productDriftKey } from '../api/_lib/scan/product-key.js';
import { runPrice, resetMarketCache, driftResearchKey } from '../api/_lib/scan/service.js';
import { resetFxCache } from '../api/_lib/scan/fx.js';
import { fakeProvider, NOW, RAW_IDENTITY } from './helpers/core-scan-fakes.mjs';
import { normalizeIdentity } from '../api/_lib/scan/identify.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const IDS = [
  { brand: 'Sony', model: 'DualSense', canonical_name: 'sony dualsense', configuration: 'complete_item' },
  { brand: 'Sony', model: 'DualSense Wireless Controller', canonical_name: 'sony dualsense wireless controller', variant: 'Midnight Black', configuration: 'complete_item' },
  { brand: 'סוני', model: 'דואלסנס', canonical_name: 'סוני דואלסנס' },
  { brand: 'Sony', model: 'DualSense Edge', canonical_name: 'sony dualsense edge wireless controller' },
  { brand: 'Apple', model: 'iPhone 13', canonical_name: 'apple iphone 13', size_or_capacity: '128 GB' },
  { brand: 'Apple', model: 'iPhone 13', canonical_name: 'apple iphone 13 256GB' },
  { brand: 'Apple', model: 'iPhone 13', canonical_name: 'apple iphone 13' },
  { brand: 'אפל', model: 'אייפון 13', canonical_name: 'אייפון 13 128 ג׳יגה' },
  { brand: 'Apple', canonical_name: 'apple airpods pro 2nd generation' },
  { brand: 'Apple', canonical_name: 'apple airpods pro (gen 2)' },
  { brand: 'Sony', model: 'PlayStation 5', canonical_name: 'sony playstation 5 disc edition', variant: 'Disc Edition' },
  { brand: 'Sony', model: 'PlayStation 5', canonical_name: 'sony playstation 5 digital edition', variant: 'Digital Edition' },
  { brand: 'Logitech', model: 'G Pro', canonical_name: 'logitech g pro' },
  { brand: 'Logitech', model: 'G Pro Wireless', canonical_name: 'logitech g pro' },
  { canonical_name: 'storage cabinet' },
  {},
];

describe('SR-1 the product key: one product in other words, never two products as one', () => {
  test('SR-1a the server key and the database key agree on every case (the twins cannot drift)', async () => {
    const sql = read('supabase/migrations/20261115140000_first_party_identity_and_integrity.sql');
    const d = new PGlite();
    await d.exec(sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.gw_identity_text'), sql.indexOf('REVOKE ALL ON FUNCTION public.gw_identity_text')));
    for (const i of IDS) {
      const r = (await d.query('select gw_product_base($1::jsonb) b, gw_product_capacity($1::jsonb) c', [JSON.stringify(i)])).rows[0];
      assert.deepEqual([productBase(i), productCapacity(i)], [r.b, r.c], JSON.stringify(i));
    }
  });
  test('SR-1b research keys: wording, colour and Hebrew share one; Edge, storage, editions and an unknown capacity do not', () => {
    const k = IDS.map((i) => productDriftKey(i));
    assert.equal(k[0], k[1]); assert.equal(k[0], k[2]);
    assert.notEqual(k[0], k[3]);
    assert.notEqual(k[4], k[5]); assert.notEqual(k[4], k[6], 'no wildcard: unknown storage is its own research');
    assert.equal(k[4], k[7]); assert.equal(k[8], k[9]); assert.notEqual(k[10], k[11]);
    assert.notEqual(k[12], k[13]);
    assert.equal(productDriftKey({}), null);
    assert.notEqual(productDriftKey(IDS[0], { text: 'model CFI-ZCT1W' }), k[0], 'the owner\'s answer stays in the key');
  });
});

describe('SR-2 one paid search per product', () => {
  const memStore = () => { const m = new Map(); return { load: async (k) => m.get(k) ?? null, save: async (k, r) => { m.set(k, r); } }; };
  const base = normalizeIdentity(RAW_IDENTITY);
  test('SR-2a two scans of one product at once: one search, both answered from it, the same price', async () => {
    resetMarketCache(); resetFxCache();
    const fetchImpl = fakeProvider();
    const opts = { store: memStore(), fetchImpl, model: 'm', apiKey: 'k', safetyIdentifier: 's', now: () => NOW, marketplace: async () => [], marketplaceListings: async () => [], parallel: false };
    const [a, b] = await Promise.all([runPrice({ identity: base, ...opts }), runPrice({ identity: base, ...opts })]);
    assert.equal(fetchImpl.of('market').filter((c) => c.stage === 'local').length, 1);
    assert.equal(a.status, b.status);
    assert.deepEqual(a.valuation.prices, b.valuation.prices);
    assert.equal([a, b].filter((r) => r.joined).length, 1);
    resetMarketCache();
  });
  test('SR-2b the same product named differently later: the research is found again, no second search', async () => {
    resetMarketCache(); resetFxCache();
    const fetchImpl = fakeProvider();
    const store = memStore();
    const opts = { store, fetchImpl, model: 'm', apiKey: 'k', safetyIdentifier: 's', now: () => NOW, marketplace: async () => [], marketplaceListings: async () => [], parallel: false };
    await runPrice({ identity: base, ...opts });
    const before = fetchImpl.of('market').length;
    resetMarketCache(); // another instance: only the shared store remembers
    const reworded = { ...base, canonical_name: `${base.canonical_name} wireless controller`, display_name: `${base.display_name} (black)`, variant: 'Black' };
    assert.equal(driftResearchKey(reworded), driftResearchKey(base));
    const r = await runPrice({ identity: reworded, ...opts });
    assert.equal(fetchImpl.of('market').length, before, 'no new search');
    assert.equal(r.reused, true);
    resetMarketCache();
  });
  test('SR-2c another variant is never answered from this research', async () => {
    resetMarketCache(); resetFxCache();
    const fetchImpl = fakeProvider();
    const opts = { store: memStore(), fetchImpl, model: 'm', apiKey: 'k', safetyIdentifier: 's', now: () => NOW, marketplace: async () => [], marketplaceListings: async () => [], parallel: false };
    await runPrice({ identity: base, ...opts });
    const before = fetchImpl.of('market').length;
    const other = { ...base, model: `${base.model} 2`, canonical_name: `${base.canonical_name} 2`, display_name: `${base.display_name} 2` };
    assert.notEqual(driftResearchKey(other), driftResearchKey(base));
    await runPrice({ identity: other, ...opts });
    assert.ok(fetchImpl.of('market').length > before, 'searched for the other model');
    resetMarketCache();
  });
});

describe('SR-3 where the phone\'s wait went', () => {
  test('SR-3a the phone measures photo-ready, identify-sent and price-sent, and the server keeps them, bounded', () => {
    const client = read('src/lib/coreScan.js');
    for (const f of ['prepared_ms', 'identify_sent_ms', 'price_sent_ms']) assert.match(client, new RegExp(`report: \\{[^}]*${f}`));
    const server = read('api/scan.js');
    for (const f of ['prepared_ms', 'identify_sent_ms', 'price_sent_ms']) assert.match(server, new RegExp(`${f}: ms\\(r\\.${f}\\)`));
  });
});
