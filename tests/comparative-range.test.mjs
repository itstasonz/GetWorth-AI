// CR — STATE B, the limited comparative range (founder decision 2026-11-15): with no valuation, the genuine Israeli
// second-hand ads that passed every check are shown at their own prices. Never a worth, never three prices, never a range
// from one ad, never a new price, another model, another size, a sealed unit or an archived ad.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { buildValuation, comparativeOf, COMPARATIVE_REASONS, SET_ASIDE } from '../api/_lib/scan/valuation.js';
import { STRATEGY } from '../api/_lib/scan/strategy.js';
import { buildValuationRow, reproduceValuation } from '../api/_lib/scan/persist.js';
import { normalizeIdentity } from '../api/_lib/scan/identify.js';
import { RAW_IDENTITY } from './helpers/core-scan-fakes.mjs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const TODAY = '2026-11-15';
const ad = (price, over = {}) => ({ url: `https://www.homeless.co.il/yad2/viewad,${price}${over.n ?? ''}.aspx`, domain: 'homeless.co.il', title: 'IKEA POÄNG', price, currency: 'ILS', price_ils: price, kind: 'used_listing', match: 'exact', market: 'IL', condition: 'good', page: 'listing', listed: TODAY, binding: 'strong', seen: TODAY, ...over });
const obs = (over = {}) => ({ market: 'IL', kind: 'used_listing', binding: 'strong', set_aside: SET_ASIDE.SIMILAR_CONTEXT, match: 'exact', condition: 'good', price_ils: 450, url: 'https://www.homeless.co.il/yad2/viewad,1.aspx', domain: 'homeless.co.il', freshness: 'current', ...over });

describe('CR-1 which ads may be shown, and how', () => {
  test('CR-1a only the "stood, but too few / disagreed / one ad alone" reasons qualify', () => {
    assert.deepEqual([...COMPARATIVE_REASONS].sort(), [SET_ASIDE.DISAGREE, SET_ASIDE.SIMILAR_CONTEXT, SET_ASIDE.SINGLE].sort());
  });
  test('CR-1b one ad is shown as itself — no invented range', () => {
    const c = comparativeOf([obs()]);
    assert.deepEqual([c.count, c.low, c.high, c.observations[0].price_ils], [1, null, null, 450]);
  });
  test('CR-1c two or more ads: the lowest and highest OBSERVED price, each ad listed, exact vs comparable counted', () => {
    const c = comparativeOf([obs({ price_ils: 500, url: 'u2' }), obs(), obs({ price_ils: 380, url: 'u3', match: 'close_comparable', set_aside: SET_ASIDE.DISAGREE })]);
    assert.deepEqual([c.count, c.exact_count, c.low, c.high], [3, 2, 380, 500]);
    assert.deepEqual(c.observations.map((o) => o.price_ils), [380, 450, 500]);
  });
  test('CR-1d never: a new price, a shop, a price guide, abroad, unbound, another model, another size, above new, sealed, broken, archived, a duplicate', () => {
    const never = [
      obs({ kind: 'new_retail' }), obs({ kind: 'refurbished' }), obs({ kind: 'price_guide' }), obs({ market: 'INTL' }),
      obs({ binding: 'weak' }), obs({ match: 'sibling_model' }), obs({ set_aside: SET_ASIDE.OTHER_SIZE }), obs({ set_aside: SET_ASIDE.ABOVE_NEW }),
      obs({ set_aside: SET_ASIDE.DIFFERENT_MODEL }), obs({ set_aside: SET_ASIDE.OUTLIER }), obs({ set_aside: SET_ASIDE.NOT_CURRENT }), obs({ set_aside: null }),
      obs({ condition: 'new_sealed' }), obs({ condition: 'poor' }), obs({ freshness: 'archived' }), obs({ archived: true }), obs({ price_ils: 0 }),
    ];
    assert.equal(comparativeOf(never), null);
    assert.equal(comparativeOf([obs(), obs()]).count, 1, 'the same ad twice is one ad');
  });
});

describe('CR-2 in the valuation', () => {
  test('CR-2a a thing valued from similar items, with one ad that stood: no price, and that ad shown at its own price', () => {
    const v = buildValuation({ evidence: [ad(450)], strategy: STRATEGY.COMPARABLE, today: TODAY });
    assert.equal(v.status, 'insufficient_evidence');
    assert.equal(v.prices, null, 'never three prices');
    assert.deepEqual([v.comparative.count, v.comparative.low, v.comparative.observations[0].price_ils], [1, null, 450]);
  });
  test('CR-2b a supported valuation (State A) is unchanged and carries no comparative block', () => {
    const v = buildValuation({ evidence: [ad(300), ad(320, { n: 'b' }), ad(310, { n: 'c' })], today: TODAY });
    assert.equal(v.status, 'priced');
    assert.equal(v.comparative, null);
  });
  test('CR-2c no ad at all: nothing to compare, and a new price never becomes a comparative number', () => {
    const shop = { url: 'https://www.zap.co.il/model.aspx?modelid=1', domain: 'zap.co.il', title: 'x', price: 600, currency: 'ILS', price_ils: 600, kind: 'new_retail', match: 'exact', market: 'IL', condition: 'new_sealed', page: 'shop_product', listed: null, binding: 'strong', seen: TODAY };
    const v = buildValuation({ evidence: [shop], today: TODAY });
    assert.equal(v.status, 'insufficient_evidence');
    assert.equal(v.comparative, null);
  });
  test('CR-2d the stored row keeps it, and the stored valuation still reproduces exactly', () => {
    const v = buildValuation({ evidence: [ad(450)], strategy: STRATEGY.COMPARABLE, today: TODAY });
    const row = buildValuationRow({ id: 'v', userId: 'u', scanUuid: 's', identity: normalizeIdentity(RAW_IDENTITY), valuation: v, lang: 'he' });
    assert.deepEqual(row.ai_raw_response.valuation.comparative, v.comparative);
    assert.deepEqual(reproduceValuation(row).comparative, v.comparative);
    assert.equal(row.price_mid ?? null, null, 'no worth is stored for it');
  });
});

