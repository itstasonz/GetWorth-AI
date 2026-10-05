// ══════════════════════════════════════════════════════════════════════════════
// SCAN ENGINE V2 — MARKET RESOLUTION: THE PLAN, THE OBJECT, THE PLACE, THE PRICE FORM
//
// What GW-SCAN-V2-001 added, as rules about products and places and never
// about one blender: a plan that never halves itself, a configuration for
// every listing and for the photograph, a source type decided by the host and
// not the currency symbol, a shop's bare price read in the market's own form,
// another product's number kept out, a calibrated confidence, and an estimate
// that exists only behind a measured factor.
//
//   node --test tests/scan-v2-resolution.test.mjs
// ══════════════════════════════════════════════════════════════════════════════
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { planV2Search, subjectOf, V2_PURPOSE, MAX_V2_QUERIES } from '../api/_lib/v2/search-plan.js';
import { normalizeIdentity, V2_IDENTITY_SCHEMA, buildIdentityPrompt } from '../api/_lib/v2/identity.js';
import { decideSufficiency, DECISION, IDENTITY_LEVEL } from '../api/_lib/v2/sufficiency.js';
import { mergeIdentity } from '../api/_lib/v2/followup.js';
import { classifyConfiguration, configurationCompatible, CONFIGURATION, PRICEABLE_CONFIGURATIONS } from '../api/_lib/v2/configuration.js';
import { classifySource, isLocalHost, SOURCE_TYPE, LOCALE } from '../api/_lib/v2/source-type.js';
import { localePriceCandidates, unmarkedPrices, CURRENCY_BASIS } from '../api/_lib/v2/locale-price.js';
import { calibrateField, classifyVisibleText, EVIDENCE_CAP, MODEL_LOGO_CAP, TEXT_ROLE } from '../api/_lib/v2/calibration.js';
import { assessMarketIdentity, relationOf, RELATION } from '../api/_lib/v2/market-identity.js';
import { EVIDENCE_CLASS, ANCHOR_STRENGTH, TIER } from '../api/_lib/v2/evidence.js';
import { BINDING } from '../api/_lib/v2/listing-extraction.js';
import { resolveV2Price, PRICE_STATE, EVIDENCE_STATE, LIMITATION, BASIS, USED_EVIDENCE, IDENTITY_CONFIDENCE } from '../api/_lib/v2/pricing.js';
import { findResaleFactor, loadResaleFactors, FACTOR_STATUS, groupKey } from '../api/_lib/v2/resale-factors.js';
import { ledgerLine } from '../api/_lib/v2/report.js';
import { SEARCH_OUTCOME } from '../api/_lib/v2/search.js';
import * as M from './fixtures/scan-v2/market-fixtures.mjs';
import { MATRIX, IL, scan, provenanceOf } from './fixtures/scan-v2/market-matrix.mjs';
import { RAW } from './fixtures/scan-v2/fixtures.mjs';

const of = (name) => MATRIX.find((m) => m.name === name);
const id = (raw) => normalizeIdentity(raw);
const purposes = (plan) => plan.queries.map((q) => q.purpose);

// ── THE PLAN ────────────────────────────────────────────────────────────────
describe('V2-40 the plan never halves itself', () => {
  const restating = { aliases: ['Ninja Power Blender Duo Pro', 'Ninja BlendSense Power Blender Duo Pro'], model_numbers: [] };
  test('V2-40a THE WITNESS: a proposal that restates the read name takes no slot; the four are the name, the price, the model word, the sale word', () => {
    const plan = planV2Search(id({ ...M.NINJA, market_hypotheses: restating }), IDENTITY_LEVEL.PRODUCT, IL);
    assert.deepEqual(purposes(plan), [V2_PURPOSE.SECOND_HAND, V2_PURPOSE.PRICE_CONTEXT, V2_PURPOSE.MODEL_NUMBER, V2_PURPOSE.FOR_SALE]);
    assert.deepEqual(plan.queries.map((q) => q.text), [
      'Ninja Power Blender Duo Pro יד שנייה', 'Ninja Power Blender Duo Pro מחיר', 'Ninja Power Blender Duo Pro דגם', 'Ninja Power Blender Duo Pro למכירה',
    ]);
    assert.deepEqual(plan.hypotheses, [], 'a restatement is not a hypothesis either');
    assert.equal(plan.queries.length, MAX_V2_QUERIES);
  });
  test('V2-40b a real proposal keeps the alias slots, and a market without a model word falls back to its other words', () => {
    assert.deepEqual(purposes(planV2Search(id(M.NINJA), IDENTITY_LEVEL.PRODUCT, IL)),
      [V2_PURPOSE.SECOND_HAND, V2_PURPOSE.PRICE_CONTEXT, V2_PURPOSE.ALIAS_SECOND_HAND, V2_PURPOSE.ALIAS_PRICE]);
    const elsewhere = { ...IL, terms: { second_hand: 'used', for_sale: 'for sale', price: 'price' } };
    assert.deepEqual(purposes(planV2Search(id({ ...M.NINJA, market_hypotheses: restating }), IDENTITY_LEVEL.PRODUCT, elsewhere)),
      [V2_PURPOSE.SECOND_HAND, V2_PURPOSE.PRICE_CONTEXT, V2_PURPOSE.FOR_SALE, V2_PURPOSE.LOCAL_NAME]);
  });
  test('V2-40c a model number READ off the item is searched as identity: two alias queries and no hypothesis', () => {
    const read = id({ ...M.NINJA, visible_text: [...M.NINJA.visible_text, 'TB301'], model_number: { value: 'TB301', confidence: 0.9, evidence: 'LABEL_READ' }, market_hypotheses: { aliases: [], model_numbers: ['TB300'] } });
    assert.equal(read.model_number.value, 'TB301');
    const plan = planV2Search(read, IDENTITY_LEVEL.PRODUCT, IL);
    assert.deepEqual(plan.queries.map((q) => [q.purpose, q.hypothesis ?? null]).slice(2), [[V2_PURPOSE.ALIAS_SECOND_HAND, null], [V2_PURPOSE.ALIAS_PRICE, null]]);
    assert.match(plan.queries[2].text, /^Ninja TB301 /);
    assert.deepEqual(plan.hypotheses, []);
    assert.equal(subjectOf(read, IDENTITY_LEVEL.PRODUCT).model_number, 'TB301');
  });
  test('V2-40d every identity still plans at most four queries, at every level', () => {
    for (const raw of [M.NINJA, { ...M.NINJA, market_hypotheses: restating }, M.AIRPODS_CASE, M.IPHONE, RAW.PS5, RAW.SOFA, RAW.LOGITECH]) {
      for (const level of Object.values(IDENTITY_LEVEL)) assert.ok(planV2Search(id(raw), level, IL).queries.length <= MAX_V2_QUERIES);
    }
  });
});

