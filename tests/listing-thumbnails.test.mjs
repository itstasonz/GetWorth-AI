// LT — listing thumbnails (Production scan b4254487, 2026-11-10: the quota check waited 3,556 ms behind the phone's own
// order/chat/listing reloads, each shipping base64 photographs of up to 2.4 MB a row).
// Real Postgres (PGlite) on Production's captured schema: the marketplace baseline, the two order functions exactly as
// pg_get_functiondef printed them in Production, then migration 20261111120000 — and its rollback.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { LISTING_CARD_COLUMNS, LISTING_PREVIEW_COLUMNS, asCard, orderWithCardListing } from '../src/lib/listingImages.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const BASELINE = read('tests/fixtures/db/marketplace-baseline.sql');
const ORDER_RPCS = read('tests/fixtures/db/order-rpcs-20261110.sql');
const MIGRATION = read('supabase/migrations/20261111120000_listing_thumbnails.sql');
const ROLLBACK = read('supabase/manual/20261111120000_rollback_listing_thumbnails.sql');

const BUYER = '00000000-0000-4000-8000-0000000000b1';
const SELLER = '00000000-0000-4000-8000-0000000000c1';
const STRANGER = '00000000-0000-4000-8000-0000000000d1';
const BIG = `data:image/jpeg;base64,${'A'.repeat(300_000)}`;            // a legacy inline photograph
const URL1 = 'https://example.supabase.co/storage/v1/object/public/listings/u/1.jpg';
const URL2 = 'https://example.supabase.co/storage/v1/object/public/listings/u/2.jpg';

// listings columns as Production's pg_attribute listed them on 2026-11-10 (before this migration).
const PRODUCTION_LISTING_COLUMNS = 'id, seller_id, title, title_hebrew, description, category, condition, price, original_price, images, location, status, views, saves, is_featured, is_boosted, boost_expires_at, condition_details, contact_method, contact_phone, created_at, updated_at, expires_at, quality_score, sold_to, sold_at, attributes, product_id, valuation_id, subcategory, ai_confidence, actual_sold_price, serial_submitted, serial_verified, serial_masked, serial_type, price_source, suggested_price';

async function fresh({ migrate = true } = {}) {
  const db = new PGlite();
  await db.exec(BASELINE);
  await db.exec(ORDER_RPCS);
  await db.exec(`
    GRANT EXECUTE ON FUNCTION public.get_user_orders() TO anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.get_order_by_id(uuid) TO anon, authenticated;
    INSERT INTO auth.users (id) VALUES ('${BUYER}'), ('${SELLER}'), ('${STRANGER}');
    INSERT INTO public.profiles (id, full_name) VALUES ('${BUYER}', 'b'), ('${SELLER}', 's'), ('${STRANGER}', 'x');
    INSERT INTO public.listings (id, seller_id, title, category, condition, price, images) VALUES
      ('10000000-0000-4000-8000-000000000001', '${SELLER}', 'legacy', 'Electronics', 'used', 100, ARRAY['${BIG}', '${BIG}']),
      ('10000000-0000-4000-8000-000000000002', '${SELLER}', 'stored', 'Electronics', 'used', 200, ARRAY['${URL1}', '${URL2}']);
    INSERT INTO public.orders (id, listing_id, buyer_id, seller_id, price, delivery_method) VALUES
      ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '${BUYER}', '${SELLER}', 100, 'pickup'),
      ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', '${BUYER}', '${SELLER}', 200, 'pickup');
  `);
  if (migrate) await db.exec(MIGRATION);
  return db;
}

async function as(db, uid, fn) {
  return db.transaction(async (tx) => {
    await tx.query(`SELECT set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)`,
      [uid ?? '', JSON.stringify(uid ? { sub: uid, role: 'authenticated' } : { role: 'anon' })]);
    await tx.exec(`SET LOCAL ROLE ${uid ? 'authenticated' : 'anon'}`);
    return fn(tx);
  });
}
const rows = (db, uid, sql, params = []) => as(db, uid, async (tx) => (await tx.query(sql, params)).rows);
const orders = async (db, uid) => (await rows(db, uid, 'SELECT o FROM public.get_user_orders() o')).map((r) => r.o);
const bytes = (v) => Buffer.byteLength(JSON.stringify(v));

