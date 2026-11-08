// MP — migration 20261108120000_marketplace_price_provenance against Production's own schema, in real Postgres (PGlite).
// tests/fixtures/db/marketplace-baseline.sql is generated from a read-only catalog capture of Production: the same
// columns, constraints, RLS policies, triggers and function bodies. Each test runs the order lifecycle as the
// `authenticated` role with a JWT subject, exactly as the app's RPC calls do.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const BASELINE = read('tests/fixtures/db/marketplace-baseline.sql');
const MIGRATION = read('supabase/migrations/20261108120000_marketplace_price_provenance.sql');
const ROLLBACK = read('supabase/manual/20261108120000_rollback_marketplace_price_provenance.sql');

const ADMIN = '00000000-0000-4000-8000-00000000000a';
const SELLER = '00000000-0000-4000-8000-00000000000b';
const BUYER = '00000000-0000-4000-8000-00000000000c';
const BUYER2 = '00000000-0000-4000-8000-00000000000d';
const VAL_CORE = '00000000-0000-4000-8000-0000000000f1';
const VAL_MANUAL = '00000000-0000-4000-8000-0000000000f2';
const CORE_PRICES = { good: { list: 290, worth: 255, quick: 240, low: 240, high: 270 }, like_new: { list: 340, worth: 300, quick: 290, low: 290, high: 320 } };

async function fresh({ migrate = true } = {}) {
  const db = new PGlite();
  await db.exec(BASELINE);
  await db.exec(`
    INSERT INTO auth.users (id) VALUES ('${ADMIN}'), ('${SELLER}'), ('${BUYER}'), ('${BUYER2}');
    INSERT INTO public.profiles (id, full_name, is_admin) VALUES ('${ADMIN}', 'admin', true), ('${SELLER}', 's', false), ('${BUYER}', 'b', false), ('${BUYER2}', 'b2', false);
    INSERT INTO public.valuations (id, user_id, price_low, price_mid, price_high, ai_raw_response) VALUES
      ('${VAL_CORE}', '${SELLER}', 240, 255, 270, '${JSON.stringify({ valuation: { prices: CORE_PRICES } })}'),
      ('${VAL_MANUAL}', '${SELLER}', NULL, NULL, NULL, '{"valuation":{"prices":null}}');
  `);
  if (migrate) await db.exec(MIGRATION);
  return db;
}

/** Run `fn(tx)` as an authenticated user (the app's role and JWT subject), in its own transaction. */
async function as(db, uid, fn) {
  return db.transaction(async (tx) => {
    await tx.query(`SELECT set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)`, [uid ?? '', JSON.stringify(uid ? { sub: uid, role: 'authenticated' } : {})]);
    await tx.exec('SET LOCAL ROLE authenticated');
    return fn(tx);
  });
}
const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];
const rejects = async (p, pattern) => { try { await p; } catch (e) { if (pattern) assert.match(e.message, pattern); return true; } assert.fail('expected a refusal'); };

async function listing(db, { title, price, valuation = null, claim = null }) {
  return as(db, SELLER, async (tx) => (await tx.query(
    `INSERT INTO listings (seller_id, title, category, condition, price, status, valuation_id${claim ? ', price_source, suggested_price' : ''})
     VALUES ($1, $2, 'Other', 'used', $3, 'active', $4${claim ? ", 'seller_entered', 1" : ''}) RETURNING id`, [SELLER, title, price, valuation])).rows[0].id);
}
async function orderReady(db, listingId, price, buyer = BUYER) {
  const created = await as(db, buyer, async (tx) => (await tx.query(`SELECT create_order($1, $2, $3, 'pickup') AS r`, [listingId, SELLER, price])).rows[0].r);
  await as(db, SELLER, async (tx) => {
    await tx.query(`SELECT transition_order($1, 'accepted', '{}'::jsonb)`, [created.id]);
    await tx.query(`SELECT transition_order($1, 'ready_pickup', '{}'::jsonb)`, [created.id]);
  });
  return created.id;
}
const complete = (db, orderId, meta = {}, who = BUYER) => as(db, who, async (tx) => (await tx.query(`SELECT transition_order($1, 'completed', $2::jsonb) AS r`, [orderId, JSON.stringify(meta)])).rows[0].r);