// ── THE OBJECT ──────────────────────────────────────────────────────────────
describe('V2-41 the same model is not the same sellable object', () => {
  test('V2-41a each configuration is read off the words, in either language, and silence is UNKNOWN', () => {
    const cases = [
      ['Ninja Detect Power Blender Duo Pro - TB301 - BASE ONLY', CONFIGURATION.BASE_ONLY],
      ['בלנדר נינג׳ה בסיס בלבד ללא קנקן', CONFIGURATION.BASE_ONLY],
      ['AirPods Pro 2 charging case only', CONFIGURATION.ACCESSORY_ONLY],
      ['PS5 controller only', CONFIGURATION.ACCESSORY_ONLY],
      ['Ninja TB301 כוס בלבד', CONFIGURATION.ACCESSORY_ONLY],
      ['Air Jordan 1 box only, no shoes', CONFIGURATION.BOX_ONLY],
      ['Dior Sauvage בקבוק ריק', CONFIGURATION.BOX_ONLY],
      ['Replacement blade for Ninja TB301', CONFIGURATION.REPLACEMENT_PART],
      ['חלק חילוף לבלנדר נינג׳ה', CONFIGURATION.REPLACEMENT_PART],
      ['Ninja TB301 for parts, not working', CONFIGURATION.PARTS],
      ['בלנדר נינג׳ה תקול לחלקים', CONFIGURATION.PARTS],
      ['Ninja TB301 bundle with extra cups', CONFIGURATION.BUNDLE],
      ['Ninja Detect Duo TB301 complete set', CONFIGURATION.COMPLETE],
      ['Ninja TB301 Power Blender Duo Pro למכירה', CONFIGURATION.UNKNOWN],
      ['', CONFIGURATION.UNKNOWN],
    ];
    for (const [text, want] of cases) assert.equal(classifyConfiguration(text).configuration, want, text);
    assert.equal(classifyConfiguration('complete set, for parts').configuration, CONFIGURATION.PARTS, 'parts wins');
    assert.equal(classifyConfiguration(null).marker, null);
  });
  test('V2-41b what may price what: complete from complete or unsaid; an accessory from "x only" or unsaid; a base only from a base', () => {
    assert.deepEqual([...PRICEABLE_CONFIGURATIONS].sort(), [CONFIGURATION.COMPLETE, CONFIGURATION.UNKNOWN]);
    assert.ok(configurationCompatible(CONFIGURATION.UNKNOWN, CONFIGURATION.COMPLETE));
    assert.ok(configurationCompatible(CONFIGURATION.COMPLETE, CONFIGURATION.UNKNOWN));
    for (const c of [CONFIGURATION.BASE_ONLY, CONFIGURATION.ACCESSORY_ONLY, CONFIGURATION.BOX_ONLY, CONFIGURATION.REPLACEMENT_PART, CONFIGURATION.BUNDLE, CONFIGURATION.PARTS]) {
      assert.ok(!configurationCompatible(c, CONFIGURATION.COMPLETE), c);
      assert.ok(!configurationCompatible(c, CONFIGURATION.UNKNOWN), c);
    }
    assert.ok(configurationCompatible(CONFIGURATION.ACCESSORY_ONLY, CONFIGURATION.ACCESSORY_ONLY));
    assert.ok(configurationCompatible(CONFIGURATION.UNKNOWN, CONFIGURATION.ACCESSORY_ONLY));
    assert.ok(!configurationCompatible(CONFIGURATION.COMPLETE, CONFIGURATION.ACCESSORY_ONLY));
    assert.ok(configurationCompatible(CONFIGURATION.BASE_ONLY, CONFIGURATION.BASE_ONLY));
    assert.ok(!configurationCompatible(CONFIGURATION.UNKNOWN, CONFIGURATION.BASE_ONLY));
  });
  test('V2-41c N · a base, a cup and a box with the exact name and number price nothing; the complete set is admitted; the base-only shop is no anchor', () => {
    const { evidence, price } = of('N wrong configuration');
    const byPrice = Object.fromEntries(evidence.entries.map((e) => [e.observation.observed_price, e]));
    assert.deepEqual([byPrice[150].configuration, byPrice[150].reason], [CONFIGURATION.BASE_ONLY, 'configuration_base_only']);
    assert.deepEqual([byPrice[40].configuration, byPrice[40].reason], [CONFIGURATION.ACCESSORY_ONLY, 'configuration_accessory_only']);
    assert.deepEqual([byPrice[20].configuration, byPrice[20].reason], [CONFIGURATION.BOX_ONLY, 'configuration_box_only']);
    assert.deepEqual([byPrice[350].configuration, byPrice[350].admitted, byPrice[350].tier], [CONFIGURATION.COMPLETE, true, TIER.A]);
    assert.deepEqual([byPrice[299].kind, byPrice[299].retail_anchor, byPrice[299].reason], ['new_retail', false, 'configuration_base_only']);
    assert.equal(evidence.counts.configuration_excluded, 4);
    assert.equal(price.state, PRICE_STATE.USED_EVIDENCE_BELOW_QUORUM);
    assert.equal(price.recommended, 350);
    assert.equal(price.retail_anchor.strength, ANCHOR_STRENGTH.NONE);
    assert.equal(price.limitation.code, LIMITATION.NO_ANCHOR);
  });
  test('V2-41d O · the photographed object is a charging case: the buds are the host product, the case is the comparable, the shop selling the case is the anchor', () => {
    const { identity, subject, evidence, price } = of('O accessory subject');
    assert.equal(identity.configuration, CONFIGURATION.ACCESSORY_ONLY);
    assert.equal(subject.configuration, CONFIGURATION.ACCESSORY_ONLY);
    assert.equal(evidence.subject_configuration, CONFIGURATION.ACCESSORY_ONLY);
    const byPrice = Object.fromEntries(evidence.entries.map((e) => [e.observation.observed_price, e]));
    assert.equal(byPrice[450].reason, 'listing_is_the_host_product_not_the_accessory');
    assert.equal(byPrice[899].reason, 'listing_is_the_host_product_not_the_accessory');
    assert.ok(!byPrice[899].retail_anchor, 'a shop selling the full product is not the anchor for its case');
    assert.deepEqual([byPrice[150].admitted, byPrice[150].configuration], [true, CONFIGURATION.ACCESSORY_ONLY]);
    assert.deepEqual([byPrice[390].retail_anchor, byPrice[390].tier], [true, TIER.C]);
    assert.deepEqual([price.retail_anchor.shops, price.retail_anchor.median], [1, 390]);
    assert.equal(price.state, PRICE_STATE.USED_EVIDENCE_BELOW_QUORUM);
    assert.equal(price.recommended, 150);
  });
  test('V2-41e the identity contract carries the configuration of the photograph, defaults to UNKNOWN, and a follow-up keeps the first photograph’s', () => {
    assert.deepEqual(V2_IDENTITY_SCHEMA.properties.configuration.enum, Object.values(CONFIGURATION));
    assert.equal(id(M.NINJA).configuration, CONFIGURATION.UNKNOWN);
    assert.equal(id({ ...M.NINJA, configuration: 'nonsense' }).configuration, CONFIGURATION.UNKNOWN);
    assert.match(buildIdentityPrompt(), /configuration: what the photograph shows/);
    const merged = mergeIdentity(id({ ...M.NINJA, configuration: 'BASE_ONLY' }), id({ ...M.NINJA, configuration: 'UNKNOWN' }));
    assert.equal(merged.configuration, CONFIGURATION.BASE_ONLY);
    assert.equal(mergeIdentity(id(M.NINJA), id({ ...M.NINJA, configuration: 'BOX_ONLY' })).configuration, CONFIGURATION.BOX_ONLY);
  });
});

