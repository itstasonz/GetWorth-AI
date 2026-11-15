// IE — A WORTH NEEDS TWO INDEPENDENT ISRAELI ADS (founder audit, 2026-11-15). One seller's asking price is shown as what it
// is (State B), never as an estimated worth, a listing price and a quick-sale price; and one ad reached twice — on the
// mobile and desktop site, or on two of a board's list pages — is one ad.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildValuation, WITHDRAWN, SET_ASIDE, INDEPENDENT_MIN, sameListing, independentOf } from '../api/_lib/scan/valuation.js';
import { buildValuationRow, reproduceValuation } from '../api/_lib/scan/persist.js';
import { normalizeIdentity } from '../api/_lib/scan/identify.js';
import { RAW_IDENTITY } from './helpers/core-scan-fakes.mjs';

const TODAY = '2026-11-15';
const ad = (price, url, over = {}) => ({ url, domain: new URL(url).hostname, title: 'Apple Watch Series 8 45mm', price, currency: 'ILS', price_ils: price, kind: 'used_listing', match: 'exact', market: 'IL', condition: 'good', page: 'listing', listed: TODAY, binding: 'strong', seen: TODAY, ...over });
const HL = (n, host = 'www.homeless.co.il') => `https://${host}/yad2/viewad%2C${n}.aspx`;

describe('IE-1 one independent Israeli ad: shown at its own price, no worth', () => {
  test('IE-1a the rule is two', () => assert.equal(INDEPENDENT_MIN, 2));
  test('IE-1b one exact ad: no three prices, the reason says why, the ad is State B', () => {
    const v = buildValuation({ evidence: [ad(850, HL(1069137))], today: TODAY });
    assert.equal(v.status, 'insufficient_evidence');
    assert.equal(v.withdrawn, WITHDRAWN.SINGLE_LISTING);
    assert.equal(v.prices, null);
    assert.equal(v.price_confidence, null);
    assert.deepEqual([v.comparative.count, v.comparative.low, v.comparative.observations[0].price_ils], [1, null, 850]);
    assert.equal(v.evidence[0].set_aside, SET_ASIDE.SINGLE);
  });
  test('IE-1c the same Homeless ad on m. and www. (Apple Watch 8, viewad 1069137) is one ad', () => {
    const v = buildValuation({ evidence: [ad(850, HL(1069137, 'm.homeless.co.il')), ad(850, HL(1069137), { title: 'Apple Watch series 8 45mm | מוצרי Apple אחר' })], today: TODAY });
    assert.equal(v.withdrawn, WITHDRAWN.SINGLE_LISTING);
    assert.equal(v.comparative.count, 1);
  });
  test('IE-1d one ad on two list pages (AirPods Pro 2: same price, the same words in another order, no ad number) is one ad', () => {
    const a = ad(300, 'https://www.homeless.co.il/yad2/inumber3%3D48%24%24inumber4%3D307', { title: 'AirPods Pro 2 - איירפודס פרו 2' });
    const b = ad(300, 'https://www.homeless.co.il/yad2/191', { title: 'איירפודס פרו 2 - Airpods Pro 2' });
    assert.equal(sameListing(a, b), true);
    assert.equal(buildValuation({ evidence: [a, b], today: TODAY }).withdrawn, WITHDRAWN.SINGLE_LISTING);
  });
  test('IE-1e two sellers asking the same: two ad numbers, or two sites, are two ads — a worth', () => {
    const v = buildValuation({ evidence: [ad(1000, HL(1116926, 'm.homeless.co.il')), ad(1000, 'https://www.homeless.co.il/yad2/inumber3%3D152%24%24highlight_id%3D855874')], today: TODAY });
    assert.equal(v.status, 'priced');
    assert.equal(independentOf([ad(900, HL(1)), ad(900, 'https://www.ad.co.il/ad/1')]).length, 2);
  });
  test('IE-1f a sale abroad and a shop\'s refurbished unit never make one Israeli ad a market (Marlin 5, iPad 9 shapes)', () => {
    const v = buildValuation({ evidence: [
      ad(1200, HL(5)),
      ad(380, 'https://www.ebay.com/itm/1', { market: 'INTL', kind: 'sold', currency: 'USD', price: 380, price_ils: 1280, domain: 'ebay.com' }),
      ad(1429, 'https://www.ivory.co.il/item/1', { kind: 'refurbished', domain: 'ivory.co.il' }),
    ], today: TODAY });
    assert.equal(v.withdrawn, WITHDRAWN.SINGLE_LISTING);
    assert.deepEqual(v.comparative.observations.map((o) => o.price_ils), [1200], 'only the Israeli private ad is shown as comparative');
  });
  test('IE-1g two independent ads that agree price exactly as before the rule', () => {
    const pool = [ad(300, HL(1)), ad(320, HL(2))];
    const now = buildValuation({ evidence: pool, today: TODAY });
    const before = buildValuation({ evidence: pool, today: TODAY, independentMin: 1 });
    assert.equal(now.status, 'priced');
    assert.deepEqual(now.prices, before.prices);
    assert.equal(now.price_confidence, before.price_confidence);
  });
  test('IE-1h similar items: two list pages of one ad are one comparable, too', () => {
    const a = ad(450, 'https://www.homeless.co.il/yad2/list1', { title: 'כורסת פואנג' });
    const b = ad(450, 'https://www.homeless.co.il/yad2/list2', { title: 'כורסת פואנג' });
    assert.equal(buildValuation({ evidence: [a, b], strategy: 'comparable_items', today: TODAY }).withdrawn, WITHDRAWN.TOO_FEW_COMPARABLES);
  });
});