describe('MP-0 the baseline is Production as it is today', () => {
  test('MP-0a a completed order becomes a comp at its ASKING price, from any account (the circular path the migration closes)', async () => {
    const db = await fresh({ migrate: false });
    const id = await as(db, SELLER, async (tx) => (await tx.query(`INSERT INTO listings (seller_id, title, category, condition, price, status) VALUES ($1, 'asking', 'Other', 'used', 500, 'active') RETURNING id`, [SELLER])).rows[0].id);
    const o = await orderReady(db, id, 500, ADMIN);
    await as(db, ADMIN, (tx) => tx.query(`SELECT transition_order($1, 'completed', '{}'::jsonb)`, [o]));
    assert.equal(Number((await one(db, `SELECT price FROM comps WHERE title = 'asking'`)).price), 500, 'the admin\'s test purchase, at the asking price, is a comp');
  });
});

describe('MP-0b Production today: a genuine buyer\'s sale never reached its valuation', () => {
  test('MP-0b under the old trigger the valuations guard silently reverts actual_sold_price for a non-admin buyer', async () => {
    const db = await fresh({ migrate: false });
    const id = await as(db, SELLER, async (tx) => (await tx.query(`INSERT INTO listings (seller_id, title, category, condition, price, status, valuation_id) VALUES ($1, 'old flow', 'Other', 'used', 255, 'active', $2) RETURNING id`, [SELLER, VAL_CORE])).rows[0].id);
    await db.query(`UPDATE valuations SET listing_id = $1 WHERE id = $2`, [id, VAL_CORE]);
    const o = await orderReady(db, id, 255);
    await as(db, BUYER, (tx) => tx.query(`SELECT transition_order($1, 'completed', '{}'::jsonb)`, [o]));
    assert.equal((await one(db, `SELECT actual_sold_price FROM valuations WHERE id = $1`, [VAL_CORE])).actual_sold_price, null);
  });
});

describe('MP-1 history is preserved, nothing is invented', () => {
  test('MP-1a rows from before the migration keep NULL final price and NULL provenance; nobody becomes a test account', async () => {
    const db = await fresh({ migrate: false });
    const id = await as(db, SELLER, async (tx) => (await tx.query(`INSERT INTO listings (seller_id, title, category, condition, price, status, valuation_id) VALUES ($1, 'old', 'Other', 'used', 255, 'active', $2) RETURNING id`, [SELLER, VAL_CORE])).rows[0].id);
    const o = await orderReady(db, id, 255);
    await complete(db, o);
    await db.exec(MIGRATION);
    assert.deepEqual(await one(db, `SELECT final_price, final_price_source, final_price_confirmed_at, price FROM orders WHERE id = $1`, [o]), { final_price: null, final_price_source: null, final_price_confirmed_at: null, price: 255 });
    assert.deepEqual(await one(db, `SELECT price_source, suggested_price, actual_sold_price FROM listings WHERE id = $1`, [id]), { price_source: null, suggested_price: null, actual_sold_price: null });
    assert.equal(Number((await one(db, `SELECT count(*) n FROM profiles WHERE is_test`)).n), 0);
  });
});

describe('MP-1b the existing profile guard keeps working (regression: a fast default read back as NULL)', () => {
  test('MP-1b a user edits their own profile after the migration, on a row that existed before it', async () => {
    const db = await fresh();
    await as(db, SELLER, (tx) => tx.query(`UPDATE profiles SET full_name = 'renamed', location = 'Haifa' WHERE id = $1`, [SELLER]));
    assert.deepEqual(await one(db, `SELECT full_name, location, is_test FROM profiles WHERE id = $1`, [SELLER]), { full_name: 'renamed', location: 'Haifa', is_test: false });
  });
});

