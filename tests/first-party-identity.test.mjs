// FI — first-party evidence: the same PRODUCT across scans (not the same wording), new-retail exposure, duplicates and
// collusion (migration 20261115140000), and how a completed order's price is worded. Real Postgres (PGlite) on the
// Production-derived baseline with the migrations in their Production order.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { listingPriceOrigin, completedPriceLine } from '../src/lib/marketplaceProvenance.js';
import { buildValuation } from '../api/_lib/scan/valuation.js';
import { listingEvidenceFor } from '../api/_lib/scan/marketplace.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const ADMIN = '00000000-0000-4000-8000-00000000000a';
const S1 = '00000000-0000-4000-8000-00000000000b';
const B1 = '00000000-0000-4000-8000-00000000000c';
const S2 = '00000000-0000-4000-8000-00000000000e';
const B2 = '00000000-0000-4000-8000-00000000000f';

async function db() {
  const d = new PGlite();
  await d.exec(read('tests/fixtures/db/marketplace-baseline.sql'));
  await d.exec('ALTER TABLE public.valuations ADD COLUMN IF NOT EXISTS valuation_version integer DEFAULT 1;');
  // Production has valuations.new_retail (the scan's Israeli new price); the older baseline fixture predates it.
  await d.exec('ALTER TABLE public.valuations ADD COLUMN IF NOT EXISTS new_retail integer;');
  await d.exec(`INSERT INTO auth.users (id) VALUES ('${ADMIN}'), ('${S1}'), ('${B1}'), ('${S2}'), ('${B2}');`);
  for (const m of ['20261108120000_marketplace_price_provenance', '20261108150000_marketplace_sale_evidence', '20261113190000_marketplace_listing_evidence',
    '20261115120000_first_party_evidence_classes', '20261115140000_first_party_identity_and_integrity']) await d.exec(read(`supabase/migrations/${m}.sql`));
  await d.exec(`INSERT INTO profiles (id, full_name, is_admin) VALUES ('${ADMIN}', 'a', true), ('${S1}', 's', false), ('${B1}', 'b', false), ('${S2}', 's2', false), ('${B2}', 'b2', false);`);
  return d;
}
const same = async (d, a, b) => (await d.query(`SELECT public.gw_same_product($1::jsonb, $2::jsonb) r`, [JSON.stringify(a), JSON.stringify(b)])).rows[0].r;
const val = async (d, identity, { user = S1, mid = null, retail = null, created = 'now()' } = {}) => (await d.query(
  `INSERT INTO valuations (user_id, price_mid, new_retail, valuation_version, ai_raw_response, created_at) VALUES ($1, $2, $3, 3, $4, ${created}) RETURNING id`,
  [user, mid, retail, JSON.stringify({ identity })])).rows[0].id;
const listing = async (d, { seller = S1, v, price = 500, origin = null, status = 'active', created = 'now()' }) => (await d.query(
  `INSERT INTO listings (seller_id, title, category, condition, price, status, valuation_id, price_origin, created_at) VALUES ($1, 'x', 'Electronics', 'used', $2, $3, $4, $5, ${created}) RETURNING id, price_origin`,
  [seller, price, status, v, origin])).rows[0];
const asService = (d, sql) => d.transaction(async (tx) => { await tx.exec('SET LOCAL ROLE service_role'); return (await tx.query(sql)).rows; });
const asUser = (d, uid, sql, params = []) => d.transaction(async (tx) => {
  await tx.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [uid]); await tx.exec('SET LOCAL ROLE authenticated');
  return (await tx.query(sql, params)).rows;
});

const DS = { brand: 'Sony', model: 'DualSense', canonical_name: 'sony dualsense', configuration: 'complete_item' };
const DS_WORDY = { brand: 'Sony', model: 'DualSense Wireless Controller', canonical_name: 'sony dualsense wireless controller', variant: 'Midnight Black', configuration: 'complete_item' };
const DS_HE = { brand: 'סוני', model: 'דואלסנס', canonical_name: 'סוני דואלסנס', configuration: 'complete_item' };
const EDGE = { brand: 'Sony', model: 'DualSense Edge', canonical_name: 'sony dualsense edge wireless controller', configuration: 'complete_item' };
const IP = (cap, extra = {}) => ({ brand: 'Apple', model: 'iPhone 13', canonical_name: 'apple iphone 13', configuration: 'complete_item', ...(cap ? { size_or_capacity: cap } : {}), ...extra });

