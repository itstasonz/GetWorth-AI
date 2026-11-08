// MS — genuine GetWorth sales as Israeli evidence (2026-11-08): the database's filter (real Postgres, PGlite, on the
// Production-derived baseline), the engine's match and weight, and the accuracy report's leakage rule.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { salesEvidenceFor, loadMarketplaceSales, SALE_URL_PREFIX } from '../api/_lib/scan/marketplace.js';
import { buildValuation, marketKey } from '../api/_lib/scan/valuation.js';
import { normalizeIdentity } from '../api/_lib/scan/identify.js';
import { RAW_IDENTITY } from './helpers/core-scan-fakes.mjs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const TODAY = '2026-11-08';
const IDENTITY = normalizeIdentity(RAW_IDENTITY);
const OTHER = normalizeIdentity({ ...RAW_IDENTITY, model: 'G Pro Wireless', display_name: 'Logitech G Pro Wireless', canonical_name: 'logitech g pro wireless' });
const row = (over = {}) => ({ sale_ref: 'a1b2c3d4e5f60718', final_price: 300, completed_at: '2026-11-01T10:00:00Z', condition: 'used', category: 'Electronics', verification: 'buyer_confirmed', identity: IDENTITY, ...over });

describe('MS-1 the engine keeps only this product\'s genuine sales', () => {
  test('MS-1a same market identity → one Israeli sold reference, buyer-confirmed, no public link; another product → nothing', () => {
    const [e, ...rest] = salesEvidenceFor(IDENTITY, [row(), row({ sale_ref: 'ffffffffffffffff', identity: OTHER })], { today: TODAY });
    assert.equal(rest.length, 0);
    assert.deepEqual([e.kind, e.match, e.market, e.condition, e.verification, e.source, e.binding, e.price_ils, e.listed], ['sold', 'exact', 'IL', 'good', 'buyer_confirmed', 'getworth_sale', 'verified_row', 300, '2026-11-01']);
    assert.ok(e.url.startsWith(SALE_URL_PREFIX) && !/^https?:/.test(e.url));
    assert.equal(marketKey(OTHER) === marketKey(IDENTITY), false);
  });
  test('MS-1b a row that is not buyer-confirmed, has no price, repeats a sale, or does not say what it sold is skipped', () => {
    const rows = [row(), row(), row({ sale_ref: 'b'.repeat(16), verification: 'seller_reported' }), row({ sale_ref: 'c'.repeat(16), final_price: 0 }),
      row({ sale_ref: 'd'.repeat(16), identity: null }), row({ sale_ref: 'NOT-HEX' })];
    assert.equal(salesEvidenceFor(IDENTITY, rows, { today: TODAY }).length, 1);
  });
  test('MS-1c the loader never fails a scan: no database, an error or a slow answer is no sales', async () => {
    assert.deepEqual(await loadMarketplaceSales({ supa: null }), []);
    assert.deepEqual(await loadMarketplaceSales({ supa: { rpc: async () => ({ error: { message: 'boom' } }) } }), []);
    assert.deepEqual(await loadMarketplaceSales({ supa: { rpc: () => new Promise(() => {}) }, timeoutMs: 20 }), []);
    assert.deepEqual(await loadMarketplaceSales({ supa: { rpc: async (fn, args) => ({ data: [{ fn, since: args.p_since }] }) }, now: Date.parse('2026-11-08T00:00:00Z') }),
      [{ fn: 'marketplace_sale_evidence', since: '2025-11-08T00:00:00.000Z' }]);
  });
});