describe('MP-2 where a listing price came from is decided by the server', () => {
  test('MP-2a no valuation → seller_entered; GetWorth\'s number (any condition, list/worth/quick/range) → getworth_valuation; 3% off → seller_entered; a valuation that showed no price → seller_entered', async () => {
    const db = await fresh();
    const src = async (args) => one(db, `SELECT price_source, suggested_price FROM listings WHERE id = $1`, [await listing(db, args)]);
    assert.deepEqual(await src({ title: 'own', price: 123 }), { price_source: 'seller_entered', suggested_price: null });
    for (const price of [290, 255, 240, 270, 340, 300, 295]) {
      assert.deepEqual(await src({ title: `at ${price}`, price, valuation: VAL_CORE }), { price_source: 'getworth_valuation', suggested_price: 290 }, String(price));
    }
    assert.deepEqual(await src({ title: 'off', price: 360, valuation: VAL_CORE }), { price_source: 'seller_entered', suggested_price: 290 });
    assert.deepEqual(await src({ title: 'manual', price: 255, valuation: VAL_MANUAL }), { price_source: 'seller_entered', suggested_price: null });
  });
  test('MP-2b a client claiming independence for GetWorth\'s own number is overruled', async () => {
    const db = await fresh();
    assert.deepEqual(await one(db, `SELECT price_source, suggested_price FROM listings WHERE id = $1`, [await listing(db, { title: 'spoof', price: 290, valuation: VAL_CORE, claim: true })]), { price_source: 'getworth_valuation', suggested_price: 290 });
  });
});

describe('MP-2c the seller\'s stated intent can only make the classification stricter', () => {
  test('MP-2c "I kept the suggestion" holds even when the number no longer matches; "I typed it" never overrides a match', async () => {
    const db = await fresh();
    const insert = (title, price, valuation, claim) => as(db, SELLER, async (tx) => (await tx.query(
      `INSERT INTO listings (seller_id, title, category, condition, price, status, valuation_id, price_source) VALUES ($1, $2, 'Other', 'used', $3, 'active', $4, $5) RETURNING id`, [SELLER, title, price, valuation, claim])).rows[0].id);
    const src = async (id) => (await one(db, `SELECT price_source FROM listings WHERE id = $1`, [id])).price_source;
    assert.equal(await src(await insert('kept, adjusted', 333, VAL_CORE, 'getworth_valuation')), 'getworth_valuation');
    assert.equal(await src(await insert('kept, no valuation', 50, null, 'getworth_valuation')), 'getworth_valuation');
    assert.equal(await src(await insert('typed, matches', 290, VAL_CORE, 'seller_entered')), 'getworth_valuation');
    assert.equal(await src(await insert('typed, own', 333, VAL_CORE, 'seller_entered')), 'seller_entered');
    assert.equal(await src(await insert('nonsense', 10, null, 'trust_me')), 'seller_entered', 'an unknown claim is normalised by the trigger, never stored');
  });
});