describe('LT-1 the defect, as Production had it', () => {
  test('LT-1a get_user_orders ships every inline photograph of every ordered listing', async () => {
    const db = await fresh({ migrate: false });
    const list = await orders(db, BUYER);
    assert.equal(list.length, 2);
    assert.ok(bytes(list) > 600_000, `payload ${bytes(list)} bytes`);
  });
});

describe('LT-2 after the migration: thumbnails, not photographs', () => {
  test('LT-2a existing rows: a Storage URL becomes the thumbnail; an inline photograph leaves it empty; counts are written', async () => {
    const db = await fresh();
    const r = (await db.query(`SELECT title, thumbnail, image_count FROM public.listings ORDER BY title`)).rows;
    assert.deepEqual(r, [{ title: 'legacy', thumbnail: null, image_count: 2 }, { title: 'stored', thumbnail: URL1, image_count: 2 }]);
  });

  test('LT-2b get_user_orders embeds images = [thumbnail] and image_count; every other field is unchanged', async () => {
    const before = await orders(await fresh({ migrate: false }), BUYER);
    const db = await fresh();
    await db.query(`UPDATE public.listings SET thumbnail = 'data:image/jpeg;base64,/9j/small' WHERE title = 'legacy'`);
    const after = await orders(db, BUYER);
    assert.ok(bytes(after) < 3_000, `payload ${bytes(after)} bytes`);
    const byId = Object.fromEntries(after.map((o) => [o.listing.title, o.listing]));
    assert.deepEqual(byId.legacy.images, ['data:image/jpeg;base64,/9j/small']);
    assert.deepEqual(byId.stored.images, [URL1]);
    assert.equal(byId.stored.image_count, 2);
    // Rows come from two databases: their timestamps differ; every other field must not.
    const strip = (o) => ({ ...o, created_at: undefined, updated_at: undefined, listing: { ...o.listing, images: undefined, image_count: undefined } });
    assert.deepEqual(after.map(strip), before.map(strip));
  });

  test('LT-2c get_order_by_id: the same thumbnail, and still only for a party to the order', async () => {
    const db = await fresh();
    const id = '20000000-0000-4000-8000-000000000002';
    const mine = await rows(db, BUYER, 'SELECT o FROM public.get_order_by_id($1) o', [id]);
    assert.deepEqual(mine[0].o.listing.images, [URL1]);
    assert.equal((await rows(db, SELLER, 'SELECT o FROM public.get_order_by_id($1) o', [id])).length, 1);
    assert.equal((await rows(db, STRANGER, 'SELECT o FROM public.get_order_by_id($1) o', [id])).length, 0);
    assert.equal((await rows(db, null, 'SELECT o FROM public.get_order_by_id($1) o', [id])).length, 0);
    assert.equal((await orders(db, STRANGER)).length, 0);
  });

  test('LT-2d new listings: the trigger derives thumbnail and count from images; a client value is ignored', async () => {
    const db = await fresh();
    await as(db, SELLER, (tx) => tx.query(
      `INSERT INTO public.listings (seller_id, title, category, condition, price, images, thumbnail, image_count, status)
       VALUES ($1, 'new', 'Electronics', 'used', 50, $2, 'https://evil.example/pixel.gif', 99, 'active')`, [SELLER, [URL2, URL1]]));
    const r = (await db.query(`SELECT thumbnail, image_count FROM public.listings WHERE title = 'new'`)).rows[0];
    assert.deepEqual(r, { thumbnail: URL2, image_count: 2 });
  });

  test('LT-2e only the maintenance role sets a thumbnail; an owner\'s update cannot', async () => {
    const db = await fresh();
    await as(db, SELLER, (tx) => tx.query(
      `UPDATE public.listings SET status = 'deleted', thumbnail = 'https://evil.example/x.gif', image_count = 7 WHERE title = 'stored'`));
    let r = (await db.query(`SELECT status, thumbnail, image_count FROM public.listings WHERE title = 'stored'`)).rows[0];
    assert.deepEqual(r, { status: 'deleted', thumbnail: URL1, image_count: 2 });
    await db.query(`UPDATE public.listings SET thumbnail = 'data:image/jpeg;base64,/9j/x' WHERE title = 'legacy'`); // as postgres
    r = (await db.query(`SELECT thumbnail FROM public.listings WHERE title = 'legacy'`)).rows[0];
    assert.equal(r.thumbnail, 'data:image/jpeg;base64,/9j/x');
  });

  test('LT-2f changing the photographs recomputes the thumbnail; other updates leave it alone', async () => {
    const db = await fresh();
    await db.query(`UPDATE public.listings SET price = 150 WHERE title = 'stored'`);
    assert.equal((await db.query(`SELECT thumbnail FROM public.listings WHERE title = 'stored'`)).rows[0].thumbnail, URL1);
    await db.query(`UPDATE public.listings SET images = $1 WHERE title = 'stored'`, [[URL2]]);
    const r = (await db.query(`SELECT thumbnail, image_count FROM public.listings WHERE title = 'stored'`)).rows[0];
    assert.deepEqual(r, { thumbnail: URL2, image_count: 1 });
  });

  test('LT-2g an oversized thumbnail is refused', async () => {
    const db = await fresh();
    await assert.rejects(db.query(`UPDATE public.listings SET thumbnail = $1 WHERE title = 'legacy'`, [`data:${'A'.repeat(100_001)}`]), /listings_thumbnail_size/);
  });

  test('LT-2h RLS is unchanged: a stranger reads active listings\' card columns, not a deleted one', async () => {
    const db = await fresh();
    await db.query(`UPDATE public.listings SET status = 'deleted' WHERE title = 'legacy'`);
    const r = await rows(db, STRANGER, `SELECT title, thumbnail, image_count FROM public.listings ORDER BY title`);
    assert.deepEqual(r, [{ title: 'stored', thumbnail: URL1, image_count: 2 }]);
  });
});

