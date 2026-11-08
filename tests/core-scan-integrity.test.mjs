// IN — the valuation engine's integrity, held as invariants over hundreds of evidence pools rather than a few examples.
// Founder audit request, 2026-11-08: a number on the screen is not proof. These fail if
//   • a price stands without a current Israeli private second-hand reference tied to this product,
//   • a shop's new price, a refurbished offer alone, a listing abroad alone or another model makes a price,
//   • the three prices are out of order, or condition moves them inconsistently,
//   • a stored valuation cannot be recomputed from its own row,
//   • the listing form re-prices a core scan with the older percentage ladder,
//   • the older engine can run for a scan the core scan answered, or the model is given a field to state a price.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildValuation, CONDITION_FACTOR } from '../api/_lib/scan/valuation.js';
import { buildValuationRow, reproduceValuation, MAX_STORED_EVIDENCE } from '../api/_lib/scan/persist.js';
import { MARKET_SCHEMA } from '../api/_lib/scan/market.js';
import { normalizeIdentity } from '../api/_lib/scan/identify.js';
import { listingPricesOf, listingPriceFor, buildListingDraft } from '../src/lib/coreScan.js';
import { RAW_IDENTITY } from './helpers/core-scan-fakes.mjs';

const TODAY = '2026-11-08';
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

// A deterministic generator: the same pools on every run, so a failure names its seed.
function rng(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; }; }
const pick = (r, xs) => xs[Math.floor(r() * xs.length)];
const DATES = ['2026-11-01', '2026-10-20', '2026-07-01', '2025-03-01', '2023-01-01', null];
function pool(seed) {
  const r = rng(seed);
  const n = 1 + Math.floor(r() * 12);
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const market = r() < 0.55 ? 'IL' : 'INTL';
    const kind = pick(r, ['used_listing', 'used_listing', 'sold', 'refurbished', 'new_retail', 'price_guide', 'other']);
    const price = Math.round(50 + r() * 900);
    out.push({
      url: `https://${market === 'IL' ? 'ads.example.co.il' : 'ads.example.com'}/${seed}/${i}`, domain: market === 'IL' ? 'ads.example.co.il' : 'ads.example.com', title: 't',
      price, currency: market === 'IL' ? 'ILS' : 'USD', price_ils: price, kind,
      match: pick(r, ['exact', 'exact', 'close_comparable', 'sibling_model', 'accessory', 'part']), market,
      condition: kind === 'new_retail' ? 'new_sealed' : pick(r, ['good', 'like_new', 'fair', 'poor', 'unknown', 'new_sealed']),
      page: kind === 'new_retail' ? 'shop_product' : pick(r, ['listing', 'listing', 'search_or_category']),
      listed: pick(r, DATES), archived: r() < 0.1, binding: r() < 0.8 ? 'strong' : 'weak', stock: kind === 'new_retail' && r() < 0.2 ? 'out_of_stock' : 'unknown', seen: TODAY,
    });
  }
  return out;
}
const PRIVATE = new Set(['used_listing', 'sold', 'price_guide']);
const STALE = new Set(['older', 'archived']);
const SEEDS = Array.from({ length: 600 }, (_, i) => i + 1);

describe('IN-1 every priced valuation rests on an Israeli second-hand reference, and only on what may price', () => {
  test('IN-1a over 600 pools: the invariants hold for every price', () => {
    let priced = 0;
    for (const seed of SEEDS) {
      const v = buildValuation({ evidence: pool(seed), today: TODAY });
      const used = v.evidence.filter((e) => e.used);
      if (v.status !== 'priced') {
        assert.equal(v.prices, null, `seed ${seed}: no price means no number`);
        assert.equal(used.length, 0, `seed ${seed}: nothing is "used" when nothing is priced`);
        continue;
      }
      priced += 1;
      const why = `seed ${seed}`;
      // The gate: at least one current Israeli private reference for a used unit of this product, tied by its page.
      assert.ok(used.some((e) => e.market === 'IL' && PRIVATE.has(e.kind) && !STALE.has(e.freshness) && e.condition !== 'new_sealed' && e.binding === 'strong'), why);
      assert.equal(v.local_evidence, true, why);
      for (const e of used) {
        assert.notEqual(e.kind, 'new_retail', `${why}: a shop's new price is never a used price`);
        assert.ok(['exact', 'close_comparable'].includes(e.match), `${why}: another model, a part or an accessory never prices`);
        assert.equal(e.binding, 'strong', `${why}: a price the page did not tie to the product never prices`);
      }
      if (used.every((e) => e.kind === 'refurbished' || e.market !== 'IL')) assert.fail(`${why}: refurbished or foreign alone priced`);
      // Three prices in order, every condition; worse condition never worth more.
      let last = Infinity;
      for (const c of ['like_new', 'good', 'fair', 'poor']) {
        const b = v.prices[c];
        assert.ok(b.quick <= b.worth && b.worth <= b.list && b.low <= b.high, `${why} ${c} ${JSON.stringify(b)}`);
        assert.ok(b.worth <= last, `${why}: ${c} worth more than a better condition`);
        last = b.worth;
      }
      assert.equal(v.estimate_basis, 'israeli_listings', why);
    }
    assert.ok(priced >= 60, `the generator must exercise the priced path (${priced})`);
  });
  test('IN-1b the same evidence in any order gives the same answer', () => {
    for (const seed of SEEDS.slice(0, 150)) {
      const p = pool(seed);
      const a = buildValuation({ evidence: p, today: TODAY });
      const b = buildValuation({ evidence: [...p].reverse(), today: TODAY });
      assert.deepEqual([b.status, b.prices, b.price_confidence, b.withdrawn], [a.status, a.prices, a.price_confidence, a.withdrawn], `seed ${seed}`);
    }
  });
});