describe('IE-2 every worth rests on two independent Israeli ads (property, 400 random pools)', () => {
  test('IE-2a for any pool: priced ⇒ at least two independent current Israeli private ads took part', () => {
    let seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
    let priced = 0;
    for (let i = 0; i < 400; i += 1) {
      const n = 1 + Math.floor(rnd() * 4);
      const pool = Array.from({ length: n }, () => ad(200 + Math.floor(rnd() * 200), HL(pick([1, 2, 3, 4]), pick(['www.homeless.co.il', 'm.homeless.co.il'])), {
        kind: pick(['used_listing', 'used_listing', 'sold', 'refurbished']), market: pick(['IL', 'IL', 'INTL']), condition: pick(['good', 'good', 'unknown', 'new_sealed']),
      }));
      const v = buildValuation({ evidence: pool, today: TODAY });
      if (v.status !== 'priced') continue;
      priced += 1;
      const used = v.evidence.filter((e) => e.used && e.market === 'IL' && ['used_listing', 'sold', 'price_guide'].includes(e.kind) && e.condition !== 'new_sealed');
      assert.ok(independentOf(used.map((e) => ({ ...e, price_ils: e.price_ils ?? e.price }))).length >= 2, JSON.stringify(pool.map((e) => [e.url, e.kind, e.market, e.price_ils])));
    }
    assert.ok(priced > 20, `the pools exercise the priced path (${priced})`);
  });
});

describe('IE-3 stored valuations', () => {
  test('IE-3a a new valuation records the rule it was made under; one stored before it reproduces under the old allowance', () => {
    const v = buildValuation({ evidence: [ad(850, HL(1))], today: TODAY });
    assert.equal(v.inputs.independent_min, 2);
    const row = buildValuationRow({ id: 'v', userId: 'u', scanUuid: 's', identity: normalizeIdentity(RAW_IDENTITY), valuation: v, lang: 'he' });
    assert.equal(reproduceValuation(row).withdrawn, WITHDRAWN.SINGLE_LISTING);
    const old = buildValuation({ evidence: [ad(850, HL(1))], today: TODAY, independentMin: 1 });
    assert.equal(old.status, 'priced');
    const legacy = buildValuationRow({ id: 'v0', userId: 'u', scanUuid: 's', identity: normalizeIdentity(RAW_IDENTITY), valuation: old, lang: 'he' });
    delete legacy.ai_raw_response.valuation.inputs.independent_min;
    assert.deepEqual(reproduceValuation(legacy).prices, old.prices, 'a stored one-ad valuation still reproduces exactly');
  });
});
