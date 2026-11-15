// FP — first-party evidence classes (migration 20261115120000): where a listing price came from, each side's statement
// of a sale's final price, and what the evidence functions let through. Real Postgres (PGlite) on the Production-derived
// baseline, with the migrations applied in their Production order.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { listingPriceOrigin } from '../src/lib/marketplaceProvenance.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const ADMIN = '00000000-0000-4000-8000-00000000000a';
const S1 = '00000000-0000-4000-8000-00000000000b';
const B1 = '00000000-0000-4000-8000-00000000000c';
const TESTER = '00000000-0000-4000-8000-00000000000d';
const S2 = '00000000-0000-4000-8000-00000000000e';
const IDENT = { canonical_name: 'x phone', display_name: 'X Phone' };

async function db({ legacy = null } = {}) {
  const d = new PGlite();
  await d.exec(read('tests/fixtures/db/marketplace-baseline.sql'));
  await d.exec('ALTER TABLE public.valuations ADD COLUMN IF NOT EXISTS valuation_version integer DEFAULT 1;');
  await d.exec(`INSERT INTO auth.users (id) VALUES ('${ADMIN}'), ('${S1}'), ('${B1}'), ('${TESTER}'), ('${S2}');`);
  await d.exec(read('supabase/migrations/20261108120000_marketplace_price_provenance.sql'));
  await d.exec(read('supabase/migrations/20261108150000_marketplace_sale_evidence.sql'));
  await d.exec(read('supabase/migrations/20261113190000_marketplace_listing_evidence.sql'));
  await d.exec(`INSERT INTO profiles (id, full_name, is_admin) VALUES ('${ADMIN}', 'a', true), ('${S1}', 's', false), ('${B1}', 'b', false), ('${TESTER}', 't', false), ('${S2}', 's2', false);
    UPDATE profiles SET is_test = true WHERE id = '${TESTER}';`);
  if (legacy) await legacy(d);
  await d.exec(read('supabase/migrations/20261115120000_first_party_evidence_classes.sql'));
  return d;
}
const val = async (d, { user = S1, mid = null, identity = IDENT, version = 3, prices = null, created = 'now()' } = {}) => (await d.query(
  `INSERT INTO valuations (user_id, price_mid, valuation_version, ai_raw_response, created_at) VALUES ($1, $2, $3, $4, ${created}) RETURNING id`,
  [user, mid, version, JSON.stringify({ identity, valuation: prices ? { prices } : {} })])).rows[0].id;
const listing = async (d, { seller = S1, v = null, price = 500, source = null, origin = null, status = 'active' } = {}) => (await d.query(
  `INSERT INTO listings (seller_id, title, category, condition, price, status, valuation_id, price_source, price_origin) VALUES ($1, 'x', 'Electronics', 'used', $2, $3, $4, $5, $6) RETURNING id, price_origin, price_source`,
  [seller, price, status, v, source, origin])).rows[0];
const asService = (d, sql) => d.transaction(async (tx) => { await tx.exec('SET LOCAL ROLE service_role'); return (await tx.query(sql)).rows; });
const asUser = (d, uid, sql, params = []) => d.transaction(async (tx) => {
  await tx.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [uid]); await tx.exec('SET LOCAL ROLE authenticated');
  return (await tx.query(sql, params)).rows;
});
const rejects = (p, re) => assert.rejects(p, re);

