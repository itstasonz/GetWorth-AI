// ══════════════════════════════════════════════════════════════════════════════
// SCAN ENGINE V2 — THE RETAIL ANCHOR, THE MATRIX, THE TWO CONFIDENCES
//
// What a thing costs new is reported BESIDE what it sells for used and is never
// turned into it; each kind of scan in the matrix claims what its evidence
// supports and no more; and how sure we are what an item is never stands in
// for how well its price is evidenced.
//
// No test here makes a provider call.
//
//   node --test tests/scan-v2-anchor.test.mjs
// ══════════════════════════════════════════════════════════════════════════════
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { RELATION } from '../api/_lib/v2/market-identity.js';
import { ROLE, REFUSED } from '../api/_lib/v2/listing-extraction.js';
import { EVIDENCE_CLASS, ANCHOR_STRENGTH } from '../api/_lib/v2/evidence.js';
import { resolveV2Price, PRICE_STATE, PRODUCED_STATES, BASIS, USED_EVIDENCE, IDENTITY_CONFIDENCE } from '../api/_lib/v2/pricing.js';
import { normalizeIdentity } from '../api/_lib/v2/identity.js';
import { decideSufficiency, DECISION } from '../api/_lib/v2/sufficiency.js';
import { runV2Identify, runV2Price } from '../api/_lib/v2/scan.js';
import { describeEvidence } from '../api/_lib/v2/report.js';
import { IMG, RAW, RESULTS_RETAIL_ONLY, mockV2Provider } from './fixtures/scan-v2/fixtures.mjs';
import * as M from './fixtures/scan-v2/market-fixtures.mjs';
import { scan, prices, MATRIX } from './fixtures/scan-v2/market-matrix.mjs';
import { measureProduct, aggregate, calibrate, DEFAULT_FLOORS, STATUS as CALIBRATION } from '../scripts/valuation-calibration.mjs';

const EXAMPLE = JSON.parse(readFileSync(new URL('./fixtures/scan-v2/calibration.example.json', import.meta.url), 'utf8'));

describe('V2-36 the retail anchor is what it costs new, and is never what it is worth used', () => {
  test('V2-36a I · two independent shops: a STRONG anchor, one price per shop, and no used value', () => {
    const { evidence, price } = MATRIX.find((m) => m.name === 'I retail only');
    assert.equal(price.state, PRICE_STATE.NO_PRICE_EVIDENCE);
    assert.equal(price.recommended, null);
    assert.deepEqual([price.retail_anchor.strength, price.retail_anchor.shops, price.retail_anchor.low, price.retail_anchor.median, price.retail_anchor.high],
      [ANCHOR_STRENGTH.STRONG, 2, 569, 584, 599]);
    assert.deepEqual(price.retail_anchor.prices.map((p) => p.site), ['shopone.co.il', 'shoptwo.co.il'], 'the second page of a shop is not a second shop');
    assert.equal(evidence.counts.admitted, 0);
    assert.deepEqual(price.confidence.pricing, { used_market: USED_EVIDENCE.NONE, retail_anchor: ANCHOR_STRENGTH.STRONG });
  });
  test('V2-36b J · a sibling’s shop price is not this product’s anchor', () => {
    const { evidence, price } = MATRIX.find((m) => m.name === 'J sibling retail');
    assert.equal(price.retail_anchor.strength, ANCHOR_STRENGTH.NONE);
    assert.ok(evidence.entries.every((e) => e.relation === RELATION.SIBLING && e.reason === 'retail_price_for_sibling_identity'));
    assert.equal(price.state, PRICE_STATE.NO_PRICE_EVIDENCE);
  });
  test('V2-36c INVARIANT no retail price is ever admitted as a used listing, and no anchor is a used listing', () => {
    for (const m of MATRIX) {
      for (const e of m.evidence.entries) {
        assert.ok(!(e.kind === 'new_retail' && e.admitted), `${m.name}: retail admitted`);
        assert.ok(!(e.retail_anchor && e.admitted), `${m.name}: one entry, both`);
        if (e.retail_anchor) assert.equal(e.relation, RELATION.EXACT, `${m.name}: an anchor is for the exact product`);
        if (e.admitted) assert.equal(e.evidence_class, EVIDENCE_CLASS.LOCAL_USED, m.name);
      }
      assert.ok(m.evidence.qualification.admitted.every((a) => a.listing_kind !== 'new_retail'), m.name);
    }
  });
  test('V2-36d INVARIANT the used value never moves when the anchor does', () => {
    // E · a perfume: one real used listing and two shops. Remove the shops: the value is the same.
    const withShops = MATRIX.find((m) => m.name === 'E perfume').price;
    const without = scan(M.PERFUME, M.RESULTS_PERFUME.slice(0, 1)).price;
    assert.equal(withShops.retail_anchor.strength, ANCHOR_STRENGTH.STRONG);
    assert.equal(without.retail_anchor.strength, ANCHOR_STRENGTH.NONE);
    for (const k of ['state', 'low', 'recommended', 'high', 'authority']) assert.equal(withShops[k], without[k], k);
    assert.deepEqual(withShops.basis, without.basis);
    assert.equal(withShops.recommended, 280);
    // And with no used listing there is no number, however many shops agree.
    for (const m of MATRIX.filter((x) => x.evidence.counts.admitted === 0)) assert.equal(m.price.recommended, null, m.name);
  });
  test('V2-36e a refurbished unit’s price is not a new price', () => {
    const { price, evidence } = scan(M.NINJA, [M.shop('shopone', 'r1', 'Ninja Power Blender Duo Pro מחודש | שופ וואן', 'מחיר: 399 ₪')]);
    assert.equal(price.retail_anchor.strength, ANCHOR_STRENGTH.NONE);
    assert.equal(evidence.entries[0].reason, 'refurbished_is_not_a_new_price');
  });
});