describe('MS-2 how a GetWorth sale counts', () => {
  test('MS-2a a current genuine sale opens the Israeli gate on its own, at its final price, weighing as a listing (not a verified sale)', () => {
    const shop = { url: 'https://zap.co.il/x', domain: 'zap.co.il', title: 't', price: 600, currency: 'ILS', price_ils: 600, kind: 'new_retail', match: 'exact', market: 'IL', condition: 'new_sealed', page: 'shop_product', listed: null, binding: 'strong', seen: TODAY };
    const v = buildValuation({ evidence: [shop, ...salesEvidenceFor(IDENTITY, [row()], { today: TODAY })], today: TODAY });
    assert.deepEqual([v.status, v.local_evidence, v.counts.sold], ['priced', true, 1]);
    const used = v.evidence.find((e) => e.source === 'getworth_sale');
    assert.equal(used.used, true);
    assert.equal(used.weight, 1, 'buyer-confirmed: the weight of a listing, not the 1.2 of a verified sale');
    assert.equal(v.prices.good.worth, 300, 'a completed sale is taken at its price, with no negotiation allowance');
  });
  test('MS-2b an old sale (over 180 days) does not open the gate; a sealed-condition sale does not either', () => {
    const old = buildValuation({ evidence: salesEvidenceFor(IDENTITY, [row({ completed_at: '2026-03-01T00:00:00Z' })], { today: TODAY }), today: TODAY });
    assert.equal(old.status, 'insufficient_evidence');
    const sealed = buildValuation({ evidence: salesEvidenceFor(IDENTITY, [row({ condition: 'newSealed' })], { today: TODAY }), today: TODAY });
    assert.equal(sealed.status, 'insufficient_evidence');
  });
  test('MS-2c the price step merges them, fresh each time, and the stored row keeps their source and verification', async () => {
    const { runPrice, resetMarketCache } = await import('../api/_lib/scan/service.js');
    const { fakeProvider, NOW } = await import('./helpers/core-scan-fakes.mjs');
    const { resetFxCache } = await import('../api/_lib/scan/fx.js');
    const { buildValuationRow, reproduceValuation } = await import('../api/_lib/scan/persist.js');
    resetMarketCache(); resetFxCache();
    const today = new Date(NOW).toISOString().slice(0, 10);
    const fetchImpl = fakeProvider({ markets: [{ evidence: [] }], expand: [{ evidence: [] }] });
    let asked = 0;
    const marketplace = async () => { asked += 1; return [row({ completed_at: `${today}T08:00:00Z` })]; };
    const r = await runPrice({ identity: IDENTITY, store: { load: async () => null, save: async () => {} }, fetchImpl, model: 'm', apiKey: 'k', safetyIdentifier: 's', now: () => NOW, marketplace });
    assert.equal(asked, 1);
    assert.equal(r.valuation.status, 'priced');
    assert.ok(r.valuation.evidence.some((e) => e.source === 'getworth_sale' && e.used));
    const stored = buildValuationRow({ id: 'v', userId: 'u', scanUuid: 's', identity: IDENTITY, valuation: r.valuation, lang: 'he' });
    assert.ok(stored.ai_raw_response.valuation.evidence_full.some((e) => e.source === 'getworth_sale' && e.verification === 'buyer_confirmed'));
    assert.deepEqual(reproduceValuation(stored).prices, r.valuation.prices, 'reproducible with the sale in it');
    resetMarketCache();
  });
});

// ── The database side, in real Postgres on the Production-derived baseline ───────────────────────────────────────────
const ADMIN = '00000000-0000-4000-8000-00000000000a';
const S1 = '00000000-0000-4000-8000-00000000000b';
const B1 = '00000000-0000-4000-8000-00000000000c';
const TESTER = '00000000-0000-4000-8000-00000000000d';
async function db() {
  const d = new PGlite();
  await d.exec(read('tests/fixtures/db/marketplace-baseline.sql'));
  await d.exec('ALTER TABLE public.valuations ADD COLUMN IF NOT EXISTS valuation_version integer DEFAULT 1;');
  await d.exec(read('supabase/migrations/20261108120000_marketplace_price_provenance.sql'));
  await d.exec(read('supabase/migrations/20261108150000_marketplace_sale_evidence.sql'));
  await d.exec(`INSERT INTO auth.users (id) VALUES ('${ADMIN}'), ('${S1}'), ('${B1}'), ('${TESTER}');
    INSERT INTO profiles (id, full_name, is_admin) VALUES ('${ADMIN}', 'a', true), ('${S1}', 's', false), ('${B1}', 'b', false), ('${TESTER}', 't', false);
    UPDATE profiles SET is_test = true WHERE id = '${TESTER}';`);
  return d;
}
/** One completed sale, written directly (the lifecycle itself is tested in marketplace-provenance). */
async function sale(d, { buyer = B1, seller = S1, final = 300, source = 'seller_entered', version = 3, identity = { display_name: 'X' }, completed = 'now()', valuedBefore = true, mid = 320, evidenceFull = null }) {
  const v = (await d.query(`INSERT INTO valuations (user_id, price_mid, valuation_version, ai_raw_response, created_at) VALUES ($1, $2, $3, $4, ${valuedBefore ? "now() - interval '2 days'" : "now() + interval '1 day'"}) RETURNING id`,
    [seller, mid, version, JSON.stringify({ identity, valuation: evidenceFull ? { evidence_full: evidenceFull } : {} })])).rows[0].id;
  const l = (await d.query(`INSERT INTO listings (seller_id, title, category, condition, price, status, valuation_id) VALUES ($1, 'x', 'Electronics', 'used', 999, 'sold', $2) RETURNING id`, [seller, v])).rows[0].id;
  await d.query(`UPDATE listings SET price_source = $1 WHERE id = $2`, [source, l]);
  await d.query(`ALTER TABLE listings DISABLE TRIGGER trg_listings_price_provenance`);
  await d.query(`UPDATE listings SET price_source = $1 WHERE id = $2`, [source, l]);
  await d.query(`ALTER TABLE listings ENABLE TRIGGER trg_listings_price_provenance`);
  const o = (await d.query(`INSERT INTO orders (listing_id, buyer_id, seller_id, price, delivery_method, status, completed_at, final_price, final_price_source, final_price_confirmed_at)
    VALUES ($1, $2, $3, 999, 'pickup', 'completed', ${completed}, $4, ${final ? "'buyer_confirmed'" : 'NULL'}, ${final ? 'now()' : 'NULL'}) RETURNING id`, [l, buyer, seller, final])).rows[0].id;
  return { v, l, o };
}
const asService = (d, sql) => d.transaction(async (tx) => { await tx.exec('SET LOCAL ROLE service_role'); return (await tx.query(sql)).rows; });
const asUser = (d, uid, sql) => d.transaction(async (tx) => { await tx.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [uid]); await tx.exec('SET LOCAL ROLE authenticated'); return (await tx.query(sql)).rows; });