describe('FI-1 the same product across scans: wording, language and colour do not matter; variants do', () => {
  test('FI-1a DualSense: wordy name, missing brand, colour, Hebrew → the same; DualSense Edge → another product', async () => {
    const d = await db();
    assert.equal(await same(d, DS, DS_WORDY), true);
    assert.equal(await same(d, DS, { canonical_name: 'sony dualsense' }), true);
    assert.equal(await same(d, DS, DS_HE), true, 'translated names');
    assert.equal(await same(d, DS, EDGE), false);
    assert.equal(await same(d, DS_HE, EDGE), false);
  });
  test('FI-1b iPhone storage: 128 GB ≠ 256 GB; unknown storage may be either; a capacity written in the name or in Hebrew counts', async () => {
    const d = await db();
    assert.equal(await same(d, IP('128 GB'), IP('256GB')), false);
    assert.equal(await same(d, IP('128 GB'), IP(null)), true);
    assert.equal(await same(d, IP('128 GB'), IP(null, { canonical_name: 'apple iphone 13 256gb' })), false);
    assert.equal(await same(d, IP('128GB'), { brand: 'אפל', model: 'אייפון 13', canonical_name: 'אייפון 13 128 ג׳יגה' }), true);
    assert.equal(await same(d, IP('128GB'), { brand: 'אפל', model: 'אייפון 13', canonical_name: 'אייפון 13 256 ג׳יגה' }), false);
    assert.equal(await same(d, IP(null), IP(null, { model: 'iPhone 13 Pro', canonical_name: 'apple iphone 13 pro' })), false);
  });
  test('FI-1c generations, editions, configurations and model codes stay apart; an empty identity matches nothing', async () => {
    const d = await db();
    const pods = (n) => ({ brand: 'Apple', canonical_name: n });
    assert.equal(await same(d, pods('apple airpods pro 2nd generation'), pods('apple airpods pro (gen 2)')), true);
    assert.equal(await same(d, pods('apple airpods pro 2nd generation'), pods('apple airpods pro 3rd generation')), false);
    const ps5 = (v) => ({ brand: 'Sony', model: 'PlayStation 5', canonical_name: `sony playstation 5 ${v} edition`, variant: `${v} Edition` });
    assert.equal(await same(d, ps5('disc'), ps5('digital')), false);
    // Found in the Production rehearsal: "wireless" is a model word for a mouse, only "wireless controller" is description.
    const lg = (n, m) => ({ brand: 'Logitech', model: m, canonical_name: n });
    assert.equal(await same(d, lg('logitech g pro', 'G Pro'), lg('logitech g pro wireless', 'G Pro Wireless')), false);
    assert.equal(await same(d, DS, { ...DS, configuration: 'part_only' }), false);
    assert.equal(await same(d, { ...DS, model_number: 'CFI-ZCT1W' }, { ...DS, model_number: 'CFI-ZCP1' }), false);
    assert.equal(await same(d, { ...DS, model_number: 'CFI-ZCT1W' }, DS), true);
    assert.equal(await same(d, {}, {}), false);
  });
});