// ── THE PLACE ───────────────────────────────────────────────────────────────
describe('V2-42 where a price was asked is a fact about the host, never about the symbol beside the number', () => {
  test('V2-42a a host is local by its suffix; everything else is abroad', () => {
    assert.ok(isLocalHost('shop.super-pharm.co.il', IL));
    assert.ok(isLocalHost('market.yad2.co.il', IL));
    assert.ok(!isLocalHost('il.ebay.com', IL), 'a country prefix on a foreign host is not the market');
    assert.ok(!isLocalHost('ebay.com', IL));
    assert.ok(!isLocalHost('', IL));
    assert.ok(!isLocalHost('shop.co.il', { ...IL, site_suffixes: [] }));
  });
  test('V2-42b each kind of place, from its host and its page, and a brand’s own host generically', () => {
    const t = (o) => classifySource({ region: IL, brand: 'Ninja', ...o });
    assert.deepEqual([t({ url: 'https://il.ebay.com/itm/1', domain: 'il.ebay.com', title: 'Ninja TB301 | eBay', text: 'ILS 622.13 Used' }).source_type, t({ domain: 'il.ebay.com' }).locale],
      [SOURCE_TYPE.INTERNATIONAL_USED_MARKETPLACE, LOCALE.INTERNATIONAL]);
    assert.equal(t({ url: 'https://www.craigslist.org/x', domain: 'www.craigslist.org' }).source_type, SOURCE_TYPE.INTERNATIONAL_USED_MARKETPLACE);
    assert.equal(t({ url: 'https://www.sharkninja.com/TB301.html', domain: 'www.sharkninja.com', title: 'Ninja Detect Duo' }).source_type, SOURCE_TYPE.MANUFACTURER);
    assert.equal(t({ url: 'https://www.zap.co.il/model.aspx?modelid=1', domain: 'www.zap.co.il', title: 'שייקר Ninja - זאפ השוואת מחירים' }).source_type, SOURCE_TYPE.PRICE_COMPARISON);
    assert.equal(t({ url: 'https://shop.super-pharm.co.il/p/1', domain: 'shop.super-pharm.co.il', title: 'NINJA - בלנדר TB301', text: 'הוספה לסל' }).source_type, SOURCE_TYPE.LOCAL_RETAIL);
    assert.equal(t({ url: 'https://www.boardone.co.il/ad/1', domain: 'www.boardone.co.il', title: 'Ninja TB301 למכירה | לוח יד שניה' }).source_type, SOURCE_TYPE.LOCAL_USED_MARKETPLACE);
    assert.equal(t({ url: 'https://www.reddit.com/r/x/comments/1', domain: 'www.reddit.com', kind: 'reddit' }).source_type, SOURCE_TYPE.FORUM);
    assert.equal(t({ url: 'https://www.tomsguide.com/review', domain: 'www.tomsguide.com', kind: 'news', title: 'I tested this blender' }).source_type, SOURCE_TYPE.EDITORIAL);
    assert.equal(t({ url: 'https://cdn.example.com/manual.pdf', domain: 'cdn.example.com', title: 'User manual' }).source_type, SOURCE_TYPE.DOCUMENTATION);
    assert.equal(t({ url: 'https://en.wikipedia.org/wiki/Yad2', domain: 'en.wikipedia.org' }).source_type, SOURCE_TYPE.IRRELEVANT);
    assert.equal(t({ url: 'https://www.unknown-shop.example/p/1', domain: 'www.unknown-shop.example', title: 'Ninja TB301' }).source_type, SOURCE_TYPE.UNKNOWN, 'a host on no list is typed by its page, and this page says nothing');
    assert.equal(classifySource({}).locale, LOCALE.INTERNATIONAL);
  });
  test('V2-42c Q · a marketplace abroad showing a converted shekel price is FOREIGN, tier B at best, and never admitted; its base-only listing is excluded for its configuration', () => {
    const { evidence, price } = of('Q abroad');
    assert.ok(evidence.pages.filter((p) => /ebay|craigslist/.test(p.domain)).every((p) => p.locale === LOCALE.INTERNATIONAL && p.source_type === SOURCE_TYPE.INTERNATIONAL_USED_MARKETPLACE));
    const craigslist = evidence.entries.find((e) => e.observation.source_domain === 'craigslist.org');
    assert.deepEqual([craigslist.kind, craigslist.evidence_class, craigslist.tier, craigslist.admitted, craigslist.reason],
      ['used_listing', EVIDENCE_CLASS.FOREIGN_USED, TIER.B, false, 'foreign_currency_without_fx_proof']);
    const baseOnly = evidence.entries.find((e) => e.observation.source_domain === 'ebay.com');
    assert.deepEqual([baseOnly.configuration, baseOnly.reason], [CONFIGURATION.BASE_ONLY, 'configuration_base_only']);
    // A converted shekel price on the marketplace abroad is still abroad: foreign used, not a local source.
    const converted = evidence.entries.find((e) => e.observation.source_domain === 'il.ebay.com');
    assert.deepEqual([converted.observation.currency, converted.kind, converted.evidence_class, converted.locale, converted.admitted, converted.reason],
      ['ILS', 'used_listing', EVIDENCE_CLASS.FOREIGN_USED, LOCALE.INTERNATIONAL, false, 'listing_is_outside_the_market']);
    // A shop abroad showing a shekel price is not the replacement price here.
    const shop = evidence.entries.find((e) => e.observation.source_domain === 'shopabroad.com');
    assert.deepEqual([shop.observation.currency, shop.kind, shop.relation, shop.retail_anchor, shop.reason], ['ILS', 'new_retail', RELATION.EXACT, false, 'shop_is_outside_the_market']);
    assert.ok(evidence.entries.every((e) => e.evidence_class !== EVIDENCE_CLASS.LOCAL_USED && e.evidence_class !== EVIDENCE_CLASS.LOCAL_RETAIL && !e.admitted && !e.retail_anchor));
    assert.equal(evidence.counts.by_tier[TIER.B], 2);
    assert.equal(price.state, PRICE_STATE.NO_PRICE_EVIDENCE);
    assert.equal(price.retail_anchor.strength, ANCHOR_STRENGTH.NONE);
  });
  test('V2-42d INVARIANT across the matrix: a listing is local by locale and never by currency; nothing abroad is admitted or an anchor', () => {
    for (const m of MATRIX) {
      for (const e of m.evidence.entries) {
        const local = e.locale === LOCALE.LOCAL;
        const allowed = local ? [EVIDENCE_CLASS.LOCAL_USED, EVIDENCE_CLASS.LOCAL_RETAIL, EVIDENCE_CLASS.OTHER] : [EVIDENCE_CLASS.FOREIGN_USED, EVIDENCE_CLASS.FOREIGN_RETAIL, EVIDENCE_CLASS.OTHER];
        assert.ok(allowed.includes(e.evidence_class), `${m.name}: ${e.observation.source_domain} ${e.evidence_class}`);
        if (!local) assert.ok(!e.admitted && !e.retail_anchor, `${m.name}: ${e.observation.source_domain}`);
        assert.ok(e.tier === null || Object.values(TIER).includes(e.tier), m.name);
        assert.ok(Object.values(CONFIGURATION).includes(e.configuration), m.name);
      }
      assert.ok(m.evidence.pages.every((p) => Object.values(SOURCE_TYPE).includes(p.source_type)), m.name);
    }
  });
});