describe('MP-3 the order lifecycle records what the buyer confirms, and only that', () => {
  test('MP-3a buyer completes with a final price: recorded as buyer_confirmed beside the untouched asking price; the listing is sold at it; a comp at it', async () => {
    const db = await fresh();
    const id = await listing(db, { title: 'sofa', price: 600 });
    const o = await orderReady(db, id, 600);
    const r = await complete(db, o, { final_price: 520 });
    assert.deepEqual([r.status, r.final_price], ['completed', 520]);
    const row = await one(db, `SELECT price, final_price, final_price_source, final_price_confirmed_at IS NOT NULL AS stamped FROM orders WHERE id = $1`, [o]);
    assert.deepEqual(row, { price: 600, final_price: 520, final_price_source: 'buyer_confirmed', stamped: true });
    assert.deepEqual(await one(db, `SELECT status, actual_sold_price FROM listings WHERE id = $1`, [id]), { status: 'sold', actual_sold_price: 520 });
    assert.equal(Number((await one(db, `SELECT price FROM comps WHERE title = 'sofa'`)).price), 520);
  });
  test('MP-3b completing without a price records nothing and makes no comp', async () => {
    const db = await fresh();
    const id = await listing(db, { title: 'no price', price: 80 });
    const r = await complete(db, await orderReady(db, id, 80));
    assert.equal(r.final_price, null);
    assert.equal((await one(db, `SELECT final_price FROM orders WHERE listing_id = $1`, [id])).final_price, null);
    assert.equal((await one(db, `SELECT actual_sold_price FROM listings WHERE id = $1`, [id])).actual_sold_price, null);
    assert.equal(Number((await one(db, `SELECT count(*) n FROM comps`)).n), 0);
  });
  test('MP-3c invalid final prices are refused, and the order stays open', async () => {
    const db = await fresh();
    const o = await orderReady(db, await listing(db, { title: 'x', price: 100 }), 100);
    for (const bad of ['12.5', 0, -5, 'abc', 100000001, '1e3', ' 9 9 ']) {
      await rejects(complete(db, o, { final_price: bad }), /final_price must be a whole number/);
    }
    assert.equal((await one(db, `SELECT status FROM orders WHERE id = $1`, [o])).status, 'ready_pickup');
    assert.equal((await complete(db, o, { final_price: ' 95 ' })).final_price, 95, 'surrounding spaces are tolerated');
  });
  test('MP-3d only the buyer completes; nobody writes final_price directly', async () => {
    const db = await fresh();
    const o = await orderReady(db, await listing(db, { title: 'y', price: 100 }), 100);
    await rejects(complete(db, o, { final_price: 999 }, SELLER), /Only the buyer/);
    const n = await as(db, BUYER, async (tx) => (await tx.query(`UPDATE orders SET final_price = 1, final_price_source = 'buyer_confirmed', final_price_confirmed_at = now() WHERE id = $1`, [o])).affectedRows);
    assert.equal(n, 0, 'no UPDATE policy on orders: the row is not touched');
    await rejects(as(db, null, (tx) => tx.query(`SELECT transition_order($1, 'completed', '{"final_price": 5}'::jsonb)`, [o])), /Not authenticated|permission denied/);
  });
  test('MP-3e a sale at GetWorth\'s own suggestion is recorded, measured against its valuation, and never a comp', async () => {
    const db = await fresh();
    const id = await listing(db, { title: 'at suggestion', price: 290, valuation: VAL_CORE });
    await db.query(`UPDATE valuations SET listing_id = $1 WHERE id = $2`, [id, VAL_CORE]);
    await complete(db, await orderReady(db, id, 290), { final_price: 280 });
    assert.equal(Number((await one(db, `SELECT count(*) n FROM comps`)).n), 0);
    const v = await one(db, `SELECT actual_sold_price, price_accuracy FROM valuations WHERE id = $1`, [VAL_CORE]);
    assert.equal(Number(v.actual_sold_price), 280);
    assert.ok(Math.abs(v.price_accuracy - 280 / 255) < 1e-4);
  });
  test('MP-3f a sale involving an admin or a test account is recorded and is never a comp, nor a valuation\'s sold price', async () => {
    const db = await fresh();
    await as(db, ADMIN, (tx) => tx.query(`SELECT admin_set_test_account($1, true)`, [BUYER2]));
    const a = await listing(db, { title: 'to test buyer', price: 50 });
    await complete(db, await orderReady(db, a, 50, BUYER2), { final_price: 50 }, BUYER2);
    const b = await listing(db, { title: 'to admin', price: 60 });
    await complete(db, await orderReady(db, b, 60, ADMIN), { final_price: 60 }, ADMIN);
    assert.equal(Number((await one(db, `SELECT count(*) n FROM comps`)).n), 0);
    assert.equal(Number((await one(db, `SELECT count(*) n FROM orders WHERE final_price IS NOT NULL`)).n), 2, 'still recorded');
  });
});