describe('MS-3 marketplace_sale_evidence returns genuine sales only, to the server only', () => {
  test('MS-3a only: completed, buyer-confirmed, two genuine accounts, seller-priced, core-scan identity, within the window', async () => {
    const d = await db();
    await sale(d, {});                                                     // genuine → in
    await sale(d, { buyer: ADMIN });                                       // admin buyer
    await sale(d, { buyer: TESTER });                                      // test account
    await sale(d, { source: 'getworth_valuation' });                       // GetWorth's own price
    await sale(d, { final: null });                                        // no confirmed price
    await sale(d, { version: 1 });                                         // legacy valuation, no core identity
    await sale(d, { completed: "now() - interval '400 days'" });            // too old
    const rows = await asService(d, `SELECT * FROM marketplace_sale_evidence()`);
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].final_price, rows[0].verification, rows[0].condition, rows[0].identity.display_name], [300, 'buyer_confirmed', 'used', 'X']);
    assert.match(rows[0].sale_ref, /^[0-9a-f]{16}$/);
    assert.deepEqual(Object.keys(rows[0]).sort(), ['category', 'completed_at', 'condition', 'final_price', 'identity', 'sale_ref', 'verification'], 'no person, no ids');
  });
  test('MS-3b closed to users and to anonymous callers', async () => {
    const d = await db();
    await assert.rejects(asUser(d, B1, `SELECT * FROM marketplace_sale_evidence()`), /permission denied/);
    await assert.rejects(d.transaction(async (tx) => { await tx.exec('SET LOCAL ROLE anon'); await tx.query(`SELECT * FROM marketplace_sale_evidence()`); }), /permission denied/);
  });
});

describe('MS-4 accuracy is measured only on independent sales, never on a sale the valuation used', () => {
  test('MS-4a per category: n, median APE with quartiles, median ₪ error; leakage, later valuations and anchored listings excluded', async () => {
    const d = await db();
    await sale(d, { final: 300, mid: 330 });   // APE 0.10
    await sale(d, { final: 200, mid: 150 });   // APE 0.25
    await sale(d, { final: 400, mid: 400, valuedBefore: false });             // valued after the sale → out
    const leaked = await sale(d, { final: 500, mid: 500 });                     // used its own sale as evidence → out
    const ref = (await d.query(`SELECT left(md5('getworth-sale:' || $1::text), 16) r`, [leaked.o])).rows[0].r;
    await d.query(`UPDATE valuations SET ai_raw_response = jsonb_set(ai_raw_response, '{valuation,evidence_full}', $1::jsonb) WHERE id = $2`, [JSON.stringify([{ url: `getworth:sale:${ref}` }]), leaked.v]);
    await sale(d, { final: 100, mid: 100, source: 'getworth_valuation' });  // anchored → counted separately
    const rows = await asUser(d, ADMIN, `SELECT * FROM admin_accuracy_report()`);
    assert.equal(rows.length, 1);
    const r = rows[0];
    assert.deepEqual([r.category, r.n, r.anchored_excluded], ['Electronics', 2, 1]);
    assert.ok(Math.abs(r.median_ape - 0.175) < 1e-6, String(r.median_ape));
    assert.ok(r.ape_p25 <= r.median_ape && r.median_ape <= r.ape_p75);
  });
  test('MS-4b admins only; with no qualifying sale it returns nothing — unmeasured, not zero', async () => {
    const d = await db();
    await assert.rejects(asUser(d, B1, `SELECT * FROM admin_accuracy_report()`), /Admin access required/);
    assert.deepEqual(await asUser(d, ADMIN, `SELECT * FROM admin_accuracy_report()`), []);
  });
});