// ── THE PRICE FORM ──────────────────────────────────────────────────────────
describe('V2-43 a shop inside the market, printing its price without the sign', () => {
  const market = assessMarketIdentity({ identity: id(M.NINJA), results: provenanceOf(M.RESULTS_LOCALE_ROWS).results });
  const ROW ='החל מ- 550 550   NINJA בלנדר שייקר Ninja TB303 DETECT (2) הוספה לסל החל מ- 569 569   NINJA בלנדר ושייקר TB301 משלוח חינם   החל מ- 448 448 799 799 בתוקף עד 30.09.2026 NINJA בלנדר Ninja TB301 Detect Duo Pro הוספה לסל';
  test('V2-43a only the market’s two price forms are read: a price word before the number, or the number printed twice', () => {
    assert.deepEqual(unmarkedPrices('מחיר 599 ... 1200W ... 2.1 ליטר ... 569 569 ... from 299').map((u) => u.value), [599, 569, 299]);
    assert.deepEqual(unmarkedPrices('דגם TB301 1200 וואט 14 מהירויות').map((u) => u.value), []);
  });
  test('V2-43b a local shop, a retail context, the exact product beside the number: a candidate with the currency inferred from the host; the promotion’s old price is refused as one', () => {
    const { candidates, refused } = localePriceCandidates(ROW, { market, region: IL, local: true, retail: true });
    assert.deepEqual(candidates.map((c) => [c.value, c.currency, c.currency_basis, c.relation]).sort((a, b) => a[0] - b[0]),
      [[448, 'ILS', CURRENCY_BASIS.SITE_LOCALE, RELATION.EXACT], [569, 'ILS', CURRENCY_BASIS.SITE_LOCALE, RELATION.EXACT]]);
    assert.ok(candidates.every((c) => /TB301/.test(c.name)));
    assert.deepEqual(refused.map((r) => [r.value, r.reason, r.relation]).sort((a, b) => a[0] - b[0]),
      [[550, 'price_without_currency_marker', RELATION.SIBLING], [799, 'not_an_asking_price', RELATION.EXACT]]);
  });
  test('V2-43c abroad, or outside a retail context, the same row yields no candidate and says why', () => {
    const abroad = localePriceCandidates(ROW, { market, region: IL, local: false, retail: true });
    assert.equal(abroad.candidates.length, 0);
    assert.ok(abroad.refused.filter((r) => r.relation === RELATION.EXACT).every((r) => r.note === 'host_is_outside_the_market'));
    const forum = localePriceCandidates(ROW, { market, region: IL, local: true, retail: false });
    assert.equal(forum.candidates.length, 0);
    assert.ok(forum.refused.filter((r) => r.relation === RELATION.EXACT).every((r) => r.note === 'not_a_retail_context'));
    assert.equal(localePriceCandidates(ROW, { market, region: null, local: true, retail: true }).candidates.length, 0, 'no region, no currency to infer');
    assert.equal(localePriceCandidates(ROW, { market: null, region: IL, local: true, retail: true }).candidates.length, 0, 'no market identity, nothing is ours');
  });
  test('V2-43d R · the shop’s row is a row-bound anchor labelled as inferred; it is never a used listing; abroad and the forum stay refused', () => {
    const { evidence, price } = of('R locale rows');
    const anchors = evidence.entries.filter((e) => e.retail_anchor);
    assert.ok(anchors.length >= 1 && anchors.every((e) => e.observation.source_domain === 'shopone.co.il' && e.currency_basis === CURRENCY_BASIS.SITE_LOCALE && e.row_bound && !e.admissible && e.kind === 'new_retail'));
    assert.deepEqual([price.retail_anchor.strength, price.retail_anchor.shops], [ANCHOR_STRENGTH.SINGLE_SOURCE, 1]);
    assert.equal(price.retail_anchor.prices[0].currency_basis, CURRENCY_BASIS.SITE_LOCALE);
    assert.ok(evidence.refused.some((r) => r.value === 299 && r.note === 'host_is_outside_the_market'));
    assert.ok(evidence.refused.some((r) => r.value === 799 && r.reason === 'not_an_asking_price'));
    assert.ok(!evidence.entries.some((e) => e.observation.source_domain.includes('forumone')));
    assert.equal(evidence.counts.admitted, 0);
    assert.equal(evidence.counts.locale_inferred_prices, anchors.length);
  });
  test('V2-43e INVARIANT a price whose currency was inferred never reaches the evidence gate, on any fixture', () => {
    for (const m of MATRIX) {
      for (const e of m.evidence.entries.filter((x) => x.currency_basis === CURRENCY_BASIS.SITE_LOCALE)) {
        assert.ok(!e.admissible && !e.admitted && e.kind === 'new_retail' && e.locale === LOCALE.LOCAL, `${m.name}: ${e.observation.observed_price}`);
      }
    }
  });
  test('V2-43g a retail sentence on a forum or review page is bound to its sentence and is no anchor: only a product page or a shop’s row is', () => {
    const forum = scan(M.NINJA, [...M.CONNECTS_TB301, M.result('https://www.forumone.co.il/forums/blenders/1', 'דיון: איזה בלנדר | פורום',
      'ראיתי היום Ninja TB301 Power Blender Duo Pro במלאי 599 ₪ בחנות')]);
    const e = forum.evidence.entries.find((x) => x.observation.observed_price === 599);
    assert.deepEqual([e.kind, e.relation, e.binding, e.row_bound, e.retail_anchor], ['new_retail', RELATION.EXACT, BINDING.SENTENCE, false, false]);
    assert.equal(forum.price.retail_anchor.strength, ANCHOR_STRENGTH.NONE);
  });
  test('V2-43h a shop inside the market quoting another currency is local, exact, and still no anchor: nothing is converted', () => {
    const r = scan(M.NINJA, [M.shop('shopone', 'ninja-duo-pro-usd', 'Ninja Power Blender Duo Pro | שופ וואן', 'Price: $179.99 In stock')]);
    const e = r.evidence.entries.find((x) => x.observation.observed_price === 179.99);
    assert.deepEqual([e.observation.currency, e.locale, e.evidence_class, e.relation, e.retail_anchor, e.reason],
      ['USD', LOCALE.LOCAL, EVIDENCE_CLASS.LOCAL_RETAIL, RELATION.EXACT, false, 'foreign_currency_is_not_converted']);
    assert.equal(r.price.retail_anchor.strength, ANCHOR_STRENGTH.NONE);
  });
  test('V2-43f a platform seller phrase is retail, not a person selling', () => {
    const { entries } = scan(M.NINJA, [M.result('https://www.shopone.co.il/c/ninja', 'NINJA | שופ וואן', 'Ninja Power Blender Duo Pro 569 ₪ מוכר חיצוני להצעות נוספות')]).evidence;
    assert.equal(entries.length, 1);
    assert.deepEqual([entries[0].kind, entries[0].admissible], ['new_retail', false]);
  });
});