describe('MP-4 test accounts are set by admins only', () => {
  test('MP-4a a user cannot flag or unflag themselves, by update or by insert; the RPCs refuse non-admins; an admin can', async () => {
    const db = await fresh();
    await as(db, BUYER, (tx) => tx.query(`UPDATE profiles SET is_test = true WHERE id = $1`, [BUYER]));
    assert.equal((await one(db, `SELECT is_test FROM profiles WHERE id = $1`, [BUYER])).is_test, false, 'the existing guard reverts it');
    await rejects(as(db, BUYER, (tx) => tx.query(`SELECT admin_set_test_account($1, true)`, [BUYER])), /Admin access required/);
    await rejects(as(db, BUYER, (tx) => tx.query(`SELECT * FROM admin_test_account_ids()`)), /Admin access required/);
    const NEW = '00000000-0000-4000-8000-0000000000e1';
    await db.query(`INSERT INTO auth.users (id) VALUES ($1)`, [NEW]);
    await as(db, NEW, (tx) => tx.query(`INSERT INTO profiles (id, full_name, is_test) VALUES ($1, 'n', true)`, [NEW]));
    assert.equal((await one(db, `SELECT is_test FROM profiles WHERE id = $1`, [NEW])).is_test, false, 'the insert guard forces false');
    await as(db, ADMIN, (tx) => tx.query(`SELECT admin_set_test_account($1, true)`, [BUYER]));
    const ids = await as(db, ADMIN, async (tx) => (await tx.query(`SELECT * FROM admin_test_account_ids()`)).rows);
    assert.deepEqual(ids.map((r) => Object.values(r)[0]), [BUYER]);
    await as(db, BUYER, (tx) => tx.query(`UPDATE profiles SET is_test = false WHERE id = $1`, [BUYER]));
    assert.equal((await one(db, `SELECT is_test FROM profiles WHERE id = $1`, [BUYER])).is_test, true, 'nor unflag');
  });
});

describe('MP-5 security is unchanged', () => {
  test('MP-5a RLS on, the same policies, the order RPCs and the new admin RPCs closed to anon', async () => {
    const before = await fresh({ migrate: false });
    const after = await fresh();
    const policies = async (db) => (await db.query(`SELECT tablename, policyname, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'public' ORDER BY 1, 2`)).rows;
    assert.deepEqual(await policies(after), await policies(before));
    assert.equal((await one(after, `SELECT bool_and(relrowsecurity) ok FROM pg_class WHERE oid IN ('public.orders'::regclass, 'public.listings'::regclass, 'public.profiles'::regclass)`)).ok, true);
    for (const f of ['public.transition_order(uuid, text, jsonb)', 'public.create_order(uuid, uuid, numeric, text, text, text)', 'public.admin_set_test_account(uuid, boolean)', 'public.admin_test_account_ids()']) {
      const g = await one(after, `SELECT has_function_privilege('anon', $1, 'EXECUTE') anon, has_function_privilege('authenticated', $1, 'EXECUTE') auth`, [f]);
      assert.deepEqual(g, { anon: false, auth: true }, f);
    }
  });
});

describe('MP-6 the rollback restores Production exactly', () => {
  test('MP-6a functions back to their original bodies; the added columns, trigger and functions gone; data intact', async () => {
    const db = await fresh({ migrate: false });
    const body = async (name) => (await one(db, `SELECT pg_get_functiondef(p.oid) d FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = $1`, [name])).d;
    const original = {};
    for (const f of ['transition_order', 'create_comp_from_sale', 'profiles_enforce_safe_defaults_insert']) original[f] = await body(f);
    await db.exec(MIGRATION);
    assert.notEqual(await body('transition_order'), original.transition_order);
    await db.exec(ROLLBACK);
    for (const f of Object.keys(original)) assert.equal(await body(f), original[f], f);
    const cols = (await db.query(`SELECT table_name || '.' || column_name c FROM information_schema.columns WHERE table_schema = 'public' AND column_name IN ('final_price', 'final_price_source', 'final_price_confirmed_at', 'price_source', 'suggested_price', 'is_test')`)).rows;
    assert.deepEqual(cols, []);
    assert.equal((await one(db, `SELECT count(*) n FROM pg_proc WHERE proname IN ('listings_set_price_provenance', 'admin_set_test_account', 'admin_test_account_ids')`)).n, 0);
    assert.equal(Number((await one(db, `SELECT count(*) n FROM profiles`)).n), 4);
  });
  test('MP-6b the migration is re-runnable (IF NOT EXISTS / OR REPLACE throughout)', async () => {
    const db = await fresh();
    await db.exec(MIGRATION);
    const id = await listing(db, { title: 'again', price: 70 });
    assert.equal((await complete(db, await orderReady(db, id, 70), { final_price: 70 })).final_price, 70);
  });
});