describe('MS-5 the historical cleanup batch', () => {
  test('MS-5a anywhere its audited scope does not hold exactly (8 comps, 6 valuations), it aborts and changes nothing', async () => {
    const d = await db();
    await assert.rejects(d.exec(read('supabase/migrations/20261108140000_marketplace_test_data_cleanup.sql')), /cleanup scope changed since the audit: 0 comps, 0 valuations/);
  });
  test('MS-5b its log is closed to clients; every change is snapshotted before it is made', () => {
    const sql = read('supabase/migrations/20261108140000_marketplace_test_data_cleanup.sql');
    assert.match(sql, /REVOKE ALL ON public\.data_correction_log FROM PUBLIC, anon, authenticated;/);
    assert.ok(sql.indexOf('INSERT INTO public.data_correction_log') < sql.indexOf('UPDATE public.comps SET is_outlier = true'));
    assert.doesNotMatch(sql.replace(/--.*$/gm, '').replace(/ON COMMIT DROP/g, ''), /\bDELETE\b|\bDROP\b|\bTRUNCATE\b/i, 'only its temporary tables are dropped');
  });
});

test('MS-6 the evidence list shows a GetWorth sale for what it is: no link, buyer-confirmed', () => {
  const sheets = read('src/components/ScanSheets.jsx');
  assert.match(sheets, /const sale = e\.source === 'getworth_sale';/);
  assert.match(sheets, /const rowProps = sale \? \{\} : \{ href: e\.url/);
  assert.match(read('src/lib/scanCopy.js'), /getworthSale: 'Sold on GetWorth · price confirmed by the buyer, not a payment record'/);
});

test('MS-7 the evidence function returns only the identity fields the market key reads — never visible text — and the key is unchanged by the projection', async () => {
  const d = await db();
  const full = { ...IDENTITY, visible_text: ['MOSHE COHEN 050-0000000'], listing_description: 'private text', uncertainty_note: 'x' };
  await sale(d, { identity: full });
  const [r] = await asService(d, `SELECT * FROM marketplace_sale_evidence()`);
  assert.deepEqual(Object.keys(r.identity).sort().filter((k) => !['canonical_name', 'display_name', 'brand', 'model', 'product_family', 'item_type', 'variant', 'size_or_capacity', 'configuration', 'model_number', 'confirmed'].includes(k)), []);
  assert.ok(!JSON.stringify(r).includes('050-0000000') && !JSON.stringify(r).includes('private text'));
  assert.equal(marketKey(r.identity), marketKey(IDENTITY), 'the projection keeps everything the match needs');
});

test('MS-8 the order-email function is hardened, and its trigger repair stays a proposal until approved', async () => {
  const fn = read('supabase/functions/notify-order-email/index.ts');
  assert.doesNotMatch(fn, /body\?\.seller_id|body\?\.listing_title/, 'recipient and title are never taken from the request');
  assert.match(fn, /\.select\('id, price, delivery_method, buyer_id, seller_id, listing_id'\)/);
  assert.match(fn, /const sellerId = order\.seller_id as string;/);
  assert.match(fn, /buyerName = escapeHtml\(buyerName\);/);
  assert.match(fn, /listingTitle = escapeHtml\(listingTitle\);/);
  assert.match(fn, /await sameSecret\(incomingSecret, expectedSecret\)/);
  assert.doesNotMatch(fn, /console\.log\([^)]*sellerEmail/, 'no email address in the logs');
  assert.doesNotMatch(fn, /re_[A-Za-z0-9]{12,}|sk_[A-Za-z0-9]{12,}/, 'no key in the source');
  const proposed = read('supabase/manual/PROPOSED_notify_order_email_trigger.sql');
  assert.match(proposed, /PROPOSED — NOT APPLIED/);
  assert.match(proposed, /net\.http_post\(/);
  assert.match(proposed, /body    := jsonb_build_object\('order_id', NEW\.data->>'order_id'\)/);
  const { readdirSync } = await import('node:fs');
  assert.equal(readdirSync(new URL('../supabase/migrations/', import.meta.url)).some((f) => /notify_order/.test(f)), false, 'never in migrations until approved');
});