describe('CR-3 a listing priced after seeing real ads is market-informed, never independent (20261115160000)', () => {
  const S1 = '00000000-0000-4000-8000-00000000000b';
  async function db({ withMigration = true } = {}) {
    const d = new PGlite();
    await d.exec(read('tests/fixtures/db/marketplace-baseline.sql'));
    await d.exec('ALTER TABLE public.valuations ADD COLUMN IF NOT EXISTS valuation_version integer DEFAULT 1; ALTER TABLE public.valuations ADD COLUMN IF NOT EXISTS new_retail integer;');
    await d.exec(`INSERT INTO auth.users (id) VALUES ('${S1}');`);
    for (const m of ['20261108120000_marketplace_price_provenance', '20261108150000_marketplace_sale_evidence', '20261113190000_marketplace_listing_evidence',
      '20261115120000_first_party_evidence_classes', '20261115140000_first_party_identity_and_integrity', ...(withMigration ? ['20261115160000_comparative_is_reference'] : [])]) await d.exec(read(`supabase/migrations/${m}.sql`));
    await d.exec(`INSERT INTO profiles (id, full_name) VALUES ('${S1}', 's');`);
    return d;
  }
  const IDENT = { brand: 'IKEA', model: 'POÄNG', canonical_name: 'ikea poang armchair' };
  const val = async (d, valuation, created = 'now()') => (await d.query(`INSERT INTO valuations (user_id, valuation_version, ai_raw_response, created_at) VALUES ($1, 3, $2, ${created}) RETURNING id`, [S1, JSON.stringify({ identity: IDENT, valuation })])).rows[0].id;
  const list = async (d, v) => (await d.query(`INSERT INTO listings (seller_id, title, category, condition, price, status, valuation_id) VALUES ($1, 'x', 'Home', 'used', 400, 'active', $2) RETURNING price_origin`, [S1, v])).rows[0].price_origin;
  const COMP = { status: 'insufficient_evidence', comparative: { count: 1, low: null, high: null, observations: [{ price_ils: 450 }] } };
  test('CR-3a ads shown on this scan → after_reference; nothing shown → independent', async () => {
    const d = await db();
    assert.equal(await list(d, await val(d, COMP)), 'after_reference');
    assert.equal(await list(d, await val(d, { status: 'insufficient_evidence', comparative: null })), 'after_reference', 'an earlier scan of the same product showed them');
    const fresh = await db();
    assert.equal(await list(fresh, await val(fresh, { status: 'insufficient_evidence', comparative: null })), 'independent');
  });
  test('CR-3b the rollback restores the previous rule, no row touched', async () => {
    const d = await db();
    await d.exec(read('supabase/manual/20261115160000_rollback_comparative_is_reference.sql'));
    assert.equal(await list(d, await val(d, COMP)), 'independent', 'the 20261115140000 rule does not read the comparative block');
  });
});

describe('CR-4 the screens', () => {
  test('CR-4a the card says what it is, in both languages; one ad is never a range', () => {
    const copy = read('src/lib/scanCopy.js');
    assert.match(copy, /comparativeRange: 'Comparative price range'/);
    assert.match(copy, /comparativeRange: 'טווח מחירים להשוואה'/);
    assert.match(copy, /comparativeNote: 'Asking prices from ads — not a sale price and not an estimated worth\.'/);
    assert.match(copy, /comparativeNote: 'מחירים מבוקשים במודעות — לא מחיר מכירה ולא שווי משוער\.'/);
    const card = read('src/components/ComparativeRange.jsx');
    assert.match(card, /const range = c\.count >= 2 && c\.low && c\.high;/);
  });
  test('CR-4b no-price screen: State B and State C side by side, apart; the listing shows the range for reference and never prefills it', () => {
    const view = read('src/views/ScanView.jsx');
    assert.match(view, /<ComparativeRange comparative=\{s\.valuation\?\.comparative\} copy=\{copy\} \/>\n\s*<RetailReference/);
    const scan = read('src/lib/coreScan.js');
    assert.match(scan, /comparative: s\.valuation\?\.status === 'priced' \? null : \(s\.valuation\?\.comparative \?\? null\),/);
    const sell = read('src/views/SellViews.jsx');
    assert.match(sell, /data-testid="listing-comparative"/);
    assert.doesNotMatch(sell, /price: result\?\.comparative/);
    assert.match(read('src/contexts/AppContext.jsx'), /\|\| !!scan\.valuation\?\.comparative/);
  });
});