describe('V2-37 the matrix: what each kind of scan is allowed to claim', () => {
  const of = (name) => MATRIX.find((m) => m.name === name);
  test('V2-37a B · a phone: the exact model and storage verify; another storage and another model do not count', () => {
    const { evidence, price } = of('B phone');
    assert.equal(price.state, PRICE_STATE.VERIFIED_MARKET_VALUE);
    assert.deepEqual(prices(evidence.entries.filter((e) => e.admitted)), [1850, 1900, 2000]);
    assert.deepEqual(evidence.entries.filter((e) => !e.admitted).map((e) => [e.observation.observed_price, e.reason]),
      [[2400, 'listing_names_a_different_variant'], [2900, 'listing_names_a_different_model_qualifier']]);
  });
  test('V2-37b C · three sites, three listings: VERIFIED_MARKET_VALUE', () => {
    assert.equal(of('C console').price.state, PRICE_STATE.VERIFIED_MARKET_VALUE);
    assert.equal(of('C console').price.confidence.pricing.used_market, USED_EVIDENCE.VERIFIED);
  });
  test('V2-37c D · visually ambiguous siblings: the question is asked, and no price evidence could change that', () => {
    const identity = normalizeIdentity(RAW.LOGITECH);
    const before = decideSufficiency(identity);
    assert.equal(before.decision, DECISION.NEED_FOLLOWUP);
    assert.equal(resolveV2Price({ identity, sufficiency: before, evidence: null }).state, PRICE_STATE.NEED_MORE_INFORMATION);
  });
  test('V2-37d F · shoes of an obvious line: the named shoe may price it, another number of the line may not', () => {
    const { evidence } = of('F shoes');
    assert.deepEqual(prices(evidence.entries.filter((e) => e.admitted)), [450]);
    assert.ok(evidence.entries.filter((e) => !e.admitted).every((e) => e.reason));
  });
  test('V2-37e G · one exact listing: below the floors, and it says it is one listing', () => {
    const { price } = of('G one listing');
    assert.equal(price.state, PRICE_STATE.USED_EVIDENCE_BELOW_QUORUM);
    assert.deepEqual([price.basis.kind, price.basis.listings, price.basis.sources], [BASIS.ADMITTED_BELOW_QUORUM, 1, 1]);
    assert.equal(price.confidence.pricing.used_market, USED_EVIDENCE.BELOW_QUORUM);
    assert.equal(price.authority, 'none');
  });
  test('V2-37f H · three exact listings from two sources, and the guard materially adjusts the range: USED_EVIDENCE_ESTIMATE', () => {
    const { evidence, price } = of('H three from two');
    assert.equal(evidence.qualification.qualified, true);
    assert.equal(price.guard.action, 'repair');
    assert.equal(price.guard.material_repair, true);
    assert.deepEqual(price.guard.violations, []);
    assert.equal(price.state, PRICE_STATE.USED_EVIDENCE_ESTIMATE);
    assert.deepEqual(price.basis, { kind: BASIS.GUARD_ADJUSTED, listings: 3, sources: 2 });
    assert.equal(price.confidence.pricing.used_market, USED_EVIDENCE.VERIFIED, 'the evidence is verified; the range is the guard’s');
    assert.equal(price.recommended, 1750);
    assert.ok(price.low <= 1700 && price.high >= 1800);
    assert.equal(price.authority, 'none', 'VERIFIED is kept for a price the guard accepted untouched');
    // The diagnostics say what moved, from what, to what.
    assert.deepEqual(price.guard.range_after, { low: price.low, mid: price.recommended, high: price.high });
    assert.ok(price.guard.moved.length > 0 && price.guard.moved.every((k) => price.guard.range_before[k] !== price.guard.range_after[k]));
    assert.ok(price.guard.range_after.high - price.guard.range_after.low > price.guard.range_before.high - price.guard.range_before.low, 'widened');
  });
  test('V2-37j the guard-adjusted state is NOT the market-informed estimate, and no fixture produces that without a MEASURED factor', () => {
    assert.notEqual(PRICE_STATE.USED_EVIDENCE_ESTIMATE, PRICE_STATE.MARKET_INFORMED_ESTIMATE);
    assert.ok(PRODUCED_STATES.includes(PRICE_STATE.MARKET_INFORMED_ESTIMATE), 'it is a state a scan can now end in');
    for (const m of MATRIX) {
      // The shipped factor table measures no group, so no fixture reaches it: the
      // state says what it is waiting for instead.
      assert.notEqual(m.price.state, PRICE_STATE.MARKET_INFORMED_ESTIMATE, m.name);
      assert.ok(PRODUCED_STATES.includes(m.price.state), m.name);
    }
    // The estimate is reached through the factor lookup and nowhere else.
    const code = resolveV2Price.toString().split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    assert.equal((code.match(/MARKET_INFORMED_ESTIMATE/g) || []).length, 1);
    assert.ok(code.indexOf('findResaleFactor') < code.indexOf('MARKET_INFORMED_ESTIMATE'));
    // And the four claims are four states, told apart by the state alone.
    const states = (name) => of(name).price.state;
    assert.equal(new Set([states('C console'), states('H three from two'), states('G one listing'), states('A witness')]).size, 4);
    assert.deepEqual([states('C console'), states('H three from two'), states('G one listing'), states('A witness')],
      [PRICE_STATE.VERIFIED_MARKET_VALUE, PRICE_STATE.USED_EVIDENCE_ESTIMATE, PRICE_STATE.USED_EVIDENCE_BELOW_QUORUM, PRICE_STATE.NO_PRICE_EVIDENCE]);
    // Retail evidence only is NO_PRICE_EVIDENCE with an anchor beside it — never a used state.
    const retailOnly = of('I retail only').price;
    assert.equal(retailOnly.state, PRICE_STATE.NO_PRICE_EVIDENCE);
    assert.equal(retailOnly.retail_anchor.kind, 'RETAIL_REPLACEMENT_ANCHOR');
    assert.ok(!Object.values(PRICE_STATE).includes('RETAIL_REPLACEMENT_ANCHOR'));
  });
  test('V2-37k VERIFIED needs the guard to accept the range as computed: a rounding repair is not material, a widening is', () => {
    const c = of('C console').price;
    assert.equal(c.state, PRICE_STATE.VERIFIED_MARKET_VALUE);
    assert.equal(c.guard.material_repair, false);
    assert.deepEqual(c.guard.moved, []);
    assert.deepEqual(c.guard.range_after, { low: c.low, mid: c.recommended, high: c.high });
    const h = of('H three from two').price;
    assert.equal(h.guard.material_repair, true);
    assert.notEqual(h.state, PRICE_STATE.VERIFIED_MARKET_VALUE);
    // The decision is read off the numbers, not off the guard's word for it.
    for (const m of MATRIX.filter((x) => x.price.guard)) {
      const g = m.price.guard;
      const differs = ['low', 'mid', 'high'].some((k) => Math.abs(g.range_after[k] - Math.round(g.range_before[k])) >= 1);
      assert.equal(g.material_repair, differs, m.name);
      assert.equal(m.price.state === PRICE_STATE.VERIFIED_MARKET_VALUE, !differs && m.evidence.qualification.qualified && g.violations.length === 0, m.name);
    }
  });
  test('V2-37g M · an unverified alias admits nothing: not a used listing, not a shop price', () => {
    const { evidence, price } = of('M unverified alias');
    assert.ok(evidence.market.aliases.every((a) => a.relation === RELATION.UNVERIFIED));
    assert.deepEqual(evidence.qualification_runs.map((r) => r.form), ['read_off_item']);
    assert.equal(evidence.counts.admitted, 0);
    assert.equal(price.retail_anchor.strength, ANCHOR_STRENGTH.NONE);
    assert.equal(price.state, PRICE_STATE.NO_PRICE_EVIDENCE);
    // The shop's price for the unverified number: a price line with no product beside it.
    assert.ok(evidence.refused.some((r) => r.value === 450 && r.reason === REFUSED.NAKED_PRICE));
    assert.ok(!prices(evidence.entries).includes(450));
  });
  test('V2-37h M · the same kind of listing IS admitted once two sites corroborate the alias — and the sibling’s is not', () => {
    const { evidence, price } = of('M verified alias');
    const admitted = evidence.entries.filter((e) => e.admitted);
    assert.deepEqual(admitted.map((e) => [e.observation.observed_price, e.admitted_as, e.relation]), [[350, 'alias:TB301', RELATION.EXACT]]);
    const sibling = evidence.entries.find((e) => e.observation.observed_price === 250);
    assert.deepEqual([sibling.relation, sibling.admitted, sibling.reason], [RELATION.SIBLING, false, 'listing_names_a_sibling_model']);
    assert.equal(price.state, PRICE_STATE.USED_EVIDENCE_BELOW_QUORUM);
    assert.equal(price.recommended, 350);
  });
  test('V2-37i INVARIANT a listing that names a sibling is never admitted, under any name the gate is asked about', () => {
    // A seller who writes every word of this product's name beside the sibling's number.
    const tricky = [...M.RESULTS_VERIFIED_ALIAS, M.used('boardthree', 63, 'Ninja Power Blender Duo Pro TB303 למכירה 200 ש"ח | לוח יד שניה')];
    const { evidence } = scan(M.NINJA, tricky);
    const e = evidence.entries.find((x) => x.observation.observed_price === 200);
    assert.deepEqual([e.relation, e.admitted, e.reason], [RELATION.SIBLING, false, 'listing_names_a_sibling_model']);
    for (const m of MATRIX) assert.ok(m.evidence.entries.filter((x) => x.admitted).every((x) => x.relation === RELATION.EXACT), m.name);
  });
});