// ── ANOTHER PRODUCT ─────────────────────────────────────────────────────────
describe('V2-44 another product’s number', () => {
  test('V2-44a once this product’s number is known, a text with a different one is OTHER_PRODUCT; before it is known, it is unresolved', () => {
    const known = assessMarketIdentity({ identity: id(M.NINJA), results: provenanceOf(M.RESULTS_OTHER_PRODUCT).results });
    assert.deepEqual(known.exact_roots, ['TB301']);
    assert.equal(relationOf('Ninja CB103 Power Nutri Duo למכירה', known), RELATION.OTHER_PRODUCT);
    assert.equal(relationOf('Ninja TB301 Power Blender Duo Pro', known), RELATION.EXACT);
    const unknown = assessMarketIdentity({ identity: id(M.NINJA), results: [] });
    assert.deepEqual(unknown.exact_roots, []);
    assert.equal(relationOf('Ninja CB103 Power Nutri Duo למכירה', unknown), 'UNKNOWN');
  });
  test('V2-44b P · the CB103 listing carries the brand and the one distinctive word, and is kept out of the gate; the TB301 listing is admitted', () => {
    const { evidence, price } = of('P other product');
    const other = evidence.entries.find((e) => e.observation.observed_price === 346);
    assert.deepEqual([other.relation, other.admitted, other.reason, other.tier], [RELATION.OTHER_PRODUCT, false, 'listing_names_another_model_number', null]);
    const ours = evidence.entries.find((e) => e.observation.observed_price === 380);
    assert.deepEqual([ours.relation, ours.admitted, ours.tier], [RELATION.EXACT, true, TIER.A]);
    assert.equal(evidence.counts.other_product, 1);
    assert.equal(evidence.counts.by_relation.OTHER_PRODUCT, 1);
    assert.equal(price.recommended, 380);
  });
});