describe('FI-2 what the seller had seen, across scans of the same product', () => {
  test('FI-2a a new Israeli retail price shown (this scan or an earlier one) → after_reference, never independent, never evidence', async () => {
    const d = await db();
    assert.equal((await listing(d, { v: await val(d, DS, { retail: 349 }) })).price_origin, 'after_reference');
    await val(d, DS_HE, { retail: 349, created: "now() - interval '1 day'" });
    assert.equal((await listing(d, { v: await val(d, DS_WORDY), price: 260 })).price_origin, 'after_reference');
    assert.equal((await asService(d, `SELECT count(*)::int n FROM marketplace_listing_evidence()`))[0].n, 0);
  });
  test('FI-2b a used price shown on an earlier scan named differently (or in Hebrew) → after_suggestion', async () => {
    const d = await db();
    await val(d, DS_HE, { mid: 220, created: "now() - interval '2 days'" });
    assert.equal((await listing(d, { v: await val(d, DS_WORDY), price: 300 })).price_origin, 'after_suggestion');
  });
  test('FI-2c a price shown for ANOTHER variant does not taint this one; unknown storage after a priced 128 GB scan does', async () => {
    const d = await db();
    await val(d, EDGE, { mid: 600, created: "now() - interval '2 days'" });
    await val(d, IP('256GB'), { mid: 2000, created: "now() - interval '2 days'" });
    assert.equal((await listing(d, { v: await val(d, DS), price: 250 })).price_origin, 'independent');
    assert.equal((await listing(d, { v: await val(d, IP('128GB')), price: 1500 })).price_origin, 'independent');
    await val(d, IP('128GB'), { mid: 1600, created: "now() - interval '1 day'" });
    assert.equal((await listing(d, { v: await val(d, IP(null)), price: 1400 })).price_origin, 'after_suggestion');
  });
  test('FI-2d the client may claim after_reference (stricter); it is ranked between independent and after_suggestion', async () => {
    const d = await db();
    assert.equal((await listing(d, { v: await val(d, DS), origin: 'after_reference' })).price_origin, 'after_reference');
    assert.equal((await listing(d, { v: await val(d, DS, { retail: 349 }), origin: 'after_suggestion' })).price_origin, 'after_suggestion');
    assert.equal(listingPriceOrigin({ priceOrigin: 'seller', referenceSeen: true }), 'after_reference');
    assert.equal(listingPriceOrigin({ priceOrigin: 'seller', referenceSeen: true, suggestionSeen: true }), 'after_suggestion');
    assert.equal(listingPriceOrigin({ priceOrigin: 'suggestion', referenceSeen: true }), 'getworth_prefilled');
  });
});

describe('FI-3 duplicates and collusion', () => {
  test('FI-3a one seller, one product named two ways → one ask; another account cross-posting the same item the same day at the same price → one ask', async () => {
    const d = await db();
    await listing(d, { v: await val(d, DS), price: 250, created: "now() - interval '3 days'" });
    await listing(d, { v: await val(d, DS_WORDY), price: 240 });
    await listing(d, { seller: S2, v: await val(d, DS_HE, { user: S2 }), price: 240 });
    const rows = await asService(d, `SELECT price FROM marketplace_listing_evidence()`);
    assert.deepEqual(rows.map((r) => r.price), [240]);
    await listing(d, { seller: S2, v: await val(d, DS, { user: S2 }), price: 270 });         // a different ask → counts
    assert.equal((await asService(d, `SELECT count(*)::int n FROM marketplace_listing_evidence()`))[0].n, 2);
  });
  async function sale(d, { buyer, seller, price, identity = DS }) {
    const l = await listing(d, { seller, v: await val(d, identity, { user: seller }), price, status: 'sold' });
    const o = (await d.query(`INSERT INTO orders (listing_id, buyer_id, seller_id, price, delivery_method, status, completed_at) VALUES ($1, $2, $3, $4, 'pickup', 'completed', now()) RETURNING id`, [l.id, buyer, seller, price])).rows[0].id;
    await asUser(d, seller, `SELECT record_sale_price($1, $2)`, [o, price]);
    await asUser(d, buyer, `SELECT record_sale_price($1, $2)`, [o, price]);
    return o;
  }
  test('FI-3b a pair repeating sales — even of different products — counts once; a pair trading both ways counts not at all', async () => {
    const d = await db();
    await sale(d, { buyer: B1, seller: S1, price: 250 });
    await sale(d, { buyer: B1, seller: S1, price: 2000, identity: IP('128GB') });
    assert.equal((await asService(d, `SELECT count(*)::int n FROM marketplace_sale_evidence()`))[0].n, 1);
    await sale(d, { buyer: B2, seller: S2, price: 260 });
    await sale(d, { buyer: S2, seller: B2, price: 270 });
    assert.equal((await asService(d, `SELECT count(*)::int n FROM marketplace_sale_evidence()`))[0].n, 1, 'the wash-trading pair adds nothing');
  });
  test('FI-3c a GetWorth asking price far from the other Israeli asks is set aside by the valuation, like any other reference', () => {
    const TODAY = '2026-11-15';
    const ad = (price, i) => ({ url: `https://www.homeless.co.il/x/${i}`, domain: 'homeless.co.il', title: 'DualSense', price, currency: 'ILS', price_ils: price, kind: 'used_listing', match: 'exact', market: 'IL', condition: 'good', page: 'listing', listed: TODAY, binding: 'strong', seen: TODAY });
    const ask = listingEvidenceFor(DS, [{ listing_ref: 'a1b2c3d4e5f60718', seller_ref: 'b1b2c3d4e5f60718', price: 2500, created_at: `${TODAY}T08:00:00Z`, condition: 'used', identity: DS }], { today: TODAY });
    assert.equal(ask.length, 1);
    const v = buildValuation({ evidence: [ad(240, 1), ad(250, 2), ad(260, 3), ...ask], today: TODAY });
    const gw = v.evidence.find((e) => e.source === 'getworth_listing');
    assert.equal(gw.used, false, 'a ₪2,500 ask among ₪240–260 asks does not move the price');
    assert.ok(v.prices.good.worth < 300);
  });
  test('FI-3d the helpers and evidence functions stay closed to users', async () => {
    const d = await db();
    await assert.rejects(asUser(d, S1, `SELECT public.gw_same_product('{}'::jsonb, '{}'::jsonb)`), /permission denied/);
    await assert.rejects(asUser(d, S1, `SELECT * FROM marketplace_listing_evidence()`), /permission denied/);
  });
});