describe('V2-38 how sure we are what it is, and how well its price is evidenced, are two answers', () => {
  test('V2-38a the valuation carries both, in separate fields, and neither is a function of the other', () => {
    for (const m of MATRIX) {
      const c = m.price.confidence;
      assert.deepEqual(Object.keys(c).sort(), ['identity', 'pricing'], m.name);
      assert.deepEqual(Object.keys(c.pricing).sort(), ['retail_anchor', 'used_market'], m.name);
      assert.ok(Object.values(IDENTITY_CONFIDENCE).includes(c.identity.level), m.name);
      assert.ok(Object.values(USED_EVIDENCE).includes(c.pricing.used_market), m.name);
      assert.ok(Object.values(ANCHOR_STRENGTH).includes(c.pricing.retail_anchor), m.name);
    }
    // The same identity at four different strengths of price evidence.
    const ninja = MATRIX.filter((m) => m.raw === M.NINJA);
    assert.ok(new Set(ninja.map((m) => JSON.stringify(m.price.confidence.pricing))).size >= 3);
    assert.deepEqual([...new Set(ninja.map((m) => JSON.stringify(m.price.confidence.identity)))].length, 1, 'and one identity confidence');
    // A console known by its shape is HIGH, not VERY_HIGH — and a shop's price beside it changes nothing about that.
    const bare = scan(M.CONSOLE, M.RESULTS_ONE_LISTING).price;
    const withShop = scan(M.CONSOLE, [...M.RESULTS_ONE_LISTING, M.shop('shopone', 'ps5', 'Sony PlayStation 5 | שופ וואן', 'מחיר: 2,299 ₪')]).price;
    assert.equal(withShop.retail_anchor.shops, 1);
    assert.equal(bare.confidence.identity.level, IDENTITY_CONFIDENCE.HIGH);
    assert.deepEqual(withShop.confidence.identity, bare.confidence.identity);
  });
  test('V2-38b INVARIANT the identity decision is made before any price exists and nothing about prices can reach it', () => {
    const dir = fileURLToPath(new URL('../api/_lib/v2/', import.meta.url));
    const imports = (f) => [...readFileSync(`${dir}${f}`, 'utf8').matchAll(/from '([^']+)'/g)].map((x) => x[1]);
    for (const f of ['sufficiency.js', 'identity.js', 'followup.js']) {
      assert.ok(!imports(f).some((i) => /evidence|pricing|listing-extraction|market-identity|search/.test(i)), f);
    }
    for (const m of MATRIX) {
      assert.deepEqual(decideSufficiency(m.identity), m.sufficiency, m.name);
      assert.equal(m.sufficiency.decision, DECISION.SEARCH_NOW, `${m.name}: sparse evidence asks for no photograph`);
    }
  });
  test('V2-38c a priced scan returns the same identity and sufficiency it was given', async () => {
    const fetchImpl = mockV2Provider({ identities: [RAW.NINJA], results: RESULTS_RETAIL_ONLY });
    const first = await runV2Identify({ image: IMG, model: 'm', apiKey: 'sk-test-not-a-real-key', fetchImpl });
    const priced = await runV2Price({ state: { identity: first.identity, sufficiency: first.sufficiency, followups_used: 0 }, model: 'm', apiKey: 'sk-test-not-a-real-key', fetchImpl });
    assert.deepEqual(priced.identity, first.identity);
    assert.deepEqual(priced.sufficiency, first.sufficiency);
    assert.equal(priced.valuation.state, PRICE_STATE.NO_PRICE_EVIDENCE);
    assert.equal(priced.valuation.retail_anchor.shops, 1);
    assert.equal(priced.sufficiency.followup ?? null, null, 'and no follow-up photograph is asked for');
  });
  test('V2-38d the diagnostics show the accounting, the classes, the relations and every refused number', () => {
    const d = describeEvidence(MATRIX[0].evidence);
    assert.equal(d.accounting.reconciles, true);
    assert.deepEqual(Object.keys(d.counts.by_class), Object.values(EVIDENCE_CLASS));
    assert.deepEqual(Object.keys(d.counts.by_relation), [...Object.values(RELATION), 'UNKNOWN']);
    assert.equal(d.retail.length, 2, 'the product page, and the category row that names the product');
    const page = d.retail.find((r) => r.price === 599);
    const row = d.retail.find((r) => r.price === 569);
    assert.deepEqual([page.outcome, page.price, page.stated_price, page.delivery_fee, page.currency_basis], ['RETAIL_ANCHOR', 599, 608, 9, 'marker']);
    assert.deepEqual([row.outcome, row.binding, row.currency_basis, row.tier], ['RETAIL_ANCHOR', 'category_row', 'site_locale', 'C_RETAIL_ANCHOR']);
    assert.equal(d.extraction_reasons[REFUSED.FEE], 3);
    for (const fee of [9, 29, 55]) assert.ok(d.refused_at_extraction.some((r) => r.value === fee && r.role === ROLE.DELIVERY_FEE), `fee ${fee}`);
    // The sibling's bare price on the same page stays refused, and says whose it was.
    assert.ok(d.refused_at_extraction.some((r) => r.value === 550 && r.reason === REFUSED.NO_CURRENCY && r.relation === RELATION.SIBLING));
    assert.equal(d.pages.length, 31);
    assert.ok(d.pages.every((p) => typeof p.source_type === 'string' && ['local', 'international'].includes(p.locale)));
  });
});