// ── THE NUMBER THE MODEL WROTE ──────────────────────────────────────────────
describe('V2-45 a confidence is capped by what its evidence can carry', () => {
  test('V2-45a the caps, in the order the evidence deserves; a cap only lowers', () => {
    assert.ok(EVIDENCE_CAP.TEXT_READ === 1 && EVIDENCE_CAP.LABEL_READ === 1);
    assert.ok(EVIDENCE_CAP.TEXT_READ >= EVIDENCE_CAP.PACKAGING && EVIDENCE_CAP.PACKAGING >= EVIDENCE_CAP.LOGO && EVIDENCE_CAP.LOGO > EVIDENCE_CAP.SHAPE && EVIDENCE_CAP.SHAPE > EVIDENCE_CAP.NONE);
    assert.ok(MODEL_LOGO_CAP < EVIDENCE_CAP.LOGO, 'a logo names a maker, not a model');
    assert.equal(calibrateField({ value: 'X', confidence: 0.98, evidence: 'SHAPE' }, 'model').calibrated_confidence, EVIDENCE_CAP.SHAPE);
    assert.equal(calibrateField({ value: 'X', confidence: 0.98, evidence: 'LOGO' }, 'model').calibrated_confidence, MODEL_LOGO_CAP);
    assert.equal(calibrateField({ value: 'X', confidence: 0.98, evidence: 'LOGO' }, 'brand').calibrated_confidence, EVIDENCE_CAP.LOGO);
    assert.equal(calibrateField({ value: 'X', confidence: 0.5, evidence: 'TEXT_READ' }, 'model').calibrated_confidence, 0.5, 'never raised');
    assert.equal(calibrateField({ value: null, confidence: 0.9, evidence: 'SHAPE' }, 'model').calibrated_confidence, 0);
    assert.equal(calibrateField(null).calibrated_confidence, 0);
  });
  test('V2-45b the gate reads the calibrated number: a silhouette at 0.98 does not clearly lead a rival it would have led at 0.98', () => {
    const raw = { ...RAW.PS5, model: { value: 'PlayStation 5', confidence: 0.98, evidence: 'SHAPE' },
      ranked_candidates: [{ brand: 'Sony', model: 'PlayStation 4 Pro', variant: null, confidence: 0.6, distinguishing_evidence: null }], missing_evidence: 'BOTTOM_MODEL_LABEL' };
    const identity = id(raw);
    assert.equal(identity.model.calibrated_confidence, EVIDENCE_CAP.SHAPE);
    const verdict = decideSufficiency(identity);
    assert.equal(verdict.decision, DECISION.NEED_FOLLOWUP);
    assert.equal(verdict.signals.model_confidence, EVIDENCE_CAP.SHAPE);
    // The same reading READ off a label is established at its own number.
    const read = id({ ...raw, visible_text: ['PlayStation 5'], model: { ...raw.model, evidence: 'TEXT_READ' } });
    assert.equal(read.model.calibrated_confidence, 0.98);
    assert.equal(decideSufficiency(read).decision, DECISION.SEARCH_NOW);
  });
  test('V2-45c every line of visible text has a role, decided from the identity and its own shape', () => {
    const roles = id({ ...M.NINJA, visible_text: ['NINJA', 'BLENDSENSE', 'POWER BLENDER DUO PRO', '1200W', 'Made in China', 'TB301'],
      model_number: { value: 'TB301', confidence: 0.9, evidence: 'LABEL_READ' } }).visible_text_roles;
    assert.deepEqual(roles.map((r) => r.role), [TEXT_ROLE.BRAND, TEXT_ROLE.OTHER, TEXT_ROLE.MODEL, TEXT_ROLE.CAPACITY, TEXT_ROLE.REGULATORY, TEXT_ROLE.MODEL_NUMBER]);
    assert.deepEqual(classifyVisibleText({}), []);
  });
  test('V2-45d a model number is kept only when it was READ and is in the text read; from memory it is nothing; read, it is an exact root', () => {
    assert.equal(id({ ...M.NINJA, model_number: { value: 'TB301', confidence: 0.9, evidence: 'TEXT_READ' } }).model_number.value, null, 'not in the visible text');
    assert.equal(id({ ...M.NINJA, visible_text: [...M.NINJA.visible_text, 'TB301'], model_number: { value: 'TB301', confidence: 0.9, evidence: 'SHAPE' } }).model_number.value, null, 'not read');
    const read = id({ ...M.NINJA, visible_text: [...M.NINJA.visible_text, 'M/N: TB301'], model_number: { value: 'M/N: TB301', confidence: 0.9, evidence: 'LABEL_READ' }, market_hypotheses: { aliases: [], model_numbers: [] } });
    assert.equal(read.model_number.value, 'TB301');
    const market = assessMarketIdentity({ identity: read, results: [] });
    assert.deepEqual(market.exact_roots, ['TB301']);
    assert.equal(market.aliases.length, 0, 'identity, not a proposal: nothing to corroborate');
  });
});