describe('IN-2 a stored valuation is reproduced from its own row', () => {
  const identity = normalizeIdentity(RAW_IDENTITY);
  test('IN-2a over 600 pools and every input flag: the row recomputes to the same status, prices, confidence and reason', () => {
    for (const seed of SEEDS) {
      const r = rng(seed * 7);
      const opts = { approximate: r() < 0.2, familyLevel: r() < 0.2, today: TODAY, unverified: Math.floor(r() * 3) };
      const v = buildValuation({ evidence: pool(seed), ...opts });
      const row = buildValuationRow({ id: 'v', userId: 'u', scanUuid: 's', identity, valuation: v, lang: 'he' });
      const again = reproduceValuation(row);
      assert.ok(again, `seed ${seed}: the row carries its inputs`);
      assert.deepEqual([again.status, again.prices, again.price_confidence, again.withdrawn, again.approximate], [v.status, v.prices, v.price_confidence, v.withdrawn, v.approximate], `seed ${seed}`);
      assert.ok(row.ai_raw_response.valuation.evidence_full.every((e) => !('used' in e) && !('weight' in e)), 'inputs only, never the outputs');
    }
  });
  test('IN-2b a row written before this change cannot be "reproduced" by guessing', () => {
    assert.equal(reproduceValuation({ ai_raw_response: { valuation: { sources: [] } } }), null);
    assert.equal(MAX_STORED_EVIDENCE >= 24, true, 'two stages of up to 12 references each fit');
  });
});

describe('IN-3 the listing keeps the engine\'s prices', () => {
  const v = buildValuation({ evidence: [
    { url: 'https://a.example.co.il/1', domain: 'a.example.co.il', title: 't', price: 300, currency: 'ILS', price_ils: 300, kind: 'used_listing', match: 'exact', market: 'IL', condition: 'good', page: 'listing', listed: '2026-11-01', binding: 'strong', seen: TODAY },
    { url: 'https://a.example.co.il/2', domain: 'a.example.co.il', title: 't', price: 280, currency: 'ILS', price_ils: 280, kind: 'used_listing', match: 'exact', market: 'IL', condition: 'good', page: 'listing', listed: '2026-11-03', binding: 'strong', seen: TODAY },
  ], today: TODAY });
  test('IN-3a each listing condition suggests that condition\'s listing price from the same valuation', () => {
    const lp = listingPricesOf(v);
    assert.deepEqual(lp, { newSealed: v.prices.new_sealed.list, likeNew: v.prices.like_new.list, used: v.prices.good.list, poor: v.prices.poor.list });
    const draft = buildListingDraft({ identity: normalizeIdentity(RAW_IDENTITY), valuation: v, condition: 'good', valuationId: 'val-1', images: [] });
    assert.equal(draft.price, v.prices.good.list);
    assert.equal(draft.result.marketValue.mid, v.prices.good.worth, 'mid is the engine\'s worth');
    for (const c of ['newSealed', 'likeNew', 'used', 'poor']) assert.equal(listingPriceFor(draft.result, c), lp[c]);
    assert.equal(listingPriceFor({ coreScan: true, listingPrices: null }, 'used'), '', 'no valuation, no suggestion');
    assert.ok(CONDITION_FACTOR.poor < 1);
  });
  test('IN-3b the listing form never applies the percentage ladder to a core scan', () => {
    const ctx = read('src/contexts/AppContext.jsx');
    assert.match(ctx, /if \(result\?\.coreScan\) return listingPriceFor\(result, c\);\n\s+const p = calcPrice\(/);
    const sell = read('src/views/SellViews.jsx');
    const calls = sell.match(/calcPrice\(result\?\.marketValue[^)]*\)/g) ?? [];
    assert.equal(calls.length, 2);
    assert.equal((sell.match(/result\?\.coreScan \? \(listingPriceFor\(result, condition\) \|\| null\) : calcPrice\(/g) ?? []).length, 2);
  });
});

describe('IN-4 no other engine and no model-stated price behind a core-scan number', () => {
  test('IN-4a the older engine runs only when /api/scan answered 503, and says so', () => {
    const ctx = read('src/contexts/AppContext.jsx');
    assert.match(ctx, /if \(outcome !== 'unavailable'\) return;/);
    assert.match(ctx, /'X-GW-Fallback': 'core_scan_unavailable'/);
    assert.match(read('api/analyze.js'), /\[Fallback\] legacy engine serving a scan reason=/);
  });
  test('IN-4b the market model returns evidence and nothing else: it has no field in which to state a value', () => {
    assert.deepEqual(Object.keys(MARKET_SCHEMA.properties), ['evidence']);
    const item = MARKET_SCHEMA.properties.evidence.items.properties;
    for (const k of Object.keys(item)) assert.doesNotMatch(k, /estimate|value|worth|suggest/i, k);
  });
  test('IN-4c the screen shows the server\'s numbers: it does no arithmetic on a price', () => {
    const view = read('src/views/ScanView.jsx');
    assert.doesNotMatch(view, /band\.(list|worth|quick|low|high)\s*[*/+-]\s*\d/);
  });
});