describe('V2-39 the calibration harness is offline', () => {
  test('V2-39a nothing the scan runs imports it, and it imports nothing from the scan', () => {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const walk = (dir) => readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
    for (const file of [...walk(join(root, 'api')), ...walk(join(root, 'src'))].filter((f) => /\.(js|jsx|mjs)$/.test(f))) {
      assert.ok(!/(from|import\(|require\()\s*['"][^'"]*valuation-calibration/.test(readFileSync(file, 'utf8')), file);
    }
    const harness = readFileSync(join(root, 'scripts/valuation-calibration.mjs'), 'utf8');
    assert.deepEqual([...harness.matchAll(/from '([^']+)'/g)].map((m) => m[1]), ['node:fs', 'node:url']);
  });
  test('V2-39b it holds no factor of its own: no percentage, no ratio, no default depreciation', () => {
    const harness = readFileSync(fileURLToPath(new URL('../scripts/valuation-calibration.mjs', import.meta.url)), 'utf8');
    const code = harness.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    // The only decimals are the quantile positions (a quarter, a half, three quarters).
    assert.deepEqual([...new Set(code.match(/\b0\.\d+\b/g))].sort(), ['0.25', '0.5', '0.75']);
    assert.ok(!/depreciation\s*[:=]|factor\s*=\s*\d|\* ?0\.\d/i.test(code));
  });
  test('V2-39c a product is measured per condition: retail median, used median, their ratio, the samples behind them', () => {
    const [row] = measureProduct(EXAMPLE.products[0]);
    assert.deepEqual(
      [row.category, row.product_class, row.condition, row.retail_median, row.retail_sources, row.used_median, row.used_listings, row.used_sources, row.usable],
      ['Home', 'consumer appliance', 'Good', 620, 2, 320, 3, 2, true]);
    assert.equal(row.ratio, Number((320 / 620).toFixed(4)));
    // Two conditions are two measurements, never pooled.
    const mixed = measureProduct({ ...EXAMPLE.products[0], used: [...EXAMPLE.products[0].used, { price: 150, source: 'board-three.example', condition: 'Poor' }] });
    assert.deepEqual(mixed.map((r) => [r.condition, r.used_listings]), [['Good', 3], ['Poor', 1]]);
  });
  test('V2-39d thin data is reported as thin: each unmet floor is named, and the row feeds no group', () => {
    const retailOnly = measureProduct(EXAMPLE.products.find((p) => p.id === 'example-retail-only'))[0];
    assert.equal(retailOnly.usable, false);
    assert.deepEqual(retailOnly.reasons, ['retail_sources_below_floor', 'used_listings_below_floor', 'used_sources_below_floor']);
    assert.equal(retailOnly.ratio, null);
    // Three pages of one shop are one retail source.
    const oneShop = measureProduct({ ...EXAMPLE.products[0], retail: [1, 2, 3].map((i) => ({ price: 600 + i, source: 'shop-one.example' })) })[0];
    assert.equal(oneShop.retail_sources, 1);
    assert.ok(oneShop.reasons.includes('retail_sources_below_floor'));
  });
  test('V2-39e a foreign price is dropped and counted, never converted', () => {
    const foreign = measureProduct(EXAMPLE.products.find((p) => p.id === 'example-foreign'))[0];
    assert.equal(foreign.dropped.foreign_currency, 2);
    assert.equal(foreign.retail_median, 700);
    assert.equal(foreign.used_listings, 0);
  });
  test('V2-39f a group is MEASURED only above the product floor, with its spread and its leave-one-out error', () => {
    const report = calibrate(EXAMPLE);
    const appliances = report.groups.find((g) => g.group === 'consumer appliance / Good');
    assert.equal(appliances.status, CALIBRATION.MEASURED);
    assert.equal(appliances.products, 5);
    const ratios = EXAMPLE.products.slice(0, 5).map((p) => measureProduct(p)[0].ratio).sort((a, b) => a - b);
    assert.equal(appliances.factor.median, ratios[2], 'the factor is the observed median and nothing else');
    assert.deepEqual([appliances.factor.min, appliances.factor.max], [ratios[0], ratios[4]]);
    assert.ok(appliances.leave_one_out.n === 5 && appliances.leave_one_out.median_abs_error > 0);
    const mice = report.groups.find((g) => g.group === 'gaming peripheral / Good');
    assert.equal(mice.status, CALIBRATION.INSUFFICIENT_DATA, 'one product is not a class');
    assert.match(report.production_use, /^NONE/);
    // The floors are arguments: a stricter one un-measures the group, and no number is invented to fill it.
    const strict = aggregate(report.rows, { floors: { ...DEFAULT_FLOORS, minProductsPerGroup: 6 } });
    assert.ok(strict.every((g) => g.status === CALIBRATION.INSUFFICIENT_DATA));
  });
});