describe('FP-1 a listing price records where it came from — not only how close it is', () => {
  test('FP-1a no GetWorth price shown (unpriced core scan) → independent, whatever the client says less strictly', async () => {
    const d = await db();
    const v = await val(d);
    assert.equal((await listing(d, { v, source: 'seller_entered', origin: 'independent' })).price_origin, 'independent');
    assert.equal((await listing(d, { v })).price_origin, 'independent');
  });
  test('FP-1b a GetWorth price was shown → after_suggestion even far from it; the client cannot claim independence', async () => {
    const d = await db();
    const v = await val(d, { mid: 1000 });
    const r = await listing(d, { v, price: 650, source: 'seller_entered', origin: 'independent' });
    assert.deepEqual([r.price_origin, r.price_source], ['after_suggestion', 'seller_entered']);
  });
  test('FP-1c the price GetWorth showed (2% / ₪5) → getworth_prefilled', async () => {
    const d = await db();
    const v = await val(d, { mid: 1000, prices: { good: { list: 1100, worth: 1000 } } });
    assert.equal((await listing(d, { v, price: 1095, origin: 'independent' })).price_origin, 'getworth_prefilled');
  });
  test('FP-1d the client may only make it stricter', async () => {
    const d = await db();
    const v = await val(d);
    assert.equal((await listing(d, { v, origin: 'after_suggestion' })).price_origin, 'after_suggestion');
    assert.equal((await listing(d, { v, source: 'getworth_valuation' })).price_origin, 'getworth_prefilled');
  });
  test('FP-1e a price shown on the seller\'s EARLIER scan of the same product counts as seen; another product does not', async () => {
    const d = await db();
    await val(d, { mid: 900, created: "now() - interval '1 day'" });
    await val(d, { mid: 900, identity: { canonical_name: 'y tablet' }, user: S1 });
    await val(d, { mid: 900, user: S2 });                                    // another person's scan: not seen by S1
    const v = await val(d);
    assert.equal((await listing(d, { v })).price_origin, 'after_suggestion');
    const d2 = await db();
    await val(d2, { mid: 900, identity: { canonical_name: 'y tablet' } });
    await val(d2, { mid: 900, user: S2 });
    assert.equal((await listing(d2, { v: await val(d2) })).price_origin, 'independent');
  });
  test('FP-1f no valuation linked → unknown (NULL), unless the client says stricter', async () => {
    const d = await db();
    assert.equal((await listing(d, { origin: 'independent' })).price_origin, null);
    assert.equal((await listing(d, { origin: 'after_suggestion' })).price_origin, 'after_suggestion');
  });
  test('FP-1g legacy listings keep NULL: nothing is inferred retroactively', async () => {
    const d = await db({ legacy: async (x) => {
      await x.query(`INSERT INTO listings (seller_id, title, category, condition, price, status) VALUES ($1, 'old', 'Electronics', 'used', 300, 'active')`, [S1]);
    } });
    assert.deepEqual((await d.query(`SELECT price_origin FROM listings WHERE title = 'old'`)).rows, [{ price_origin: null }]);
  });
  test('FP-1h relabelling is recomputed: a direct write cannot turn an influenced price independent', async () => {
    const d = await db();
    const v = await val(d, { mid: 1000 });
    const { id } = await listing(d, { v, price: 650 });
    await d.query(`UPDATE listings SET price_origin = 'independent', price_source = 'seller_entered' WHERE id = $1`, [id]);
    assert.equal((await d.query(`SELECT price_origin FROM listings WHERE id = $1`, [id])).rows[0].price_origin, 'after_suggestion');
    // and the seller's own client may only soft-delete (existing policy)
    await rejects(asUser(d, S1, `UPDATE listings SET price = 1 WHERE id = $1`, [id]), /row-level security|violates/);
  });
  test('FP-1i the client\'s claim: prefilled → getworth_prefilled; typed after a shown price → after_suggestion; nothing shown → independent', () => {
    assert.equal(listingPriceOrigin({ priceOrigin: 'suggestion', suggestionSeen: true }), 'getworth_prefilled');
    assert.equal(listingPriceOrigin({ priceOrigin: 'seller', suggestionSeen: true }), 'after_suggestion');
    assert.equal(listingPriceOrigin({ priceOrigin: 'seller', suggestionSeen: false }), 'independent');
    assert.equal(listingPriceOrigin({ priceOrigin: 'seller' }), 'independent');
  });
});

describe('FP-2 asking-price evidence: independent prices only', () => {
  test('FP-2a only the independent ask of a genuine seller stands', async () => {
    const d = await db();
    await listing(d, { v: await val(d), price: 500 });                                   // independent → in
    await listing(d, { seller: S2, v: await val(d, { user: S2, mid: 1000 }), price: 650 }); // influenced → out
    await listing(d, { seller: TESTER, v: await val(d, { user: TESTER }), price: 450 });  // test account → out
    await listing(d, { seller: ADMIN, v: await val(d, { user: ADMIN }), price: 450 });    // admin → out
    const rows = await asService(d, `SELECT price FROM marketplace_listing_evidence()`);
    assert.deepEqual(rows.map((r) => r.price), [500]);
  });
});

// A completed order, written as the lifecycle leaves it (the lifecycle itself: marketplace-provenance tests).
async function completed(d, { buyer = B1, seller = S1, final = null, origin = 'independent', v = null, status = 'completed' } = {}) {
  const vid = v ?? await val(d, { user: seller });
  const l = await listing(d, { seller, v: vid, status: 'sold', origin });
  return (await d.query(`INSERT INTO orders (listing_id, buyer_id, seller_id, price, delivery_method, status, completed_at, final_price, final_price_source, final_price_confirmed_at)
    VALUES ($1, $2, $3, 500, 'pickup', $4, now(), $5, ${final ? "'buyer_confirmed'" : 'NULL'}, ${final ? 'now()' : 'NULL'}) RETURNING id`, [l.id, buyer, seller, status, final])).rows[0].id;
}
const record = (d, uid, o, price) => asUser(d, uid, `SELECT record_sale_price($1, $2) r`, [o, price]);