describe('LT-3 rollback', () => {
  test('LT-3a restores both functions exactly and drops the columns', async () => {
    const db = await fresh();
    await db.exec(ROLLBACK);
    const list = await orders(db, BUYER);
    assert.ok(bytes(list) > 600_000);
    const cols = (await db.query(`SELECT attname FROM pg_attribute WHERE attrelid = 'public.listings'::regclass AND attname IN ('thumbnail','image_count') AND NOT attisdropped`)).rows;
    assert.equal(cols.length, 0);
  });
});

describe('LT-4 the client reads cards with the columns the table has', () => {
  test('LT-4a LISTING_CARD_COLUMNS = every Production listings column except images, plus thumbnail and image_count', () => {
    const want = PRODUCTION_LISTING_COLUMNS.split(', ').filter((c) => c !== 'images').concat(['thumbnail', 'image_count']);
    assert.deepEqual(LISTING_CARD_COLUMNS.split(', '), want);
    assert.ok(!/\bimages\b/.test(LISTING_PREVIEW_COLUMNS));
  });

  test('LT-4b asCard gives screens images = [thumbnail], marks the row partial, and leaves full rows alone', () => {
    const card = asCard({ id: 'a', title: 't', thumbnail: URL1, image_count: 3 });
    assert.deepEqual(card, { id: 'a', title: 't', images: [URL1], image_count: 3, _imagesPartial: true });
    assert.deepEqual(asCard({ id: 'b', thumbnail: null, image_count: 0 }).images, []);
    const full = { id: 'c', images: [URL1, URL2] };
    assert.equal(asCard(full), full);
    assert.equal(asCard(card), card);
    assert.equal(orderWithCardListing({ id: 'o', listing: { id: 'l', images: [URL1] } }).listing._imagesPartial, true);
    assert.equal(orderWithCardListing(null), null);
  });
});