describe('MP-7 the migration text', () => {
  test('MP-7a deletes nothing, rewrites no existing row, touches no policy or grant beyond its two new functions', () => {
    const sql = MIGRATION.replace(/--.*$/gm, '');
    assert.doesNotMatch(sql, /\bDELETE\s+FROM\b|\bTRUNCATE\b|\bDROP\s+TABLE\b|\bDROP\s+COLUMN\b|\bDROP\s+POLICY\b|\bCREATE\s+POLICY\b|\bALTER\s+POLICY\b|DISABLE ROW LEVEL SECURITY/i);
    const updates = (sql.match(/\bUPDATE\s+(?!OF\b)[\w.]+/gi) ?? []);
    assert.ok(updates.every((u) => /UPDATE (public\.)?(orders|listings|valuations|profiles)\b/i.test(u)), updates.join(','));
    // The one top-level UPDATE writes the NEW column's own default into existing rows (see MP-1b), and nothing else.
    const topLevel = sql.replace(/\$function\$[\s\S]*?\$function\$/g, '').match(/^\s*UPDATE\b[^;]*;/gim) ?? [];
    assert.deepEqual(topLevel.map((u) => u.trim()), ['UPDATE public.profiles SET is_test = false WHERE is_test IS NULL;']);
    const grants = sql.match(/\b(GRANT|REVOKE)\b[^;]+;/gi) ?? [];
    assert.ok(grants.every((g) => /admin_set_test_account|admin_test_account_ids/.test(g)), grants.join('\n'));
  });
});

describe('MP-8 the client sends what the buyer typed, and nothing it did not', () => {
  test('MP-8a parseFinalPrice / completionMeta: whole shekels or nothing; never the asking price by default', async () => {
    const { parseFinalPrice, completionMeta, FINAL_PRICE_MAX } = await import('../src/lib/marketplaceProvenance.js');
    assert.deepEqual(parseFinalPrice(''), { empty: true });
    assert.deepEqual(parseFinalPrice('  '), { empty: true });
    assert.deepEqual(parseFinalPrice('₪1,250'), { value: 1250 });
    assert.deepEqual(parseFinalPrice('12.5'), { error: 'whole_shekels' });
    assert.deepEqual(parseFinalPrice('0'), { error: 'range' });
    assert.deepEqual(parseFinalPrice(String(FINAL_PRICE_MAX + 1)), { error: 'range' });
    assert.deepEqual(parseFinalPrice('1234567890'), { error: 'whole_shekels' });
    assert.deepEqual(completionMeta(''), {});
    assert.deepEqual(completionMeta('abc'), {});
    assert.deepEqual(completionMeta('480'), { final_price: 480 });
  });
  test('MP-8b the completion dialog passes the meta; the field is never pre-filled; the admin toggle only appears with its function', () => {
    const view = read('src/views/OrderViews.jsx');
    assert.match(view, /handleAction\('completed', completionMeta\(finalPriceInput\)\)/);
    assert.match(view, /useState\(''\);\n/);
    assert.match(view, /await updateOrderStatus\(order\.id, s, meta\)/);
    const field = read('src/components/FinalPriceField.jsx');
    assert.match(field, /if \(!supported\) return null;/);
    assert.doesNotMatch(field, /useState\(String\(askingPrice/);
    const admin = read('src/views/AdminPanel.jsx');
    assert.match(admin, /\{testIds && <div className="mb-2"><TestAccountToggle/);
  });
});

test('MP-8c the listing form states its pricing intent, only once the database records it', () => {
  const ctx = read('src/contexts/AppContext.jsx');
  assert.match(ctx, /await listingProvenanceSupported\(supabase\) && \{ price_source: listingData\.priceOrigin === 'suggestion' \? 'getworth_valuation' : 'seller_entered' \}/);
  assert.match(ctx, /priceOrigin: draft\.price === '' \? 'seller' : 'suggestion'/);
  assert.match(read('src/views/SellViews.jsx'), /priceOrigin: 'seller' \}\);/);
});