describe('FP-3 each side states the final price once; only matching statements are a reported sale', () => {
  test('FP-3a seller and buyer state the same price → mutually_reported, never "verified"', async () => {
    const d = await db();
    const o = await completed(d);
    await record(d, S1, o, 480);
    assert.equal((await asService(d, `SELECT count(*)::int n FROM marketplace_sale_evidence()`))[0].n, 0, 'one side is not enough');
    await record(d, B1, o, 480);
    const rows = await asService(d, `SELECT final_price, verification FROM marketplace_sale_evidence()`);
    assert.deepEqual(rows, [{ final_price: 480, verification: 'mutually_reported' }]);
  });
  test('FP-3b different statements → not evidence; each side once only', async () => {
    const d = await db();
    const o = await completed(d, { final: 500 });
    await record(d, S1, o, 450);
    await rejects(record(d, S1, o, 500), /already recorded/);
    await rejects(record(d, B1, o, 450), /already recorded/);
    assert.equal((await asService(d, `SELECT count(*)::int n FROM marketplace_sale_evidence()`))[0].n, 0);
  });
  test('FP-3c not completed, not a party, out of range, anonymous: refused', async () => {
    const d = await db();
    const pending = await completed(d, { status: 'accepted' });
    await rejects(record(d, S1, pending, 400), /completed order/);
    const o = await completed(d);
    await rejects(record(d, S2, o, 400), /not found/i);
    await rejects(record(d, S1, o, 0), /between 1 and/);
    await rejects(d.transaction(async (tx) => { await tx.exec('SET LOCAL ROLE anon'); await tx.query(`SELECT record_sale_price($1, 1)`, [o]); }), /permission denied/);
  });
  test('FP-3d no party can write either statement directly', async () => {
    const d = await db();
    const o = await completed(d);
    await rejects(asUser(d, S1, `UPDATE orders SET seller_final_price = 1, seller_final_price_at = now() WHERE id = $1`, [o]), /permission denied/);
    await rejects(asUser(d, B1, `UPDATE orders SET final_price = 1 WHERE id = $1`, [o]), /permission denied/);
  });
  test('FP-3e test/admin parties, a GetWorth-priced listing, a repeated pair: excluded or counted once', async () => {
    const d = await db();
    const both = async (o, p) => { await record(d, S1, o, p); await record(d, B1, o, p); };
    await both(await completed(d), 400);
    await both(await completed(d), 410);                                            // same pair, same product → one
    const t = await completed(d, { buyer: TESTER, seller: S1 });
    await record(d, S1, t, 400); await record(d, TESTER, t, 400);                    // test account → out
    const pv = await val(d, { user: S1, mid: 400 });
    const g = await completed(d, { v: pv });                                         // listing at GetWorth's price → price_source getworth_valuation
    await d.query(`UPDATE listings SET price = 400 WHERE id = (SELECT listing_id FROM orders WHERE id = $1)`, [g]);
    await both(g, 400);
    const rows = await asService(d, `SELECT final_price FROM marketplace_sale_evidence()`);
    assert.equal(rows.length, 1);
  });
  test('FP-3f the evidence functions stay closed to users', async () => {
    const d = await db();
    await rejects(asUser(d, S1, `SELECT * FROM marketplace_sale_evidence()`), /permission denied/);
    await rejects(asUser(d, S1, `SELECT * FROM marketplace_listing_evidence()`), /permission denied/);
  });
});

describe('FP-4 rollback', () => {
  test('FP-4a the rollback restores the earlier functions and keeps every recorded statement', async () => {
    const d = await db();
    const o = await completed(d);
    await record(d, S1, o, 480);
    await d.exec(read('supabase/manual/20261115120000_rollback_first_party_evidence_classes.sql'));
    assert.deepEqual((await d.query(`SELECT seller_final_price FROM orders WHERE id = $1`, [o])).rows, [{ seller_final_price: 480 }]);
    await rejects(record(d, B1, o, 480), /does not exist/);
    const l = await listing(d, { v: await val(d), price: 500 });
    assert.equal(l.price_origin, null, 'the restored trigger no longer sets an origin');
  });
});