// ── THE ESTIMATE ────────────────────────────────────────────────────────────
describe('V2-46 a market-informed estimate exists only behind a measured factor', () => {
  const measured = (factor, status = FACTOR_STATUS.MEASURED) => ({
    version: 1, groups: [{ category: 'home', product_class: 'blender', condition: 'Good', status, factor, products: 7 }],
  });
  const witness = () => {
    const m = of('A witness');
    return (resaleFactors) => resolveV2Price({ identity: m.identity, subject: m.subject, sufficiency: m.sufficiency, evidence: m.evidence, searchOutcome: SEARCH_OUTCOME.COMPLETED, resaleFactors });
  };
  test('V2-46a the shipped table measures nothing, so the witness says what it is waiting for, beside its anchor', () => {
    const table = loadResaleFactors();
    assert.equal(table.groups.length, 0);
    assert.equal(findResaleFactor({ category: 'Home', object_class: 'blender', condition: 'Good' }).reason, 'no_calibrated_resale_factor');
    const p = witness()(undefined);
    assert.equal(p.state, PRICE_STATE.NO_PRICE_EVIDENCE);
    assert.equal(p.evidence_state, EVIDENCE_STATE.INSUFFICIENT_EVIDENCE);
    assert.deepEqual(p.limitation, { code: LIMITATION.NO_FACTOR, group: 'home:blender:Good', status: null });
    assert.equal(p.retail_anchor.strength, ANCHOR_STRENGTH.STRONG);
  });
  test('V2-46b THE WITNESS WITH A MEASURED FACTOR: anchor × factor, below the new price, disclosed as an estimate under its own confidence', () => {
    const p = witness()(measured({ median: 0.5, p25: 0.4, p75: 0.6 }));
    assert.equal(p.state, PRICE_STATE.MARKET_INFORMED_ESTIMATE);
    assert.equal(p.evidence_state, EVIDENCE_STATE.MARKET_INFORMED_ESTIMATE);
    assert.equal(p.limitation, null);
    assert.deepEqual([p.low, p.recommended, p.high], [Math.round(569 * 0.4), Math.round(584 * 0.5), Math.round(599 * 0.6)]);
    assert.ok(p.high < p.retail_anchor.median);
    assert.deepEqual([p.basis.kind, p.basis.listings, p.basis.anchor_shops, p.basis.factor.group, p.basis.factor.products], [BASIS.MARKET_INFORMED, 0, 2, 'home:blender:Good', 7]);
    assert.deepEqual(p.confidence.pricing, { used_market: USED_EVIDENCE.MARKET_INFORMED, retail_anchor: ANCHOR_STRENGTH.STRONG });
    assert.equal(p.confidence.identity.level, IDENTITY_CONFIDENCE.VERY_HIGH);
    assert.equal(p.authority, 'none');
  });
  test('V2-46c a factor that is not MEASURED, malformed, for another condition only, or for another kind of object yields no estimate', () => {
    const price = witness();
    assert.equal(price(measured({ median: 0.5, p25: 0.4, p75: 0.6 }, FACTOR_STATUS.INSUFFICIENT_DATA)).limitation.code, LIMITATION.NO_FACTOR);
    assert.equal(price(measured({ median: 1.2, p25: 0.4, p75: 0.6 })).limitation.code, LIMITATION.NO_FACTOR, 'a share above 1 is not a factor');
    assert.equal(price(measured({ median: 0.5, p25: 0.6, p75: 0.4 })).limitation.code, LIMITATION.NO_FACTOR, 'out of order');
    assert.equal(price({ version: 1, groups: [{ category: 'home', product_class: 'kettle', condition: 'Good', status: 'MEASURED', factor: { median: 0.5, p25: 0.4, p75: 0.6 } }] }).limitation.code, LIMITATION.NO_FACTOR);
    assert.equal(price({ version: 1, groups: [{ category: 'home', product_class: 'blender', condition: 'Poor', status: 'MEASURED', factor: { median: 0.2, p25: 0.1, p75: 0.3 } }] }).limitation.code, LIMITATION.NO_FACTOR);
    // The Unknown-condition row stands in for a condition that was not measured.
    assert.equal(price({ version: 1, groups: [{ category: 'home', product_class: 'blender', condition: 'Unknown', status: 'MEASURED', factor: { median: 0.5, p25: 0.4, p75: 0.6 } }] }).state, PRICE_STATE.MARKET_INFORMED_ESTIMATE);
  });
  test('V2-46d an estimate that does not sit below the new price is refused, not shown', () => {
    const p = witness()(measured({ median: 0.99, p25: 0.98, p75: 0.995 }));
    assert.equal(p.state, PRICE_STATE.NO_PRICE_EVIDENCE);
    assert.equal(p.limitation.code, LIMITATION.NOT_BELOW_RETAIL);
    assert.equal(p.recommended, null);
  });
  test('V2-46e no estimate without a product-level, strong identity, or without an anchor; the limitation names which', () => {
    const table = measured({ median: 0.5, p25: 0.4, p75: 0.6 });
    const noAnchor = of('P other product');
    const a = resolveV2Price({ ...noAnchor, searchOutcome: SEARCH_OUTCOME.COMPLETED, resaleFactors: table });
    assert.equal(a.state, PRICE_STATE.USED_EVIDENCE_BELOW_QUORUM);
    assert.equal(a.limitation.code, LIMITATION.NO_ANCHOR);
    const shoes = of('F shoes');
    const s = resolveV2Price({ ...shoes, searchOutcome: SEARCH_OUTCOME.COMPLETED, resaleFactors: { version: 1, groups: [{ category: 'clothing', product_class: 'sneakers', condition: 'Unknown', status: 'MEASURED', factor: { median: 0.5, p25: 0.4, p75: 0.6 } }] } });
    assert.notEqual(s.state, PRICE_STATE.MARKET_INFORMED_ESTIMATE);
    assert.ok([LIMITATION.NO_ANCHOR, LIMITATION.IDENTITY].includes(s.limitation.code));
    const generic = resolveV2Price({ ...of('C console'), sufficiency: { decision: DECISION.SEARCH_NOW, level: IDENTITY_LEVEL.GENERIC }, searchOutcome: SEARCH_OUTCOME.COMPLETED, resaleFactors: table });
    assert.ok(generic.limitation === null || generic.limitation.code === LIMITATION.IDENTITY);
  });
  test('V2-46f a below-quorum listing is blended into the estimate, and the estimate is never raised past the new price by it', () => {
    const m = of('P other product');
    const withAnchor = { ...m.evidence, retail_anchor: { kind: 'RETAIL_REPLACEMENT_ANCHOR', strength: ANCHOR_STRENGTH.STRONG, currency: 'ILS', low: 569, median: 584, high: 599, shops: 2, prices: [] } };
    const p = resolveV2Price({ identity: m.identity, subject: m.subject, sufficiency: m.sufficiency, evidence: withAnchor, searchOutcome: SEARCH_OUTCOME.COMPLETED, resaleFactors: measured({ median: 0.5, p25: 0.4, p75: 0.6 }) });
    assert.equal(p.state, PRICE_STATE.MARKET_INFORMED_ESTIMATE);
    assert.equal(p.basis.listings, 1);
    assert.equal(p.recommended, Math.round((292 + 380) / 2));
    assert.deepEqual([p.low, p.high], [Math.round(569 * 0.4), 380]);
  });
  test('V2-46g every state folds into one of three claims, and the group key is what the limitation names', () => {
    for (const m of MATRIX) {
      assert.ok(Object.values(EVIDENCE_STATE).includes(m.price.evidence_state), m.name);
      if (m.price.recommended === null) assert.ok(m.price.limitation && Object.values(LIMITATION).includes(m.price.limitation.code), `${m.name} says what it waits for`);
      else if (m.price.state !== PRICE_STATE.USED_EVIDENCE_BELOW_QUORUM) assert.equal(m.price.limitation, null, m.name);
    }
    assert.equal(groupKey({ category: 'Home', object_class: 'Blender', condition: 'Good' }), 'home:blender:Good');
    assert.equal(findResaleFactor({ category: '', object_class: 'blender' }).reason, 'no_category_or_product_class');
  });
});