describe('FI-4 a completed order\'s price is said for what it is', () => {
  test('FI-4a listing price until both sides state the same final price; never "paid" to GetWorth; never "verified"', () => {
    for (const lang of ['en', 'he']) {
      for (const role of ['buyer', 'seller']) {
        const only = completedPriceLine({ listingPrice: 500, buyer: 480, seller: null, role, lang });
        assert.equal(only.kind, 'listing'); assert.equal(only.amount, 500);
        const differ = completedPriceLine({ listingPrice: 500, buyer: 480, seller: 470, role, lang });
        assert.equal(differ.kind, 'listing');
        const agreed = completedPriceLine({ listingPrice: 500, buyer: 480, seller: 480, role, lang });
        assert.deepEqual([agreed.kind, agreed.amount], ['agreed', 480]);
        for (const l of [only, agreed]) {
          assert.doesNotMatch(`${l.label} ${l.note}`, /you paid|שילמת|verified|מאומת/i);
          assert.match(l.note, lang === 'he' ? /לא מעבדת תשלומים/ : /does not process payments/);
        }
      }
    }
    assert.equal(completedPriceLine({ listingPrice: 500, role: 'seller' }).note.includes('you listed'), true);
  });
  test('FI-4b the order screens no longer say "You paid" for an asking price, and label the listing price as such', () => {
    const views = read('src/views/OrderViews.jsx');
    assert.doesNotMatch(views, /You paid \$\{|שילמת \$\{/);
    assert.doesNotMatch(views, /'Total to pay'/);
    assert.match(views, /<SalePriceConfirm orderId=\{order\.id\} userId=\{user\?\.id\} listingPrice=\{order\.price\}/);
    assert.match(views, /GetWorth does not process payments/);
  });
});

describe('FI-5 rollback', () => {
  test('FI-5a restores the previous functions, drops the helpers, keeps every row valid', async () => {
    const d = await db();
    const { id } = await listing(d, { v: await val(d, DS, { retail: 349 }) });
    await d.exec(read('supabase/manual/20261115140000_rollback_first_party_identity_and_integrity.sql'));
    assert.deepEqual((await d.query(`SELECT price_origin FROM listings WHERE id = $1`, [id])).rows, [{ price_origin: 'after_reference' }]);
    await assert.rejects(d.query(`SELECT public.gw_same_product('{}'::jsonb, '{}'::jsonb)`), /does not exist/);
    assert.equal((await listing(d, { v: await val(d, DS) })).price_origin, 'independent');
  });
});