// ── THE LEDGER ──────────────────────────────────────────────────────────────
describe('V2-47 the ledger line', () => {
  test('V2-47a one bounded JSON line: counts, every page, the priced rows; no key, no token, no user', () => {
    const m = of('A witness');
    const line = ledgerLine('12345678-aaaa-bbbb-cccc-1234567890ab', { ...m, plan: { queries: [{ purpose: 'SECOND_HAND' }] }, search: { provenance: { queries: ['q'], search_call_count: 2, results: new Array(31) } }, valuation: m.price, timings: { total_ms: 1 } });
    const parsed = JSON.parse(line);
    assert.equal(parsed.scan, '12345678');
    assert.deepEqual([parsed.state, parsed.evidence_state, parsed.limitation], [PRICE_STATE.NO_PRICE_EVIDENCE, EVIDENCE_STATE.INSUFFICIENT_EVIDENCE, LIMITATION.NO_FACTOR]);
    assert.equal(parsed.pages.length, 31);
    assert.equal(parsed.results, 31);
    assert.deepEqual(parsed.exact, ['TB301']);
    assert.ok(parsed.rows.length >= 2 && parsed.rows.every((r) => r.length === 10));
    assert.ok(line.length < 12000);
    assert.ok(!/sk-[A-Za-z0-9]{8}|eyJ[A-Za-z0-9]{10}|Bearer |"user_id"|"uid"|"state_token"/.test(line));
    assert.ok(!Object.keys(parsed).some((k) => /user|token|key|secret/i.test(k)));
    assert.ok(!line.includes('12345678-aaaa'), 'the scan id is clipped');
    assert.equal(typeof JSON.parse(ledgerLine(null, null)).state, 'object');
  });
});
